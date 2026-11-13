import { describe, expect, it } from 'vitest';
import { cardTextSlots } from '../src/card-text';
import { measureText } from '../src/text-measure';

const slot = (card: Parameters<typeof cardTextSlots>[0], path: string) => cardTextSlots(card).find((s) => s.path === path);

describe('cardTextSlots', () => {
  it('title and subtitle share the header text column', () => {
    const slots = cardTextSlots({ title: 'orders', subtitle: 'Service' });
    expect(slots).toEqual([
      { path: '/title', text: 'orders', face: 'sans500', size: 13.5, maxWidth: 200 },
      { path: '/subtitle', text: 'Service', face: 'sans400', size: 12, maxWidth: 200 },
    ]);
  });

  it('caps a row value at 55% of the row and gives the label the rest', () => {
    const value = ':3000';
    const card = { title: 't', rows: [{ label: '2 vCPU · 2 GB', value, mono: true }] };
    expect(slot(card, '/rows/0/value')).toMatchObject({ face: 'mono400', size: 12, maxWidth: 248 * 0.55 });
    expect(slot(card, '/rows/0/label')!.maxWidth).toBeCloseTo(248 - 12 - measureText(value, 'mono400', 12), 6);
  });

  it('budgets a row label against the value as rendered: whitespace collapsed and trimmed', () => {
    const card = { title: 't', rows: [{ label: 'Port', value: '   x      ' }, { label: 'Port', value: 'a   b' }] };
    expect(slot(card, '/rows/0/label')!.maxWidth).toBeCloseTo(248 - 12 - measureText('x', 'sans400', 12), 6);
    expect(slot(card, '/rows/1/label')!.maxWidth).toBeCloseTo(248 - 12 - measureText('a b', 'sans400', 12), 6);
  });

  it('a long row value leaves the label its floor, not less', () => {
    const card = { title: 't', rows: [{ label: 'Connection', value: 'x'.repeat(200) }] };
    expect(slot(card, '/rows/0/label')!.maxWidth).toBeCloseTo(248 - 12 - 248 * 0.55, 6);
  });

  it('splits the stats panel into equal tiles', () => {
    const card = { title: 't', stats: [{ value: '1', label: 'a' }, { value: '2', label: 'b' }, { value: '3', label: 'c' }] };
    const tile = (256 - 12 - 2 * 6) / 3 - 20;
    expect(slot(card, '/stats/2/value')).toMatchObject({ face: 'sans500tnum', size: 15, maxWidth: tile });
    expect(slot(card, '/stats/2/label')).toMatchObject({ face: 'sans400', size: 11, maxWidth: tile });
  });

  it('measures the stats note only when stats are rendered', () => {
    expect(slot({ title: 't', statsNote: 'orphan' }, '/statsNote')).toBeUndefined();
    const card = { title: 't', stats: [{ value: '1', label: 'a' }], statsNote: '2 links' };
    expect(slot(card, '/statsNote')).toMatchObject({ face: 'sans400', size: 11.5, maxWidth: 214 });
  });

  it('footer halves lose the icon and its gap when an icon is set', () => {
    const card = { title: 't', footer: { left: { text: 'EU West', icon: 'region' as const }, right: { text: 'Stateless' } } };
    expect(slot(card, '/footer/left/text')!.maxWidth).toBe(118 - 13 - 6);
    expect(slot(card, '/footer/right/text')!.maxWidth).toBe(118);
  });

  it('a linked CTA label leaves room for its arrow; an unlinked one (no arrow) gets it back', () => {
    expect(slot({ title: 't', cta: { label: 'Open', href: 'https://x.dev' } }, '/cta/label')).toMatchObject({ face: 'sans500', size: 13, maxWidth: 217 });
    expect(slot({ title: 't', cta: { label: 'Open' } }, '/cta/label')).toMatchObject({ maxWidth: 232 });
  });
});
