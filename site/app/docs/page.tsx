import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, Braces, LayoutGrid, Shapes } from 'lucide-react';
import { BRAND_SLUGS, DIAGRAM_KINDS, INFRA_TYPES, STATE_TYPES } from '@stackmap/core';
import { DocsShell } from '@/components/docs/DocsShell';
import { LinkedFigure } from '@/components/docs/LinkedFigure';
import { Ask, C, DocHead, H2, P } from '@/components/docs/prose';
import { Cmd } from '@/components/ui/Cmd';
import { JsonCode, Terminal } from '@/components/ui/Code';
import { TypeChip } from '@/components/ui/TypeChip';
import { EXAMPLES } from '@/lib/catalog';
import { SOURCES, stillOf } from '@/lib/diagrams';
import { kindHref } from '@/lib/docs-nav';
import { jsonOwners } from '@/lib/json-lines';
import { schemaUrl } from '@/lib/package';
import { OPEN_GRAPH } from '@/lib/seo';
import { SITE } from '@/lib/site-data';
import { spell } from '@/lib/words';

export const metadata: Metadata = {
  title: 'Quick start',
  description: 'Install the stackmap skill, ask your coding agent for a diagram, and open the one HTML file it delivers.',
  alternates: { canonical: '/docs' },
  openGraph: { ...OPEN_GRAPH, url: '/docs' },
};

const ASK = 'Make an architecture diagram of this repository, backed by evidence from the code.';
// The agent's file pins the schema to the installed CLI, so the example does too.
const JSON_TEXT = SOURCES.quickStart.replace('{\n', `{\n  "$schema": "${schemaUrl(SITE.version)}",\n`);
const FILE = '.stackmap/commerce-api/diagram.json';

function Step({ n, id, title, children }: { n: number; id: string; title: string; children: React.ReactNode }) {
  return (
    <li className="d-step" id={id} data-sec="">
      <span className="d-sn" aria-hidden="true">
        {n}
      </span>
      <div>
        <h2 className="d-st">
          <span className="sr-only">Step {n}: </span>
          {title}
        </h2>
        {children}
      </div>
    </li>
  );
}

function Repair() {
  const { broken, clean } = SITE.repair;
  const { file, sha256, bytes } = SITE.receipt;
  return (
    <div className="d-fig">
      <Terminal
        title="~/commerce-api"
        lines={[
          `$ stackmap validate ${FILE}`,
          ...broken,
          `$ stackmap validate ${FILE}`,
          ...clean,
          `$ stackmap deliver ${FILE}`,
          `delivered ${file} · sha256 ${sha256.slice(0, 12)}… · ${bytes} bytes`,
        ]}
      />
    </div>
  );
}

const agents = EXAMPLES.filter((e) => e.prompt).length;

const NEXT = [
  { href: '/docs/viewer', icon: BookOpen, title: 'The viewer', text: 'Select, trace, route, find, present and share what the file shows.' },
  { href: kindHref('architecture'), icon: Shapes, title: 'Diagram kinds', text: `${spell(DIAGRAM_KINDS.length, true)} kinds, each with its own layout. Pick the one that answers the question.` },
  { href: '/docs/schema', icon: Braces, title: 'Schema reference', text: 'Every field of diagram.json, with a real example beside each part.' },
  { href: '/examples', icon: LayoutGrid, title: 'Examples', text: `${spell(EXAMPLES.length, true)} diagrams, ${spell(agents)} of them written by coding agents.` },
];

export default function QuickStartPage() {
  return (
    <DocsShell href="/docs">
      <DocHead crumb="Get started" title="Quick start" lede="Install the skill, ask your coding agent for a diagram, and open the one HTML file it delivers." />
      <ol className="d-steps">
        <Step n={1} id="install" title="Install the skill into your agent">
          <Cmd command={SITE.install.skill} label="Copy the install command" />
          <p className="d-p m">
            It installs into Claude Code, Cursor, Codex and the{' '}
            <a href="https://github.com/vercel-labs/skills" target="_blank" rel="noreferrer">
              other agents that skills supports
            </a>
            .
          </p>
        </Step>
        <Step n={2} id="ask" title="Ask for a diagram">
          <Ask text={ASK} />
          <p className="d-p m">
            The agent writes <C>.stackmap/&lt;name&gt;/diagram.json</C>, validates it, repairs what the diagnostics name, and delivers{' '}
            <C>.stackmap/&lt;name&gt;/diagram.html</C>.
          </p>
        </Step>
        <Step n={3} id="open" title="Open the file">
          <p className="d-p">
            Open <C>diagram.html</C> in any browser. There is no server, no account and nothing to install. To change the diagram, ask again: the agent edits the JSON
            and delivers it again. The viewer itself is read-only.
          </p>
        </Step>
      </ol>

      <H2 id="write">What the agent writes</H2>
      <P>One small typed JSON file. The agent names the nodes, connections, groups and views; stackmap validates it and lays it out. There are no coordinates to write.</P>
      <LinkedFigure
        still={stillOf('quickStart')}
        url="file:///…/.stackmap/bookshop/diagram.html"
        code={<JsonCode file=".stackmap/bookshop/diagram.json" code={JSON_TEXT} owners={jsonOwners(JSON_TEXT)} />}
      />
      <div className="facts">
        <div className="fact">
          <h3>Nodes</h3>
          <p>
            {spell(INFRA_TYPES.length, true)} types set the colour, and lifecycles have {spell(STATE_TYPES.length)} state types of their own. Cards can add rows, stats, a
            footer, a link and one of {BRAND_SLUGS.length} Simple Icons logos.
          </p>
          <div className="tchips">
            {INFRA_TYPES.map((t) => (
              <TypeChip key={t} type={t} small />
            ))}
          </div>
        </div>
        <div className="fact">
          <h3>Connections</h3>
          <p>
            Plain for a call, <C>async</C> for queues and events, <C>return</C> for a reply or a roll back, with a <C>tone</C> for the main path, security crossings and
            failure paths.
          </p>
        </div>
        <div className="fact">
          <h3>No coordinates</h3>
          <p>stackmap lays everything out: ELK for architecture and dataflow, and its own layout for lanes and sequences. The same JSON always gives the same file.</p>
        </div>
      </div>

      <H2 id="repair">When something is wrong</H2>
      <P>
        <C>validate</C> names each problem with a code, where it is (a JSON pointer) and the fixes it allows. The agent repairs only what is named and runs it again;{' '}
        <C>deliver</C> writes the file once nothing is wrong.
      </P>
      <Repair />
      <P muted>
        Warnings never block delivery. The exit code tells the agent which case it is in: <C>0</C> valid, <C>1</C> the diagram has errors, <C>2</C> a usage, file or
        internal error. <Link href="/docs/cli#diagnostics">Diagnostics, in full</Link>.
      </P>

      <H2 id="next">Next steps</H2>
      <div className="d-cards">
        {NEXT.map(({ href, icon: Icon, title, text }) => (
          <Link key={href} className="d-card" href={href}>
            <Icon size={20} strokeWidth={1.75} className="ic" aria-hidden="true" />
            <b>{title}</b>
            <span>{text}</span>
          </Link>
        ))}
      </div>
    </DocsShell>
  );
}
