/**
 * How much of the viewer is on screen. Never in the URL: a shared link always opens the whole viewer.
 *
 * - focused (Z): the canvas alone in the window, everything on it still working
 * - presenting (F): the stage alone, full screen where the browser allows it, stepping through the views. It sits
 *   over focus or not and hands back whichever it found; Z and H wait until it ends.
 * - toolbarHidden (H): the toolbar folded to one button, in focus or not. Leaving focus always unfolds it.
 */
export interface Shell {
  focused: boolean;
  presenting: boolean;
  toolbarHidden: boolean;
}

export const SHELL: Shell = { focused: false, presenting: false, toolbarHidden: false };

export type ShellAction =
  | { type: 'present'; on: boolean }
  | { type: 'focus'; on: boolean }
  | { type: 'toolbar'; hidden: boolean };

export function shell(s: Shell, a: ShellAction): Shell {
  switch (a.type) {
    case 'present':
      return s.presenting === a.on ? s : { ...s, presenting: a.on };
    case 'focus':
      if (s.presenting || s.focused === a.on) return s;
      return { ...s, focused: a.on, toolbarHidden: a.on && s.toolbarHidden };
    case 'toolbar':
      return s.presenting || s.toolbarHidden === a.hidden ? s : { ...s, toolbarHidden: a.hidden };
  }
}
