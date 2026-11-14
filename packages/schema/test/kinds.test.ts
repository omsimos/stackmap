import { describe, expect, it } from 'vitest';
import { GALLERY } from '@stackmap/core/gallery';
import { validateDiagram } from '../src/validate';

const workflow = (over: Record<string, unknown> = {}) => ({
  kind: 'workflow',
  title: 'Release',
  lanes: [
    { id: 'dev', label: 'Developer' },
    { id: 'ci', label: 'CI' },
  ],
  nodes: [
    { id: 'commit', type: 'client', lane: 'dev', card: { title: 'Commit' } },
    { id: 'build', type: 'service', lane: 'ci', card: { title: 'Build', tag: 'reproducible' } },
  ],
  edges: [{ id: 'e1', from: 'commit', to: 'build', tone: 'main' }],
  ...over,
});
const codes = (input: unknown) => validateDiagram(input).diagnostics.map((d) => `${d.severity}:${d.code}@${d.subject}`);

describe('kind rules', () => {
  it('accepts a workflow with lanes, phases, tags, tones and notes', () => {
    const d = workflow({
      phases: [
        { id: 'change', label: 'Change', nodes: ['commit'] },
        { id: 'verify', label: 'Verify', nodes: ['build'] },
      ],
      notes: [{ title: 'Happy path', items: ['Every change is built once'] }],
    });
    expect(validateDiagram(d)).toMatchObject({ ok: true, diagnostics: [] });
  });

  it('requires lanes and a lane per node in lane kinds', () => {
    expect(codes(workflow({ lanes: undefined, nodes: [{ id: 'a', type: 'service', card: { title: 'A' } }], edges: [] }))).toEqual(['error:semantics/missing-lanes@']);
    const noLane = workflow({ nodes: [{ id: 'a', type: 'service', card: { title: 'A' } }, { id: 'b', type: 'service', lane: 'dev', card: { title: 'B' } }], edges: [{ id: 'e', from: 'a', to: 'b' }] });
    expect(codes(noLane)).toEqual(['error:semantics/missing-lane@/nodes/0', 'warning:semantics/empty-lane@/lanes/1']);
    expect(validateDiagram(noLane).diagnostics[0]!.allowedFixes).toEqual(['set "lane": "dev"', 'set "lane": "ci"']);
  });

  it('reports unknown lanes with the closest id', () => {
    const d = workflow({ nodes: [{ id: 'commit', type: 'client', lane: 'devs', card: { title: 'Commit' } }, { id: 'build', type: 'service', lane: 'ci', card: { title: 'Build' } }] });
    const [diag] = validateDiagram(d).diagnostics;
    expect(diag).toMatchObject({ code: 'refs/unknown-lane', subject: '/nodes/0/lane', allowedFixes: ['use "dev"', 'add lane "devs"'] });
  });

  it('keeps lanes, tags and phases out of the kinds that have none', () => {
    const arch = {
      kind: 'architecture',
      title: 'T',
      lanes: [{ id: 'l', label: 'L' }],
      phases: [{ id: 'p', label: 'P', nodes: ['a'] }],
      nodes: [{ id: 'a', type: 'service', lane: 'l', card: { title: 'A', tag: 'x' } }],
      edges: [],
    };
    expect(codes(arch)).toEqual([
      'error:semantics/lane-for-kind@/nodes/0/lane',
      'error:semantics/tag-for-kind@/nodes/0/card/tag',
      'error:semantics/lanes-for-kind@/lanes',
    ]);
  });

  it('lifecycle nodes are states; other kinds use component types', () => {
    const life = workflow({ kind: 'lifecycle', nodes: [{ id: 'commit', type: 'client', lane: 'dev', card: { title: 'Queued' } }, { id: 'build', type: 'active', lane: 'ci', card: { title: 'Running' } }] });
    const [diag] = validateDiagram(life).diagnostics;
    expect(diag).toMatchObject({ code: 'semantics/type-for-kind', subject: '/nodes/0/type', allowedFixes: ['use "start"', 'use one of: start, active, waiting, decision, success, failure, neutral'] });
    expect(codes(workflow({ nodes: [{ id: 'commit', type: 'success', lane: 'dev', card: { title: 'C' } }, { id: 'build', type: 'service', lane: 'ci', card: { title: 'B' } }] }))).toEqual([
      'error:semantics/type-for-kind@/nodes/0/type',
    ]);
  });

  it('compact cards reject full-card sections', () => {
    const d = workflow({ nodes: [{ id: 'commit', type: 'client', lane: 'dev', card: { title: 'C', rows: [{ label: 'k', value: 'v' }], cta: { label: 'Open' } } }, { id: 'build', type: 'service', lane: 'ci', card: { title: 'B' } }] });
    expect(codes(d)).toEqual(['error:semantics/card-section-for-kind@/nodes/0/card/rows', 'error:semantics/card-section-for-kind@/nodes/0/card/cta']);
  });

  it('a self-loop on a compact card is not sent to a card row, which compact cards reject', () => {
    const fixesFor = (d: unknown) => validateDiagram(d).diagnostics.find((x) => x.code === 'semantics/self-loop')!.allowedFixes;
    const loop = { id: 'retry', from: 'build', to: 'build' };
    expect(fixesFor(workflow({ edges: [{ id: 'e1', from: 'commit', to: 'build' }, loop] }))).toEqual(['remove the edge', 'describe the loop in an evidence note instead']);
    const full = { kind: 'architecture', title: 'T', nodes: [{ id: 'build', type: 'service', card: { title: 'B' } }], edges: [loop] };
    expect(fixesFor(full)).toEqual(['remove the edge', 'describe the loop in a card row instead']);
    expect(fixesFor({ ...full, density: 'compact' })).toEqual(['remove the edge', 'describe the loop in an evidence note instead']);
  });

  it('checks phase members, overlaps and order', () => {
    expect(codes(workflow({ phases: [{ id: 'p', label: 'P', edges: ['e1'] }] }))).toEqual(['error:semantics/phase-members@/phases/0/edges', 'error:semantics/phase-members@/phases/0']);
    expect(codes(workflow({ phases: [{ id: 'p', label: 'P', nodes: ['commit'] }, { id: 'q', label: 'Q', nodes: ['commit', 'build'] }] }))).toEqual([
      'error:semantics/phase-overlap@/phases/1/nodes/0',
    ]);
    expect(codes(workflow({ phases: [{ id: 'p', label: 'P', nodes: ['build'] }, { id: 'q', label: 'Q', nodes: ['commit'] }] }))).toEqual(['warning:semantics/phase-order@/edges/0']);
    expect(codes(workflow({ phases: [{ id: 'p', label: 'P', nodes: ['ghost'] }] }))[0]).toBe('error:refs/unknown-phase-node@/phases/0/nodes/0');
  });

  it('warns when a later phase reaches an earlier one through unphased steps', () => {
    const d = {
      kind: 'workflow',
      title: 'Agent',
      lanes: [
        { id: 'agent', label: 'Agent' },
        { id: 'tools', label: 'Tools' },
      ],
      phases: [
        { id: 'plan', label: 'Plan', nodes: ['policy'] },
        { id: 'exec', label: 'Execute', nodes: ['tool'] },
      ],
      nodes: [
        { id: 'tool', type: 'service', lane: 'agent', card: { title: 'tool' } },
        { id: 'trace', type: 'queue', lane: 'tools', card: { title: 'trace' } },
        { id: 'policy', type: 'security', lane: 'agent', card: { title: 'policy' } },
      ],
      edges: [
        { id: 'e1', from: 'tool', to: 'trace' },
        { id: 'e2', from: 'trace', to: 'policy' },
      ],
    };
    expect(codes(d)).toEqual(['warning:semantics/phase-order@/edges/1']);
    // "trace" is in no phase, so placing it is a way out.
    expect(validateDiagram(d).diagnostics[0]!.allowedFixes).toContain('put "trace" in a phase');
  });

  it('does not suggest phasing the source of a phase-order edge that already has a phase', () => {
    const d = workflow({ phases: [{ id: 'p', label: 'P', nodes: ['build'] }, { id: 'q', label: 'Q', nodes: ['commit'] }] });
    expect(validateDiagram(d).diagnostics[0]!.allowedFixes).toEqual(['mark it "kind": "return" if it loops back on purpose', 'reorder the phases']);
  });

  it('warns when a lane group would frame a step that is not in it', () => {
    const d = workflow({
      lanes: [{ id: 'dev', label: 'Dev' }],
      groups: [{ id: 'g', label: 'G' }],
      nodes: [
        { id: 'x', type: 'service', lane: 'dev', group: 'g', card: { title: 'X' } },
        { id: 'm', type: 'service', lane: 'dev', card: { title: 'M' } },
        { id: 'y', type: 'service', lane: 'dev', group: 'g', card: { title: 'Y' } },
      ],
      edges: [
        { id: 'xm', from: 'x', to: 'm' },
        { id: 'my', from: 'm', to: 'y' },
      ],
    });
    const [diag] = validateDiagram(d).diagnostics;
    expect(diag).toMatchObject({ code: 'semantics/group-not-contiguous', severity: 'warning', subject: '/groups/0', evidence: { inside: ['m'] } });
  });

  it('a group in a lane kind sits in one lane and does not nest', () => {
    const d = workflow({
      groups: [{ id: 'g', label: 'G' }, { id: 'h', label: 'H', parent: 'g' }],
      nodes: [
        { id: 'commit', type: 'client', lane: 'dev', group: 'g', card: { title: 'C' } },
        { id: 'build', type: 'service', lane: 'ci', group: 'g', card: { title: 'B' } },
      ],
    });
    expect(codes(d)).toEqual(['warning:semantics/empty-group@/groups/1', 'error:semantics/group-spans-lanes@/groups/0', 'error:semantics/nested-group-for-kind@/groups/1/parent']);
  });

  it('architecture and dataflow take stage phases of ungrouped nodes, and compact cards on request', () => {
    const flow = {
      kind: 'dataflow',
      title: 'T',
      density: 'compact',
      groups: [{ id: 'g', label: 'G' }],
      phases: [{ id: 'src', label: 'Sources', nodes: ['a', 'b'] }],
      nodes: [
        { id: 'a', type: 'client', card: { title: 'A', tag: 'SDK' } },
        { id: 'b', type: 'service', group: 'g', card: { title: 'B' } },
        { id: 'c', type: 'database', card: { title: 'C', rows: [{ label: 'k', value: 'v' }] } },
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'b' },
        { id: 'e2', from: 'b', to: 'c' },
      ],
    };
    expect(codes(flow)).toEqual(['error:semantics/card-section-for-kind@/nodes/2/card/rows', 'error:semantics/phase-member-in-group@/nodes/1/group', 'warning:semantics/unphased-node@/nodes/2']);
    expect(codes({ ...flow, kind: 'workflow', lanes: [{ id: 'l', label: 'L' }], groups: undefined, phases: undefined, nodes: flow.nodes.map((n) => ({ ...n, group: undefined, lane: 'l', card: { title: n.card.title } })) })).toEqual([
      'warning:semantics/density-ignored@/density',
    ]);
  });

  it('warns that a group beside phases can lie across their bands', () => {
    const staged = {
      kind: 'architecture',
      title: 't',
      groups: [{ id: 'g', label: 'G' }],
      phases: [{ id: 'in', label: 'In', nodes: ['a'] }, { id: 'out', label: 'Out', nodes: ['c'] }],
      nodes: [
        { id: 'a', type: 'client', card: { title: 'A' } },
        { id: 'b', type: 'service', group: 'g', card: { title: 'B' } },
        { id: 'c', type: 'database', card: { title: 'C' } },
      ],
      edges: [
        { id: 'e1', from: 'a', to: 'b' },
        { id: 'e2', from: 'b', to: 'c' },
      ],
    };
    expect(codes(staged)).toEqual(['warning:semantics/group-outside-phases@/groups/0']);
    expect(codes({ ...staged, phases: undefined })).toEqual([]);
  });

  it('sequence: replies must answer a call, and time bands follow each other', () => {
    const seq = (edges: unknown[], phases?: unknown[]) => ({
      kind: 'sequence',
      title: 'T',
      nodes: [
        { id: 'a', type: 'client', card: { title: 'A' } },
        { id: 'b', type: 'service', card: { title: 'B' } },
      ],
      edges,
      ...(phases ? { phases } : {}),
    });
    const call = { id: 'c', from: 'a', to: 'b' };
    const reply = { id: 'r', from: 'b', to: 'a', kind: 'return' };
    expect(codes(seq([call, reply]))).toEqual([]);
    expect(codes(seq([reply, call]))).toEqual(['warning:semantics/unmatched-return@/edges/0']);
    expect(codes(seq([{ ...call, kind: 'async' }, reply]))).toEqual(['warning:semantics/unmatched-return@/edges/1']);
    // A self-call is fine, and draws no self-loop warning.
    expect(codes(seq([call, { id: 's', from: 'b', to: 'b', label: 'cache' }, reply]))).toEqual([]);
    const bands = [
      { id: 'p', label: 'P', edges: ['c', 'r'] },
      { id: 'q', label: 'Q', edges: ['r2'] },
    ];
    expect(codes(seq([call, reply, { ...call, id: 'c2' }, { ...reply, id: 'r2' }], bands))).toEqual([]);
    expect(codes(seq([call, { ...call, id: 'c2' }, reply, { ...reply, id: 'r2' }], [{ id: 'p', label: 'P', edges: ['c', 'r'] }, { id: 'q', label: 'Q', edges: ['c2'] }]))).toEqual([
      'warning:semantics/phase-gap@/phases/0/edges',
      'error:semantics/phase-overlap@/phases/1',
    ]);
    expect(codes({ ...seq([call]), groups: [{ id: 'g', label: 'G' }] })).toContain('error:semantics/groups-for-kind@/groups');
    expect(codes(seq([call, { ...call, id: 'c2' }, reply, { ...reply, id: 'r2' }], [{ id: 'p', label: 'P', edges: ['c', 'r'] }]))).toContain('warning:semantics/phase-gap@/phases/0/edges');
  });

  it('warns that lane kinds ignore direction', () => {
    expect(codes(workflow({ direction: 'DOWN' }))).toEqual(['warning:semantics/direction-ignored@/direction']);
  });

  it('measures compact cards against the compact budget', () => {
    const d = workflow({ nodes: [{ id: 'commit', type: 'client', lane: 'dev', card: { title: 'Production deployment approval' } }, { id: 'build', type: 'service', lane: 'ci', card: { title: 'B' } }] });
    const [diag] = validateDiagram(d).diagnostics;
    expect(diag).toMatchObject({ code: 'card-fit/overflow', subject: '/nodes/0/card/title', evidence: { maxWidth: 114 } });
    expect(diag!.allowedFixes).toContain('move the detail into an evidence note');
  });
});

describe('the gallery samples', () => {
  it.each(Object.entries(GALLERY))('%s validates with no diagnostics', (_name, d) => {
    expect(validateDiagram(d).diagnostics.map((x) => `${x.code}@${x.subject}: ${x.message}`)).toEqual([]);
  });
});
