import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { deliverCommand, validateCommand, type CommandResult } from './commands';
import { openInBrowser } from './open';
import { serve } from './serve';
import { styleFor } from './style';

// Injected by tsup (define), so the bundle doesn't carry the whole package.json.
declare const __STACKMAP_VERSION__: string;
const VERSION = __STACKMAP_VERSION__;

const HELP = `stackmap ${VERSION}: validate agent-authored diagrams and deliver an offline HTML viewer

Usage:
  stackmap validate <diagram.json> [--json]      check the diagram; exit 1 on errors
  stackmap deliver  <diagram.json> [-o out.html] [--open]
                                                 validate, lay out and write the viewer
  stackmap serve    <diagram.json> [--port 4400] live viewer that reloads when the file changes

Options:
  --json         machine-readable diagnostics (validate)
  -o, --out      output path (deliver; default: next to the input, .html)
  --open         open the written viewer in the default browser (deliver)
  --port         port for serve (default 4400; the next free one is used if taken)
  -h, --help     show this help
  -v, --version  show the version
`;

const style = styleFor(process.stdout);

// On a TTY a command's stdout goes under the banner, indented like the brand's CLI sample.
const sign = (command: string, text: string) => {
  const banner = style.banner(command);
  return banner && text ? banner + text.replace(/^(?=.)/gm, '  ') : text;
};
const signed = (command: string, r: CommandResult): CommandResult => ({ ...r, stdout: sign(command, r.stdout) });

async function run(argv: string[]): Promise<CommandResult> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean' },
        out: { type: 'string', short: 'o' },
        open: { type: 'boolean' },
        port: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (e) {
    return { code: 2, stdout: '', stderr: `stackmap: ${(e as Error).message}\n\n${HELP}` };
  }
  const { values, positionals } = parsed;
  if (values.version) return { code: 0, stdout: `${VERSION}\n`, stderr: '' };
  const [command, file, ...extra] = positionals;
  const usage = (msg: string): CommandResult => ({ code: 2, stdout: '', stderr: `stackmap: ${msg}\n\n${HELP}` });
  if (values.help || command === 'help') return { code: 0, stdout: HELP, stderr: '' };
  if (!command) return usage('missing command');
  if (command !== 'validate' && command !== 'deliver' && command !== 'serve') return usage(`unknown command "${command}"`);
  if (!file || extra.length) return usage(`${command} takes exactly one diagram file`);
  if (values.port !== undefined && command !== 'serve') return usage('--port applies to serve');
  if (values.open && command !== 'deliver') return usage('--open applies to deliver');
  if (command === 'validate') {
    if (values.out !== undefined) return usage('-o/--out applies to deliver, not validate');
    return values.json ? validateCommand(file, { json: true }) : signed(command, await validateCommand(file, { json: false }));
  }
  if (values.json) return usage(`--json applies to validate, not ${command}`);
  if (command === 'serve' && values.out !== undefined) return usage('-o/--out applies to deliver, not serve');
  let template: string;
  try {
    template = readFileSync(new URL('./viewer.html', import.meta.url), 'utf8');
  } catch (e) {
    return { code: 2, stdout: '', stderr: `stackmap: internal error: viewer template missing (${(e as Error).message})\n` };
  }
  if (command === 'deliver') {
    const open = values.open ? openInBrowser : undefined;
    const progress = (line: string) => process.stderr.write(`${line}\n`);
    return signed(command, await deliverCommand(file, { template, out: values.out, style, open, progress }));
  }

  const port = values.port === undefined ? 4400 : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return usage(`--port must be 0-65535, got "${values.port}"`);
  const server = await serve(file, { template, port, log: (line) => process.stderr.write(`${line}\n`) });
  process.stdout.write(sign(command, `serving ${style.path(server.url)} · watching ${file} · Ctrl-C to stop\n`));
  await new Promise<void>((resolve) => process.once('SIGINT', resolve));
  await server.close();
  return { code: 0, stdout: '', stderr: '' };
}

const result = await run(process.argv.slice(2)).catch(
  (e: unknown): CommandResult => ({ code: 2, stdout: '', stderr: `stackmap: internal error: ${(e as Error).message}\n` }),
);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.code;
