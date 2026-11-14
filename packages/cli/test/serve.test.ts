import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { commerceApi } from '@stackmap/core/samples';
import { EMPTY_DATA_BLOCK } from '../src/embed';
import { CliError } from '../src/io';
import { isLocalHost, LIVE_BLOCK_ID, serve, type ServeHandle } from '../src/serve';

const TEMPLATE = `<!doctype html><html><head><title>stackmap</title></head><body><div id="root"></div>${EMPTY_DATA_BLOCK}</body></html>`;
let dir: string;
let file: string;
let server: ServeHandle | undefined;
const write = (content: unknown) => writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stackmap-serve-'));
  file = join(dir, 'd.json');
});
afterEach(async () => {
  await server?.close();
  server = undefined;
});

type Sse = { event: string; data: string };
/** An open /events stream; `next` reads until an event satisfies `pred`. */
async function subscribe(url: string) {
  const res = await fetch(`${url}/events`);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const queue: Sse[] = [];
  const next = async (pred: (e: Sse) => boolean): Promise<Sse> => {
    const deadline = Date.now() + 8000;
    for (;;) {
      const i = queue.findIndex(pred);
      if (i >= 0) return queue.splice(0, i + 1).at(-1)!;
      if (Date.now() > deadline) throw new Error(`timed out; queue ${JSON.stringify(queue)}`);
      const { value, done } = await reader.read();
      if (done) throw new Error('stream closed');
      buf += decoder.decode(value, { stream: true });
      let at: number;
      while ((at = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, at);
        buf = buf.slice(at + 2);
        const event = /^event: (.*)$/m.exec(chunk)?.[1];
        if (event) queue.push({ event, data: /^data: (.*)$/m.exec(chunk)?.[1] ?? '' });
      }
    }
  };
  // Every client is greeted with the current diagnostics, so waiting for it means we are connected.
  const hello = await next((e) => e.event === 'diagnostics');
  return { hello, next, close: () => reader.cancel() };
}
const isDiag = (ok: boolean) => (e: Sse) => e.event === 'diagnostics' && JSON.parse(e.data).ok === ok;
const isReload = (e: Sse) => e.event === 'reload';

const page = async (url: string) => (await fetch(url)).text();
const titleOf = (html: string) => /<title>(.*?)<\/title>/.exec(html)?.[1];
const withTitle = (title: string) => ({ ...commerceApi, title });

const raw = (url: string, method: string, host?: string) =>
  new Promise<number>((resolve, reject) => {
    const req = request(url, { method, headers: host ? { host } : {} }, (res) => {
      res.resume();
      resolve(res.statusCode!);
    });
    req.on('error', reject);
    req.end();
  });
const buildOf = (html: string) => JSON.parse(/id="stackmap-live">(.*?)<\/script>/.exec(html)![1]!).build as string;

describe('serve', () => {
  it('serves the live viewer on 127.0.0.1 and sends the current diagnostics to a new client', async () => {
    write(commerceApi);
    server = await serve(file, { template: TEMPLATE, port: 0 });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const html = await page(server.url);
    expect(titleOf(html)).toBe('Commerce API · stackmap');
    expect(html).toMatch(new RegExp(`<script type="application/json" id="${LIVE_BLOCK_ID}">\\{"events":"/events","build":"[0-9a-f]{16}"\\}</script>`));
    const sse = await subscribe(server.url);
    expect(sse.hello.event).toBe('diagnostics');
    expect(JSON.parse(sse.hello.data)).toEqual({ ok: true, diagnostics: [], build: buildOf(html) });
    await sse.close();
    expect((await fetch(`${server.url}/nope`)).status).toBe(404);
  });

  it('refuses a foreign Host header (DNS rebinding) and answers HEAD', async () => {
    write(commerceApi);
    server = await serve(file, { template: TEMPLATE, port: 0 });
    const port = new URL(server.url).port;
    expect(await raw(server.url, 'GET', `evil.example:${port}`)).toBe(403);
    expect(await raw(`${server.url}/events`, 'GET', 'evil.example')).toBe(403);
    expect(await raw(server.url, 'GET', `localhost:${port}`)).toBe(200);
    expect(await raw(server.url, 'HEAD')).toBe(200);
  });

  it('accepts a Host without a port only on port 80, where clients leave it out', () => {
    expect(isLocalHost('127.0.0.1', 80)).toBe(true);
    expect(isLocalHost('localhost', 80)).toBe(true);
    expect(isLocalHost('localhost:80', 80)).toBe(true);
    expect(isLocalHost('localhost', 4400)).toBe(false);
    expect(isLocalHost('evil.example', 80)).toBe(false);
    expect(isLocalHost(undefined, 80)).toBe(false);
  });

  it('answers a path that is not a valid URL instead of crashing', async () => {
    write(commerceApi);
    server = await serve(file, { template: TEMPLATE, port: 0 });
    expect(await raw(`${server.url}//`, 'GET')).toBe(404);
    expect(await raw(`${server.url}/?x=1`, 'GET')).toBe(200);
    expect(await raw(server.url, 'GET')).toBe(200);
  });

  it('stamps the page and every diagnostics event with the build id, so a stale page can tell', async () => {
    write(commerceApi);
    server = await serve(file, { template: TEMPLATE, port: 0 });
    const first = buildOf(await page(server.url));
    const sse = await subscribe(server.url);
    expect(JSON.parse(sse.hello.data).build).toBe(first);
    write(withTitle('Commerce v2'));
    await sse.next(isReload);
    const second = buildOf(await page(server.url));
    expect(second).not.toBe(first);
    await sse.close();
    // A client that connects later still learns the current build from the greeting.
    const late = await subscribe(server.url);
    expect(JSON.parse(late.hello.data).build).toBe(second);
    await late.close();
  });

  it('does not overflow past port 65535 when the port is busy', async () => {
    write(commerceApi);
    const blocker = createServer();
    const listening = await new Promise<boolean>((resolve) => {
      blocker.once('error', () => resolve(false));
      blocker.listen(65535, '127.0.0.1', () => resolve(true));
    });
    try {
      if (listening) await expect(serve(file, { template: TEMPLATE, port: 65535 })).rejects.toThrow(/cannot listen/);
    } finally {
      blocker.close();
    }
  });

  it('reloads on a good edit, keeps the last good page on a broken one, recovers when fixed', async () => {
    write(commerceApi);
    server = await serve(file, { template: TEMPLATE, port: 0 });
    const url = server.url;

    const sse = await subscribe(url);
    write('{ "kind": ');
    const broken = await sse.next(isDiag(false));
    expect(JSON.parse(broken.data).diagnostics[0].code).toBe('schema/invalid-json');
    expect(titleOf(await page(url))).toBe('Commerce API · stackmap');

    write(withTitle('Commerce v2'));
    await sse.next(isDiag(true));
    await sse.next(isReload);
    expect(titleOf(await page(url))).toBe('Commerce v2 · stackmap');
    await sse.close();
  });

  it('keeps the last good page when the file disappears, and recovers when it returns', async () => {
    write(commerceApi);
    server = await serve(file, { template: TEMPLATE, port: 0 });
    const sse = await subscribe(server.url);
    rmSync(file);
    const gone = await sse.next(isDiag(false));
    expect(JSON.parse(gone.data).diagnostics[0]).toMatchObject({ code: 'io/unreadable' });
    expect(titleOf(await page(server.url))).toBe('Commerce API · stackmap');
    write(withTitle('Back again'));
    await sse.next(isReload);
    expect(titleOf(await page(server.url))).toBe('Back again · stackmap');
    await sse.close();
  });

  it('picks up an edit saved while the first layout is still running', async () => {
    write(commerceApi);
    const starting = serve(file, { template: TEMPLATE, port: 0 });
    // serve has read the file and is awaiting its layout.
    write(withTitle('Edited early'));
    server = await starting;
    await expect.poll(async () => titleOf(await page(server!.url)), { timeout: 8000 }).toBe('Edited early · stackmap');
  });

  it('says a large layout is under way before it finishes', async () => {
    const nodes = Array.from({ length: 61 }, (_, i) => ({ id: `n${i}`, type: 'service', card: { title: `n${i}` } }));
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: `n${i}`, to: n.id }));
    write({ kind: 'architecture', title: 'Big', nodes, edges });
    const lines: string[] = [];
    server = await serve(file, { template: TEMPLATE, port: 0, log: (l) => lines.push(l) });
    expect(lines).toEqual(['laying out 61 nodes and 60 connections; a diagram this size can take a while', '✓ d.json ready']);
  });

  it('fails with a plain message, and builds nothing, when the folder to watch is missing', async () => {
    const lines: string[] = [];
    const starting = serve(join(dir, 'nope', 'x.json'), { template: TEMPLATE, port: 0, log: (l) => lines.push(l) });
    await expect(starting).rejects.toThrow(CliError);
    await expect(starting).rejects.toThrow(/^cannot watch .+nope: ENOENT$/);
    expect(lines).toEqual([]);
  });

  it('starts on an invalid file with the bare live template', async () => {
    write({ kind: 'architecture' });
    server = await serve(file, { template: TEMPLATE, port: 0 });
    const html = await page(server.url);
    expect(html).toContain(EMPTY_DATA_BLOCK);
    expect(html).toContain(LIVE_BLOCK_ID);
    const sse = await subscribe(server.url);
    expect(JSON.parse(sse.hello.data).ok).toBe(false);
    await sse.close();
  });
});
