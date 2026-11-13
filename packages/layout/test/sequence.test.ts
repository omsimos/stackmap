import { describe, expect, it } from 'vitest';
import type { DiagramDraft, DiagramEdge } from '@stackmap/core';
import { asyncJob, cacheMiss } from '@stackmap/core/gallery';
import { activations, layoutSequence } from '../src/sequence';

const seq = (edges: DiagramEdge[], extra: Partial<DiagramDraft> = {}): DiagramDraft => ({
  kind: 'sequence',
  title: 't',
  nodes: ['a', 'b', 'c'].map((id) => ({ id, type: 'service' as const, card: { title: id.toUpperCase() } })),
  edges,
  ...extra,
});
const m = (id: string, from: string, to: string, over: Partial<DiagramEdge> = {}): DiagramEdge => ({ id, from, to, ...over });

describe.each([
  ['cache miss', cacheMiss],
  ['async job', asyncJob],
])('%s', (_n, draft) => {
  const out = layoutSequence(draft);

  it('draws messages top to bottom in order, each flat, between its two lifelines', () => {
    let y = -Infinity;
    for (const e of draft.edges) {
      const pts = out.edges[e.id]!;
      expect(pts[0]!.y, e.id).toBeGreaterThan(y);
      y = pts[0]!.y;
      if (e.from === e.to) continue;
      expect(pts).toHaveLength(2);
      expect(pts[1]!.y).toBe(pts[0]!.y);
      const [from, to] = [out.sequence!.lifelines[e.from]!.x, out.sequence!.lifelines[e.to]!.x];
      expect(Math.abs(pts[0]!.x - from), `${e.id} leaves its lifeline`).toBeLessThanOrEqual(5);
      expect(Math.abs(pts[1]!.x - to), `${e.id} reaches its lifeline`).toBeLessThanOrEqual(5);
    }
  });

  it('keeps lifelines in participant order, under their cards, down past the last message', () => {
    const xs = draft.nodes.map((n) => out.sequence!.lifelines[n.id]!.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    const lastY = out.edges[draft.edges.at(-1)!.id]![0]!.y;
    for (const n of draft.nodes) {
      const l = out.sequence!.lifelines[n.id]!;
      const card = out.nodes[n.id]!;
      expect(l.x).toBeCloseTo(card.x + card.width / 2);
      expect(l.top).toBe(card.y + card.height);
      expect(l.bottom).toBeGreaterThan(lastY);
    }
  });

  it('puts every phase band around exactly its messages and keeps labels apart', () => {
    for (const p of draft.phases ?? []) {
      const band = out.phases![p.id]!;
      for (const id of p.edges!) {
        const y = out.edges[id]![0]!.y;
        expect(y > band.y && y < band.y + band.height, `${id} in ${p.id}`).toBe(true);
      }
    }
    const pills = Object.values(out.labels!);
    for (let i = 0; i < pills.length; i++) for (let j = i + 1; j < pills.length; j++) expect(pills[i]!.x !== pills[j]!.x || pills[i]!.y !== pills[j]!.y).toBe(true);
  });

  it('is deterministic', () => {
    expect(layoutSequence(draft)).toEqual(out);
  });
});

describe('activations', () => {
  it('a call opens a bar on the callee and its reply closes it', () => {
    expect(activations([m('1', 'a', 'b'), m('2', 'b', 'c'), m('3', 'c', 'b', { kind: 'return' }), m('4', 'b', 'a', { kind: 'return' })])).toEqual([
      { participant: 'b', depth: 0, from: 0, to: 3 },
      { participant: 'c', depth: 0, from: 1, to: 2 },
    ]);
  });

  it('an unanswered call ends where its participant was last busy once another caller arrives', () => {
    expect(activations([m('1', 'a', 'c'), m('2', 'a', 'b'), m('3', 'b', 'c'), m('4', 'c', 'b', { kind: 'return' })])).toEqual([
      { participant: 'c', depth: 0, from: 0, to: 0 },
      { participant: 'b', depth: 0, from: 1, to: 3 },
      { participant: 'c', depth: 0, from: 2, to: 3 },
    ]);
  });

  it('a callback while the callee waits on its own call nests a bar, and the replies unwind it', () => {
    // a→b request; b→c fetch; c→b callback; b→c ack; c→b data; b→a response
    const bars = activations([
      m('0', 'a', 'b'),
      m('1', 'b', 'c'),
      m('2', 'c', 'b'),
      m('3', 'b', 'c', { kind: 'return' }),
      m('4', 'c', 'b', { kind: 'return' }),
      m('5', 'b', 'a', { kind: 'return' }),
    ]);
    expect(bars).toEqual([
      { participant: 'b', depth: 0, from: 0, to: 5 },
      { participant: 'c', depth: 0, from: 1, to: 4 },
      { participant: 'b', depth: 1, from: 2, to: 3 },
    ]);
  });

  it('a repeated call from the same caller, with no replies drawn, stays in the bar it opened', () => {
    // a→b, b→c three times over and never a reply: b is waiting on c throughout, but a's next request is no callback.
    const calls = [0, 1, 2].flatMap((i) => [m(`r${i}`, 'a', 'b'), m(`q${i}`, 'b', 'c')]);
    expect(activations(calls)).toEqual([
      { participant: 'b', depth: 0, from: 0, to: 5 },
      { participant: 'c', depth: 0, from: 1, to: 5 },
    ]);
  });

  it('a call back into a participant waiting down the chain still nests', () => {
    // a→b, b→c, c→a: a's own call is still out, so c's call nests on a.
    const bars = activations([m('0', 'x', 'a'), m('1', 'a', 'b'), m('2', 'b', 'c'), m('3', 'c', 'a')]);
    expect(bars.filter((b) => b.participant === 'a')).toEqual([
      { participant: 'a', depth: 0, from: 0, to: 3 },
      { participant: 'a', depth: 1, from: 3, to: 3 },
    ]);
  });

  it('receiving a reply keeps a bar busy', () => {
    // a→b; b→c; c→b (reply at row 2); d→b: b's first bar runs to row 2, then d's opens.
    const bars = activations([m('0', 'a', 'b'), m('1', 'b', 'c'), m('2', 'c', 'b', { kind: 'return' }), m('3', 'd', 'b')]);
    expect(bars.filter((b) => b.participant === 'b')).toEqual([
      { participant: 'b', depth: 0, from: 0, to: 2 },
      { participant: 'b', depth: 0, from: 3, to: 3 },
    ]);
  });

  it('a self-call nests a bar on an active participant', () => {
    expect(activations([m('1', 'a', 'b'), m('2', 'b', 'b'), m('3', 'b', 'a', { kind: 'return' })])).toEqual([
      { participant: 'b', depth: 0, from: 0, to: 2 },
      { participant: 'b', depth: 1, from: 1, to: 1, self: '2' },
    ]);
  });
});

describe('layoutSequence', () => {
  it('widens a gap for a long label and draws a self-call as a loop', () => {
    const narrow = layoutSequence(seq([m('1', 'a', 'b', { label: 'x' })]));
    const wide = layoutSequence(seq([m('1', 'a', 'b', { label: 'a very long message label indeed' })]));
    const gap = (o: typeof narrow) => o.sequence!.lifelines.b!.x - o.sequence!.lifelines.a!.x;
    expect(gap(wide)).toBeGreaterThan(gap(narrow));
    const self = layoutSequence(seq([m('1', 'a', 'b'), m('2', 'b', 'b', { label: 'cache' }), m('3', 'b', 'a', { kind: 'return' })]));
    const loop = self.edges['2']!;
    expect(loop).toHaveLength(4);
    expect(loop[1]!.x).toBeGreaterThan(loop[0]!.x);
    expect(loop.at(-1)!.y).toBeGreaterThan(loop[0]!.y);
  });

  it('lays out a sequence with no messages', () => {
    const out = layoutSequence(seq([]));
    expect(Object.keys(out.nodes)).toEqual(['a', 'b', 'c']);
    expect(out.sequence!.activations).toEqual([]);
  });
});
