import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Worker as Thread } from 'node:worker_threads';
import ElkApi from 'elkjs/lib/elk-api.js';
import ElkBundled from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';
import { cardSize, isLaneKind, usesCompactCards, type DiagramDraft, type Direction, type LaidOutDiagram, type Point, type Rect } from '@stackmap/core';
import { placeLabels } from './labels';
import { layoutLanes } from './lanes';
import { layoutSequence } from './sequence';

export { layoutLanes } from './lanes';
export { layoutSequence } from './sequence';

/** Vertical space reserved at the top of a group for its label. */
export const GROUP_LABEL_BAND = 48;
/** Stage bands (architecture/dataflow phases): the label band and the padding around their nodes. */
export const STAGE_LABEL_BAND = 44;
const STAGE_PAD = 20;
const COMPACT_GAP = { right: 72, max: 168 } as const;
/** Widest layer gap a full-card layout grows to so its labels fit. */
const FULL_GAP_MAX = 280;
const GROUP_LAYER_GAP = 80;
/** Past this many nodes (where validation warns to split), or edges, a layout takes ELK's cheaper settings and isn't
 * redone, to fix an edge against the flow or make room for labels: each ELK run grows roughly with the square of the
 * graph, and a diagram that size is read zoomed in anyway. */
const RETRY_LIMIT = 60;
const RETRY_EDGE_LIMIT = 3 * RETRY_LIMIT;
/** A diagram the layout treats as large: the CLI says so before laying one out, since it can still take a while. */
export const isLarge = (draft: DiagramDraft) => draft.nodes.length > RETRY_LIMIT || draft.edges.length > RETRY_EDGE_LIMIT;
const LAYER_GAP = 'elk.layered.spacing.nodeNodeBetweenLayers';
const EDGE_RUN = 'elk.layered.spacing.edgeNodeBetweenLayers';
const GROUP_PREFIX = 'group:';

/** ELK recurses along each connected run of the graph: a few hundred connected nodes overflow Node's ~1 MB stack. */
const ELK_STACK_MB = 256;

// A thread for Node: without a global `self`, elkjs's worker script exports its in-process worker, bridged to the port.
const NODE_THREAD = `
const { parentPort, workerData } = require('node:worker_threads');
const elk = new (require(workerData).Worker)();
elk.onmessage = ({ data }) => {
  try {
    parentPort.postMessage(data);
  } catch {
    // A GWT exception doesn't survive the structured clone.
    parentPort.postMessage({ id: data.id, error: { message: String((data.error && data.error.message) || data.error) } });
  }
};
parentPort.on('message', (msg) => elk.postMessage(msg));
`;

function threadElk(workerUrl: string): { elk: InstanceType<typeof ElkBundled>; dispose: () => void } {
  const thread = new Thread(NODE_THREAD, { eval: true, workerData: workerUrl, resourceLimits: { stackSizeMb: ELK_STACK_MB } });
  const pending = new Set<number>();
  const port = {
    onmessage: null as ((answer: { data: unknown }) => void) | null,
    postMessage(msg: { id: number }) {
      pending.add(msg.id);
      thread.postMessage(msg);
    },
    terminate: () => void thread.terminate(),
  };
  thread.on('message', (data: { id: number; error?: { message: string } }) => {
    pending.delete(data.id);
    port.onmessage?.({ data: data.error ? { ...data, error: new Error(data.error.message) } : data });
  });
  // A thread that dies (out of memory, say) answers nothing: fail what it was asked instead of hanging.
  thread.on('error', (error) => {
    for (const id of pending) port.onmessage?.({ data: { id, error } });
    pending.clear();
  });
  const elk = new ElkApi({ workerFactory: () => port as never });
  return { elk, dispose: () => elk.terminateWorker() };
}

/**
 * ELK in-process where a global `self` exists: its worker script, run with `self` hidden, exports the in-process worker
 * instead of taking over `self.onmessage`. Bun's fallback for a large graph where a child process can't be started.
 */
function mainThreadElk(workerUrl: string): InstanceType<typeof ElkBundled> {
  const mod: { exports: { Worker?: new () => unknown } } = { exports: {} };
  new Function('self', 'module', 'exports', readFileSync(workerUrl, 'utf8'))(undefined, mod, mod.exports);
  return new ElkApi({ workerFactory: () => new mod.exports.Worker!() as never });
}

/** Bun's stack is fixed at startup by the OS limit and a JavaScriptCore option, and its workers ignore stack limits. */
const BUN_STACK_KB = 512 * 1024;
const BUN_CHILD = `
const { readFileSync } = require('node:fs');
const [workerUrl, apiUrl] = process.argv.slice(1);
const mod = { exports: {} };
new Function('self', 'module', 'exports', readFileSync(workerUrl, 'utf8'))(undefined, mod, mod.exports);
const elk = new (require(apiUrl))({ workerFactory: () => new mod.exports.Worker() });
let input = '';
process.stdin.on('data', (c) => (input += c)).on('end', () =>
  elk.layout(JSON.parse(input)).then(
    (out) => process.stdout.write(JSON.stringify(out)),
    (e) => {
      process.stderr.write(String((e && e.message) || e));
      process.exit(1);
    },
  ),
);
`;

/** For Bun's large graphs: ELK in a child Bun started with room for its recursion (the densest need ~100 MB). */
function childElk(workerUrl: string): InstanceType<typeof ElkBundled> {
  const apiUrl = createRequire(import.meta.url).resolve('elkjs/lib/elk-api.js');
  // The option only when the limit rose: telling JavaScriptCore the stack is bigger than it is crashes instead of throwing.
  const script = `if ulimit -s ${BUN_STACK_KB} 2>/dev/null; then export BUN_JSC_maxPerThreadStackUsage=${BUN_STACK_KB * 1024}; fi; exec "$0" -e "$1" "$2" "$3"`;
  const layout = (graph: ElkNode) =>
    new Promise<ElkNode>((resolve, reject) => {
      const child = spawn('/bin/sh', ['-c', script, process.execPath, BUN_CHILD, workerUrl, apiUrl]);
      let out = '';
      let err = '';
      child.stdout.on('data', (c: Buffer) => (out += c));
      child.stderr.on('data', (c: Buffer) => (err += c));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(JSON.parse(out) as ElkNode) : reject(new Error(err.trim() || `ELK exited with code ${code}`))));
      child.stdin.end(JSON.stringify(graph));
    });
  return { layout } as never;
}

// elkjs's bundled build treats any runtime with a global `self` and no `document` as a web worker
// (Bun, Deno), hijacks `self.onmessage` and never exports its in-process worker. Give those runtimes
// a real Worker instead (a roomier child process for a large graph, above). Node keeps the in-process one, except for a large graph: that gets a thread with room for
// ELK's recursion (starting one costs more than laying out a small graph).
function createElk(large: boolean): { elk: InstanceType<typeof ElkBundled>; dispose: () => void } {
  const g = globalThis as { self?: unknown; document?: unknown; Worker?: unknown };
  const node = g.self === undefined && g.document === undefined;
  if (node ? !large : g.document !== undefined || g.Worker === undefined) return { elk: new ElkBundled(), dispose: () => {} };
  const workerUrl = createRequire(import.meta.url).resolve('elkjs/lib/elk-worker.min.js');
  if (node) return threadElk(workerUrl);
  if (large) return { elk: process.platform === 'win32' ? mainThreadElk(workerUrl) : childElk(workerUrl), dispose: () => {} };
  const elk = new ElkApi({ workerUrl });
  // A real Worker keeps the process alive until terminated; the in-process one has no terminate().
  return { elk, dispose: () => elk.terminateWorker() };
}

const rootOptions = (direction: Direction, compact: boolean, large: boolean): Record<string, string> => ({
  'elk.algorithm': 'layered',
  'elk.direction': direction,
  'elk.edgeRouting': 'ORTHOGONAL',
  // Cross-group edges must be routed by one layout run, not per container.
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.padding': '[top=40,left=40,bottom=40,right=40]',
  'elk.spacing.nodeNode': '40',
  'elk.spacing.edgeNode': '20',
  // The layer gap must fit an edge label pill, which is far wider than it is tall.
  // Full cards reserve a label pill in every gap; compact layouts start tight and widen for labels (compactLabels).
  'elk.layered.spacing.nodeNodeBetweenLayers': direction === 'RIGHT' ? String(compact ? COMPACT_GAP.right : 120) : '72',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
  // Network simplex straightens edges best but dominates the run time on large graphs.
  'elk.layered.nodePlacement.strategy': large ? 'BRANDES_KOEPF' : 'NETWORK_SIMPLEX',
  // Draft order is the author's intended stacking; ELK otherwise reorders ties freely. On a large graph keeping it
  // costs ELK more than everything else together (60s against 2s for 200 flat nodes), and so do its extra crossing
  // sweeps; a diagram that size is read zoomed in, not by its stacking.
  'elk.layered.considerModelOrder.strategy': large ? 'NONE' : 'NODES_AND_EDGES',
  ...(large && { 'elk.layered.thoroughness': '1' }),
  // Absolute coordinates everywhere, so the viewer never walks the hierarchy.
  'org.eclipse.elk.json.shapeCoords': 'ROOT',
  'org.eclipse.elk.json.edgeCoords': 'ROOT',
});

/**
 * Layout width (padding included) past which a ~1060px canvas fits the diagram below ~60% zoom, so the
 * layout is redone with wrapping. ELK's own wrap decision is scale-free (aspect ratio only) and would
 * also fold a short two-node chain, hence the width gate.
 */
const MAX_UNWRAPPED_WIDTH = 1600;

const wrapOptions: Record<string, string> = {
  'elk.layered.wrapping.strategy': 'SINGLE_EDGE',
  'elk.aspectRatio': '1.4',
  'elk.layered.wrapping.additionalEdgeSpacing': '40',
};

/**
 * Edges laid out against their drawn direction: every reply (`return`), then whatever still closes a cycle, found by
 * a depth-first walk from the entry points in draft order. ELK would otherwise break cycles itself and may pick the
 * entry call, pushing the caller below what it calls and sending that call round the whole diagram.
 */
export function reversedEdges(draft: DiagramDraft): Set<string> {
  const reversed = new Set(draft.edges.filter((e) => e.kind === 'return').map((e) => e.id));
  const out = new Map<string, { id: string; to: string }[]>(draft.nodes.map((n) => [n.id, []]));
  const fed = new Set<string>();
  for (const e of draft.edges) {
    if (e.from === e.to) continue;
    const [a, b] = reversed.has(e.id) ? [e.to, e.from] : [e.from, e.to];
    out.get(a)?.push({ id: e.id, to: b });
    fed.add(b);
  }
  const state = new Map<string, 'open' | 'done'>();
  const visit = (start: string) => {
    const stack: { id: string; next: number }[] = [{ id: start, next: 0 }];
    state.set(start, 'open');
    while (stack.length) {
      const top = stack.at(-1)!;
      const edge = out.get(top.id)![top.next++];
      if (!edge) {
        state.set(top.id, 'done');
        stack.pop();
      } else if (state.get(edge.to) === 'open') {
        // Points back at a node on the current path: flipping it (twice for a reply) keeps the flow acyclic.
        if (reversed.has(edge.id)) reversed.delete(edge.id);
        else reversed.add(edge.id);
      } else if (!state.has(edge.to)) {
        state.set(edge.to, 'open');
        stack.push({ id: edge.to, next: 0 });
      }
    }
  };
  for (const n of draft.nodes) if (!fed.has(n.id) && !state.has(n.id)) visit(n.id);
  for (const n of draft.nodes) if (!state.has(n.id)) visit(n.id);
  return reversed;
}

/**
 * The port an edge end attaches to. Edges of one style leaving (or entering) a card the same way share one, so a
 * hub's calls leave as a few trunks instead of a ribbon of parallel lines; their labels sit by the cards they name
 * (see placeLabels). Edges of another tone or line style get their own: on a shared trunk colours would hide each
 * other.
 */
function portKey(e: DiagramDraft['edges'][number], node: string, role: 'out' | 'in', flipped: boolean): string {
  return `${node}:${role}:${flipped ? 'flipped' : 'flow'}:${e.tone ?? ''}:${e.kind ?? 'sync'}`;
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function layoutDiagram(draft: DiagramDraft): Promise<LaidOutDiagram> {
  if (isLaneKind(draft.kind)) return layoutLanes(draft);
  if (draft.kind === 'sequence') return layoutSequence(draft);
  const direction = draft.direction ?? 'RIGHT';
  const compact = usesCompactCards(draft);
  const variant = compact ? 'compact' : 'full';
  const stages = draft.phases?.length ? stagePartitions(draft) : null;
  const large = isLarge(draft);
  const root: ElkNode = { id: 'root', layoutOptions: rootOptions(direction, compact, large), children: [], edges: [] };
  if (stages) {
    // Stages are ELK partitions: every node of stage i is laid out before (left of / above) stage i+1.
    root.layoutOptions!['elk.partitioning.activate'] = 'true';
    // Room for the stage labels above (RIGHT) or beside (DOWN) the first node row.
    root.layoutOptions!['elk.padding'] = direction === 'RIGHT' ? `[top=${40 + STAGE_LABEL_BAND},left=40,bottom=40,right=40]` : `[top=40,left=${40 + 160},bottom=40,right=40]`;
    // A stage band pads its nodes on both sides of the gap: keep a visible gutter between neighbours.
    root.layoutOptions!['elk.layered.spacing.nodeNodeBetweenLayers'] = String(Math.max(Number(root.layoutOptions!['elk.layered.spacing.nodeNodeBetweenLayers']), 2 * STAGE_PAD + 64));
  }

  const groupNodes = new Map<string, ElkNode>();
  for (const g of draft.groups ?? []) {
    groupNodes.set(g.id, {
      id: `${GROUP_PREFIX}${g.id}`,
      children: [],
      layoutOptions: {
        'elk.padding': `[top=${GROUP_LABEL_BAND},left=24,bottom=24,right=24]`,
        // Spacing doesn't inherit into containers. ELK's 20px layer gap can't fit a label pill plus an
        // arrowhead, and its 10px edge-node gap routes edges flush under cards.
        [LAYER_GAP]: String(GROUP_LAYER_GAP),
        'elk.spacing.edgeNode': '20',
      },
    });
  }
  const containerOf = (groupId: string | undefined, owner: string): ElkNode => {
    if (!groupId) return root;
    const g = groupNodes.get(groupId);
    if (!g) throw new Error(`${owner} references unknown group '${groupId}'`);
    return g;
  };

  for (const g of draft.groups ?? []) containerOf(g.parent, `Group '${g.id}'`).children!.push(groupNodes.get(g.id)!);

  const nodeIds = new Set<string>();
  for (const n of draft.nodes) {
    nodeIds.add(n.id);
    const { width, height } = cardSize(n.card, variant);
    const partition = stages?.get(n.id);
    containerOf(n.group, `Node '${n.id}'`).children!.push({
      id: n.id,
      width,
      height,
      // ELK orders and spaces the ports along the side to keep crossings down. Top-down, a short card would sit
      // centred on a taller neighbour's row; aligning tops keeps the row's titles on one line.
      layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE', ...(direction === 'DOWN' ? { 'elk.alignment': 'TOP' } : {}), ...(partition === undefined ? {} : { 'elk.partitioning.partition': String(partition) }) },
      ports: [],
    });
  }

  for (const e of draft.edges) {
    for (const end of [e.from, e.to]) {
      if (!nodeIds.has(end)) throw new Error(`Edge '${e.id}' references unknown node '${end}'`);
    }
  }
  const elkNodes = new Map<string, ElkNode>();
  const index = (c: ElkNode) => c.children?.forEach((k) => (elkNodes.set(k.id, k), index(k)));
  index(root);
  const wire = (reversed: Set<string>) => {
    for (const n of elkNodes.values()) if (n.ports) n.ports = [];
    root.edges = [];
    const portOf = (node: string, role: 'out' | 'in', key: string) => {
      const owner = elkNodes.get(node)!;
      if (!owner.ports!.some((p) => p.id === key)) {
        const side = direction === 'RIGHT' ? (role === 'out' ? 'EAST' : 'WEST') : role === 'out' ? 'SOUTH' : 'NORTH';
        owner.ports!.push({ id: key, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } });
      }
      return key;
    };
    for (const e of draft.edges) {
      const flipped = reversed.has(e.id);
      // Laid out from its target to its source; collect() turns the route back round.
      const [a, b] = flipped ? [e.to, e.from] : [e.from, e.to];
      root.edges.push({ id: e.id, sources: [portOf(a, 'out', portKey(e, a, 'out', flipped))], targets: [portOf(b, 'in', portKey(e, b, 'in', flipped))] });
    }
  };
  let reversed = reversedEdges(draft);
  wire(reversed);

  const { elk, dispose } = createElk(large);
  try {
    const run = async (room?: { gap: number; run: number }) => {
      const graph = structuredClone(root);
      if (room) {
        // The straight run into (and out of) a card becomes long enough to hold a label by the arrowhead.
        const set = (o: Record<string, string>, gap: number) => {
          o[LAYER_GAP] = String(gap);
          o[EDGE_RUN] = String(room.run);
        };
        set(graph.layoutOptions!, room.gap);
        // Groups lay out their own layers, so the wider gap has to reach them too.
        const widen = (c: ElkNode) =>
          c.children?.forEach((k) => {
            if (k.id.startsWith(GROUP_PREFIX)) set(k.layoutOptions!, Math.max(GROUP_LAYER_GAP, room.gap));
            widen(k);
          });
        widen(graph);
      }
      const opts = graph.layoutOptions!;
      // A large diagram is past the unwrapped width anyway, and its flow order isn't needed (no flips): lay it out once.
      if (large && !stages) {
        const wrapped = collect(draft, await elk.layout({ ...structuredClone(graph), layoutOptions: { ...opts, ...wrapOptions } }), direction, false, reversed);
        return { laid: wrapped, flow: wrapped.nodes };
      }
      const flat = await elk.layout(structuredClone(graph));
      // Wrapping would fold stages back onto each other.
      const wrap = (flat.width ?? 0) > MAX_UNWRAPPED_WIDTH && !stages;
      const result = wrap ? await elk.layout({ ...structuredClone(graph), layoutOptions: { ...opts, ...wrapOptions } }) : flat;
      // Flow order is read before wrapping, which moves later layers back to the start of a new row.
      return { laid: collect(draft, result, direction, stages !== null, reversed), flow: collect(draft, flat, direction, false, reversed).nodes };
    };
    let { laid, flow } = await run();
    // A group that both feeds and is fed by another can only sit on one side of it, so some edge between them runs
    // against the flow: entering its target from the far side, it wraps round the diagram. Lay such an edge out
    // from its target (it then leaves and enters by the facing sides) and redo the layout once.
    const flips = large ? [] : againstFlow(draft, flow, direction, reversed);
    if (flips.length) {
      reversed = new Set(reversed);
      for (const id of flips) reversed.has(id) ? reversed.delete(id) : reversed.add(id);
      wire(reversed);
      ({ laid } = await run());
    }
    const place = (l: LaidOutDiagram) => placeLabels(draft.edges, l.edges, Object.values(l.nodes), !compact, Object.values(l.groups).map((rect) => ({ rect, band: GROUP_LABEL_BAND })));
    let spots = place(laid);
    // A label that found no room to sit widens the layer gaps: compact layouts start tight on purpose, and a full
    // layout's gap can still be narrower than a label beside a branch. Two ways to make room are tried: wider gaps,
    // and wider gaps whose straight runs into and out of cards are themselves long enough to hold the label (left to
    // right a label lies along the run, top-down beside it). The best of the three layouts is kept.
    if (spots.misfit > 0 && !large) {
      const cap = compact ? COMPACT_GAP.max : FULL_GAP_MAX;
      const defaultRun = Number(root.layoutOptions![EDGE_RUN]);
      const gap = Math.min(cap, Math.max(Number(root.layoutOptions![LAYER_GAP]), spots.misfit + (compact ? 24 : 48)));
      const longRun = Math.min(direction === 'RIGHT' ? spots.misfit + 16 : 40, Math.floor((cap - 24) / 2));
      const tries = [
        { gap, run: defaultRun },
        { gap: Math.max(gap, 2 * longRun + 24), run: longRun },
      ];
      const worse = (a: typeof spots, b: typeof spots) => a.forced - b.forced || a.unseated - b.unseated || a.misfit - b.misfit;
      for (const room of tries) {
        const wider = (await run(room)).laid;
        const retry = place(wider);
        if (worse(retry, spots) < 0) [laid, spots] = [wider, retry];
        if (spots.unseated === 0) break;
      }
    }
    return { ...laid, labels: spots.labels };
  } finally {
    dispose();
  }
}

/**
 * Edges whose drawing direction disagrees with where their cards ended up: one that is laid out forward but whose
 * target sits wholly before its source along the flow, or one laid out reversed whose target sits wholly after it.
 */
function againstFlow(draft: DiagramDraft, nodes: Record<string, Rect>, direction: Direction, reversed: Set<string>): string[] {
  const span = (r: Rect): [number, number] => (direction === 'RIGHT' ? [r.x, r.x + r.width] : [r.y, r.y + r.height]);
  return draft.edges.flatMap((e) => {
    if (e.from === e.to) return [];
    const [s0, s1] = span(nodes[e.from]!);
    const [t0, t1] = span(nodes[e.to]!);
    const before = t1 <= s0;
    const after = t0 >= s1;
    return (reversed.has(e.id) ? after : before) ? [e.id] : [];
  });
}

function collect(draft: DiagramDraft, result: ElkNode, direction: Direction, staged: boolean, reversed: Set<string>): LaidOutDiagram {
  const nodes: Record<string, Rect> = {};
  const groups: Record<string, Rect> = {};
  const edges: Record<string, Point[]> = {};
  const visit = (container: ElkNode) => {
    for (const c of container.children ?? []) {
      const rect = { x: round(c.x ?? 0), y: round(c.y ?? 0), width: round(c.width ?? 0), height: round(c.height ?? 0) };
      if (c.id.startsWith(GROUP_PREFIX)) groups[c.id.slice(GROUP_PREFIX.length)] = rect;
      else nodes[c.id] = rect;
      visit(c);
    }
    // ELK may re-home edges into the lowest common ancestor, so collect from every level.
    for (const e of (container.edges ?? []) as ElkExtendedEdge[]) {
      edges[e.id] = squared(
        (e.sections ?? []).flatMap((s) => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]).map((p) => ({ x: round(p.x), y: round(p.y) })),
      );
      if (reversed.has(e.id)) edges[e.id]!.reverse();
    }
  };
  visit(result);
  straightenSteps(draft, nodes, edges);

  const bounds = { width: round(result.width ?? 0), height: round(result.height ?? 0) };
  if (!staged) return { draft, nodes, groups, edges, bounds };
  return { draft, nodes, groups, edges, bounds, phases: stageBands(draft, nodes, direction) };
}

/**
 * ELK spreads ports at thirds of a side, so a run meant to be straight can drift by a third of a pixel and render
 * as a soft, slanted hairline. Snap each such run to one whole coordinate (a run continuing a straight one keeps its
 * line) and drop the bends that no longer turn. Edges sharing a trunk share its points, so they snap alike.
 */
function squared(pts: Point[]): Point[] {
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!];
    const [dx, dy] = [Math.abs(a.x - b.x), Math.abs(a.y - b.y)];
    if (dx > 0 && dx < 1 && dy >= 1) a.x = b.x = i > 1 && pts[i - 2]!.x === a.x ? a.x : Math.round((a.x + b.x) / 2);
    else if (dy > 0 && dy < 1 && dx >= 1) a.y = b.y = i > 1 && pts[i - 2]!.y === a.y ? a.y : Math.round((a.y + b.y) / 2);
  }
  return pts.filter((p, i) => {
    const [prev, next] = [pts[i - 1], pts[i + 1]];
    if (!prev || !next) return true;
    return !((prev.x === p.x && p.x === next.x) || (prev.y === p.y && p.y === next.y));
  });
}

const STEP_MAX = 16;
// Clear of a card's rounded corner, and of its other ports.
const SIDE_INSET = 16;
const PORT_GAP = 8;

/**
 * Two facing ports a few pixels out of line come out of ELK as a shallow step, which reads as noise rather than a
 * turn. Draw it as one straight line by sliding an end along its side: the source first, so the arrowhead keeps its
 * place. Only an end no other edge shares moves (a trunk stays whole), and only where the line meets no card and
 * runs along no other route.
 */
function straightenSteps(draft: DiagramDraft, nodes: Record<string, Rect>, edges: Record<string, Point[]>): void {
  const near = (p: Point, q: Point, d: number) => Math.abs(p.x - q.x) < d && Math.abs(p.y - q.y) < d;
  const ends = () => Object.entries(edges).flatMap(([id, pts]) => [pts[0]!, pts.at(-1)!].map((p) => ({ id, p })));
  for (const e of draft.edges) {
    const pts = edges[e.id];
    if (e.from === e.to || pts?.length !== 4) continue;
    const [a, b, c, d] = pts as [Point, Point, Point, Point];
    const vertical = a.x === b.x;
    const step = vertical ? Math.abs(c.x - b.x) : Math.abs(c.y - b.y);
    // A Z, not a U: both ends run the same way, so the straight line still leaves and enters by the same sides.
    const z = vertical ? Math.sign(b.y - a.y) === Math.sign(d.y - c.y) : Math.sign(b.x - a.x) === Math.sign(d.x - c.x);
    if (!z || step === 0 || step >= STEP_MAX) continue;
    for (const [end, card, other] of [
      [a, nodes[e.from]!, d],
      [d, nodes[e.to]!, a],
    ] as const) {
      const moved = vertical ? { x: other.x, y: end.y } : { x: end.x, y: other.y };
      const along = vertical ? moved.x - card.x : moved.y - card.y;
      if (along < SIDE_INSET || along > (vertical ? card.width : card.height) - SIDE_INSET) continue;
      const rest = ends().filter((n) => n.id !== e.id);
      if (rest.some((n) => near(n.p, end, 0.5) || near(n.p, moved, PORT_GAP))) continue;
      const line = end === a ? [moved, d] : [a, moved];
      const [lo, hi] = vertical ? [Math.min(line[0]!.y, line[1]!.y), Math.max(line[0]!.y, line[1]!.y)] : [Math.min(line[0]!.x, line[1]!.x), Math.max(line[0]!.x, line[1]!.x)];
      const at = vertical ? moved.x : moved.y;
      const meetsCard = Object.entries(nodes).some(
        ([id, r]) => id !== e.from && id !== e.to && (vertical ? r.x < at && at < r.x + r.width && r.y < hi && lo < r.y + r.height : r.y < at && at < r.y + r.height && r.x < hi && lo < r.x + r.width),
      );
      const runsAlong = Object.entries(edges).some(
        ([id, q]) =>
          id !== e.id &&
          q.slice(1).some((v, i) => {
            const u = q[i]!;
            return vertical
              ? u.x === at && v.x === at && Math.min(u.y, v.y) < hi && lo < Math.max(u.y, v.y)
              : u.y === at && v.y === at && Math.min(u.x, v.x) < hi && lo < Math.max(u.x, v.x);
          }),
      );
      if (meetsCard || runsAlong) continue;
      edges[e.id] = line;
      break;
    }
  }
}

/** Partition per node: its phase, or for an unphased node the phase of its first placed predecessor (else 0). */
function stagePartitions(draft: DiagramDraft): Map<string, number> {
  const part = new Map<string, number>();
  draft.phases!.forEach((p, i) => p.nodes?.forEach((n) => part.has(n) || part.set(n, i)));
  for (let pass = 0; pass < draft.nodes.length; pass++) {
    let changed = false;
    for (const e of draft.edges) {
      if (part.has(e.from) && !part.has(e.to)) {
        part.set(e.to, part.get(e.from)!);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // Partitions only order the top level; grouped nodes are left to the group's own layout.
  const grouped = new Set(draft.nodes.filter((n) => n.group !== undefined).map((n) => n.id));
  for (const n of draft.nodes) if (!part.has(n.id)) part.set(n.id, 0);
  for (const id of grouped) part.delete(id);
  return part;
}

/** One band per stage: its nodes' extent along the flow, the whole diagram across it, plus the label band. */
function stageBands(draft: DiagramDraft, nodes: Record<string, Rect>, direction: Direction): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  const all = Object.values(nodes);
  if (!all.length) return out;
  const top = Math.min(...all.map((r) => r.y));
  const bottom = Math.max(...all.map((r) => r.y + r.height));
  const left = Math.min(...all.map((r) => r.x));
  const right = Math.max(...all.map((r) => r.x + r.width));
  for (const p of draft.phases ?? []) {
    const members = (p.nodes ?? []).flatMap((id) => nodes[id] ?? []);
    if (!members.length) continue;
    if (direction === 'RIGHT') {
      const x = Math.min(...members.map((r) => r.x)) - STAGE_PAD;
      const x2 = Math.max(...members.map((r) => r.x + r.width)) + STAGE_PAD;
      out[p.id] = { x: round(x), y: round(top - STAGE_PAD - STAGE_LABEL_BAND), width: round(x2 - x), height: round(bottom - top + 2 * STAGE_PAD + STAGE_LABEL_BAND) };
    } else {
      const y = Math.min(...members.map((r) => r.y)) - STAGE_PAD;
      const y2 = Math.max(...members.map((r) => r.y + r.height)) + STAGE_PAD;
      out[p.id] = { x: round(left - STAGE_PAD - 160), y: round(y), width: round(right - left + 2 * STAGE_PAD + 160), height: round(y2 - y) };
    }
  }
  return out;
}
