import { measureText, polylineMidpoint, round, type Point, type Rect } from '@stackmap/core';

// Edge label placement shared by the lane and ELK layouts: the viewer's pill (11px Geist, 8px padding each side,
// 20px tall) on a run of the route, clear of cards, other labels and other edges' lines.

const LABEL_H = 20;
export const labelWidth = (text: string) => Math.ceil(measureText(text, 'sans400', 11)) + 16;

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
/** Whether any axis-aligned segment of a route runs through the rectangle. */
const crossed = (r: Rect, lines: Point[][]) =>
  lines.some((pts) =>
    pts.slice(1).some((b, i) => {
      const a = pts[i]!;
      return Math.max(a.x, b.x) > r.x && Math.min(a.x, b.x) < r.x + r.width && Math.max(a.y, b.y) > r.y && Math.min(a.y, b.y) < r.y + r.height;
    }),
  );
/** Distance from a point to the nearest segment of a polyline. */
function distance(p: Point, pts: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!];
    const x = Math.max(Math.min(a.x, b.x), Math.min(p.x, Math.max(a.x, b.x)));
    const y = Math.max(Math.min(a.y, b.y), Math.min(p.y, Math.max(a.y, b.y)));
    best = Math.min(best, Math.hypot(p.x - x, p.y - y));
  }
  return best;
}
const pillAt = (p: Point, w: number): Rect => ({ x: p.x - w / 2, y: p.y - LABEL_H / 2, width: w, height: LABEL_H });

/** A group frame: labels keep off its border and its title. */
export interface LabelFrame {
  rect: Rect;
  /** height of the title band along the frame's top */
  band: number;
}
/** Where along its route a label should sit: by the target on a fan-out, by the source on a fan-in. */
type Bias = 'start' | 'mid' | 'end';
// The frame title's box: the viewer's title is short, so a fixed strip from the corner covers it.
const TITLE = { width: 160, height: 28 };

/** Frame borders as closed polylines, and the strips their titles take. */
function frameObstacles(frames: LabelFrame[]): { lines: Point[][]; titles: Rect[] } {
  return {
    lines: frames.map(({ rect: r }) => [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
      { x: r.x, y: r.y + r.height },
      { x: r.x, y: r.y },
    ]),
    titles: frames.map(({ rect: r, band }) => ({ x: r.x, y: r.y, width: Math.min(r.width, TITLE.width), height: Math.max(band, TITLE.height) })),
  };
}

/** A card with three or more edges leaving (or entering) puts their labels by their other ends, where they differ. */
function biases(edges: { id: string; from?: string; to?: string }[]): Map<string, Bias> {
  const outs = new Map<string, number>();
  const ins = new Map<string, number>();
  for (const e of edges) {
    if (!e.from || !e.to || e.from === e.to) continue;
    outs.set(e.from, (outs.get(e.from) ?? 0) + 1);
    ins.set(e.to, (ins.get(e.to) ?? 0) + 1);
  }
  return new Map(
    edges.map((e) => {
      const fanOut = e.from ? (outs.get(e.from) ?? 0) : 0;
      const fanIn = e.to ? (ins.get(e.to) ?? 0) : 0;
      return [e.id, fanOut >= 3 && fanOut > fanIn ? 'end' : fanIn >= 3 && fanIn > fanOut ? 'start' : 'mid'];
    }),
  );
}

/**
 * Every label of a laid-out diagram, in draft order. A label goes on the longest run of its route that holds its
 * pill clear of cards, other labels and other edges' lines, nearer its own edge than any other: on a run of its own
 * if one has room, else beside a trunk it shares. Along a run it may slide off the midpoint to clear a neighbour.
 * Horizontal runs are preferred. Where no spot clears the lines, one that clears cards and labels does,
 * and failing that the middle of the longest run. With `keepMidpoints`, a label whose route midpoint is already
 * clear stays there (where the viewer drew it before full layouts placed labels), so only the crowded ones move.
 * Frames' borders count as lines and their titles as cards. On a fan-out or fan-in a label sits as near the far card
 * as it fits, so it reads with the card it names instead of joining a cluster at the shared one.
 * `misfit` is the widest label that found no fully clear spot, 0 when all did; `unseated` counts them, and
 * `forced` counts those that could only go over a card or another label.
 */
export function placeLabels(
  edges: { id: string; label?: string; from?: string; to?: string }[],
  routes: Record<string, Point[]>,
  cardRects: Rect[],
  keepMidpoints = false,
  frames: LabelFrame[] = [],
): { labels: Record<string, Point>; misfit: number; unseated: number; forced: number } {
  const labelled = edges.filter((e) => e.label && routes[e.id]);
  const { lines: borders, titles } = frameObstacles(frames);
  const cards = [...cardRects, ...titles];
  const bias = biases(edges);
  const rivals = (id: string) => Object.entries(routes).flatMap(([k, pts]) => (k === id ? [] : [pts]));
  const others = (id: string) => [...rivals(id), ...borders];
  const taken: Rect[] = [];
  const labels: Record<string, Point> = {};
  if (keepMidpoints) {
    for (const e of labelled) {
      if (bias.get(e.id) !== 'mid') continue;
      const p = polylineMidpoint(routes[e.id]!);
      const pill = pillAt(p, labelWidth(e.label!));
      if (cards.some((r) => overlaps(pill, r)) || taken.some((r) => overlaps(pill, r)) || crossed(pill, others(e.id))) continue;
      // Claimed now, so a later label whose midpoint lands here is the one that moves.
      taken.push(pill);
      labels[e.id] = { x: round(p.x), y: round(p.y) };
    }
  }
  // Runs an edge has to itself first, for every label, before any label settles beside a trunk it shares.
  for (const e of labelled) {
    if (labels[e.id]) continue;
    const spot = findLabelSpot(routes[e.id]!, e.label!, cards, taken, others(e.id), bias.get(e.id), rivals(e.id));
    if (spot) labels[e.id] = spot;
  }
  let misfit = 0;
  let unseated = 0;
  for (const e of labelled) {
    if (labels[e.id]) continue;
    const spot = findLabelSpot(routes[e.id]!, e.label!, cards, taken, others(e.id), bias.get(e.id), rivals(e.id), true);
    if (spot) labels[e.id] = spot;
    else {
      misfit = Math.max(misfit, labelWidth(e.label!));
      unseated++;
    }
  }
  let forced = 0;
  for (const e of labelled) {
    if (labels[e.id]) continue;
    const spot = findLabelSpot(routes[e.id]!, e.label!, cards, taken, [], bias.get(e.id));
    if (!spot) forced++;
    labels[e.id] = spot ?? claimFallback(routes[e.id]!, e.label!, taken);
  }
  return { labels, misfit, unseated, forced };
}

/** A spot that fits, claimed in `taken`; null when none does. */
export function findLabelSpot(
  points: Point[],
  text: string,
  cards: Rect[],
  taken: Rect[],
  lines: Point[][] = [],
  bias: Bias = 'mid',
  /** other edges' routes: a spot nearer one of them than its own would read as naming that edge */
  rivals: Point[][] = [],
  /** whether the label may hang off a run a rival also takes: a trunk the edge shares */
  shared = false,
): Point | null {
  const w = labelWidth(text);
  let best: { p: Point; score: number } | null = null;
  const total = points.slice(1).reduce((s, b, i) => s + Math.abs(b.x - points[i]!.x) + Math.abs(b.y - points[i]!.y), 0);
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const horizontal = a.y === b.y;
    const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const from = walked;
    walked += len;
    const room = horizontal ? len >= w + 16 : len >= LABEL_H + 16;
    if (!room) continue;
    // On the line first; else just beside it: right then left of a vertical run, above then below a horizontal one
    // (a pause/resume pair on parallel runs gets one pill above and one below).
    const beside = horizontal ? LABEL_H / 2 + 3 : w / 2 + 4;
    const offsets: [number, number][] = horizontal ? [[0, 0], [0, -beside], [0, beside]] : [[0, 0], [beside, 0], [-beside, 0]];
    search: for (const [dx, dy] of offsets) {
      for (const t of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const at = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const p = { x: round(at.x + dx), y: round(at.y + dy) };
        const pill = pillAt(p, w);
        if (cards.some((r) => overlaps(pill, r)) || taken.some((r) => overlaps(pill, r)) || crossed(pill, lines)) continue;
        if (rivals.some((r) => distance(p, r) < distance(p, points) || (!shared && distance(at, r) < 0.5))) continue;
        // Longer and horizontal runs first; off-centre and off-line spots lose a little. A biased label goes as near
        // its far end as it fits instead.
        const reach = bias === 'end' ? total - (from + t * len) : bias === 'start' ? from + t * len : null;
        const score = (reach === null ? (horizontal ? 2 : 1) * len - Math.abs(t - 0.5) * 40 : -reach + (horizontal ? 20 : 0)) - (dx || dy ? 30 : 0);
        if (!best || score > best.score) best = { p, score };
        break search;
      }
    }
  }
  if (!best) return null;
  taken.push(pillAt(best.p, w));
  return best.p;
}

/** No spot fits: the middle of the longest run, overlapping whatever is there. */
function claimFallback(points: Point[], text: string, taken: Rect[]): Point {
  let best = { p: points[0]!, len: -1 };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (len > best.len) best = { p: { x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) }, len };
  }
  taken.push(pillAt(best.p, labelWidth(text)));
  return best.p;
}

