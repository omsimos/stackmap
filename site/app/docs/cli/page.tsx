import type { Metadata } from 'next';
import { DocsShell } from '@/components/docs/DocsShell';
import { C, DocHead, H2, H3, P, Table } from '@/components/docs/prose';
import { Tabs } from '@/components/docs/Tabs';
import { Cmd } from '@/components/ui/Cmd';
import { JsonCode, Terminal } from '@/components/ui/Code';
import { CLI_COMMANDS, CLI_OPTIONS, EXIT_CODES, FAMILIES, type Family } from '@/lib/reference';
import { OPEN_GRAPH } from '@/lib/seo';
import { SITE } from '@/lib/site-data';

export const metadata: Metadata = {
  title: 'The CLI',
  description: 'stackmap validate, deliver and serve: what each command does, its options, every diagnostic code and the exit codes.',
  alternates: { canonical: '/docs/cli' },
  openGraph: { ...OPEN_GRAPH, url: '/docs/cli' },
};

const DEMO = '.stackmap/commerce-api/diagram.json';
const npx = `npx @omsimos/stackmap@${SITE.version}`;

function Synopsis({ name }: { name: (typeof CLI_COMMANDS)[number]['name'] }) {
  const c = CLI_COMMANDS.find((x) => x.name === name)!;
  return (
    <p className="syn mono">
      <span aria-hidden="true">$</span> stackmap <b>{c.name}</b> {c.usage}
    </p>
  );
}

const FAMILY_TEXT: Record<Family, string> = {
  schema: 'The JSON doesn’t match the schema: a wrong type, a value outside an enum, an unknown key. The code is the schema check that failed.',
  refs: 'An id points at nothing: a connection to a node that doesn’t exist, a group, lane, view or phase member that isn’t there. The fix names the closest id when there is one.',
  semantics: 'Valid, but not what the kind expects or a reader can use: an orphan node, an empty view, lanes on an architecture. Most are warnings.',
  'card-fit': 'Text that won’t fit its slot, measured with the real font. Text never wraps, so this is an error, with the exact number of characters that fit.',
};

export default function CliPage() {
  const { file, sha256, bytes } = SITE.receipt;
  const refs = SITE.cli.families.refs;
  return (
    <DocsShell href="/docs/cli">
      <DocHead
        crumb="Reference"
        title="The CLI"
        lede="The skill runs the CLI for you, and it works on its own too: give it a diagram.json and it checks it, lays it out and writes the viewer."
      />

      <H2 id="run">Run it</H2>
      <P>With Node 22.12 or later, nothing to install first:</P>
      <div className="d-cmd">
        <Cmd command={SITE.install.cli} label="Copy the command" />
      </div>
      <P muted>
        The commands below call it <C>stackmap</C>; with npx it is <C>{npx}</C>.
      </P>

      <H2 id="validate">validate</H2>
      <Synopsis name="validate" />
      <P>
        Checks the diagram and lists every problem with a code, where it is and the fixes it allows, including card text that won’t fit. It exits 1 when the diagram has
        errors; warnings alone exit 0.
      </P>
      <div className="d-fig">
        <Terminal title="stackmap validate" lines={[`$ stackmap validate ${DEMO}`, ...refs]} />
      </div>
      <H3>--json</H3>
      <P muted>The same diagnostics, for a program to read: each one has its code, severity, subject (a JSON pointer), message, evidence and allowed fixes.</P>
      <div className="d-fig">
        <JsonCode file="stackmap validate diagram.json --json" code={SITE.cli.json} label="stdout" />
      </div>

      <H2 id="deliver">deliver</H2>
      <Synopsis name="deliver" />
      <P>
        Validates, lays out and writes one offline HTML file, next to the input unless you pass <C>-o</C>. It refuses to overwrite its input. Delivery is deterministic:
        the same JSON always gives the same file, byte for byte, so the receipt’s hash is worth keeping. With <C>--open</C> it then opens the file in your default
        browser; the skill passes it, so a diagram opens as soon as the agent delivers it.
      </P>
      <div className="d-fig">
        <Terminal title="stackmap deliver" lines={[`$ stackmap deliver ${DEMO}`, `delivered ${file} · sha256 ${sha256} · ${bytes} bytes`]} />
      </div>
      <P muted>The receipt is the only thing on stdout. Warnings go to stderr, and so does a notice when a large diagram starts laying out; with errors, nothing is written and the command exits 1.</P>

      <H2 id="serve">serve</H2>
      <Synopsis name="serve" />
      <P>
        A live viewer that reloads whenever the file changes, for editing a diagram by hand or watching an agent work. It binds <C>127.0.0.1</C> only and takes the next
        free port when <C>4400</C> is taken. When a save is invalid it keeps the last good version on screen, and it keeps your camera and selection across reloads.
      </P>
      <div className="d-fig">
        <Terminal
          title="stackmap serve"
          lines={[
            '$ stackmap serve diagram.json',
            'serving http://127.0.0.1:4400 · watching diagram.json · Ctrl-C to stop',
            '✓ diagram.json ready',
            '✗ diagram.json: 1 error; keeping the last good version',
            '✓ diagram.json reloaded',
          ]}
        />
      </div>

      <H2 id="options">Options</H2>
      <Table head={['Option', 'For', 'Does']} rows={CLI_OPTIONS.map((o) => [<C key="f">{o.flag}</C>, o.for, o.does])} />

      <H2 id="diagnostics">Diagnostics</H2>
      <P>Every diagnostic has the same shape, so an agent can act on it without guessing:</P>
      <div className="anat" role="group" aria-label="The parts of a diagnostic">
        <div className="anat-c">
          <div className="anat-l mono">
            <span className="a-c">error</span> <span className="a-c">refs/unknown-node</span> <span className="a-p">/edges/6/to</span>
          </div>
          <div className="anat-l mono">
            {'  '}
            <span className="a-m">Unknown node &quot;orders-db&quot;</span>
          </div>
          <div className="anat-l mono">
            {'  '}
            <span className="a-m">fix:</span> use &quot;orders&quot;
          </div>
          <div className="anat-l mono">
            {'  '}
            <span className="a-m">fix:</span> add node &quot;orders-db&quot; or remove the edge
          </div>
        </div>
        <dl className="anat-k">
          <div>
            <dt>Severity</dt>
            <dd>
              <C>error</C> blocks delivery; <C>warning</C> doesn’t.
            </dd>
          </div>
          <div>
            <dt>Code</dt>
            <dd>
              <C>&lt;family&gt;/&lt;rule&gt;</C>: schema, refs, semantics or card-fit.
            </dd>
          </div>
          <div>
            <dt>Subject</dt>
            <dd>A JSON pointer to the value at fault.</dd>
          </div>
          <div>
            <dt>Fixes</dt>
            <dd>The repairs it allows. The agent applies one, and only what is named.</dd>
          </div>
        </dl>
      </div>
      <Tabs
        label="Diagnostic families"
        mono
        tabs={FAMILIES.map((f) => ({
          id: f,
          label: f,
          panel: (
            <>
              <P muted>{FAMILY_TEXT[f]}</P>
              <Terminal title="stackmap validate diagram.json" lines={['$ stackmap validate diagram.json', ...SITE.cli.families[f]]} />
            </>
          ),
        }))}
      />

      <H2 id="codes">Diagnostic codes</H2>
      <P muted>
        Every code <C>validate</C> can report. Schema codes are named after the check that failed.
      </P>
      <div className="codes-w">
        {FAMILIES.map((f) => (
          <div key={f} className="codes-g">
            <H3>{f}</H3>
            <ul className="codes">
              {SITE.codes[f].map((code) => (
                <li key={code}>
                  <C>{code}</C>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <H2 id="exit">Exit codes</H2>
      <Table head={['Code', 'Means']} rows={EXIT_CODES.map((e) => [<C key="c">{String(e.code)}</C>, e.means])} />
    </DocsShell>
  );
}
