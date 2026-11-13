import { describe, expect, it } from 'vitest';
import type { Rect } from '@stackmap/core';
import { buildGraph, neighbourInDirection, reachable, routeBetween } from './graph';

const edges = [
  { id: 'ab', from: 'a', to: 'b' },
  { id: 'bc', from: 'b', to: 'c' },
  { id: 'xb', from: 'x', to: 'b' },
  { id: 'cy', from: 'c', to: 'y' },
  { id: 'ca', from: 'c', to: 'a' },
];
const g = buildGraph(['a', 'b', 'c', 'x', 'y', 'lone'], edges);

describe('graph', () => {
  it('indexes incoming and outgoing edges per node', () => {
    expect(g.out.get('b')).toEqual(['bc']);
    expect(g.in.get('b')).toEqual(['ab', 'xb']);
    expect(g.out.get('lone')).toEqual([]);
  });

  it('collects everything upstream and downstream, terminating on cycles', () => {
    const r = reachable(g, 'b');
    expect([...r.nodes].sort()).toEqual(['a', 'b', 'c', 'x', 'y']);
    expect([...r.edges].sort()).toEqual(['ab', 'bc', 'ca', 'cy', 'xb']);
  });

  it('a leaf reaches only its ancestors', () => {
    const r = reachable(g, 'y');
    expect([...r.nodes].sort()).toEqual(['a', 'b', 'c', 'x', 'y']);
    expect(reachable(g, 'lone')).toEqual({ nodes: new Set(['lone']), edges: new Set() });
  });

  it('ignores edges to unknown nodes', () => {
    const h = buildGraph(['a'], [{ id: 'e', from: 'a', to: 'ghost' }]);
    expect(reachable(h, 'a').nodes).toEqual(new Set(['a']));
  });
});

describe('neighbourInDirection', () => {
  const rects: Record<string, Rect> = {
    mid: { x: 400, y: 400, width: 100, height: 50 },
    right: { x: 700, y: 410, width: 100, height: 50 },
    farRightAligned: { x: 1200, y: 400, width: 100, height: 50 },
    upRight: { x: 560, y: 100, width: 100, height: 50 },
    down: { x: 400, y: 700, width: 100, height: 50 },
    left: { x: 50, y: 380, width: 100, height: 50 },
  };

  it('picks the nearest card in the pressed direction, preferring alignment', () => {
    expect(neighbourInDirection(rects, 'mid', 'right')).toBe('right');
    expect(neighbourInDirection(rects, 'mid', 'down')).toBe('down');
    expect(neighbourInDirection(rects, 'mid', 'left')).toBe('left');
    expect(neighbourInDirection(rects, 'mid', 'up')).toBe('upRight');
  });

  it('returns undefined at the edge of the diagram', () => {
    expect(neighbourInDirection(rects, 'farRightAligned', 'right')).toBeUndefined();
  });
});

describe('routeBetween', () => {
  // a → b → c → y, x → b, c → a (a cycle), plus a detour b → d → y
  const r = buildGraph(['a', 'b', 'c', 'd', 'x', 'y', 'lone'], [...edges, { id: 'bd', from: 'b', to: 'd' }, { id: 'dy', from: 'd', to: 'y' }]);

  it('collects every node and edge on a directed walk, and one shortest path', () => {
    const route = routeBetween(r, 'b', 'y')!;
    expect(route.reversed).toBe(false);
    // a is only on the loop b → c → a → b: it leads nowhere but back to the start, so it isn't on the way to y.
    expect([...route.nodes].sort()).toEqual(['b', 'c', 'd', 'y']);
    expect([...route.edges].sort()).toEqual(['bc', 'bd', 'cy', 'dy']);
    expect(route.steps).toHaveLength(2);
  });

  it('leaves out what only a loop back through an end reaches, and keeps loops along the way', () => {
    // draft → review, with a retry loop review → changes → draft.
    const retry = buildGraph(['draft', 'review', 'changes'], [
      { id: 'submit', from: 'draft', to: 'review' },
      { id: 'reject', from: 'review', to: 'changes' },
      { id: 'redo', from: 'changes', to: 'draft' },
    ]);
    const route = routeBetween(retry, 'draft', 'review')!;
    expect([...route.nodes].sort()).toEqual(['draft', 'review']);
    expect([...route.edges]).toEqual(['submit']);
    // a → m → b with m ⇄ n: the loop at m is on a walk from a to b.
    const detour = buildGraph(['a', 'm', 'n', 'b'], [
      { id: 'am', from: 'a', to: 'm' },
      { id: 'mn', from: 'm', to: 'n' },
      { id: 'nm', from: 'n', to: 'm' },
      { id: 'mb', from: 'm', to: 'b' },
    ]);
    expect([...routeBetween(detour, 'a', 'b')!.edges].sort()).toEqual(['am', 'mb', 'mn', 'nm']);
  });

  it('runs the other way when only that direction has a path', () => {
    const route = routeBetween(r, 'y', 'x')!;
    expect(route.reversed).toBe(true);
    expect(route.steps).toEqual(['xb', 'bc', 'cy']);
  });

  it('is null between unconnected nodes, a node and itself, or unknown ids', () => {
    expect(routeBetween(r, 'lone', 'a')).toBeNull();
    expect(routeBetween(r, 'a', 'a')).toBeNull();
    expect(routeBetween(r, 'a', 'ghost')).toBeNull();
  });
});

describe('routeBetween, replies and time', () => {
  const call = (id: string, from: string, to: string, kind?: string) => ({ id, from, to, kind });

  it('leaves replies out unless nothing connects without them', () => {
    const g = buildGraph(['a', 'b', 'c'], [call('ab', 'a', 'b'), call('bc', 'b', 'c'), call('cb', 'c', 'b', 'return'), call('ba', 'b', 'a', 'return')]);
    expect([...routeBetween(g, 'a', 'c')!.edges].sort()).toEqual(['ab', 'bc']);
    // Only replies lead from c back to a.
    expect(routeBetween(g, 'c', 'a')).toMatchObject({ reversed: true, steps: ['ab', 'bc'] });
  });

  it('in a sequence follows messages in time order only', () => {
    // user→web, web→api, api→db, db→api (reply), api→web (reply), web→user (reply)
    const g = buildGraph(
      ['user', 'web', 'api', 'db'],
      [call('1', 'user', 'web'), call('2', 'web', 'api'), call('3', 'api', 'db'), call('4', 'db', 'api', 'return'), call('5', 'api', 'web', 'return'), call('6', 'web', 'user', 'return')],
      { timed: true },
    );
    const route = routeBetween(g, 'user', 'db')!;
    expect(route.steps).toEqual(['1', '2', '3']);
    expect([...route.edges].sort()).toEqual(['1', '2', '3']);
    // db → user runs through the replies, later in time.
    expect(routeBetween(g, 'db', 'user')!.steps).toEqual(['4', '5', '6']);
    // A message earlier than the one that reached a participant doesn't continue the route.
    const late = buildGraph(['a', 'b', 'c'], [call('bc', 'b', 'c'), call('ab', 'a', 'b')], { timed: true });
    expect(routeBetween(late, 'a', 'c')).toBeNull();
  });
});
