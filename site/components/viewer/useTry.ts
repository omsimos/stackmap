'use client';

import { useState } from 'react';
import { useExplore } from '@stackmap/viewer/src/explore/ExploreContext';

export type Try = 'select' | 'trace' | 'route' | 'find' | 'views' | 'play';

/** What a demo shows off; each must exist in the diagram. */
export interface Showcase {
  select: string;
  route: [string, string];
  query: string;
  view: string;
}

/**
 * Buttons that each put the real viewer in one state: the modes are exclusive, and Play runs over any of them.
 * `shown` is the mode to describe: Play from its press until it stops or the mode under it changes, else the one on.
 */
export function useTry(show: Showcase) {
  const { state, dispatch } = useExplore();
  // The mode that was on when Play was last pressed; undefined once another button is.
  const [playedOver, setPlayedOver] = useState<Try | null>();
  const active: Try | null = state.route || state.routing ? 'route' : state.query !== null ? 'find' : state.selected && state.trace ? 'trace' : state.selected ? 'select' : state.view ? 'views' : null;
  const on = (id: Try) => (id === 'play' ? state.playing : active === id);
  const reset = () => {
    dispatch({ type: 'clear' });
    if (state.trace) dispatch({ type: 'toggleTrace' });
    if (state.view) dispatch({ type: 'view', id: null });
  };
  const go = (id: Try) => {
    setPlayedOver(id === 'play' ? active : undefined);
    if (id === 'play') return dispatch({ type: 'togglePlay' });
    const wasOn = on(id);
    reset();
    if (wasOn) return;
    if (id === 'select' || id === 'trace') {
      dispatch({ type: 'select', id: show.select });
      if (id === 'trace') dispatch({ type: 'toggleTrace' });
    } else if (id === 'route') {
      dispatch({ type: 'toggleRoute' });
      dispatch({ type: 'select', id: show.route[0] });
      dispatch({ type: 'select', id: show.route[1] });
    } else if (id === 'find') dispatch({ type: 'search', query: show.query });
    else dispatch({ type: 'view', id: show.view });
  };
  const shown = state.playing && playedOver === active ? 'play' : active;
  return { on, go, shown, state };
}
