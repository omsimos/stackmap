import { describe, expect, it } from 'vitest';
import { isLaneKind, type Point, type Rect } from '@stackmap/core';
import { layoutDiagram } from '../src/index';
import { CORPUS } from './corpus';

// Properties that keep a layout readable whatever the author draws: these failed on real diagrams before (a hub's
// calls of every colour merged into one trunk, a reply pushing the client below the API, an entry call wrapping round
// the whole picture to come in from the far side).

const laid = await Promise.all(CORPUS.filter(([, d]) => !isLaneKind(d.kind)).map(async ([name, d]) => [name, d, await layoutDiagram(d)] as const));

const length = (pts: Point[]) => pts.slice(1).reduce((s, b, i) => s + Math.abs(b.x - pts[i]!.x) + Math.abs(b.y - pts[i]!.y), 0);
const centre = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

describe.each(laid)('layout quality of %s', (_name, draft, out) => {
  it('never lets edges that look different share a port', () => {
    const at = new Map<string, Set<string>>();
    for (const e of draft.edges) {
      const pts = out.edges[e.id]!;
      const style = `${e.tone ?? ''}|${e.kind ?? 'sync'}`;
      for (const [node, p, role] of [
        [e.from, pts[0]!, 'out'],
        [e.to, pts.at(-1)!, 'in'],
      ] as const) {
        const key = `${node}@${p.x},${p.y}`;
        at.set(key, (at.get(key) ?? new Set()).add(`${role}:${style}`));
      }
    }
    for (const [port, styles] of at) expect([...styles], port).toHaveLength(1);
  });

  it('brings every edge into its target by the side that faces its source', () => {
    const horizontal = (draft.direction ?? 'RIGHT') === 'RIGHT';
    for (const e of draft.edges) {
      if (e.from === e.to) continue;
      const [s, t] = [out.nodes[e.from]!, out.nodes[e.to]!];
      const end = out.edges[e.id]!.at(-1)!;
      if (horizontal) {
        // Same row only: a wrapped layout carries forward edges back to the start of the next row.
        const sameRow = s.y < t.y + t.height && t.y < s.y + s.height;
        if (sameRow && t.x + t.width <= s.x) expect(near(end.x, t.x + t.width), `${e.id} enters its right side`).toBe(true);
        if (sameRow && t.x >= s.x + s.width) expect(near(end.x, t.x), `${e.id} enters its left side`).toBe(true);
      } else {
        // Same column only, for the same reason.
        const sameColumn = s.x < t.x + t.width && t.x < s.x + s.width;
        if (sameColumn && t.y + t.height <= s.y) expect(near(end.y, t.y + t.height), `${e.id} enters its bottom`).toBe(true);
        if (sameColumn && t.y >= s.y + s.height) expect(near(end.y, t.y), `${e.id} enters its top`).toBe(true);
      }
    }
  });

  it('runs every segment along an axis', () => {
    for (const [id, pts] of Object.entries(out.edges)) {
      pts.slice(1).forEach((b, i) => expect(pts[i]!.x === b.x || pts[i]!.y === b.y, `${id} segment ${i}`).toBe(true));
    }
  });

  // Archetypal noise: two ports a few px out of line drawn as a step instead of one straight line.
  it('draws no shallow step between ports that could line up', () => {
    for (const [id, pts] of Object.entries(out.edges)) {
      if (pts.length !== 4) continue;
      const step = pts[1]!.x === pts[2]!.x ? Math.abs(pts[1]!.y - pts[2]!.y) : Math.abs(pts[1]!.x - pts[2]!.x);
      expect(step, id).not.toBeLessThan(16);
    }
  });

  it('takes no long detours', () => {
    for (const e of draft.edges) {
      if (e.from === e.to) continue;
      const [a, b] = [centre(out.nodes[e.from]!), centre(out.nodes[e.to]!)];
      const direct = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      expect(length(out.edges[e.id]!), e.id).toBeLessThanOrEqual(2.5 * direct + 300);
    }
  });
});
