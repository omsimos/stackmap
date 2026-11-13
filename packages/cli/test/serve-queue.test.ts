import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { buildHtml } from '../src/commands';
import { serve, type ServeHandle } from '../src/serve';

vi.mock('../src/commands', () => ({ buildHtml: vi.fn() }));
const build = vi.mocked(buildHtml);
const built = (title: string) => ({ ok: true, diagnostics: [], html: `<title>${title}</title><body></body>` });
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: ServeHandle | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

it('runs one rebuild for all the saves that arrive during a slow one', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'stackmap-queue-')), 'd.json');
  writeFileSync(file, '1');
  build.mockResolvedValueOnce(built('first'));
  server = await serve(file, { template: '<body></body>', port: 0 });
  build.mockClear();

  let release!: () => void;
  build.mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(built('slow')))));
  build.mockResolvedValue(built('latest'));
  // Each save lands after the previous one's debounce, while the slow build is still running.
  for (const content of ['2', '3', '4']) {
    writeFileSync(file, content);
    await pause(300);
  }
  release();
  await expect.poll(async () => (await fetch(server!.url)).text(), { timeout: 4000 }).toContain('<title>latest</title>');
  await pause(300);
  expect(build).toHaveBeenCalledTimes(2);
});

it('does not rebuild for a save that leaves the content as it was built', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'stackmap-queue-')), 'd.json');
  writeFileSync(file, '1');
  build.mockResolvedValue(built('first'));
  server = await serve(file, { template: '<body></body>', port: 0 });
  build.mockClear();
  writeFileSync(file, '1');
  await pause(400);
  expect(build).not.toHaveBeenCalled();
  writeFileSync(file, '2');
  await expect.poll(() => build.mock.calls.length, { timeout: 4000 }).toBe(1);
});
