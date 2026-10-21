import { Fragment, memo, useId, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { TYPE_LABELS, type Rect } from '@stackmap/core';
import { NodeCard } from '../card/NodeCard';
import { StepCard } from '../card/StepCard';
import type { Emphasis, NodeEmphasis } from '../explore/emphasis';
import { useExploreDispatch } from '../explore/ExploreContext';
import { neighbourInDirection, type Direction } from '../explore/graph';
import { arrowMarkerId, ArrowMarkerDefs, edgeStroke, type EdgeColor } from './ArrowMarker';
import type { Scene, SceneCard, SceneEdge, SceneFrame, SceneGap, SceneLane, ScenePhase } from './scene';
import { useCamera } from './ViewportContext';
import type { Flow } from '../motion/flow';
import { FlowLayer } from './FlowLayer';

// A selection re-renders the wrapper of every card it dims; the card inside depends only on its node.
const NodeCardBody = memo(NodeCard);
const StepCardBody = memo(StepCard);

const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
export const focusCard = (id: string) => document.querySelector<HTMLElement>(`.sm-card[data-card-id="${CSS.escape(id)}"]`)?.focus();

const place = ({ x, y, width, height }: { x: number; y: number; width: number; height: number }): CSSProperties => ({
  left: x,
  top: y,
  width,
  height,
});

function Frame({ frame, compact, onLane }: { frame: SceneFrame; compact: boolean; onLane: boolean }) {
  // Q18: groups aren't in the refs — thin dashed container, faint fill, sentence-case label in the label band.
  // A trust boundary (`tone: security`) takes the security tint and a shield.
  const secure = frame.tone === 'security';
  return (
    <div
      data-frame-id={frame.id}
      data-tone={frame.tone}
      className={`sm-frame absolute border border-dashed ${compact ? 'rounded-[14px]' : 'rounded-[18px]'}`}
      style={{
        ...place(frame.rect),
        borderColor: secure ? 'var(--sm-security-accent)' : 'var(--sm-group-border)',
        // Lane layouts put groups on the lane band; a second fill would read as a lane of its own.
        background: onLane ? 'transparent' : 'var(--sm-group-fill)',
      }}
    >
      <div
        className={`flex items-center gap-1.5 font-medium text-fg-muted ${compact ? 'px-3 text-[12px]' : 'px-5 text-[12.5px]'}`}
        style={{ height: frame.band }}
      >
        {secure && <ShieldCheck size={13} strokeWidth={1.75} aria-hidden="true" style={{ color: 'var(--sm-security-accent)' }} />}
        {frame.label}
      </div>
    </div>
  );
}

/** A swimlane: a full-width band with its label in the left rail (layout's LANE_HEAD). Exception lanes are dashed. */
function Lane({ lane }: { lane: SceneLane }) {
  const exception = lane.tone === 'exception';
  return (
    <div
      data-lane-id={lane.id}
      data-tone={lane.tone}
      className="sm-lane absolute rounded-2xl"
      style={{
        ...place(lane.rect),
        background: 'var(--sm-group-fill)',
        boxShadow: exception ? undefined : 'inset 0 0 0 1px var(--sm-panel-border)',
        border: exception ? '1px dashed var(--sm-group-border)' : undefined,
      }}
    >
      {/* 128px: the layout keeps edges out of the rail's first 116px (LANE_HEAD - 28). */}
      <div className="flex w-[128px] items-start gap-1.5 px-4 pt-4 text-[12.5px] leading-[18px] font-medium break-words text-fg-muted">
        {exception && <TriangleAlert size={13} strokeWidth={1.75} aria-hidden="true" className="mt-[2.5px] shrink-0" />}
        <span className="min-w-0">{lane.label}</span>
      </div>
    </div>
  );
}

/** A phase header over the columns it spans (label and hairline), or a stage band around its nodes. */
function Phase({ phase, style, direction }: { phase: ScenePhase; style: Scene['phaseStyle']; direction: Scene['direction'] }) {
  if (style === 'time') {
    // A time band behind a stretch of messages: faint fill, dashed outline, the label in its top strip.
    return (
      <div
        data-phase-id={phase.id}
        className="sm-phase absolute rounded-[14px] border border-dashed"
        style={{ ...place(phase.rect), borderColor: 'var(--sm-group-border)', background: 'var(--sm-group-fill)' }}
      >
        <div className="flex h-7 items-center px-4 text-[12px] font-medium text-fg-muted">{phase.label}</div>
      </div>
    );
  }
  if (style === 'band') {
    return (
      <div
        data-phase-id={phase.id}
        className="sm-phase absolute rounded-[18px] border border-dashed"
        style={{ ...place(phase.rect), borderColor: 'var(--sm-group-border)', background: 'var(--sm-group-fill)' }}
      >
        <div className={`flex h-11 items-center px-5 text-[12.5px] font-medium text-fg-muted ${direction === 'RIGHT' ? 'justify-center' : ''}`}>
          {/* DOWN bands keep their label in the layout's 160px left gutter. */}
          <span className={`truncate ${direction === 'RIGHT' ? '' : 'max-w-[140px]'}`} title={phase.label}>
            {phase.label}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div data-phase-id={phase.id} className="sm-phase absolute flex items-start justify-center" style={place(phase.rect)}>
      <span className="mt-1.5 text-[13px] font-medium text-fg">{phase.label}</span>
      <span aria-hidden="true" className="absolute right-0 bottom-2 left-0 h-px" style={{ background: 'var(--sm-group-border)' }} />
    </div>
  );
}

// What an edge looks like at rest: tones pick the colour and weight, kinds the dash (Q26 + gallery parity).
function edgeLook(e: SceneEdge, tint: EdgeColor): { color: EdgeColor; width: number; dash?: string } {
  const color: EdgeColor = tint ?? (e.tone === 'main' ? 'ink' : e.tone === 'security' ? 'security' : e.tone === 'error' ? 'failure' : null);
  const width = tint ? 1.75 : e.tone === 'main' ? 1.75 : e.tone ? 1.5 : 1.25;
  const dash = e.kind === 'async' ? '5 4' : e.kind === 'return' ? '1 4' : undefined;
  return { color, width, dash };
}

// The break a crossing leaves in the line passing under: the over line's width plus 4px either side, along the line.
const GAP = { along: 10, across: 8 };

/** Cuts the gaps out of one edge (and its arrowhead) whatever is behind it, frame fills included. */
function GapMask({ id, edge, gaps }: { id: string; edge: SceneEdge; gaps: SceneGap[] }) {
  // The route's own box (plus the arrowhead), not the diagram's: a mask is rasterised over its whole region.
  const xs = edge.points.map((p) => p.x);
  const ys = edge.points.map((p) => p.y);
  const box = { x: Math.min(...xs) - 12, y: Math.min(...ys) - 12, width: Math.max(...xs) - Math.min(...xs) + 24, height: Math.max(...ys) - Math.min(...ys) + 24 };
  return (
    <mask id={id} maskUnits="userSpaceOnUse" {...box}>
      <rect {...box} fill="white" />
      {gaps.map((g) => {
        const [w, h] = g.vertical ? [GAP.across, GAP.along] : [GAP.along, GAP.across];
        return <rect key={`${g.x},${g.y}`} x={g.x - w / 2} y={g.y - h / 2} width={w} height={h} fill="black" />;
      })}
    </mask>
  );
}

// Memoised with stable props: an explorer change re-renders only the cards whose emphasis changed.
const Card = memo(function Card({
  card,
  compact,
  state,
  rects,
  tabbable,
  onFocused,
}: {
  card: SceneCard;
  compact: boolean;
  state: NodeEmphasis;
  rects: Record<string, Rect>;
  /** roving tabindex: one card is the canvas's tab stop, arrows move between the rest */
  tabbable: boolean;
  onFocused: (id: string) => void;
}) {
  const { node, rect, final } = card;
  const dispatch = useExploreDispatch();
  const camera = useCamera();
  const accent = { '--sm-handle': `var(--sm-${node.type}-accent)` } as CSSProperties;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const dir = ARROWS[e.key];
    if (dir) {
      const next = neighbourInDirection(rects, node.id, dir);
      if (next) focusCard(next);
    } else if (e.key === 'Enter' || e.key === ' ') {
      dispatch({ type: 'select', id: node.id });
    } else if (e.key === 'Escape') {
      dispatch({ type: 'clear' });
    } else return;
    // The stage would otherwise pan on arrows / clear on Escape as well.
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      data-card-id={node.id}
      data-emphasis={state}
      role="button"
      tabIndex={tabbable ? 0 : -1}
      aria-pressed={state === 'focus'}
      aria-label={`${node.card.title}, ${TYPE_LABELS[node.type]}`}
      className="sm-card absolute cursor-pointer"
      style={{ ...place(rect), ...accent }}
      onClick={(e) => {
        e.stopPropagation();
        if ((e.target as Element).closest('a')) return; // the card's CTA link opens, not selects
        dispatch({ type: 'select', id: node.id });
      }}
      onFocus={(e) => {
        onFocused(node.id);
        // Keyboard focus only: a mouse-down focus would start a pan that fights the user's drag.
        if (e.currentTarget.matches(':focus-visible')) camera.ensureVisible(rect);
      }}
      onKeyDown={onKeyDown}
    >
      {compact ? <StepCardBody node={node} final={final} /> : <NodeCardBody node={node} />}
    </div>
  );
});

// Paint order is the z-order: frames < edges < flow pulses < cards (+ handle dots) < edge labels.
// Memoised: `scene` and `emphasis` are stable across pan/zoom frames, so without this every d3-zoom
// transform update re-rendered every card.
export const SceneLayers = memo(function SceneLayers({
  scene,
  emphasis,
  selected,
  flow = null,
  speed = 1,
}: {
  scene: Scene;
  emphasis: Emphasis;
  selected: string | null;
  /** the flow playing, if any */
  flow?: Flow | null;
  /** its playback speed */
  speed?: number;
}) {
  const typeOf = useMemo(() => new Map(scene.cards.map((c) => [c.node.id, c.node.type])), [scene]);
  const rects = useMemo(() => Object.fromEntries(scene.cards.map((c) => [c.node.id, c.rect])), [scene]);
  const [lastFocused, setLastFocused] = useState<string | null>(null);
  // Mask ids are document-wide, and a page may embed several diagrams.
  const maskPrefix = `sm-gaps${useId().replace(/[^\w-]/g, '')}`;
  const tabStop = selected ?? (lastFocused && rects[lastFocused] ? lastFocused : scene.cards[0]?.node.id);
  return (
    <>
      {scene.lanes.map((l) => (
        <Lane key={l.id} lane={l} />
      ))}
      {scene.phases.map((p) => (
        <Phase key={p.id} phase={p} style={scene.phaseStyle} direction={scene.direction} />
      ))}
      {scene.frames.map((f) => (
        <Frame key={f.id} frame={f} compact={scene.compact} onLane={scene.lanes.length > 0} />
      ))}
      <svg
        aria-hidden="true"
        className="sm-edges pointer-events-none absolute top-0 left-0 overflow-visible"
        width={scene.bounds.width}
        height={scene.bounds.height}
      >
        <ArrowMarkerDefs />
        {scene.lifelines.map((l) => (
          <line
            key={l.node}
            data-lifeline={l.node}
            data-dim={emphasis.nodes.get(l.node) === 'dim' || undefined}
            className="sm-edge-path"
            x1={l.x}
            x2={l.x}
            y1={l.top}
            y2={l.bottom}
            style={{ stroke: 'var(--sm-group-border)', strokeWidth: 1, strokeDasharray: '4 4' }}
          />
        ))}
        {scene.activations.map((a, i) => (
          <rect
            key={`${a.node}:${i}`}
            data-activation={a.node}
            data-dim={emphasis.nodes.get(a.node) === 'dim' || undefined}
            className="sm-edge-path"
            x={a.rect.x}
            y={a.rect.y}
            width={a.rect.width}
            height={a.rect.height}
            rx={2}
            // The accent at low opacity rather than the tile token: exports carry only the SVG layer's accents.
            style={{ fill: `var(--sm-${a.type}-accent)`, fillOpacity: 0.16, stroke: `var(--sm-${a.type}-accent)`, strokeWidth: 1 }}
          />
        ))}
        {scene.edges.map((e, i) => {
          const { dim, tint } = emphasis.edges.get(e.id) ?? { dim: false, tint: null };
          const look = edgeLook(e, tint);
          // Faded lines crossing over would cut a gap into a lit one for nothing.
          const gaps = e.gaps.filter((g) => g.over.some((o) => !emphasis.edges.get(o)?.dim));
          const mask = `${maskPrefix}-${i}`;
          return (
            <Fragment key={e.id}>
              {gaps.length > 0 && <GapMask id={mask} edge={e} gaps={gaps} />}
              <path
                data-edge-id={e.id}
                data-dim={dim || undefined}
                data-tint={tint ?? undefined}
                data-tone={e.tone}
                data-kind={e.kind === 'sync' ? undefined : e.kind}
                className="sm-edge-path"
                d={e.path}
                fill="none"
                markerEnd={`url(#${arrowMarkerId(look.color, e.kind === 'return')})`}
                mask={gaps.length > 0 ? `url(#${mask})` : undefined}
                style={{
                  stroke: edgeStroke(look.color),
                  strokeWidth: look.width,
                  strokeDasharray: look.dash,
                  strokeLinecap: e.kind === 'return' ? 'round' : undefined,
                }}
              />
            </Fragment>
          );
        })}
        {/* Lifecycle: a start state's initial marker, a filled dot with a stub into the card (UML). */}
        {scene.kind === 'lifecycle' &&
          scene.cards
            .filter((c) => c.node.type === 'start')
            .map((c) => {
              const y = c.rect.y + c.rect.height / 2;
              const dim = emphasis.nodes.get(c.node.id) === 'dim' || undefined;
              return (
                <g key={c.node.id} data-start-mark={c.node.id} data-dim={dim} className="sm-edge-path">
                  <line x1={c.rect.x - 22} y1={y} x2={c.rect.x} y2={y} markerEnd={`url(#${arrowMarkerId('start')})`} style={{ stroke: 'var(--sm-start-accent)', strokeWidth: 1.5 }} />
                  <circle cx={c.rect.x - 24} cy={y} r={5} style={{ fill: 'var(--sm-start-accent)' }} />
                </g>
              );
            })}
      </svg>
      {flow && <FlowLayer flow={flow} speed={speed} width={scene.bounds.width} height={scene.bounds.height} />}
      {scene.cards.map((c) => (
        <Card
          key={c.node.id}
          card={c}
          state={emphasis.nodes.get(c.node.id) ?? 'normal'}
          compact={scene.compact}
          rects={rects}
          tabbable={c.node.id === tabStop}
          onFocused={setLastFocused}
        />
      ))}
      {scene.handles?.map((h) => (
        <span
          key={`${h.node}:${h.at.x},${h.at.y}`}
          aria-hidden="true"
          data-handle-of={h.node}
          data-handle={h.role}
          data-dim={emphasis.nodes.get(h.node) === 'dim' || undefined}
          className="sm-handle sm-route-handle"
          style={{ left: h.at.x, top: h.at.y, transform: 'translate(-50%, -50%)', '--sm-handle': `var(--sm-${typeOf.get(h.node)}-accent)` } as CSSProperties}
        />
      ))}
      {scene.edges.map((e) =>
        e.label && e.mid ? (
          <div
            key={e.id}
            data-edge-label={e.id}
            data-dim={emphasis.edges.get(e.id)?.dim || undefined}
            data-lit={emphasis.edges.get(e.id)?.tint ? true : undefined}
            className={`sm-edge-label pointer-events-none absolute font-sans whitespace-nowrap ${
              scene.labelStyle === 'text' ? 'rounded bg-stage px-1.5 text-[11.5px] leading-4 text-fg' : 'rounded-full bg-panel px-2 py-0.5 text-[11px] text-fg-muted'
            }`}
            style={{
              left: e.mid.x,
              top: e.mid.y,
              transform: 'translate(-50%, -50%)',
              // Text labels sit on the stage (lifelines pass behind them); pills get their outline.
              boxShadow: scene.labelStyle === 'text' ? undefined : 'inset 0 0 0 1px var(--sm-panel-border)',
            }}
          >
            {e.label}
          </div>
        ) : null,
      )}
    </>
  );
});
