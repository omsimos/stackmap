import { round, type Point, type Rect } from '@stackmap/core';

// Orthogonal connector routing for the lane layouts, where ELK doesn't place the nodes. A sparse visibility
// grid (the caller's channel lines plus every node's centre and port stubs), A* over (point, heading) with a
// bend cost, then nudging so unrelated edges sharing a channel run side by side instead of on top of each other.

export type Side = 'left' | 'right' | 'top' | 'bottom';
export interface PortChoice {
  side: Side;
  /** added to the route's cost when this side is used */
  cost: number;
}
export interface RouteRequest {
  id: string;
  from: string;
  to: string;
  /** edges of different tones don't share a port: a trunk would hide which colour goes where */
  tone?: string;
  sources: PortChoice[];
  targets: PortChoice[];
}

/** Distance from a card edge to the first bend: arrowheads and handle dots need a straight run. */
export const STUB = 20;
/** Clearance kept between a route and any card. */
const MARGIN = 12;
const BEND = 48;
/** Extra cost per px for running along a channel another, unrelated edge already uses. */
const SHARED = 1.5;
const TRACK = 8;
/** Cost of a side the request didn't ask for: a last resort, so every edge gets an orthogonal route. */
const ANY_SIDE = 400;
/** Cost of leaving through a side an arrow already enters, or entering one an edge leaves: reads as two-way. */
const OPPOSED = 5000;
const SIDES: Side[] = ['right', 'bottom', 'left', 'top'];
/** Cost of sharing a port slot with an edge of another tone: another slot is almost always better. */
const MIXED_TONE = 300;
/** Shortest straight run a nudge may leave at a port (arrowhead + gap). */
const MIN_RUN = 12;

type Dir = 0 | 1 | 2 | 3; // right, down, left, up
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const SIDE_DIR: Record<Side, Dir> = { right: 0, bottom: 1, left: 2, top: 3 };

/** Port slots per side: the midpoint, then one either side, so edges of different tones leave separately. */
const SLOTS = [0, -1, 1, -2, 2] as const;
type Slot = (typeof SLOTS)[number];
// ±2 slots stay on the card: 2 × 28 < 176 / 2, and 2 × 12 < 60 / 2.
const SLOT_GAP = { horizontal: 28, vertical: 12 };
/** Cost of an off-centre slot (per step out): used only when the midpoint is taken by an edge that can't share it. */
const SLOT_COST = 24;

export function portPoint(r: Rect, side: Side, slot: Slot = 0): Point {
  const along = slot * (side === 'top' || side === 'bottom' ? SLOT_GAP.horizontal : SLOT_GAP.vertical);
  switch (side) {
    case 'left':
      return { x: r.x, y: r.y + r.height / 2 + along };
    case 'right':
      return { x: r.x + r.width, y: r.y + r.height / 2 + along };
    case 'top':
      return { x: r.x + r.width / 2 + along, y: r.y };
    case 'bottom':
      return { x: r.x + r.width / 2 + along, y: r.y + r.height };
  }
}
const stubPoint = (r: Rect, side: Side, slot: Slot = 0): Point => {
  const p = portPoint(r, side, slot);
  const d = SIDE_DIR[side];
  return { x: p.x + DX[d]! * STUB, y: p.y + DY[d]! * STUB };
};

const inflate = (r: Rect, m: number): Rect => ({ x: r.x - m, y: r.y - m, width: r.width + 2 * m, height: r.height + 2 * m });
/** Whether an axis-aligned segment passes through the rectangle's interior. */
function crosses(a: Point, b: Point, r: Rect): boolean {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return x1 > r.x && x0 < r.x + r.width && y1 > r.y && y0 < r.y + r.height;
}

class Heap {
  private items: [number, number][] = [];
  get size() {
    return this.items.length;
  }
  push(cost: number, state: number) {
    const a = this.items;
    a.push([cost, state]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]![0] <= a[i]![0]) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![0] < a[m]![0]) m = l;
        if (r < a.length && a[r]![0] < a[m]![0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

interface Grid {
  pts: Point[];
  /** neighbour point index per direction, -1 when blocked */
  next: Int32Array;
  /** search scratch, reused across searches: a state's dist/prev are valid when its stamp is the current search's */
  dist: Float64Array;
  prev: Int32Array;
  stamp: Int32Array;
  generation: number;
}

function buildGrid(xs: number[], ys: number[], blocked: Rect[]): Grid {
  const X = [...new Set(xs.map(round))].sort((a, b) => a - b);
  const Y = [...new Set(ys.map(round))].sort((a, b) => a - b);
  // Per row and per column, only the obstacles that line crosses: keeps the build near-linear in grid size.
  const rowHits = Y.map((y) => blocked.filter((r) => y > r.y && y < r.y + r.height));
  const colHits = X.map((x) => blocked.filter((r) => x > r.x && x < r.x + r.width));
  const pts: Point[] = [];
  const index = new Int32Array(X.length * Y.length).fill(-1);
  for (let j = 0; j < Y.length; j++) {
    const hits = rowHits[j]!;
    for (let i = 0; i < X.length; i++) {
      const x = X[i]!;
      if (hits.some((r) => x > r.x && x < r.x + r.width)) continue;
      index[j * X.length + i] = pts.length;
      pts.push({ x, y: Y[j]! });
    }
  }
  const next = new Int32Array(pts.length * 4).fill(-1);
  const link = (a: number, b: number, dir: Dir, along: Rect[]) => {
    const [p, q] = [pts[a]!, pts[b]!];
    if (along.some((r) => crosses(p, q, r))) return;
    next[a * 4 + dir] = b;
    next[b * 4 + ((dir + 2) % 4)] = a;
  };
  for (let j = 0; j < Y.length; j++) {
    let prev = -1;
    for (let i = 0; i < X.length; i++) {
      const k = index[j * X.length + i]!;
      if (k < 0) {
        prev = -1;
        continue;
      }
      if (prev >= 0) link(prev, k, 0, rowHits[j]!);
      prev = k;
    }
  }
  for (let i = 0; i < X.length; i++) {
    let prev = -1;
    for (let j = 0; j < Y.length; j++) {
      const k = index[j * X.length + i]!;
      if (k < 0) {
        prev = -1;
        continue;
      }
      if (prev >= 0) link(prev, k, 1, colHits[i]!);
      prev = k;
    }
  }
  const states = pts.length * 4;
  return { pts, next, dist: new Float64Array(states), prev: new Int32Array(states), stamp: new Int32Array(states), generation: 0 };
}

interface Used {
  from: string;
  to: string;
}
/** Numeric key of an undirected grid step (point indexes stay far below 2^26). */
const stepKey = (a: number, b: number) => (a < b ? a * 67108864 + b : b * 67108864 + a);
/** Cost of touching a point another, unrelated edge already runs through (a crossing or a merge). */
const CROSS = 40;
/** How far past its two cards a route's first search looks. */
const REGION = 360;

interface Port {
  side: Side;
  slot: Slot;
  cost: number;
}

/**
 * Routes every request around `nodes` (and extra `obstacles`, e.g. labels), using `xs`/`ys` as channel lines.
 * Returns each edge's polyline from port to port, first point on the source card, last on the target card.
 */
export function routeEdges(
  nodes: Record<string, Rect>,
  requests: RouteRequest[],
  channels: { xs: number[]; ys: number[] },
  obstacles: Rect[] = [],
): Record<string, Point[]> {
  const xs = [...channels.xs];
  const ys = [...channels.ys];
  for (const r of Object.values(nodes)) {
    for (const slot of SLOTS) {
      const top = stubPoint(r, 'top', slot);
      const left = stubPoint(r, 'left', slot);
      xs.push(top.x);
      ys.push(left.y);
    }
    xs.push(r.x - STUB, r.x + r.width + STUB);
    ys.push(r.y - STUB, r.y + r.height + STUB);
  }
  const blocked = [...Object.values(nodes).map((r) => inflate(r, MARGIN)), ...obstacles];
  const grid = buildGrid(xs, ys, blocked);
  const at = new Map(grid.pts.map((p, i) => [`${p.x},${p.y}`, i]));
  const find = (p: Point) => at.get(`${round(p.x)},${round(p.y)}`);
  const usedSteps = new Map<number, Used[]>();
  const usedPoints = new Map<number, Used[]>();
  const out: Record<string, Point[]> = {};

  // Who uses each port slot: edges may share one only in the same direction and tone (a trunk).
  // Two edges between the same two cards never share one (they would draw as one line with two labels).
  const slotUse = new Map<string, { role: 'in' | 'out'; tones: Set<string>; pairs: Set<string> }>();
  const ports = (choices: PortChoice[], node: string, role: 'in' | 'out', tone: string, pair: string): Port[] => {
    const listed = new Map(choices.map((c) => [c.side, c.cost]));
    return SIDES.flatMap((side) =>
      SLOTS.map((slot) => {
        const use = slotUse.get(`${node}:${side}:${slot}`);
        const clash = !use ? 0 : use.role !== role ? OPPOSED : use.pairs.has(pair) || !use.tones.has(tone) ? MIXED_TONE : 0;
        return { side, slot, cost: (listed.get(side) ?? ANY_SIDE) + Math.abs(slot) * SLOT_COST + clash };
      }),
    );
  };
  const claim = (node: string, port: { side: Side; slot: Slot }, role: 'in' | 'out', tone: string, pair: string) => {
    const key = `${node}:${port.side}:${port.slot}`;
    const use = slotUse.get(key) ?? { role, tones: new Set<string>(), pairs: new Set<string>() };
    use.tones.add(tone);
    use.pairs.add(pair);
    slotUse.set(key, use);
  };

  for (const req of requests) {
    const src = nodes[req.from]!;
    const dst = nodes[req.to]!;
    const tone = req.tone ?? '';
    const pair = `${req.from}>${req.to}`;
    // A self-loop leaves only by the sides it asks for, so the card's other sides remain to come back in by.
    const self = req.from === req.to;
    const leaveBy = self ? new Set(req.sources.map((c) => c.side)) : null;
    const starts = ports(req.sources, req.from, 'out', tone, pair).filter((c) => !leaveBy || leaveBy.has(c.side)).flatMap((c) => {
      const k = find(stubPoint(src, c.side, c.slot));
      return k === undefined ? [] : [{ ...c, k }];
    });
    const goals = new Map<number, Port[]>();
    // A goal on a start point would be a route of no length: only a self-loop can offer one, and it must go round.
    const startAt = new Set(starts.map((c) => c.k));
    for (const c of ports(req.targets, req.to, 'in', tone, pair)) {
      const k = find(stubPoint(dst, c.side, c.slot));
      if (k !== undefined && !startAt.has(k) && !leaveBy?.has(c.side)) goals.set(k, [...(goals.get(k) ?? []), c]);
    }
    // Fan-out from one card and fan-in to one card share a trunk on purpose; only unrelated edges pay.
    const unrelated = (list: Used[] | undefined) => !!list?.some((u) => u.from !== req.from && u.to !== req.to);
    const extra = (a: number, b: number, len: number) => (unrelated(usedSteps.get(stepKey(a, b))) ? SHARED * len : 0) + (unrelated(usedPoints.get(b)) ? CROSS : 0);
    // Search near the two cards first (most routes stay local); only a route that needs more room gets the grid.
    const box = { x0: Math.min(src.x, dst.x) - REGION, y0: Math.min(src.y, dst.y) - REGION, x1: Math.max(src.x + src.width, dst.x + dst.width) + REGION, y1: Math.max(src.y + src.height, dst.y + dst.height) + REGION };
    const path = search(grid, starts, goals, extra, box) ?? search(grid, starts, goals, extra);
    if (!path) {
      // Boxed in (every stub blocked): out of the right side, into the left, square at both ends. It may cross a
      // card, but it is never diagonal and never meets a card along its side.
      const a = portPoint(src, 'right');
      const b = portPoint(dst, 'left');
      out[req.id] = [a, { x: a.x + STUB, y: a.y }, { x: a.x + STUB, y: b.y }, { x: b.x - STUB, y: b.y }, b];
      continue;
    }
    const { points: gridPath, src: from, dst: to } = path;
    claim(req.from, from, 'out', tone, pair);
    claim(req.to, to, 'in', tone, pair);
    const me = { from: req.from, to: req.to };
    gridPath.forEach((k, i) => {
      usedPoints.set(k, [...(usedPoints.get(k) ?? []), me]);
      if (i) usedSteps.set(stepKey(gridPath[i - 1]!, k), [...(usedSteps.get(stepKey(gridPath[i - 1]!, k)) ?? []), me]);
    });
    out[req.id] = [portPoint(src, from.side, from.slot), ...gridPath.map((k) => grid.pts[k]!), portPoint(dst, to.side, to.slot)];
  }
  return out;
}

function search(
  grid: Grid,
  starts: (Port & { k: number })[],
  goals: Map<number, Port[]>,
  extra: (a: number, b: number, len: number) => number,
  box?: { x0: number; y0: number; x1: number; y1: number },
): { points: number[]; src: Port; dst: Port } | null {
  if (!starts.length || !goals.size) return null;
  const gen = ++grid.generation;
  const { stamp } = grid;
  const distOf = (st: number) => (stamp[st] === gen ? grid.dist[st]! : Infinity);
  const set = (st: number, d: number, from: number) => {
    stamp[st] = gen;
    grid.dist[st] = d;
    grid.prev[st] = from;
  };
  const srcOf = new Map<number, Port>();
  const heap = new Heap();
  const goalPts = [...goals.keys()].map((k) => grid.pts[k]!);
  const h = (k: number) => {
    const p = grid.pts[k]!;
    let best = Infinity;
    for (const g of goalPts) best = Math.min(best, Math.abs(g.x - p.x) + Math.abs(g.y - p.y));
    return best;
  };
  for (const s of starts) {
    const state = s.k * 4 + SIDE_DIR[s.side];
    if (s.cost < distOf(state)) {
      set(state, s.cost, -1);
      srcOf.set(state, s);
      heap.push(s.cost + h(s.k), state);
    }
  }
  let best: { state: number; cost: number; port: Port } | null = null;
  while (heap.size) {
    const [f, state] = heap.pop();
    if (best && f >= best.cost) break;
    const k = state >> 2;
    const dir = (state & 3) as Dir;
    const g = distOf(state);
    if (f - h(k) > g + 1e-6) continue;
    for (const c of goals.get(k) ?? []) {
      // Arriving heading into the card costs nothing; any other heading needs one more bend.
      const into = (SIDE_DIR[c.side] + 2) % 4;
      const total = g + c.cost + (dir === into ? 0 : BEND);
      if (!best || total < best.cost) best = { state, cost: total, port: c };
    }
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      if (d === (dir + 2) % 4) continue; // no U-turns in place
      const m = grid.next[k * 4 + d]!;
      if (m < 0) continue;
      const a = grid.pts[k]!;
      const b = grid.pts[m]!;
      if (box && (b.x < box.x0 || b.x > box.x1 || b.y < box.y0 || b.y > box.y1)) continue;
      const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      const cost = g + len + extra(k, m, len) + (d === dir ? 0 : BEND);
      const next = m * 4 + d;
      if (cost < distOf(next) - 1e-9) {
        set(next, cost, state);
        heap.push(cost + h(m), next);
      }
    }
  }
  if (!best) return null;
  const points: number[] = [];
  let s = best.state;
  let first = s;
  while (s >= 0) {
    points.push(s >> 2);
    first = s;
    s = grid.prev[s]!;
  }
  points.reverse();
  return { points, src: srcOf.get(first)!, dst: best.port };
}

/** Drops repeated points and the middle of straight runs. */
export function simplify(points: Point[]): Point[] {
  const pts = points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
  return pts.filter((p, i) => {
    if (i === 0 || i === pts.length - 1) return true;
    const a = pts[i - 1]!;
    const b = pts[i + 1]!;
    return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y));
  });
}

interface Seg {
  edge: string;
  i: number;
  /** the fixed coordinate: x for a vertical segment, y for a horizontal one */
  at: number;
  lo: number;
  hi: number;
  src: string;
  dst: string;
}

/**
 * Spreads unrelated edges that run along the same line over parallel tracks, TRACK px apart. Segments of
 * edges that share a source or a target stay merged (a trunk). Segments on a port never move, and a move
 * never shortens a port's straight run below MIN_RUN, so edges still meet their cards square.
 */
export function nudge(routes: Record<string, Point[]>, ends: Record<string, { from: string; to: string }>): Record<string, Point[]> {
  const out: Record<string, Point[]> = Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, simplify(v).map((p) => ({ ...p }))]));
  for (const vertical of [true, false]) {
    const lines = new Map<number, Seg[]>();
    for (const [edge, pts] of Object.entries(out)) {
      for (let i = 1; i + 1 < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        if (vertical ? a.x !== b.x : a.y !== b.y) continue;
        const at = vertical ? a.x : a.y;
        const [lo, hi] = vertical ? [Math.min(a.y, b.y), Math.max(a.y, b.y)] : [Math.min(a.x, b.x), Math.max(a.x, b.x)];
        const seg = { edge, i, at, lo, hi, src: ends[edge]!.from, dst: ends[edge]!.to };
        lines.set(at, [...(lines.get(at) ?? []), seg]);
      }
    }
    for (const segs of lines.values()) {
      if (segs.length < 2) continue;
      // Two overlapping segments may share a track only as a trunk: the same edge, or one source (or one target)
      // with different far ends. Tracks are handed out greedily, so sharing is never transitive.
      const overlap = (a: Seg, b: Seg) => Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > 0.5;
      const mayShare = (a: Seg, b: Seg) => a.edge === b.edge || ((a.src === b.src) !== (a.dst === b.dst));
      const track = new Map<Seg, number>();
      for (const seg of segs) {
        let t = 0;
        while (segs.some((o) => track.get(o) === t && overlap(o, seg) && !mayShare(o, seg))) t++;
        track.set(seg, t);
      }
      for (const seg of segs) {
        const t = track.get(seg)!;
        if (!t) continue;
        const off = (t % 2 ? 1 : -1) * Math.ceil(t / 2) * TRACK;
        const pts = out[seg.edge]!;
        const axis = vertical ? 'x' : 'y';
        // Moving a point next to a port stretches or shrinks that port's run; keep room for the arrowhead.
        const run = (j: number, port: number) => Math.abs(pts[j]![axis] + off - pts[port]![axis]);
        if ((seg.i === 1 && run(1, 0) < MIN_RUN) || (seg.i + 1 === pts.length - 2 && run(seg.i + 1, pts.length - 1) < MIN_RUN)) continue;
        for (const j of [seg.i, seg.i + 1]) pts[j]![axis] = round(seg.at + off);
      }
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, simplify(v)]));
}
