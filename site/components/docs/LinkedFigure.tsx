'use client';

import { useRef, type PointerEvent, type ReactNode } from 'react';
import { Globe, MousePointer2 } from 'lucide-react';
import type { StaticDiagram } from '@/lib/data/static-html';
import { FitDiagram } from '@/components/diagram/FitDiagram';

const ATTR = { node: 'data-card-id', edge: 'data-edge-id', group: 'data-frame-id' } as const;

/**
 * A diagram beside the JSON that drew it: pointing at a node's lines lights its card, and pointing at a card
 * lights its lines. The drawing is inert (it is a picture), so cards are found by where the pointer is.
 */
export function LinkedFigure({ still, url, code, split = true }: { still: StaticDiagram; url: string; code: ReactNode; split?: boolean }) {
  const root = useRef<HTMLElement>(null);
  const lit = useRef<string | null>(null);

  const light = (owner: string | null) => {
    const el = root.current;
    if (!el || owner === lit.current) return;
    lit.current = owner;
    for (const x of el.querySelectorAll('[data-lk]')) x.removeAttribute('data-lk');
    for (const x of el.querySelectorAll('.cl.hl')) x.classList.remove('hl');
    if (!owner) return void el.removeAttribute('data-linking');
    el.setAttribute('data-linking', '');
    const [kind, id] = owner.split(':') as [keyof typeof ATTR, string];
    for (const x of el.querySelectorAll(`[${ATTR[kind]}="${CSS.escape(id)}"]`)) x.setAttribute('data-lk', '');
    for (const x of el.querySelectorAll(`.cl[data-o="${CSS.escape(owner)}"]`)) x.classList.add('hl');
  };

  const onStage = (e: PointerEvent) => {
    const el = root.current;
    if (!el) return;
    // Cards first, then the frames they sit in: of nested frames the innermost, which is the smallest under the pointer.
    for (const [kind, attr] of [['node', ATTR.node], ['group', ATTR.group]] as const) {
      let hit: string | null = null;
      let area = Infinity;
      for (const x of el.querySelectorAll<HTMLElement>(`.lf-stage [${attr}]`)) {
        const r = x.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom || r.width * r.height >= area) continue;
        hit = x.getAttribute(attr);
        area = r.width * r.height;
      }
      if (hit !== null) return light(`${kind}:${hit}`);
    }
    light(null);
  };

  const onCode = (e: PointerEvent) => light((e.target as Element).closest?.('.cl')?.getAttribute('data-o') ?? null);

  return (
    <figure ref={root} className={`lf ${split ? 'split' : ''}`} onPointerLeave={() => light(null)}>
      <div className="lf-view">
        <div className="lf-bar">
          <Globe size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="mono">{url}</span>
        </div>
        <div className="lf-stage" onPointerMove={onStage}>
          <FitDiagram still={still} width={560} height={420} pad={32} fill />
        </div>
      </div>
      <div className="lf-code" onPointerMove={onCode}>
        {code}
      </div>
      <figcaption className="lf-cap">
        <MousePointer2 size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>Point at a node in the JSON, or at its card, to find the other.</span>
      </figcaption>
    </figure>
  );
}
