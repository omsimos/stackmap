'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FileCode2, FileText, SquareTerminal } from 'lucide-react';
import type { LaidOutDiagram } from '@stackmap/core';
import { LiveScene } from '@/components/diagram/LiveScene';
import type { Receipt, RepairRound } from '@/lib/data/receipt';
import { gsap, ScrollTrigger } from '@/lib/motion';

const STEPS: { n: string; title: string; desc: ReactNode }[] = [
  { n: '01', title: 'Ask.', desc: 'Ask your coding agent for a diagram of a codebase, a system, a process or a request.' },
  { n: '02', title: 'It writes JSON.', desc: 'A small typed diagram.json: nodes, connections, groups and views. No coordinates.' },
  {
    n: '03',
    title: 'stackmap checks it.',
    desc: (
      <>
        <code>validate</code> names each problem with a code and the allowed fixes. The agent repairs what is named.
      </>
    ),
  },
  {
    n: '04',
    title: 'One file comes back.',
    desc: (
      <>
        <code>deliver</code> lays the diagram out and writes one self-contained HTML viewer.
      </>
    ),
  },
];

const i = (n: number) => ({ '--i': n }) as CSSProperties;

function Tool({ s, at, verb, children }: { s: number; at: number; verb: string; children: ReactNode }) {
  return (
    <span className="tl tool" data-s={s} style={i(at)}>
      <i className="tdot" aria-hidden="true" />
      <b>{verb}</b>
      <span className="mono">{children}</span>
    </span>
  );
}
function Out({ s, at, tone = '', children }: { s: number; at: number; tone?: string; children: ReactNode }) {
  return (
    <span className={`tl out ${tone}`} data-s={s} style={i(at)}>
      <span className="mono">{children}</span>
    </span>
  );
}

const K = ({ children }: { children: string }) => <span className="j-k">&quot;{children}&quot;</span>;
const S = ({ children }: { children: string }) => <span className="j-s">&quot;{children}&quot;</span>;

// The diagram.json the agent writes, cut to the lines the repair touches: the edge that names a node that isn't there.
function Json({ title }: { title: string }) {
  const lines: { n: string; cls?: string; c: ReactNode }[] = [
    { n: '1', c: '{' },
    { n: '2', c: <>  <K>kind</K>: <S>architecture</S>,</> },
    { n: '3', c: <>  <K>title</K>: <S>{title}</S>,</> },
    { n: '4', c: <>  <K>nodes</K>: [</> },
    { n: '5', c: <>    {'{ '}<K>id</K>: <S>api</S>, <K>type</K>: <S>service</S>{' },'}</> },
    { n: '6', c: <>    {'{ '}<K>id</K>: <S>orders</S>, <K>type</K>: <S>database</S>, <K>group</K>: <S>data</S>{' },'}</> },
    { n: '7', c: '    …' },
    { n: '8', c: '  ],' },
    { n: '9', c: <>  <K>edges</K>: [</> },
    { n: '−', cls: 'bad', c: <>    {'{ '}<K>id</K>: <S>e-api-orders</S>, <K>from</K>: <S>api</S>, <K>to</K>: <S>orders-db</S>{' },'}</> },
    { n: '+', cls: 'fix', c: <>    {'{ '}<K>id</K>: <S>e-api-orders</S>, <K>from</K>: <S>api</S>, <K>to</K>: <S>orders</S>{' },'}</> },
    { n: '11', c: '    …' },
    { n: '12', c: '  ]' },
    { n: '13', c: '}' },
  ];
  return (
    <div className="json-v">
      <span className="caret" aria-hidden="true" />
      {lines.map((l, at) => (
        <span key={at} className={`jl ${l.cls ?? ''}`} style={i(at)}>
          <span className="jn" aria-hidden="true">
            {l.n}
          </span>
          <span className="jc">{l.c}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * #how: four steps over one agent session. On a wide screen with motion it pins for 1.6 screens and the scroll
 * picks the step (step = ⌊progress × 4⌋); everywhere else it is its resting frame, the whole session and the map.
 */
export function How({ demo, receipt, repair, ask }: { demo: LaidOutDiagram; receipt: Receipt; repair: RepairRound; ask: string }) {
  const pin = useRef<HTMLDivElement>(null);
  const stick = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState(false);
  const [step, setStep] = useState(3);
  const [shown, setShown] = useState(0);
  const runway = useRef(0);
  const stickTop = useRef(0);

  useEffect(() => {
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference) and (min-width: 1024px)', () => {
      const p = pin.current!;
      const s = stick.current!;
      const layout = () => {
        // The runway is CSS (.how-pin::after), so the page is its final height before this runs and a hash or a
        // restored scroll position lands where it stays.
        runway.current = p.offsetHeight - s.offsetHeight;
        stickTop.current = Math.max(88, Math.round((innerHeight - s.offsetHeight) / 2 + 24));
        s.style.position = 'sticky';
        s.style.top = `${stickTop.current}px`;
      };
      layout();
      setPinned(true);
      const draw = (progress: number) => {
        if (fill.current) fill.current.style.transform = `scaleX(${progress})`;
        setStep(Math.min(3, Math.floor(progress * 4)));
      };
      // CSS sticky does the pin; ScrollTrigger only reads how far through the runway the page is.
      const st = ScrollTrigger.create({
        trigger: p,
        start: () => `top top+=${stickTop.current}`,
        end: () => `+=${runway.current}`,
        invalidateOnRefresh: true,
        onRefreshInit: layout,
        onUpdate: ({ progress }) => draw(progress),
      });
      // onUpdate waits for a scroll; until then the rail would keep its resting (full) fill.
      draw(st.progress);
      return () => {
        st.kill();
        s.style.position = '';
        s.style.top = '';
        if (fill.current) fill.current.style.transform = '';
        setPinned(false);
        setStep(3);
      };
    });
    return () => mm.revert();
  }, []);

  // Step 4 delivers the file: the map plays its intro each time the walkthrough reaches it.
  useEffect(() => {
    if (pinned && step === 3) setShown((n) => n + 1);
  }, [pinned, step]);

  const goStep = (n: number) => {
    const p = pin.current;
    if (!pinned || !p) return;
    const top = p.getBoundingClientRect().top + scrollY - stickTop.current;
    scrollTo({ top: Math.round(top + runway.current * ((n + 0.5) / 4)) });
  };
  const state = (n: number) => (!pinned || n < step ? 'done' : n === step ? 'now' : 'next');
  const { nodes, edges, views } = demo.draft;
  const short = `${receipt.sha256.slice(0, 12)}…`;
  // validate's first line is "error  <code>  <pointer>": the edit lands where it points.
  const pointer = repair.broken[0]?.trim().split(/\s+/)[2] ?? '';

  return (
    <div ref={pin} className="how-pin" data-live={pinned || undefined}>
      <div ref={stick} className="how-stick">
        <div className="wrap how-frame" data-reveal="" style={{ ['--d' as string]: '60ms' }}>
          <ol className="hsteps">
            <i className="hrail" aria-hidden="true">
              <i ref={fill} className="hfill" />
            </i>
            {STEPS.map((s, n) => (
              <li key={s.n} className="hs" data-state={state(n)}>
                <button type="button" onClick={() => goStep(n)} aria-current={pinned && n === step ? 'step' : undefined}>
                  <i className="hs-dot" aria-hidden="true" />
                  <span className="hs-n mono">{s.n}</span>
                  <span className="hs-t">{s.title}</span>
                  <span className="hs-d">{s.desc}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="hpanel pnl" data-step={step}>
            <div className="ses">
              <div className="ses-h">
                <SquareTerminal size={16} strokeWidth={1.75} aria-hidden="true" />
                <span className="mono">~/commerce-api</span>
              </div>
              <div className="ses-b">
                <span className="tl ask" data-s={0} style={i(0)}>
                  <span className="ask-p" aria-hidden="true">
                    ›
                  </span>
                  <span>{ask}</span>
                </span>
                <Tool s={1} at={0} verb="Write">
                  .stackmap/commerce-api/diagram.json
                </Tool>
                <Out s={1} at={1}>
                  {nodes.length} nodes · {edges.length} connections · {views?.length ?? 0} views
                </Out>
                <Tool s={2} at={0} verb="Run">
                  stackmap validate diagram.json
                </Tool>
                {repair.broken.map((line, n) => (
                  <Out key={n} s={2} at={n + 1} tone={n === 0 || n === repair.broken.length - 1 ? 't-err' : ''}>
                    {line}
                  </Out>
                ))}
                <Tool s={2} at={repair.broken.length + 1} verb="Edit">
                  diagram.json {pointer} → &quot;orders&quot;
                </Tool>
                <Tool s={2} at={repair.broken.length + 2} verb="Run">
                  stackmap validate diagram.json
                </Tool>
                {repair.clean.map((line, n) => (
                  <Out key={n} s={2} at={repair.broken.length + 3 + n} tone="t-ok">
                    {line}
                  </Out>
                ))}
                <Tool s={3} at={0} verb="Run">
                  stackmap deliver diagram.json
                </Tool>
                <Out s={3} at={1} tone="t-ink">
                  delivered {receipt.file}
                </Out>
                <Out s={3} at={2} tone="t-ink">
                  {`  · sha256 ${short} · ${receipt.bytes} bytes`}
                </Out>
              </div>
            </div>
            <div className="fp" aria-hidden="true">
              <div className="fp-h">
                <span className="fp-f mono f-json">
                  <FileCode2 size={15} strokeWidth={1.75} />
                  <span>diagram.json</span>
                </span>
                <span className="fp-f mono f-html">
                  <FileText size={15} strokeWidth={1.75} />
                  <span>diagram.html</span>
                </span>
                <span className="fp-tag f-html">Opens offline</span>
              </div>
              <div className="fp-b">
                <div className="fp-json">
                  <Json title={demo.draft.title} />
                </div>
                <div className="fp-map">
                  <LiveScene diagram={demo} box={{ width: 512, height: 460 }} play={shown} pad={28} max={0.5} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
