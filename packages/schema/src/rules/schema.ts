import type { z } from 'zod';
import type { Diagnostic } from '../diagnostics';
import { buildJsonSchema, HTTP_URL, ID_PATTERN, REPO_PATH, VISIBLE_TEXT } from '../schema';
import { closest, pointer, toId } from '../util';

const kindOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let v = input;
  for (const k of path) v = v !== null && typeof v === 'object' ? (v as Record<PropertyKey, unknown>)[k] : undefined;
  return v;
}

type JsonSchemaNode = { type?: string; properties?: Record<string, JsonSchemaNode>; items?: JsonSchemaNode };
let jsonSchema: JsonSchemaNode | undefined;

function schemaAt(path: readonly PropertyKey[]): JsonSchemaNode | undefined {
  let node: JsonSchemaNode | undefined = (jsonSchema ??= buildJsonSchema() as JsonSchemaNode);
  for (const key of path) node = typeof key === 'number' ? node?.items : node?.properties?.[String(key)];
  return node;
}

/** Property names allowed on the object at `path`, read from the emitted JSON Schema. */
const keysAt = (path: readonly PropertyKey[]) => Object.keys(schemaAt(path)?.properties ?? {});

/**
 * The plain-object child of `path` that accepts `key` (a node's `brand` belongs in `card`). Arrays are
 * skipped: "move label into rows" would send the agent off to invent a row.
 */
function childAccepting(path: readonly PropertyKey[], key: string): string | undefined {
  const props = schemaAt(path)?.properties ?? {};
  return Object.keys(props).find((k) => props[k]!.type === 'object' && Object.hasOwn(props[k]!.properties ?? {}, key));
}

/** Whether the object enclosing `path` accepts `key` (card `evidence` belongs on the node). */
function parentAccepts(path: readonly PropertyKey[], key: string): boolean {
  if (!path.length) return false;
  // The parent of `/nodes/0/card` is the node; of `/nodes/0` it is the array, so step past it to the diagram.
  const up = path.slice(0, -1);
  const parent = schemaAt(up);
  const obj = parent?.properties ? parent : schemaAt(up.slice(0, -1));
  return Object.hasOwn(obj?.properties ?? {}, key);
}

// Names authors reach for that mean an existing field.
const ALIASES: Record<string, string> = { name: 'title', label: 'title', description: 'subtitle', desc: 'subtitle', icon: 'brand', logo: 'brand' };

const article = (t: string) => (/^[aeiou]/.test(t) ? `an ${t}` : `a ${t}`);

/** "the diagram", "item 2 of \"nodes\"" or "\"title\"" — how a fix names the value at `path`. */
function name(path: readonly PropertyKey[]): string {
  const last = path.at(-1);
  if (last === undefined) return 'the diagram';
  return typeof last === 'number' ? `item ${last} of "${String(path.at(-2))}"` : `"${String(last)}"`;
}

const NUMERIC: ReadonlySet<string> = new Set(['number', 'int', 'bigint']);

function fixes(issue: z.core.$ZodIssue, received: unknown): string[] {
  const key = String(issue.path.at(-1) ?? 'value');
  switch (issue.code) {
    case 'invalid_type':
      return received === undefined && issue.path.length > 0
        ? [`add the required "${key}" field (${issue.expected})`]
        : [`make ${name(issue.path)} ${article(issue.expected)}`];
    case 'invalid_value':
      return [`use one of: ${issue.values.map(String).join(', ')}`];
    case 'too_big':
      if (issue.origin === 'array') return [`keep at most ${issue.maximum} items`];
      if (NUMERIC.has(issue.origin)) return [`make "${key}" ${issue.inclusive ? 'at most' : 'less than'} ${issue.maximum}`];
      return [`shorten "${key}" to at most ${issue.maximum} characters`];
    case 'too_small':
      if (issue.origin === 'array') return [`add at least ${issue.minimum} item(s)`];
      if (NUMERIC.has(issue.origin)) return [`make "${key}" ${issue.inclusive ? 'at least' : 'greater than'} ${issue.minimum}`];
      return [`give "${key}" a non-empty value`];
    case 'invalid_format':
      if (issue.format === 'regex' && issue.pattern === String(ID_PATTERN))
        return [`use a lowercase id such as "${toId(String(received ?? ''))}"`];
      if (issue.format === 'regex' && issue.pattern === String(VISIBLE_TEXT)) return [`give "${key}" visible text`];
      // `source` has no other field, so removing just "url" would leave an invalid `source: {}`.
      if (issue.format === 'regex' && issue.pattern === String(HTTP_URL))
        return ['use an http(s) URL', `remove "${issue.path.at(-2) === 'source' ? 'source' : key}"`];
      if (issue.format === 'regex' && issue.pattern === String(REPO_PATH))
        return ['use a repo-relative path like "src/api/server.ts" (no "..", "\\", "://" or leading "/")'];
      return [`match ${issue.pattern ?? issue.format}`];
    case 'unrecognized_keys': {
      const allowed = keysAt(issue.path);
      return issue.keys.flatMap((k) => {
        // Own keys only: an agent's stray `constructor` or `toString` is on every object's prototype.
        const alias = Object.hasOwn(ALIASES, k) ? ALIASES[k] : undefined;
        if (alias && allowed.includes(alias)) return [`rename "${k}" to "${alias}"`];
        // A node's `label` means its card title, not the similarly spelt `lane`.
        const aliasHome = alias && childAccepting(issue.path, alias);
        if (aliasHome) return [`move "${k}" into "${aliasHome}" as "${alias}"`, `remove "${k}"`];
        const near = closest(k, allowed, 1)[0];
        if (near) return [`rename "${k}" to "${near}"`];
        const home = childAccepting(issue.path, k);
        if (home) return [`move "${k}" into "${home}"`, `remove "${k}"`];
        if (parentAccepts(issue.path, k)) return [`move "${k}" up to the enclosing object`, `remove "${k}"`];
        return [`remove "${k}" (not valid here; allowed: ${allowed.join(', ')})`];
      });
    }
    default:
      return ['fix the value to match stackmap.schema.json'];
  }
}

/** Zod issues → diagnostics: `schema/<zod issue code>`, subject = the offending path. */
export function schemaDiagnostics(issues: readonly z.core.$ZodIssue[], input: unknown): Diagnostic[] {
  return issues.map((issue) => {
    const received = valueAt(input, issue.path);
    const { code, path, message, input: _input, ...rest } = issue as z.core.$ZodIssue & { input?: unknown };
    const evidence: Record<string, unknown> = { ...rest };
    // Primitives verbatim; objects and arrays by kind only, so evidence stays small.
    if (code !== 'unrecognized_keys') evidence.received = received !== null && typeof received === 'object' ? kindOf(received) : received === undefined ? 'missing' : received;
    return {
      code: `schema/${code}`,
      severity: 'error',
      subject: pointer(path),
      message: issue.code === 'invalid_type' ? `Expected ${issue.expected}, received ${received === undefined ? 'nothing' : kindOf(received)}` : message,
      evidence,
      allowedFixes: fixes(issue, received),
    } satisfies Diagnostic;
  });
}
