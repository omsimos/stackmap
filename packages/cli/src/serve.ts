import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname } from 'node:path';
import type { Diagnostic } from '@stackmap/schema';
import { buildHtml } from './commands';
import { CliError } from './io';

/** Present only in served pages: the viewer opens an EventSource when it finds this block. */
export const LIVE_BLOCK_ID = 'stackmap-live';
const liveBlock = (build: string) =>
  `<script type="application/json" id="${LIVE_BLOCK_ID}">${JSON.stringify({ events: '/events', build })}</script>`;
const DEBOUNCE_MS = 100;
const PORT_ATTEMPTS = 20;

export interface ServeHandle {
  url: string;
  close(): Promise<void>;
}

export interface ServeOptions {
  template: string;
  /** 0 = any free port */
  port?: number;
  log?: (line: string) => void;
}

// The build id lets a page that outlived a serve restart notice it is stale and reload.
const withLive = (html: string, build: string) => {
  const at = html.lastIndexOf('</body>');
  return at < 0 ? html + liveBlock(build) : html.slice(0, at) + liveBlock(build) + html.slice(at);
};

const diagnostic = (code: string, message: string, fix: string, path: string): Diagnostic => ({
  code,
  severity: 'error',
  subject: '',
  message,
  evidence: { path },
  allowedFixes: [fix],
});

/** DNS rebinding: a foreign page resolving its own name to 127.0.0.1 would send its own Host. */
export function isLocalHost(host: string | undefined, port: number): boolean {
  // Clients leave the port out of Host when it is http's default.
  const suffixes = port === 80 ? [':80', ''] : [`:${port}`];
  return suffixes.some((s) => host === `127.0.0.1${s}` || host === `localhost${s}`);
}

function listen(server: ReturnType<typeof createServer>, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (p: number, left: number) => {
      const onError = (e: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        if (e.code === 'EADDRINUSE' && port !== 0 && left > 1 && p < 65535) tryPort(p + 1, left - 1);
        else reject(new CliError(`cannot listen on 127.0.0.1:${p}: ${e.code ?? e.message}`));
      };
      const onListening = () => {
        server.off('error', onError);
        resolve((server.address() as AddressInfo).port);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      // Loopback only, plus the Host check in the handler (loopback alone doesn't stop DNS rebinding).
      server.listen(p, '127.0.0.1');
    };
    tryPort(port, PORT_ATTEMPTS);
  });
}

export async function serve(path: string, { template, port = 4400, log = () => {} }: ServeOptions): Promise<ServeHandle> {
  let build = 'none';
  let page = withLive(template, build);
  let state: { ok: boolean; diagnostics: Diagnostic[]; build: string } = { ok: false, diagnostics: [], build };
  let lastInput = '';
  const clients = new Set<ServerResponse>();

  const send = (res: ServerResponse, event: string, data: string) => res.write(`event: ${event}\ndata: ${data}\n\n`);
  const broadcast = (event: string, data: string) => clients.forEach((res) => send(res, event, data));

  const publish = (next: { ok: boolean; diagnostics: Diagnostic[] }, html?: string) => {
    const key = createHash('sha256').update(JSON.stringify(next)).update(html ?? '').digest('hex');
    if (key === lastInput) return; // a save that changed nothing
    lastInput = key;
    if (html !== undefined) {
      build = createHash('sha256').update(html).digest('hex').slice(0, 16);
      page = withLive(html, build);
    }
    state = { ...next, build };
    broadcast('diagnostics', JSON.stringify(state));
    if (html !== undefined) {
      broadcast('reload', '');
      log(`✓ ${basename(path)} ${built ? 'reloaded' : 'ready'}`);
      built = true;
    } else {
      const errors = state.diagnostics.filter((d) => d.severity === 'error').length;
      log(`✗ ${basename(path)}: ${errors} error${errors === 1 ? '' : 's'}; keeping the last good version`);
    }
  };

  let built = false;
  const rebuild = async () => {
    try {
      const result = await buildHtml(path, template, log);
      publish({ ok: result.ok, diagnostics: result.diagnostics }, result.html);
    } catch (e) {
      const unreadable = e instanceof CliError;
      publish({
        ok: false,
        diagnostics: [
          unreadable
            ? diagnostic('io/unreadable', (e as Error).message, `restore ${basename(path)}`, path)
            : diagnostic('layout/failed', `layout failed: ${(e as Error).message}`, 'report this with the diagram attached', path),
        ],
      });
    }
  };

  // One rebuild waits behind the running one however many saves arrive: only the latest content matters.
  let queued = false;
  let running = Promise.resolve();
  const schedule = () => {
    if (queued) return;
    queued = true;
    running = running
      .then(() => {
        queued = false;
        return rebuild();
      })
      .catch((e: unknown) => log(`✗ rebuild failed: ${(e as Error).message}`));
  };

  // Editors save by writing a temp file and renaming it over the original, so watch the directory.
  // Watching starts before the first build, so a save during that layout is not lost.
  let timer: NodeJS.Timeout | undefined;
  const watcher: FSWatcher = watch(dirname(path), (_event, name) => {
    if (name !== null && name !== basename(path)) return;
    clearTimeout(timer);
    timer = setTimeout(schedule, DEBOUNCE_MS);
  });
  // e.g. the directory was deleted (EPERM on Windows): report it instead of crashing the server.
  watcher.on('error', (e) =>
    publish({ ok: false, diagnostics: [diagnostic('io/watch-failed', `stopped watching: ${e.message}`, 'restart stackmap serve', path)] }),
  );

  running = rebuild();
  await running;

  let bound = 0;
  const server = createServer((req, res) => {
    if (!isLocalHost(req.headers.host, bound)) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      return void res.end('forbidden host');
    }
    // Not `new URL`: it throws on a path like `//`, and any page in the user's browser can send one.
    const pathname = (req.url ?? '/').split('?', 1)[0];
    const read = req.method === 'GET' || req.method === 'HEAD';
    if (read && pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : page);
    } else if (req.method === 'GET' && pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('retry: 1000\n\n');
      send(res, 'diagnostics', JSON.stringify(state));
      clients.add(res);
      req.on('close', () => clients.delete(res));
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });

  const keepAlive = setInterval(() => clients.forEach((res) => res.write(': ping\n\n')), 15_000);

  bound = await listen(server, port).catch((e) => {
    clearTimeout(timer);
    watcher.close();
    clearInterval(keepAlive);
    throw e;
  });
  return {
    url: `http://127.0.0.1:${bound}`,
    close: async () => {
      clearTimeout(timer);
      clearInterval(keepAlive);
      watcher.close();
      clients.forEach((res) => res.end());
      await running;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
