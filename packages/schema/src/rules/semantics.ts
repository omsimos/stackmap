import { usesCompactCards, type DiagramDraft } from '@stackmap/core';
import type { Diagnostic } from '../diagnostics';

function duplicates(items: { id: string }[] | undefined, collection: string): Diagnostic[] {
  const first = new Map<string, number>();
  const taken = new Set(items?.map((x) => x.id));
  const unused = (id: string) => {
    let n = 2;
    while (taken.has(`${id}-${n}`)) n++;
    taken.add(`${id}-${n}`);
    return `${id}-${n}`;
  };
  const out: Diagnostic[] = [];
  items?.forEach(({ id }, i) => {
    const at = first.get(id);
    if (at === undefined) return void first.set(id, i);
    out.push({
      code: 'semantics/duplicate-id',
      severity: 'error',
      subject: `/${collection}/${i}/id`,
      message: `Duplicate ${collection.slice(0, -1)} id "${id}"`,
      evidence: { id, first: `/${collection}/${at}/id` },
      allowedFixes: [`rename to a unique id, e.g. "${unused(id)}"`, 'remove the duplicate'],
    });
  });
  return out;
}

/** Tarjan's strongly connected components; returns components with more than one node, in discovery order. */
function cycles(nodes: string[], edges: [string, string][]): string[][] {
  const adj = new Map(nodes.map((n) => [n, [] as string[]]));
  for (const [a, b] of edges) if (a !== b && adj.has(a) && adj.has(b)) adj.get(a)!.push(b);
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const on = new Set<string>();
  const out: string[][] = [];
  const visit = (v: string) => {
    idx.set(v, index);
    low.set(v, index++);
    stack.push(v);
    on.add(v);
    for (const w of adj.get(v)!) {
      if (!idx.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (on.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        on.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) out.push(comp.sort((a, b) => nodes.indexOf(a) - nodes.indexOf(b)));
    }
  };
  for (const n of nodes) if (!idx.has(n)) visit(n);
  return out;
}

const LARGE_DIAGRAM = 60;

/** Size, duplicate ids and row labels, orphans, self-loops, parallel edges, dataflow cycles, empty views and groups. */
export function semanticsDiagnostics(d: DiagramDraft): Diagnostic[] {
  const out: Diagnostic[] = [
    ...duplicates(d.nodes, 'nodes'),
    ...duplicates(d.edges, 'edges'),
    ...duplicates(d.groups, 'groups'),
    ...duplicates(d.views, 'views'),
    ...duplicates(d.lanes, 'lanes'),
    ...duplicates(d.phases, 'phases'),
  ];

  // Two rows under one label read as a typo, or as one fact split in two; the reader can't tell which.
  d.nodes.forEach((n, i) => {
    const first = new Map<string, number>();
    n.card.rows?.forEach((r, j) => {
      const key = r.label.trim().toLowerCase();
      const at = first.get(key);
      if (at === undefined) return void first.set(key, j);
      out.push({
        code: 'semantics/duplicate-row-label',
        severity: 'warning',
        subject: `/nodes/${i}/card/rows/${j}/label`,
        message: `Two rows on "${n.id}" are both labelled "${r.label.trim()}"`,
        evidence: { id: n.id, label: r.label, first: `/nodes/${i}/card/rows/${at}/label` },
        allowedFixes: ['merge the two rows into one (both values in one value)', 'give the second row its own label'],
      });
    });
  });

  d.nodes.forEach((n, i) => {
    if (n.card.statsNote !== undefined && !n.card.stats?.length)
      out.push({
        code: 'semantics/hidden-stats-note',
        severity: 'warning',
        subject: `/nodes/${i}/card/statsNote`,
        message: `The stats note on "${n.id}" is never shown: the card has no stats`,
        evidence: { id: n.id },
        allowedFixes: ['add "stats"', 'remove "statsNote"', 'move the note into a card row'],
      });
    // The card reserves the footer band whether or not anything is in it.
    if (n.card.footer && !n.card.footer.left && !n.card.footer.right && !usesCompactCards(d))
      out.push({
        code: 'semantics/empty-footer',
        severity: 'warning',
        subject: `/nodes/${i}/card/footer`,
        message: `The footer on "${n.id}" is empty: it draws a blank band`,
        evidence: { id: n.id },
        allowedFixes: ['add "left" or "right"', 'remove "footer"'],
      });
  });

  // The authoring contract aims for ~10–40 nodes; well past that cards are unreadable at fit, and a grouped
  // layout of a few hundred nodes takes ELK tens of seconds.
  if (d.nodes.length > LARGE_DIAGRAM)
    out.push({
      code: 'semantics/large-diagram',
      severity: 'warning',
      subject: '/nodes',
      message: `The diagram has ${d.nodes.length} nodes; past ~${LARGE_DIAGRAM} its cards are too small to read on one screen`,
      evidence: { nodes: d.nodes.length, limit: LARGE_DIAGRAM },
      allowedFixes: ['split it into an overview (subsystems as single nodes) plus one diagram per subsystem', 'merge nodes the reader need not tell apart'],
    });

  const linked = new Set(d.edges.flatMap((e) => [e.from, e.to]));
  if (d.nodes.length > 1) {
    d.nodes.forEach((n, i) => {
      if (!linked.has(n.id))
        out.push({
          code: 'semantics/orphan-node',
          severity: 'warning',
          subject: `/nodes/${i}`,
          message: `Node "${n.id}" has no connections`,
          evidence: { id: n.id },
          allowedFixes: [`add an edge to or from "${n.id}"`, 'remove the node'],
        });
    });
  }

  // A sequence message to oneself is a self-call, drawn as a loop on the lifeline.
  d.edges.forEach((e, i) => {
    if (e.from === e.to && d.kind !== 'sequence')
      out.push({
        code: 'semantics/self-loop',
        severity: 'warning',
        subject: `/edges/${i}`,
        message: `Edge "${e.id}" connects "${e.from}" to itself`,
        evidence: { id: e.id, node: e.from },
        // Compact cards have no rows: that fix would trade this warning for an error.
        allowedFixes: ['remove the edge', `describe the loop in ${usesCompactCards(d) ? 'an evidence note' : 'a card row'} instead`],
      });
  });

  // Two edges a → b of one style share their ports and draw as one line; of different styles they run side by side:
  // either way, one relationship drawn twice.
  if (d.kind === 'architecture' || d.kind === 'dataflow') {
    const first = new Map<string, string>();
    d.edges.forEach((e, i) => {
      if (e.from === e.to) return;
      const key = `${e.from}\u0000${e.to}`;
      const seen = first.get(key);
      if (seen === undefined) return void first.set(key, e.id);
      out.push({
        code: 'semantics/parallel-edge',
        severity: 'warning',
        subject: `/edges/${i}`,
        message: `Edges "${seen}" and "${e.id}" both run from "${e.from}" to "${e.to}"; the reader sees one relationship drawn twice`,
        evidence: { id: e.id, first: seen, from: e.from, to: e.to },
        allowedFixes: [`merge "${e.id}" into "${seen}" (one label for both)`, 'remove the edge'],
      });
    });
  }

  if (d.kind === 'dataflow') {
    // An async or return edge is an explicit feedback path (retry, event back-channel), so it doesn't close a cycle.
    const feedback = (e: { kind?: string }) => e.kind === 'async' || e.kind === 'return';
    const flow = d.edges.filter((e) => !feedback(e));
    for (const comp of cycles(d.nodes.map((n) => n.id), flow.map((e) => [e.from, e.to]))) {
      const members = new Set(comp);
      const i = d.edges.findIndex((e) => !feedback(e) && members.has(e.from) && members.has(e.to) && e.from !== e.to);
      out.push({
        code: 'semantics/dataflow-cycle',
        severity: 'warning',
        subject: `/edges/${i}`,
        message: `Data flows in a cycle through: ${comp.join(', ')}`,
        evidence: { nodes: comp },
        allowedFixes: ['remove or reverse the edge that feeds back', 'mark the feedback edge "kind": "async"'],
      });
    }
  }

  d.views?.forEach((v, i) => {
    if (v.nodes.length === 0)
      out.push({
        code: 'semantics/empty-view',
        severity: 'error',
        subject: `/views/${i}/nodes`,
        message: `View "${v.id}" focuses no nodes`,
        evidence: { id: v.id },
        allowedFixes: ['list the node ids this view focuses', 'remove the view'],
      });
  });

  const used = new Set([...d.nodes.map((n) => n.group), ...(d.groups ?? []).map((g) => g.parent)]);
  d.groups?.forEach((g, i) => {
    if (!used.has(g.id))
      out.push({
        code: 'semantics/empty-group',
        severity: 'warning',
        subject: `/groups/${i}`,
        message: `Group "${g.id}" contains no nodes or groups`,
        evidence: { id: g.id },
        allowedFixes: [`set "group": "${g.id}" on its nodes`, 'remove the group'],
      });
  });

  return out;
}
