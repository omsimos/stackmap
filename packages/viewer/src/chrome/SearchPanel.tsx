import { useEffect, useRef, useState } from 'react';
import { TYPE_LABELS } from '@stackmap/core';
import { searchMatches } from '../explore/emphasis';
import { focusCard } from '../canvas/SceneLayers';
import { useExplore } from '../explore/ExploreContext';
import { useViewerRoot } from '../explore/scope';
import { popIn } from '../motion/motion';
import { useEnter } from '../motion/useEnter';
import { PANEL_CLASS, PANEL_STYLE } from './ui';

const MAX_RESULTS = 8;

/** `origin`: the trigger's centre, so the panel grows out of it; omitted, the panel just appears (keyboard `/`). */
export function SearchPanel({ onClose, origin }: { onClose: () => void; origin?: string }) {
  const { draft, state, dispatch } = useExplore();
  const root = useViewerRoot();
  const input = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEnter(panel, (el) => popIn(el, origin!), !!origin);
  const [active, setActive] = useState(0);
  const query = state.query ?? '';
  const results = searchMatches(draft, query).slice(0, MAX_RESULTS);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => setActive(0), [query]);

  // Focus follows the choice, so the keyboard user lands on the card (Enter, arrows, Esc all work there).
  const choose = (id: string) => {
    dispatch({ type: 'select', id, reveal: true });
    dispatch({ type: 'search', query: null });
    requestAnimationFrame(() => focusCard(id, root()));
  };
  return (
    <div ref={panel} className={`${PANEL_CLASS} absolute top-full left-0 z-20 mt-2 w-[320px] p-2`} style={PANEL_STYLE}>
      <input
        ref={input}
        role="combobox"
        aria-label="Search nodes"
        aria-expanded={results.length > 0}
        aria-controls={query.trim() ? 'sm-search-results' : undefined}
        aria-activedescendant={results[active] ? `sm-result-${results[active].id}` : undefined}
        value={query}
        placeholder="Search nodes…"
        className="h-9 w-full rounded-xl bg-page px-3 text-[14px] text-fg outline-none placeholder:text-fg-muted"
        onChange={(e) => dispatch({ type: 'search', query: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
          else if (e.key === 'Enter' && results[active]) choose(results[active].id);
          else if (e.key === 'Escape') onClose();
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      />
      {query.trim() && (
        <ul id="sm-search-results" role="listbox" aria-label="Matching nodes" className="mt-1.5 max-h-72 overflow-y-auto">
          {results.length ? (
            results.map((n, i) => (
              <li
                key={n.id}
                id={`sm-result-${n.id}`}
                role="option"
                aria-selected={i === active}
                className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-fg aria-selected:bg-page"
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(n.id)}
              >
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: `var(--sm-${n.type}-accent)` }} />
                <span className="truncate">{n.card.title}</span>
                <span className="ml-auto shrink-0 text-[12px] text-fg-muted">{TYPE_LABELS[n.type]}</span>
              </li>
            ))
          ) : (
            <li className="px-2.5 py-2 text-[13px] text-fg-muted">No matching nodes</li>
          )}
        </ul>
      )}
    </div>
  );
}
