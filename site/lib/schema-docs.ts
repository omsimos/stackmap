// The schema page's prose and samples, by section anchor. The fields themselves come from the generated schema.
import { REPO, schemaUrl } from './package';

export interface SchemaSample {
  /** where the sample sits in a diagram: the label over it */
  file: string;
  value: unknown;
  /** how to drop the sample into a diagram, so the tests can check it against the real schema */
  place: 'diagram' | 'array' | 'card' | 'node' | 'source';
}

export const INTROS: Record<string, string> = {
  diagram: 'The top level. `kind` picks the layout; the arrays hold everything the diagram draws. Objects are strict, so an unknown key is an error.',
  nodes: 'One per runtime unit the reader must tell apart: a service, a store, a queue, a person, a state.',
  evidence: 'Where a node came from: a file, a line and a note. The inspector lists it, and with `source.url` set, every entry links to its line.',
  source: 'Set `source.url` on the diagram and every evidence entry links to `<url>/<file>#L<line>`. Use a commit, not a branch, so the lines stay right.',
  edges: 'From the initiator to what it calls (architecture), or the way the data moves (dataflow). Plain for a call, `async` for queues and events, `return` for a reply or a roll back.',
  groups: 'Boundaries a reader should see: tiers, trust zones, VPCs, clusters. Nest them with `parent`; `"tone": "security"` marks a trust zone.',
  lanes: 'Workflow and lifecycle swimlanes: full-width rows, top to bottom in the order you list them.',
  phases: 'Labelled stretches: columns over lanes (workflow), stages of a pipeline (architecture, dataflow), bands of time (sequence).',
  views: 'Named focus sets, one tab each. A view dims everything else and fits its members; Overview is always first.',
  notes: 'The diagram’s takeaways, listed in the inspector. Two or three, a few short items each: what the picture means, not what it shows.',
};

/** The sample card: every part a card can have, drawn by the viewer's own card beside its JSON. */
export const SAMPLE_CARD = {
  title: 'Orders',
  subtitle: 'PostgreSQL cluster',
  brand: 'postgresql',
  stats: [
    { value: '1', label: 'Primary' },
    { value: '2', label: 'Read replicas' },
  ],
  statsNote: '2 replication links',
  footer: { left: { text: 'EU West', icon: 'region' }, right: { text: '3 members', icon: 'members' } },
  cta: { label: 'Open cluster', href: 'https://console.example.com/clusters/orders' },
};

export const SAMPLES: Record<string, SchemaSample> = {
  nodes: {
    file: 'nodes',
    place: 'array',
    value: [
      { id: 'api', type: 'service', card: { title: 'shop-api', subtitle: 'REST API' }, evidence: [{ file: 'services/api/src/server.ts', line: 12 }] },
      { id: 'orders', type: 'database', group: 'data', card: { title: 'Orders DB', subtitle: 'PostgreSQL', brand: 'postgresql' }, evidence: [{ file: 'infra/orders/postgres.tf', line: 12 }] },
    ],
  },
  cards: { file: 'nodes[].card', place: 'card', value: SAMPLE_CARD },
  'card-parts': {
    file: 'nodes[].card',
    place: 'card',
    value: {
      title: 'API',
      rows: [
        { label: 'Instances', value: '3' },
        { label: 'Port', value: ':8080', mono: true },
      ],
      stats: SAMPLE_CARD.stats,
      footer: SAMPLE_CARD.footer,
      cta: SAMPLE_CARD.cta,
    },
  },
  evidence: {
    file: 'nodes[].evidence',
    place: 'node',
    value: [
      { file: 'services/api/src/server.ts', line: 12, note: 'Express app and routes' },
      { file: 'infra/orders/postgres.tf', line: 12, note: 'Primary + 2 read replicas' },
      { file: 'services/api/src/db.ts', line: 8 },
    ],
  },
  source: { file: 'source', place: 'source', value: { url: `${REPO}/blob/a2111f0590892de04f16c2d2f11ad877a502d89b` } },
  edges: {
    file: 'edges',
    place: 'array',
    value: [
      { id: 'web-cdn', from: 'web', to: 'cdn', label: 'HTTPS' },
      { id: 'api-jobs', from: 'api', to: 'jobs', label: 'enqueue', kind: 'async' },
      { id: 'e1', from: 'commit', to: 'pull-request', tone: 'main' },
      { id: 'ok', from: 'fraud', to: 'api', label: 'low risk', kind: 'return' },
    ],
  },
  groups: {
    file: 'groups',
    place: 'array',
    value: [
      { id: 'blocking-checks', label: 'Blocking checks' },
      { id: 'recovery', label: 'Recovery path', tone: 'security' },
    ],
  },
  lanes: {
    file: 'lanes',
    place: 'array',
    value: [
      { id: 'dev', label: 'Developer' },
      { id: 'ci', label: 'Continuous integration' },
      { id: 'exceptions', label: 'Failure and rollback', tone: 'exception' },
    ],
  },
  phases: {
    file: 'phases',
    place: 'array',
    value: [
      { id: 'change', label: 'Change', nodes: ['commit', 'pull-request'] },
      { id: 'request', label: 'Request', edges: ['open', 'get', 'verify', 'claims'] },
    ],
  },
  views: {
    file: 'views',
    place: 'array',
    value: [
      { id: 'checkout', label: 'Checkout path', caption: 'What a purchase touches', nodes: ['web', 'cdn', 'api', 'stripe', 'db'] },
      { id: 'state', label: 'State', caption: 'Where data lives', nodes: ['db', 'cache', 'jobs'] },
    ],
  },
  notes: {
    file: 'notes',
    place: 'array',
    value: [
      { title: 'One happy path', items: ['Every change is reviewed before a reproducible build', 'Blocking checks must be green before human approval'] },
      { title: 'Stop conditions', items: ['Test or security failure stops promotion', 'Production health can reverse a release'] },
    ],
  },
};

/** A real diagram's top level, its arrays elided to their lengths: the shape, not the contents. */
export function diagramOutline(version: string, draft: object): string {
  const d = draft as Record<string, unknown>;
  const keys = ['kind', 'title', 'subtitle', 'direction'].filter((k) => d[k] !== undefined).map((k) => `  "${k}": ${JSON.stringify(d[k])}`);
  const arrays = ['groups', 'lanes', 'phases', 'nodes', 'edges', 'views', 'notes'].flatMap((k) => (Array.isArray(d[k]) && d[k].length ? [`  "${k}": [ … ${d[k].length} ]`] : []));
  return ['{', [`  "$schema": "${schemaUrl(version)}"`, ...keys, ...arrays].join(',\n'), '}'].join('\n');
}
