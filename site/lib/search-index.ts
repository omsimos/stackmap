import { DIAGRAM_KINDS, KIND_LABELS } from '@stackmap/core';
import schema from '@/generated/schema.json';
import { EXAMPLES, exampleHref } from './catalog';
import type { SchemaSection } from './data/schema-ref';
import { diagramOf } from './diagrams';
import { DOC_PAGES, kindHref } from './docs-nav';
import { KIND_PAGES } from './kinds';
import { CLI_COMMANDS, CLI_OPTIONS, EXIT_CODES, VIEWER_KEYS } from './reference';
import { PLACEMENTS } from './schema-page';
import type { SearchEntry } from './search';
import { SITE } from './site-data';

// What each page and section also answers to, beyond its own title.
const WORDS: Record<string, string> = {
  '/docs': 'install setup start begin skill agent claude cursor codex',
  '/docs#install': 'npx skills add claude code cursor codex setup',
  '/docs#ask': 'prompt request agent',
  '/docs#open': 'browser offline file html read-only',
  '/docs#write': 'json diagram.json nodes edges coordinates types',
  '/docs#repair': 'validate errors fix diagnostics repair loop deliver exit code',
  '/docs#next': 'more links',
  '/docs/viewer': 'viewer html file inspector select trace route search lens views present play share export keyboard',
  '/docs/viewer#try': 'demo interactive select trace route find views play',
  '/docs/viewer#share': 'url hash link parameters deep link',
  '/docs/viewer#present': 'full screen slides presentation focus canvas only hide toolbar zen',
  '/docs/viewer#export': 'png jpeg webp svg video download image',
  '/docs/viewer#keys': 'shortcuts keyboard hotkeys',
  '/docs/viewer#themes': 'dark light theme reduced motion animation',
  '/docs/cli': 'command line terminal npx validate deliver serve exit code diagnostics',
  '/docs/cli#run': 'npx node install version',
  '/docs/cli#validate': 'check errors lint',
  '/docs/cli#deliver': 'build write html receipt sha256 deterministic output',
  '/docs/cli#serve': 'live reload watch port localhost dev server',
  '/docs/cli#options': 'flags arguments',
  '/docs/cli#diagnostics': 'errors warnings fix json pointer severity subject',
  '/docs/cli#codes': 'error codes list',
  '/docs/cli#exit': 'exit status code',
  '/docs/schema': 'json fields reference types required diagram.json',
  '/docs/schema#diagram': 'top level kind title direction density',
  '/docs/schema#nodes': 'node id type group lane',
  '/docs/schema#cards': 'card title subtitle brand rows stats footer cta tag',
  '/docs/schema#card-parts': 'rows stats footer cta icon region secure members',
  '/docs/schema#evidence': 'file line note source code',
  '/docs/schema#source': 'url github gitlab links commit',
  '/docs/schema#edges': 'connections edges from to kind async return tone label',
  '/docs/schema#groups': 'group parent tone security boundary',
  '/docs/schema#lanes': 'swimlanes lane tone exception',
  '/docs/schema#phases': 'stages columns bands time',
  '/docs/schema#views': 'tabs focus caption',
  '/docs/schema#notes': 'takeaways inspector',
  '/docs/brands': 'logos icons simple icons brand',
  kind: 'json sample figure',
  'kind#example': 'json sample figure',
  'kind#parts': 'legend anatomy',
  'kind#rules': 'authoring contract guidance best practice',
  'kind#ask': 'prompt request agent',
  'kind#examples': 'gallery samples',
};

const SUGGESTED = new Set(['/docs', '/docs/viewer', kindHref('architecture'), '/docs/cli', '/docs/schema', '/examples']);
const KIND_HREFS = new Set<string>(DIAGRAM_KINDS.map(kindHref));

/** Everything the docs search can find, built on the server from the same data the pages render. */
export function searchIndex(): SearchEntry[] {
  const out: SearchEntry[] = [];
  const push = (e: SearchEntry) => out.push(SUGGESTED.has(e.href) ? { ...e, suggested: true } : e);
  for (const p of DOC_PAGES) {
    const kind = KIND_HREFS.has(p.href) ? (p.href.split('/').pop() as (typeof DIAGRAM_KINDS)[number]) : undefined;
    push({
      title: kind ? `${p.title} diagrams` : p.title,
      context: `${p.title} · ${p.group}`,
      href: p.href,
      kind: 'page',
      words: kind ? `kind ${kind} ${KIND_PAGES[kind].lede}` : (WORDS[p.href] ?? ''),
    });
    for (const s of p.sections) {
      push({ title: s.label, context: p.title, href: `${p.href}#${s.id}`, kind: 'section', words: WORDS[kind ? `kind#${s.id}` : `${p.href}#${s.id}`] ?? '' });
    }
  }
  push({ title: 'Examples', context: 'Examples · Gallery', href: '/examples', kind: 'page', words: 'gallery samples' });
  for (const e of EXAMPLES) {
    const { draft } = diagramOf(e);
    push({ title: draft.title, context: `Examples · ${KIND_LABELS[e.kind]}`, href: exampleHref(e), kind: 'example', words: `${draft.subtitle ?? ''} ${e.prompt ? 'agent prompt' : ''}` });
  }
  for (const c of CLI_COMMANDS) push({ title: `stackmap ${c.name}`, context: `The CLI · ${c.does}`, href: `/docs/cli#${c.name}`, kind: 'command', words: '' });
  for (const o of CLI_OPTIONS) push({ title: o.flag, context: `The CLI · ${o.does.split(';')[0]}`, href: '/docs/cli#options', kind: 'command', words: 'option flag' });
  push({ title: `Exit codes ${EXIT_CODES.map((c) => c.code).join(', ').replace(/, (\d+)$/, ' and $1')}`, context: 'The CLI · Exit codes', href: '/docs/cli#exit', kind: 'command', words: 'exit status error' });
  for (const k of VIEWER_KEYS) push({ title: `${k.keys.join('  ')}  ${k.does}`, context: 'The viewer · Keyboard', href: '/docs/viewer#keys', kind: 'key', words: 'shortcut key keyboard' });
  for (const code of Object.values(SITE.codes).flat()) push({ title: code, context: 'The CLI · Diagnostic codes', href: '/docs/cli#codes', kind: 'code', words: 'diagnostic error warning' });
  // The folded card parts share one anchor, so a field two of them define alike (a footer's left and right `icon`)
  // would be the same result twice.
  const fields = new Set<string>();
  for (const section of schema as SchemaSection[]) {
    const place = PLACEMENTS[section.name];
    if (!place) continue;
    for (const f of section.fields) {
      const words = `${f.key} ${f.type} ${f.notes}`;
      if (fields.has(`${place.anchor} ${words}`)) continue;
      fields.add(`${place.anchor} ${words}`);
      push({ title: f.key, context: `Schema · ${place.title}`, href: `/docs/schema#${place.anchor}`, kind: 'field', words });
    }
  }
  return out;
}
