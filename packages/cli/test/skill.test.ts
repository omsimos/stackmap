import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIAGRAM_KINDS } from '@stackmap/core';
import { SCHEMA_ID } from '@stackmap/schema';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string; version: string };
const skill = (p: string) => readFileSync(new URL(`../../../skill/${p}`, import.meta.url), 'utf8');
const pinned = `${pkg.name}@${pkg.version}`;

// A release bumps the CLI version; the skill must then run and describe that same version.
describe('skill ↔ CLI version', () => {
  it('SKILL.md runs exactly this CLI version', () => {
    const md = skill('SKILL.md');
    const pins = [...md.matchAll(/@omsimos\/stackmap@[\w.-]+/g)].map((m) => m[0]);
    expect(pins.length).toBeGreaterThan(0);
    expect(new Set(pins)).toEqual(new Set([pinned]));
    expect(md).toContain(`version: "${pkg.version}"`);
  });

  it('the JSON Schema id and the examples point at this version', () => {
    expect(SCHEMA_ID).toBe(`https://unpkg.com/${pinned}/dist/stackmap.schema.json`);
    for (const f of readdirSync(new URL('../../../skill/examples/', import.meta.url)).filter((x) => x.endsWith('.json')))
      expect(JSON.parse(skill(`examples/${f}`)).$schema, f).toBe(SCHEMA_ID);
  });
});

describe('package.json', () => {
  it('pins elkjs exactly, and to the version the layout package uses, so a CLI version always gives the same layout', () => {
    const dep = (p: string) => (JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8')) as { dependencies: Record<string, string> }).dependencies.elkjs;
    const cli = dep('../package.json');
    expect(cli).toMatch(/^\d+\.\d+\.\d+$/);
    expect(dep('../../layout/package.json')).toBe(cli);
  });

  it('names every diagram kind in its npm keywords, so a search for any of them finds the package', () => {
    const { keywords } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { keywords: string[] };
    for (const kind of DIAGRAM_KINDS) expect(keywords, kind).toContain(kind);
  });

  it('declares bin paths the way npm publish accepts them (no "./" prefix, or npm drops the bin)', () => {
    const { bin } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { bin: Record<string, string> };
    expect(bin).toEqual({ stackmap: 'dist/cli.js' });
  });
});
