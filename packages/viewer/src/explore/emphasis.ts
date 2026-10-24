import { TYPE_LABELS, type DiagramDraft, type DiagramNode, type NodeType } from '@stackmap/core';
import { reachable, routeBetween, type Graph } from './graph';
import type { ExploreState } from './state';

export type NodeEmphasis = 'focus' | 'normal' | 'dim';
export interface EdgeEmphasis {
  dim: boolean;
  /** source node type when the edge is part of the selection or trace (Q26), else null */
  tint: NodeType | null;
}
export interface Emphasis {
  /** anything dimmed or focused */
  active: boolean;
  nodes: Map<string, NodeEmphasis>;
  edges: Map<string, EdgeEmphasis>;
}

const haystack = (n: DiagramNode) => [n.card.title, n.card.subtitle ?? '', n.id, TYPE_LABELS[n.type]].join('\n').toLowerCase();

/** Substring search (no regex), title-prefix matches first, then document order. */
export function searchMatches(draft: DiagramDraft, query: string): DiagramNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits = draft.nodes.filter((n) => haystack(n).includes(q));
  const prefix = (n: DiagramNode) => (n.card.title.toLowerCase().startsWith(q) ? 0 : 1);
  return hits.map((n, i) => ({ n, i })).sort((a, b) => prefix(a.n) - prefix(b.n) || a.i - b.i).map((x) => x.n);
}

/** The explorer state emphasis reads; playback fields (playing, speed) and reveal don't change what's lit. */
export type EmphasisInput = Pick<ExploreState, 'peek' | 'view' | 'query' | 'trace' | 'selected' | 'route' | 'routing' | 'hiddenTypes'>;

export function emphasis(draft: DiagramDraft, graph: Graph, s: EmphasisInput): Emphasis {
  if (s.peek) return peekAt(draft, s.peek);
  const view = s.view ? new Set(draft.views?.find((v) => v.id === s.view)?.nodes ?? []) : null;
  const q = s.query?.trim() ? new Set(searchMatches(draft, s.query).map((n) => n.id)) : null;
  const trace = s.trace && s.selected && !s.route ? reachable(graph, s.selected) : null;
  // A route with no path still dims everything but its two ends.
  const route = s.route ? (routeBetween(graph, s.route.from, s.route.to) ?? { nodes: new Set([s.route.from, s.route.to]), edges: new Set<string>() }) : null;
  const ends = s.route ? new Set([s.route.from, s.route.to]) : s.routing?.next === 'to' ? new Set([s.routing.start]) : null;
  const typeOf = new Map(draft.nodes.map((n) => [n.id, n.type]));
  // A selection on its own keeps its neighbours lit; trace and route widen or replace that.
  const near =
    s.selected && !trace && !route
      ? new Set([s.selected, ...(graph.out.get(s.selected) ?? []).map((e) => graph.ends.get(e)!.to), ...(graph.in.get(s.selected) ?? []).map((e) => graph.ends.get(e)!.from)])
      : null;

  const nodes = new Map<string, NodeEmphasis>();
  for (const n of draft.nodes) {
    const excluded =
      (view && !view.has(n.id)) || s.hiddenTypes.has(n.type) || (q && !q.has(n.id)) || (trace && !trace.nodes.has(n.id)) || (route && !route.nodes.has(n.id)) || (near && !near.has(n.id));
    nodes.set(n.id, n.id === s.selected || ends?.has(n.id) ? 'focus' : excluded ? 'dim' : 'normal');
  }

  const edges = new Map<string, EdgeEmphasis>();
  for (const e of draft.edges) {
    const lit = route ? route.edges.has(e.id) : !!s.selected && (trace ? trace.edges.has(e.id) : e.from === s.selected || e.to === s.selected);
    const endDim = nodes.get(e.from) === 'dim' || nodes.get(e.to) === 'dim';
    edges.set(e.id, { dim: !lit && (endDim || !!trace || !!route || !!near), tint: lit ? (typeOf.get(e.from) ?? null) : null });
  }

  const active = !!s.selected || !!route || [...nodes.values()].some((v) => v !== 'normal');
  return { active, nodes, edges };
}

/** Only `type` lit: a legend row under the pointer, shown over whatever else is on. */
function peekAt(draft: DiagramDraft, type: NodeType): Emphasis {
  const nodes = new Map<string, NodeEmphasis>(draft.nodes.map((n) => [n.id, n.type === type ? 'normal' : 'dim']));
  const edges = new Map<string, EdgeEmphasis>(
    draft.edges.map((e) => [e.id, { dim: nodes.get(e.from) !== 'normal' || nodes.get(e.to) !== 'normal', tint: null }]),
  );
  return { active: true, nodes, edges };
}
