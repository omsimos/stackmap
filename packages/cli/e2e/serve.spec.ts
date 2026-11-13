import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { commerceApi } from '@stackmap/core/samples';

let proc: ChildProcess;
let url: string;
let file: string;
const write = (content: unknown) => writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));

async function start(initial: unknown, port = '0') {
  if (initial !== undefined) {
    file = join(mkdtempSync(join(tmpdir(), 'stackmap-live-')), 'd.json');
    write(initial);
  }
  proc = spawn('node', [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 'serve', file, '--port', port]);
  url = await new Promise<string>((resolve, reject) => {
    proc.stdout!.on('data', (b: Buffer) => {
      const m = /serving (http:\/\/127\.0\.0\.1:\d+)/.exec(b.toString());
      if (m) resolve(m[1]!);
    });
    proc.once('exit', (code) => reject(new Error(`serve exited ${code}`)));
  });
}
test.afterEach(() => {
  proc.kill('SIGINT');
});

const viewportOf = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.sm-viewport')!).transform);
    return { x: m.e, y: m.f, k: m.a };
  });

test('edits reload the page; a broken edit keeps the last good version and says why', async ({ page }) => {
  await start(commerceApi);
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Commerce API');

  write('{ "kind": "architecture", ');
  const toast = page.getByRole('status').filter({ hasText: 'error' });
  await expect(toast).toContainText('showing the last good version');
  await expect(toast).toContainText('schema/invalid-json');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Commerce API');

  write({ ...commerceApi, title: 'Commerce v2' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Commerce v2');
  await expect(toast).toHaveCount(0);
});

test('the camera, selection and theme survive a live reload', async ({ page }) => {
  await start(commerceApi);
  await page.goto(url);
  await expect(page.locator('.sm-card')).toHaveCount(6);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.locator('.sm-card[data-card-id="orders"]').click();
  await page.getByRole('button', { name: /Switch to (dark|light) theme/ }).click();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.waitForTimeout(300);
  const before = await viewportOf(page);

  write({ ...commerceApi, title: 'Commerce v3' });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Commerce v3');
  await page.waitForTimeout(300);
  expect(await viewportOf(page)).toEqual(before);
  await expect(page.locator('.sm-card[data-card-id="orders"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
});

test('serving an invalid file shows the waiting state, then the diagram once fixed', async ({ page }) => {
  await start({ kind: 'architecture' });
  await page.goto(url);
  await expect(page.getByText('Waiting for a valid diagram…')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'error' })).toContainText('waiting for a valid diagram');
  write(commerceApi);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Commerce API');
});

test('a page open across a serve restart shows it is disconnected, then picks up the new build', async ({ page }) => {
  await start(commerceApi);
  await page.goto(url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Commerce API');
  const port = new URL(url).port;
  const stopped = new Promise((resolve) => proc.once('exit', resolve));
  proc.kill('SIGINT');
  await stopped;
  await expect(page.getByText(/Disconnected from/)).toBeVisible();
  write({ ...commerceApi, title: 'After restart' });
  await start(undefined, port);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('After restart', { timeout: 10_000 });
});

test.describe('with motion', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } });
  const running = (page: import('@playwright/test').Page) =>
    page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);

  test('a live reload animates only what is new', async ({ page }) => {
    await start(commerceApi);
    await page.goto(url);
    await expect.poll(() => running(page), { timeout: 5000 }).toBe(0);

    write({
      ...commerceApi,
      nodes: [...commerceApi.nodes, { id: 'audit', type: 'storage', card: { title: 'Audit log' } }],
      edges: [...commerceApi.edges, { id: 'e-orders-audit', from: 'orders', to: 'audit' }],
    });
    await expect(page.locator('.sm-card[data-card-id="audit"]')).toHaveCount(1);
    const animating = await page.evaluate(() => ({
      cards: Array.from(document.querySelectorAll<HTMLElement>('.sm-card')).filter((c) => c.getAnimations().length).map((c) => c.dataset.cardId),
      panels: Array.from(document.querySelectorAll('.sm-panel')).filter((p) => p.getAnimations().length).length,
    }));
    expect(animating).toEqual({ cards: ['audit'], panels: 0 });
  });
});
