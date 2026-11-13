import type { DiagramDraft, DiagramEdge } from './types';

// Column assignment for the swimlane kinds (workflow, lifecycle). Pure, so layout places with it and validation
// can check what the placement implies (groups that would enclose other steps).

/**
 * Edges that run from a later phase into an earlier one, directly or through unphased nodes: laid out as back
 * edges (a phase can't start before the one it feeds), and reported by validation. Keyed by edge id; the value
 * is the index of the phase the edge leads back into.
 */
export function phaseViolations(draft: DiagramDraft): Map<string, number> {
  const phaseOf = new Map<string, number>();
  draft.phases?.forEach((p, i) => p.nodes?.forEach((n) => phaseOf.has(n) || phaseOf.set(n, i)));
  const out = new Map<string, number>();
  if (!phaseOf.size) return out;
  // The latest phase that reaches each node along forward edges; monotone and bounded by the phase count.
  const reach = new Map(draft.nodes.map((n) => [n.id, phaseOf.get(n.id) ?? -1]));
  const flow = draft.edges.filter((e) => e.kind !== 'return' && e.from !== e.to && reach.has(e.from) && reach.has(e.to));
  for (let changed = true, guard = 0; changed && guard <= draft.nodes.length * (draft.phases!.length + 1); guard++) {
    changed = false;
    for (const e of flow) {
      if (out.has(e.id)) continue;
      const r = reach.get(e.from)!;
      const target = phaseOf.get(e.to);
      if (target !== undefined && r > target) {
        out.set(e.id, target);
        changed = true;
      } else if (r > reach.get(e.to)!) {
        reach.set(e.to, r);
        changed = true;
      }
    }
  }
  return out;
}

/** Edges that don't push their target to a later column: replies, phase-order breaks, and what closes a cycle. */
export function backEdges(draft: DiagramDraft): Set<string> {
  const back = new Set(draft.edges.filter((e) => e.kind === 'return' || e.from === e.to).map((e) => e.id));
  for (const id of phaseViolations(draft).keys()) back.add(id);
  // DFS in draft order; an edge into a node still on the stack closes a cycle.
  const out = new Map(draft.nodes.map((n) => [n.id, [] as DiagramEdge[]]));
  for (const e of draft.edges) if (!back.has(e.id)) out.get(e.from)?.push(e);
  const state = new Map<string, 1 | 2>();
  const visit = (id: string) => {
    state.set(id, 1);
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.to);
      if (s === 1) back.add(e.id);
      else if (s === undefined && out.has(e.to)) visit(e.to);
    }
    state.set(id, 2);
  };
  const hasIn = new Set(draft.edges.filter((e) => !back.has(e.id)).map((e) => e.to));
  for (const n of draft.nodes) if (!hasIn.has(n.id) && !state.has(n.id)) visit(n.id);
  for (const n of draft.nodes) if (!state.has(n.id)) visit(n.id);
  return back;
}

/**
 * Column per node: longest path over forward edges. Within a lane a successor moves one column right; across
 * lanes it may stay in the same column (a straight drop). A phase starts after the previous phase ends.
 */
export function assignColumns(draft: DiagramDraft, back: Set<string>): Map<string, number> {
  const laneOf = new Map(draft.nodes.map((n) => [n.id, n.lane]));
  const laneIndex = new Map((draft.lanes ?? []).map((l, i) => [l.id, i]));
  const forward = draft.edges.filter((e) => !back.has(e.id) && laneOf.has(e.from) && laneOf.has(e.to));
  const phases = (draft.phases ?? []).map((p) => (p.nodes ?? []).filter((n) => laneOf.has(n)));
  const phaseOf = new Map<string, number>();
  phases.forEach((ns, i) => ns.forEach((n) => phaseOf.has(n) || phaseOf.set(n, i)));
  // Cross-lane edges that must still step right: their straight drop would run through a card.
  const step = new Set<string>();
  const settle = () => {
    const col = new Map(draft.nodes.map((n) => [n.id, 0]));
    const starts = phases.map(() => 0);
    // Monotone: columns only grow, and the forward edges are acyclic, so this settles (bounded for safety).
    for (let round = 0; round < draft.nodes.length * 4 + 8; round++) {
      let changed = false;
      const raise = (id: string, to: number) => {
        if (to > col.get(id)!) {
          col.set(id, to);
          changed = true;
        }
      };
      for (const [id, p] of phaseOf) raise(id, starts[p]!);
      for (const e of forward) raise(e.to, col.get(e.from)! + (laneOf.get(e.from) === laneOf.get(e.to) || step.has(e.id) ? 1 : 0));
      for (let p = 1; p < phases.length; p++) {
        const prevEnd = Math.max(starts[p - 1]!, ...phases[p - 1]!.map((n) => col.get(n)!));
        if (prevEnd + 1 > starts[p]!) {
          starts[p] = prevEnd + 1;
          changed = true;
        }
      }
      if (!changed) break;
    }
    return col;
  };
  let col = settle();
  // Each pass re-settles every column; a handful is plenty for real diagrams.
  for (let pass = 0; pass < Math.min(forward.length, 24); pass++) {
    // Stepping right is worth a column only inside the existing width; past it, routing around is cheaper.
    const last = Math.max(...col.values());
    const blocked = forward.find((e) => {
      if (step.has(e.id) || col.get(e.from) !== col.get(e.to) || col.get(e.from)! + 1 > last) return false;
      const [a, b] = [laneIndex.get(laneOf.get(e.from)!)!, laneIndex.get(laneOf.get(e.to)!)!].sort((x, y) => x - y);
      return draft.nodes.some((n) => n.id !== e.from && n.id !== e.to && col.get(n.id) === col.get(e.from) && laneIndex.get(n.lane!)! > a! && laneIndex.get(n.lane!)! < b!);
    });
    if (!blocked) break;
    step.add(blocked.id);
    col = settle();
  }
  // Safety net: close any empty columns (order kept), so no input can spread the lanes over blank space.
  const used = [...new Set(col.values())].sort((a, b) => a - b);
  const dense = new Map(used.map((c, i) => [c, i]));
  return new Map([...col].map(([id, c]) => [id, dense.get(c)!]));
}

