import * as z from 'zod';
import { DIAGRAM_KINDS, NODE_TYPES } from '@stackmap/core';

// Mirrors the hand-written types in @stackmap/core (a type test keeps them identical). Objects are strict
// so a misspelt key is reported instead of silently dropped.

export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
// Size caps keep validation and layout fast and the diagram readable; beyond them, split into views.
export const LIMITS = { rows: 6, stats: 3, evidence: 8, edgeLabel: 24, nodes: 500, edges: 2000, groups: 200, views: 50, laneNodes: 200, lanes: 20, phases: 20, notes: 6, noteItems: 6 } as const;
export const VISIBLE_TEXT = /\S/;

const id = z.string().regex(ID_PATTERN);
const text = z.string().regex(VISIBLE_TEXT);
// A regex rather than z.url(): it carries into the JSON Schema, and only http(s) may become a link.
export const HTTP_URL = /^https?:\/\/\S+$/;
/** Repo-relative: no leading "/", no ".." segment, no backslash, no scheme; evidence links join it onto source.url. */
export const REPO_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*:\/\/).*\S.*$/;
const httpUrl = z.string().regex(HTTP_URL);

const FooterItem = z.strictObject({
  text,
  icon: z.enum(['region', 'secure', 'members']).optional(),
});

const Card = z.strictObject({
  title: text.meta({ description: 'Card title. Must fit the card; `stackmap validate` reports the character budget.' }),
  subtitle: text.optional(),
  brand: z.string().optional().meta({ description: 'simple-icons slug shown in the icon tile, e.g. "postgresql".' }),
  rows: z
    .array(z.strictObject({ label: text, value: text, mono: z.boolean().optional() }))
    .max(LIMITS.rows)
    .optional()
    .meta({ description: 'Key/value rows. `mono` renders the value in Geist Mono (ports, IPs).' }),
  stats: z
    .array(z.strictObject({ value: text, label: text }))
    .max(LIMITS.stats)
    .optional()
    .meta({ description: 'Stat tiles, e.g. replica counts.' }),
  statsNote: text.optional().meta({ description: 'Line under the stat tiles; only shown with stats.' }),
  footer: z.strictObject({ left: FooterItem.optional(), right: FooterItem.optional() }).optional(),
  cta: z
    .strictObject({
      label: text,
      href: httpUrl.optional(),
    })
    .optional(),
  tag: text.optional().meta({ description: 'Compact cards only (workflow, lifecycle, sequence, or density "compact"): a short pill, e.g. "human gate".' }),
});

const Evidence = z.strictObject({
  file: z.string().regex(REPO_PATH).meta({ description: 'Repo-relative path, e.g. "src/orders/api.ts".' }),
  line: z.number().int().positive().optional(),
  note: text.optional(),
});

const Node = z.strictObject({
  id,
  type: z.enum(NODE_TYPES).meta({
    description: 'Sets the card color. Never color by brand. Lifecycle diagrams use the state types (start, active, waiting, decision, success, failure, neutral); every other kind uses the component types.',
  }),
  group: id.optional().meta({ description: 'Id of the group the node sits in.' }),
  lane: id.optional().meta({ description: 'Workflow and lifecycle: id of the lane the node sits in (required there).' }),
  card: Card,
  evidence: z
    .array(Evidence)
    .max(LIMITS.evidence)
    .optional()
    .meta({ description: 'Source locations backing this node; listed in the inspector.' }),
});

const Edge = z.strictObject({
  id,
  from: id.meta({ description: 'Source node id.' }),
  to: id.meta({ description: 'Target node id.' }),
  label: text.max(LIMITS.edgeLabel).optional().meta({ description: 'Short label; use sparingly.' }),
  kind: z.enum(['sync', 'async', 'return']).optional().meta({ description: 'async renders dashed; return (a reply, a roll back) renders dotted.' }),
  tone: z
    .enum(['main', 'security', 'error'])
    .optional()
    .meta({ description: 'main marks the happy path; security and error paths take those tints. Use sparingly.' }),
});

const Group = z.strictObject({
  id,
  label: text.meta({ description: 'Shown above the frame.' }),
  parent: id.optional().meta({ description: 'Id of the enclosing group, for nesting.' }),
  tone: z.enum(['security']).optional().meta({ description: 'A trust boundary (private network, PII zone).' }),
});

const Lane = z.strictObject({
  id,
  label: text,
  tone: z.enum(['exception']).optional().meta({ description: 'A lane for failure and recovery paths.' }),
});

const Phase = z.strictObject({
  id,
  label: text,
  nodes: z
    .array(id)
    .optional()
    .meta({ description: 'Workflow and lifecycle: the nodes whose columns this phase spans. Architecture and dataflow: the nodes in this stage.' }),
  edges: z.array(id).optional().meta({ description: 'Sequence: the messages this time band spans.' }),
});

const Note = z.strictObject({
  title: text,
  items: z.array(text).min(1).max(LIMITS.noteItems),
});

const View = z.strictObject({
  id,
  label: text,
  caption: text.optional(),
  nodes: z.array(id).meta({ description: 'Node ids this guided view focuses; the rest are dimmed.' }),
});

export const DiagramDraftSchema = z
  .strictObject({
    $schema: z.string().optional().meta({ description: `Optional; set it to ${'`'}https://unpkg.com/@omsimos/stackmap@0.5.0/dist/stackmap.schema.json${'`'} for editor completion.` }),
    kind: z.enum(DIAGRAM_KINDS),
    density: z
      .enum(['compact'])
      .optional()
      .meta({ description: 'Architecture and dataflow: compact cards (title, subtitle, brand, tag) for long chains or summaries.' }),
    title: text,
    subtitle: text.optional(),
    source: z
      .strictObject({ url: httpUrl })
      .optional()
      .meta({ description: 'Base URL for evidence links: `<url>/<file>#L<line>`.' }),
    direction: z.enum(['RIGHT', 'DOWN']).optional().meta({ description: 'Layout flow. Default RIGHT; prefer DOWN for tiered/grouped diagrams.' }),
    groups: z.array(Group).max(LIMITS.groups).optional(),
    lanes: z.array(Lane).max(LIMITS.lanes).optional().meta({ description: 'Workflow and lifecycle: swimlanes, top to bottom.' }),
    phases: z
      .array(Phase)
      .max(LIMITS.phases)
      .optional()
      .meta({ description: 'Ordered stages: header bands over columns (workflow, lifecycle), stage bands in flow order (architecture, dataflow) or time bands (sequence).' }),
    nodes: z.array(Node).min(1).max(LIMITS.nodes),
    edges: z.array(Edge).max(LIMITS.edges).meta({ description: 'Connections. In a sequence, the messages, in time order.' }),
    views: z.array(View).max(LIMITS.views).optional(),
    notes: z.array(Note).max(LIMITS.notes).optional().meta({ description: 'Takeaways about the diagram, shown in the inspector.' }),
  })
  .meta({ title: 'stackmap diagram', description: 'Agent-authored diagram. Layout is computed by stackmap; never give coordinates.' });

/** Served from the published CLI package, so it is pinned to the same version as the validator. */
export const SCHEMA_ID = 'https://unpkg.com/@omsimos/stackmap@0.5.0/dist/stackmap.schema.json';

export function buildJsonSchema(): Record<string, unknown> {
  return { ...z.toJSONSchema(DiagramDraftSchema, { target: 'draft-2020-12' }), $id: SCHEMA_ID };
}
