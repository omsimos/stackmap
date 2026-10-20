import { CARD, COMPACT } from '@stackmap/core';
import { routeBetween, type Graph } from '../explore/graph';
import type { Emphasis } from '../explore/emphasis';
import type { ExploreState } from '../explore/state';
import { EDGE_RADIUS, type Scene } from '../canvas/scene';
import { hopFlow, hopRanks, NO_FLOW, roundedPolyline, waveFlow, type Flow, type FlowEdge } from './flow';

/** What a pulse needs from the scene: its drawn route, its tint, and what lights up when it lands. */
function flowEdges(scene: Scene): Map<string, FlowEdge> {
  const cards = new Map(scene.cards.map((c) => [c.node.id, c]));
  const radius = scene.compact ? COMPACT.radius : CARD.radius;
  return new Map(
    scene.edges.map((e) => {
      const end = e.points.at(-1);
      // A sequence lands on the activation bar the message opens or feeds (the innermost), else on the lifeline.
      const bar =
        scene.kind === 'sequence' && end
          ? scene.activations.filter((a) => a.node === e.to && end.y >= a.rect.y - 2 && end.y <= a.rect.y + a.rect.height + 2).sort((a, b) => b.depth - a.depth)[0]
          : undefined;
      const target = cards.get(e.to);
      const glow = scene.kind === 'sequence' ? (bar ? { rect: bar.rect, radius: 2, tint: bar.type } : null) : target ? { rect: target.rect, radius, tint: target.node.type } : null;
      const tint = e.tone === 'error' ? 'failure' : (cards.get(e.from)?.node.type ?? 'external');
      return [e.id, { id: e.id, from: e.from, to: e.to, kind: e.kind, tint, path: roundedPolyline(e.points, EDGE_RADIUS), glow }];
    }),
  );
}

/** Whether flowOf has anything to play: a route's or selection's lit connections, otherwise any edge left undimmed. */
export function hasFlow(state: Pick<ExploreState, 'route' | 'selected'>, em: Emphasis): boolean {
  const edges = [...em.edges.values()];
  return state.route || state.selected ? edges.some((e) => e.tint) : edges.some((e) => !e.dim);
}

/**
 * The flow that plays is whatever the explorer is showing: a route runs hop by hop from its start, a selection
 * (traced or not) runs through its lit connections, and otherwise everything not dimmed (by a view, the lens or
 * a search) plays: a wave in reading order, or a sequence's messages replayed one after another.
 */
export function flowOf(scene: Scene, graph: Graph, state: Pick<ExploreState, 'route' | 'selected'>, em: Emphasis): Flow {
  const edges = flowEdges(scene);
  const pick = (ids: string[]) => ids.flatMap((id) => edges.get(id) ?? []);
  const lit = scene.edges.filter((e) => em.edges.get(e.id)?.tint).map((e) => e.id);
  const serial = graph.timed;
  if (state.route) {
    const route = routeBetween(graph, state.route.from, state.route.to);
    if (!route) return NO_FLOW;
    // A reversed route's `from` is already the end it really runs from.
    return hopFlow(pick(lit), hopRanks(graph, new Set(lit), { start: route.from, fallback: route.from }), { serial });
  }
  if (state.selected) return hopFlow(pick(lit), hopRanks(graph, new Set(lit), { fallback: state.selected }), { serial });
  const shown = scene.edges.filter((e) => !em.edges.get(e.id)?.dim).map((e) => e.id);
  if (serial) return hopFlow(pick(shown), hopRanks(graph, new Set(shown), { fallback: '' }), { serial });
  const rect = new Map(scene.cards.map((c) => [c.node.id, c.rect]));
  const at = (id: string) => {
    const r = rect.get(id);
    return r ? (scene.direction === 'RIGHT' ? r.x : r.y) : 0;
  };
  return waveFlow(pick(shown).map((e) => ({ ...e, at: at(e.from) })));
}
