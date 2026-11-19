import { NODE_TYPES, type NodeType } from '@stackmap/core';

export interface ExploreState {
  selected: string | null;
  /** null = search closed; '' = open, nothing typed */
  query: string | null;
  hiddenTypes: ReadonlySet<NodeType>;
  /** a legend row under the pointer: only that type stays lit while it is (never in the hash) */
  peek: NodeType | null;
  /** what a card click does and what a selection lights: one at a time */
  mode: Mode;
  /** null = Overview */
  view: string | null;
  /** bumped when a selection should also move the camera (search, deep link) */
  reveal: number;
  /** flow playback (P): pulses run along whatever is shown */
  playing: boolean;
  /** how fast the flow plays, against its 1× timing */
  speed: Speed;
}

/**
 * The explorer's modes. `neighbours` is the default; `trace` (the Trace button, T on the website) and the route
 * (R) each replace it and each other. A route walks pickStart → pickEnd → route: card clicks pick the ends, and
 * a click on a card once it's shown leaves it for that card. `clear` (Escape) and R again end a route; trace
 * stays on until toggled off.
 *
 * - neighbours: a selection lights its direct connections
 * - trace: a selection lights everything upstream and downstream of it
 * - pickStart / pickEnd: waiting for the route's start, then its end (the start stays lit)
 * - route: the paths from `from` to `to` are lit (only this one is in the hash)
 */
export type Mode =
  | { kind: 'neighbours' }
  | { kind: 'trace' }
  | { kind: 'pickStart' }
  | { kind: 'pickEnd'; from: string }
  | { kind: 'route'; from: string; to: string };

export type ShownRoute = Extract<Mode, { kind: 'route' }>;

const NEIGHBOURS: Mode = { kind: 'neighbours' };

/** Picking a route's ends or showing one: the route owns the emphasis and Escape ends it from any control. */
export const isRouting = (m: Mode): boolean => m.kind === 'pickStart' || m.kind === 'pickEnd' || m.kind === 'route';

/** The route on screen, once both ends are picked. The mode itself, so it keeps its identity across renders. */
export const routeOf = (m: Mode): ShownRoute | null => (m.kind === 'route' ? m : null);

export const SPEEDS = [0.5, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];

export const INITIAL: ExploreState = {
  selected: null,
  query: null,
  hiddenTypes: new Set(),
  peek: null,
  mode: NEIGHBOURS,
  view: null,
  reveal: 0,
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
    case 'select': {
      const { mode } = s;
      // While picking a route, a card click picks an end; a click on empty canvas, or on the start again, keeps picking.
      if (mode.kind === 'pickStart') return a.id === null ? s : { ...s, selected: null, mode: { kind: 'pickEnd', from: a.id } };
      if (mode.kind === 'pickEnd') {
        return a.id === null || a.id === mode.from ? s : { ...s, selected: null, mode: { kind: 'route', from: mode.from, to: a.id } };
      }
      const reveal = a.reveal ? s.reveal + 1 : s.reveal;
      // Selecting a card while a route is shown leaves the route for that card's details (null keeps the route).
      if (mode.kind === 'route' && a.id !== null) return { ...s, mode: NEIGHBOURS, selected: a.id, reveal };
      return { ...s, selected: a.id, reveal };
    }
    case 'clear':
      return { ...s, selected: null, query: null, mode: isRouting(s.mode) ? NEIGHBOURS : s.mode };
    case 'toggleRoute':
      return isRouting(s.mode) ? { ...s, mode: NEIGHBOURS } : { ...s, selected: null, mode: { kind: 'pickStart' } };
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
      // A route owns the emphasis while it is picked or shown.
      if (isRouting(s.mode)) return s;
      return { ...s, mode: s.mode.kind === 'trace' ? NEIGHBOURS : { kind: 'trace' } };
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
  const mode: Mode = from && to && from !== to && known.nodes.has(from) && known.nodes.has(to) ? { kind: 'route', from, to } : NEIGHBOURS;
  const lens = (params.get('lens') ?? '')
    .split(',')
    .filter((t): t is NodeType => (NODE_TYPES as readonly string[]).includes(t) && known.types.has(t as NodeType));
  return {
    ...INITIAL,
    view: view && known.views.has(view) ? view : null,
    selected: node && known.nodes.has(node) ? node : null,
    reveal: node && known.nodes.has(node) ? 1 : 0,
    hiddenTypes: new Set(lens),
    mode,
    playing: params.get('play') === '1',
    speed: SPEEDS.find((v) => String(v) === params.get('speed')) ?? 1,
  };
}

export function formatHash(s: ExploreState): string {
  const parts: string[] = [];
  if (s.view) parts.push(`view=${encodeURIComponent(s.view)}`);
  if (s.selected) parts.push(`node=${encodeURIComponent(s.selected)}`);
  if (s.hiddenTypes.size) parts.push(`lens=${[...s.hiddenTypes].sort().join(',')}`);
  const route = routeOf(s.mode);
  if (route) parts.push(`route=${encodeURIComponent(route.from)}~${encodeURIComponent(route.to)}`);
  if (s.playing) parts.push('play=1');
  if (s.speed !== 1) parts.push(`speed=${s.speed}`);
  return parts.length ? `#${parts.join('&')}` : '';
}
