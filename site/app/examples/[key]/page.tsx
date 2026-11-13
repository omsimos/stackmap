import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, ChevronRight } from 'lucide-react';
import { KIND_LABELS } from '@stackmap/core';
import { AgentMark, ExampleCard } from '@/components/examples/ExampleCard';
import { ExampleViewer } from '@/components/examples/ExampleViewer';
import { JsonCode } from '@/components/ui/Code';
import { CopyButton } from '@/components/ui/CopyButton';
import { EXAMPLES, exampleHref, id } from '@/lib/catalog';
import { diagramOf, SOURCES, stillOf } from '@/lib/diagrams';
import { kindHref } from '@/lib/docs-nav';
import { KIND_PAGES } from '@/lib/kinds';
import { OPEN_GRAPH } from '@/lib/seo';
import { article } from '@/lib/words';

export const dynamicParams = false;

export function generateStaticParams() {
  return EXAMPLES.map((e) => ({ key: e.key }));
}

const find = (key: string) => EXAMPLES.findIndex((e) => e.key === key);

export async function generateMetadata({ params }: PageProps<'/examples/[key]'>): Promise<Metadata> {
  const { key } = await params;
  const e = EXAMPLES[find(key)];
  if (!e) return {};
  const { draft } = diagramOf(e);
  const href = exampleHref(e);
  const kind = KIND_LABELS[e.kind].toLowerCase();
  return {
    title: `${draft.title} · Examples`,
    description: `${draft.subtitle ? `${draft.subtitle}. ` : ''}${article(kind, true)} ${kind} diagram laid out by stackmap, open in the viewer.`,
    alternates: { canonical: href },
    openGraph: { ...OPEN_GRAPH, url: href },
  };
}

function Request({ text, quoted = false }: { text: string; quoted?: boolean }) {
  return (
    <div className="q pnl">
      <p>{quoted ? `“${text}”` : text}</p>
      <CopyButton text={text} label="Copy the request" className="cp" />
    </div>
  );
}

export default async function ExamplePage({ params }: PageProps<'/examples/[key]'>) {
  const { key } = await params;
  const at = find(key);
  const e = EXAMPLES[at];
  if (!e) notFound();
  const diagram = diagramOf(e);
  const { draft } = diagram;
  const label = KIND_LABELS[e.kind];
  const kind = KIND_PAGES[e.kind];
  const prev = EXAMPLES[(at - 1 + EXAMPLES.length) % EXAMPLES.length]!;
  const next = EXAMPLES[(at + 1) % EXAMPLES.length]!;
  const code = SOURCES.examples[e.key]!;
  const more = EXAMPLES.filter((x) => x.kind === e.kind && x.key !== e.key).slice(0, 4);
  return (
    <main className="exp" id="top">
      <div className="wrap">
        <nav className="exp-top" aria-label="Examples">
          <p className="crumbs">
            <Link href="/examples">Examples</Link>
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
            <Link href={`/examples?kind=${e.kind}`}>{label}</Link>
          </p>
        </nav>
        <header className="exp-h">
          <h1 className="exp-title">{draft.title}</h1>
          {draft.subtitle && <p className="exp-sub">{draft.subtitle}</p>}
          <p className="exp-meta">
            <span className="badge">{label}</span>
            <span className="tnum">
              {draft.nodes.length} nodes · {draft.edges.length} connections
            </span>
            {e.prompt && <AgentMark />}
          </p>
        </header>
        <ExampleViewer
          diagram={diagram}
          still={stillOf(`${e.source}/${e.key}`)}
          pager={{
            at: `${at + 1} / ${EXAMPLES.length}`,
            prev: { href: exampleHref(prev), title: diagramOf(prev).draft.title },
            next: { href: exampleHref(next), title: diagramOf(next).draft.title },
          }}
        />
        <div className="exp-cols">
          <section className="exp-ask">
            {e.prompt ? (
              <>
                <h2 className="exp-h2">What the agent was asked</h2>
                <Request text={e.prompt} quoted />
                <p className="exp-note">Written by a coding agent in the skill’s eval: it read the request, wrote the JSON, validated it and delivered the file.</p>
              </>
            ) : (
              <>
                <h2 className="exp-h2">About this diagram</h2>
                <p className="exp-p">{kind.lede}</p>
                <h3 className="exp-h3">Ask for one like it</h3>
                <Request text={kind.ask} />
              </>
            )}
            <Link className="pill-l exp-doc" href={kindHref(e.kind)}>
              <span>Read about {label.toLowerCase()} diagrams</span>
              <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </section>
          <section className="exp-json">
            <h2 className="exp-h2">The JSON</h2>
            <JsonCode file={`${e.key}/diagram.json`} code={code} />
          </section>
        </div>
        {more.length > 0 && (
          <section className="exp-more" aria-labelledby="more-h">
            <div className="exp-more-h">
              <h2 className="exp-h2" id="more-h">
                More {label.toLowerCase()} examples
              </h2>
              <Link className="g-doc" href="/examples">
                <span>All examples</span>
                <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
              </Link>
            </div>
            <ul className="g-grid">
              {more.map((x) => (
                <li key={id(x)} className="ex-li">
                  <ExampleCard entry={x} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
