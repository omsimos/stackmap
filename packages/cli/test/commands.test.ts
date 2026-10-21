import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { commerceApi, groupedPlatform } from '@stackmap/core/samples';
import { deliverCommand, validateCommand } from '../src/commands';
import { EMPTY_DATA_BLOCK } from '../src/embed';

const TEMPLATE = `<!doctype html><head><title>stackmap</title></head><div id="root"></div>${EMPTY_DATA_BLOCK}`;
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stackmap-cli-'));
});
const file = (name: string, content: unknown) => {
  const p = join(dir, name);
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
};
const broken = { ...commerceApi, edges: [...commerceApi.edges, { id: 'dangling', from: 'edge', to: 'nowhere' }] };

describe('validate', () => {
  it('exits 0 with a one-line summary for a valid diagram', async () => {
    const r = await validateCommand(file('d.json', commerceApi), { json: false });
    expect(r).toEqual({ code: 0, stdout: '✓ valid: no diagnostics\n', stderr: '' });
  });

  it('exits 1 and names each diagnostic with its fixes', async () => {
    const r = await validateCommand(file('d.json', broken), { json: false });
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('error  refs/unknown-node  /edges/9/to');
    expect(r.stdout).toContain('Unknown node "nowhere"');
    expect(r.stdout).toContain('fix: add node "nowhere" or remove the edge');
    expect(r.stdout.trimEnd().split('\n').at(-1)).toBe('✗ 1 error');
  });

  it('--json prints the machine-readable result', async () => {
    const r = await validateCommand(file('d.json', broken), { json: true });
    const out = JSON.parse(r.stdout);
    expect(r.code).toBe(1);
    expect(out.ok).toBe(false);
    expect(out.diagnostics[0]).toMatchObject({ code: 'refs/unknown-node', subject: '/edges/9/to' });
  });

  it('reports invalid JSON as a diagnostic with line and column', async () => {
    const r = await validateCommand(file('d.json', '{\n  "kind": "architecture",\n  "title": }'), { json: true });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).diagnostics).toMatchObject([{ code: 'schema/invalid-json', subject: '', evidence: { line: 3, column: 12 } }]);
  });

  it('accepts a UTF-8 byte order mark', async () => {
    const r = await validateCommand(file('d.json', `\uFEFF${JSON.stringify(commerceApi)}`), { json: false });
    expect(r.code).toBe(0);
  });

  it('exits 2 without a stack trace when the file cannot be read', async () => {
    for (const p of [join(dir, 'missing.json'), dir]) {
      const r = await validateCommand(p, { json: false });
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/^stackmap: cannot read .+\n$/);
      expect(r.stderr).not.toContain('    at ');
    }
  });
});

describe('deliver', () => {
  it('opens the written file when asked, and still delivers with a warning when it can\'t', async () => {
    const input = file('platform.json', groupedPlatform);
    const opened: string[] = [];
    const ok = await deliverCommand(input, { template: TEMPLATE, open: async (f) => (opened.push(f), null) });
    expect(ok.code).toBe(0);
    expect(opened).toEqual([join(dir, 'platform.html')]);
    expect(ok.stderr).toBe('');
    const failed = await deliverCommand(input, { template: TEMPLATE, open: async () => 'xdg-open not found' });
    expect(failed.code).toBe(0);
    expect(failed.stdout).toMatch(/^delivered /);
    expect(failed.stderr).toBe(`warning: couldn't open ${join(dir, 'platform.html')} in a browser (xdg-open not found)\n`);
  });

  it('says up front when a layout will be slow, and stays quiet for a small one', async () => {
    const lines: string[] = [];
    await deliverCommand(file('small.json', groupedPlatform), { template: TEMPLATE, progress: (l) => lines.push(l) });
    expect(lines).toEqual([]);
    const nodes = Array.from({ length: 61 }, (_, i) => ({ id: `n${i}`, type: 'service', card: { title: `n${i}` } }));
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: `n${i}`, to: n.id }));
    const big = { kind: 'architecture', title: 'Big', nodes, edges };
    const r = await deliverCommand(file('big.json', big), { template: TEMPLATE, progress: (l) => lines.push(l) });
    expect(r.code).toBe(0);
    expect(lines).toEqual(['laying out 61 nodes and 60 connections; a diagram this size can take a while']);
  }, 30_000);

  it('opens nothing when validation fails', async () => {
    let opened = false;
    const r = await deliverCommand(file('broken.json', broken), { template: TEMPLATE, open: async () => ((opened = true), null) });
    expect(r.code).toBe(1);
    expect(opened).toBe(false);
  });

  it('writes the HTML next to the input and prints a sha256 receipt', async () => {
    const input = file('platform.json', groupedPlatform);
    const r = await deliverCommand(input, { template: TEMPLATE });
    const out = join(dir, 'platform.html');
    const bytes = readFileSync(out);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe(`delivered ${out} · sha256 ${createHash('sha256').update(bytes).digest('hex')} · ${bytes.length} bytes\n`);
    expect(bytes.toString()).toContain('<title>Platform · stackmap</title>');
  });

  it('styles the written path when given a terminal style', async () => {
    const style = { banner: () => '', path: (t: string) => `<${t}>` };
    const r = await deliverCommand(file('d.json', commerceApi), { template: TEMPLATE, style });
    expect(r.stdout).toMatch(new RegExp(`^delivered <${join(dir, 'd.html')}> · sha256 `));
  });

  it('is byte-identical across runs', async () => {
    const input = file('d.json', commerceApi);
    const a = await deliverCommand(input, { template: TEMPLATE, out: join(dir, 'a.html') });
    const b = await deliverCommand(input, { template: TEMPLATE, out: join(dir, 'b.html') });
    expect(readFileSync(join(dir, 'a.html'))).toEqual(readFileSync(join(dir, 'b.html')));
    expect(a.stdout.split(' · ')[1]).toBe(b.stdout.split(' · ')[1]);
  });

  it('writes nothing when validation fails, and prints why on stderr', async () => {
    const r = await deliverCommand(file('d.json', broken), { template: TEMPLATE });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('refs/unknown-node');
    expect(readdirSync(dir)).toEqual(['d.json']);
  });

  it('prints warnings but still delivers', async () => {
    const withWarning = { ...commerceApi, nodes: commerceApi.nodes.map((n, i) => (i === 0 ? { ...n, card: { ...n.card, brand: 'postgres' } } : n)) };
    const r = await deliverCommand(file('d.json', withWarning), { template: TEMPLATE });
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('warning  refs/unknown-brand');
    expect(r.stdout).toMatch(/^delivered /);
  });

  it('refuses to overwrite its own input', async () => {
    const json = file('d.json', commerceApi);
    const html = file('x.html', commerceApi);
    for (const [input, out] of [[json, json], [html, undefined], [json, join(dir, '.', 'd.json')]] as const) {
      const r = await deliverCommand(input, { template: TEMPLATE, out });
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/^stackmap: refusing to overwrite the input/);
    }
    expect(JSON.parse(readFileSync(json, 'utf8'))).toEqual(commerceApi);
  });

  it('reports an unexpected failure as an internal error with exit 2, never a stack trace', async () => {
    const r = await deliverCommand(file('d.json', commerceApi), { template: '<html>no data block</html>' });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/^stackmap: internal error: viewer template must contain/);
  });

  it('creates the folders -o names', async () => {
    const out = join(dir, 'new', 'deeper', 'd.html');
    const r = await deliverCommand(file('d.json', commerceApi), { template: TEMPLATE, out });
    expect(r.code).toBe(0);
    expect(readFileSync(out, 'utf8')).toContain('stackmap-data');
  });

  it('keeps the previous file intact and leaves no temp file when the write fails', async () => {
    const input = file('d.json', commerceApi);
    const outDir = join(dir, 'out');
    mkdirSync(outDir);
    const out = join(outDir, 'd.html');
    writeFileSync(out, 'previous');
    chmodSync(outDir, 0o500);
    try {
      const r = await deliverCommand(input, { template: TEMPLATE, out });
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/^stackmap: cannot write /);
    } finally {
      chmodSync(outDir, 0o700);
    }
    expect(readFileSync(out, 'utf8')).toBe('previous');
    expect(readdirSync(outDir)).toEqual(['d.html']);
  });
});
