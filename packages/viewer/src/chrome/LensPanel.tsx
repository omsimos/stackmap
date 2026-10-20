import { countByType, TYPE_LABELS } from '@stackmap/core';
import { useExplore } from '../explore/ExploreContext';
import { useRef } from 'react';
import { popIn } from '../motion/motion';
import { useEnter } from '../motion/useEnter';
import { PANEL_CLASS, PANEL_STYLE } from './ui';

// Escape is handled by the toolbar, so it closes the lens wherever focus is inside it.
/** `origin`: the trigger's centre to grow from; omitted (opened from the keyboard), the panel just appears. */
export function LensPanel({ origin }: { origin?: string }) {
  const { draft, state, dispatch } = useExplore();
  const panel = useRef<HTMLFieldSetElement>(null);
  useEnter(panel, (el) => popIn(el, origin!), !!origin);
  return (
    <fieldset
      ref={panel}
      className={`${PANEL_CLASS} absolute top-full left-0 z-20 mt-2 w-[240px] p-3`}
      style={PANEL_STYLE}
    >
      <legend className="sr-only">Show node types</legend>
      <div className="mb-1.5 flex items-center px-1.5">
        <p className="text-[12.5px] font-medium text-fg-muted" aria-hidden="true">
          Types
        </p>
        {/* Hiding every type leaves nothing to click back from on the canvas: one way back. */}
        {state.hiddenTypes.size > 0 && (
          <button
            type="button"
            onClick={() => dispatch({ type: 'showAllTypes' })}
            className="ml-auto rounded-md px-1.5 py-0.5 text-[12.5px] text-fg-muted hover:bg-page hover:text-fg focus-visible:outline-2"
          >
            Show all
          </button>
        )}
      </div>
      {countByType(draft.nodes).map(([type, count]) => (
        <label key={type} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-[13px] text-fg hover:bg-page">
          <input
            type="checkbox"
            checked={!state.hiddenTypes.has(type)}
            onChange={() => dispatch({ type: 'toggleType', nodeType: type })}
            className="size-3.5"
            style={{ accentColor: `var(--sm-${type}-accent)` }}
          />
          {TYPE_LABELS[type]}
          <span className="ml-auto text-fg-muted tabular-nums">{count}</span>
        </label>
      ))}
    </fieldset>
  );
}
