import { describe, expect, it } from 'vitest';
import { explore, formatHash, INITIAL, parseHash, type Speed } from './state';

const known = { nodes: new Set(['api', 'db']), views: new Set(['data']), types: new Set(['service', 'database'] as const) };

describe('explorer reducer', () => {
  it('selects, toggles trace, and clears with Escape semantics', () => {
    let s = explore(INITIAL, { type: 'select', id: 'api' });
    s = explore(s, { type: 'toggleTrace' });
    expect(s).toMatchObject({ selected: 'api', trace: true });
    s = explore(s, { type: 'clear' });
    expect(s).toMatchObject({ selected: null, query: null });
    expect(s.trace).toBe(true); // a mode, not a selection: survives clear
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
  it('the next two card clicks pick the ends; empty canvas keeps picking; clear ends it', () => {
    let s = explore({ ...INITIAL, selected: 'api', trace: true }, { type: 'toggleRoute' });
    expect(s).toMatchObject({ routing: { next: 'from' }, selected: null, trace: false });
    s = explore(s, { type: 'select', id: 'api' });
    s = explore(s, { type: 'select', id: null });
    s = explore(s, { type: 'select', id: 'api' });
    expect(s.routing).toEqual({ next: 'to', start: 'api' });
    s = explore(s, { type: 'select', id: 'db' });
    expect(s).toMatchObject({ routing: null, route: { from: 'api', to: 'db' }, selected: null });
    expect(formatHash(s)).toBe('#route=api~db');
    expect(explore(s, { type: 'clear' }).route).toBeNull();
    // Trace waits while a route is shown; a card click leaves the route for that card.
    expect(explore(s, { type: 'toggleTrace' }).trace).toBe(false);
    expect(explore(s, { type: 'select', id: 'db' })).toMatchObject({ route: null, selected: 'db' });
    expect(explore(s, { type: 'toggleRoute' }).route).toBeNull();
  });

  it('plays the flow as a mode: survives clear and deep links', () => {
    const s = explore(INITIAL, { type: 'togglePlay' });
    expect(s.playing).toBe(true);
    expect(explore(s, { type: 'clear' }).playing).toBe(true);
    expect(formatHash(s)).toBe('#play=1');
    expect(parseHash('#route=api~db&play=1', known)).toMatchObject({ playing: true, route: { from: 'api', to: 'db' } });
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
    expect(parseHash('#route=api~db', known).route).toEqual({ from: 'api', to: 'db' });
    expect(parseHash('#route=api~ghost', known).route).toBeNull();
    expect(parseHash('#route=api', known).route).toBeNull();
    expect(parseHash('#route=api~api', known).route).toBeNull();
  });
});
