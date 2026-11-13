'use client';

import type { StaticDiagram } from '@/lib/data/static-html';
import { useFit } from './useFit';

const GRID = 20;

/**
 * A diagram at rest, scaled to fit its box and never past 100%. `width` is the box's width at the design
 * size, so the server's markup is already fitted; once hydrated it follows the box's real size. The
 * diagram itself is HTML rendered at build time, so this ships none of the viewer's code.
 */
export function FitDiagram({
  still,
  width,
  height,
  pad = 24,
  fill = false,
  className = '',
}: {
  still: StaticDiagram;
  width: number;
  height: number;
  pad?: number;
  /** take the parent's height instead of `height`, which then only sets the first fit */
  fill?: boolean;
  className?: string;
}) {
  const [box, k] = useFit(still.box, { width, height }, pad);
  return (
    <div
      ref={box}
      role="img"
      aria-label={`${still.title}: ${still.nodes} nodes, ${still.edges} connections`}
      className={`relative overflow-hidden bg-stage ${className}`}
      style={{
        height: fill ? '100%' : height,
        backgroundImage: 'radial-gradient(circle, var(--sm-grid) 1px, transparent 1.25px)',
        backgroundSize: `${GRID * k}px ${GRID * k}px`,
        backgroundPosition: 'center',
      }}
    >
      <div className="absolute top-1/2 left-1/2" style={{ transform: `translate(-50%, -50%) scale(${k})` }} dangerouslySetInnerHTML={{ __html: still.html }} />
    </div>
  );
}
