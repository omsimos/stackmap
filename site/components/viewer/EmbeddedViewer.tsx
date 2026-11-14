'use client';

import { Workflow } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { KIND_LABELS, type LaidOutDiagram } from '@stackmap/core';
import { CanvasPanel } from '@stackmap/viewer/src/canvas/CanvasPanel';
import { DiagramCanvas } from '@stackmap/viewer/src/canvas/DiagramCanvas';
import { Inspector } from '@stackmap/viewer/src/chrome/Inspector';
import { Toolbar } from '@stackmap/viewer/src/chrome/Toolbar';
import { ViewTabs } from '@stackmap/viewer/src/chrome/ViewTabs';
import { ExploreProvider, useExplore } from '@stackmap/viewer/src/explore/ExploreContext';
import { ViewerScope } from '@stackmap/viewer/src/explore/scope';
import { motionAllowed } from '@stackmap/viewer/src/motion/motion';
import type { StaticDiagram } from '@/lib/data/static-html';
import { FitDiagram } from '@/components/diagram/FitDiagram';
import { toggleTheme, useTheme } from '@/components/site/theme';
import './viewer.css';

const typing = (t: EventTarget) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * Starts the flow once the intro has played, unless the reader got there first; stops it while the frame is off
 * screen and picks it up again on return, so a page of diagrams never animates out of sight.
 */
function useAutoplay(frame: RefObject<HTMLElement | null>, live: boolean, delay: number) {
  const { state, dispatch } = useExplore();
  const playing = useRef(state.playing);
  playing.current = state.playing;
  const paused = useRef(false);
  const onScreen = useRef(false);
  useEffect(() => {
    if (!live || !motionAllowed()) return;
    const t = setTimeout(() => {
      if (playing.current) return;
      // Off screen the start is left to the observer, as if it had paused a running flow.
      if (onScreen.current) dispatch({ type: 'togglePlay' });
      else paused.current = true;
    }, delay);
    return () => clearTimeout(t);
  }, [live, delay, dispatch]);
  useEffect(() => {
    const el = frame.current;
    if (!live || !el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e) return;
      onScreen.current = e.isIntersecting;
      if (!e.isIntersecting && playing.current) {
        paused.current = true;
        dispatch({ type: 'togglePlay' });
      } else if (e.isIntersecting && paused.current) {
        paused.current = false;
        if (!playing.current) dispatch({ type: 'togglePlay' });
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [frame, live, dispatch]);
}

/** The viewer's T: trace the selection. A delivered file traces from the toolbar; the embed adds the key. */
function onTraceKey(e: KeyboardEvent, selected: string | null, trace: () => void) {
  if ((e.key !== 't' && e.key !== 'T') || e.metaKey || e.ctrlKey || e.altKey || e.repeat || typing(e.target) || !selected) return;
  e.preventDefault();
  trace();
}

function Stage({ id, diagram, still, live, children }: { id: string; diagram: LaidOutDiagram; still?: StaticDiagram; live: boolean; children?: ReactNode }) {
  return (
    <section id={id} role="tabpanel" aria-label="Diagram" className="ev-stage @container/stage">
      {live ? (
        <DiagramCanvas diagram={diagram} minimap={false} wheel="modifier">
          {children}
        </DiagramCanvas>
      ) : (
        still && (
          <div className="ev-still">
            <FitDiagram still={still} width={936} height={686} pad={48} fill className="bg-transparent" />
          </div>
        )
      )}
    </section>
  );
}

function HeroFrame({ diagram, still, crumb, live }: { diagram: LaidOutDiagram; still?: StaticDiagram; crumb?: string; live: boolean }) {
  const { draft } = diagram;
  const theme = useTheme() ?? 'light';
  const stage = useId();
  return (
    <>
      {crumb !== undefined && (
        <div className="ev-head">
          <p className="crumb">{crumb}</p>
          <div className="vt">
            <span className="ev-icon" aria-hidden="true">
              <Workflow size={18} strokeWidth={1.75} />
            </span>
            <h2>{draft.title}</h2>
            <span className="badge">{KIND_LABELS[draft.kind]}</span>
            <span className="cnt tnum">
              {draft.nodes.length} nodes · {draft.edges.length} connections
            </span>
          </div>
        </div>
      )}
      <ViewTabs controls={stage} className="ev-tabs h-9" />
      <div className="ev-body">
        <Stage id={stage} diagram={diagram} still={still} live={live}>
          <CanvasPanel position="top-left" className="flex max-w-[calc(100%-30px)]">
            <Toolbar theme={theme} onToggleTheme={toggleTheme} exports={false} trace={false} />
          </CanvasPanel>
        </Stage>
        <Inspector placement="static" headingLevel={crumb === undefined ? 2 : 3} />
      </div>
    </>
  );
}

function Frame({ diagram, still, crumb, label, children }: { diagram: LaidOutDiagram; still?: StaticDiagram; crumb?: string; label: string; children?: ReactNode }) {
  const { state, dispatch } = useExplore();
  const root = useRef<HTMLDivElement>(null);
  // The viewer reads the window (its size, pointer and motion settings), so it takes over from the still once mounted.
  const [live, setLive] = useState(false);
  useEffect(() => setLive(true), []);
  useAutoplay(root, live, 1100);
  return (
    <>
      <ViewerScope value={root}>
        <div
          ref={root}
          className="ev ev-hero @container"
          data-live={live || undefined}
          role="group"
          aria-label={label}
          onKeyDown={(e) => onTraceKey(e, state.selected, () => dispatch({ type: 'toggleTrace' }))}
        >
          <HeroFrame diagram={diagram} still={still} crumb={crumb} live={live} />
        </div>
      </ViewerScope>
      {children}
    </>
  );
}

/**
 * The real viewer, framed for a page: its own explorer that never touches the URL, keys that act only while focus
 * is inside it, and a wheel left to the page. It has view tabs, toolbar, zoom bar and inspector, and under `crumb`
 * a header with the diagram's title (a page that titles the diagram itself leaves `crumb` out). `children` render
 * inside its explorer, so controls beside the frame can drive it. Before it mounts, and without script, the frame
 * shows `still`.
 */
export function EmbeddedViewer({ diagram, still, crumb, children }: { diagram: LaidOutDiagram; still?: StaticDiagram; crumb?: string; children?: ReactNode }) {
  const label = `The stackmap viewer, showing ${diagram.draft.title}. Keys while it has focus: T trace, R route, slash to search, P play, Escape clears.`;
  return (
    <ExploreProvider draft={diagram.draft} syncHash={false}>
      <Frame diagram={diagram} still={still} crumb={crumb} label={label}>
        {children}
      </Frame>
    </ExploreProvider>
  );
}
