import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type Dispatch, type ReactNode } from 'react';
import type { DiagramDraft } from '@stackmap/core';
import { emphasis, type Emphasis } from './emphasis';
import { buildGraph, type Graph } from './graph';
import { explore, formatHash, INITIAL, parseHash, type ExploreAction, type ExploreState, type Known } from './state';

export interface Explore {
  draft: DiagramDraft;
  state: ExploreState;
  dispatch: Dispatch<ExploreAction>;
  graph: Graph;
  emphasis: Emphasis;
}

const ExploreContext = createContext<Explore | null>(null);
// `dispatch` never changes; cards read it from here so explorer state changes don't re-render them all.
const DispatchContext = createContext<Dispatch<ExploreAction> | null>(null);
/** For scenes drawn without an explorer (StaticScene): cards dispatch into this instead. */
export const DispatchProvider = DispatchContext.Provider;

export function useExploreDispatch(): Dispatch<ExploreAction> {
  const d = useContext(DispatchContext);
  if (!d) throw new Error('useExploreDispatch must be used inside ExploreProvider');
  return d;
}

export function useExplore(): Explore {
  const ctx = useContext(ExploreContext);
  if (!ctx) throw new Error('useExplore must be used inside ExploreProvider');
  return ctx;
}

const knownOf = (d: DiagramDraft): Known => ({
  nodes: new Set(d.nodes.map((n) => n.id)),
  views: new Set((d.views ?? []).map((v) => v.id)),
  types: new Set(d.nodes.map((n) => n.type)),
});

export function ExploreProvider({
  draft,
  syncHash = true,
  children,
}: {
  draft: DiagramDraft;
  /** false when the viewer is one part of someone else's page: the URL is that page's, not a deep link */
  syncHash?: boolean;
  children: ReactNode;
}) {
  const known = useMemo(() => knownOf(draft), [draft]);
  const [state, dispatch] = useReducer(explore, undefined, () => (syncHash ? parseHash(location.hash, known) : INITIAL));
  const graph = useMemo(() => buildGraph(draft.nodes.map((n) => n.id), draft.edges, { timed: draft.kind === 'sequence' }), [draft]);
  const { peek, view, query, trace, selected, route, routing, hiddenTypes } = state;
  // Only what emphasis reads: a speed or play toggle must not rebuild it, or the playing flow restarts from 0.
  const em = useMemo(
    () => emphasis(draft, graph, { peek, view, query, trace, selected, route, routing, hiddenTypes }),
    [draft, graph, peek, view, query, trace, selected, route, routing, hiddenTypes],
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  // Deep links: the hash mirrors view/node/lens without adding history entries.
  const hash = formatHash(state);
  useEffect(() => {
    if (!syncHash || hash === location.hash || (!hash && !location.hash)) return;
    history.replaceState(history.state, '', hash || location.pathname + location.search);
  }, [hash, syncHash]);
  useEffect(() => {
    if (!syncHash) return;
    // A new node in the hash is a new reveal, so the camera follows every deep link, not just the first.
    const onHash = () =>
      dispatch({
        type: 'replace',
        state: { ...parseHash(location.hash, known), trace: false, reveal: stateRef.current.reveal + 1 },
      });
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, [known, syncHash]);

  const value = useMemo(() => ({ draft, state, dispatch, graph, emphasis: em }), [draft, state, graph, em]);
  return (
    <DispatchContext.Provider value={dispatch}>
      <ExploreContext.Provider value={value}>{children}</ExploreContext.Provider>
    </DispatchContext.Provider>
  );
}
