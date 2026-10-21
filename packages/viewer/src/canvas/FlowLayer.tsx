import { useEffect, useRef } from 'react';
import type { Point } from '@stackmap/core';
import { glowAt, pointAt, PULSE, pulseFrame, ringAt, sliceAt, type Flow, type FlowPulse } from '../motion/flow';
import { setInFlight } from '../motion/inFlight';

const accent = (p: FlowPulse) => `var(--sm-${p.tint}-accent)`;
const polyline = (path: Point[]) => `M${path.map((q) => `${q.x} ${q.y}`).join('L')}`;
const PACKETS = [0, 1, 2];

/** Drives the layer: calls `draw` with ms into playback, or null to hide every pulse; returns a stop. */
export type FlowClock = (draw: (ms: number | null) => void) => () => void;

/** The viewer's own playback: real time at `speed()` (read every frame, so a change carries on without a jump). */
export const playingClock =
  (speed: () => number): FlowClock =>
  (draw) => {
    let last: number | null = null;
    let ms = 0;
    let frame = 0;
    const tick = (now: number) => {
      if (last !== null) ms += (now - last) * speed();
      last = now;
      draw(ms);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  };

/**
 * Flow playback on the canvas, drawing `pulseFrame` for every pulse: a landing glow behind the target, a
 * tapering trail lighting the wire, the port flash, and the head (a dot; a train of packets on an async edge;
 * a hollow ring on a reply). Sits above the edges and under the cards, so glows bloom out from behind a card
 * and a pulse slides out of one card into the next. One rAF loop writes attributes; React renders only when
 * the flow changes; a `clock` (a scroll scrub) can drive it instead. Exports skip it (`data-flow`).
 */
export function FlowLayer({ flow, width, height, speed = 1, clock }: { flow: Flow; width: number; height: number; speed?: number; clock?: FlowClock }) {
  const root = useRef<SVGGElement>(null);
  const rate = useRef(speed);
  rate.current = speed;
  useEffect(() => {
    const groups = [...(root.current?.children ?? [])] as SVGGElement[];
    if (!groups.length) return;
    const parts = groups.map((g) => ({
      glow: g.querySelector<SVGRectElement>('[data-part="glow"]'),
      trails: [...g.querySelectorAll<SVGPathElement>('[data-part="trail"]')],
      flash: g.querySelector<SVGCircleElement>('[data-part="flash"]')!,
      ripple: g.querySelector<SVGCircleElement>('[data-part="ripple"]'),
      heads: [...g.querySelectorAll<SVGGElement>('[data-part="head"]')],
    }));
    // Most pulses rest most of the loop: only write when visibility actually changes.
    const show = (el: SVGElement, on: boolean) => {
      const v = on ? '' : 'hidden';
      if (el.style.visibility !== v) el.style.visibility = v;
      return on;
    };
    // Only the viewer's own playback says which edges are in flight; a borrowed clock is someone else's.
    const tracked = !clock;
    const draw = (ms: number | null) => {
      const flying: string[] = [];
      flow.pulses.forEach((p, i) => {
        const f = ms === null ? null : pulseFrame(flow, p, ms);
        const el = parts[i]!;
        if (!show(groups[i]!, !!f) || !f) return;
        if (f.head !== null) flying.push(p.id);
        if (el.glow && show(el.glow, f.land !== null)) {
          const g = glowAt(p.glow!, f.land!);
          el.glow.setAttribute('x', `${g.rect.x}`);
          el.glow.setAttribute('y', `${g.rect.y}`);
          el.glow.setAttribute('width', `${g.rect.width}`);
          el.glow.setAttribute('height', `${g.rect.height}`);
          el.glow.setAttribute('rx', `${g.radius}`);
          el.glow.style.opacity = `${g.opacity}`;
        }
        if (el.ripple && show(el.ripple, f.land !== null)) {
          const r = ringAt(f.land!, 3, 12);
          el.ripple.setAttribute('r', `${r.r}`);
          el.ripple.style.opacity = `${r.opacity}`;
        }
        el.trails.forEach((t, j) => {
          if (!show(t, !!f.trail)) return;
          const [from, to] = f.trail!;
          const start = Math.max(from, to - (to - from) * PULSE.trail[j]![0]);
          // Only the lit stretch, not the whole edge dashed: a moving dash repaints the edge's whole box every frame.
          t.setAttribute('d', polyline(sliceAt(p.path, start, to)));
        });
        if (show(el.flash, f.depart !== null)) {
          const r = ringAt(f.depart!, 2, 9);
          el.flash.setAttribute('r', `${r.r}`);
          el.flash.style.opacity = `${r.opacity}`;
        }
        el.heads.forEach((h, j) => {
          const d = f.head === null ? -1 : f.head - j * PULSE.packetGap;
          if (!show(h, d >= 0)) return;
          const at = pointAt(p.path, d);
          h.setAttribute('transform', `translate(${at.x} ${at.y})`);
        });
      });
      if (tracked) setInFlight(flying);
    };
    const stop = (clock ?? playingClock(() => rate.current))(draw);
    return () => {
      stop();
      if (tracked) setInFlight([]);
    };
  }, [flow, clock]);
  return (
    <svg aria-hidden="true" data-flow="" className="pointer-events-none absolute top-0 left-0 overflow-visible" width={width} height={height}>
      <g ref={root}>
        {flow.pulses.map((p) => {
          const fill = accent(p);
          const hidden = { visibility: 'hidden' } as const;
          return (
            <g key={p.id} data-pulse={p.id} style={hidden}>
              {p.glow ? (
                <rect data-part="glow" style={{ ...hidden, fill: `var(--sm-${p.glow.tint}-accent)` }} />
              ) : (
                <circle data-part="ripple" cx={p.path.at(-1)!.x} cy={p.path.at(-1)!.y} style={{ ...hidden, fill: 'none', stroke: fill, strokeWidth: 1.5 }} />
              )}
              {/* Async and reply pulses keep the trail faint: their heads carry the look. */}
              {PULSE.trail.map(([, width, opacity], j) => (
                <path
                  key={j}
                  data-part="trail"
                  style={{ ...hidden, fill: 'none', stroke: fill, strokeWidth: width, strokeOpacity: p.kind === 'sync' ? opacity : opacity * 0.4, strokeLinejoin: 'round' }}
                />
              ))}
              <circle data-part="flash" cx={p.path[0]!.x} cy={p.path[0]!.y} style={{ ...hidden, fill: 'none', stroke: fill, strokeWidth: 1.5 }} />
              {(p.kind === 'async' ? PACKETS : [0]).map((j) => (
                <g key={j} data-part="head" style={hidden}>
                  {p.kind === 'return' ? (
                    <circle r={PULSE.core + 0.5} style={{ fill: 'var(--sm-stage)', stroke: fill, strokeWidth: 1.75 }} />
                  ) : p.kind === 'async' ? (
                    <circle r={PULSE.packet} style={{ fill, opacity: 1 - j * 0.3 }} />
                  ) : (
                    <>
                      <circle r={PULSE.halo} style={{ fill, fillOpacity: PULSE.haloOpacity }} />
                      <circle r={PULSE.core} style={{ fill }} />
                    </>
                  )}
                </g>
              ))}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
