import type { Rect } from '@stackmap/core';

export interface Graph {
  /** edge ids by source node */
  out: Map<string, string[]>;
  /** edge ids by target node */
  in: Map<string, string[]>;
  ends: Map<string, { from: string; to: string }>;
  /** edge ids in authored order (a sequence's time order) */
  order: string[];
  /** replies and roll-backs (`kind: "return"`) */
  returns: Set<string>;
  /** a sequence: routes must follow time */
  timed: boolean;
}

export function buildGraph(nodeIds: string[], edges: { id: string; from: string; to: string; kind?: string }[], { timed = false } = {}): Graph {
  const out = new Map(nodeIds.map((id) => [id, [] as string[]]));
  const inn = new Map(nodeIds.map((id) => [id, [] as string[]]));
  const ends = new Map<string, { from: string; to: string }>();
  for (const e of edges) {
    if (!out.has(e.from) || !inn.has(e.to)) continue;
    out.get(e.from)!.push(e.id);
    inn.get(e.to)!.push(e.id);
    ends.set(e.id, { from: e.from, to: e.to });
  }
  const known = edges.filter((e) => ends.has(e.id));
  return { out, in: inn, ends, order: known.map((e) => e.id), returns: new Set(known.filter((e) => e.kind === 'return').map((e) => e.id)), timed };
}

/** The node plus everything upstream of it and everything downstream of it (not sideways). */
export function reachable(g: Graph, start: string): { nodes: Set<string>; edges: Set<string> } {
  const nodes = new Set([start]);
  const edges = new Set<string>();
  const walk = (dir: 'out' | 'in') => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of g[dir].get(id) ?? []) {
        edges.add(e);
        const next = dir === 'out' ? g.ends.get(e)!.to : g.ends.get(e)!.from;
        if (seen.has(next)) continue;
        seen.add(next);
        nodes.add(next);
        queue.push(next);
      }
    }
  };
  walk('out');
  walk('in');
  return { nodes, edges };
}

export interface Route {
  from: string;
  to: string;
  /** every node and edge on some directed path from `from` to `to` */
  nodes: Set<string>;
  edges: Set<string>;
  /** one shortest path, as the edges taken in order */
  steps: string[];
  /** no path ran from → to, so this is the one from `to` back to `from` */
  reversed: boolean;
}

/** Everything reached from `start`; `stop` is reached but never walked through. */
function walk(g: Graph, start: string, dir: 'out' | 'in', use: (e: string) => boolean, stop: string): Set<string> {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === stop) continue;
    for (const e of g[dir].get(id) ?? []) {
      if (!use(e)) continue;
      const next = dir === 'out' ? g.ends.get(e)!.to : g.ends.get(e)!.from;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

type Found = Omit<Route, 'reversed'>;

/** On a directed path a → b over the edges `use` allows; edges into a or out of b never count. */
function directed(g: Graph, a: string, b: string, use: (e: string) => boolean): Found | null {
  if (!g.out.has(a) || !g.out.has(b) || a === b) return null;
  // Neither walk passes through the other end: what only a loop back through a or b reaches isn't on the way.
  const ahead = walk(g, a, 'out', use, b);
  if (!ahead.has(b)) return null;
  const behind = walk(g, b, 'in', use, a);
  const nodes = new Set([...ahead].filter((n) => behind.has(n)));
  const edges = new Set(
    [...g.ends].filter(([id, e]) => use(id) && nodes.has(e.from) && nodes.has(e.to) && e.to !== a && e.from !== b).map(([id]) => id),
  );
  // BFS for one shortest path, over the edges on the route only.
  const via = new Map<string, string>();
  const queue = [a];
  const seen = new Set([a]);
  while (queue.length && !seen.has(b)) {
    const id = queue.shift()!;
    for (const e of g.out.get(id) ?? []) {
      const next = g.ends.get(e)!.to;
      if (!edges.has(e) || seen.has(next)) continue;
      seen.add(next);
      via.set(next, e);
      queue.push(next);
    }
  }
  const steps: string[] = [];
  for (let at = b; at !== a; at = g.ends.get(via.get(at)!)!.from) steps.unshift(via.get(at)!);
  return { from: a, to: b, nodes, edges, steps };
}

/**
 * A route in time (a sequence): every message on some chain a → … → b where each hop is a later message than
 * the one before. The steps are the chain that reaches b first.
 */
function timed(g: Graph, a: string, b: string): Found | null {
  if (!g.out.has(a) || !g.out.has(b) || a === b) return null;
  const at = new Map(g.order.map((e, i) => [e, i]));
  // Earliest time each participant hears from a (a itself: before the first message), and how.
  const reached = new Map<string, number>([[a, -1]]);
  const how = new Map<string, string>();
  g.order.forEach((e, t) => {
    const { from, to } = g.ends.get(e)!;
    if (reached.has(from) && reached.get(from)! < t && !reached.has(to) && from !== to) {
      reached.set(to, t);
      how.set(to, e);
    }
  });
  if (!reached.has(b)) return null;
  // Latest time each participant can still get word to b (b itself: after the last message).
  const latest = new Map<string, number>([[b, Infinity]]);
  for (let t = g.order.length - 1; t >= 0; t--) {
    const { from, to } = g.ends.get(g.order[t]!)!;
    if (latest.has(to) && latest.get(to)! > t && from !== to) latest.set(from, Math.max(latest.get(from) ?? -Infinity, t));
  }
  const edges = new Set(
    g.order.filter((e) => {
      const { from, to } = g.ends.get(e)!;
      const t = at.get(e)!;
      return from !== to && to !== a && from !== b && reached.has(from) && reached.get(from)! < t && latest.has(to) && latest.get(to)! > t;
    }),
  );
  const nodes = new Set([a, b, ...[...edges].flatMap((e) => [g.ends.get(e)!.from, g.ends.get(e)!.to])]);
  const steps: string[] = [];
  for (let node = b; node !== a; node = g.ends.get(how.get(node)!)!.from) steps.unshift(how.get(node)!);
  return { from: a, to: b, nodes, edges, steps };
}

/**
 * The route between two nodes along authored edges only (never inferred from the drawing): everything on a
 * directed path from `a` to `b`, or from `b` to `a` when no path runs forward. Replies are left out unless nothing
 * connects without them (each would close a loop back to its caller and light the whole diagram); a sequence's
 * route follows time instead. Null when no route exists.
 */
export function routeBetween(g: Graph, a: string, b: string): Route | null {
  const tries: ((x: string, y: string) => Found | null)[] = g.timed
    ? [(x, y) => timed(g, x, y)]
    : [(x, y) => directed(g, x, y, (e) => !g.returns.has(e)), (x, y) => directed(g, x, y, () => true)];
  for (const find of tries) {
    const forward = find(a, b);
    if (forward) return { ...forward, reversed: false };
    const back = find(b, a);
    if (back) return { ...back, reversed: true };
  }
  return null;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Nearest card whose centre lies in the pressed direction. Off-axis distance counts double, so an
 * aligned card beats a slightly closer diagonal one.
 */
export function neighbourInDirection(rects: Record<string, Rect>, from: string, dir: Direction): string | undefined {
  const c = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  const o = c(rects[from]!);
  let best: string | undefined;
  let bestScore = Infinity;
  for (const [id, r] of Object.entries(rects)) {
    if (id === from) continue;
    const p = c(r);
    const [along, across] = dir === 'left' || dir === 'right' ? [p.x - o.x, p.y - o.y] : [p.y - o.y, p.x - o.x];
    const forward = dir === 'right' || dir === 'down' ? along : -along;
    if (forward <= 0) continue;
    const score = forward + 2 * Math.abs(across);
    if (score < bestScore) [best, bestScore] = [id, score];
  }
  return best;
}
