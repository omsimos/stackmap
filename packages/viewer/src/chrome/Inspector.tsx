import { ArrowDownLeft, ArrowUpRight, Copy, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { countByType, TYPE_LABELS, type DiagramDraft, type DiagramEdge, type DiagramNode, type Evidence } from '@stackmap/core';
import { focusCard } from '../canvas/SceneLayers';
import { routeBetween } from '../explore/graph';
import { useExplore } from '../explore/ExploreContext';
import { useInFlight } from '../motion/inFlight';
import { swapIn } from '../motion/motion';
import { IconButton, PANEL_STYLE } from './ui';

const eyebrow = 'text-[12.5px] font-medium text-fg-muted';

// The panel's title level; its sections sit one below and their notes two below. A page that embeds the viewer
// under its own headings moves the whole set down.
const Level = createContext<2 | 3>(2);
type Tag = 'h2' | 'h3' | 'h4' | 'h5';
function useHeading(below: 0 | 1 | 2): Tag {
  return `h${useContext(Level) + below}` as Tag;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const H = useHeading(1);
  return (
    <section className="mt-7">
      <H className="text-[13px] font-semibold text-fg">{title}</H>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// Connection styles in legend order; each is listed only when the diagram uses it.
const LINE_STYLES: { key: string; label: string; test: (e: DiagramEdge) => boolean; stroke: string; width: number; dash?: string }[] = [
  { key: 'main', label: 'Main path', test: (e) => e.tone === 'main', stroke: 'var(--sm-text)', width: 1.75 },
  { key: 'security', label: 'Security', test: (e) => e.tone === 'security', stroke: 'var(--sm-security-accent)', width: 1.5 },
  { key: 'error', label: 'Failure path', test: (e) => e.tone === 'error', stroke: 'var(--sm-failure-accent)', width: 1.5 },
  { key: 'async', label: 'Async', test: (e) => e.kind === 'async', stroke: 'var(--sm-edge)', width: 1.25, dash: '5 4' },
  { key: 'return', label: 'Reply or return', test: (e) => e.kind === 'return', stroke: 'var(--sm-edge)', width: 1.25, dash: '1 4' },
];

function Legend({ draft }: { draft: DiagramDraft }) {
  const { dispatch } = useExplore();
  const lines = LINE_STYLES.filter((l) => draft.edges.some(l.test));
  // A row that unmounts under the pointer never gets its mouseleave.
  useEffect(() => () => dispatch({ type: 'peek', nodeType: null }), [dispatch]);
  return (
    <>
      <ul aria-label="Legend" className="space-y-0.5">
        {countByType(draft.nodes).map(([type, count]) => (
          <li
            key={type}
            onMouseEnter={() => dispatch({ type: 'peek', nodeType: type })}
            onMouseLeave={() => dispatch({ type: 'peek', nodeType: null })}
            className="-mx-2 flex items-center justify-between rounded-lg px-2 py-1 text-[13px] text-fg transition-colors duration-150 hover:bg-page"
          >
            <span className="flex items-center gap-2.5">
              <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: `var(--sm-${type}-accent)` }} />
              {TYPE_LABELS[type]}
            </span>
            <span className="text-fg-muted tabular-nums">{count}</span>
          </li>
        ))}
      </ul>
      {lines.length > 0 && (
        <ul aria-label="Connection styles" className="mt-4 space-y-2.5">
          {lines.map((l) => (
            <li key={l.key} className="flex items-center gap-2.5 text-[13px] text-fg">
              <svg aria-hidden="true" width="18" height="10" className="shrink-0">
                <line x1="1" y1="5" x2="17" y2="5" style={{ stroke: l.stroke, strokeWidth: l.width, strokeDasharray: l.dash, strokeLinecap: l.key === 'return' ? 'round' : undefined }} />
              </svg>
              {l.label}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Notes({ draft }: { draft: DiagramDraft }) {
  const H = useHeading(2);
  return (
    <div className="space-y-5">
      {draft.notes!.map((n, i) => (
        <section key={i} aria-label={n.title}>
          <H className="text-[13px] font-medium text-fg">{n.title}</H>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[12.5px] leading-5 text-fg-muted marker:text-divider">
            {n.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// Each path segment is encoded, so `#`, `?`, `%` or spaces in a file name can't reshape the URL.
const evidenceHref = (base: string, e: Evidence) =>
  `${base.replace(/\/+$/, '')}/${e.file.split('/').filter(Boolean).map(encodeURIComponent).join('/')}${e.line ? `#L${e.line}` : ''}`;

function EvidenceItem({ item, base }: { item: Evidence; base?: string }) {
  const [copied, setCopied] = useState(false);
  const where = `${item.file}${item.line ? `:${item.line}` : ''}`;
  const copy = () => {
    void navigator.clipboard?.writeText(where).then(() => setCopied(true));
  };
  return (
    <li className="text-[13px]">
      <div className="flex items-center justify-between gap-2">
        {base ? (
          <a href={evidenceHref(base, item)} target="_blank" rel="noreferrer" className="truncate font-mono text-[12px] text-fg underline-offset-2 hover:underline" title={where}>
            {where}
          </a>
        ) : (
          <code className="truncate font-mono text-[12px] text-fg" title={where}>
            {where}
          </code>
        )}
        <button type="button" onClick={copy} aria-label={`Copy ${where}`} title={copied ? 'Copied' : 'Copy path'} className="shrink-0 rounded-md p-1 text-fg-muted hover:bg-page hover:text-fg">
          <Copy size={13} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {item.note && <p className="mt-0.5 text-[12px] text-fg-muted">{item.note}</p>}
    </li>
  );
}

function Connections({ node }: { node: DiagramNode }) {
  const { draft, graph, dispatch } = useExplore();
  const byId = new Map(draft.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(draft.edges.map((e) => [e.id, e]));
  const list = (ids: string[], dir: 'in' | 'out') =>
    ids.map((eid) => {
      const e = edgeById.get(eid)!;
      const other = byId.get(dir === 'in' ? e.from : e.to)!;
      const Icon = dir === 'in' ? ArrowDownLeft : ArrowUpRight;
      return (
        <li key={eid}>
          <button
            type="button"
            onClick={() => dispatch({ type: 'select', id: other.id, reveal: true })}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-fg hover:bg-page"
          >
            <Icon size={14} strokeWidth={1.75} aria-hidden="true" style={{ color: `var(--sm-${other.type}-accent)` }} />
            <span className="sr-only">{dir === 'in' ? 'from' : 'to'} </span>
            <span className="truncate">{other.card.title}</span>
            {e.label && <span className="ml-auto shrink-0 text-[12px] text-fg-muted">{e.label}</span>}
            {e.kind && e.kind !== 'sync' && !e.label && <span className="ml-auto shrink-0 text-[12px] text-fg-muted">{e.kind === 'async' ? 'async' : 'reply'}</span>}
          </button>
        </li>
      );
    });
  const incoming = graph.in.get(node.id) ?? [];
  const outgoing = graph.out.get(node.id) ?? [];
  if (!incoming.length && !outgoing.length) return <p className="text-[13px] text-fg-muted">No connections.</p>;
  return (
    <ul aria-label="Connections" className="-mx-2 space-y-0.5">
      {list(incoming, 'in')}
      {list(outgoing, 'out')}
    </ul>
  );
}

function NodeDetail({ node, toggle }: { node: DiagramNode; toggle: ReactNode }) {
  const { draft, dispatch } = useExplore();
  const { card } = node;
  const lane = node.lane ? draft.lanes?.find((l) => l.id === node.lane)?.label : undefined;
  const H = useHeading(0);
  return (
    <>
      <div className="flex items-center justify-between">
        <div className={`${eyebrow} flex items-center gap-2`}>
          <span aria-hidden="true" className="size-2 rounded-full" style={{ background: `var(--sm-${node.type}-accent)` }} />
          {TYPE_LABELS[node.type]}
        </div>
        <div className="flex">
          <IconButton
            label="Clear selection (Esc)"
            onClick={() => {
              dispatch({ type: 'clear' });
              focusCard(node.id); // back where the keyboard user came from
            }}
          >
            <X size={16} strokeWidth={1.75} />
          </IconButton>
          {toggle}
        </div>
      </div>
      <H className="mt-1 text-[18px] font-semibold tracking-tight break-words text-fg">{card.title}</H>
      {card.subtitle && <p className="mt-1 text-[13px] break-words text-fg-muted">{card.subtitle}</p>}
      {(card.tag || lane) && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-fg-muted">
          {card.tag && (
            <span className="rounded-full px-2 py-0.5 text-[12px] font-medium text-fg" style={{ background: `var(--sm-${node.type}-tile)` }}>
              {card.tag}
            </span>
          )}
          {lane && <span>{lane}</span>}
        </p>
      )}
      {(card.rows?.length || card.stats?.length || card.footer) && (
        <Section title="Details">
          <dl className="space-y-2 text-[13px]">
            {card.rows?.map((r, i) => (
              <div key={`r${i}`} className="flex justify-between gap-4">
                <dt className="text-fg-muted">{r.label}</dt>
                <dd className={`text-right break-all text-fg ${r.mono ? 'font-mono text-[12px]' : ''}`}>{r.value}</dd>
              </div>
            ))}
            {card.stats?.map((s, i) => (
              <div key={`s${i}`} className="flex justify-between gap-4">
                <dt className="text-fg-muted">{s.label}</dt>
                <dd className="text-fg tabular-nums">{s.value}</dd>
              </div>
            ))}
            {card.stats?.length && card.statsNote ? <p className="text-fg-muted">{card.statsNote}</p> : null}
            {[card.footer?.left, card.footer?.right].map((f, i) => (f ? <p key={`f${i}`} className="text-fg-muted">{f.text}</p> : null))}
          </dl>
          {card.cta?.href && (
            <a href={card.cta.href} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-fg hover:underline">
              {card.cta.label}
              <ArrowUpRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </a>
          )}
        </Section>
      )}
      <Section title="Connections">
        <Connections node={node} />
      </Section>
      {!!node.evidence?.length && (
        <Section title="Evidence">
          <ul className="space-y-2.5">
            {node.evidence.map((e, i) => (
              <EvidenceItem key={i} item={e} base={draft.source?.url} />
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

/** The route between two picked nodes: its steps along one shortest path, or why there is none. */
function RouteDetail({ toggle }: { toggle: ReactNode }) {
  const { draft, state, graph, dispatch } = useExplore();
  // While the flow plays, the step a pulse is heading for lights up as it travels.
  const inFlight = useInFlight();
  const byId = new Map(draft.nodes.map((n) => [n.id, n]));
  const edgeById = new Map(draft.edges.map((e) => [e.id, e]));
  const title = (id: string) => byId.get(id)?.card.title ?? id;
  const H = useHeading(0);
  const header = (
    <div className="flex items-center justify-between">
      <div className={eyebrow}>Route</div>
      <div className="flex">
        <IconButton label="End the route (Esc)" onClick={() => dispatch({ type: 'toggleRoute' })}>
          <X size={16} strokeWidth={1.75} />
        </IconButton>
        {toggle}
      </div>
    </div>
  );
  if (!state.route) {
    return (
      <>
        {header}
        <p className="mt-2 text-[13px] text-fg-muted">
          {state.routing?.next === 'to' ? `From ${title(state.routing.start)}: pick where the route ends.` : 'Pick the node the route starts from.'}
        </p>
      </>
    );
  }
  const route = routeBetween(graph, state.route.from, state.route.to);
  return (
    <>
      {header}
      <H className="mt-1 text-[18px] font-semibold tracking-tight break-words text-fg">
        {title(state.route.from)} → {title(state.route.to)}
      </H>
      {!route ? (
        <p className="mt-2 text-[13px] text-fg-muted">No directed connections lead from one to the other.</p>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-fg-muted">
            {route.steps.length} {route.steps.length === 1 ? 'hop' : 'hops'}
            {route.reversed ? ', running the other way' : ''} · {route.nodes.size} nodes on some path
          </p>
          <Section title="Shortest path">
            <ol aria-label="Route steps" className="-mx-2 space-y-0.5">
              {[route.from, ...route.steps.map((e) => edgeById.get(e)!.to)].map((id, i) => {
                const via = i ? edgeById.get(route.steps[i - 1]!) : undefined;
                const node = byId.get(id)!;
                const flowing = !!via && inFlight.has(via.id);
                return (
                  <li key={`${id}:${i}`} data-flowing={flowing || undefined}>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'select', id, reveal: true })}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-fg transition-colors duration-150 hover:bg-page ${flowing ? 'bg-page' : ''}`}
                    >
                      <span
                        aria-hidden="true"
                        className="size-2 shrink-0 rounded-full transition-shadow duration-150"
                        style={{
                          background: `var(--sm-${node.type}-accent)`,
                          boxShadow: flowing ? `0 0 0 3px color-mix(in srgb, var(--sm-${node.type}-accent) 28%, transparent)` : undefined,
                        }}
                      />
                      <span className="truncate">{node.card.title}</span>
                      {via?.label && <span className="ml-auto shrink-0 text-[12px] text-fg-muted">{via.label}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </Section>
        </>
      )}
    </>
  );
}

// Narrow, a 300px column would leave the canvas a sliver: the inspector floats over the stage instead,
// its toggle where the stage's bottom-right panel would sit and its body as a sheet along the bottom.
const NARROW_COLLAPSED = '@max-2xl:absolute @max-2xl:right-[27px] @max-2xl:bottom-[27px] @max-2xl:z-20';
const NARROW_OPEN = '@max-2xl:absolute @max-2xl:inset-x-5 @max-2xl:bottom-5 @max-2xl:z-20 @max-2xl:max-h-[min(60%,480px)] @max-2xl:w-auto';

function Toggle({ collapsed, onToggle, ref }: { collapsed: boolean; onToggle: () => void; ref: Ref<HTMLButtonElement> }) {
  return (
    <IconButton ref={ref} label={collapsed ? 'Show inspector' : 'Hide inspector'} expanded={!collapsed} onClick={onToggle}>
      {collapsed ? <PanelRightOpen size={17} strokeWidth={1.75} /> : <PanelRightClose size={17} strokeWidth={1.75} />}
    </IconButton>
  );
}

/**
 * `onToggle` adds the collapse toggle; without it the panel is always open. `placement="static"` leaves the panel
 * where its parent puts it at every width, instead of floating it over a narrow stage. `extra` follows the diagram's
 * title while nothing is selected.
 */
export function Inspector({
  collapsed = false,
  onToggle,
  placement = 'auto',
  headingLevel = 2,
  extra,
}: {
  collapsed?: boolean;
  onToggle?: () => void;
  placement?: 'auto' | 'static';
  headingLevel?: 2 | 3;
  extra?: ReactNode;
}) {
  const { draft, state } = useExplore();
  const selected = state.selected ? draft.nodes.find((n) => n.id === state.selected) : undefined;
  // The toggle re-renders as its counterpart; keep keyboard focus on it across the switch.
  const toggleRef = useRef<HTMLButtonElement>(null);
  const toggled = useRef(false);
  useEffect(() => {
    if (toggled.current) toggleRef.current?.focus();
    toggled.current = false;
  }, [collapsed]);
  // A new selection replaces the panel's content in place: fade it in so the swap reads as one change.
  const body = useRef<HTMLDivElement>(null);
  const shown = useRef(state.selected);
  useLayoutEffect(() => {
    if (shown.current === state.selected) return;
    shown.current = state.selected;
    const motion = swapIn([...(body.current?.children ?? [])] as HTMLElement[]);
    return () => motion.cancel();
  }, [state.selected]);
  const toggle = onToggle && (
    <Toggle
      ref={toggleRef}
      collapsed={collapsed}
      onToggle={() => {
        toggled.current = true;
        onToggle();
      }}
    />
  );
  const Title = `h${headingLevel}` as const;
  const narrow = placement === 'auto';
  if (collapsed && toggle) {
    // Collapsed, a selection or route would change nothing visible beyond the canvas (a phone starts collapsed):
    // the toggle names what it would show, so a tapped card visibly has details waiting.
    const name = (id: string) => draft.nodes.find((n) => n.id === id)?.card.title ?? id;
    const showing = state.route ? `${name(state.route.from)} → ${name(state.route.to)}` : selected?.card.title;
    return (
      <aside aria-label="Inspector" className={`shrink-0 self-start rounded-2xl bg-panel p-1.5 ${narrow ? NARROW_COLLAPSED : ''}`} style={PANEL_STYLE}>
        {showing ? (
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={false}
            aria-label={`Show inspector: ${showing}`}
            title="Show inspector"
            onClick={() => {
              toggled.current = true;
              onToggle();
            }}
            className="sm-press flex h-9 max-w-[220px] items-center gap-2 rounded-xl px-2.5 text-[13px] text-fg hover:bg-page"
          >
            <span className="truncate">{showing}</span>
            <PanelRightOpen size={17} strokeWidth={1.75} className="shrink-0 text-fg-muted" />
          </button>
        ) : (
          toggle
        )}
      </aside>
    );
  }
  return (
    <Level.Provider value={headingLevel}>
    <aside aria-label="Inspector" className={`relative shrink-0 overflow-y-auto rounded-[20px] bg-panel p-5 ${narrow ? `w-[300px] ${NARROW_OPEN}` : ''}`} style={PANEL_STYLE}>
      <div ref={body}>
      {state.route || state.routing ? (
        <RouteDetail toggle={toggle} />
      ) : selected ? (
        <NodeDetail node={selected} toggle={toggle} />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className={eyebrow}>Diagram</div>
            {toggle}
          </div>
          <Title className="mt-1 text-[18px] font-semibold tracking-tight text-fg">{draft.title}</Title>
          {draft.subtitle && <p className="mt-1 text-[13px] text-fg-muted">{draft.subtitle}</p>}
          {extra}
          {!!draft.notes?.length && (
            <Section title="Notes">
              <Notes draft={draft} />
            </Section>
          )}
          <Section title="Legend">
            <Legend draft={draft} />
          </Section>
          <p className="mt-8 text-[12px] leading-5 text-fg-muted">
            Select a card to see its details and connections. Press <kbd className="font-mono">/</kbd> to search.
          </p>
        </>
      )}
      </div>
    </aside>
    </Level.Provider>
  );
}
