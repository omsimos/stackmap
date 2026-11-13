import { cardSize, measureText, round, type DiagramDraft, type DiagramEdge, type LaidOutDiagram, type Point, type Rect, type SequenceLayout } from '@stackmap/core';

// Sequence layout: participants across the top in draft order, messages top to bottom in edge order. The agent
// gives only order; stackmap derives column spacing from the labels, rows from the messages and phases, and
// activation bars from calls and replies.

const PAD = 40;
/** Space between the participant cards and the first message. */
const HEAD_GAP = 36;
/** Minimum distance between neighbouring lifelines, beyond the card width. */
const COL_GAP = 40;
const ROW = 44;
const SELF_ROW = 60;
/** Width and height of a self-message's loop. */
const LOOP = { width: 36, height: 22 };
/** A phase's band: the label strip above its first message, and the room after its last. */
export const PHASE_HEAD = 28;
const PHASE_TAIL = 12;
const PHASE_PAD_X = 16;
/** Activation bar width, and the sideways step of each nested bar. */
export const ACTIVATION = { width: 10, nest: 5 };
/** Shortest bar: an async hit or a call answered on the next row still shows. */
const MIN_BAR = 24;
const LABEL = { face: 'sans400', size: 11.5, height: 16, gap: 6 } as const;
const labelWidth = (text: string) => Math.ceil(measureText(text, LABEL.face, LABEL.size)) + 12;

export interface Bar {
  participant: string;
  /** 0 = on the lifeline; a self-call nests one step right of what is open */
  depth: number;
  /** first and last message row it covers */
  from: number;
  to: number;
  /** the self-message that drew it, for nested bars */
  self?: string;
  /** who called, and the last row the participant was busy (opened or sent) */
  caller?: string;
  busy?: number;
}

/**
 * Activation bars by simulation over the messages in order, per participant a stack of open bars:
 * - a call to an idle participant opens a bar; a call to one that is waiting on its own call nests a bar inside,
 *   when it is a callback or comes from a new caller (a caller repeating its request with no reply drawn stays in
 *   the bar it opened); a call from someone new to a participant that is busy but waiting on nobody first ends the
 *   old bar where it was last busy;
 * - a reply closes the replier's bar opened by the one it answers (else its innermost), with any nested inside;
 * - a self-call nests a short bar; sending or receiving keeps a bar busy;
 * - a bar still open at the end runs to its participant's last message.
 */
export function activations(edges: DiagramEdge[]): Bar[] {
  const stacks = new Map<string, Bar[]>();
  /** per participant, the callees it is waiting to hear back from */
  const waiting = new Map<string, string[]>();
  const last = new Map<string, number>();
  const bars: Bar[] = [];
  const stackOf = (p: string) => {
    let st = stacks.get(p);
    if (!st) stacks.set(p, (st = []));
    return st;
  };
  const touch = (p: string, row: number) => {
    const top = stacks.get(p)?.at(-1);
    if (top) top.busy = row;
  };
  /** Whether `p` is waiting on `q`, directly or down its chain of calls: a call from `q` is then a callback. */
  const awaits = (p: string, q: string) => {
    const seen = new Set([p]);
    for (const x of seen) {
      for (const w of waiting.get(x) ?? []) {
        if (w === q) return true;
        seen.add(w);
      }
    }
    return false;
  };
  edges.forEach((e, row) => {
    last.set(e.from, row);
    last.set(e.to, row);
    touch(e.from, row);
    if (e.from === e.to) {
      bars.push({ participant: e.from, depth: stackOf(e.from).length, from: row, to: row, self: e.id });
      return;
    }
    if (e.kind === 'return') {
      touch(e.to, row);
      const st = stackOf(e.from);
      let i = st.map((b) => b.caller).lastIndexOf(e.to);
      if (i < 0) i = st.length - 1;
      if (i >= 0) for (const bar of st.splice(i)) bar.to = row;
      const w = waiting.get(e.to);
      const k = w?.lastIndexOf(e.from) ?? -1;
      if (k >= 0) w!.splice(k, 1);
      return;
    }
    const st = stackOf(e.to);
    const pending = (waiting.get(e.to)?.length ?? 0) > 0;
    const top = st.at(-1);
    if (top && !pending && top.caller !== e.from) {
      // Busy with someone else and waiting on nobody: that earlier work is done.
      for (const bar of st.splice(0)) bar.to = bar.busy ?? bar.from;
    }
    // Receiving counts as busy, but only for work this message belongs to (checked above).
    touch(e.to, row);
    // Without the caller check, every repeat of an unanswered request would nest one bar deeper.
    if (!st.length || (pending && e.kind !== 'async' && (awaits(e.to, e.from) || !st.some((b) => b.caller === e.from)))) {
      const bar: Bar = { participant: e.to, depth: st.length, from: row, to: row, caller: e.from, busy: row };
      st.push(bar);
      bars.push(bar);
    }
    if (e.kind !== 'async') waiting.set(e.from, [...(waiting.get(e.from) ?? []), e.to]);
  });
  for (const st of stacks.values()) for (const bar of st) bar.to = Math.max(bar.to, last.get(bar.participant) ?? bar.to);
  return bars.map(({ caller: _c, busy: _b, ...b }) => b);
}

export function layoutSequence(draft: DiagramDraft): LaidOutDiagram {
  const people = draft.nodes;
  const index = new Map(people.map((n, i) => [n.id, i]));
  const size = new Map(people.map((n) => [n.id, cardSize(n.card, 'compact')]));
  const cardW = Math.max(176, ...[...size.values()].map((s) => s.width));
  const cardH = Math.max(...[...size.values()].map((s) => s.height));
  const edges = draft.edges.filter((e) => index.has(e.from) && index.has(e.to));

  // Lifeline spacing: every gap at least a card plus COL_GAP; a label that spans gaps widens them evenly.
  const gaps = Array.from({ length: Math.max(0, people.length - 1) }, () => cardW + COL_GAP);
  let rightExtra = 0;
  const spans = edges
    .map((e) => ({ e, a: Math.min(index.get(e.from)!, index.get(e.to)!), b: Math.max(index.get(e.from)!, index.get(e.to)!) }))
    .sort((x, y) => x.b - x.a - (y.b - y.a));
  for (const { e, a, b } of spans) {
    if (!e.label) continue;
    const w = labelWidth(e.label);
    if (a === b) {
      // A self-message's label sits right of its loop, before the next lifeline.
      const need = LOOP.width + 8 + w + 16;
      if (a < gaps.length) gaps[a] = Math.max(gaps[a]!, need + ACTIVATION.width);
      else rightExtra = Math.max(rightExtra, need - cardW / 2);
      continue;
    }
    const have = gaps.slice(a, b).reduce((s, g) => s + g, 0);
    const need = w + 32;
    if (need > have) for (let i = a; i < b; i++) gaps[i]! += (need - have) / (b - a);
  }
  const xs: number[] = [PAD + cardW / 2];
  for (const g of gaps) xs.push(xs.at(-1)! + g);
  const xOf = (id: string) => xs[index.get(id)!]!;

  const nodes: Record<string, Rect> = {};
  for (const n of people) {
    const s = size.get(n.id)!;
    nodes[n.id] = { x: round(xOf(n.id) - s.width / 2), y: PAD + (cardH - s.height), width: s.width, height: s.height };
  }

  // Rows: each message gets a row; a phase adds its label strip before its first message and room after its last.
  const edgeIndex = new Map(edges.map((e, i) => [e.id, i]));
  const phaseRange = (draft.phases ?? [])
    .map((p) => {
      const rows = (p.edges ?? []).flatMap((id) => (edgeIndex.has(id) ? [edgeIndex.get(id)!] : []));
      return rows.length ? { id: p.id, first: Math.min(...rows), last: Math.max(...rows) } : null;
    })
    .filter((p): p is { id: string; first: number; last: number } => p !== null);
  const rowY: number[] = [];
  let cursor = PAD + cardH + HEAD_GAP;
  const phaseTop = new Map<string, number>();
  const phaseBottom = new Map<string, number>();
  edges.forEach((e, i) => {
    for (const p of phaseRange) if (p.first === i) {
      phaseTop.set(p.id, cursor);
      cursor += PHASE_HEAD;
    }
    const self = e.from === e.to;
    // The arrow sits below its label.
    rowY.push(cursor + LABEL.height + LABEL.gap);
    cursor += self ? SELF_ROW : ROW;
    for (const p of phaseRange) if (p.last === i) {
      cursor += PHASE_TAIL;
      phaseBottom.set(p.id, cursor);
    }
  });
  const bottom = cursor + 12;

  const bars = activations(edges);
  const barRect = (b: Bar): Rect => {
    const x = xOf(b.participant) - ACTIVATION.width / 2 + b.depth * ACTIVATION.nest;
    // A self-call's bar starts where its loop comes back; a lifeline bar brackets its first and last rows.
    const y0 = b.self ? rowY[b.from]! + LOOP.height - 6 : rowY[b.from]! - 6;
    const y1 = Math.max(b.self ? y0 : rowY[b.to]! + 6, y0 + (b.self ? 18 : MIN_BAR));
    return { x: round(x), y: round(y0), width: ACTIVATION.width, height: round(y1 - y0) };
  };
  // A message leaves and arrives at the edge of the innermost bar open on its row.
  const reach = (participant: string, row: number) => {
    const open = bars.filter((b) => !b.self && b.participant === participant && b.from <= row && b.to >= row);
    return open.length ? ACTIVATION.width / 2 + Math.max(...open.map((b) => b.depth)) * ACTIVATION.nest : 0;
  };

  const out: Record<string, Point[]> = {};
  const labels: Record<string, Point> = {};
  edges.forEach((e, i) => {
    const y = rowY[i]!;
    const x = xOf(e.from);
    if (e.from === e.to) {
      const x0 = x + reach(e.from, i);
      const bar = bars.find((b) => b.self === e.id)!;
      out[e.id] = [
        { x: round(x0), y: round(y) },
        { x: round(x0 + LOOP.width), y: round(y) },
        { x: round(x0 + LOOP.width), y: round(y + LOOP.height) },
        { x: round(x - ACTIVATION.width / 2 + bar.depth * ACTIVATION.nest + ACTIVATION.width), y: round(y + LOOP.height) },
      ];
      if (e.label) labels[e.id] = { x: round(x0 + LOOP.width + 8 + labelWidth(e.label) / 2), y: round(y + LOOP.height / 2) };
      return;
    }
    const tx = xOf(e.to);
    const dir = tx > x ? 1 : -1;
    const a = x + dir * reach(e.from, i);
    const b = tx - dir * reach(e.to, i);
    out[e.id] = [
      { x: round(a), y: round(y) },
      { x: round(b), y: round(y) },
    ];
    if (e.label) labels[e.id] = { x: round((a + b) / 2), y: round(y - LABEL.gap - LABEL.height / 2) };
  });

  const lifelines: SequenceLayout['lifelines'] = {};
  for (const n of people) lifelines[n.id] = { x: round(xOf(n.id)), top: nodes[n.id]!.y + nodes[n.id]!.height, bottom: round(bottom) };

  const left = xs[0]! - cardW / 2 - PHASE_PAD_X;
  const right = xs.at(-1)! + cardW / 2 + PHASE_PAD_X + rightExtra;
  const phases: Record<string, Rect> = {};
  for (const p of phaseRange) {
    const top = phaseTop.get(p.id)!;
    phases[p.id] = { x: round(left), y: round(top), width: round(right - left), height: round(phaseBottom.get(p.id)! - top) };
  }

  return {
    draft,
    nodes,
    groups: {},
    edges: out,
    labels,
    phases,
    sequence: {
      lifelines,
      activations: bars.map((b) => ({ participant: b.participant, rect: barRect(b), depth: b.depth })),
    },
    bounds: { width: round(right + PAD), height: round(bottom + PAD) },
  };
}
