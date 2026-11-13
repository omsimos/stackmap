import { expect, test, type Page } from '@playwright/test';

// Motion is opt-in here; every other spec runs with reduced motion (see playwright.config.ts).
test.use({ contextOptions: { reducedMotion: 'no-preference' } });

const running = (page: Page) => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
const settled = (page: Page) => expect.poll(() => running(page), { timeout: 5000 }).toBe(0);

test('the intro plays, then leaves no inline trace behind', async ({ page }) => {
  await page.goto('/?page=grouped');
  await expect.poll(() => running(page)).toBeGreaterThan(0);
  await settled(page);
  // Wait out the JS-driven edge draw as well as the WAAPI tweens.
  await expect(page.locator('.sm-edge-path[data-drawing]')).toHaveCount(0);
  const leftovers = await page.evaluate(() => ({
    cards: [...document.querySelectorAll<HTMLElement>('.sm-card')].filter((c) => c.style.opacity || c.style.transform).length,
    frames: [...document.querySelectorAll<HTMLElement>('[data-frame-id]')].filter((f) => f.style.opacity).length,
    drawn: [...document.querySelectorAll('.sm-edge-path')].filter((p) => ['pathLength', 'stroke-dasharray', 'stroke-dashoffset', 'draw'].some((a) => p.hasAttribute(a))).length,
    async: [...document.querySelectorAll<SVGPathElement>('.sm-edge-path')].filter((p) => /^5(px)?,? 4(px)?$/.test(p.style.strokeDasharray)).length,
  }));
  expect(leftovers).toEqual({ cards: 0, frames: 0, drawn: 0, async: 2 });
});

test('after the intro, emphasis is still CSS: tracing dims to 0.22', async ({ page }) => {
  await page.goto('/?page=sample');
  await settled(page);
  await page.locator('.sm-card[data-card-id="orders"]').click();
  await page.getByRole('button', { name: /^Trace/ }).click();
  const dimmed = page.locator('.sm-card[data-card-id="sessions"]');
  await expect(dimmed).toHaveAttribute('data-emphasis', 'dim');
  await expect.poll(() => dimmed.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.22');
});

test('popovers opened by pointer grow in; search opened with "/" appears at once', async ({ page }) => {
  // Count animate() calls per element instead of polling for a running animation: a 160ms pop-in can finish
  // before the first poll on a busy machine.
  await page.addInitScript(() => {
    const seen: Element[] = [];
    (window as unknown as { __animated: Element[] }).__animated = seen;
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, ...args: Parameters<Element['animate']>) {
      seen.push(this);
      return animate.apply(this, args);
    };
  });
  const animated = (loc: import('@playwright/test').Locator) => loc.evaluate((el) => (window as unknown as { __animated: Element[] }).__animated.includes(el));
  await page.goto('/?page=sample');
  await settled(page);
  await page.getByRole('button', { name: 'Filter by type' }).click();
  const lens = page.getByRole('group', { name: 'Show node types' });
  await expect.poll(() => animated(lens)).toBe(true);
  await settled(page);
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('/');
  const search = page.getByRole('combobox', { name: 'Search nodes' });
  await expect(search).toBeFocused();
  expect(await animated(search.locator('..'))).toBe(false);
});

test('reduced motion: nothing animates', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto('http://localhost:4173/?page=grouped');
  await expect(page.locator('.sm-card').first()).toBeVisible();
  expect(await running(page)).toBe(0);
  await context.close();
});

test('each card settles on its own: early cards are back to CSS while the wave is still running', async ({ page }) => {
  await page.goto('/?page=grouped');
  const early = page.locator('.sm-card[data-card-id="web"]');
  // Poll every frame or so for the window where "web" is done but later cards are still animating.
  await expect
    .poll(
      () =>
        early.evaluate((el) => {
          if (el.getAnimations().length || !document.getAnimations().some((a) => a.playState === 'running')) return 'wait';
          return el.style.opacity || el.style.transform ? 'inline left behind' : 'settled';
        }),
      { intervals: [16], timeout: 3000 },
    )
    .toBe('settled');
});

test('exporting mid-intro settles everything first', async ({ page }) => {
  await page.goto('/?page=grouped');
  await expect.poll(() => running(page)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Export' }).click();
  await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /^PNG\s*2×/ }).click()]);
  await expect(page.locator('.sm-edge-path[data-drawing]')).toHaveCount(0);
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.sm-card')].filter((c) => c.style.opacity).length)).toBe(0);
});

test('a pan cut short by a zoom is forgotten: the next arrow press keeps the zoom', async ({ page }) => {
  await page.goto('/?page=sample');
  await settled(page);
  const camera = () =>
    page.evaluate(() => {
      const m = new DOMMatrix(getComputedStyle(document.querySelector('.sm-viewport')!).transform);
      return { x: m.e, k: m.a };
    });
  await page.locator('.sm-stage').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('+');
  await page.waitForTimeout(400);
  const zoomed = await camera();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(400);
  const panned = await camera();
  expect(panned.k).toBeCloseTo(zoomed.k, 5);
  expect(panned.x).toBeCloseTo(zoomed.x - 80, 0);
});
