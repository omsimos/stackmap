import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect } from 'react';
import { useExplore } from '../explore/ExploreContext';
import { PlayButton, SpeedButton } from './PlayButton';
import { IconButton, PANEL_CLASS, PANEL_STYLE } from './ui';

/** Presentation steps: Overview, then each authored view. */
export function useSteps() {
  const { draft, state, dispatch } = useExplore();
  const steps = [{ id: null as string | null, label: 'Overview', caption: draft.subtitle }, ...(draft.views ?? []).map((v) => ({ id: v.id as string | null, label: v.label, caption: v.caption }))];
  const at = Math.max(0, steps.findIndex((s) => s.id === state.view));
  const go = (i: number) => dispatch({ type: 'view', id: steps[Math.min(steps.length - 1, Math.max(0, i))]!.id });
  return { steps, at, go };
}

/**
 * The bar a presentation keeps on screen: the step's label and caption, where it is in the deck, and the way
 * on and out. Arrows, Page Up/Down, Space, Home and End step from anywhere (captured before the canvas's pan keys).
 */
export function PresentBar({ onExit }: { onExit: () => void }) {
  const { steps, at, go } = useSteps();
  const step = steps[at]!;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘/Ctrl/Alt with an arrow is the browser's own (back, forward, end of page).
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Space and Enter on a focused button press that button.
      if ((e.key === ' ' || e.key === 'Enter') && e.target instanceof HTMLButtonElement) return;
      const to = { ArrowRight: at + 1, PageDown: at + 1, ' ': at + 1, ArrowLeft: at - 1, PageUp: at - 1, Home: 0, End: steps.length - 1 }[e.key];
      if (e.key === 'Escape') onExit();
      else if (to !== undefined) go(to);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    addEventListener('keydown', onKey, { capture: true });
    return () => removeEventListener('keydown', onKey, { capture: true });
  }, [at, steps.length, go, onExit]);
  return (
    <div className="sm-panel absolute bottom-6 left-1/2 z-20 w-[min(720px,calc(100%-48px))] -translate-x-1/2">
      <div role="group" aria-label="Presentation" className={`${PANEL_CLASS} flex items-center gap-3 p-2 pl-5`} style={PANEL_STYLE}>
        <div className="min-w-0 flex-1 py-1">
          <div className="truncate text-[15px] font-semibold text-fg" aria-live="polite">
            {step.label}
          </div>
          {step.caption && <div className="truncate text-[13px] text-fg-muted">{step.caption}</div>}
        </div>
        <span className="shrink-0 text-[13px] text-fg-muted tabular-nums">
          {at + 1} / {steps.length}
        </span>
        {steps.length > 1 && (
          <>
            <IconButton label="Previous step" disabled={at === 0} onClick={() => go(at - 1)}>
              <ChevronLeft size={18} strokeWidth={1.75} />
            </IconButton>
            <IconButton label="Next step" disabled={at === steps.length - 1} onClick={() => go(at + 1)}>
              <ChevronRight size={18} strokeWidth={1.75} />
            </IconButton>
          </>
        )}
        <PlayButton />
        <SpeedButton />
        <IconButton label="End presentation (Esc)" onClick={onExit}>
          <X size={17} strokeWidth={1.75} />
        </IconButton>
      </div>
    </div>
  );
}
