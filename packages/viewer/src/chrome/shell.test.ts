import { describe, expect, it } from 'vitest';
import { shell, SHELL, type Shell, type ShellAction } from './shell';

const run = (...actions: ShellAction[]) => actions.reduce<Shell>(shell, SHELL);

describe('shell', () => {
  it('H folds the toolbar in or out of focus; leaving focus always unfolds it', () => {
    expect(run({ type: 'toolbar', hidden: true })).toEqual({ ...SHELL, toolbarHidden: true });
    expect(run({ type: 'focus', on: true }, { type: 'toolbar', hidden: true })).toEqual({ focused: true, presenting: false, toolbarHidden: true });
    expect(run({ type: 'focus', on: true }, { type: 'toolbar', hidden: true }, { type: 'focus', on: false })).toEqual(SHELL);
    // Entering focus keeps a toolbar folded outside it.
    expect(run({ type: 'toolbar', hidden: true }, { type: 'focus', on: true }).toolbarHidden).toBe(true);
  });

  it('a presentation sits over focus or not, hands back what it found, and Z and H wait for it', () => {
    const focusedThenPresenting = run({ type: 'focus', on: true }, { type: 'present', on: true });
    expect(focusedThenPresenting).toEqual({ focused: true, presenting: true, toolbarHidden: false });
    expect(shell(focusedThenPresenting, { type: 'focus', on: false })).toBe(focusedThenPresenting);
    expect(shell(focusedThenPresenting, { type: 'toolbar', hidden: true })).toBe(focusedThenPresenting);
    expect(shell(focusedThenPresenting, { type: 'present', on: false })).toEqual({ ...SHELL, focused: true });
  });

  it('returns the same state for a change that changes nothing', () => {
    expect(shell(SHELL, { type: 'present', on: false })).toBe(SHELL);
    expect(shell(SHELL, { type: 'focus', on: false })).toBe(SHELL);
    expect(shell(SHELL, { type: 'toolbar', hidden: false })).toBe(SHELL);
  });
});
