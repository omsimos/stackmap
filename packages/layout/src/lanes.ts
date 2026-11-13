import { assignColumns, backEdges, cardSize, COMPACT, round, type DiagramDraft, type DiagramEdge, type LaidOutDiagram, type Point, type Rect } from '@stackmap/core';
import { labelWidth, placeLabels } from './labels';

export { assignColumns, backEdges } from '@stackmap/core';
import { nudge, routeEdges, STUB, type PortChoice, type RouteRequest } from './route';

// Swimlane layout for workflow and lifecycle diagrams: lanes are full-width rows in draft order, columns
// follow the flow (longest path), and stackmap routes the edges itself (./route.ts).

const PAD = 40;
/** Left rail of every lane, holding its label (wrapped to the rail). */
export const LANE_HEAD = 144;
const LANE_PAD_X = 32;
const LANE_PAD_TOP = 20;
/** Room under a lane's cards for the channel same-lane back edges take. */
const LANE_PAD_BOTTOM = 28;
const LANE_GAP = 16;
/** Gap between stacked cards: two port stubs must fit between them, or the facing ports drop out of the grid. */
const STACK_GAP = 2 * STUB + 4;
const MIN_GUTTER = 64;
const MAX_GUTTER = 176;
/** Header band above the lanes, when there are phases. */
export const PHASE_BAND = 40;
const PHASE_GAP = 8;
/** Group frames inside a lane: padding around members and the label band above them. */
export const GROUP_PAD = 12;
export const GROUP_LABEL = 28;
/** Room left of a lifecycle start state for its initial marker. */
export const START_MARK = 28;

const roundRect = (r: Rect): Rect => ({ x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) });

function portChoices(sameLane: boolean, dCol: number, dLane: number, isBack: boolean): { sources: PortChoice[]; targets: PortChoice[] } {
  const c = (side: PortChoice['side'], cost: number): PortChoice => ({ side, cost });
  if (isBack) {
    if (sameLane) return { sources: [c('bottom', 0), c('top', 30), c('left', 60)], targets: [c('bottom', 0), c('top', 30), c('right', 60)] };
    return dLane > 0
      ? { sources: [c('bottom', 0), c('left', 20)], targets: [c('right', 0), c('top', 20), c('left', 40)] }
      : { sources: [c('top', 0), c('left', 20)], targets: [c('right', 0), c('bottom', 20), c('left', 40)] };
  }
  if (sameLane) return { sources: [c('right', 0), c('bottom', 80), c('top', 80)], targets: [c('left', 0), c('top', 80), c('bottom', 80)] };
  if (dLane > 0)
    return dCol === 0
      ? { sources: [c('bottom', 0)], targets: [c('top', 0)] }
      : { sources: [c('bottom', 0), c('right', 30)], targets: [c('top', 0), c('left', 30)] };
  return dCol === 0
    ? { sources: [c('top', 0)], targets: [c('bottom', 0)] }
    : { sources: [c('top', 0), c('right', 30)], targets: [c('bottom', 0), c('left', 30)] };
}

export function layoutLanes(draft: DiagramDraft): LaidOutDiagram {
  const lanes = draft.lanes ?? [];
  const laneIndex = new Map(lanes.map((l, i) => [l.id, i]));
  const nodes = draft.nodes.filter((n) => n.lane !== undefined && laneIndex.has(n.lane));
  const back = backEdges(draft);
  const col = assignColumns(draft, back);
  const size = new Map(nodes.map((n) => [n.id, cardSize(n.card, 'compact')]));
  const cols = Math.max(0, ...nodes.map((n) => col.get(n.id)!)) + 1;
  const cardW = Math.max(COMPACT.width, ...[...size.values()].map((s) => s.width));

  // A gutter wide enough for the labels on edges between neighbouring columns of one lane, either way; a
  // pause/resume pair side by side needs room for both.
  const laneOf = new Map(nodes.map((n) => [n.id, n.lane!]));
  const pairKey = (e: DiagramEdge) => [e.from, e.to].sort().join('|');
  const neighbourLabels = new Map<string, number>();
  for (const e of draft.edges) {
    if (!e.label || laneOf.get(e.from) !== laneOf.get(e.to) || Math.abs(col.get(e.to)! - col.get(e.from)!) !== 1) continue;
    neighbourLabels.set(pairKey(e), (neighbourLabels.get(pairKey(e)) ?? 8) + labelWidth(e.label) + 16);
  }
  const gutter = Math.min(MAX_GUTTER, Math.max(MIN_GUTTER, ...neighbourLabels.values()));

  const hasStart = nodes.some((n) => n.type === 'start' && col.get(n.id) === 0);
  const x0 = PAD + LANE_HEAD + (hasStart ? START_MARK : 0);
  const colX = (c: number) => x0 + c * (cardW + gutter);
  const bandX = PAD;
  const bandW = colX(cols - 1) + cardW + LANE_PAD_X - PAD;

  const top = PAD + (draft.phases?.length ? PHASE_BAND + PHASE_GAP : 0);
  const rects: Record<string, Rect> = {};
  const laneRects: Record<string, Rect> = {};
  const groupRects: Record<string, Rect> = {};
  let y = top;
  for (const lane of lanes) {
    const members = nodes.filter((n) => n.lane === lane.id);
    const grouped = (draft.groups ?? []).some((g) => members.some((n) => n.group === g.id));
    const contentTop = y + LANE_PAD_TOP + (grouped ? GROUP_LABEL + GROUP_PAD : 0);
    // Stack row k of every column shares one centre line, so neighbours in a lane line up.
    const cells = new Map<number, typeof members>();
    for (const n of members) cells.set(col.get(n.id)!, [...(cells.get(col.get(n.id)!) ?? []), n]);
    const depth = Math.max(0, ...[...cells.values()].map((c) => c.length));
    const rowH = Array.from({ length: depth }, (_, k) => Math.max(0, ...[...cells.values()].map((c) => (c[k] ? size.get(c[k].id)!.height : 0))));
    const rowCenter: number[] = [];
    let cursor = contentTop;
    for (let k = 0; k < depth; k++) {
      rowCenter.push(cursor + rowH[k]! / 2);
      cursor += rowH[k]! + STACK_GAP;
    }
    for (const [c, cell] of cells) {
      cell.forEach((n, k) => {
        const s = size.get(n.id)!;
        rects[n.id] = roundRect({ x: colX(c) + (cardW - s.width) / 2, y: rowCenter[k]! - s.height / 2, width: s.width, height: s.height });
      });
    }
    // The rail label may wrap: keep an empty or one-row lane tall enough for two lines.
    const contentBottom = Math.max(depth ? cursor - STACK_GAP : contentTop + 60, y + 72 - LANE_PAD_BOTTOM);
    const bottom = contentBottom + (grouped ? GROUP_PAD : 0) + LANE_PAD_BOTTOM;
    laneRects[lane.id] = roundRect({ x: bandX, y, width: bandW, height: bottom - y });
    y = bottom + LANE_GAP;
  }

  for (const g of draft.groups ?? []) {
    const members = nodes.filter((n) => n.group === g.id).map((n) => rects[n.id]!);
    if (!members.length) continue;
    const x = Math.min(...members.map((r) => r.x)) - GROUP_PAD;
    const yTop = Math.min(...members.map((r) => r.y)) - GROUP_PAD - GROUP_LABEL;
    const right = Math.max(...members.map((r) => r.x + r.width)) + GROUP_PAD;
    const bottom = Math.max(...members.map((r) => r.y + r.height)) + GROUP_PAD;
    groupRects[g.id] = roundRect({ x, y: yTop, width: right - x, height: bottom - yTop });
  }

  const phaseRects: Record<string, Rect> = {};
  for (const p of draft.phases ?? []) {
    const cs = (p.nodes ?? []).filter((n) => col.has(n) && laneOf.has(n)).map((n) => col.get(n)!);
    if (!cs.length) continue;
    const left = colX(Math.min(...cs)) - gutter / 2 + 8;
    const right = colX(Math.max(...cs)) + cardW + gutter / 2 - 8;
    phaseRects[p.id] = roundRect({ x: Math.max(left, bandX + 8), y: PAD, width: Math.min(right, bandX + bandW - 8) - Math.max(left, bandX + 8), height: PHASE_BAND });
  }

  // Channels: gutter centres, the lane margins, and in every lane its label strip and bottom padding.
  const xs = [x0 - (hasStart ? START_MARK : 0) - LANE_PAD_X / 2, bandX + bandW - LANE_PAD_X / 2];
  for (let c = 0; c < cols - 1; c++) xs.push(colX(c) + cardW + gutter / 2);
  const ys: number[] = [];
  for (const r of Object.values(laneRects)) ys.push(r.y + r.height - LANE_PAD_BOTTOM / 2, r.y - LANE_GAP / 2, r.y + r.height + LANE_GAP / 2);
  // Lane rails, group labels and start markers are text and marks that edges must not run over.
  const obstacles: Rect[] = [];
  for (const lane of lanes) {
    const r = laneRects[lane.id]!;
    // The rail label (the viewer caps it at LANE_HEAD - 32) and no more: column 0's left stubs sit just past it.
    obstacles.push({ x: r.x, y: r.y, width: LANE_HEAD - 28, height: r.height });
  }
  for (const g of draft.groups ?? []) {
    const r = groupRects[g.id];
    if (r) obstacles.push({ x: r.x, y: r.y + 4, width: labelWidth(g.label) + 24, height: GROUP_LABEL - 8 });
  }
  for (const n of nodes) {
    if (n.type !== 'start') continue;
    const r = rects[n.id]!;
    obstacles.push({ x: r.x - START_MARK, y: r.y + r.height / 2 - 8, width: START_MARK, height: 16 });
  }

  const requests: RouteRequest[] = draft.edges
    .filter((e) => rects[e.from] && rects[e.to])
    .map((e) => {
      // A self-transition leaves on the right and comes back in underneath (or on top), around the corner.
      if (e.from === e.to)
        return { id: e.id, from: e.from, to: e.to, tone: `${e.tone ?? ''}:self`, sources: [{ side: 'right' as const, cost: 0 }], targets: [{ side: 'bottom' as const, cost: 0 }, { side: 'top' as const, cost: 20 }], order: 2e6 };
      const dLane = laneIndex.get(laneOf.get(e.to)!)! - laneIndex.get(laneOf.get(e.from)!)!;
      const dCol = col.get(e.to)! - col.get(e.from)!;
      const isBack = back.has(e.id) || dCol < 0;
      const choice = portChoices(dLane === 0, dCol, dLane, isBack);
      // A start state's left side holds its initial marker.
      const blockLeft = (id: string) => draft.nodes.find((n) => n.id === id)?.type === 'start';
      return {
        id: e.id,
        from: e.from,
        to: e.to,
        tone: `${e.tone ?? ''}${e.kind === 'return' ? ':return' : ''}`,
        sources: choice.sources.filter((c) => !(c.side === 'left' && blockLeft(e.from))),
        targets: choice.targets.filter((c) => !(c.side === 'left' && blockLeft(e.to))),
        order: (isBack ? 1e6 : 0) + Math.abs(dCol) * 1000 + Math.abs(dLane),
      };
    })
    .sort((a, b) => a.order - b.order);
  const ends = Object.fromEntries(draft.edges.map((e) => [e.id, { from: e.from, to: e.to }]));
  const routed = nudge(routeEdges(rects, requests, { xs, ys }, obstacles), ends);

  const edges: Record<string, Point[]> = {};
  for (const e of draft.edges) {
    if (routed[e.id]) edges[e.id] = routed[e.id]!.map((p) => ({ x: round(p.x), y: round(p.y) }));
  }

  const frames = (draft.groups ?? []).flatMap((g) => (groupRects[g.id] ? [{ rect: groupRects[g.id]!, band: GROUP_LABEL, title: labelWidth(g.label) + 24 }] : []));
  const { labels } = placeLabels(draft.edges, edges, Object.values(rects), false, frames);

  const height = y - LANE_GAP + PAD;
  return {
    draft,
    nodes: rects,
    groups: groupRects,
    edges,
    lanes: laneRects,
    phases: phaseRects,
    labels,
    bounds: { width: round(bandX + bandW + PAD), height: round(height) },
  };
}
