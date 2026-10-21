import { select } from 'd3-selection';
import 'd3-transition';
import { zoom, zoomIdentity, type D3ZoomEvent, type ZoomBehavior } from 'd3-zoom';
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Point, Rect } from '@stackmap/core';
import { clearStoredViewport, readStoredViewport } from '../live';
import { CHROME_INSET, fitTransform, MAX_ZOOM, MIN_ZOOM, openingTransform, viewportRect, ZOOM_STEP, type Size, type Transform } from './viewport';

/** Camera moves. Stable across renders, so consumers don't re-render on every pan/zoom frame. */
/** `instant` skips the animation: drags and key auto-repeat would otherwise interrupt it every frame. */
export interface MoveOptions {
  instant?: boolean;
}

export interface Camera {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
  centerOn(p: Point, opts?: MoveOptions): void;
  /** Fit an arbitrary diagram-space rect (e.g. a view's members), never zooming past 100%. */
  fitRect(r: Rect): void;
  panBy(dx: number, dy: number, opts?: MoveOptions): void;
  /** Pan the least distance that brings `r` fully on stage; no-op when it already is. */
  ensureVisible(r: Rect): void;
}

export interface ViewportApi extends Camera {
  transform: Transform;
  stage: Size;
  camera: Camera;
  /** the camera came back from a live reload rather than a fresh fit */
  restored: boolean;
}

/**
 * `zoom`: the wheel zooms, as in a delivered file, which is the whole page. `modifier`: the viewer sits in a page
 * that scrolls, so a plain wheel and a one-finger drag are the page's; ctrl/⌘ + wheel (a trackpad pinch) zooms and
 * two fingers pan and pinch.
 */
export type WheelMode = 'zoom' | 'modifier';

// d3-zoom's default filter, plus the modifier mode's rules. Events it rejects are never prevented.
const zoomFilter = (wheel: WheelMode) => (event: WheelEvent & TouchEvent & MouseEvent) => {
  if (wheel === 'zoom') return (!event.ctrlKey || event.type === 'wheel') && !event.button;
  if (event.type === 'wheel') return event.ctrlKey || event.metaKey;
  if (event.type === 'touchstart') return event.touches.length > 1;
  return !event.ctrlKey && !event.button;
};

const duration = (opts?: MoveOptions) => (opts?.instant || matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150);
const toZoom = (t: Transform) => zoomIdentity.translate(t.x, t.y).scale(t.k);

export function useZoom(stageRef: RefObject<HTMLDivElement | null>, content: Rect, wheel: WheelMode = 'zoom'): ViewportApi {
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const current = useRef(transform);
  current.current = transform;
  // Where an animated pan is heading, so a press during the animation adds to it instead of losing the rest.
  const pending = useRef<Transform | null>(null);
  const [stage, setStage] = useState<Size>({ width: 0, height: 0 });
  const behavior = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  // Read once per mount; `stackmap serve` stores the camera right before it reloads the page.
  const [stored] = useState(() => readStoredViewport());

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const sel = select(el);
    const z = zoom<HTMLDivElement, unknown>()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .filter(zoomFilter(wheel))
      // While the camera moves the scene rides its own compositor layer, so a big diagram isn't repainted every
      // frame; dropping it afterwards re-rasters the text sharp at the new zoom.
      .on('start', () => el.setAttribute('data-moving', ''))
      .on('end', () => el.removeAttribute('data-moving'))
      .on('zoom', (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        if (event.sourceEvent) pending.current = null; // the user took over
        const { x, y, k } = event.transform;
        setTransform({ x, y, k });
      });
    // Double-click zoom is a surprise in a viewer where clicks will select nodes (M3).
    sel.call(z).on('dblclick.zoom', null);
    // d3 claims every touch; in a scrolling page the browser keeps one-finger scrolling.
    if (wheel === 'modifier') el.style.touchAction = 'pan-x pan-y';
    behavior.current = z;

    const size = { width: el.clientWidth, height: el.clientHeight };
    setStage(size);
    sel.call(z.transform, toZoom(stored ?? openingTransform(content, size, CHROME_INSET)));
    if (stored) clearStoredViewport();
    // A stage that mounts hidden or collapsed has no size to fit to; fit on its first real one instead.
    let fitted = stored !== null || (size.width > 0 && size.height > 0);

    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            const next = { width: el.clientWidth, height: el.clientHeight };
            setStage(next);
            if (!fitted && next.width > 0 && next.height > 0) {
              fitted = true;
              sel.call(z.transform, toZoom(openingTransform(content, next, CHROME_INSET)));
            }
          });
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      sel.on('.zoom', null);
      behavior.current = null;
    };
  }, [stageRef, content, stored, wheel]);

  const animate = useCallback(
    (apply: (z: ZoomBehavior<HTMLDivElement, unknown>, el: HTMLDivElement) => void) => {
      const el = stageRef.current;
      const z = behavior.current;
      // A 0×0 stage has nothing to show, and d3's zoom interpolation divides by its size (NaN transform).
      if (el && z && el.clientWidth > 0 && el.clientHeight > 0) apply(z, el);
    },
    [stageRef],
  );

  const zoomIn = useCallback(
    () => animate((z, el) => select(el).transition().duration(duration()).call(z.scaleBy, ZOOM_STEP)),
    [animate],
  );
  const zoomOut = useCallback(
    () => animate((z, el) => select(el).transition().duration(duration()).call(z.scaleBy, 1 / ZOOM_STEP)),
    [animate],
  );
  const fit = useCallback(
    () =>
      animate((z, el) =>
        select(el)
          .transition()
          .duration(duration())
          .call(z.transform, toZoom(fitTransform(content, { width: el.clientWidth, height: el.clientHeight }, { inset: CHROME_INSET }))),
      ),
    [animate, content],
  );
  // Centre between the chrome bands, not on the raw stage, so the node doesn't sit under the toolbar.
  const centerOn = useCallback(
    (p: Point, opts?: MoveOptions) =>
      animate((z, el) => {
        const anchor: [number, number] = [el.clientWidth / 2, (el.clientHeight + CHROME_INSET.top - CHROME_INSET.bottom) / 2];
        pending.current = null;
        // A 0ms transition still lands a frame later, so rapid instant moves would cancel each other.
        if (opts?.instant) select(el).interrupt().call(z.translateTo, p.x, p.y, anchor);
        else select(el).transition().duration(duration()).call(z.translateTo, p.x, p.y, anchor);
      }),
    [animate],
  );

  const fitRect = useCallback(
    (r: Rect) =>
      animate((z, el) => {
        const size = { width: el.clientWidth, height: el.clientHeight };
        const t = fitTransform(r, size, { inset: CHROME_INSET });
        // A view of two cards shouldn't blow up to 200%; cap at 100% and centre between the chrome bands.
        const band = size.height - CHROME_INSET.top - CHROME_INSET.bottom;
        const next =
          t.k <= 1
            ? t
            : { x: (size.width - r.width) / 2 - r.x, y: CHROME_INSET.top + (band - r.height) / 2 - r.y, k: 1 };
        select(el).transition().duration(duration()).call(z.transform, toZoom(next));
      }),
    [animate],
  );
  const panBy = useCallback(
    (dx: number, dy: number, opts?: MoveOptions) =>
      animate((z, el) => {
        const base = pending.current ?? current.current;
        const next = { x: base.x + dx, y: base.y + dy, k: base.k };
        if (duration(opts) === 0) {
          pending.current = null;
          select(el).interrupt().call(z.transform, toZoom(next));
          return;
        }
        pending.current = next;
        select(el)
          .transition()
          .duration(duration())
          .call(z.transform, toZoom(next))
          .on('end', () => {
            if (pending.current === next) pending.current = null;
          });
      }),
    [animate],
  );
  const ensureVisible = useCallback(
    (r: Rect) =>
      animate((z, el) => {
        const { k } = current.current;
        const margin = 24 / k;
        const full = viewportRect(current.current, { width: el.clientWidth, height: el.clientHeight });
        // Treat the overlay bands as off-screen so a focused card never ends up under the chrome.
        const v = { ...full, y: full.y + CHROME_INSET.top / k, height: full.height - (CHROME_INSET.top + CHROME_INSET.bottom) / k };
        const shift = (lo: number, size: number, vlo: number, vsize: number) =>
          lo - margin < vlo ? lo - margin - vlo : lo + size + margin > vlo + vsize ? lo + size + margin - (vlo + vsize) : 0;
        const dx = shift(r.x, r.width, v.x, v.width);
        const dy = shift(r.y, r.height, v.y, v.height);
        if (dx || dy) select(el).transition().duration(duration()).call(z.translateBy, -dx, -dy);
      }),
    [animate],
  );

  const camera = useMemo<Camera>(
    () => ({ zoomIn, zoomOut, fit, centerOn, fitRect, panBy, ensureVisible }),
    [zoomIn, zoomOut, fit, centerOn, fitRect, panBy, ensureVisible],
  );
  return { transform, stage, camera, restored: stored !== null, ...camera };
}
