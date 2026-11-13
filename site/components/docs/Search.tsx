'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Braces, CircleAlert, FileText, Hash, Keyboard, LayoutGrid, Search as SearchIcon, SquareTerminal } from 'lucide-react';
import { groupOf, search, type EntryKind, type SearchEntry } from '@/lib/search';

const ICONS: Record<EntryKind, typeof FileText> = {
  page: FileText,
  section: Hash,
  field: Braces,
  command: SquareTerminal,
  key: Keyboard,
  example: LayoutGrid,
  code: CircleAlert,
};

let cached: Promise<SearchEntry[]> | undefined;
// Fetched once, on the first open: every docs page shares the one file. A failed fetch is not kept, so the next open tries again.
const loadIndex = () =>
  (cached ??= fetch('/search.json')
    .then((r): Promise<SearchEntry[]> => (r.ok ? r.json() : Promise.reject(new Error(`search index: ${r.status}`))))
    .catch((e: unknown) => {
      cached = undefined;
      throw e;
    }));

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The docs search: a dialog with a combobox over grouped results; ↑ ↓ move, ↵ opens, Esc closes. */
export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [index, setIndex] = useState<SearchEntry[]>([]);
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const [closing, setClosing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const back = useRef<Element | null>(null);
  const ids = useId();

  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement;
    setQ('');
    setAt(0);
    setClosing(false);
    loadIndex().then(setIndex, () => setIndex([]));
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  const results = open ? search(index, q) : [];
  const active = Math.min(at, Math.max(0, results.length - 1));

  useEffect(() => {
    list.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const close = (refocus = true) => {
    const done = () => {
      setClosing(false);
      onClose();
      if (refocus && back.current instanceof HTMLElement) back.current.focus({ preventScroll: true });
    };
    if (reduced()) return done();
    setClosing(true);
    setTimeout(done, 120);
  };

  const go = (e: SearchEntry) => {
    const here = location.pathname;
    const [path, hash] = e.href.split('#');
    close(false);
    if (path === here && hash) {
      document.getElementById(hash)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      history.replaceState(null, '', `#${hash}`);
    } else router.push(e.href);
  };

  const rows: ({ head: string } | { entry: SearchEntry; n: number })[] = [];
  let last: string | undefined;
  results.forEach((entry, n) => {
    const head = q.trim() ? groupOf(entry) : 'Suggested';
    if (head !== last) rows.push({ head });
    last = head;
    rows.push({ entry, n });
  });
  const optionId = (n: number) => `${ids}-r${n}`;

  return (
    <div className="pal" data-closing={closing || undefined}>
      <button className="pal-bd" type="button" tabIndex={-1} aria-label="Close search" onClick={() => close()} />
      <div className="pal-p pnl" role="dialog" aria-modal="true" aria-label="Search the docs">
        <div className="pal-q">
          <SearchIcon size={18} strokeWidth={1.75} aria-hidden="true" />
          <label className="sr-only" htmlFor={`${ids}-q`}>
            Search the docs
          </label>
          <input
            ref={input}
            id={`${ids}-q`}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Search pages, fields, commands, keys…"
            value={q}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${ids}-l`}
            aria-activedescendant={results.length ? optionId(active) : undefined}
            onChange={(e) => {
              setQ(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setAt(Math.min(active + 1, results.length - 1));
              else if (e.key === 'ArrowUp') setAt(Math.max(active - 1, 0));
              else if (e.key === 'Enter' && results[active]) go(results[active]);
              else if (e.key === 'Escape') close();
              else if (e.key === 'Tab') e.preventDefault();
              else return;
              e.preventDefault();
            }}
          />
          <button className="kbd pal-esc" type="button" onClick={() => close()} aria-label="Close search">
            Esc
          </button>
        </div>
        <div ref={list} className="pal-l" id={`${ids}-l`} role="listbox" aria-label="Results">
          {rows.map((r) => {
            if ('head' in r) {
              return (
                <p key={`h-${r.head}`} className="pal-h" role="presentation">
                  {r.head}
                </p>
              );
            }
            const Icon = ICONS[r.entry.kind];
            return (
              <a
                key={`${r.entry.href}-${r.entry.title}-${r.n}`}
                id={optionId(r.n)}
                data-row={r.n}
                className="pal-a"
                role="option"
                aria-selected={r.n === active}
                href={r.entry.href}
                tabIndex={-1}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  go(r.entry);
                }}
                onMouseMove={() => r.n !== active && setAt(r.n)}
              >
                <span className="pal-ic" aria-hidden="true">
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <span className="pal-tx">
                  <span className="pal-t">{r.entry.title}</span>
                  <span className="pal-s">{r.entry.context}</span>
                </span>
                <span className="pal-go" aria-hidden="true">
                  <ArrowRight size={16} strokeWidth={1.75} />
                </span>
              </a>
            );
          })}
          {q.trim() && index.length > 0 && !results.length && (
            <p className="pal-none">
              No results for “{q}”. Try a field name like <span className="c">brand</span>, a command like <span className="c">serve</span>, or a key like{' '}
              <span className="c">route</span>.
            </p>
          )}
        </div>
        <div className="pal-f">
          <span>
            <span className="kbd">↑</span>
            <span className="kbd">↓</span> to move
          </span>
          <span>
            <span className="kbd">↵</span> to open
          </span>
          <span>
            <span className="kbd">Esc</span> to close
          </span>
          <span className="pal-n tnum" aria-live="polite">
            {q.trim() ? `${results.length} ${results.length === 1 ? 'result' : 'results'}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
