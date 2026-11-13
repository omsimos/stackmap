import Link from 'next/link';
import { BookOpen, Map } from 'lucide-react';
import { LINKS } from '@/components/site/links';
import { Lockup } from '@/components/site/Lockup';
import { Cmd } from '@/components/ui/Cmd';
import { CopyButton } from '@/components/ui/CopyButton';
import { GitHubIcon, NpmIcon } from '@/components/ui/icons';

/** #install: the skill, the request to make, and the CLI on its own. */
export function Install({ skill, cli, ask }: { skill: string; cli: string; ask: string }) {
  return (
    <section className="sec inst" id="install" aria-labelledby="inst-h">
      <div className="wrap">
        <div className="target" data-reveal="">
          <div className="t-lock">
            <Lockup height={48} />
          </div>
          <h2 className="t-h2" id="inst-h">
            Every layer of your stack, <span className="acc nowrap">on one map.</span>
          </h2>
          <p className="t-lede">Interactive system diagrams your coding agent writes, as one offline HTML file.</p>
          <ol className="ist">
            <li className="ist-row">
              <span className="ist-n mono" aria-hidden="true">
                1
              </span>
              <div>
                <h3>Install the skill into your agent</h3>
                <Cmd command={skill} label="Copy the install command" big />
              </div>
            </li>
            <li className="ist-row">
              <span className="ist-n mono" aria-hidden="true">
                2
              </span>
              <div>
                <h3>Then ask</h3>
                <div className="ask">
                  <span>{ask}</span>
                  <CopyButton text={ask} label="Copy the request" />
                </div>
              </div>
            </li>
          </ol>
          <div className="ist-alt">
            <p>
              Or run the CLI on its own, with Node 22.12 or later: it turns any <code className="mono">diagram.json</code> into <code className="mono">diagram.html</code> beside
              it.
            </p>
            <Cmd command={cli} label="Copy the CLI command" />
          </div>
          <div className="ilinks">
            <a className="lnk" href={LINKS.github.href} target="_blank" rel="noreferrer">
              <GitHubIcon size={16} />
              <span>GitHub</span>
            </a>
            <a className="lnk" href={LINKS.npm.href} target="_blank" rel="noreferrer">
              <NpmIcon />
              <span>npm</span>
            </a>
            <Link className="lnk" href={LINKS.docs.href}>
              <BookOpen size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>Docs</span>
            </Link>
            <Link className="lnk" href={LINKS.examples.href}>
              <Map size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>Examples</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
