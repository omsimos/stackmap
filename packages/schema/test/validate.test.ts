import { describe, expect, it } from 'vitest';
import type { DiagramDraft } from '@stackmap/core';
import { commerceApi, groupedPlatform } from '@stackmap/core/samples';
import { validateDiagram, type Diagnostic } from '../src';

const node = (id: string, over: Partial<DiagramDraft['nodes'][number]> = {}) => ({ id, type: 'service' as const, card: { title: id }, ...over });
const base = (over: Partial<DiagramDraft> = {}): DiagramDraft => ({
  kind: 'architecture',
  title: 'T',
  nodes: [node('a'), node('b')],
  edges: [{ id: 'ab', from: 'a', to: 'b' }],
  ...over,
});
const diags = (input: unknown) => validateDiagram(input).diagnostics;
const only = (input: unknown, code: string) => diags(input).filter((d) => d.code === code);

describe('validateDiagram', () => {
  it.each([
    ['commerce API', commerceApi],
    ['grouped platform', groupedPlatform],
  ])('the %s sample validates with no diagnostics', (_n, sample) => {
    expect(validateDiagram(sample)).toEqual({ ok: true, diagram: sample, diagnostics: [] });
  });

  it('strips $schema from the typed diagram', () => {
    const r = validateDiagram({ $schema: './stackmap.schema.json', ...base() });
    expect(r.ok).toBe(true);
    expect(r.diagram).toEqual(base());
  });

  describe('schema', () => {
    it.each([null, [], 'diagram', 42, undefined])('reports a non-object root (%s) once, without throwing', (input) => {
      const r = validateDiagram(input);
      expect(r.ok).toBe(false);
      expect(r.diagram).toBeUndefined();
      expect(r.diagnostics).toHaveLength(1);
      expect(r.diagnostics[0]).toMatchObject({ code: 'schema/invalid_type', subject: '', evidence: { expected: 'object' } });
    });

    it('a missing required field says to add it', () => {
      const { edges: _, ...noEdges } = base();
      expect(diags(noEdges)).toEqual<Diagnostic[]>([
        {
          code: 'schema/invalid_type',
          severity: 'error',
          subject: '/edges',
          message: 'Expected array, received nothing',
          evidence: { expected: 'array', received: 'missing' },
          allowedFixes: ['add the required "edges" field (array)'],
        },
      ]);
    });

    it('a bad id suggests a valid one', () => {
      const [d] = diags(base({ nodes: [node('Orders API'), node('b')], edges: [] }));
      expect(d).toMatchObject({ code: 'schema/invalid_format', subject: '/nodes/0/id', allowedFixes: ['use a lowercase id such as "orders-api"'] });
    });

    it('an unknown type lists the allowed types', () => {
      const [d] = diags(base({ nodes: [node('a', { type: 'lambda' as never })] }));
      expect(d).toMatchObject({ code: 'schema/invalid_value', subject: '/nodes/0/type' });
      expect(d!.allowedFixes[0]).toMatch(/^use one of: client, service, gateway/);
    });

    it('a misspelt key suggests the right one', () => {
      const [d] = diags(base({ nodes: [node('a', { card: { title: 'a', subtitel: 'x' } as never })] }));
      expect(d).toMatchObject({ code: 'schema/unrecognized_keys', subject: '/nodes/0/card', evidence: { keys: ['subtitel'] }, allowedFixes: ['rename "subtitel" to "subtitle"'] });
    });

    it('only suggests keys valid on the offending object, never the key itself', () => {
      const onNode = diags(base({ nodes: [node('a', { label: 'x' } as never), node('b')] }))[0];
      expect(onNode).toMatchObject({ subject: '/nodes/0', allowedFixes: ['move "label" into "card" as "title"', 'remove "label"'] });
      const onEdge = diags(base({ edges: [{ id: 'ab', from: 'a', to: 'b', subtitel: 'x' } as never] }))[0];
      expect(onEdge!.allowedFixes).toEqual(['remove "subtitel" (not valid here; allowed: id, from, to, label, kind, tone)']);
      const onRoot = diags({ ...base(), titel: 'x' })[0];
      expect(onRoot).toMatchObject({ subject: '', allowedFixes: ['rename "titel" to "title"'] });
    });

    it('a blank or whitespace-only text is one diagnostic asking for visible text', () => {
      for (const title of ['', '   ']) {
        expect(diags(base({ nodes: [node('a', { card: { title } }), node('b')] }))).toMatchObject([
          { code: 'schema/invalid_format', subject: '/nodes/0/card/title', allowedFixes: ['give "title" visible text'] },
        ]);
      }
    });

    it('type errors name the value in plain words', () => {
      expect(diags(null)[0]).toMatchObject({ evidence: { received: null }, allowedFixes: ['make the diagram an object'] });
      expect(diags(base({ nodes: [5 as never] }))[0]).toMatchObject({ subject: '/nodes/0', allowedFixes: ['make item 0 of "nodes" an object'] });
      expect(diags(base({ title: null as never }))[0]).toMatchObject({ evidence: { received: null }, allowedFixes: ['make "title" a string'] });
    });

    it('caps diagram size so validation and layout stay fast', () => {
      const nodes = Array.from({ length: 501 }, (_, i) => node(`n${i}`));
      expect(diags(base({ nodes }))[0]).toMatchObject({ code: 'schema/too_big', subject: '/nodes', allowedFixes: ['keep at most 500 items'] });
    });

    it.each([
      ['a node-level brand belongs in the card', { brand: 'redis' }, '/nodes/0', ['move "brand" into "card"', 'remove "brand"']],
      ['card evidence belongs on the node', { card: { title: 'a', evidence: [{ file: 'a.ts' }] } }, '/nodes/0/card', ['move "evidence" up to the enclosing object', 'remove "evidence"']],
      ['a card "label" is the title', { card: { title: 'a', label: 'x' } }, '/nodes/0/card', ['rename "label" to "title"']],
      ['a card "name" is the title', { card: { title: 'a', name: 'x' } }, '/nodes/0/card', ['rename "name" to "title"']],
      ['a card "description" is the subtitle', { card: { title: 'a', description: 'x' } }, '/nodes/0/card', ['rename "description" to "subtitle"']],
    ])('%s', (_n, over, subject, fixes) => {
      const [d] = diags(base({ nodes: [node('a', over as never), node('b')] }));
      expect(d).toMatchObject({ code: 'schema/unrecognized_keys', subject, allowedFixes: fixes });
    });

    it('never "moves" into an array or suggests a far-fetched rename for a short key', () => {
      const [value] = diags(base({ nodes: [node('a', { card: { title: 'a', value: 'x' } } as never), node('b')] }));
      expect(value!.allowedFixes).toEqual([expect.stringMatching(/^remove "value"/)]);
      const [file] = diags(base({ nodes: [node('a', { card: { title: 'a', file: 'x' } } as never), node('b')] }));
      expect(file!.allowedFixes).toEqual([expect.stringMatching(/^remove "file"/)]);
      const [id] = diags({ ...base(), id: 'x' });
      expect(id!.allowedFixes).toEqual([expect.stringMatching(/^remove "id"/)]);
    });

    it('an edge label limit counts characters, not UTF-16 units (emoji)', () => {
      const emoji = '🚀'.repeat(13); // 13 characters, 26 UTF-16 units
      expect(diags(base({ edges: [{ id: 'ab', from: 'a', to: 'b', label: emoji }] }))).toEqual([]);
      expect(diags(base({ edges: [{ id: 'ab', from: 'a', to: 'b', label: '🚀'.repeat(25) }] }))[0]).toMatchObject({
        subject: '/edges/0/label',
        allowedFixes: ['shorten "label" to at most 24 characters'],
      });
    });

    it('a number out of range gets a number fix, not a text one', () => {
      const withLine = (line: number) => base({ nodes: [node('a', { evidence: [{ file: 'a.ts', line }] }), node('b')] });
      expect(diags(withLine(0))[0]).toMatchObject({ code: 'schema/too_small', subject: '/nodes/0/evidence/0/line', allowedFixes: ['make "line" greater than 0'] });
    });

    it('an unknown key named like an Object.prototype member is just removed', () => {
      for (const key of ['constructor', 'toString', 'hasOwnProperty']) {
        const [d] = diags(base({ nodes: [node('a', { [key]: 1 } as never), node('b')] }));
        expect(d).toMatchObject({ code: 'schema/unrecognized_keys', subject: '/nodes/0', allowedFixes: [expect.stringMatching(new RegExp(`^remove "${key}" \\(not valid here`))] });
      }
    });

    it('limits say how far to cut', () => {
      const stats = Array.from({ length: 4 }, (_, i) => ({ value: String(i), label: 'x' }));
      expect(diags(base({ nodes: [node('a', { card: { title: 'a', stats } })] }))[0]).toMatchObject({
        code: 'schema/too_big',
        subject: '/nodes/0/card/stats',
        allowedFixes: ['keep at most 3 items'],
      });
      expect(diags(base({ edges: [{ id: 'ab', from: 'a', to: 'b', label: 'x'.repeat(25) }] }))[0]).toMatchObject({
        code: 'schema/too_big',
        subject: '/edges/0/label',
        allowedFixes: ['shorten "label" to at most 24 characters'],
      });
    });

    it('rejects a non-http CTA link', () => {
      const [d] = diags(base({ nodes: [node('a', { card: { title: 'a', cta: { label: 'Go', href: 'javascript:alert(1)' } } })] }));
      expect(d).toMatchObject({ code: 'schema/invalid_format', subject: '/nodes/0/card/cta/href', allowedFixes: ['use an http(s) URL', 'remove "href"'] });
    });

    it('a non-http source URL gets the same fix', () => {
      // Removing only "url" would leave an invalid `source: {}`; the fix must name the whole object.
      expect(diags(base({ source: { url: 'ftp://x' } }))[0]).toMatchObject({ subject: '/source/url', allowedFixes: ['use an http(s) URL', 'remove "source"'] });
    });

    it.each(['../../other/repo/x.ts', '/etc/passwd', 'src\\\\win.ts', 'https://evil.example/x', 'a/../b.ts'])(
      'rejects evidence file %s: repo-relative paths only',
      (file) => {
        const [d] = diags(base({ nodes: [node('a', { evidence: [{ file }] }), node('b')] }));
        expect(d).toMatchObject({ subject: '/nodes/0/evidence/0/file', allowedFixes: ['use a repo-relative path like "src/api/server.ts" (no "..", "\\", "://" or leading "/")'] });
      },
    );

    it('accepts ordinary repo-relative evidence paths', () => {
      for (const file of ['src/a.ts', '.github/workflows/ci.yml', 'docs/my file#1.md', 'a..b/c.ts']) {
        expect(validateDiagram(base({ nodes: [node('a', { evidence: [{ file }] }), node('b')] })).ok, file).toBe(true);
      }
    });

    it('returns only schema diagnostics when the schema fails', () => {
      // Dangling edge + orphan would be reported too if later families ran.
      const r = validateDiagram({ ...base({ edges: [{ id: 'ax', from: 'a', to: 'x' }] }), title: '' });
      expect(r.diagnostics.map((d) => d.code)).toEqual(['schema/invalid_format']);
    });
  });

  describe('refs', () => {
    it('a dangling edge end names the closest node ids', () => {
      expect(only(base({ nodes: [node('orders'), node('b')], edges: [{ id: 'e', from: 'order', to: 'b' }] }), 'refs/unknown-node')).toEqual<Diagnostic[]>([
        {
          code: 'refs/unknown-node',
          severity: 'error',
          subject: '/edges/0/from',
          message: 'Unknown node "order"',
          evidence: { id: 'order', closest: ['orders'] },
          allowedFixes: ['use "orders"', 'add node "order" or remove the edge'],
        },
      ]);
    });

    it('unknown groups on nodes and group parents', () => {
      const d = base({ groups: [{ id: 'app', label: 'App', parent: 'missing' }], nodes: [node('a', { group: 'ap' }), node('b', { group: 'app' })] });
      expect(only(d, 'refs/unknown-group').map((x) => [x.subject, x.evidence])).toEqual([
        ['/groups/0/parent', { id: 'missing', closest: [] }],
        ['/nodes/0/group', { id: 'ap', closest: ['app'] }],
      ]);
    });

    it('unknown view members', () => {
      const d = base({ views: [{ id: 'v', label: 'V', nodes: ['a', 'zz'] }] });
      expect(only(d, 'refs/unknown-view-node')).toMatchObject([{ subject: '/views/0/nodes/1', evidence: { id: 'zz' } }]);
    });

    it('reports each group parent cycle once and terminates', () => {
      const d = base({
        groups: [
          { id: 'x', label: 'X', parent: 'y' },
          { id: 'y', label: 'Y', parent: 'x' },
          { id: 'self', label: 'S', parent: 'self' },
          { id: 'into', label: 'I', parent: 'x' },
        ],
        nodes: [node('a', { group: 'x' }), node('b', { group: 'self' })],
      });
      expect(only(d, 'refs/group-cycle').map((x) => [x.subject, x.evidence])).toEqual([
        ['/groups/0/parent', { cycle: ['x', 'y'] }],
        ['/groups/2/parent', { cycle: ['self'] }],
      ]);
    });

    it('an unknown brand is a warning with the nearest slugs', () => {
      const r = validateDiagram(base({ nodes: [node('a', { card: { title: 'a', brand: 'postgres' } }), node('b')] }));
      expect(r.ok).toBe(true);
      expect(r.diagnostics).toMatchObject([
        { code: 'refs/unknown-brand', severity: 'warning', subject: '/nodes/0/card/brand', evidence: { closest: ['postgresql'] }, allowedFixes: ['use "postgresql"', 'remove "brand"'] },
      ]);
    });
  });

  describe('semantics', () => {
    it('duplicate ids point at the first occurrence', () => {
      const d = base({ nodes: [node('a'), node('b'), node('a')], edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'ab', from: 'b', to: 'a' }] });
      expect(only(d, 'semantics/duplicate-id').map((x) => [x.subject, x.evidence])).toEqual([
        ['/nodes/2/id', { id: 'a', first: '/nodes/0/id' }],
        ['/edges/1/id', { id: 'ab', first: '/edges/0/id' }],
      ]);
    });

    it('a stats note without stats is a warning (it is never shown)', () => {
      expect(only(base({ nodes: [node('a', { card: { title: 'a', statsNote: 'links' } }), node('b')] }), 'semantics/hidden-stats-note')).toMatchObject([
        { severity: 'warning', subject: '/nodes/0/card/statsNote' },
      ]);
    });

    it('an empty footer is a warning (it draws a blank band)', () => {
      expect(only(base({ nodes: [node('a', { card: { title: 'a', footer: {} } }), node('b')] }), 'semantics/empty-footer')).toMatchObject([
        { severity: 'warning', subject: '/nodes/0/card/footer', allowedFixes: ['add "left" or "right"', 'remove "footer"'] },
      ]);
      expect(only(base({ nodes: [node('a', { card: { title: 'a', footer: { right: { text: 'eu' } } } }), node('b')] }), 'semantics/empty-footer')).toEqual([]);
      // Compact cards already reject the footer outright.
      expect(only(base({ density: 'compact', nodes: [node('a', { card: { title: 'a', footer: {} } }), node('b')] }), 'semantics/empty-footer')).toEqual([]);
    });

    it('a duplicate id rename suggestion is itself unused', () => {
      const d = base({ nodes: [node('a'), node('a-2'), node('a')], edges: [] });
      expect(only(d, 'semantics/duplicate-id')[0]!.allowedFixes[0]).toBe('rename to a unique id, e.g. "a-3"');
    });

    it('an unconnected node is an orphan, except in a one-node diagram', () => {
      expect(only(base({ nodes: [node('a'), node('b'), node('c')] }), 'semantics/orphan-node')).toMatchObject([{ subject: '/nodes/2', severity: 'warning' }]);
      expect(diags(base({ nodes: [node('a')], edges: [] }))).toEqual([]);
    });

    it('a self-loop is a warning', () => {
      expect(only(base({ edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'aa', from: 'a', to: 'a' }] }), 'semantics/self-loop')).toMatchObject([
        { subject: '/edges/1', severity: 'warning' },
      ]);
    });

    it('a second edge between the same two nodes, same way, warns where the layout draws them as one line', () => {
      const edges = [
        { id: 'ab', from: 'a', to: 'b', label: 'reads' },
        { id: 'ba', from: 'b', to: 'a', kind: 'return' as const },
        { id: 'ab2', from: 'a', to: 'b', label: 'writes' },
      ];
      expect(only(base({ edges }), 'semantics/parallel-edge')).toMatchObject([
        { subject: '/edges/2', severity: 'warning', evidence: { id: 'ab2', first: 'ab', from: 'a', to: 'b' } },
      ]);
      expect(only(base({ kind: 'dataflow', edges }), 'semantics/parallel-edge')).toHaveLength(1);
      // Swimlanes route parallel edges apart; a sequence repeats messages over time.
      const lane = { lane: 'l' };
      expect(only(base({ kind: 'workflow', lanes: [{ id: 'l', label: 'L' }], nodes: [node('a', lane), node('b', lane)], edges }), 'semantics/parallel-edge')).toEqual([]);
      expect(only(base({ kind: 'sequence', edges }), 'semantics/parallel-edge')).toEqual([]);
    });

    it('two rows with the same label on one card warn at the second', () => {
      const rows = [
        { label: 'Floor', value: 'file: hard' },
        { label: 'Timeout', value: '2.5 s' },
        { label: 'floor ', value: '16k: standard' },
      ];
      expect(only(base({ nodes: [node('a', { card: { title: 'a', rows } }), node('b')] }), 'semantics/duplicate-row-label')).toMatchObject([
        { subject: '/nodes/0/card/rows/2/label', severity: 'warning', evidence: { id: 'a', label: 'floor ', first: '/nodes/0/card/rows/0/label' } },
      ]);
      expect(only(base(), 'semantics/duplicate-row-label')).toEqual([]);
    });

    it('past 60 nodes the diagram warns once to split', () => {
      const nodes = (n: number) => Array.from({ length: n }, (_, i) => node(`n${i}`));
      const chain = (n: number) => Array.from({ length: n - 1 }, (_, i) => ({ id: `e${i}`, from: `n${i}`, to: `n${i + 1}` }));
      expect(only(base({ nodes: nodes(60), edges: chain(60) }), 'semantics/large-diagram')).toEqual([]);
      expect(only(base({ nodes: nodes(61), edges: chain(61) }), 'semantics/large-diagram')).toMatchObject([
        { subject: '/nodes', severity: 'warning', evidence: { nodes: 61, limit: 60 } },
      ]);
    });

    it('cycles warn in dataflow diagrams only', () => {
      const edges = [
        { id: 'ab', from: 'a', to: 'b' },
        { id: 'bc', from: 'b', to: 'c' },
        { id: 'ca', from: 'c', to: 'a' },
      ];
      const nodes = [node('a'), node('b'), node('c')];
      expect(only(base({ kind: 'dataflow', nodes, edges }), 'semantics/dataflow-cycle')).toMatchObject([
        { subject: '/edges/0', severity: 'warning', evidence: { nodes: ['a', 'b', 'c'] } },
      ]);
      expect(only(base({ nodes, edges }), 'semantics/dataflow-cycle')).toEqual([]);
    });

    it('an async feedback edge clears the cycle warning (its suggested fix works)', () => {
      const edges = [
        { id: 'ab', from: 'a', to: 'b' },
        { id: 'ba', from: 'b', to: 'a', kind: 'async' as const },
      ];
      expect(only(base({ kind: 'dataflow', edges }), 'semantics/dataflow-cycle')).toEqual([]);
    });

    it('an empty view is an error, an empty group a warning', () => {
      const r = validateDiagram(base({ views: [{ id: 'v', label: 'V', nodes: [] }], groups: [{ id: 'g', label: 'G' }] }));
      expect(r.ok).toBe(false);
      expect(r.diagnostics.map((x) => [x.code, x.severity, x.subject])).toEqual([
        ['semantics/empty-view', 'error', '/views/0/nodes'],
        ['semantics/empty-group', 'warning', '/groups/0'],
      ]);
    });

    it('a group holding only a child group is not empty', () => {
      const d = base({ groups: [{ id: 'outer', label: 'O' }, { id: 'inner', label: 'I', parent: 'outer' }], nodes: [node('a', { group: 'inner' }), node('b')] });
      expect(only(d, 'semantics/empty-group')).toEqual([]);
    });
  });

  describe('card-fit', () => {
    it('reports an overflowing title with its character budget', () => {
      const title = 'a-very-long-service-name-that-will-never-fit';
      const [d] = only(base({ nodes: [node('a', { card: { title } }), node('b')] }), 'card-fit/overflow');
      expect(d).toMatchObject({ severity: 'error', subject: '/nodes/0/card/title', evidence: { text: title, maxWidth: 200 } });
      const { maxChars, width } = d!.evidence as { maxChars: number; width: number };
      expect(width).toBeGreaterThan(200);
      expect(maxChars).toBeGreaterThan(20);
      expect(maxChars).toBeLessThan(title.length);
      expect(d!.allowedFixes).toEqual([`shorten to at most ${maxChars} characters`, 'move the detail into a card row']);
    });

    it('covers every slot, not just the header', () => {
      const long = 'x'.repeat(80);
      const card = {
        title: 'a',
        rows: [{ label: 'k', value: long }],
        stats: [{ value: '1', label: long }],
        statsNote: long,
        footer: { left: { text: long, icon: 'region' as const } },
        cta: { label: long },
      };
      expect(only(base({ nodes: [node('a', { card }), node('b')] }), 'card-fit/overflow').map((x) => x.subject)).toEqual([
        '/nodes/0/card/rows/0/value',
        '/nodes/0/card/stats/0/label',
        '/nodes/0/card/statsNote',
        '/nodes/0/card/footer/left/text',
        '/nodes/0/card/cta/label',
      ]);
    });

    it('measures text as rendered: runs of spaces collapse, ends are trimmed', () => {
      expect(only(base({ nodes: [node('a', { card: { title: `Orders${' '.repeat(60)}` } }), node('b')] }), 'card-fit/overflow')).toEqual([]);
    });

    it('a row label squeezed by its value also offers shortening the value', () => {
      const card = { title: 'a', rows: [{ label: 'Connection string for the primary', value: 'postgres://orders.internal:5432' }] };
      const [d] = only(base({ nodes: [node('a', { card }), node('b')] }), 'card-fit/overflow').filter((x) => x.subject.endsWith('/label'));
      expect(d!.allowedFixes).toContain('shorten the value at /nodes/0/card/rows/0/value to give the label room');
    });

    it('measures non-Latin text conservatively instead of crashing', () => {
      const [d] = only(base({ nodes: [node('a', { card: { title: '注文サービス本番環境クラスター東京' } }), node('b')] }), 'card-fit/overflow');
      expect(d).toMatchObject({ subject: '/nodes/0/card/title', evidence: { maxChars: 13 } });
    });
  });
});
