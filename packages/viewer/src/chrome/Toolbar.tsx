import { EyeOff, Filter, Focus, Moon, Presentation, Route, Search, Sun, Waypoints } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useExplore } from '../explore/ExploreContext';
import { useInScope } from '../explore/scope';
import type { ThemeChoice } from '../theme/theme';
import { ExportMenu } from './ExportMenu';
import { LensPanel } from './LensPanel';
import { PlayButton, SpeedButton } from './PlayButton';
import { SearchPanel } from './SearchPanel';
import { IconButton, PANEL_CLASS, PANEL_STYLE, ToolbarDivider } from './ui';

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
export const inMenu = (t: EventTarget | null) => t instanceof Element && !!t.closest('[role="menu"]');

export function Toolbar({
  theme,
  onToggleTheme,
  onPresent,
  focused = false,
  onFocus,
  onHide,
  exports = true,
  trace = true,
}: {
  theme: ThemeChoice;
  onToggleTheme: () => void;
  onPresent?: () => void;
  /** focus mode (Z): the canvas alone */
  focused?: boolean;
  onFocus?: () => void;
  /** a button that hides the toolbar (H) */
  onHide?: () => void;
  /** the export menu; a page that embeds the viewer has no file of its own to export */
  exports?: boolean;
  /** the trace button; an embed that offers trace elsewhere can leave it out */
  trace?: boolean;
}) {
  const { state, dispatch } = useExplore();
  const inScope = useInScope();
  const [lensOpen, setLensOpen] = useState(false);
  const routingRef = useRef(false);
  routingRef.current = !!state.routing || !!state.route;
  const root = useRef<HTMLDivElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const lensButton = useRef<HTMLButtonElement>(null);
  // Popovers opened from the keyboard (`/`, or Enter/Space on the button: a click with detail 0) appear at once.
  const [searchByKey, setSearchByKey] = useState(false);
  const [lensByKey, setLensByKey] = useState(false);
  const originOf = (b: HTMLButtonElement | null) => (b ? `${b.offsetLeft + b.offsetWidth / 2}px 0` : '0 0');
  const closeSearch = () => {
    dispatch({ type: 'search', query: null });
    searchButton.current?.focus();
  };
  const closeLens = () => {
    setLensOpen(false);
    lensButton.current?.focus();
  };
  const next = theme === 'dark' ? 'light' : 'dark';
  const searchOpen = state.query !== null;

  // "/" opens search from anywhere except a text field; Escape from the page body clears the selection
  // (cards, the stage and the popovers handle their own Escape and stop it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!inScope(e)) return;
      const onPage = e.target === document.body || e.target === document.documentElement;
      // Escape from the page body clears; while a route is picked or shown it ends it from any control too.
      if (e.key === 'Escape' && !e.defaultPrevented && !typing(e.target) && (onPage || routingRef.current)) {
        dispatch({ type: 'clear' });
        return;
      }
      // Single-key shortcuts: not while typing, from an open menu, or on key repeat.
      if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.repeat || inMenu(e.target)) return;
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        dispatch({ type: 'toggleRoute' });
        return;
      }
      if (e.key !== '/') return;
      e.preventDefault();
      setLensOpen(false);
      setSearchByKey(true);
      dispatch({ type: 'search', query: '' });
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [dispatch, inScope]);

  // Clicking outside closes the popovers.
  useEffect(() => {
    if (!searchOpen && !lensOpen) return;
    const onDown = (e: PointerEvent) => {
      if (root.current?.contains(e.target as Node)) return;
      setLensOpen(false);
      if (searchOpen) dispatch({ type: 'search', query: null });
    };
    addEventListener('pointerdown', onDown);
    return () => removeEventListener('pointerdown', onDown);
  }, [searchOpen, lensOpen, dispatch]);

  return (
    <div
      ref={root}
      className={`${PANEL_CLASS} relative flex shrink-0 items-center gap-0.5 p-1.5 @max-md:shrink @max-md:flex-wrap`}
      style={PANEL_STYLE}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !lensOpen) return;
        e.preventDefault();
        e.stopPropagation();
        closeLens();
      }}
    >
      <IconButton
        ref={searchButton}
        label="Search nodes (/)"
        pressed={searchOpen}
        expanded={searchOpen}
        onClick={(e) => {
          setLensOpen(false);
          setSearchByKey(e.detail === 0);
          dispatch({ type: 'search', query: searchOpen ? null : '' });
        }}
      >
        <Search size={17} strokeWidth={1.75} />
      </IconButton>
      <IconButton
        ref={lensButton}
        label="Filter by type"
        pressed={lensOpen || state.hiddenTypes.size > 0}
        expanded={lensOpen}
        onClick={(e) => {
          dispatch({ type: 'search', query: null });
          setLensByKey(e.detail === 0);
          setLensOpen((v) => !v);
        }}
      >
        <Filter size={17} strokeWidth={1.75} />
      </IconButton>
      {trace && (
        <IconButton
          label="Trace upstream and downstream of the selection"
          pressed={state.trace && !state.route && !state.routing}
          disabled={!!state.route || !!state.routing}
          onClick={() => dispatch({ type: 'toggleTrace' })}
        >
          <Route size={17} strokeWidth={1.75} />
        </IconButton>
      )}
      <IconButton label="Route between two nodes (R)" pressed={!!state.routing || !!state.route} onClick={() => dispatch({ type: 'toggleRoute' })}>
        <Waypoints size={17} strokeWidth={1.75} />
      </IconButton>
      <PlayButton />
      <SpeedButton />
      <ToolbarDivider />
      {onPresent && (
        <IconButton label="Present (F)" onClick={onPresent}>
          <Presentation size={17} strokeWidth={1.75} />
        </IconButton>
      )}
      {/* A phone's toolbar has no room for these; Z and H still work there with a keyboard. */}
      <span className="contents @max-md:hidden">
        {onFocus && (
          <IconButton label={focused ? 'Leave focus (Z)' : 'Focus on the canvas (Z)'} pressed={focused} onClick={onFocus}>
            <Focus size={17} strokeWidth={1.75} />
          </IconButton>
        )}
        {onHide && (
          <IconButton label="Hide the toolbar (H)" onClick={onHide}>
            <EyeOff size={17} strokeWidth={1.75} />
          </IconButton>
        )}
      </span>
      <IconButton label={`Switch to ${next} theme`} onClick={onToggleTheme}>
        {theme === 'dark' ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
      </IconButton>
      {exports && <ExportMenu />}
      {/* Always mounted, so screen readers announce the hint when its text arrives. */}
      <p
        role="status"
        className={`${state.routing ? `${PANEL_CLASS} absolute top-full left-0 mt-2 w-max px-3 py-2 text-[12.5px] text-fg` : 'sr-only'}`}
        style={state.routing ? PANEL_STYLE : undefined}
      >
        {state.routing && (
          <>
            {state.routing.next === 'from' ? 'Pick where the route starts' : 'Now pick where it ends'}
            {/* The space keeps the two phrases apart for screen readers; ml-2 alone only spaces them visually. */}{' '}
            <span className="ml-1 text-fg-muted">Esc cancels</span>
          </>
        )}
      </p>
      {searchOpen && <SearchPanel onClose={closeSearch} origin={searchByKey ? undefined : originOf(searchButton.current)} />}
      {lensOpen && <LensPanel origin={lensByKey ? undefined : originOf(lensButton.current)} />}
    </div>
  );
}
