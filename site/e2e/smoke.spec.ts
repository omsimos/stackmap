import { expect, test, type Page } from '@playwright/test';

const KINDS = ['architecture', 'dataflow', 'workflow', 'lifecycle', 'sequence'];
const ROUTES = ['/', '/docs', '/docs/viewer', '/docs/cli', '/docs/schema', '/docs/brands', ...KINDS.map((k) => `/docs/${k}`), '/examples', '/examples/food-delivery', '/examples/cache-miss'];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

for (const route of ROUTES) {
  test(`${route} renders with no console errors`, async ({ page }) => {
    const errors = collectErrors(page);
    const res = await page.goto(route);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(errors).toEqual([]);
  });

  test(`${route} shares with a title, description and image`, async ({ page }) => {
    await page.goto(route);
    for (const p of ['og:title', 'og:description', 'og:url', 'og:image']) await expect(page.locator(`meta[property="${p}"]`), p).toHaveAttribute('content', /\S/);
    const image = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect((await page.request.get(new URL(image!).pathname)).status()).toBe(200);
  });

  test(`${route} never scrolls sideways on a 320px phone`, async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 320, height: 700 }, reducedMotion: 'reduce' });
    await page.goto(route);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await page.close();
  });

  test(`${route} never skips a heading level`, async ({ page }) => {
    await page.goto(route);
    // Headings the reader can reach: the other composition's copy is display:none on the landing.
    const levels = await page.locator('h1, h2, h3, h4, h5, h6').evaluateAll((hs) =>
      hs.filter((h) => h.getClientRects().length || h.closest('.sr-only, .sr')).map((h) => Number(h.tagName[1])),
    );
    levels.forEach((l, i) => expect(l, `heading ${i} after h${levels[i - 1]}`).toBeLessThanOrEqual((levels[i - 1] ?? 0) + 1));
  });
}

test('an unknown address gets the 404 page, kept out of the index', async ({ page }) => {
  const res = await page.goto('/no/such/page');
  expect(res?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Off the map.' })).toBeVisible();
  await expect(page).toHaveTitle(/^Page not found · stackmap$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await page.getByRole('navigation', { name: 'Ways back' }).getByRole('link', { name: /Examples/ }).click();
  await expect(page).toHaveURL(/\/examples$/);
});

test('with reduced motion the landing is its resting frame: the whole session, nothing pinned', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: /Every layer of your stack/ })).toBeVisible();
  await expect(page.locator('.how-pin')).not.toHaveAttribute('data-live');
  await expect(page.locator('.hpanel')).toHaveAttribute('data-step', '3');
  await expect(page.locator('.hpanel').getByText(/delivered \.stackmap\/commerce-api\/diagram\.html/)).toBeVisible();
  for (const el of await page.locator('[data-reveal]').all()) await expect(el).toHaveCSS('opacity', '1');
});

test('with motion allowed the walkthrough pins and the scroll picks its step', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  await page.goto('/');
  const pin = page.locator('.how-pin');
  await expect(pin).toHaveAttribute('data-live', 'true');
  // Before any scroll the rail is unlit, as step 1 is.
  await expect.poll(() => page.locator('.hfill').evaluate((el) => getComputedStyle(el).transform)).toBe('matrix(0, 0, 0, 1, 0, 0)');
  const at = (f: number) =>
    page.evaluate((f) => {
      const p = document.querySelector<HTMLElement>('.how-pin')!;
      scrollTo(0, p.getBoundingClientRect().top + scrollY - 120 + (p.offsetHeight - innerHeight) * f);
    }, f);
  await at(0.05);
  await expect(page.locator('.hpanel')).toHaveAttribute('data-step', '0');
  await at(0.95);
  await expect(page.locator('.hpanel')).toHaveAttribute('data-step', '3');
  await page.close();
});

test('the phone layout never pins and fits a 390px screen', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' });
  await page.goto('/');
  await expect(page.locator('.how-pin')).not.toHaveAttribute('data-live');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.close();
});

test('the hero viewer selects a card and shows it in its inspector, without touching the URL', async ({ page }) => {
  await page.goto('/');
  const viewer = page.getByRole('group', { name: /The stackmap viewer/ });
  const card = viewer.locator('.sm-card[data-card-id="orders"]');
  await expect(card).toBeVisible();
  await card.click();
  await expect(viewer.getByRole('complementary', { name: 'Inspector' }).getByRole('heading', { level: 3, name: 'Orders DB' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
});

test('the try bar drives the viewer and says what each mode does', async ({ page }) => {
  await page.goto('/');
  const bar = page.getByRole('group', { name: 'Try the viewer' });
  const inspector = page.getByRole('complementary', { name: 'Inspector' }).first();
  await bar.getByRole('button', { name: /Route/ }).click();
  await expect(bar.getByRole('button', { name: /Route/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector.getByRole('heading', { name: 'Storefront → Orders DB' })).toBeVisible();
  await expect(page.getByText('Pick two nodes and every path between them lights up, hop by hop.')).toBeVisible();
  await bar.getByRole('button', { name: /Views/ }).click();
  await expect(page.getByRole('tab', { name: 'Checkout path' })).toHaveAttribute('aria-selected', 'true');
  await expect(bar.getByRole('button', { name: /Route/ })).toHaveAttribute('aria-pressed', 'false');
});

test('the viewer’s keys work only while it has focus', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('combobox', { name: /search/i });
  await page.keyboard.press('/');
  await expect(search).toHaveCount(0);
  await page.locator('.sm-card[data-card-id="api"]').first().click();
  await page.keyboard.press('/');
  await expect(search).toBeVisible();
});

test('the kind tabs swap the stage, by click and by arrow key', async ({ page }) => {
  await page.goto('/');
  const tabs = page.getByRole('tablist', { name: 'Diagram kinds' });
  await tabs.getByRole('tab', { name: 'Sequence' }).click();
  await expect(tabs.getByRole('tab', { name: 'Sequence' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('link', { name: /Sequence diagrams/ })).toHaveAttribute('href', '/docs/sequence');
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Architecture' })).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.getByRole('tab', { name: 'Architecture' })).toBeFocused();
});

test('each kind plays its flow while on screen', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.locator('#kp').scrollIntoViewIfNeeded();
  const visible = page.locator('#kp .k-layer.on [data-pulse]:not([style*="hidden"])');
  await expect.poll(() => visible.count(), { timeout: 8000 }).toBeGreaterThan(0);
  await page.close();
});

test('the theme toggle flips the page and is remembered', async ({ page }) => {
  await page.goto('/docs');
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  await page.getByRole('navigation', { name: 'Site' }).getByRole('button', { name: /Switch to (dark|light) theme/ }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).not.toBe(before);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
});

test('the gallery filters by kind and by agent, and a kind can be linked to', async ({ page }) => {
  await page.goto('/examples');
  const cards = page.locator('.ex-li:visible');
  await expect(cards).toHaveCount(16);
  const kinds = page.getByRole('group', { name: 'Filter by kind' });
  await kinds.getByRole('button', { name: /Sequence/ }).click();
  await expect(cards).toHaveCount(2);
  await expect(page).toHaveURL(/\?kind=sequence$/);
  await kinds.getByRole('button', { name: /^All/ }).click();
  await page.getByRole('button', { name: /Written by an agent/ }).click();
  await expect(cards).toHaveCount(5);
  await page.goto('/examples?kind=lifecycle');
  await expect(kinds.getByRole('button', { name: /Lifecycle/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(cards).toHaveCount(2);
});

test('an example opens in the viewer, which selects a card, and its pager moves on', async ({ page }) => {
  await page.goto('/examples');
  await page.getByRole('link', { name: /Food Delivery Platform/ }).click();
  await expect(page).toHaveURL(/\/examples\/food-delivery$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Food Delivery Platform' })).toBeVisible();
  await expect(page.getByText('What the agent was asked')).toBeVisible();
  const card = page.locator('.ev .sm-card').first();
  await expect(card).toBeVisible();
  const title = (await card.getAttribute('aria-label'))!.split(',')[0]!;
  await card.click();
  await expect(page.getByRole('complementary', { name: 'Inspector' }).getByRole('heading', { name: title })).toBeVisible();
  await expect(page.locator('.exp-url b')).toContainText('node=');
  await page.getByRole('link', { name: /^Next example/ }).click();
  await expect(page).toHaveURL(/\/examples\/incident-response$/);
});

test('the old kind pages redirect into the docs', async ({ page }) => {
  await page.goto('/kinds/workflow');
  await expect(page).toHaveURL(/\/docs\/workflow$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Workflow' })).toBeVisible();
});

test('the docs search opens with ⌘K, finds a field and goes to it', async ({ page }) => {
  await page.goto('/docs');
  const box = page.getByRole('combobox', { name: 'Search the docs' });
  // The shortcut is bound once the page hydrates; a press before that lands nowhere.
  await expect(async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(box).toBeFocused({ timeout: 500 });
  }).toPass();
  await box.fill('statsNote');
  await expect(page.getByRole('option').first()).toContainText('statsNote');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/docs\/schema#cards$/);
  await expect(box).toHaveCount(0);
});

test('the docs sidebar follows the section in view', async ({ page }) => {
  await page.goto('/docs/cli');
  const nav = page.getByRole('navigation', { name: 'Documentation' }).first();
  await expect(nav.getByRole('link', { name: 'Run it' })).toHaveAttribute('aria-current', 'true');
  await page.locator('#exit').scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect(nav.getByRole('link', { name: 'Exit codes' })).toHaveAttribute('aria-current', 'true');
});

test('the viewer docs drive the real viewer and show the link it makes', async ({ page }) => {
  await page.goto('/docs/viewer');
  const bar = page.getByRole('group', { name: 'Show a feature' });
  await bar.getByRole('button', { name: 'Route' }).click();
  await expect(bar.getByRole('button', { name: 'Route' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Route between two nodes' })).toBeVisible();
  await expect(page.locator('.vf-url b')).toHaveText('#route=storefront~orders');
});

test('the CLI docs switch diagnostic families', async ({ page }) => {
  await page.goto('/docs/cli');
  const tabs = page.getByRole('tablist', { name: 'Diagnostic families' });
  await tabs.getByRole('tab', { name: 'card-fit' }).click();
  await expect(page.getByRole('tabpanel').filter({ hasText: 'card-fit/overflow' })).toBeVisible();
});

test('the docs copy button confirms', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/docs');
  await page.getByRole('button', { name: 'Copy the install command' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('npx skills add omsimos/stackmap');
});

test('on a phone the nav menu opens the site links and closes on Escape', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('/docs');
  const menu = page.getByRole('button', { name: 'Menu' });
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  const links = page.getByRole('navigation', { name: 'Site menu' });
  await expect(links.getByRole('link', { name: 'Examples' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
  await menu.click();
  await links.getByRole('link', { name: 'Examples' }).click();
  await expect(page).toHaveURL(/\/examples$/);
  await expect(page.getByRole('button', { name: 'Menu' })).toHaveAttribute('aria-expanded', 'false');
  await page.close();
});

test('with the walkthrough pinned, a hash lands on its section, a reload keeps its place and a broken hash is harmless', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  const errors = collectErrors(page);
  const top = (id: string) => page.evaluate((id) => Math.abs(document.getElementById(id)!.getBoundingClientRect().top), id);
  await page.goto('/#50%');
  await expect(page.locator('.how-pin')).toHaveAttribute('data-live', 'true');
  expect(errors).toEqual([]);
  // From another page, loaded and then through the router: both end below the runway, on the section.
  await page.goto('/docs');
  await page.goto('/#install');
  await expect.poll(() => top('install')).toBeLessThan(140);
  await page.goto('/docs');
  await page.getByRole('link', { name: 'Install', exact: true }).first().click();
  await expect(page).toHaveURL(/\/#install$/);
  await expect.poll(() => top('install')).toBeLessThan(140);
  // The address still names #install, but the reader has moved on: a reload restores where they were.
  await page.evaluate(() => scrollTo({ top: 300, behavior: 'instant' }));
  await page.waitForTimeout(300);
  await page.reload();
  await expect(page.locator('.how-pin')).toHaveAttribute('data-live', 'true');
  expect(Math.abs((await page.evaluate(() => scrollY)) - 300)).toBeLessThan(60);
  await page.close();
});

test('a reload part-way down the landing never blanks what is already on screen', async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  // The lowest opacity any reveal on screen ever has, sampled every frame from before the page's own script.
  await page.addInitScript(() => {
    const w = window as unknown as { lowest: number };
    w.lowest = 1;
    const tick = () => {
      for (const el of document.querySelectorAll('[data-reveal]')) {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        if (r.bottom > 0 && r.top < innerHeight * 0.9) w.lowest = Math.min(w.lowest, s.visibility === 'hidden' ? 0 : Number(s.opacity));
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.goto('/');
  await expect(page.locator('.how-pin')).toHaveAttribute('data-live', 'true');
  await page.evaluate(() => scrollTo({ top: document.getElementById('how')!.getBoundingClientRect().top + scrollY - 100, behavior: 'instant' }));
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('.how-pin')).toHaveAttribute('data-live', 'true');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(500);
  expect(await page.evaluate(() => (window as unknown as { lowest: number }).lowest)).toBe(1);
  await page.close();
});
