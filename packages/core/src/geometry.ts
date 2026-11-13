import type { Point } from './types';

/** Coordinates to two decimals: every layout rounds alike, so points on one line compare equal. */
export const round = (n: number) => Math.round(n * 100) / 100;
const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const towards = (from: Point, to: Point, d: number): Point => {
  const len = dist(from, to);
  return { x: round(from.x + ((to.x - from.x) * d) / len), y: round(from.y + ((to.y - from.y) * d) / len) };
};

function dedupe(points: Point[]): Point[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1]!.x || p.y !== points[i - 1]!.y);
}

export function roundedOrthogonalPath(points: Point[], radius: number): string {
  const pts = dedupe(points);
  if (pts.length < 2) throw new Error('A path needs at least 2 points');
  const first = pts[0]!;
  let d = `M ${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]!;
    const cur = pts[i]!;
    const next = pts[i + 1]!;
    const r = Math.min(radius, dist(prev, cur) / 2, dist(cur, next) / 2);
    const a = towards(cur, prev, r);
    const b = towards(cur, next, r);
    d += ` L ${a.x} ${a.y} Q ${round(cur.x)} ${round(cur.y)} ${b.x} ${b.y}`;
  }
  const last = pts[pts.length - 1]!;
  return `${d} L ${round(last.x)} ${round(last.y)}`;
}

export function polylineMidpoint(points: Point[]): Point {
  const pts = dedupe(points);
  if (pts.length < 2) throw new Error('A path needs at least 2 points');
  const total = pts.slice(1).reduce((sum, p, i) => sum + dist(pts[i]!, p), 0);
  let remaining = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1]!, pts[i]!);
    if (remaining <= seg) return towards(pts[i - 1]!, pts[i]!, remaining);
    remaining -= seg;
  }
  return pts[pts.length - 1]!;
}
