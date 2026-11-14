import {
  assignColumns,
  backEdges,
  INFRA_TYPES,
  isCompactKind,
  isLaneKind,
  phaseViolations,
  STATE_TYPES,
  usesCompactCards,
  type DiagramDraft,
  type NodeType,
} from '@stackmap/core';
import type { Diagnostic } from '../diagnostics';
import { LIMITS } from '../schema';

const error = (code: string, subject: string, message: string, evidence: Record<string, unknown>, allowedFixes: string[]): Diagnostic => ({
  code,
  severity: 'error',
  subject,
  message,
  evidence,
  allowedFixes,
});

// The state a component most often stands for, and back: the fix names a concrete type, not just the list.
const STATE_FOR: Partial<Record<NodeType, NodeType>> = { client: 'start', external: 'neutral', security: 'decision', queue: 'waiting' };
const INFRA_FOR: Partial<Record<NodeType, NodeType>> = { start: 'client', active: 'service', waiting: 'queue', decision: 'security', success: 'service', failure: 'external', neutral: 'external' };

const COMPACT_ONLY_SECTIONS = ['rows', 'stats', 'statsNote', 'footer', 'cta'] as const;

/** Rules that depend on the diagram kind: lanes, phases, compact cards and the node types each kind uses. */
export function kindDiagnostics(d: DiagramDraft): Diagnostic[] {
  const out: Diagnostic[] = [];
  const lanes = isLaneKind(d.kind);
  const compact = usesCompactCards(d);
  const types: readonly NodeType[] = d.kind === 'lifecycle' ? STATE_TYPES : INFRA_TYPES;
  const laneIds = (d.lanes ?? []).map((l) => l.id);

  d.nodes.forEach((n, i) => {
    if (!types.includes(n.type)) {
      const near = (d.kind === 'lifecycle' ? STATE_FOR : INFRA_FOR)[n.type];
      out.push(
        error('semantics/type-for-kind', `/nodes/${i}/type`, `A ${d.kind} diagram has no "${n.type}" nodes`, { type: n.type, kind: d.kind, allowed: types }, [
          ...(near ? [`use "${near}"`] : []),
          `use one of: ${types.join(', ')}`,
        ]),
      );
    }
    if (lanes && n.lane === undefined && d.lanes?.length)
      out.push(error('semantics/missing-lane', `/nodes/${i}`, `Node "${n.id}" has no lane`, { id: n.id, lanes: laneIds }, laneIds.slice(0, 3).map((l) => `set "lane": "${l}"`)));
    if (!lanes && n.lane !== undefined)
      out.push(error('semantics/lane-for-kind', `/nodes/${i}/lane`, `Only workflow and lifecycle nodes sit in lanes`, { kind: d.kind }, ['remove "lane"', ...(d.kind === 'sequence' ? [] : ['use "group" instead'])]));
    if (compact) {
      for (const section of COMPACT_ONLY_SECTIONS) {
        if (n.card[section] !== undefined)
          out.push(
            error('semantics/card-section-for-kind', `/nodes/${i}/card/${section}`, `${isCompactKind(d.kind) ? d.kind : 'Compact'} cards show no ${section}`, { section, kind: d.kind }, [
              `remove "${section}"`,
              'move the detail into an evidence note',
              ...(isCompactKind(d.kind) ? [] : ['remove "density" to use full cards']),
            ]),
          );
      }
    } else if (n.card.tag !== undefined) {
      out.push(error('semantics/tag-for-kind', `/nodes/${i}/card/tag`, 'Only compact cards show a tag', { kind: d.kind }, ['move it into a card row', 'remove "tag"', 'set "density": "compact"']));
    }
  });

  if (isCompactKind(d.kind) && d.density !== undefined)
    out.push({ ...error('semantics/density-ignored', '/density', `${d.kind} cards are always compact`, { kind: d.kind }, ['remove "density"']), severity: 'warning' });

  // Swimlanes are routed edge by edge; past this they're slow to lay out and too dense to read anyway.
  if (lanes && d.nodes.length > LIMITS.laneNodes)
    out.push(error('semantics/too-many-for-kind', '/nodes', `A ${d.kind} diagram holds at most ${LIMITS.laneNodes} nodes (this one has ${d.nodes.length})`, { count: d.nodes.length, max: LIMITS.laneNodes }, [
      'split it into one diagram per phase or per lane group',
    ]));

  if (lanes && !d.lanes?.length)
    out.push(error('semantics/missing-lanes', '', `A ${d.kind} diagram needs "lanes"`, { kind: d.kind }, ['add "lanes": [{ "id": …, "label": … }] and set each node\'s "lane"']));
  if (!lanes && d.lanes)
    out.push(error('semantics/lanes-for-kind', '/lanes', 'Only workflow and lifecycle diagrams have lanes', { kind: d.kind }, ['remove "lanes"', ...(d.kind === 'sequence' ? [] : ['use "groups" instead'])]));
  if (lanes) {
    const used = new Set(d.nodes.map((n) => n.lane));
    d.lanes?.forEach((l, i) => {
      if (!used.has(l.id))
        out.push({ ...error('semantics/empty-lane', `/lanes/${i}`, `Lane "${l.id}" has no nodes`, { id: l.id }, [`set "lane": "${l.id}" on its nodes`, 'remove the lane']), severity: 'warning' });
    });
  }

  if ((lanes || d.kind === 'sequence') && d.direction !== undefined)
    out.push({
      ...error('semantics/direction-ignored', '/direction', `${d.kind} diagrams always flow left to right${d.kind === 'sequence' ? ' and top to bottom' : ''}`, { kind: d.kind }, ['remove "direction"']),
      severity: 'warning',
    });

  if (d.kind === 'sequence' && d.groups)
    out.push(error('semantics/groups-for-kind', '/groups', 'Sequence diagrams have no groups', { kind: d.kind }, ['remove "groups"', 'use "phases" to band messages']));
  if (lanes) {
    const laneOf = new Map(d.nodes.map((n) => [n.id, n.lane]));
    d.groups?.forEach((g, i) => {
      if (g.parent !== undefined)
        out.push(error('semantics/nested-group-for-kind', `/groups/${i}/parent`, `Groups in a ${d.kind} diagram don't nest`, { id: g.id }, ['remove "parent"']));
      const members = d.nodes.filter((n) => n.group === g.id);
      const memberLanes = [...new Set(members.map((n) => laneOf.get(n.id)))];
      if (memberLanes.length > 1)
        out.push(
          error('semantics/group-spans-lanes', `/groups/${i}`, `Group "${g.id}" spans lanes ${memberLanes.join(', ')}; a group sits inside one lane`, { id: g.id, lanes: memberLanes }, [
            'split it into one group per lane',
            'move its nodes into one lane',
          ]),
        );
    });
  }

  out.push(...phaseDiagnostics(d));
  if (lanes && d.lanes?.length) out.push(...laneGroupDiagnostics(d));
  if (d.kind === 'sequence') out.push(...sequenceDiagnostics(d));
  return out;
}

/** Replies that answer nothing, and time bands that overlap (each band spans its first to its last message). */
function sequenceDiagnostics(d: DiagramDraft): Diagnostic[] {
  const out: Diagnostic[] = [];
  // Calls still waiting for a reply, per (caller → callee) pair.
  const waiting = new Map<string, number>();
  d.edges.forEach((e, i) => {
    if (e.from === e.to) return;
    if (e.kind !== 'return') {
      if (e.kind !== 'async') waiting.set(`${e.from}>${e.to}`, (waiting.get(`${e.from}>${e.to}`) ?? 0) + 1);
      return;
    }
    const key = `${e.to}>${e.from}`;
    const open = waiting.get(key) ?? 0;
    if (open > 0) waiting.set(key, open - 1);
    else
      out.push({
        ...error('semantics/unmatched-return', `/edges/${i}`, `Reply "${e.id}" answers no earlier call from "${e.to}" to "${e.from}"`, { id: e.id }, [
          `add the call from "${e.to}" to "${e.from}" before it`,
          'remove "kind": "return" if it is a call of its own',
        ]),
        severity: 'warning',
      });
  });

  const row = new Map(d.edges.map((e, i) => [e.id, i]));
  const spans = (d.phases ?? []).flatMap((p, i) => {
    const rows = (p.edges ?? []).flatMap((id) => (row.has(id) ? [row.get(id)!] : []));
    return rows.length ? [{ i, id: p.id, first: Math.min(...rows), last: Math.max(...rows) }] : [];
  });
  // A band spans its first to its last message: messages in between it doesn't list are in it anyway.
  for (const sp of spans) {
    const listed = new Set(d.phases![sp.i]!.edges);
    const unlisted = d.edges.slice(sp.first, sp.last + 1).filter((e) => !listed.has(e.id)).map((e) => e.id);
    if (unlisted.length)
      out.push({
        ...error('semantics/phase-gap', `/phases/${sp.i}/edges`, `Phase "${sp.id}" also covers ${unlisted.map((x) => `"${x}"`).join(', ')}, between its first and last message`, { id: sp.id, unlisted }, [
          `add ${unlisted.map((x) => `"${x}"`).join(', ')} to the phase`,
          'reorder the messages so the band is contiguous',
        ]),
        severity: 'warning',
      });
  }
  for (let k = 1; k < spans.length; k++) {
    const prev = spans[k - 1]!;
    const cur = spans[k]!;
    if (cur.first <= prev.last)
      out.push(
        error('semantics/phase-overlap', `/phases/${cur.i}`, `Phase "${cur.id}" starts before phase "${prev.id}" ends; time bands follow each other`, { id: cur.id, previous: prev.id }, [
          `list only messages after "${d.edges[prev.last]!.id}" in "${cur.id}"`,
          'reorder the phases to follow the messages',
        ]),
      );
  }
  return out;
}

function phaseDiagnostics(d: DiagramDraft): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!d.phases) return out;
  const lanes = isLaneKind(d.kind);
  const byNodes = d.kind !== 'sequence';
  const want = byNodes ? 'nodes' : 'edges';
  const other = byNodes ? 'edges' : 'nodes';
  const owner = new Map<string, number>();
  d.phases.forEach((p, i) => {
    if (p[other] !== undefined)
      out.push(error('semantics/phase-members', `/phases/${i}/${other}`, `${d.kind} phases list ${want}, not ${other}`, { kind: d.kind }, [`replace "${other}" with the "${want}" this phase spans`]));
    const members = p[want];
    if (!members?.length) {
      out.push(error('semantics/phase-members', `/phases/${i}`, `Phase "${p.id}" lists no ${want}`, { id: p.id }, [`list the ${want} this phase spans in "${want}"`, 'remove the phase']));
      return;
    }
    members.forEach((m, j) => {
      const first = owner.get(m);
      if (first !== undefined && first !== i)
        out.push(error('semantics/phase-overlap', `/phases/${i}/${want}/${j}`, `"${m}" is already in phase "${d.phases![first]!.id}"`, { id: m, phase: d.phases![first]!.id }, [`remove "${m}" from one of the two phases`]));
      else owner.set(m, i);
    });
  });

  if (byNodes && !lanes) {
    // Stages are laid out as ELK partitions of the top level: a grouped node can't take part.
    d.nodes.forEach((n, i) => {
      if (n.group !== undefined && owner.has(n.id))
        out.push(error('semantics/phase-member-in-group', `/nodes/${i}/group`, `Node "${n.id}" is in a phase and a group; phases hold ungrouped nodes`, { id: n.id }, ['remove "group"', `remove "${n.id}" from its phase`]));
      else if (!owner.has(n.id) && n.group === undefined)
        out.push({ ...error('semantics/unphased-node', `/nodes/${i}`, `Node "${n.id}" is in no phase; it is placed in its first predecessor's`, { id: n.id }, ['add it to a phase\'s "nodes"']), severity: 'warning' });
    });
  }

  if (byNodes) {
    // A later phase flowing back into an earlier one (directly or through unphased steps) is laid out as a back
    // edge; say so, it's usually a mistake.
    const back = phaseViolations(d);
    d.edges.forEach((e, i) => {
      const phase = back.get(e.id);
      if (phase === undefined) return;
      const into = d.phases![phase]!.id;
      out.push({
        ...error('semantics/phase-order', `/edges/${i}`, `Edge "${e.id}" leads back into phase "${into}" from a later phase`, { id: e.id, phase: into }, [
          'mark it "kind": "return" if it loops back on purpose',
          'reorder the phases',
          ...(owner.has(e.from) ? [] : [`put "${e.from}" in a phase`]),
        ]),
        severity: 'warning',
      });
    });
  }
  return out;
}

/** A lane group is drawn around its members: it must not end up enclosing another step of the same lane. */
function laneGroupDiagnostics(d: DiagramDraft): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!d.groups?.length) return out;
  const col = assignColumns(d, backEdges(d));
  d.groups.forEach((g, i) => {
    const members = d.nodes.filter((n) => n.group === g.id && n.lane !== undefined);
    const lanes = new Set(members.map((n) => n.lane));
    if (members.length < 2 || lanes.size !== 1) return;
    const cs = members.map((n) => col.get(n.id)!);
    const [lo, hi] = [Math.min(...cs), Math.max(...cs)];
    const inside = d.nodes.filter((n) => n.group !== g.id && lanes.has(n.lane) && col.get(n.id)! >= lo && col.get(n.id)! <= hi).map((n) => n.id);
    if (inside.length)
      out.push({
        ...error('semantics/group-not-contiguous', `/groups/${i}`, `Group "${g.id}" would also frame ${inside.map((x) => `"${x}"`).join(', ')}, which sit between its steps`, { id: g.id, inside }, [
          `add ${inside.map((x) => `"${x}"`).join(', ')} to the group`,
          'split the group into neighbouring steps',
        ]),
        severity: 'warning',
      });
  });
  return out;
}
