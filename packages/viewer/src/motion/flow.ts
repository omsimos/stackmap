import type { EdgeKind, NodeType, Point, Rect } from '@stackmap/core';
import type { Graph } from '../explore/graph';

/**
 * Flow playback timing, shared by the live canvas and the video export (both draw `pulseFrame`).
 * A pulse's travel time grows with its edge's length (clamped), so short hops don't crawl and long ones don't
 * jump. A whole diagram staggers its pulses across `wave` ms in reading order; a focused flow chains its hops
 * (a node fires on as its first pulse lands), squeezed to fit `span` (twice that for a sequence's replay).
 * All of it is 1× playback: the viewer's speed control scales the clock, not these.
 */
export const FLOW = {
  wave: 2700,
  span: 9000,
  rest: 1050,
  travel: { base: 570, perPx: 1.65, min: 720, max: 2100 },
  /** trail length behind the head, diagram px */
  tail: 72,
  /** how long the trail takes to drain into the target once the head lands */
  drain: 330,
  /** the target's glow after a landing */
  glow: 840,
  /** the ring at the source port as a pulse sets off */
  flash: 540,
} as const;

/** A pulse's look in diagram px, the same on the canvas and in the video. */
export const PULSE = {
  core: 3.5,
  halo: 8,
  haloOpacity: 0.22,
  /** tapering trail: [fraction of the tail from the head, stroke width, opacity], back to front */
  trail: [
    [1, 2, 0.22],
    [0.66, 2.5, 0.45],
    [0.33, 3, 0.85],
  ],
  /** async edges carry a train of packets this far apart */
  packetGap: 14,
  packet: 2.5,
  /** how far a landing glow spreads past its target */
  spread: 16,
} as const;

export interface FlowPulse {
  /** the edge it runs along */
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** node type whose accent colours it: the source's, or the failure tint on an error-tone edge */
  tint: NodeType;
  /** the edge as drawn (rounded corners sampled), and its length */
  path: Point[];
  length: number;
  /** ms into each loop it sets off, and how long it travels */
  delay: number;
  travel: number;
  /** what lights up when it lands, in its own accent (the target catches it): a card or activation bar; null = a ripple */
  glow: { rect: Rect; radius: number; tint: NodeType } | null;
}

export interface Flow {
  pulses: FlowPulse[];
  /** ms per loop */
  period: number;
}

export const NO_FLOW: Flow = { pulses: [], period: FLOW.wave + FLOW.rest };

/** A polyline's length. */
export const lengthOf = (points: Point[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y), 0);

/** The point `d` px along a polyline (clamped to its ends). */
export function pointAt(points: Point[], d: number): Point {
  let left = Math.max(0, d);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= seg || i === points.length - 1) {
      const f = seg ? Math.min(1, left / seg) : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    left -= seg;
  }
  return points[0]!;
}

/** The stretch of a polyline from `from` to `to` px along it, its bends included. */
export function sliceAt(points: Point[], from: number, to: number): Point[] {
  const out = [pointAt(points, from)];
  let walked = 0;
  for (let i = 1; i < points.length - 1; i++) {
    walked += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
    if (walked > from && walked < to) out.push(points[i]!);
  }
  out.push(pointAt(points, to));
  return out;
}

/** The point `t` (0–1) of the way along a polyline. */
export const pointAlong = (points: Point[], t: number) => pointAt(points, Math.max(0, Math.min(1, t)) * lengthOf(points));

/**
 * The route the canvas actually draws: core's `roundedOrthogonalPath` cuts each corner with a quadratic curve,
 * so a pulse following the raw polyline would leave the line at every bend.
 */
export function roundedPolyline(points: Point[], radius: number): Point[] {
  const pts = points.filter((p, i) => !i || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
  if (pts.length < 3) return pts;
  const out: Point[] = [pts[0]!];
  const towards = (from: Point, to: Point, d: number) => {
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    return { x: from.x + ((to.x - from.x) / len) * d, y: from.y + ((to.y - from.y) / len) * d };
  };
  for (let i = 1; i < pts.length - 1; i++) {
    const [prev, cur, next] = [pts[i - 1]!, pts[i]!, pts[i + 1]!];
    const r = Math.min(radius, Math.hypot(cur.x - prev.x, cur.y - prev.y) / 2, Math.hypot(next.x - cur.x, next.y - cur.y) / 2);
    const a = towards(cur, prev, r);
    const b = towards(cur, next, r);
    out.push(a);
    for (const t of [0.25, 0.5, 0.75]) {
      const u = 1 - t;
      out.push({ x: u * u * a.x + 2 * u * t * cur.x + t * t * b.x, y: u * u * a.y + 2 * u * t * cur.y + t * t * b.y });
    }
    out.push(b);
  }
  out.push(pts.at(-1)!);
  return out;
}

export const travelFor = (length: number) => Math.min(FLOW.travel.max, Math.max(FLOW.travel.min, FLOW.travel.base + length * FLOW.travel.perPx));

// Leaves the port quickly and settles into the target: the landing then reads as the target catching it.
const ease = (t: number) => 1 - (1 - t) * (1 - t);

export type FlowEdge = Omit<FlowPulse, 'delay' | 'travel' | 'length'>;
const drawable = <T extends FlowEdge>(edges: T[]) => edges.filter((e) => e.path.length > 1);
const periodOf = (pulses: FlowPulse[]) => Math.max(0, ...pulses.map((p) => p.delay + p.travel)) + FLOW.rest;

/** Everything at once: a wave in reading order, `at` being each edge's position along it. */
export function waveFlow(edges: (FlowEdge & { at: number })[]): Flow {
  const usable = drawable(edges);
  const min = Math.min(...usable.map((e) => e.at));
  const range = Math.max(...usable.map((e) => e.at)) - min || 1;
  const pulses = usable.map(({ at, ...e }) => {
    const length = lengthOf(e.path);
    return { ...e, length, travel: travelFor(length), delay: ((at - min) / range) * FLOW.wave };
  });
  return { pulses, period: periodOf(pulses) };
}

/**
 * A focused flow, hop by hop in `ranks` order: each node fires on as the first pulse of its lowest rank lands.
 * `serial` (a sequence) plays one message after another instead.
 */
export function hopFlow(edges: FlowEdge[], ranks: ReadonlyMap<string, number>, { serial = false } = {}): Flow {
  const usable = drawable(edges)
    .filter((e) => ranks.has(e.id))
    .sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!);
  const fire = new Map<string, number>();
  const pulses: FlowPulse[] = [];
  let clock = 0;
  for (let i = 0; i < usable.length; ) {
    const rank = ranks.get(usable[i]!.id)!;
    const landed = new Map<string, number>();
    for (; i < usable.length && ranks.get(usable[i]!.id) === rank; i++) {
      const e = usable[i]!;
      const length = lengthOf(e.path);
      const travel = travelFor(length);
      const delay = serial ? clock : (fire.get(e.from) ?? 0);
      pulses.push({ ...e, length, travel, delay });
      clock = delay + travel;
      if (!fire.has(e.to)) landed.set(e.to, Math.min(landed.get(e.to) ?? Infinity, delay + travel));
    }
    for (const [n, t] of landed) fire.set(n, t);
  }
  const total = periodOf(pulses) - FLOW.rest;
  const squeeze = Math.min(1, (FLOW.span * (serial ? 2 : 1)) / (total || 1));
  const fitted = squeeze < 1 ? pulses.map((p) => ({ ...p, delay: p.delay * squeeze, travel: p.travel * squeeze })) : pulses;
  return { pulses: fitted, period: periodOf(fitted) };
}

/** One pulse's state `ms` into playback; null while it waits for its turn in the loop. */
export interface PulseFrame {
  /** px along the path of the head, while it travels */
  head: number | null;
  /** the lit stretch of the path behind it [from, to], draining into the target after it lands */
  trail: [number, number] | null;
  /** 0–1 through the port flash as it sets off */
  depart: number | null;
  /** 0–1 through the landing glow */
  land: number | null;
}

export function pulseFrame(flow: Flow, p: FlowPulse, ms: number): PulseFrame | null {
  const local = (((ms - p.delay) % flow.period) + flow.period) % flow.period;
  if (local > p.travel + Math.max(FLOW.drain, FLOW.glow)) return null;
  const tail = Math.min(FLOW.tail, p.length);
  const moving = local <= p.travel;
  const head = moving ? p.length * ease(local / p.travel) : null;
  const drained = (local - p.travel) / FLOW.drain;
  const trail: [number, number] | null =
    head !== null ? (head > 0 ? [Math.max(0, head - tail), head] : null) : drained < 1 ? [p.length - tail * (1 - drained), p.length] : null;
  return {
    head,
    trail,
    depart: local <= FLOW.flash ? local / FLOW.flash : null,
    land: !moving && local <= p.travel + FLOW.glow ? (local - p.travel) / FLOW.glow : null,
  };
}

/** A landing glow's rect and opacity at `k` (0–1): it spreads past its target as it fades. */
export function glowAt(glow: NonNullable<FlowPulse['glow']>, k: number) {
  const s = PULSE.spread * (1 - (1 - k) * (1 - k));
  const { x, y, width, height } = glow.rect;
  return { rect: { x: x - s, y: y - s, width: width + 2 * s, height: height + 2 * s }, radius: glow.radius + s, opacity: 0.4 * (1 - k) ** 1.5 };
}

/** A ring (port flash or landing ripple) at `k`: it grows and fades. */
export const ringAt = (k: number, from: number, to: number) => ({ r: from + (to - from) * (1 - (1 - k) * (1 - k)), opacity: 0.7 * (1 - k) });

/**
 * How many hops each of `edges` is from where the flow starts: `start` when given, else every node the subset
 * has no forward way into (falling back to `fallback` when it's all one cycle). Replies and roll-backs follow
 * the calls they answer rather than starting anything. A sequence ranks by time instead: one message at a time.
 */
export function hopRanks(g: Graph, edges: ReadonlySet<string>, { start, fallback }: { start?: string; fallback: string }): Map<string, number> {
  const ranks = new Map<string, number>();
  if (g.timed) {
    g.order.filter((id) => edges.has(id)).forEach((id, i) => ranks.set(id, i));
    return ranks;
  }
  const ids = [...edges].filter((id) => g.ends.has(id));
  const forward = ids.filter((id) => !g.returns.has(id));
  const entered = new Set(forward.map((id) => g.ends.get(id)!.to));
  const sources = start ? [start] : [...new Set(forward.map((id) => g.ends.get(id)!.from))].filter((n) => !entered.has(n));
  const depth = new Map((sources.length ? sources : [fallback]).map((n) => [n, 0]));
  // Forward edges first, so a reply never makes its caller look downstream; then anything only a reply reaches.
  for (const usable of [new Set(forward), new Set(ids)]) {
    const queue = [...depth.keys()];
    while (queue.length) {
      const n = queue.shift()!;
      for (const id of g.out.get(n) ?? []) {
        const to = g.ends.get(id)!.to;
        if (!usable.has(id) || depth.has(to)) continue;
        depth.set(to, depth.get(n)! + 1);
        queue.push(to);
      }
    }
  }
  for (const id of ids) ranks.set(id, depth.get(g.ends.get(id)!.from) ?? 0);
  return ranks;
}
