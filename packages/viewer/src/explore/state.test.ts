import { describe, expect, it } from 'vitest';
import { explore, formatHash, INITIAL, isRouting, parseHash, routeOf, type ExploreState, type Mode, type Speed } from './state';

const known = { nodes: new Set(['api', 'db']), views: new Set(['data']), types: new Set(['service', 'database'] as const) };

describe('explorer reducer', () => {
  it('selects, toggles trace, and clears with Escape semantics', () => {
    let s = explore(INITIAL, { type: 'select', id: 'api' });
    s = explore(s, { type: 'toggleTrace' });
    expect(s).toMatchObject({ selected: 'api', mode: { kind: 'trace' } });
    s = explore(s, { type: 'clear' });
    expect(s).toMatchObject({ selected: null, query: null });
    expect(s.mode.kind).toBe('trace'); // a mode, not a selection: survives clear
    expect(explore(s, { type: 'toggleTrace' }).mode.kind).toBe('neighbours');
  });

  it('a revealing selection bumps the camera counter; a plain one does not', () => {
    const a = explore(INITIAL, { type: 'select', id: 'api', reveal: true });
    expect(a.reveal).toBe(1);
    expect(explore(a, { type: 'select', id: 'db' }).reveal).toBe(1);
  });

  it('peeks at a type and back, without touching the hash', () => {
    const s = explore(INITIAL, { type: 'peek', nodeType: 'database' });
    expect(s.peek).toBe('database');
    expect(formatHash(s)).toBe('');
    expect(explore(s, { type: 'peek', nodeType: null }).peek).toBeNull();
  });

  it('toggles lens types and switches views', () => {
    let s = explore(INITIAL, { type: 'toggleType', nodeType: 'database' });
    expect([...s.hiddenTypes]).toEqual(['database']);
    s = explore(s, { type: 'toggleType', nodeType: 'database' });
    expect(s.hiddenTypes.size).toBe(0);
    expect(explore(INITIAL, { type: 'view', id: 'data' }).view).toBe('data');
  });

  it('shows every hidden type again at once', () => {
    let s = explore(INITIAL, { type: 'toggleType', nodeType: 'database' });
    s = explore(s, { type: 'toggleType', nodeType: 'service' });
    expect(explore(s, { type: 'showAllTypes' }).hiddenTypes.size).toBe(0);
    expect(explore(INITIAL, { type: 'showAllTypes' })).toBe(INITIAL);
  });
});

describe('hash', () => {
  it('round-trips view, node and lens', () => {
    const s = { ...INITIAL, view: 'data', selected: 'api', hiddenTypes: new Set(['database'] as const) };
    const hash = formatHash(s);
    expect(hash).toBe('#view=data&node=api&lens=database');
    expect(parseHash(hash, known)).toMatchObject({ view: 'data', selected: 'api', hiddenTypes: new Set(['database']), reveal: 1 });
  });

  it('is empty for the initial state', () => {
    expect(formatHash(INITIAL)).toBe('');
  });

  it('ignores unknown ids, types and junk', () => {
    expect(parseHash('#view=nope&node=ghost&lens=lambda,database&x=%E0%A4%A', known)).toEqual({
      ...INITIAL,
      hiddenTypes: new Set(['database']),
    });
    expect(parseHash('', known)).toEqual(INITIAL);
    expect(parseHash('#%%%', known)).toEqual(INITIAL);
  });
});

describe('route picking', () => {
  const picking = (from: ExploreState) => explore(from, { type: 'toggleRoute' });

  it('the next two card clicks pick the ends; empty canvas keeps picking; clear ends it', () => {
    let s = picking({ ...INITIAL, selected: 'api', mode: { kind: 'trace' } });
    // Starting a route replaces trace and drops the selection.
    expect(s).toMatchObject({ mode: { kind: 'pickStart' }, selected: null });
    s = explore(s, { type: 'select', id: null });
    expect(s.mode).toEqual({ kind: 'pickStart' });
    s = explore(s, { type: 'select', id: 'api' });
    s = explore(s, { type: 'select', id: null });
    s = explore(s, { type: 'select', id: 'api' });
    expect(s.mode).toEqual({ kind: 'pickEnd', from: 'api' });
    s = explore(s, { type: 'select', id: 'db' });
    expect(s).toMatchObject({ mode: { kind: 'route', from: 'api', to: 'db' }, selected: null });
    expect(formatHash(s)).toBe('#route=api~db');
    // A route never comes back as trace: ending it returns to plain selection.
    expect(explore(s, { type: 'clear' }).mode).toEqual({ kind: 'neighbours' });
    expect(explore(s, { type: 'toggleRoute' }).mode).toEqual({ kind: 'neighbours' });
    // Trace waits while a route is shown; a card click leaves the route for that card, an empty click keeps it.
    expect(explore(s, { type: 'toggleTrace' })).toBe(s);
    expect(explore(s, { type: 'select', id: 'db' })).toMatchObject({ mode: { kind: 'neighbours' }, selected: 'db' });
    expect(explore(s, { type: 'select', id: null }).mode).toBe(s.mode);
  });

  it('ends a route at any stage of picking, and trace waits through it', () => {
    for (const s of [picking(INITIAL), explore(picking(INITIAL), { type: 'select', id: 'api' })]) {
      expect(explore(s, { type: 'clear' }).mode).toEqual({ kind: 'neighbours' });
      expect(explore(s, { type: 'toggleRoute' }).mode).toEqual({ kind: 'neighbours' });
      expect(explore(s, { type: 'toggleTrace' })).toBe(s);
    }
  });

  it('a revealing selection while picking picks an end and leaves the camera alone', () => {
    const s = explore(picking(INITIAL), { type: 'select', id: 'api', reveal: true });
    expect(s).toMatchObject({ mode: { kind: 'pickEnd', from: 'api' }, reveal: 0, selected: null });
  });

  it('knows which modes are routing, and which one has a route to show', () => {
    const modes: Mode[] = [{ kind: 'neighbours' }, { kind: 'trace' }, { kind: 'pickStart' }, { kind: 'pickEnd', from: 'a' }, { kind: 'route', from: 'a', to: 'b' }];
    expect(modes.map(isRouting)).toEqual([false, false, true, true, true]);
    expect(modes.map(routeOf)).toEqual([null, null, null, null, modes[4]]);
  });

  it('plays the flow as a mode: survives clear and deep links', () => {
    const s = explore(INITIAL, { type: 'togglePlay' });
    expect(s.playing).toBe(true);
    expect(explore(s, { type: 'clear' }).playing).toBe(true);
    expect(formatHash(s)).toBe('#play=1');
    expect(parseHash('#route=api~db&play=1', known)).toMatchObject({ playing: true, mode: { kind: 'route', from: 'api', to: 'db' } });
    expect(parseHash('#play=yes', known).playing).toBe(false);
    expect(explore(s, { type: 'togglePlay' }).playing).toBe(false);
  });

  it('cycles the flow speed through 0.5×, 1× and 2×, and keeps it in the hash', () => {
    expect(INITIAL.speed).toBe(1);
    const cycle = (speed: Speed) => explore({ ...INITIAL, speed }, { type: 'cycleSpeed' }).speed;
    expect([cycle(1), cycle(2), cycle(0.5)]).toEqual([2, 0.5, 1]);
    expect(formatHash({ ...INITIAL, playing: true, speed: 0.5 })).toBe('#play=1&speed=0.5');
    expect(formatHash({ ...INITIAL, speed: 1 })).toBe('');
    expect(parseHash('#speed=2', known).speed).toBe(2);
    expect(parseHash('#speed=3', known).speed).toBe(1);
    expect(explore({ ...INITIAL, speed: 2 }, { type: 'clear' }).speed).toBe(2);
  });

  it('reads a route from the hash, dropping unknown ends', () => {
    expect(parseHash('#route=api~db', known).mode).toEqual({ kind: 'route', from: 'api', to: 'db' });
    for (const bad of ['#route=api~ghost', '#route=api', '#route=api~api', '#route=~db']) expect(parseHash(bad, known).mode).toEqual({ kind: 'neighbours' });
  });
});
