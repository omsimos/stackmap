// Runs the built binary the way an agent does: deliver each sample twice, byte-identical, receipt = file hash.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GALLERY } from '../../core/src/samples/gallery.ts';
import { commerceApi, groupedPlatform } from '../../core/src/samples/index.ts';

// Not `.pathname`: it keeps percent-escapes, so a checkout path with a space would not resolve.
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'stackmap-smoke-'));
const run = (...args) => execFileSync('node', [cli, ...args], { encoding: 'utf8' });
const check = (ok, msg) => {
  if (!ok) throw new Error(`smoke: ${msg}`);
};

check(/^\d+\.\d+\.\d+\n$/.test(run('--version')), '--version');
for (const [name, draft] of Object.entries({ 'commerce-api': commerceApi, 'grouped-platform': groupedPlatform, ...GALLERY })) {
  const input = join(dir, `${name}.json`);
  writeFileSync(input, JSON.stringify(draft, null, 2));
  check(run('validate', input) === '✓ valid: no diagnostics\n', `${name} validates`);
  const receipts = ['a', 'b'].map((v) => run('deliver', input, '-o', join(dir, `${name}.${v}.html`)));
  const [a, b] = ['a', 'b'].map((v) => readFileSync(join(dir, `${name}.${v}.html`)));
  check(a.equals(b), `${name} is byte-identical across runs`);
  check(receipts[0].includes(`sha256 ${createHash('sha256').update(a).digest('hex')}`), `${name} receipt hash`);
}
console.log(`✓ smoke: deliver is deterministic (${dir})`);
