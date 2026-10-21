import { describe, expect, it } from 'vitest';
import { cardSize, type DiagramDraft, type DiagramNode, type Point, type Rect } from '@stackmap/core';
import { commerceApi, groupedPlatform } from '@stackmap/core/samples';
import { GROUP_LABEL_BAND, layoutDiagram } from '../src/index';
import { STRESS } from './stress';

const node = (id: string, extra: Partial<DiagramNode> = {}): DiagramNode => ({
  id,
  type: 'service',
  card: { title: id },
  ...extra,
});
const draft = (d: Partial<DiagramDraft>): DiagramDraft => ({ kind: 'architecture', title: 't', nodes: [], edges: [], ...d });
const rightMid = (r: Rect): Point => ({ x: r.x + r.width, y: r.y + r.height / 2 });
const leftMid = (r: Rect): Point => ({ x: r.x, y: r.y + r.height / 2 });
const near = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 0);
  expect(a.y).toBeCloseTo(b.y, 0);
};

describe('layoutDiagram', () => {
  it('places the target to the right and routes port to port', async () => {
    const out = await layoutDiagram(
      draft({ nodes: [node('a'), node('b')], edges: [{ id: 'e', from: 'a', to: 'b' }] }),
    );
    const a = out.nodes.a!;
    const b = out.nodes.b!;
    expect(b.x).toBeGreaterThan(a.x + a.width);
    const pts = out.edges.e!;
    near(pts[0]!, rightMid(a));
    near(pts[pts.length - 1]!, leftMid(b));
  });

  it('sizes every node with cardSize', async () => {
    const rich = node('r', { card: { title: 'r', rows: [{ label: 'x', value: 'y' }], cta: { label: 'go' } } });
    const out = await layoutDiagram(draft({ nodes: [rich] }));
    expect(out.nodes.r!.width).toBe(cardSize(rich.card).width);
    expect(out.nodes.r!.height).toBe(cardSize(rich.card).height);
  });

  it('routes every segment orthogonally', async () => {
    const out = await layoutDiagram(groupedPlatform);
    for (const [id, pts] of Object.entries(out.edges)) {
      for (let i = 1; i < pts.length; i++) {
        const axisAligned = Math.abs(pts[i]!.x - pts[i - 1]!.x) < 0.5 || Math.abs(pts[i]!.y - pts[i - 1]!.y) < 0.5;
        expect(axisAligned, `edge ${id} segment ${i}`).toBe(true);
      }
    }
  });

  it('keeps grouped nodes inside their group, below the label band, in absolute coordinates', async () => {
    const out = await layoutDiagram(groupedPlatform);
    for (const n of groupedPlatform.nodes.filter((n) => n.group)) {
      const r = out.nodes[n.id]!;
      const g = out.groups[n.group!]!;
      expect(r.x, n.id).toBeGreaterThanOrEqual(g.x);
      expect(r.y, n.id).toBeGreaterThanOrEqual(g.y + GROUP_LABEL_BAND - 1);
      expect(r.x + r.width, n.id).toBeLessThanOrEqual(g.x + g.width);
      expect(r.y + r.height, n.id).toBeLessThanOrEqual(g.y + g.height);
    }
  });

  it('fan-in converges on the target port', async () => {
    const out = await layoutDiagram(
      draft({
        nodes: [node('s1'), node('s2'), node('s3'), node('t')],
        edges: ['s1', 's2', 's3'].map((s) => ({ id: `${s}-t`, from: s, to: 't' })),
      }),
    );
    const target = leftMid(out.nodes.t!);
    for (const s of ['s1', 's2', 's3']) {
      const pts = out.edges[`${s}-t`]!;
      near(pts[pts.length - 1]!, target);
    }
  });

  it('stacks siblings fed from one source in draft order', async () => {
    const siblings = ['s1', 's2', 's3'];
    const out = await layoutDiagram(
      draft({
        nodes: [node('src'), ...siblings.map((s) => node(s)), node('t1'), node('t2')],
        edges: [
          ...siblings.map((s) => ({ id: `src-${s}`, from: 'src', to: s })),
          ...siblings.flatMap((s) => ['t1', 't2'].map((t) => ({ id: `${s}-${t}`, from: s, to: t }))),
        ],
      }),
    );
    const ys = siblings.map((s) => out.nodes[s]!.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it('keeps the Commerce API instances in draft order', async () => {
    const out = await layoutDiagram(commerceApi);
    const ys = [1, 2, 3].map((i) => out.nodes[`commerce-api-${i}`]!.y);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it('wraps a wide left-to-right diagram instead of laying it out as one long strip', async () => {
    const { width, height } = (await layoutDiagram({ ...groupedPlatform, direction: 'RIGHT' })).bounds;
    expect(width / height).toBeLessThanOrEqual(2.6);
  });

  it('keeps a short chain on one row', async () => {
    const out = await layoutDiagram(
      draft({ nodes: [node('a'), node('b'), node('c')], edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }] }),
    );
    expect(out.nodes.b!.y).toBe(out.nodes.a!.y);
    expect(out.nodes.c!.y).toBe(out.nodes.a!.y);
  });

  it('lays out top-down when direction is DOWN', async () => {
    const out = await layoutDiagram(
      draft({ direction: 'DOWN', nodes: [node('a'), node('b')], edges: [{ id: 'e', from: 'a', to: 'b' }] }),
    );
    expect(out.nodes.b!.y).toBeGreaterThan(out.nodes.a!.y + out.nodes.a!.height);
  });

  it('lays the grouped sample out top-down with every edge flowing downward', async () => {
    const out = await layoutDiagram(groupedPlatform);
    for (const [id, pts] of Object.entries(out.edges)) {
      expect(pts[pts.length - 1]!.y, id).toBeGreaterThan(pts[0]!.y);
    }
  });

  it('lays a reply out against the flow, so the caller stays upstream of what it calls', async () => {
    const out = await layoutDiagram(
      draft({
        direction: 'DOWN',
        groups: [{ id: 'ui', label: 'UI' }, { id: 'api', label: 'API' }],
        nodes: [node('api', { group: 'api' }), node('feed', { type: 'client', group: 'ui' }), node('picker', { type: 'client', group: 'ui' })],
        edges: [
          { id: 'send', from: 'picker', to: 'api' },
          { id: 'reply', from: 'api', to: 'feed', kind: 'return' },
        ],
      }),
    );
    expect(out.groups.ui!.y + out.groups.ui!.height).toBeLessThan(out.groups.api!.y);
    // The call drops straight in; the reply climbs back up from the callee's top to the caller's bottom.
    expect(out.edges.send!.length).toBeLessThanOrEqual(4);
    const reply = out.edges.reply!;
    expect(reply[0]!.y).toBeCloseTo(out.nodes.api!.y, 0);
    expect(reply.at(-1)!.y).toBeCloseTo(out.nodes.feed!.y + out.nodes.feed!.height, 0);
  });

  it('breaks a cycle at the edge that points back to where the flow started', async () => {
    const out = await layoutDiagram(
      draft({
        direction: 'DOWN',
        nodes: [node('a'), node('b'), node('c')],
        edges: [
          { id: 'ab', from: 'a', to: 'b' },
          { id: 'bc', from: 'b', to: 'c' },
          { id: 'ca', from: 'c', to: 'a', label: 'retry' },
        ],
      }),
    );
    expect(out.nodes.a!.y).toBeLessThan(out.nodes.b!.y);
    expect(out.nodes.b!.y).toBeLessThan(out.nodes.c!.y);
    // The back edge leaves c by its top and enters a by its bottom instead of wrapping round the diagram.
    const ca = out.edges.ca!;
    expect(ca[0]!.y).toBeCloseTo(out.nodes.c!.y, 0);
    expect(ca.at(-1)!.y).toBeCloseTo(out.nodes.a!.y + out.nodes.a!.height, 0);
  });

  it('gives edges of another tone or line style their own port', async () => {
    for (const direction of ['RIGHT', 'DOWN'] as const) {
      const out = await layoutDiagram(
        draft({
          direction,
          nodes: [node('hub'), node('plain'), node('m'), node('s'), node('q')],
          edges: [
            { id: 'plain', from: 'hub', to: 'plain', label: 'reads' },
            { id: 'main', from: 'hub', to: 'm', tone: 'main' as const },
            { id: 'sec', from: 'hub', to: 's', tone: 'security' as const },
            { id: 'async', from: 'hub', to: 'q', kind: 'async' as const },
          ],
        }),
      );
      const starts = Object.values(out.edges).map((pts) => `${pts[0]!.x},${pts[0]!.y}`);
      expect(new Set(starts).size, direction).toBe(starts.length);
    }
  });

  it('merges edges of one style into a shared trunk, labelled or not, with each label by its target', async () => {
    const targets = ['a', 'b', 'c', 'd'];
    const out = await layoutDiagram(
      draft({
        direction: 'DOWN',
        nodes: [node('hub'), ...targets.map((t) => node(t))],
        edges: targets.map((t, i) => ({ id: t, from: 'hub', to: t, ...(i % 2 ? { label: `to ${t}` } : {}) })),
      }),
    );
    const starts = Object.values(out.edges).map((pts) => `${pts[0]!.x},${pts[0]!.y}`);
    expect(new Set(starts).size).toBe(1);
    for (const t of ['b', 'd']) {
      const label = out.labels![t]!;
      const target = out.nodes[t]!;
      // Above its own target, not out on the shared bus.
      expect(label.x).toBeGreaterThan(target.x);
      expect(label.x).toBeLessThan(target.x + target.width);
      expect(label.y).toBeLessThan(target.y);
    }
  });

  it('top-aligns the cards of a row, whatever their heights', async () => {
    // In the hub, feed (a reply's target) and finisher are shorter than their row-mates and used to be centred on them.
    const out = await layoutDiagram(STRESS['hub-down']!);
    expect(out.nodes.feed!.y).toBe(out.nodes.picker!.y);
    expect(out.nodes.finisher!.y).toBe(out.nodes.pin!.y);
    expect(out.nodes.effort!.y).toBe(out.nodes.pin!.y);
  });

  it('is deterministic', async () => {
    expect(await layoutDiagram(groupedPlatform)).toEqual(await layoutDiagram(groupedPlatform));
  });

  it('lays out a diagram past the retry limit in one quick, sound pass', async () => {
    // 80 nodes in 8 groups with 240 edges: about 7s before large layouts took the cheap path, under 1s after.
    const nodes = Array.from({ length: 80 }, (_, i) => node(`n${i}`, { group: `g${i % 8}` }));
    const edges = [
      ...nodes.slice(1).map((n, i) => ({ id: `t${i}`, from: `n${Math.floor(i / 2)}`, to: n.id })),
      ...Array.from({ length: 161 }, (_, i) => ({ id: `x${i}`, from: `n${(i * 7) % 80}`, to: `n${(i * 13 + 5) % 80}` })),
    ].filter((e) => e.from !== e.to);
    const groups = Array.from({ length: 8 }, (_, i) => ({ id: `g${i}`, label: `G${i}` }));
    const started = performance.now();
    const out = await layoutDiagram(draft({ direction: 'RIGHT', groups, nodes, edges }));
    // CI runners are several times slower than a laptop (3-5s there); the old multi-pass path is still well past this.
    expect(performance.now() - started).toBeLessThan(15_000);
    // Wrapped rather than one long strip, and every card placed apart from the others.
    expect(out.bounds.width).toBeLessThan(out.bounds.height * 4);
    const rects = Object.values(out.nodes);
    expect(rects).toHaveLength(80);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const [a, b] = [rects[i]!, rects[j]!];
        expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
      }
    for (const e of edges) expect(out.edges[e.id]!.length).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it('lays out the largest diagram the schema allows without overflowing the stack', async () => {
    // 500 nodes and 2000 edges between random pairs, the schema's most: minutes with the small-diagram settings, and
    // ELK on Node's main thread threw "Maximum call stack size exceeded".
    // mulberry32: an LCG's low bits repeat too soon to make a graph this tangled.
    let seed = 2;
    const rand = (n: number) => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % n;
    };
    const nodes = Array.from({ length: 500 }, (_, i) => node(`n${i}`, { group: `g${i % 50}` }));
    const groups = Array.from({ length: 50 }, (_, i) => ({ id: `g${i}`, label: `G${i}` }));
    const seen = new Set<string>();
    const edges: { id: string; from: string; to: string; label?: string }[] = [];
    while (edges.length < 2000) {
      const [a, b] = [rand(500), rand(500)];
      if (a === b || seen.has(`${a}>${b}`)) continue;
      seen.add(`${a}>${b}`);
      edges.push({ id: `e${edges.length}`, from: `n${a}`, to: `n${b}`, ...(edges.length % 3 === 0 && { label: 'calls' }) });
    }
    const out = await layoutDiagram(draft({ direction: 'RIGHT', groups, nodes, edges }));
    expect(Object.keys(out.nodes)).toHaveLength(500);
    for (const e of edges) expect(out.edges[e.id]!.length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('rejects dangling references with a precise message', async () => {
    await expect(
      layoutDiagram(draft({ nodes: [node('a')], edges: [{ id: 'e1', from: 'a', to: 'ghost' }] })),
    ).rejects.toThrow("Edge 'e1' references unknown node 'ghost'");
    await expect(layoutDiagram(draft({ nodes: [node('a', { group: 'nope' })] }))).rejects.toThrow(
      "Node 'a' references unknown group 'nope'",
    );
  });
});
