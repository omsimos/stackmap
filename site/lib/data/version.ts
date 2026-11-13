import { readFileSync } from 'node:fs';
import { PACKAGE, REPO_SLUG } from '../package';
import { CLI_PACKAGE } from './paths';

export function readCliVersion(pkg: URL = CLI_PACKAGE): string {
  return (JSON.parse(readFileSync(pkg, 'utf8')) as { version: string }).version;
}

// The skill command has no version: `skills add` installs from the repo, not from npm.
export function installCommands(version: string) {
  return { skill: `npx skills add ${REPO_SLUG}`, cli: `npx ${PACKAGE}@${version} deliver diagram.json` };
}
