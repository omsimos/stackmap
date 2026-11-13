import { expect, test, type Page } from '@playwright/test';

// M3 explorer: selection, inspector, trace, search, lens, views, deep links, keyboard.
const viewportOf = (page: Page) =>
  page.evaluate(() => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.sm-viewport')!).transform);
    return { x: m.e, y: m.f, k: m.a };
  });
const card = (page: Page, id: string) => page.locator(`.sm-card[data-card-id="${id}"]`);
const emphasisOf = (page: Page) =>
  page.$$eval('.sm-card', (els) => Object.fromEntries(els.map((e) => [e.getAttribute('data-card-id'), e.getAttribute('data-emphasis')])));
const inspector = (page: Page) => page.getByRole('complementary', { name: 'Inspector' });
const settle = (page: Page) => page.waitForTimeout(250);

test.beforeEach(async ({ page }) => {
  await page.goto('/?page=sample');
  await expect(page.locator('.sm-card')).toHaveCount(6);
  await settle(page);
});

test('clicking a card selects it: inspector shows its data, connections and evidence', async ({ page }) => {
  await card(page, 'orders').click();
  await expect(card(page, 'orders')).toHaveAttribute('aria-pressed', 'true');
  const panel = inspector(page);
  await expect(panel.getByRole('heading', { level: 2, name: 'Orders' })).toBeVisible();
  await expect(panel.getByText('Read replicas', { exact: true })).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Connections' }).getByRole('button')).toHaveCount(3);
  const link = panel.getByRole('link', { name: 'infra/orders/postgres.tf:12' });
  await expect(link).toHaveAttribute('href', 'https://github.com/omsimos/stackmap/blob/main/infra/orders/postgres.tf#L12');
  await expect(panel.getByText('Primary + 2 read replicas')).toBeVisible();
  // Its direct edges take the source (service) tint.
  await expect(page.locator('path[data-edge-id="e-1-orders"]')).toHaveAttribute('data-tint', 'service');
  await expect(page.locator('path[data-edge-id="e-edge-1"]')).not.toHaveAttribute('data-tint', /.+/);
});

test('a connection in the inspector selects that node', async ({ page }) => {
  await card(page, 'orders').click();
  await inspector(page).getByRole('button', { name: /commerce-api-2/ }).click();
  await expect(card(page, 'commerce-api-2')).toHaveAttribute('aria-pressed', 'true');
});

test('clicking empty canvas or pressing Escape clears the selection; dragging does not', async ({ page }) => {
  await card(page, 'orders').click();
  const stage = page.locator('.sm-stage');
  const box = (await stage.boundingBox())!;
  // Drag across empty canvas: pans, keeps the selection.
  await page.mouse.move(box.x + box.width - 60, box.y + box.height - 120);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 160, box.y + box.height - 160, { steps: 5 });
  await page.mouse.up();
  await expect(card(page, 'orders')).toHaveAttribute('aria-pressed', 'true');
  // Drag that starts on a card: no selection change either.
  const c = (await card(page, 'sessions').boundingBox())!;
  await page.mouse.move(c.x + 40, c.y + 20);
  await page.mouse.down();
  await page.mouse.move(c.x - 60, c.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(card(page, 'orders')).toHaveAttribute('aria-pressed', 'true');
  // A real click on empty canvas clears. (d3-zoom swallows clicks for one tick after a drag.)
  await page.waitForTimeout(50);
  await page.mouse.click(box.x + box.width - 40, box.y + box.height - 100);
  await expect(card(page, 'orders')).toHaveAttribute('aria-pressed', 'false');
  await card(page, 'orders').click();
  await page.keyboard.press('Escape');
  await expect(card(page, 'orders')).toHaveAttribute('aria-pressed', 'false');
});

test('trace dims everything outside the selection’s upstream and downstream', async ({ page }) => {
  await card(page, 'commerce-api-1').click();
  await page.getByRole('button', { name: /Trace upstream/ }).click();
  const e = await emphasisOf(page);
  expect(e).toEqual({ edge: 'normal', 'commerce-api-1': 'focus', 'commerce-api-2': 'dim', 'commerce-api-3': 'dim', orders: 'normal', sessions: 'normal' });
  await expect(page.locator('path[data-edge-id="e-edge-1"]')).toHaveAttribute('data-tint', 'gateway');
  await expect(page.locator('path[data-edge-id="e-2-orders"]')).toHaveAttribute('data-dim', 'true');
});

test('"/" opens search; Enter selects the first match and centres it', async ({ page }) => {
  await page.locator('body').press('/');
  const box = page.getByRole('combobox', { name: 'Search nodes' });
  await expect(box).toBeFocused();
  await box.fill('sess');
  await expect(page.getByRole('option')).toHaveText([/Sessions/]);
  expect((await emphasisOf(page)).orders).toBe('dim');
  await box.press('Enter');
  await expect(box).toBeHidden();
  await expect(card(page, 'sessions')).toHaveAttribute('aria-pressed', 'true');
  await settle(page);
  const stage = (await page.locator('.sm-stage').boundingBox())!;
  const c = (await card(page, 'sessions').boundingBox())!;
  expect(Math.abs(c.x + c.width / 2 - (stage.x + stage.width / 2))).toBeLessThan(2);
  // Vertically centred in the band between the toolbar (80px) and the zoom bar (76px).
  expect(Math.abs(c.y + c.height / 2 - (stage.y + (stage.height + 80 - 76) / 2))).toBeLessThan(2);
});

test('a search result that was off screen ends up centred, not panned past', async ({ page }) => {
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.locator('.sm-stage').focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowLeft');
  await settle(page);
  await page.keyboard.press('/');
  await page.getByRole('combobox', { name: 'Search nodes' }).fill('sess');
  await page.getByRole('combobox', { name: 'Search nodes' }).press('Enter');
  await expect(card(page, 'sessions')).toBeFocused();
  await settle(page);
  const stage = (await page.locator('.sm-stage').boundingBox())!;
  const c = (await card(page, 'sessions').boundingBox())!;
  expect(Math.abs(c.x + c.width / 2 - (stage.x + stage.width / 2))).toBeLessThan(2);
  expect(Math.abs(c.y + c.height / 2 - (stage.y + (stage.height + 80 - 76) / 2))).toBeLessThan(2);
});

test('search tolerates regex characters and whitespace', async ({ page }) => {
  await page.getByRole('button', { name: /Search nodes/ }).click();
  const box = page.getByRole('combobox', { name: 'Search nodes' });
  for (const q of ['.*', '(', '   ', '[a-z]+']) {
    await box.fill(q);
    await expect(page.locator('.sm-card')).toHaveCount(6);
  }
  await box.fill('.*');
  await expect(page.getByText('No matching nodes')).toBeVisible();
});

test('the type lens dims unchecked types and can be restored', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter by type' }).click();
  await page.getByRole('checkbox', { name: /Service/ }).uncheck();
  const e = await emphasisOf(page);
  expect(e['commerce-api-1']).toBe('dim');
  expect(e.orders).toBe('normal');
  await expect(page.getByRole('button', { name: 'Filter by type' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('checkbox', { name: /Service/ }).check();
  expect((await emphasisOf(page))['commerce-api-1']).toBe('normal');
});

test('a view tab dims non-members, shows its caption and fits its members', async ({ page }) => {
  const before = await viewportOf(page);
  await page.getByRole('tab', { name: 'Data tier' }).click();
  await expect(page.getByText('Where state lives')).toBeVisible();
  const e = await emphasisOf(page);
  expect([e.orders, e.sessions, e['commerce-api-1']]).toEqual(['normal', 'normal', 'dim']);
  await settle(page);
  expect((await viewportOf(page)).k).toBeGreaterThan(before.k);
  await page.getByRole('tab', { name: 'Overview' }).click();
  await settle(page);
  expect(await viewportOf(page)).toEqual(before);
});

test('state is mirrored in the hash and restored from a deep link', async ({ page }) => {
  await page.getByRole('tab', { name: 'Data tier' }).click();
  await card(page, 'orders').click();
  await page.getByRole('button', { name: 'Filter by type' }).click();
  await page.getByRole('checkbox', { name: /Cache/ }).uncheck();
  expect(new URL(page.url()).hash).toBe('#view=data&node=orders&lens=cache');
  await page.reload();
  await expect(card(page, 'orders')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tab', { name: 'Data tier' })).toHaveAttribute('aria-selected', 'true');
  expect((await emphasisOf(page)).sessions).toBe('dim');
});

test('a deep link with unknown ids is ignored and the viewer still renders', async ({ page }) => {
  await page.goto('/?page=sample#view=nope&node=ghost&lens=lambda');
  await expect(page.locator('.sm-card')).toHaveCount(6);
  expect(Object.values(await emphasisOf(page)).every((v) => v === 'normal')).toBe(true);
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
});

test('keyboard only: tab to a card, arrow between cards, Enter selects, Escape clears', async ({ page }) => {
  await card(page, 'edge').focus();
  await page.keyboard.press('ArrowRight');
  await expect(card(page, 'commerce-api-2')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(card(page, 'commerce-api-1')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(card(page, 'commerce-api-1')).toHaveAttribute('aria-pressed', 'true');
  await expect(inspector(page).getByRole('heading', { level: 2, name: 'commerce-api-1' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card(page, 'commerce-api-1')).toHaveAttribute('aria-pressed', 'false');
});

test('Tab reaches the toolbar before the canvas, and the canvas is one tab stop (roving)', async ({ page }) => {
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const order: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(() => {
        const el = document.activeElement!;
        return el.getAttribute('data-card-id') ? `card:${el.getAttribute('data-card-id')}` : (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim();
      }),
    );
  }
  expect(order.indexOf('Search nodes (/)')).toBeLessThan(order.findIndex((x) => x.startsWith('card:')));
  expect(order.filter((x) => x.startsWith('card:'))).toEqual(['card:edge']);
  // Arrows still reach every card from the single tab stop (walk every direction from every card reached).
  const seen = new Set(['edge']);
  const queue = ['edge'];
  while (queue.length) {
    const from = queue.shift()!;
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) {
      await card(page, from).focus();
      await page.keyboard.press(key);
      const to = await page.evaluate(() => document.activeElement?.getAttribute('data-card-id'));
      if (to && !seen.has(to)) seen.add(to) && queue.push(to);
    }
  }
  expect([...seen].sort()).toEqual(['commerce-api-1', 'commerce-api-2', 'commerce-api-3', 'edge', 'orders', 'sessions']);
});

test('focus is never dropped: search Enter lands on the card, Esc returns to the button, Clear returns to the card', async ({ page }) => {
  await page.locator('body').press('/');
  await page.getByRole('combobox').fill('orders');
  await page.getByRole('combobox').press('Enter');
  await expect(card(page, 'orders')).toBeFocused();
  await page.getByRole('button', { name: /Search nodes/ }).click();
  await page.getByRole('combobox').press('Escape');
  await expect(page.getByRole('button', { name: /Search nodes/ })).toBeFocused();
  await inspector(page).getByRole('button', { name: /Clear selection/ }).click();
  await expect(card(page, 'orders')).toBeFocused();
  await expect(card(page, 'orders')).toHaveAttribute('aria-pressed', 'false');
});

test('Escape closes the lens from its button and on the page body clears the selection', async ({ page }) => {
  await page.getByRole('button', { name: 'Filter by type' }).click();
  await expect(page.getByRole('checkbox').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Filter by type' })).toBeFocused();
  await card(page, 'orders').click();
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await page.keyboard.press('Escape');
  await expect(card(page, 'orders')).toHaveAttribute('aria-pressed', 'false');
});

test('the inspector collapses with a node selected, keeping focus on its toggle', async ({ page }) => {
  await card(page, 'orders').click();
  await inspector(page).getByRole('button', { name: 'Hide inspector' }).click();
  await expect(inspector(page).getByRole('button', { name: 'Show inspector' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(inspector(page).getByRole('button', { name: 'Hide inspector' })).toBeFocused();
  await expect(inspector(page).getByRole('heading', { level: 2, name: 'Orders' })).toBeVisible();
});

test('a hash change to another node moves the camera to it', async ({ page }) => {
  await page.goto('/?page=sample#node=orders');
  await settle(page);
  const before = await viewportOf(page);
  await page.evaluate(() => (location.hash = '#node=edge'));
  await settle(page);
  await expect(card(page, 'edge')).toHaveAttribute('aria-pressed', 'true');
  expect(await viewportOf(page)).not.toEqual(before);
});

test('a deep link to a node inside a view keeps the view’s fit', async ({ page }) => {
  await page.goto('/?page=sample#view=data');
  await settle(page);
  const viewFit = await viewportOf(page);
  await page.goto('/?page=sample#view=data&node=orders');
  await settle(page);
  expect((await viewportOf(page)).k).toBeCloseTo(viewFit.k, 3);
});

test('focusing an off-screen card pans it into view', async ({ page }) => {
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await settle(page);
  // Arrive by keyboard, as a keyboard user would (programmatic focus after a click isn't :focus-visible).
  await card(page, 'orders').focus();
  await page.keyboard.press('ArrowDown');
  await expect(card(page, 'sessions')).toBeFocused();
  await settle(page);
  const stage = (await page.locator('.sm-stage').boundingBox())!;
  const c = (await card(page, 'sessions').boundingBox())!;
  expect(c.x).toBeGreaterThanOrEqual(stage.x);
  expect(c.y).toBeGreaterThanOrEqual(stage.y + 80); // clear of the toolbar band
  expect(c.x + c.width).toBeLessThanOrEqual(stage.x + stage.width);
  expect(c.y + c.height).toBeLessThanOrEqual(stage.y + stage.height);
});

test('the focused stage pans with arrows and zooms with + / - / 0', async ({ page }) => {
  const start = await viewportOf(page);
  await page.locator('.sm-stage').focus();
  await page.keyboard.press('ArrowRight');
  await settle(page);
  expect((await viewportOf(page)).x).toBeLessThan(start.x);
  await page.keyboard.press('+');
  await settle(page);
  expect((await viewportOf(page)).k).toBeGreaterThan(start.k);
  await page.keyboard.press('0');
  await settle(page);
  expect(await viewportOf(page)).toEqual(start);
});

test('the inspector starts collapsed on a narrow window and can be opened', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.reload();
  await expect(inspector(page).getByRole('button', { name: 'Show inspector' })).toBeVisible();
  await inspector(page).getByRole('button', { name: 'Show inspector' }).click();
  await expect(inspector(page).getByRole('list', { name: 'Legend' })).toBeVisible();
});

test('on a phone the inspector opens over the canvas, and the toolbar keeps to one row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('.sm-card')).toHaveCount(6);
  const stage = page.getByRole('tabpanel', { name: 'Diagram' });
  const full = (await stage.boundingBox())!;
  expect(full.width).toBeGreaterThan(350);
  const [first, last] = await Promise.all([page.getByRole('button', { name: 'Search nodes (/)' }).boundingBox(), page.getByRole('button', { name: 'Export' }).boundingBox()]);
  expect(Math.abs(first!.y + first!.height / 2 - (last!.y + last!.height / 2))).toBeLessThan(2);
  await inspector(page).getByRole('button', { name: 'Show inspector' }).click();
  await expect(inspector(page).getByRole('list', { name: 'Legend' })).toBeVisible();
  expect((await stage.boundingBox())!.width).toBe(full.width);
  const sheet = (await inspector(page).boundingBox())!;
  expect(sheet.x).toBeGreaterThanOrEqual(full.x);
  expect(sheet.x + sheet.width).toBeLessThanOrEqual(full.x + full.width);
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(full.y + full.height);
  await card(page, 'orders').click({ force: true });
  await expect(inspector(page).getByRole('heading', { level: 2, name: 'Orders' })).toBeVisible();
  await inspector(page).getByRole('button', { name: 'Hide inspector' }).click();
  await expect(inspector(page).getByRole('button', { name: 'Show inspector' })).toBeFocused();
});

test('with reduced motion the camera jumps instead of animating', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('.sm-card')).toHaveCount(6);
  const before = await viewportOf(page);
  // The first scale that differs from the start must already be the final one: an animation would show steps.
  const firstChange = page.evaluate(
    (k0) =>
      new Promise<number>((resolve) => {
        const tick = () => {
          const k = new DOMMatrix(getComputedStyle(document.querySelector('.sm-viewport')!).transform).a;
          if (k !== k0) resolve(k);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    before.k,
  );
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect(await firstChange).toBeCloseTo(before.k * 1.2, 3);
});

test('a view fits its members clear of the toolbar and zoom bar', async ({ page }) => {
  await page.getByRole('tab', { name: 'Data tier' }).click();
  await settle(page);
  const panels = await Promise.all((await page.locator('.sm-panel').all()).map((l) => l.boundingBox()));
  for (const id of ['orders', 'sessions']) {
    const c = (await card(page, id).boundingBox())!;
    for (const p of panels.filter((b) => b !== null)) {
      const overlap = c.x < p.x + p.width && p.x < c.x + c.width && c.y < p.y + p.height && p.y < c.y + c.height;
      expect(overlap, `${id} under a panel`).toBe(false);
    }
  }
});

test('holding an arrow key pans the full distance for every repeat', async ({ page }) => {
  const start = await viewportOf(page);
  await page.locator('.sm-stage').focus();
  await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 4; i++) await page.keyboard.down('ArrowRight'); // auto-repeat
  await page.keyboard.up('ArrowRight');
  await settle(page);
  expect((await viewportOf(page)).x).toBeCloseTo(start.x - 5 * 80, 0);
});

test('dragging on the minimap pans the canvas with the pointer', async ({ page }) => {
  await page.getByRole('button', { name: 'Toggle minimap' }).click();
  const map = (await page.locator('svg.sm-minimap').boundingBox())!;
  const before = await viewportOf(page);
  await page.mouse.move(map.x + map.width * 0.3, map.y + map.height / 2);
  await page.mouse.down();
  await page.mouse.move(map.x + map.width * 0.7, map.y + map.height / 2, { steps: 6 });
  const mid = await viewportOf(page);
  await page.mouse.up();
  expect(mid.x).toBeLessThan(before.x - 50); // moved during the drag, not only on release
  expect(mid.k).toBeCloseTo(before.k, 5);
});

test('the canvas neither selects text nor scrolls the page on touch', async ({ page }) => {
  const style = await page.locator('.sm-stage').evaluate((el) => {
    const s = getComputedStyle(el);
    return { select: s.userSelect, touch: s.touchAction };
  });
  expect(style).toEqual({ select: 'none', touch: 'none' });
});

test('a canvas that mounts at zero size fits once it gets one, without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // A constructed sheet survives document parsing (a <style> added this early doesn't).
  await page.addInitScript(() => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync('section[aria-label="Diagram"] { height: 0 !important; flex: none !important; }');
    document.adoptedStyleSheets = [sheet];
  });
  await page.goto('/?page=sample');
  await expect(page.locator('.sm-card')).toHaveCount(6);
  expect((await page.locator('.sm-stage').boundingBox())!.height).toBe(0);
  await page.evaluate(() => (document.adoptedStyleSheets = []));
  await settle(page);
  const stage = (await page.locator('.sm-stage').boundingBox())!;
  for (const id of ['edge', 'orders', 'commerce-api-3']) {
    const c = (await card(page, id).boundingBox())!;
    expect(c.x >= stage.x && c.y >= stage.y && c.x + c.width <= stage.x + stage.width && c.y + c.height <= stage.y + stage.height, id).toBe(true);
  }
  expect(errors).toEqual([]); // a zero-size zoom animation used to render NaN transforms
});

test('zoomed out past reading size, edge labels fade, except on the edges a selection lights', async ({ page }) => {
  await page.goto('/?page=event-stream');
  await expect(page.locator('.sm-card').first()).toBeVisible();
  await settle(page);
  const label = (id: string) => page.locator(`[data-edge-label="${id}"]`);
  await expect(label('e4')).toHaveCSS('opacity', '1');
  await page.locator('.sm-stage').focus();
  while ((await viewportOf(page)).k >= 0.5) {
    await page.keyboard.press('-');
    await settle(page);
  }
  await expect(label('e4')).toHaveCSS('opacity', '0');
  await expect(label('e1')).toHaveCSS('opacity', '0');
  // Selecting payments lights e4, so its label comes back while the rest stay hidden.
  await card(page, 'payments').click();
  await expect(label('e4')).toHaveCSS('opacity', '1');
  await expect(label('e1')).not.toHaveCSS('opacity', '1');
  await page.keyboard.press('Escape');
  await page.locator('.sm-stage').focus();
  await page.keyboard.press('+');
  await page.keyboard.press('+');
  await settle(page);
  await expect(label('e1')).toHaveCSS('opacity', '1');
});
