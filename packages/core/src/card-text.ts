import { CARD, COMPACT, type CardVariant } from './card-metrics';
import { measureText, type FontFace } from './text-measure';
import type { CardData } from './types';

/** A truncating text slot on a node card, with the width NodeCard gives it before the ellipsis. */
export interface TextSlot {
  /** JSON pointer relative to the card, e.g. "/rows/0/value" */
  path: string;
  text: string;
  face: FontFace;
  size: number;
  maxWidth: number;
}

// Horizontal geometry of NodeCard's Tailwind classes (px). NodeCard keeps its classes; the viewer's
// browser test proves truncation happens exactly where these budgets say it does.
const PAD = 16; // px-4
const INNER = CARD.width - 2 * PAD; // 248: header, rows and footer content box
const ICON_TILE = 36; // size-9
const GAP = 12; // gap-3
const PANEL = CARD.width - 2 * 12; // 256: stats and CTA sit in px-3
const ROW_VALUE_MAX = 0.55; // max-w-[55%]

// StepCard: px-3, size-7 tile, gap-2.5; the tag pill (px-2) lines up with the title.
const C_PAD = 12;
const C_TILE = 28;
const C_GAP = 10;
const C_TEXT = COMPACT.width - 2 * C_PAD - C_TILE - C_GAP; // 114

/** Text as a card shows it: white-space: nowrap collapses runs of whitespace and trims the ends. */
export const shownText = (text: string) => text.replace(/\s+/g, ' ').trim();

export function cardTextSlots(card: CardData, variant: CardVariant = 'full'): TextSlot[] {
  const slots: TextSlot[] = [];
  const add = (path: string, text: string | undefined, face: FontFace, size: number, maxWidth: number) => {
    if (text !== undefined) slots.push({ path, text, face, size, maxWidth });
  };

  if (variant === 'compact') {
    add('/title', card.title, 'sans500', 13, C_TEXT);
    add('/subtitle', card.subtitle, 'sans400', 11.5, C_TEXT);
    add('/tag', card.tag, 'sans500', 11, C_TEXT - 2 * 8);
    return slots;
  }

  const header = INNER - ICON_TILE - GAP;
  add('/title', card.title, 'sans500', 13.5, header);
  add('/subtitle', card.subtitle, 'sans400', 12, header);

  card.rows?.forEach((row, i) => {
    const face: FontFace = row.mono ? 'mono400' : 'sans400';
    const valueMax = INNER * ROW_VALUE_MAX;
    // The value is shrink-0 up to its cap, so the label gets whatever the rendered value leaves.
    const valueWidth = Math.min(measureText(shownText(row.value), face, 12), valueMax);
    add(`/rows/${i}/label`, row.label, 'sans400', 12, INNER - GAP - valueWidth);
    add(`/rows/${i}/value`, row.value, face, 12, valueMax);
  });

  if (card.stats?.length) {
    const n = card.stats.length;
    const tileText = (PANEL - 2 * 6 - (n - 1) * 6) / n - 2 * 10; // p-1.5, gap-1.5, tile px-2.5
    card.stats.forEach((stat, i) => {
      add(`/stats/${i}/value`, stat.value, 'sans500tnum', 15, tileText);
      add(`/stats/${i}/label`, stat.label, 'sans400', 11, tileText);
    });
    add('/statsNote', card.statsNote, 'sans400', 11.5, PANEL - 2 * 12 - 12 - 6); // px-3, 12px icon, gap-1.5
  }

  const half = (INNER - GAP) / 2;
  for (const side of ['left', 'right'] as const) {
    const item = card.footer?.[side];
    if (item) add(`/footer/${side}/text`, item.text, 'sans400', 12, half - (item.icon ? 13 + 6 : 0));
  }

  // px-3 tile; a linked CTA also shows a 15px arrow.
  add('/cta/label', card.cta?.label, 'sans500', 13, PANEL - 2 * 12 - (card.cta?.href ? 15 : 0));
  return slots;
}
