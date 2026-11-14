import { describe, expect, it } from 'vitest';
import type { Point, Rect } from '@stackmap/core';
import { nudge } from '../src/route';

const crosses = (a: Point, b: Point, r: Rect) =>
  Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height;
const hits = (routes: Record<string, Point[]>, card: Rect) =>
  Object.entries(routes).flatMap(([id, pts]) => (pts.slice(1).some((b, i) => crosses(pts[i]!, b, card)) ? [id] : []));
/** Edges that share no card: every one takes a track of its own. */
const apart = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { from: `${id}-from`, to: `${id}-to` }]));

describe('nudge', () => {
  it('keeps the tracks it hands out off a card beside the channel', () => {
    // Six edges along y=100, 20px above a card: the sixth track (+24) would run 4px inside it.
    const card = { x: 100, y: 120, width: 176, height: 60 };
    const routes = Object.fromEntries(
      Array.from({ length: 6 }, (_, k) => [`e${k}`, [{ x: k * 10, y: 0 }, { x: k * 10, y: 100 }, { x: 300 + k * 10, y: 100 }, { x: 300 + k * 10, y: 300 }]]),
    );
    expect(hits(nudge(routes, apart(Object.keys(routes))), card)).toEqual(['e5']);
    const out = nudge(routes, apart(Object.keys(routes)), [card]);
    expect(hits(out, card)).toEqual([]);
    const lines = Object.values(out).map((pts) => pts[1]!.y);
    expect(new Set(lines).size).toBe(6);
    for (const y of lines) expect(y).toBeLessThanOrEqual(card.y - 4);
  });

  it('hands out no track on a line the diagram rules itself', () => {
    const routes = Object.fromEntries(
      Array.from({ length: 2 }, (_, k) => [`e${k}`, [{ x: k * 10, y: 0 }, { x: k * 10, y: 100 }, { x: 300 + k * 10, y: 100 }, { x: 300 + k * 10, y: 300 }]]),
    );
    expect(nudge(routes, apart(['e0', 'e1'])).e1![1]!.y).toBe(108);
    expect(nudge(routes, apart(['e0', 'e1']), [], [108]).e1![1]!.y).toBe(92);
  });

  it("never turns a port run back into the edge's own card", () => {
    // The ninth track is 32px up: past the 20px run out of the card's bottom, and still MIN_RUN away from the port.
    const card = { x: -88, y: -60, width: 176, height: 60 };
    const others = Object.fromEntries(
      Array.from({ length: 8 }, (_, k) => [`o${k}`, [{ x: -100 - k * 10, y: -300 }, { x: -100 - k * 10, y: 20 }, { x: 400 + k * 10, y: 20 }, { x: 400 + k * 10, y: 300 }]]),
    );
    const routes = { ...others, own: [{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 200, y: 20 }, { x: 200, y: 100 }] };
    const out = nudge(routes, apart(Object.keys(routes)), [card]);
    expect(out.own![1]!.y).toBeGreaterThanOrEqual(12);
    expect(hits(out, card)).toEqual([]);
  });

  it("does not stretch a port run onto the port facing it on another card's edge", () => {
    // Two cards 44px apart: `down` leaves the upper one by x=88, `up` the lower one. The first track for `down` (+8)
    // would bring its run to y=88, over the run `up` comes in by (84..104).
    const cards = [{ x: 0, y: 0, width: 176, height: 60 }, { x: 0, y: 104, width: 176, height: 60 }];
    const routes = {
      first: [{ x: 200, y: -50 }, { x: 200, y: 80 }, { x: 400, y: 80 }, { x: 400, y: 300 }],
      down: [{ x: 88, y: 60 }, { x: 88, y: 80 }, { x: 300, y: 80 }, { x: 300, y: 300 }],
      up: [{ x: 88, y: 104 }, { x: 88, y: 84 }, { x: -100, y: 84 }, { x: -100, y: 300 }],
    };
    const out = nudge(routes, apart(Object.keys(routes)), cards);
    expect(out.down![1]!.y).toBeLessThan(out.up![1]!.y);
    expect(out.down![1]!.y).not.toBe(out.first![1]!.y);
  });
});
