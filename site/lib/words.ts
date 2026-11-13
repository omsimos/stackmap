const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1);

/** The indefinite article a word takes, by its first letter: enough for the kind names it is used on. */
export function article(word: string, capital = false): string {
  const a = /^[aeiou]/i.test(word) ? 'an' : 'a';
  return capital ? cap(a) : a;
}

/** Counts in running copy are spelled out, so they follow the data without reading as figures. */
export function spell(n: number, capital = false): string {
  const w = WORDS[n] ?? String(n);
  return capital ? cap(w) : w;
}
