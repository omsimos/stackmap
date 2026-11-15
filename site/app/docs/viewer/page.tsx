import type { Metadata } from 'next';
import { DocsShell } from '@/components/docs/DocsShell';
import { C, DocHead, H2, Kbd, P, Table, Ul } from '@/components/docs/prose';
import { ViewerTry } from '@/components/docs/ViewerTry';
import { DEMO, stillOf } from '@/lib/diagrams';
import { SHARE_PARAMS, VIEWER_KEYS } from '@/lib/reference';
import { OPEN_GRAPH } from '@/lib/seo';

export const metadata: Metadata = {
  title: 'The viewer',
  description: 'What you can do in the diagram.html your agent delivers: select, trace, route, find, present, export and share a view.',
  alternates: { canonical: '/docs/viewer' },
  openGraph: { ...OPEN_GRAPH, url: '/docs/viewer' },
};

export default function ViewerPage() {
  return (
    <DocsShell href="/docs/viewer">
      <DocHead
        crumb="Get started"
        title="The viewer"
        lede={
          <>
            What you can do in the <C>diagram.html</C> your agent delivers. It opens offline in any browser, and it is read-only: to change the diagram, ask your agent
            again.
          </>
        }
      />

      <H2 id="try">Try it</H2>
      <P muted>This is the viewer, on the diagram from the landing page. Pick a feature to see it, or use the viewer directly; every control works.</P>
      <ViewerTry diagram={DEMO} still={stillOf('demo')} show={{ select: 'api', route: ['storefront', 'orders'], query: 'orders', view: 'checkout' }} />

      <H2 id="share">Share a view</H2>
      <P>
        The address keeps what you are looking at, so a link opens the same view, selection, route and playback. Ids the diagram doesn’t have are dropped rather than
        trusted.
      </P>
      <Table head={['Parameter', 'Keeps', 'Example']} rows={SHARE_PARAMS.map((p) => [<C key="p">{p.param}</C>, p.keeps, <C key="e">{p.example}</C>])} />
      <P muted>
        Parameters join with <C>&amp;</C>: <C>diagram.html#view=checkout&amp;node=api&amp;play=1</C>.
      </P>

      <H2 id="present">Present and focus</H2>
      <P>
        Press <Kbd>F</Kbd>, or Present in the toolbar, for the stage alone, full screen where the browser allows it. It steps through Overview and then each view:{' '}
        <Kbd>→</Kbd> or <Kbd>Space</Kbd> moves on, <Kbd>←</Kbd> goes back, <Kbd>Home</Kbd> and <Kbd>End</Kbd> jump to the ends, and <Kbd>Esc</Kbd> leaves.
      </P>
      <P>
        For the canvas alone without presenting, press <Kbd>Z</Kbd> or Focus in the toolbar. The header, view tabs and inspector step aside and everything on the canvas keeps
        working, and <Kbd>Z</Kbd> brings them back. <Kbd>H</Kbd> hides the toolbar, in focus or not, and shows it again.
      </P>

      <H2 id="export">Export</H2>
      <P>The Export menu in the toolbar saves what the stage shows:</P>
      <Ul
        items={[
          <>
            <C>PNG</C> at 1× or 2×, or copied to the clipboard
          </>,
          <>
            <C>JPEG</C> and <C>WebP</C>, where the browser can encode them
          </>,
          <C key="svg">SVG</C>,
          <>
            <C>HTML</C>: the diagram as one offline file, the same as <C>deliver</C> writes. Opened from <C>serve</C>, it leaves out the live
            connection. The viewers on this site don’t have it.
          </>,
          'A short video of the flow, in the format your browser records',
        ]}
      />

      <H2 id="keys">Keyboard</H2>
      <Table
        className="keys"
        head={['Key', 'Does']}
        rows={VIEWER_KEYS.map((k) => [
          <>
            {k.keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </>,
          k.does,
        ])}
      />
      <P muted>Single keys never fire while you type in a field or from an open menu.</P>

      <H2 id="themes">Themes and motion</H2>
      <P>
        Dark and light. The viewer starts in your system’s theme and remembers the one you pick from the toolbar. Animations respect reduced motion: with it on, nothing
        plays.
      </P>
    </DocsShell>
  );
}
