'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Bot } from 'lucide-react';
import { DIAGRAM_KINDS, KIND_LABELS, type DiagramKind } from '@stackmap/core';

export interface GridItem {
  id: string;
  kind: DiagramKind;
  agent: boolean;
  card: ReactNode;
}

type Kind = DiagramKind | 'all';

// On a static page useSearchParams needs a Suspense boundary, and whatever is inside one renders in the browser
// only: this reads the address on its own so the cards stay server markup.
function KindParam({ onKind }: { onKind: (k: Kind) => void }) {
  const k = useSearchParams().get('kind');
  useEffect(() => onKind(k && (DIAGRAM_KINDS as readonly string[]).includes(k) ? (k as DiagramKind) : 'all'), [k, onKind]);
  return null;
}

/**
 * The gallery's kind filter, agent toggle and cards. The cards are server markup; this only hides the ones that
 * don't match. `?kind=` picks the kind, so the docs can link straight to theirs.
 */
export function ExampleGrid({ items, ledes }: { items: GridItem[]; ledes: Record<DiagramKind, string> }) {
  const [kind, setKind] = useState<Kind>('all');
  const [agent, setAgent] = useState(false);
  const bar = useRef<HTMLDivElement>(null);
  const ind = useRef<HTMLElement>(null);

  const pick = (k: Kind) => {
    setKind(k);
    const url = new URL(location.href);
    if (k === 'all') url.searchParams.delete('kind');
    else url.searchParams.set('kind', k);
    history.replaceState(null, '', url);
  };

  // The pill slides to the chosen kind; it is placed by measuring, so fonts and resizes re-place it.
  useLayoutEffect(() => {
    const place = () => {
      const b = bar.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
      const i = ind.current;
      if (!b || !i) return;
      i.style.width = `${b.offsetWidth}px`;
      i.style.translate = `${b.offsetLeft}px 0`;
    };
    place();
    void document.fonts?.ready.then(place);
    addEventListener('resize', place);
    return () => removeEventListener('resize', place);
  }, [kind]);

  const matches = (i: GridItem, k: Kind = kind) => (k === 'all' || i.kind === k) && (!agent || i.agent);
  const count = (k: Kind) => items.filter((i) => matches(i, k)).length;
  const shown = count(kind);
  const label = kind === 'all' ? '' : KIND_LABELS[kind].toLowerCase();
  const sum = kind !== 'all' ? ledes[kind] : `${shown} diagrams${agent ? ' that coding agents wrote.' : ' across five kinds.'}`;

  return (
    <>
      <Suspense fallback={null}>
        <KindParam onKind={setKind} />
      </Suspense>
      <div className="g-bar">
        <div ref={bar} className="g-kinds pnl" role="group" aria-label="Filter by kind">
          <i ref={ind} className="g-ind" aria-hidden="true" />
          {(['all', ...DIAGRAM_KINDS] as Kind[]).map((k) => (
            <button key={k} type="button" className="g-k" aria-pressed={k === kind} data-n={count(k)} onClick={() => pick(k)}>
              {k === 'all' ? 'All' : KIND_LABELS[k]}
              <span className="tnum">{count(k)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="g-ag" aria-pressed={agent} onClick={() => setAgent((a) => !a)}>
          <Bot size={16} strokeWidth={1.75} className="ic" aria-hidden="true" />
          <span>Written by an agent</span>
          <span className="tnum">{items.filter((i) => i.agent).length}</span>
        </button>
      </div>
      <p className="g-sum" aria-live="polite">
        <span>{sum}</span>
        {kind !== 'all' && (
          <Link className="g-doc" href={`/docs/${kind}`}>
            <span>Read about {label} diagrams</span>
            <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        )}
      </p>
      {shown === 0 ? (
        <div className="g-empty">
          <p>{kind === 'all' ? 'No examples match.' : `No ${label} example was written by an agent yet.`}</p>
          <button type="button" className="pill-l" onClick={() => setAgent(false)}>
            {kind === 'all' ? 'Show every example' : `Show every ${label} example`}
          </button>
        </div>
      ) : (
        <ul className="g-grid">
          {items.map((i) => (
            <li key={i.id} className="ex-li" data-show={matches(i)}>
              {i.card}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
