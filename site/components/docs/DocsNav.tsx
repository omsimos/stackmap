'use client';

import Link from 'next/link';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, LayoutGrid, Menu, Search } from 'lucide-react';
import { LINKS } from '@/components/site/links';
import { GitHubIcon } from '@/components/ui/icons';
import { DOC_GROUPS, DOC_PAGES, type DocPage } from '@/lib/docs-nav';
import { SearchPalette } from './Search';

interface Docs {
  page: DocPage;
  section: string | undefined;
  openSearch: () => void;
}

const DocsContext = createContext<Docs | null>(null);
const useDocs = () => {
  const d = useContext(DocsContext);
  if (!d) throw new Error('docs navigation outside DocsProvider');
  return d;
};

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** The current section: the last heading above the top third of the window, or in view at the foot of the page. */
function useSection(page: DocPage) {
  const [on, setOn] = useState(page.sections[0]?.id);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let at = page.sections[0]?.id;
      // At the foot of the page the last sections can never reach the top third, so any heading in view counts.
      const end = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
      for (const { id } of page.sections) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top < innerHeight * (end ? 1 : 0.32)) at = id;
      }
      setOn(at);
    };
    const onScroll = () => (frame ||= requestAnimationFrame(update));
    update();
    addEventListener('scroll', onScroll, { passive: true });
    return () => {
      removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [page]);
  return on;
}

/**
 * The docs' shared state: the page, the section in view and the search. ⌘K or Ctrl+K opens the search from
 * anywhere, and / does outside a text field and outside an embedded viewer (which takes / for its own search).
 */
export function DocsProvider({ href, children }: { href: string; children: ReactNode }) {
  const page = DOC_PAGES.find((p) => p.href === href)!;
  const section = useSection(page);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching((s) => !s);
      } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target) && !(e.target as Element | null)?.closest?.('.ev')) {
        e.preventDefault();
        setSearching(true);
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return (
    <DocsContext.Provider value={{ page, section, openSearch: () => setSearching(true) }}>
      {children}
      <SearchPalette open={searching} onClose={() => setSearching(false)} />
    </DocsContext.Provider>
  );
}

/** The current page's sections, with a bar that slides to the one in view. */
function Sections({ onPick }: { onPick?: () => void }) {
  const { page, section } = useDocs();
  const box = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const a = box.current?.querySelector<HTMLElement>('[aria-current="true"]');
      const b = bar.current;
      if (!b) return;
      if (!a) return void (b.style.opacity = '0');
      b.style.opacity = '1';
      b.style.height = `${a.offsetHeight}px`;
      b.style.translate = `0 ${a.offsetTop}px`;
    };
    place();
    void document.fonts?.ready.then(place);
    // The phone sheet's copy mounts hidden and measures zero until it opens: the observer sees it take its size.
    const ro = new ResizeObserver(place);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, [section]);
  if (!page.sections.length) return null;
  return (
    <div ref={box} className="d-sub">
      <i ref={bar} className="d-sub-ind" aria-hidden="true" style={{ opacity: 0 }} />
      {page.sections.map((s) => (
        <a key={s.id} className="d-sl" href={`#${s.id}`} aria-current={s.id === section ? 'true' : undefined} onClick={onPick}>
          {s.label}
        </a>
      ))}
    </div>
  );
}

function Groups({ onPick }: { onPick?: () => void }) {
  const { page } = useDocs();
  return DOC_GROUPS.map((g) => (
    <div key={g} className="d-grp">
      <p className="d-grp-t">{g}</p>
      <ul>
        {DOC_PAGES.filter((p) => p.group === g).map((p) => (
          <li key={p.href}>
            <Link className="d-item" href={p.href} aria-current={p.href === page.href ? 'page' : undefined} onClick={onPick}>
              {p.title}
            </Link>
            {p.href === page.href && <Sections onPick={onPick} />}
          </li>
        ))}
        {g === 'Reference' && (
          <li>
            <a className="d-item" href={LINKS.authoring.href} target="_blank" rel="noreferrer">
              <span>{LINKS.authoring.label}</span>
              <ArrowUpRight size={14} strokeWidth={1.75} className="ic" aria-hidden="true" />
            </a>
          </li>
        )}
      </ul>
    </div>
  ));
}

export function SideNav({ version }: { version: string }) {
  const { openSearch } = useDocs();
  return (
    <nav className="d-nav" aria-label="Documentation">
      <button className="d-search" type="button" onClick={openSearch} aria-haspopup="dialog">
        <Search size={16} strokeWidth={1.75} aria-hidden="true" />
        <span>Search docs</span>
        <span className="kbd" aria-hidden="true">
          ⌘K
        </span>
      </button>
      <Groups />
      <div className="d-foot">
        <Link className="d-item" href={LINKS.examples.href}>
          <LayoutGrid size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>Examples</span>
        </Link>
        <a className="d-item" href={LINKS.github.href} target="_blank" rel="noreferrer">
          <GitHubIcon size={16} />
          <span>GitHub</span>
          <ArrowUpRight size={14} strokeWidth={1.75} className="ic" aria-hidden="true" />
        </a>
        <p className="d-ver mono">v{version}</p>
      </div>
    </nav>
  );
}

/** On a phone: where you are, opening the same navigation as a sheet, and the search. */
export function DocsBar() {
  const { page, openSearch } = useDocs();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDown = (e: PointerEvent) => wrap.current?.contains(e.target as Node) || setOpen(false);
    addEventListener('keydown', onKey);
    addEventListener('pointerdown', onDown);
    return () => {
      removeEventListener('keydown', onKey);
      removeEventListener('pointerdown', onDown);
    };
  }, [open]);
  return (
    <div ref={wrap} className="d-mob">
      <div className="d-bar pnl">
        <button className="d-bar-m" type="button" aria-expanded={open} aria-controls="docs-sheet" onClick={() => setOpen((o) => !o)}>
          <Menu size={16} strokeWidth={1.75} aria-hidden="true" />
          <span className="d-bar-t">
            <span className="muted">{page.group}</span>
            <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" />
            <span>{page.title}</span>
          </span>
          <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button className="ib" type="button" aria-label="Search the docs" onClick={openSearch}>
          <Search size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <nav id="docs-sheet" className="d-sheet pnl" aria-label="Documentation" hidden={!open}>
        <Groups onPick={() => setOpen(false)} />
      </nav>
    </div>
  );
}
