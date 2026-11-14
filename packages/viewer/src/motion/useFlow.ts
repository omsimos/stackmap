import { useMemo } from 'react';
import { useExplore } from '../explore/ExploreContext';
import type { Scene } from '../canvas/scene';
import { NO_FLOW, type Flow } from './flow';
import { flowOf } from './flowOf';

export { flowOf };

/** `on` false (nothing is playing): no flow is built, so a change of emphasis costs nothing here. */
export function useFlow(scene: Scene, on = true): Flow {
  const { graph, state, emphasis } = useExplore();
  const { route, selected } = state;
  return useMemo(() => (on ? flowOf(scene, graph, { route, selected }, emphasis) : NO_FLOW), [on, scene, graph, route, selected, emphasis]);
}
