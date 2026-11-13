import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIAGRAM_KINDS, KIND_LABELS } from '@stackmap/core';
import { EXAMPLES, exampleHref } from '../lib/catalog';
import { diagnosticCodes } from '../lib/data/codes';
import { DOC_PAGES, neighbours } from '../lib/docs-nav';
import { ROUTES } from '../lib/seo';
import { article } from '../lib/words';

describe('docs navigation', () => {
  it('has every docs page the sitemap does, the kinds included', () => {
    const docs = [...ROUTES.filter((r) => r.startsWith('/docs')), ...DIAGRAM_KINDS.map((k) => `/docs/${k}`)];
    expect(DOC_PAGES.map((p) => p.href).sort()).toEqual(docs.sort());
  });

  it('reads from the quick start through to the examples', () => {
    expect(neighbours('/docs')).toEqual({ prev: undefined, next: { href: '/docs/viewer', title: 'The viewer' } });
    expect(neighbours('/docs/brands').next).toEqual({ href: '/examples', title: 'Examples' });
  });
});

describe('diagnostic codes', () => {
  const codes = diagnosticCodes();

  it('finds every family and the codes the docs show in their samples', () => {
    expect(codes.schema).toContain('schema/invalid-json');
    expect(codes.schema).toContain('schema/unrecognized_keys');
    expect(codes.refs).toContain('refs/unknown-node');
    expect(codes.semantics).toContain('semantics/orphan-node');
    expect(codes['card-fit']).toEqual(['card-fit/overflow']);
  });

  it('misses no code the rules can report', () => {
    const all = new Set(Object.values(codes).flat());
    for (const file of ['refs', 'semantics', 'kinds', 'card-fit']) {
      const src = readFileSync(new URL(`../../packages/schema/src/rules/${file}.ts`, import.meta.url), 'utf8');
      for (const m of src.matchAll(/'((?:refs|semantics|card-fit)\/[a-z-]+)'/g)) expect(all.has(m[1]!), m[1]).toBe(true);
    }
  });
});

describe('example pages', () => {
  it('gives each example its own address', () => {
    expect(new Set(EXAMPLES.map(exampleHref)).size).toBe(EXAMPLES.length);
  });

  it('names each kind with the article it takes', () => {
    expect(DIAGRAM_KINDS.map((k) => `${article(KIND_LABELS[k].toLowerCase(), true)} ${KIND_LABELS[k].toLowerCase()}`)).toEqual([
      'An architecture',
      'A dataflow',
      'A workflow',
      'A lifecycle',
      'A sequence',
    ]);
  });
});

