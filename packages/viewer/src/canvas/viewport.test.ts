import { describe, expect, it } from 'vitest';
import { clampZoom, fitTransform, LABEL_MIN_ZOOM, MAX_ZOOM, MIN_ZOOM, openingTransform, viewportRect } from './viewport';

describe('viewport math', () => {
  it('clamps zoom to [0.2, 2]', () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(9)).toBe(MAX_ZOOM);
    expect(clampZoom(1.3)).toBe(1.3);
  });

  it('fits like React Flow: k = min(W / (w·1.15), H / (h·1.15)), content centred', () => {
    const t = fitTransform({ x: 100, y: 50, width: 1000, height: 400 }, { width: 800, height: 600 });
    const k = 800 / (1000 * 1.15);
    expect(t.k).toBeCloseTo(k, 6);
    expect(t.x).toBeCloseTo((800 - 1000 * k) / 2 - 100 * k, 6);
    expect(t.y).toBeCloseTo((600 - 400 * k) / 2 - 50 * k, 6);
  });

  it('keeps a tall diagram clear of the chrome bands at the top and bottom of the stage', () => {
    const inset = { top: 80, bottom: 76 };
    const t = fitTransform({ x: 0, y: 0, width: 400, height: 1000 }, { width: 1000, height: 600 }, { inset });
    expect(t.k).toBeCloseTo((600 - 80 - 76) / 1000, 6);
    expect(t.y).toBeCloseTo(80, 6);
    expect(t.y + 1000 * t.k).toBeCloseTo(600 - 76, 6);
  });

  it('centres a wide diagram between the chrome bands without shrinking it', () => {
    const content = { x: 0, y: 0, width: 1000, height: 100 };
    const stage = { width: 800, height: 600 };
    const t = fitTransform(content, stage, { inset: { top: 80, bottom: 76 } });
    expect(t.k).toBeCloseTo(fitTransform(content, stage).k, 6);
    expect(t.y + (100 * t.k) / 2).toBeCloseTo((80 + 600 - 76) / 2, 6);
  });

  it('clamps the fitted zoom and still centres', () => {
    const t = fitTransform({ x: 40, y: 40, width: 200, height: 100 }, { width: 600, height: 400 });
    expect(t).toEqual({ x: 20, y: 20, k: 2 });
  });

  it('a diagram too big for the smallest zoom starts where it is read from, not mid-way', () => {
    const inset = { top: 80, bottom: 76 };
    const tall = fitTransform({ x: 10, y: 20, width: 600, height: 20000 }, { width: 800, height: 600 }, { inset });
    expect(tall.k).toBe(MIN_ZOOM);
    expect(tall.y + 20 * MIN_ZOOM).toBeCloseTo(80, 6);
    expect(tall.x).toBeCloseTo((800 - 600 * MIN_ZOOM) / 2 - 10 * MIN_ZOOM, 6);
    const wide = fitTransform({ x: 0, y: 0, width: 30000, height: 400 }, { width: 800, height: 600 }, { inset });
    expect(wide.x).toBeCloseTo(24, 6);
    expect(wide.y + (400 * MIN_ZOOM) / 2).toBeCloseTo((80 + 600 - 76) / 2, 6);
  });

  it('opens a big diagram on a phone at a readable zoom from its start, while desktop still fits it whole', () => {
    const inset = { top: 80, bottom: 76 };
    const content = { x: 0, y: 0, width: 3000, height: 800 };
    const phone = openingTransform(content, { width: 390, height: 844 }, inset);
    expect(fitTransform(content, { width: 390, height: 844 }, { inset }).k).toBe(MIN_ZOOM);
    expect(phone.k).toBe(LABEL_MIN_ZOOM);
    expect(phone.x).toBeCloseTo(24, 6);
    expect(phone.y + (800 * LABEL_MIN_ZOOM) / 2).toBeCloseTo((80 + 844 - 76) / 2, 6);
    const desktop = { width: 1440, height: 900 };
    expect(openingTransform(content, desktop, inset)).toEqual(fitTransform(content, desktop, { inset }));
  });

  it('leaves a phone opening alone when the diagram already fits readably', () => {
    const inset = { top: 80, bottom: 76 };
    const content = { x: 0, y: 0, width: 300, height: 300 };
    const stage = { width: 390, height: 844 };
    expect(openingTransform(content, stage, inset)).toEqual(fitTransform(content, stage, { inset }));
  });

  it('returns identity for a zero-size stage or empty content', () => {
    expect(fitTransform({ x: 0, y: 0, width: 500, height: 300 }, { width: 0, height: 0 })).toEqual({ x: 0, y: 0, k: 1 });
    expect(fitTransform({ x: 0, y: 0, width: 0, height: 0 }, { width: 800, height: 600 })).toEqual({ x: 0, y: 0, k: 1 });
  });

  it('maps the visible stage back into diagram coordinates', () => {
    expect(viewportRect({ x: -100, y: 40, k: 2 }, { width: 800, height: 600 })).toEqual({ x: 50, y: -20, width: 400, height: 300 });
  });
});
