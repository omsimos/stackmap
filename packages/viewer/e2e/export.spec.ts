import { existsSync, readFileSync } from 'node:fs';
import { expect, test, webkit } from '@playwright/test';
import { commerceApiLayout } from '../src/samples/commerce-api.layout';

// PNG IHDR: width and height are big-endian u32 at bytes 16..24.
const pngSize = (buf: Buffer) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

// Content box = union of card and group rects (scene.content), padded by 32px on every side.
const rects = Object.values(commerceApiLayout.nodes);
const w = Math.max(...rects.map((r) => r.x + r.width)) - Math.min(...rects.map((r) => r.x));
const h = Math.max(...rects.map((r) => r.y + r.height)) - Math.min(...rects.map((r) => r.y));

async function exportAs(page: import('@playwright/test').Page, label: RegExp) {
  await page.getByRole('button', { name: 'Export' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: label }).click()]);
  return { name: dl.suggestedFilename(), bytes: readFileSync((await dl.path())!) };
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?page=sample');
  await expect(page.locator('.sm-card')).toHaveCount(6);
  await page.evaluate(() => document.fonts.ready);
});

test('PNG exports the whole diagram at 1× and 2×, named after the title', async ({ page }) => {
  const one = await exportAs(page, /^PNG\s*1×/);
  expect(one.name).toBe('commerce-api.png');
  expect(pngSize(one.bytes)).toEqual({ width: Math.ceil(w + 64), height: Math.ceil(h + 64) });
  const two = await exportAs(page, /^PNG\s*2×/);
  expect(two.name).toBe('commerce-api.2x.png');
  expect(pngSize(two.bytes)).toEqual({ width: Math.ceil(w + 64) * 2, height: Math.ceil(h + 64) * 2 });
});

test('the PNG shows every card, even when zoomed in on one corner', async ({ page }) => {
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
  const { bytes } = await exportAs(page, /^PNG\s*1×/);
  expect(pngSize(bytes)).toEqual({ width: Math.ceil(w + 64), height: Math.ceil(h + 64) });
  // Render it and count non-background pixels in each card's area: all six cards are drawn.
  const drawn = await page.evaluate(
    async ({ b64, boxes, origin }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      [c.width, c.height] = [img.width, img.height];
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const bg = ctx.getImageData(2, 2, 1, 1).data;
      return boxes.map((r) => {
        const d = ctx.getImageData(r.x - origin.x + 32 + 20, r.y - origin.y + 32 + 20, 40, 20).data;
        let diff = 0;
        for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i]! - bg[0]!) + Math.abs(d[i + 1]! - bg[1]!) + Math.abs(d[i + 2]! - bg[2]!) > 12) diff++;
        return diff;
      });
    },
    {
      b64: bytes.toString('base64'),
      boxes: rects,
      origin: { x: Math.min(...rects.map((r) => r.x)), y: Math.min(...rects.map((r) => r.y)) },
    },
  );
  expect(drawn.every((n) => n > 20)).toBe(true);
});

test('edges are drawn in the export', async ({ page }) => {
  const { bytes } = await exportAs(page, /^PNG\s*1×/);
  const edge = commerceApiLayout.edges['e-edge-2']!; // straight horizontal run from the gateway
  const origin = { x: Math.min(...rects.map((r) => r.x)), y: Math.min(...rects.map((r) => r.y)) };
  const inked = await page.evaluate(
    async ({ b64, a, b }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      [c.width, c.height] = [img.width, img.height];
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const bg = ctx.getImageData(2, 2, 1, 1).data;
      const mid = { x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2) };
      const d = ctx.getImageData(mid.x - 3, mid.y - 3, 7, 7).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i]! - bg[0]!) + Math.abs(d[i + 1]! - bg[1]!) + Math.abs(d[i + 2]! - bg[2]!) > 30) n++;
      return n;
    },
    {
      b64: bytes.toString('base64'),
      a: { x: edge[0]!.x - origin.x + 32, y: edge[0]!.y - origin.y + 32 },
      b: { x: edge[1]!.x - origin.x + 32, y: edge[1]!.y - origin.y + 32 },
    },
  );
  expect(inked).toBeGreaterThan(3);
});

test('SVG is a foreignObject snapshot with the fonts embedded', async ({ page }) => {
  const { name, bytes } = await exportAs(page, /^SVG/);
  expect(name).toBe('commerce-api.svg');
  const raw = bytes.toString('utf8');
  const svg = raw.startsWith('data:') ? decodeURIComponent(raw.slice(raw.indexOf(',') + 1)) : raw;
  expect(svg).toMatch(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  expect(svg).toContain('<foreignObject');
  expect(svg).toContain('OpenShip Edge');
  expect(svg).toMatch(/@font-face[^}]*Geist/);
  // Only rendering-relevant inline styles: the unfiltered snapshot of this sample was 1.47 MB.
  expect(bytes.length).toBeLessThan(600_000);
});

test('an export carries the edge labels even when the canvas is zoomed out past showing them', async ({ page }) => {
  await page.goto('/?page=event-stream');
  await expect(page.locator('.sm-card').first()).toBeVisible();
  await page.locator('.sm-stage').focus();
  for (let i = 0; i < 6; i++) await page.keyboard.press('-');
  await page.waitForTimeout(250);
  await expect(page.locator('[data-edge-label="e4"]')).toHaveCSS('opacity', '0');
  const raw = (await exportAs(page, /^SVG/)).bytes.toString('utf8');
  const svg = raw.startsWith('data:') ? decodeURIComponent(raw.slice(raw.indexOf(',') + 1)) : raw;
  const e4 = svg.slice(svg.indexOf('data-edge-label="e4"'));
  expect(e4.slice(0, e4.indexOf('payment facts'))).not.toMatch(/opacity: 0[;"]/);
  await expect(page.locator('[data-edge-label="e4"]')).toHaveCSS('opacity', '0');
});

test('the export menu is keyboard operable and closes on Escape', async ({ page }) => {
  await page.getByRole('button', { name: 'Export' }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export' })).toBeFocused();
});

// Safari doesn't focus a button on click: pressing an item blurred the focused one, and that blur closed the menu.
test('the export menu takes a mouse click in WebKit', async ({ baseURL }) => {
  test.skip(!existsSync(webkit.executablePath()), 'WebKit is not installed');
  const browser = await webkit.launch();
  try {
    const page = await browser.newPage({ baseURL });
    await page.goto('/?page=sample');
    await expect(page.locator('.sm-card')).toHaveCount(6);
    expect((await exportAs(page, /^SVG/)).name).toBe('commerce-api.svg');
  } finally {
    await browser.close();
  }
});

test('edge routes that swing outside the cards are inside the export', async ({ page }) => {
  const { groupedPlatformLayout } = await import('../src/samples/grouped-platform.layout');
  await page.goto('/?page=grouped');
  await page.evaluate(() => document.fonts.ready);
  const boxes = [...Object.values(groupedPlatformLayout.nodes), ...Object.values(groupedPlatformLayout.groups)];
  const pts = Object.values(groupedPlatformLayout.edges).flat();
  const xs = [...boxes.flatMap((r) => [r.x, r.x + r.width]), ...pts.map((p) => p.x)];
  const ys = [...boxes.flatMap((r) => [r.y, r.y + r.height]), ...pts.map((p) => p.y)];
  const { bytes } = await exportAs(page, /^PNG\s*1×/);
  expect(pngSize(bytes)).toEqual({
    width: Math.ceil(Math.max(...xs) - Math.min(...xs) + 64),
    height: Math.ceil(Math.max(...ys) - Math.min(...ys) + 64),
  });
});

test('toned edges keep their colour in the export (main path in ink)', async ({ page }) => {
  await page.goto('/?page=release-delivery');
  await page.evaluate(() => document.fonts.ready);
  const { bytes } = await exportAs(page, /^PNG\s*1×/);
  // Sample the middle of the Commit → Pull request run (a main-path edge) in the exported image.
  const layout = (await import('../src/samples/gallery.layout')).galleryLayouts['release-delivery']!;
  const pts = layout.edges.e1!;
  const xs = Object.values(layout.nodes).map((r) => r.x).concat(Object.values(layout.lanes!).map((r) => r.x), Object.values(layout.phases!).map((r) => r.x));
  const ys = Object.values(layout.nodes).map((r) => r.y).concat(Object.values(layout.lanes!).map((r) => r.y), Object.values(layout.phases!).map((r) => r.y));
  const at = { x: (pts[0]!.x + pts.at(-1)!.x) / 2 - Math.min(...xs) + 32, y: pts[0]!.y - Math.min(...ys) + 32 };
  const darkest = await page.evaluate(
    async ({ b64, at }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement('canvas');
      [c.width, c.height] = [img.width, img.height];
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(Math.round(at.x) - 2, Math.round(at.y) - 3, 5, 7).data;
      let min = 255;
      for (let i = 0; i < d.length; i += 4) min = Math.min(min, d[i]!, d[i + 1]!, d[i + 2]!);
      return min;
    },
    { b64: bytes.toString('base64'), at },
  );
  expect(darkest).toBeLessThan(80);
});

test('JPEG and WebP export the whole diagram at 2×', async ({ page }) => {
  const jpeg = await exportAs(page, /^JPEG/);
  expect(jpeg.name).toBe('commerce-api.jpg');
  expect([...jpeg.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
  const webp = await exportAs(page, /^WebP/);
  expect(webp.name).toBe('commerce-api.webp');
  expect(webp.bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
  // VP8/VP8L/VP8X headers all carry the canvas size; the extended one (VP8X) is 24-bit little-endian minus one.
  const chunk = webp.bytes.subarray(12, 16).toString('ascii');
  if (chunk === 'VP8X') expect(webp.bytes.readUIntLE(24, 3) + 1).toBe(Math.ceil(w + 64) * 2);
});

test('Video records the flow animation as a WebM', async ({ page }) => {
  test.slow();
  const video = await exportAs(page, /^Video/);
  expect(video.name).toBe('commerce-api.webm');
  // EBML magic, and several seconds' worth of frames.
  expect([...video.bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
  expect(video.bytes.length).toBeGreaterThan(20_000);
});
