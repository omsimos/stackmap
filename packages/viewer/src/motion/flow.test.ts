import { describe, expect, it } from 'vitest';
import { buildGraph } from '../explore/graph';
import { FLOW, glowAt, hopFlow, hopRanks, pointAlong, pulseFrame, roundedPolyline, sliceAt, travelFor, waveFlow, type FlowEdge } from './flow';

const edge = (id: string, from: string, to: string, length = 100): FlowEdge => ({
  id,
  from,
  to,
  kind: 'sync',
  tint: 'service',
  path: [
    { x: 0, y: 0 },
    { x: length, y: 0 },
  ],
  glow: null,
});

describe('flow geometry', () => {
  it('cuts the stretch of a polyline between two distances, keeping the bends inside it', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 30 },
    ];
    expect(sliceAt(pts, 5, 20)).toEqual([{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
    expect(sliceAt(pts, 12, 20)).toEqual([{ x: 10, y: 2 }, { x: 10, y: 10 }]);
    expect(sliceAt(pts, 0, 99)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }]);
  });

  it('finds the point a fraction of the way along a polyline', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 30 },
    ];
    expect(pointAlong(pts, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlong(pts, 0.25)).toEqual({ x: 10, y: 0 });
    expect(pointAlong(pts, 0.5)).toEqual({ x: 10, y: 10 });
    expect(pointAlong(pts, 2)).toEqual({ x: 10, y: 30 });
  });

  it('follows the rounded corners the canvas draws, not the raw bend', () => {
    const path = roundedPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      10,
    );
    expect(path).toContainEqual({ x: 90, y: 0 });
    expect(path).toContainEqual({ x: 100, y: 10 });
    expect(path).not.toContainEqual({ x: 100, y: 0 });
    expect(path.at(-1)).toEqual({ x: 100, y: 100 });
  });
});

describe('flow timing', () => {
  it('travels longer edges for longer, within bounds', () => {
    expect(travelFor(0)).toBe(FLOW.travel.min);
    expect(travelFor(300)).toBeGreaterThan(travelFor(100));
    expect(travelFor(5000)).toBe(FLOW.travel.max);
  });

  it('paces a hop between 0.72 s and 2.1 s at 1×', () => {
    expect(travelFor(0)).toBe(720);
    expect(travelFor(5000)).toBe(2100);
  });

  it('sets a whole diagram off as one wave in reading order', () => {
    const flow = waveFlow([
      { ...edge('b', 'n', 'm'), at: 200 },
      { ...edge('a', 'n', 'm'), at: 0 },
      { ...edge('dot', 'n', 'm'), path: [{ x: 0, y: 0 }], at: 0 },
    ]);
    expect(flow.pulses.map((p) => [p.id, p.delay])).toEqual([
      ['b', FLOW.wave],
      ['a', 0],
    ]);
    expect(flow.period).toBe(FLOW.wave + travelFor(100) + FLOW.rest);
  });

  it('chains hops: a node fires on as its first pulse lands', () => {
    //   a ─► b (short) ─► d,  a ─► c (long) ─► d
    const flow = hopFlow(
      [edge('ab', 'a', 'b', 100), edge('ac', 'a', 'c', 400), edge('bd', 'b', 'd'), edge('cd', 'c', 'd')],
      new Map([
        ['ab', 0],
        ['ac', 0],
        ['bd', 1],
        ['cd', 1],
      ]),
    );
    const at = Object.fromEntries(flow.pulses.map((p) => [p.id, p.delay]));
    expect(at).toEqual({ ab: 0, ac: 0, bd: travelFor(100), cd: travelFor(400) });
  });

  it('replays a sequence one message after another, and squeezes long chains into the span', () => {
    const serial = hopFlow([edge('m1', 'u', 'api'), edge('m2', 'u', 'db')], new Map([['m1', 0], ['m2', 1]]), { serial: true });
    expect(serial.pulses.map((p) => p.delay)).toEqual([0, travelFor(100)]);
    const long = hopFlow(
      Array.from({ length: 20 }, (_, i) => edge(`e${i}`, `n${i}`, `n${i + 1}`)),
      new Map(Array.from({ length: 20 }, (_, i) => [`e${i}`, i])),
    );
    expect(long.period - FLOW.rest).toBeCloseTo(FLOW.span);
  });
});

describe('a pulse frame', () => {
  const flow = hopFlow([edge('a', 'x', 'y', 200)], new Map([['a', 0]]));
  const [p] = flow.pulses;
  const at = (ms: number) => pulseFrame(flow, p!, ms);

  it('flashes the port, then runs a head with a bounded trail behind it, easing into the target', () => {
    expect(at(0)).toMatchObject({ head: 0, trail: null, depart: 0, land: null });
    const mid = at(p!.travel / 2)!;
    expect(mid.head).toBeGreaterThan(100);
    expect(mid.trail![1]).toBe(mid.head);
    expect(mid.trail![1] - mid.trail![0]).toBeLessThanOrEqual(FLOW.tail);
    expect(at(FLOW.flash + 1)!.depart).toBeNull();
  });

  it('lands: the head is gone, the trail drains into the target and the target glows', () => {
    const landed = at(p!.travel + FLOW.drain / 2)!;
    expect(landed.head).toBeNull();
    expect(landed.trail![1]).toBe(200);
    expect(landed.trail![1] - landed.trail![0]).toBeLessThan(FLOW.tail);
    expect(landed.land).toBeCloseTo(FLOW.drain / 2 / FLOW.glow);
    expect(at(p!.travel + FLOW.glow - 1)!.trail).toBeNull();
    // Then it rests until the next loop.
    expect(at(p!.travel + FLOW.glow + 10)).toBeNull();
    expect(at(flow.period)).toMatchObject({ head: 0 });
  });

  it('glows by spreading past its target as it fades', () => {
    const glow = { rect: { x: 0, y: 0, width: 100, height: 50 }, radius: 12, tint: 'service' as const };
    expect(glowAt(glow, 0)).toMatchObject({ rect: glow.rect, radius: 12 });
    const late = glowAt(glow, 0.8);
    expect(late.rect.width).toBeGreaterThan(100);
    expect(late.opacity).toBeLessThan(glowAt(glow, 0).opacity);
    expect(glowAt(glow, 1).opacity).toBe(0);
  });
});

describe('hop ranks', () => {
  //   x ─► a ─► b ─► c,  c ⇢ a (a reply),  b ─► d
  const g = buildGraph(['x', 'a', 'b', 'c', 'd'], [
    { id: 'xa', from: 'x', to: 'a' },
    { id: 'ab', from: 'a', to: 'b' },
    { id: 'bc', from: 'b', to: 'c' },
    { id: 'ca', from: 'c', to: 'a', kind: 'return' },
    { id: 'bd', from: 'b', to: 'd' },
  ]);
  const all = new Set(['xa', 'ab', 'bc', 'ca', 'bd']);

  it('counts hops from the nodes nothing flows into; a reply follows its call', () => {
    expect(Object.fromEntries(hopRanks(g, all, { fallback: 'b' }))).toEqual({ xa: 0, ab: 1, bc: 2, bd: 2, ca: 3 });
  });

  it('starts at `start` when given (a route)', () => {
    expect(Object.fromEntries(hopRanks(g, new Set(['ab', 'bc']), { start: 'a', fallback: 'a' }))).toEqual({ ab: 0, bc: 1 });
  });

  it('falls back to the given node inside a pure cycle', () => {
    const loop = buildGraph(['p', 'q'], [
      { id: 'pq', from: 'p', to: 'q' },
      { id: 'qp', from: 'q', to: 'p' },
    ]);
    expect(Object.fromEntries(hopRanks(loop, new Set(['pq', 'qp']), { fallback: 'q' }))).toEqual({ qp: 0, pq: 1 });
  });

  it('ranks a sequence by time, one message at a time', () => {
    const seq = buildGraph(['u', 'api', 'db'], [
      { id: 'm1', from: 'u', to: 'api' },
      { id: 'm2', from: 'api', to: 'db' },
      { id: 'm3', from: 'db', to: 'api', kind: 'return' },
      { id: 'm4', from: 'api', to: 'u', kind: 'return' },
    ], { timed: true });
    expect(Object.fromEntries(hopRanks(seq, new Set(['m4', 'm2', 'm1']), { fallback: 'u' }))).toEqual({ m1: 0, m2: 1, m4: 2 });
  });
});
