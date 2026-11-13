import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { FileJson, Hash } from 'lucide-react';
import { BRAND_SLUGS } from '@stackmap/core';
import { NodeCard } from '@stackmap/viewer/src/card/NodeCard';
import schema from '@/generated/schema.json';
import { DocsShell } from '@/components/docs/DocsShell';
import { C, DocHead, H2, Inline } from '@/components/docs/prose';
import { JsonCode } from '@/components/ui/Code';
import { formatJson } from '@/lib/data/json-format';
import type { SchemaField, SchemaSection } from '@/lib/data/schema-ref';
import { diagramOf } from '@/lib/diagrams';
import { schemaUrl } from '@/lib/package';
import { INTROS, SAMPLE_CARD, SAMPLES, diagramOutline } from '@/lib/schema-docs';
import { blocks, notePieces, type Placement } from '@/lib/schema-page';
import { OPEN_GRAPH } from '@/lib/seo';
import { SITE } from '@/lib/site-data';

export const metadata: Metadata = {
  title: 'Schema reference',
  description: 'Every field of the diagram JSON your coding agent writes: nodes, cards, connections, groups, lanes, phases, views and notes.',
  alternates: { canonical: '/docs/schema' },
  openGraph: { ...OPEN_GRAPH, url: '/docs/schema' },
};

const SECTIONS = schema as SchemaSection[];
const section = (name: string) => SECTIONS.find((s) => s.name === name)!;

function Notes({ field }: { field: SchemaField }) {
  return notePieces(field).map((p, i) =>
    'code' in p ? <C key={i}>{p.code}</C> : 'href' in p ? <a key={i} href={p.href}>{p.link}</a> : <Fragment key={i}>{p.text}</Fragment>,
  );
}

function Head({ field, link }: { field: SchemaField; link?: string }) {
  return (
    <div className="fl-h">
      {link ? (
        <a className="fl-k" href={link}>
          {field.key}
        </a>
      ) : (
        <code className="fl-k">{field.key}</code>
      )}
      <span className="fl-t">{field.type}</span>
      {field.required && <span className="fl-q">required</span>}
    </div>
  );
}

function Fields({ fields }: { fields: SchemaField[] }) {
  return (
    <ul className="fl">
      {fields.map((f) => (
        <li key={f.key} className="fl-r">
          <Head field={f} />
          <p className="fl-n">
            <Notes field={f} />
          </p>
        </li>
      ))}
    </ul>
  );
}

function Sample({ anchor }: { anchor: string }) {
  const s = SAMPLES[anchor]!;
  return <JsonCode file={s.file} code={formatJson(s.value)} />;
}

/** One section: its prose and fields on the left, a sample that stays in view on the right. */
function Section({ placement, intro, children, aside }: { placement: Placement; intro: ReactNode; children: ReactNode; aside: ReactNode }) {
  return (
    <section className="sx">
      <H2 id={placement.anchor} sub={placement.level === 3}>
        {placement.title}
      </H2>
      <div className="sx-g">
        <div className="sx-l">
          <p className="d-p m">{intro}</p>
          {children}
        </div>
        <div className="sx-r">
          <div className="sx-st">{aside}</div>
        </div>
      </div>
    </section>
  );
}

const PARTS = [
  { title: 'rows[]', names: ['nodes[].card.rows[]'] },
  { title: 'stats[]', names: ['nodes[].card.stats[]'] },
  { title: 'footer.left and footer.right', names: ['nodes[].card.footer.left'] },
  { title: 'cta', names: ['nodes[].card.cta'] },
];

const bookshop = diagramOf({ source: 'examples', key: 'bookshop' }).draft;

export default function SchemaPage() {
  return (
    <DocsShell href="/docs/schema">
      <DocHead
        crumb="Reference"
        title="Schema reference"
        lede="The diagram your agent writes. stackmap computes the layout, so there are never coordinates, and objects are strict: an unknown key is an error."
      />
      <div className="sx-meta">
        <p>
          <Hash size={16} strokeWidth={1.75} className="ic" aria-hidden="true" />
          <span>
            Ids, and references to them, use <C>a-z</C>, <C>0-9</C>, <C>-</C> and <C>_</C>, starting with a letter or digit.
          </span>
        </p>
        <p>
          <FileJson size={16} strokeWidth={1.75} className="ic" aria-hidden="true" />
          <span>
            Machine-readable: <a href={schemaUrl(SITE.version)}>stackmap.schema.json</a>. Set it as{' '}
            <C>$schema</C> for completion in your editor.
          </span>
        </p>
      </div>
      {blocks(SECTIONS).map((b) => {
        if (b.kind === 'card-parts') {
          return (
            <Section
              key="card-parts"
              placement={{ anchor: 'card-parts', title: 'Card parts', level: 3 }}
              intro={
                <>
                  Rows are key and value pairs, <C>mono</C> for ports and paths. Stats are a value and a label, at most three. The footer takes a left and a right item,
                  each a text and an optional icon (<C>region</C>, <C>secure</C>, <C>members</C>). A call to action takes a label and an http(s) link.
                </>
              }
              aside={<Sample anchor="card-parts" />}
            >
              <div className="cpt-g">
                {PARTS.map((p) => (
                  <div key={p.title} className="cpt">
                    <h4 className="fl-g mono">{p.title}</h4>
                    <Fields fields={p.names.flatMap((n) => section(n).fields)} />
                  </div>
                ))}
              </div>
            </Section>
          );
        }
        const { section: s, placement } = b;
        const anchor = placement.anchor;
        if (anchor === 'diagram') {
          const arrays = s.fields.filter((f) => f.type === 'array');
          return (
            <Section key={anchor} placement={placement} intro={<Inline text={INTROS.diagram!} />} aside={<JsonCode file="diagram.json" code={diagramOutline(SITE.version, bookshop)} />}>
              <Fields fields={s.fields.filter((f) => f.type !== 'array')} />
              <h3 className="fl-g arr-h">What it holds</h3>
              <div className="arr-g">
                {arrays.map((f) => (
                  <div key={f.key} className="arr">
                    <Head field={f} link={`#${f.key}`} />
                    <p className="fl-n">
                      {/* The link is the field name itself here. */}
                      <Notes field={{ ...f, notes: f.notes.replace(/\s*see \[.+?\]\(#[^)]+\)\.?$/i, '').trim() }} />
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          );
        }
        if (anchor === 'cards') {
          return (
            <Section
              key={anchor}
              placement={placement}
              intro={
                <>
                  What a node’s card shows. Only <C>title</C> is required; add parts when they carry what a reader needs at a glance. Text never wraps: anything too long is
                  an error, <C>card-fit/overflow</C>. A <C>brand</C> is one of the <Link href="/docs/brands">{BRAND_SLUGS.length} brand slugs</Link>. The viewer’s sample card,
                  with every part:
                </>
              }
              aside={
                <>
                  <div className="sx-card">
                    <NodeCard node={{ id: 'orders', type: 'database', card: SAMPLE_CARD as never }} />
                  </div>
                  <Sample anchor="cards" />
                </>
              }
            >
              <Fields fields={s.fields} />
            </Section>
          );
        }
        return (
          <Section key={anchor} placement={placement} intro={<Inline text={INTROS[anchor] ?? ''} />} aside={SAMPLES[anchor] && <Sample anchor={anchor} />}>
            <Fields fields={s.fields} />
          </Section>
        );
      })}
    </DocsShell>
  );
}
