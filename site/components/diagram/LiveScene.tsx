'use client';

import { useMemo, useRef, type RefObject } from 'react';
import type { LaidOutDiagram } from '@stackmap/core';
import { toScene, type Scene } from '@stackmap/viewer/src/canvas/scene';
import { SceneLayers } from '@stackmap/viewer/src/canvas/SceneLayers';
import type { Camera } from '@stackmap/viewer/src/canvas/useZoom';
import { CameraProvider } from '@stackmap/viewer/src/canvas/ViewportContext';
import { ExploreProvider, useExplore } from '@stackmap/viewer/src/explore/ExploreContext';
import { motionAllowed } from '@stackmap/viewer/src/motion/motion';
import { useFlow } from '@stackmap/viewer/src/motion/useFlow';
import { useSceneReveal } from '@stackmap/viewer/src/motion/useSceneReveal';
import { useFit } from './useFit';

const noop = () => {};
const still: Camera = { zoomIn: noop, zoomOut: noop, fit: noop, centerOn: noop, fitRect: noop, panBy: noop, ensureVisible: noop };

function Layers({ root, scene, flowing }: { root?: RefObject<HTMLDivElement | null>; scene: Scene; flowing: boolean }) {
  const { emphasis } = useExplore();
  const flow = useFlow(scene);
  const { content } = scene;
  return (
    <div ref={root} className="absolute top-0 left-0" style={{ transform: `translate(${-content.x}px, ${-content.y}px)` }}>
      <SceneLayers scene={scene} emphasis={emphasis} selected={null} flow={flowing ? flow : null} />
    </div>
  );
}

// Mounted afresh for each replay: the viewer's reveal plays when a scene first mounts.
function Intro({ scene, flowing }: { scene: Scene; flowing: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useSceneReveal(root, scene, false);
  return <Layers root={root} scene={scene} flowing={flowing} />;
}

/**
 * A diagram drawn by the viewer's own layers, scaled to fit its box and never past `max`: no camera and nothing to
 * click. A new `play` (above 0) replays the viewer's intro; `flow` loops its pulses, never with reduced motion.
 * `box` is the size it is first fitted to, so the server's markup is already fitted.
 */
export function LiveScene({
  diagram,
  box: initial,
  play = 0,
  flow = false,
  pad = 24,
  max = 1,
}: {
  diagram: LaidOutDiagram;
  box: { width: number; height: number };
  play?: number;
  flow?: boolean;
  pad?: number;
  max?: number;
}) {
  const scene = useMemo(() => toScene(diagram), [diagram]);
  const { width, height } = scene.content;
  const [box, k] = useFit(scene.content, initial, pad, max);
  const flowing = flow && motionAllowed();
  return (
    <div ref={box} className="relative size-full overflow-hidden">
      <div inert className="absolute top-1/2 left-1/2" style={{ width, height, transform: `translate(-50%, -50%) scale(${k})` }}>
        <ExploreProvider draft={diagram.draft} syncHash={false}>
          <CameraProvider value={still}>
            {play > 0 ? <Intro key={play} scene={scene} flowing={flowing} /> : <Layers scene={scene} flowing={flowing} />}
          </CameraProvider>
        </ExploreProvider>
      </div>
    </div>
  );
}
