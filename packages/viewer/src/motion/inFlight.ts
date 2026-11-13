import { createContext, useContext, useSyncExternalStore } from 'react';

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The edges a pulse is travelling right now, for chrome that follows playback (the route's step list).
 * Published by the flow layer only when the set changes, so subscribers re-render per hop, not per frame.
 */
export interface InFlight {
  set(ids: string[]): void;
  get(): ReadonlySet<string>;
  subscribe(listener: () => void): () => void;
}

export function createInFlight(): InFlight {
  let current = EMPTY;
  let key = '';
  const listeners = new Set<() => void>();
  return {
    set(ids) {
      const next = ids.join('\n');
      if (next === key) return;
      key = next;
      current = ids.length ? new Set(ids) : EMPTY;
      listeners.forEach((l) => l());
    },
    get: () => current,
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

// One per explorer, not per page: several diagrams can play on one page, each with its own chrome.
const InFlightContext = createContext<InFlight | null>(null);
export const InFlightProvider = InFlightContext.Provider;
export const useInFlightStore = (): InFlight | null => useContext(InFlightContext);

const none = () => () => {};
const empty = () => EMPTY;

export function useInFlight(): ReadonlySet<string> {
  const store = useContext(InFlightContext);
  return useSyncExternalStore(store?.subscribe ?? none, store?.get ?? empty, empty);
}
