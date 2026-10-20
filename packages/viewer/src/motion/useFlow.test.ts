import { describe, expect, it } from 'vitest';
import { CARD, type DiagramDraft } from '@stackmap/core';
import { emphasis } from '../explore/emphasis';
import { buildGraph } from '../explore/graph';
import { INITIAL, type ExploreState } from '../explore/state';
import type { Scene } from '../canvas/scene';
import { FLOW, travelFor } from './flow';
import { hasFlow } from './flowOf';
import { flowOf } from './useFlow';

//   a ─► b ─► c      d ─► b      c ─► a (error tone)
const draft: DiagramDraft = {
  kind: 'architecture',
  title: 't',
  nodes: ['a', 'b', 'c', 'd'].map((id) => ({ id, type: id === 'd' ? 'client' : 'service', card: { title: id } })),
  edges: [
    { id: 'ab', from: 'a', to: 'b' },
    { id: 'bc', from: 'b', to: 'c' },
    { id: 'db', from: 'd', to: 'b', kind: 'async' },
  ],
  views: [{ id: 'tail', label: 'Tail', nodes: ['b', 'c'] }],
};
const x = { a: 0, d: 0, b: 300, c: 600 } as Record<string, number>;
const scene = {
  kind: 'architecture',
  direction: 'RIGHT',
  compact: false,
  activations: [],
  cards: draft.nodes.map((node) => ({ node, rect: { x: x[node.id]!, y: 0, width: 100, height: 50 } })),
  edges: draft.edges.map((e) => ({ ...e, kind: e.kind ?? 'sync', points: [{ x: x[e.from]! + 100, y: 25 }, { x: x[e.to]!, y: 25 }] })),
} as unknown as Scene;
const graph = buildGraph(draft.nodes.map((n) => n.id), draft.edges);
const flow = (s: Partial<ExploreState>) => {
  const state = { ...INITIAL, ...s };
  return flowOf(scene, graph, state, emphasis(draft, graph, state));
};
const delays = (s: Partial<ExploreState>) => Object.fromEntries(flow(s).pulses.map((p) => [p.id, p.delay]));
// Every edge here is 200px between cards.
const hop = travelFor(200);

describe('which flow plays', () => {
  it('plays everything as a wave in reading order when nothing is focused', () => {
    expect(delays({})).toEqual({ ab: 0, db: 0, bc: FLOW.wave });
  });

  it('plays only what a view shows', () => {
    expect(delays({ view: 'tail' })).toEqual({ bc: 0 });
  });

  it('plays a route hop by hop from its start', () => {
    expect(delays({ route: { from: 'a', to: 'c' } })).toEqual({ ab: 0, bc: hop });
    // No path forward: it runs from the far end back.
    expect(delays({ route: { from: 'c', to: 'a' } })).toEqual({ ab: 0, bc: hop });
    expect(delays({ route: { from: 'a', to: 'd' } })).toEqual({});
  });

  it("plays a selection's connections, and its whole trace when tracing", () => {
    expect(delays({ selected: 'c' })).toEqual({ bc: 0 });
    expect(delays({ selected: 'c', trace: true })).toEqual({ ab: 0, db: 0, bc: hop });
  });

  it('tints each pulse by its source, keeps its kind, and lands on the target card', () => {
    const byId = Object.fromEntries(flow({}).pulses.map((p) => [p.id, p]));
    expect(byId.db).toMatchObject({ tint: 'client', kind: 'async', glow: { rect: { x: 300, y: 0, width: 100, height: 50 }, radius: CARD.radius, tint: 'service' } });
    expect(byId.ab!.tint).toBe('service');
  });
});

describe('whether there is a flow to play', () => {
  const playable = (s: Partial<ExploreState>) => {
    const state = { ...INITIAL, ...s };
    return hasFlow(state, emphasis(draft, graph, state));
  };

  it('agrees with flowOf: something plays exactly when it says so', () => {
    const cases: Partial<ExploreState>[] = [
      {},
      { hiddenTypes: new Set(['service', 'client'] as const) },
      { selected: 'a' },
      { route: { from: 'a', to: 'c' } },
      { route: { from: 'c', to: 'd' } },
    ];
    for (const s of cases) expect(playable(s), JSON.stringify(s)).toBe(flow(s).pulses.length > 0);
  });

  it('has nothing to play once the lens hides every type', () => {
    expect(playable({ hiddenTypes: new Set(['service', 'client'] as const) })).toBe(false);
    expect(playable({})).toBe(true);
  });
});
