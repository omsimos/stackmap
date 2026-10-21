import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { isLarge, layoutDiagram } from '@stackmap/layout';
import { validateDiagram, type Diagnostic, type ValidationResult } from '@stackmap/schema';
import { embedDiagram } from './embed';
import { formatDiagnostic, summary } from './format';
import { CliError, readText, writeAtomic } from './io';
import { locateJsonError } from './json-error';
import { plain, type Style } from './style';

export interface CommandResult {
  code: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

export function validateFile(path: string): ValidationResult {
  const text = readText(path);
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    const { line, column, expected } = locateJsonError(text);
    const diagnostic: Diagnostic = {
      code: 'schema/invalid-json',
      severity: 'error',
      subject: '',
      message: `Not valid JSON at line ${line}, column ${column}: expected ${expected}`,
      evidence: { line, column, expected },
      allowedFixes: [`fix the JSON syntax at line ${line}, column ${column}`],
    };
    return { ok: false, diagnostics: [diagnostic] };
  }
  return validateDiagram(input);
}

// Exit 1 means "the diagram has errors" to the agent loop, so every other failure must be exit 2.
const failure = (e: unknown): CommandResult => ({
  code: 2,
  stdout: '',
  stderr: `stackmap: ${e instanceof CliError ? '' : 'internal error: '}${(e as Error).message}\n`,
});

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};

const report = (diagnostics: Diagnostic[]) => diagnostics.map((d) => `${formatDiagnostic(d)}\n`).join('');

export async function validateCommand(path: string, { json }: { json: boolean }): Promise<CommandResult> {
  try {
    const { ok, diagnostics } = validateFile(path);
    const stdout = json ? `${JSON.stringify({ ok, diagnostics }, null, 2)}\n` : `${report(diagnostics)}${summary(diagnostics)}\n`;
    return { code: ok ? 0 : 1, stdout, stderr: '' };
  } catch (e) {
    return failure(e);
  }
}

/** Validate, lay out and embed: the HTML is present exactly when the diagram has no errors. */
export async function buildHtml(
  path: string,
  template: string,
  progress?: (line: string) => void,
): Promise<ValidationResult & { html?: string }> {
  const result = validateFile(path);
  if (!result.ok || !result.diagram) return result;
  const { nodes, edges } = result.diagram;
  // The result only prints once the layout is done; without this a big diagram looks hung for minutes.
  if (progress && isLarge(result.diagram))
    progress(`laying out ${nodes.length} nodes and ${edges.length} connections; a diagram this size can take a while`);
  return { ...result, html: embedDiagram(template, await layoutDiagram(result.diagram)) };
}

export async function deliverCommand(
  path: string,
  {
    template,
    out,
    style = plain,
    open,
    progress,
  }: {
    template: string;
    out?: string;
    style?: Style;
    /** opens the written file (deliver --open): null once it did, else why it couldn't */
    open?: (file: string) => Promise<string | null>;
    /** a line to show the user now, not with the result */
    progress?: (line: string) => void;
  },
): Promise<CommandResult> {
  try {
    const target = out ?? path.slice(0, path.length - extname(path).length) + '.html';
    if (real(target) === real(path)) throw new CliError(`refusing to overwrite the input ${path}; pass -o <out.html>`);
    const { html, diagnostics } = await buildHtml(path, template, progress);
    // Diagnostics go to stderr so stdout carries only the receipt.
    if (html === undefined) return { code: 1, stdout: '', stderr: `${report(diagnostics)}${summary(diagnostics)}\n` };
    writeAtomic(target, html);
    const bytes = Buffer.byteLength(html);
    const sha = createHash('sha256').update(html).digest('hex');
    // The file is written either way, so a browser that won't open is a warning, not a failure.
    const unopened = open ? await open(target) : null;
    const warning = unopened ? `warning: couldn't open ${target} in a browser (${unopened})\n` : '';
    return { code: 0, stdout: `delivered ${style.path(target)} · sha256 ${sha} · ${bytes} bytes\n`, stderr: report(diagnostics) + warning };
  } catch (e) {
    return failure(e);
  }
}
