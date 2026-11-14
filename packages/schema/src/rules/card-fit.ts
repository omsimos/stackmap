import { cardTextSlots, measureText, shownText, usesCompactCards, type DiagramDraft } from '@stackmap/core';
import type { Diagnostic } from '../diagnostics';

const round = (n: number) => Math.round(n * 10) / 10;

/** Text that the card would truncate with an ellipsis, measured headlessly with Geist metrics. */
export function cardFitDiagnostics(d: DiagramDraft): Diagnostic[] {
  const out: Diagnostic[] = [];
  const variant = usesCompactCards(d) ? 'compact' : 'full';
  d.nodes.forEach((n, i) => {
    for (const slot of cardTextSlots(n.card, variant)) {
      const shown = shownText(slot.text);
      const width = measureText(shown, slot.face, slot.size);
      if (width <= slot.maxWidth) continue;
      const chars = [...shown];
      let maxChars = 0;
      while (maxChars < chars.length && measureText(chars.slice(0, maxChars + 1).join(''), slot.face, slot.size) <= slot.maxWidth) maxChars++;
      const header = slot.path === '/title' || slot.path === '/subtitle';
      // A row label's budget is whatever its value leaves, so shortening the value also works.
      const rowLabel = /^\/rows\/\d+\/label$/.test(slot.path);
      out.push({
        code: 'card-fit/overflow',
        severity: 'error',
        subject: `/nodes/${i}/card${slot.path}`,
        message: `"${slot.text}" is ${round(width)}px wide; this slot fits ${round(slot.maxWidth)}px (~${maxChars} characters)`,
        evidence: { text: slot.text, width: round(width), maxWidth: round(slot.maxWidth), maxChars },
        allowedFixes: [
          `shorten to at most ${maxChars} characters`,
          ...(header && variant === 'full' ? ['move the detail into a card row'] : []),
          ...(header && variant === 'compact' ? ['move the detail into an evidence note'] : []),
          ...(rowLabel ? [`shorten the value at /nodes/${i}/card${slot.path.replace(/label$/, 'value')} to give the label room`] : []),
        ],
      });
    }
  });
  return out;
}
