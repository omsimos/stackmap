import { Pause, Play } from 'lucide-react';
import { useExplore } from '../explore/ExploreContext';
import { SPEEDS } from '../explore/state';
import { hasFlow } from '../motion/flowOf';
import { motionAllowed } from '../motion/motion';
import { IconButton } from './ui';

/** Toggles flow playback; a toggle keeps one label (aria-pressed says whether it's on), only the icon swaps. */
export function PlayButton() {
  const { state, dispatch, emphasis } = useExplore();
  const allowed = motionAllowed();
  const on = state.playing && allowed;
  // A running flow can always be stopped, even once the lens or a search has dimmed everything it ran on.
  const playable = on || hasFlow(state, emphasis);
  return (
    <IconButton
      label={!allowed ? 'Play the flow (off: reduced motion)' : playable ? 'Play the flow (P)' : 'Play the flow (nothing shown to play)'}
      pressed={on}
      disabled={!allowed || !playable}
      onClick={() => dispatch({ type: 'togglePlay' })}
    >
      {on ? <Pause size={17} strokeWidth={1.75} /> : <Play size={17} strokeWidth={1.75} />}
    </IconButton>
  );
}

/** While the flow plays: its speed, a click stepping 1× → 2× → 0.5×. */
export function SpeedButton() {
  const { state, dispatch } = useExplore();
  if (!state.playing || !motionAllowed()) return null;
  const next = SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length];
  return (
    <IconButton label={`Flow speed ${state.speed}× (next: ${next}×)`} onClick={() => dispatch({ type: 'cycleSpeed' })}>
      <span className="text-[12px] font-medium tabular-nums">{state.speed}×</span>
    </IconButton>
  );
}
