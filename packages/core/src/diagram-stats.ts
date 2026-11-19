import { NODE_TYPES, type DiagramKind, type DiagramNode, type NodeType } from './types';

export const KIND_LABELS: Record<DiagramKind, string> = {
  architecture: 'Architecture',
  dataflow: 'Dataflow',
  workflow: 'Workflow',
  lifecycle: 'Lifecycle',
  sequence: 'Sequence',
};

export const TYPE_LABELS: Record<NodeType, string> = {
  client: 'Client',
  service: 'Service',
  gateway: 'Gateway',
  database: 'Database',
  cache: 'Cache',
  queue: 'Queue',
  storage: 'Storage',
  external: 'External',
  security: 'Security',
  start: 'Start',
  active: 'Active',
  waiting: 'Waiting',
  decision: 'Decision',
  success: 'Success',
  failure: 'Failure',
  neutral: 'Neutral',
};

/** Past this many nodes validation warns to split the diagram, and the layout takes its cheaper settings. */
export const LARGE_DIAGRAM = 60;

export function countByType(nodes: DiagramNode[]): [NodeType, number][] {
  const counts = new Map<NodeType, number>();
  for (const n of nodes) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  return NODE_TYPES.filter((t) => counts.has(t)).map((t) => [t, counts.get(t)!]);
}
