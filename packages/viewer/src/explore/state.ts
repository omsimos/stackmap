import { NODE_TYPES, type NodeType } from '@stackmap/core';

export interface ExploreState {
  selected: string | null;
  /** null = search closed; '' = open, nothing typed */
  query: string | null;
  hiddenTypes: ReadonlySet<NodeType>;
  /** a legend row under the pointer: only that type stays lit while it is (never in the hash) */
  peek: NodeType | null;
  trace: boolean;
  /** null = Overview */
  view: string | null;
  /** bumped when a selection should also move the camera (search, deep link) */
  reveal: number;
  /** a route between two nodes (R), once both ends are picked */
  route: { from: string; to: string } | null;
  /** picking a route's ends: the start is next (`from`), or the end after `start` */
  routing: { next: 'from' } | { next: 'to'; start: string } | null;
  /** flow playback (P): pulses run along whatever is shown */
  playing: boolean;
  /** how fast the flow plays, against its 1× timing */
  speed: Speed;
}

export const SPEEDS = [0.5, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];

export const INITIAL: ExploreState = {
  selected: null,
  query: null,
  hiddenTypes: new Set(),
  peek: null,
  trace: false,
  view: null,
  reveal: 0,
  route: null,
  routing: null,
  playing: false,
  speed: 1,
};

export type ExploreAction =
  | { type: 'select'; id: string | null; reveal?: boolean }
  | { type: 'clear' }
  | { type: 'search'; query: string | null }
  | { type: 'toggleType'; nodeType: NodeType }
  | { type: 'showAllTypes' }
  | { type: 'peek'; nodeType: NodeType | null }
  | { type: 'toggleTrace' }
  | { type: 'view'; id: string | null }
  | { type: 'toggleRoute' }
  | { type: 'togglePlay' }
  | { type: 'cycleSpeed' }
  | { type: 'replace'; state: ExploreState };

export function explore(s: ExploreState, a: ExploreAction): ExploreState {
  switch (a.type) {
    case 'select':
      // While picking a route, a card click picks an end; a click on empty canvas keeps picking.
      if (s.routing) {
        // Picking the start again isn't an end: keep waiting for the other node.
        if (a.id === null || (s.routing.next === 'to' && a.id === s.routing.start)) return s;
        if (s.routing.next === 'from') return { ...s, selected: null, routing: { next: 'to', start: a.id } };
        return { ...s, selected: null, routing: null, route: { from: s.routing.start, to: a.id }, reveal: s.reveal };
      }
      // Selecting a card while a route is shown leaves the route for that card's details (null keeps the route).
      if (s.route && a.id !== null) return { ...s, route: null, selected: a.id, reveal: a.reveal ? s.reveal + 1 : s.reveal };
      return { ...s, selected: a.id, reveal: a.reveal ? s.reveal + 1 : s.reveal };
    case 'clear':
      return { ...s, selected: null, query: null, route: null, routing: null };
    case 'toggleRoute':
      return s.routing || s.route ? { ...s, routing: null, route: null } : { ...s, selected: null, trace: false, routing: { next: 'from' } };
    case 'search':
      return { ...s, query: a.query };
    case 'toggleType': {
      const hidden = new Set(s.hiddenTypes);
      if (!hidden.delete(a.nodeType)) hidden.add(a.nodeType);
      return { ...s, hiddenTypes: hidden };
    }
    case 'showAllTypes':
      return s.hiddenTypes.size ? { ...s, hiddenTypes: new Set() } : s;
    case 'peek':
      return { ...s, peek: a.nodeType };
    case 'toggleTrace':
      // A route owns the emphasis while it is shown.
      return s.route || s.routing ? s : { ...s, trace: !s.trace };
    case 'view':
      return { ...s, view: a.id };
    case 'togglePlay':
      return { ...s, playing: !s.playing };
    case 'cycleSpeed':
      return { ...s, speed: SPEEDS[(SPEEDS.indexOf(s.speed) + 1) % SPEEDS.length]! };
    case 'replace':
      return a.state;
  }
}

export interface Known {
  nodes: ReadonlySet<string>;
  views: ReadonlySet<string>;
  types: ReadonlySet<NodeType>;
}

/** Deep link state; ids the diagram doesn't have are dropped rather than trusted. */
export function parseHash(hash: string, known: Known): ExploreState {
  // URLSearchParams decodes each value and tolerates malformed escapes, so junk never throws.
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const view = params.get('view');
  const node = params.get('node');
  const [from, to] = (params.get('route') ?? '').split('~');
  const route = from && to && from !== to && known.nodes.has(from) && known.nodes.has(to) ? { from, to } : null;
  const lens = (params.get('lens') ?? '')
    .split(',')
    .filter((t): t is NodeType => (NODE_TYPES as readonly string[]).includes(t) && known.types.has(t as NodeType));
  return {
    ...INITIAL,
    view: view && known.views.has(view) ? view : null,
    selected: node && known.nodes.has(node) ? node : null,
    reveal: node && known.nodes.has(node) ? 1 : 0,
    hiddenTypes: new Set(lens),
    route,
    playing: params.get('play') === '1',
    speed: SPEEDS.find((v) => String(v) === params.get('speed')) ?? 1,
  };
}

export function formatHash(s: ExploreState): string {
  const parts: string[] = [];
  if (s.view) parts.push(`view=${encodeURIComponent(s.view)}`);
  if (s.selected) parts.push(`node=${encodeURIComponent(s.selected)}`);
  if (s.hiddenTypes.size) parts.push(`lens=${[...s.hiddenTypes].sort().join(',')}`);
  if (s.route) parts.push(`route=${encodeURIComponent(s.route.from)}~${encodeURIComponent(s.route.to)}`);
  if (s.playing) parts.push('play=1');
  if (s.speed !== 1) parts.push(`speed=${s.speed}`);
  return parts.length ? `#${parts.join('&')}` : '';
}
