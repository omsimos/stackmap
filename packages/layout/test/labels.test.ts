import { describe, expect, it } from 'vitest';
import { polylineMidpoint, type DiagramDraft, type LaidOutDiagram, type Point, type Rect } from '@stackmap/core';
import { labelWidth, placeLabels } from '../src/labels';
import { layoutDiagram } from '../src/index';
import { CORPUS } from './corpus';
import { STRESS } from './stress';

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** Whether an axis-aligned segment runs through the rectangle's interior. */
const crosses = (a: Point, b: Point, r: Rect) =>
  Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height;

const laid = await Promise.all(CORPUS.map(async ([name, d]) => [name, d, await layoutDiagram(d)] as const));

/** Each label's pill where the viewer draws it: the layout's spot, else the route's midpoint. */
function pills(draft: DiagramDraft, out: LaidOutDiagram): { id: string; rect: Rect }[] {
  return draft.edges
    .filter((e) => e.label && out.edges[e.id])
    .map((e) => {
      const p = out.labels?.[e.id] ?? polylineMidpoint(out.edges[e.id]!);
      const w = labelWidth(e.label!);
      return { id: e.id, rect: { x: p.x - w / 2, y: p.y - 10, width: w, height: 20 } };
    });
}

describe.each(laid)('edge labels in %s', (_name, draft, out) => {
  const all = pills(draft, out);

  it('places every label', () => {
    for (const p of all) expect(out.labels?.[p.id], p.id).toBeDefined();
  });

  it('keeps labels off each other and off the cards', () => {
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) expect(overlap(all[i]!.rect, all[j]!.rect), `${all[i]!.id} × ${all[j]!.id}`).toBe(false);
      for (const [n, r] of Object.entries(out.nodes)) expect(overlap(all[i]!.rect, r), `${all[i]!.id} on ${n}`).toBe(false);
    }
  });

  it("keeps labels off other edges' lines", () => {
    for (const p of all) {
      for (const [id, pts] of Object.entries(out.edges)) {
        if (id === p.id) continue;
        const hit = pts.slice(1).some((b, i) => crosses(pts[i]!, b, p.rect));
        expect(hit, `${p.id} over ${id}`).toBe(false);
      }
    }
  });
});

/** Distance from a point to a polyline. */
const distance = (p: Point, pts: Point[]) =>
  Math.min(
    ...pts.slice(1).map((b, i) => {
      const a = pts[i]!;
      const x = Math.max(Math.min(a.x, b.x), Math.min(p.x, Math.max(a.x, b.x)));
      const y = Math.max(Math.min(a.y, b.y), Math.min(p.y, Math.max(a.y, b.y)));
      return Math.hypot(p.x - x, p.y - y);
    }),
  );
/** Length of a polyline up to the point on it nearest `p`, as a share of its whole length. */
function along(p: Point, pts: Point[]): number {
  let total = 0;
  let best = { d: Infinity, at: 0 };
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!];
    const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const x = Math.max(Math.min(a.x, b.x), Math.min(p.x, Math.max(a.x, b.x)));
    const y = Math.max(Math.min(a.y, b.y), Math.min(p.y, Math.max(a.y, b.y)));
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < best.d) best = { d, at: total + Math.abs(x - a.x) + Math.abs(y - a.y) };
    total += len;
  }
  return best.at / total;
}

describe.each(laid)('edge label legibility in %s', (_name, draft, out) => {
  const all = pills(draft, out);

  it('keeps labels off group frames and their titles', () => {
    for (const p of all) {
      for (const [id, g] of Object.entries(out.groups)) {
        const border = [
          { x: g.x, y: g.y },
          { x: g.x + g.width, y: g.y },
          { x: g.x + g.width, y: g.y + g.height },
          { x: g.x, y: g.y + g.height },
          { x: g.x, y: g.y },
        ];
        expect(border.slice(1).some((b, i) => crosses(border[i]!, b, p.rect)), `${p.id} on the frame of ${id}`).toBe(false);
        expect(overlap(p.rect, { x: g.x, y: g.y, width: Math.min(g.width, 160), height: 28 }), `${p.id} on the title of ${id}`).toBe(false);
      }
    }
  });

  it('puts every label nearer its own edge than any other', () => {
    for (const p of all) {
      const c = { x: p.rect.x + p.rect.width / 2, y: p.rect.y + 10 };
      const own = distance(c, out.edges[p.id]!);
      for (const [id, pts] of Object.entries(out.edges)) if (id !== p.id) expect(distance(c, pts), `${p.id} nearer ${id}`).toBeGreaterThanOrEqual(own);
    }
  });
});

describe('labels beside a trunk', () => {
  // Two calls into one card at the right merge into a trunk along y=120; each comes down or up a run of its own first.
  const b = [{ x: 100, y: 240 }, { x: 100, y: 120 }, { x: 800, y: 120 }];

  it('go on a run the edge has to itself, where they name one edge, not beside the shared one', () => {
    const a = [{ x: 0, y: 0 }, { x: 0, y: 120 }, { x: 800, y: 120 }];
    const { labels } = placeLabels([{ id: 'a', label: 'reads state' }], { a, b }, []);
    expect(distance(labels.a!, b)).toBeGreaterThan(distance(labels.a!, a));
  });

  it('stay off the shared run even where it turns out of a run of their own', () => {
    const a = [{ x: 614, y: 384 }, { x: 614, y: 408 }, { x: 294, y: 408 }, { x: 294, y: 456 }];
    const trunk = [{ x: 294, y: 176 }, { x: 294, y: 456 }];
    const { labels } = placeLabels([{ id: 'a', label: 'lookup', from: 'x', to: 'z' }, { id: 'p', from: 'x', to: 'p' }, { id: 'q', from: 'x', to: 'q' }], { a, trunk }, []);
    expect(labels.a!.y).toBe(408);
  });

  it('still sit beside the shared run when the edge has no other with room', () => {
    const a = [{ x: 90, y: 120 }, { x: 800, y: 120 }];
    const { labels, unseated } = placeLabels([{ id: 'a', label: 'reads state' }], { a, b }, []);
    expect(labels.a!.y).not.toBe(120);
    expect(unseated).toBe(0);
  });
});

describe('labels by a group frame', () => {
  it("stay off a title longer than the frame's default strip", () => {
    // The run crosses the title band; the route midpoint sits past 160px but still under a 300px title.
    const a = [{ x: 100, y: 24 }, { x: 440, y: 24 }];
    const frame = { rect: { x: -40, y: -40, width: 700, height: 300 }, band: 100 };
    const pill = (labels: Record<string, Point>) => labels.a!.x - labelWidth('ok') / 2;
    expect(pill(placeLabels([{ id: 'a', label: 'ok' }], { a }, [], false, [frame]).labels)).toBeLessThan(300);
    expect(pill(placeLabels([{ id: 'a', label: 'ok' }], { a }, [], false, [{ ...frame, title: 340 }]).labels)).toBeGreaterThanOrEqual(300);
  });
});

describe('labels on a fan-out', () => {
  it('sit on the far half of each edge, by the card they name, not by the shared source', async () => {
    for (const name of ['hub-down', 'hub-right'] as const) {
      const d = STRESS[name]!;
      const out = await layoutDiagram(d);
      for (const e of d.edges.filter((e) => e.from === 'handler' && e.label && e.kind !== 'return')) {
        expect(along(out.labels![e.id]!, out.edges[e.id]!), `${name} ${e.id}`).toBeGreaterThanOrEqual(0.5);
      }
    }
  });
});
