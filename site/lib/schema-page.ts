import type { SchemaField, SchemaSection } from './data/schema-ref';

/** How a generated schema section appears on /docs/schema: its own table, or folded into the card-parts prose. */
export interface Placement {
  anchor: string;
  title: string;
  level: 2 | 3;
  /** set for the card's sub-objects, which the page describes in one paragraph instead of four tables */
  folded?: true;
}

export const PLACEMENTS: Record<string, Placement> = {
  Diagram: { anchor: 'diagram', title: 'Diagram', level: 2 },
  'nodes[]': { anchor: 'nodes', title: 'Nodes', level: 2 },
  'nodes[].card': { anchor: 'cards', title: 'Cards', level: 3 },
  'nodes[].card.rows[]': { anchor: 'card-parts', title: 'Card parts', level: 3, folded: true },
  'nodes[].card.stats[]': { anchor: 'card-parts', title: 'Card parts', level: 3, folded: true },
  'nodes[].card.footer': { anchor: 'card-parts', title: 'Card parts', level: 3, folded: true },
  'nodes[].card.footer.left': { anchor: 'card-parts', title: 'Card parts', level: 3, folded: true },
  'nodes[].card.footer.right': { anchor: 'card-parts', title: 'Card parts', level: 3, folded: true },
  'nodes[].card.cta': { anchor: 'card-parts', title: 'Card parts', level: 3, folded: true },
  'nodes[].evidence[]': { anchor: 'evidence', title: 'Evidence', level: 3 },
  source: { anchor: 'source', title: 'Source links', level: 3 },
  'edges[]': { anchor: 'edges', title: 'Connections', level: 2 },
  'groups[]': { anchor: 'groups', title: 'Groups', level: 2 },
  'lanes[]': { anchor: 'lanes', title: 'Lanes', level: 3 },
  'phases[]': { anchor: 'phases', title: 'Phases', level: 3 },
  'views[]': { anchor: 'views', title: 'Views', level: 2 },
  'notes[]': { anchor: 'notes', title: 'Notes', level: 3 },
};

/** The page's reading order, which follows the diagram's shape rather than the schema's nesting. */
export const ORDER = ['Diagram', 'nodes[]', 'nodes[].card', 'card-parts', 'nodes[].evidence[]', 'source', 'edges[]', 'groups[]', 'lanes[]', 'phases[]', 'views[]', 'notes[]'];

export type Block = { kind: 'table'; section: SchemaSection; placement: Placement } | { kind: 'card-parts' };

export function blocks(sections: SchemaSection[]): Block[] {
  const byName = new Map(sections.map((s) => [s.name, s]));
  return ORDER.map((name): Block => {
    if (name === 'card-parts') return { kind: 'card-parts' };
    const section = byName.get(name);
    if (!section) throw new Error(`the schema has no section ${name}`);
    return { kind: 'table', section, placement: PLACEMENTS[name]! };
  });
}

export type Piece = { text: string } | { code: string } | { link: string; href: string };

/**
 * A generated note as page copy: each clause starts with a capital, `code` stays code, and a link to a
 * nested section points at where the page actually puts it.
 */
export function notePieces(field: SchemaField): Piece[] {
  const sentences = field.notes.split(/(?<=\.) (?=[a-z[`])/).map((s) => s.replace(/^[a-z]/, (c) => c.toUpperCase()));
  const pieces: Piece[] = [];
  for (const [i, sentence] of sentences.entries()) {
    if (i) pieces.push({ text: ' ' });
    for (const m of sentence.split(/(`[^`]+`|\[.+?\]\(#[^)]+\))/)) {
      if (!m) continue;
      if (m.startsWith('`')) pieces.push({ code: m.slice(1, -1) });
      else if (m.startsWith('[')) {
        const label = m.slice(1, m.indexOf(']('));
        pieces.push({ link: label, href: `#${PLACEMENTS[field.link ?? '']?.anchor ?? m.slice(m.indexOf('(#') + 2, -1)}` });
      } else pieces.push({ text: m });
    }
  }
  return pieces;
}

export const fieldWords = (f: SchemaField) => `${f.key} ${f.type} ${f.notes}`;

/** The fields the docs search lists, each with the placement its result links to. */
export function searchFields(sections: SchemaSection[]): { field: SchemaField; place: Placement }[] {
  // The folded card parts share one anchor, so a field two of them define alike (a footer's left and right `icon`)
  // would be the same result twice.
  const seen = new Set<string>();
  return sections.flatMap((section) => {
    const place = PLACEMENTS[section.name];
    if (!place) return [];
    return section.fields.flatMap((field) => {
      const row = `${place.anchor} ${fieldWords(field)}`;
      if (seen.has(row)) return [];
      seen.add(row);
      return [{ field, place }];
    });
  });
}
