import { describe, expect, it } from 'vitest';
import type { DiagramDraft, LaidOutDiagram, Point, Rect } from '@stackmap/core';
import { layoutDiagram } from '../src/index';
import { labelWidth } from '../src/labels';
import { layoutLanes } from '../src/lanes';

// Property test: random workflows and lifecycles (tones, returns, async, labels, tags, phases, groups, self-loops,
// parallel edges) must always lay out into geometry the viewer can draw honestly.

/** `dense`: a fixed node count with several edges a node, where channels fill up and nudging runs out of tracks. */
function generator(seed: number, dense?: { nodes: number; edges: number }) {
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
  return (): DiagramDraft => {
    const lanes = Array.from({ length: 2 + Math.floor(rnd() * 4) }, (_, i) => ({ id: `l${i}`, label: `Lane ${i}` }));
    const n = dense?.nodes ?? 3 + Math.floor(rnd() * 14);
    const lifecycle = rnd() < 0.3;
    const types = lifecycle ? (['start', 'active', 'waiting', 'decision', 'success', 'failure'] as const) : (['service', 'client', 'queue', 'security'] as const);
    const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, type: pick(types), lane: pick(lanes).id, card: { title: `N${i}`, ...(rnd() < 0.3 ? { tag: 'tag' } : {}) } }));
    const edges = Array.from({ length: dense?.edges ?? Math.floor(rnd() * n * 2) }, (_, i) => {
      const r = rnd();
      return {
        id: `e${i}`,
        from: pick(nodes).id,
        to: pick(nodes).id,
        ...(rnd() < 0.3 ? { label: pick(['ok', 'retry', 'needs approval', 'timeout']) } : {}),
        ...(r < 0.15 ? { kind: 'return' as const } : r < 0.3 ? { kind: 'async' as const } : {}),
        ...(rnd() < 0.4 ? { tone: pick(['main', 'security', 'error'] as const) } : {}),
      };
    });
    const d: DiagramDraft = { kind: lifecycle ? 'lifecycle' : 'workflow', title: 'fuzz', lanes, nodes, edges };
    if (rnd() < 0.4) {
      const per = Math.ceil(n / 3);
      d.phases = [0, 1, 2].map((i) => ({ id: `p${i}`, label: `P${i}`, nodes: nodes.slice(i * per, (i + 1) * per).map((x) => x.id) })).filter((p) => p.nodes.length);
    }
    return d;
  };
}

const inside = (p: Point, r: Rect) => p.x > r.x + 0.5 && p.x < r.x + r.width - 0.5 && p.y > r.y + 0.5 && p.y < r.y + r.height - 0.5;
const crosses = (a: Point, b: Point, r: Rect) =>
  Math.max(a.x, b.x) > r.x + 0.5 && Math.min(a.x, b.x) < r.x + r.width - 0.5 && Math.max(a.y, b.y) > r.y + 0.5 && Math.min(a.y, b.y) < r.y + r.height - 0.5;

/** Every label's pill lies inside the bounds the viewer sizes and fits the diagram by. */
function expectLabelsInside(d: DiagramDraft, out: LaidOutDiagram) {
  for (const e of d.edges) {
    const p = out.labels?.[e.id];
    if (!p || !e.label) continue;
    const half = labelWidth(e.label) / 2;
    expect(p.x - half >= 0 && p.y - 10 >= 0 && p.x + half <= out.bounds.width && p.y + 10 <= out.bounds.height, `label ${e.id} inside the diagram`).toBe(true);
  }
}

/** No segment of a route runs through a card, its own two aside where it leaves and arrives. */
function expectOffCards(d: DiagramDraft, out: LaidOutDiagram) {
  for (const e of d.edges) {
    const pts = out.edges[e.id]!;
    for (const [id, r] of Object.entries(out.nodes))
      for (let i = 1; i < pts.length; i++) {
        const own = (i === 1 && id === e.from) || (i === pts.length - 1 && id === e.to);
        if (!own) expect(crosses(pts[i - 1]!, pts[i]!, r), `${e.id} segment ${i} crosses ${id}`).toBe(false);
      }
  }
}

/** Port runs (card to first bend) of edges that share no card never lie over each other: that draws as one edge. */
function overlappingPortRuns(d: DiagramDraft, out: LaidOutDiagram): string[] {
  const runs = d.edges.flatMap((e) => {
    const pts = out.edges[e.id]!;
    return [
      { e, card: e.from, a: pts[0]!, b: pts[1]! },
      { e, card: e.to, a: pts.at(-1)!, b: pts.at(-2)! },
    ];
  });
  const hits: string[] = [];
  runs.forEach((p, i) => {
    for (const q of runs.slice(i + 1)) {
      if (p.card === q.card || p.e.from === q.e.from || p.e.to === q.e.to) continue;
      for (const [fixed, along] of [['x', 'y'], ['y', 'x']] as const) {
        if (p.a[fixed] !== p.b[fixed] || q.a[fixed] !== q.b[fixed] || Math.abs(p.a[fixed] - q.a[fixed]) >= 0.5) continue;
        const shared = Math.min(Math.max(p.a[along], p.b[along]), Math.max(q.a[along], q.b[along])) - Math.max(Math.min(p.a[along], p.b[along]), Math.min(q.a[along], q.b[along]));
        if (shared > 0.5) hits.push(`${p.e.id} × ${q.e.id}`);
      }
    }
  });
  return hits;
}

describe('lane layout properties', () => {
  const next = generator(20260930);
  const cases = Array.from({ length: 150 }, next);

  it.each(cases.map((d, i) => [i, d] as const))('random diagram %i lays out soundly', (_i, d) => {
    const out = layoutLanes(d);
    expect(Number.isFinite(out.bounds.width) && Number.isFinite(out.bounds.height)).toBe(true);
    // Columns stay dense: the diagram is never wider than one column per node.
    expect(out.bounds.width).toBeLessThan(144 + d.nodes.length * (176 + 176) + 200);
    const ports = new Map<string, Set<'in' | 'out'>>();
    expectOffCards(d, out);
    expect(overlappingPortRuns(d, out)).toEqual([]);
    // A first-row card's top stub ends on its lane's upper edge: no route turns there and runs along the edge.
    const tops = Object.values(out.lanes ?? {}).map((r) => r.y);
    for (const e of d.edges) {
      const pts = out.edges[e.id]!;
      for (let i = 1; i < pts.length; i++) expect(pts[i]!.x === pts[i - 1]!.x || pts[i]!.y === pts[i - 1]!.y, `${e.id} is orthogonal`).toBe(true);
      for (let i = 1; i < pts.length; i++) expect(pts[i]!.x !== pts[i - 1]!.x && tops.some((y) => Math.abs(y - pts[i]!.y) < 0.5), `${e.id} runs along a lane's edge`).toBe(false);
      for (const [role, p] of [['out', pts[0]!], ['in', pts.at(-1)!]] as const) {
        const key = `${p.x},${p.y}`;
        ports.set(key, (ports.get(key) ?? new Set()).add(role));
      }
    }
    // No point is both where an arrow arrives and where another edge leaves: that would read as two-way.
    expect([...ports].filter(([, roles]) => roles.size > 1).map(([k]) => k)).toEqual([]);
    for (const [id, p] of Object.entries(out.labels ?? {})) for (const [n, r] of Object.entries(out.nodes)) expect(inside(p, r), `label ${id} on ${n}`).toBe(false);
    expectLabelsInside(d, out);
  });
});

// Crowded diagrams: thirty cards with eight edges each fill the channels, so edges spread over many tracks beside them.
describe('crowded lane layouts', () => {
  const next = generator(4, { nodes: 30, edges: 240 });
  const cases = Array.from({ length: 3 }, next);

  it.each(cases.map((d, i) => [i, d] as const))('random diagram %i keeps every route off the cards', (_i, d) => {
    const out = layoutLanes(d);
    for (const e of d.edges) {
      const pts = out.edges[e.id]!;
      for (let i = 1; i < pts.length; i++) expect(pts[i]!.x === pts[i - 1]!.x || pts[i]!.y === pts[i - 1]!.y, `${e.id} is orthogonal`).toBe(true);
    }
    expectOffCards(d, out);
  }, 30_000);
});

// The same for architecture and dataflow (ELK): random groups (nested too), directions, compact cards, stages, tones,
// replies, async edges, labels, self-loops and parallel edges.
function elkGenerator(seed: number) {
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]!;
  return (): DiagramDraft => {
    const n = 2 + Math.floor(rnd() * 13);
    const groups = Array.from({ length: Math.floor(rnd() * 4) }, (_, i) => ({ id: `g${i}`, label: `Group ${i}`, ...(i > 0 && rnd() < 0.3 ? { parent: `g${i - 1}` } : {}) }));
    const staged = !groups.length && rnd() < 0.3;
    const nodes = Array.from({ length: n }, (_, i) => ({
      id: `n${i}`,
      type: pick(['service', 'client', 'database', 'queue', 'external', 'security'] as const),
      ...(groups.length && rnd() < 0.7 ? { group: pick(groups).id } : {}),
      card: { title: `N${i}`, rows: Array.from({ length: Math.floor(rnd() * 4) }, (_, j) => ({ label: `k${j}`, value: 'v' })) },
    }));
    const edges = Array.from({ length: Math.floor(rnd() * n * 1.8) }, (_, i) => {
      const r = rnd();
      return {
        id: `e${i}`,
        from: pick(nodes).id,
        to: pick(nodes).id,
        ...(rnd() < 0.5 ? { label: pick(['reads', 'writes pin', 'stream + metadata', 'gRPC', 'enqueue']) } : {}),
        ...(r < 0.15 ? { kind: 'return' as const } : r < 0.3 ? { kind: 'async' as const } : {}),
        ...(rnd() < 0.3 ? { tone: pick(['main', 'security', 'error'] as const) } : {}),
      };
    });
    const d: DiagramDraft = { kind: pick(['architecture', 'dataflow'] as const), title: 'fuzz', direction: pick(['RIGHT', 'DOWN'] as const), groups, nodes, edges };
    if (rnd() < 0.3) d.density = 'compact';
    if (staged) {
      const per = Math.ceil(n / 3);
      d.phases = [0, 1, 2].map((i) => ({ id: `p${i}`, label: `P${i}`, nodes: nodes.slice(i * per, (i + 1) * per).map((x) => x.id) })).filter((p) => p.nodes.length);
    }
    return d;
  };
}

describe('ELK layout properties', () => {
  const next = elkGenerator(20261003);
  const cases = Array.from({ length: 200 }, next);

  it.each(cases.map((d, i) => [i, d] as const))('random diagram %i lays out soundly', async (_i, d) => {
    const out = await layoutDiagram(d);
    expect(Number.isFinite(out.bounds.width) && Number.isFinite(out.bounds.height)).toBe(true);
    const ports = new Map<string, Set<string>>();
    for (const e of d.edges) {
      const pts = out.edges[e.id]!;
      expect(pts.length, e.id).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < pts.length; i++) expect(Math.abs(pts[i]!.x - pts[i - 1]!.x) < 0.5 || Math.abs(pts[i]!.y - pts[i - 1]!.y) < 0.5, `${e.id} is orthogonal`).toBe(true);
      if (e.from === e.to) continue;
      for (const [id, r] of Object.entries(out.nodes))
        for (let i = 1; i < pts.length; i++) {
          const own = (i === 1 && id === e.from) || (i === pts.length - 1 && id === e.to);
          if (!own) expect(crosses(pts[i - 1]!, pts[i]!, r), `${e.id} segment ${i} crosses ${id}`).toBe(false);
        }
      // A target wholly before or after its source along the flow is entered by the side facing it (same row only:
      // a wrapped layout carries forward edges back to the start of the next row).
      const [s, t] = [out.nodes[e.from]!, out.nodes[e.to]!];
      const end = pts.at(-1)!;
      if (d.direction === 'DOWN') {
        if (t.y + t.height <= s.y) expect(Math.abs(end.y - t.y - t.height) < 0.5, `${e.id} enters the bottom`).toBe(true);
        if (t.y >= s.y + s.height) expect(Math.abs(end.y - t.y) < 0.5, `${e.id} enters the top`).toBe(true);
      } else if (s.y < t.y + t.height && t.y < s.y + s.height) {
        if (t.x + t.width <= s.x) expect(Math.abs(end.x - t.x - t.width) < 0.5, `${e.id} enters the right`).toBe(true);
        if (t.x >= s.x + s.width) expect(Math.abs(end.x - t.x) < 0.5, `${e.id} enters the left`).toBe(true);
      }
      // Each end sits on its own card's border.
      for (const [id, p] of [[e.from, pts[0]!], [e.to, pts.at(-1)!]] as const) {
        const r = out.nodes[id]!;
        const onBorder = (Math.abs(p.x - r.x) < 0.5 || Math.abs(p.x - r.x - r.width) < 0.5 ? p.y >= r.y - 0.5 && p.y <= r.y + r.height + 0.5 : false) || (Math.abs(p.y - r.y) < 0.5 || Math.abs(p.y - r.y - r.height) < 0.5 ? p.x >= r.x - 0.5 && p.x <= r.x + r.width + 0.5 : false);
        expect(onBorder, `${e.id} ends on ${id}`).toBe(true);
      }
      const style = `${e.tone ?? ''}|${e.kind ?? 'sync'}`;
      for (const [role, node, p] of [['out', e.from, pts[0]!], ['in', e.to, pts.at(-1)!]] as const) {
        const key = `${node}@${p.x},${p.y}`;
        ports.set(key, (ports.get(key) ?? new Set()).add(`${role}:${style}`));
      }
    }
    // One look per port, and never an arrival where another edge leaves.
    expect([...ports].filter(([, styles]) => styles.size > 1).map(([k]) => k)).toEqual([]);
    for (const [id, p] of Object.entries(out.labels ?? {})) for (const [n, r] of Object.entries(out.nodes)) expect(inside(p, r), `label ${id} on ${n}`).toBe(false);
    expectLabelsInside(d, out);
  });
});
