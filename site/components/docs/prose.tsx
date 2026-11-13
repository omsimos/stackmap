import type { ReactNode } from 'react';
import { CopyButton } from '@/components/ui/CopyButton';
import '@/components/ui/code.css';

// The docs boards' prose parts. Their styles live in docs.css under the boards' class names.

export function C({ children }: { children: ReactNode }) {
  return <code className="c">{children}</code>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <span className="kbd">{children}</span>;
}

/** Copy with `code` spans, as the docs' data writes it. */
export function Inline({ text }: { text: string }) {
  return text.split(/(`[^`]+`)/).map((part, i) => (part.startsWith('`') ? <C key={i}>{part.slice(1, -1)}</C> : part));
}

/** A section heading with its `#` link; its id is what the sidebar follows. `sub` is a section within one. */
export function H2({ id, children, sub = false }: { id: string; children: ReactNode; sub?: boolean }) {
  const H = sub ? 'h3' : 'h2';
  return (
    <H className={`d-h2 ${sub ? 'sub' : ''}`} id={id} data-sec="">
      <a className="d-anchor" href={`#${id}`} tabIndex={-1} aria-hidden="true">
        #
      </a>
      {children}
    </H>
  );
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 className="d-h3" id={id}>
      {children}
    </h3>
  );
}

export function P({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <p className={`d-p ${muted ? 'm' : ''}`}>{children}</p>;
}

export function Ul({ items }: { items: ReactNode[] }) {
  return (
    <ul className="d-ul">
      {items.map((item, i) => (
        <li key={i} className="d-li">
          {item}
        </li>
      ))}
    </ul>
  );
}

/** A table that scrolls sideways on its own on a phone. */
export function Table({ head, rows, className = '' }: { head: string[]; rows: ReactNode[][]; className?: string }) {
  return (
    <div className="d-tw" tabIndex={0} role="region" aria-label={head.join(', ')}>
      <table className={`d-tbl ${className}`}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A request the reader can give their agent, with a copy button. */
export function Ask({ text, className = '' }: { text: string; className?: string }) {
  return (
    <div className={`ask pnl ${className}`}>
      <p>{text}</p>
      <CopyButton text={text} label="Copy the request" />
    </div>
  );
}

/** The page's title block. */
export function DocHead({ crumb, title, lede }: { crumb: string; title: string; lede: ReactNode }) {
  return (
    <header className="d-head">
      <p className="d-crumb">
        Docs
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 18 6-6-6-6" />
        </svg>
        {crumb}
      </p>
      <h1 className="d-h1">{title}</h1>
      <p className="d-lede">{lede}</p>
    </header>
  );
}
