import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { groupedPlatform } from '@stackmap/core/samples';

test('a delivered file renders from file:// with no network', async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), 'stackmap-e2e-'));
  const input = join(dir, 'platform.json');
  writeFileSync(input, JSON.stringify(groupedPlatform));
  execFileSync('node', [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 'deliver', input]);

  const requests: string[] = [];
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file:') || url.startsWith('data:')) return route.continue();
    requests.push(url);
    return route.abort();
  });
  await page.goto(pathToFileURL(join(dir, 'platform.html')).href);
  await expect(page.locator('.sm-card')).toHaveCount(groupedPlatform.nodes.length);
  await expect(page.locator('.sm-frame')).toHaveCount(3);
  await expect(page).toHaveTitle('Platform · stackmap');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Platform');
  expect(await page.evaluate(() => document.fonts.check("500 13.5px 'Geist'"))).toBe(true);
  expect(requests).toEqual([]);
});

test('the bare template says no diagram is embedded', async ({ page }) => {
  await page.goto(new URL('../dist/viewer.html', import.meta.url).href);
  await expect(page.getByRole('status')).toHaveText(/No diagram embedded/);
});
