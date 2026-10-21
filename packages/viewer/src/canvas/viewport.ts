import type { Rect } from '@stackmap/core';

export interface Transform {
  x: number;
  y: number;
  k: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2;
export const ZOOM_STEP = 1.2;
/** Below this an 11px edge label renders under ~5.5px: unreadable, so the viewer fades labels out. */
export const LABEL_MIN_ZOOM = 0.5;
export const FIT_PADDING = 0.15;
const OVERFLOW_GUTTER = 24;
/** Phone-width stages: fitting a big diagram there lands on the zoom floor, a smear no one can read. */
export const NARROW_STAGE = 640;

export const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

export interface Inset {
  top: number;
  bottom: number;
}

/** Stage bands under the top-left identity/toolbar row (15 + 52) and the zoom bar (15 + 48), plus a 12px gap. */
export const CHROME_INSET: Inset = { top: 80, bottom: 76 };

/**
 * React Flow's fitView formula (so M0's tuned layouts keep their fitted zoom), except that each vertical
 * side keeps the larger of its padding share and its chrome band: the band only costs zoom when the
 * padding alone wouldn't clear it.
 */
export function fitTransform(
  content: Rect,
  stage: Size,
  {
    inset = { top: 0, bottom: 0 },
    padding = FIT_PADDING,
    minZoom = MIN_ZOOM,
  }: { inset?: Inset; padding?: number; minZoom?: number } = {},
): Transform {
  if (stage.width <= 0 || stage.height <= 0 || content.width <= 0 || content.height <= 0) return { x: 0, y: 0, k: 1 };
  const { width: W, height: H } = stage;
  const { width: w, height: h } = content;
  const half = padding / 2;
  const k = clampZoom(
    Math.max(
      minZoom,
      Math.min(
        W / (w * (1 + padding)),
        H / (h * (1 + padding)),
        (H - inset.top) / (h * (1 + half)),
        (H - inset.bottom) / (h * (1 + half)),
        (H - inset.top - inset.bottom) / h,
      ),
    ),
  );
  const top = Math.max(inset.top, half * h * k);
  const bottom = Math.max(inset.bottom, half * h * k);
  // Still too big at the zoom floor (or the opening floor): centring would open mid-way, so start where the diagram is read from.
  const x = w * k > W ? OVERFLOW_GUTTER : (W - w * k) / 2;
  const y = h * k > H - inset.top - inset.bottom ? inset.top : top + (H - top - bottom - h * k) / 2;
  return { x: x - content.x * k, y: y - content.y * k, k };
}

/** The part of the diagram currently visible on stage, in diagram coordinates. */
export function viewportRect(t: Transform, stage: Size): Rect {
  return { x: -t.x / t.k, y: -t.y / t.k, width: stage.width / t.k, height: stage.height / t.k };
}

/**
 * The first camera. On a narrow stage it opens no smaller than labels stay readable, from where the diagram is
 * read; the Fit button still shows the whole thing.
 */
export function openingTransform(content: Rect, stage: Size, inset: Inset): Transform {
  return fitTransform(content, stage, { inset, minZoom: stage.width < NARROW_STAGE ? LABEL_MIN_ZOOM : MIN_ZOOM });
}
