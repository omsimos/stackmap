import { createContext, useCallback, useContext, type RefObject } from 'react';

// A delivered file is the whole page, so its shortcuts listen on the window. Mounted inside another page, the
// viewer gets a scope: its shortcuts then act only on keys pressed while focus is inside that element.
const ScopeContext = createContext<RefObject<HTMLElement | null> | null>(null);

export const ViewerScope = ScopeContext.Provider;

/** Where this viewer's own elements are looked up: its scope, or the page when a delivered file is all of it. */
export function useViewerRoot(): () => ParentNode {
  const root = useContext(ScopeContext);
  return useCallback(() => root?.current ?? document, [root]);
}

/** Whether a window key event is the viewer's to handle: always without a scope, else only from inside it. */
export function useInScope(): (e: Event) => boolean {
  const root = useContext(ScopeContext);
  return useCallback((e: Event) => !root || (e.target instanceof Node && !!root.current?.contains(e.target)), [root]);
}
