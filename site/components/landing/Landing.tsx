import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { LaidOutDiagram } from '@stackmap/core';
import { Cmd } from '@/components/ui/Cmd';
import { EXAMPLES } from '@/lib/catalog';
import { stillOf } from '@/lib/diagrams';
import { KIND_PAGES } from '@/lib/kinds';
import { SITE } from '@/lib/site-data';
import { spell } from '@/lib/words';
import { HeroDemo } from './HeroDemo';
import { How } from './How';
import { Install } from './Install';
import { Kinds } from './Kinds';
import { Proof } from './Proof';
import { Reveals } from './Reveals';
import './landing.css';

const rise = (d: number) => ({ ['--d' as string]: `${d}ms` });
// The one request the page makes: the session in #how answers the sentence #install hands over, the architecture docs' own.
const ASK = KIND_PAGES.architecture.ask;

/** The landing, after the canvas's "Landing" boards: one responsive page, desktop 1440 down to a 320 phone. */
export function Landing({ demo, checkout }: { demo: LaidOutDiagram; checkout: Record<string, LaidOutDiagram> }) {
  return (
    <>
      <section className="hero" id="top" aria-labelledby="hero-h">
        <div className="hero-bg grid-bg" aria-hidden="true" />
        <div className="wrap">
          <div className="hero-copy">
            <h1 className="t-hero" id="hero-h" data-rise="" style={rise(0)}>
              Every layer of your stack, <span className="acc">on one map.</span>
            </h1>
            <p className="t-lede hero-lede" data-rise="" style={rise(60)}>
              Interactive system diagrams your coding agent writes, as one offline HTML file.
            </p>
            <div className="hero-acts" data-rise="" style={rise(120)}>
              <Cmd command={SITE.install.skill} label="Copy the install command" />
              <Link className="pill-l" href="/docs">
                <span>Read the docs</span>
                <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
              </Link>
            </div>
            <p className="hero-works" data-rise="" style={rise(180)}>
              Works with Claude Code, Cursor, Codex and other coding agents.
            </p>
          </div>
          <div className="demo" data-rise="" data-rise-frame="" style={rise(240)}>
            <HeroDemo diagram={demo} still={stillOf('demo')} show={{ select: 'api', route: ['storefront', 'orders'], query: 'orders', view: 'checkout' }} />
          </div>
        </div>
      </section>

      <section className="sec how" id="how" aria-labelledby="how-h">
        <div className="wrap">
          <header className="sec-h" data-reveal="">
            <p className="eyebrow">How it works</p>
            <h2 className="t-h2" id="how-h">
              <span className="ln">Ask your agent.</span> <span className="ln">One file comes back.</span>
            </h2>
            <p className="t-lede">The agent writes a small typed diagram.json. stackmap checks it, lays it out and delivers a viewer you can open anywhere.</p>
          </header>
        </div>
        <How demo={demo} receipt={SITE.receipt} repair={SITE.repair} ask={ASK} />
      </section>

      <section className="sec kinds" id="kinds" aria-labelledby="kinds-h">
        <div className="wrap">
          <header className="sec-h" data-reveal="">
            <p className="eyebrow">Five kinds</p>
            <h2 className="t-h2" id="kinds-h">
              One checkout, five ways to draw it.
            </h2>
            <p className="t-lede">Pick the kind that answers the question. Each has its own layout, and every one plays its flow.</p>
          </header>
          <Kinds checkout={checkout} />
          <div className="ex-band" data-reveal="">
            <p>{spell(EXAMPLES.length, true)} diagrams, from release pipelines to maps a coding agent wrote from one request.</p>
            <Link className="pill-l" href="/examples">
              <span>See the examples</span>
              <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <Proof receipt={SITE.receipt} />
      <Install skill={SITE.install.skill} cli={SITE.install.cli} ask={ASK} />
      <Reveals />
    </>
  );
}
