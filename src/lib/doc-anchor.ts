// A comment on a passage remembers the passage's text and a little of what surrounds it.
// Offsets would go stale on the first edit above it; the text still finds its place.
export type DocAnchor = { quote: string; prefix: string; suffix: string };

const CONTEXT_CHARS = 32;
const MAX_QUOTE_CHARS = 1_000;

export function anchorFromRange(text: string, start: number, end: number): DocAnchor {
  const stop = Math.min(end, start + MAX_QUOTE_CHARS);
  return {
    quote: text.slice(start, stop),
    prefix: text.slice(Math.max(0, start - CONTEXT_CHARS), start),
    suffix: text.slice(stop, stop + CONTEXT_CHARS),
  };
}

function sharedEnd(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1;
  return n;
}

function sharedStart(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
}

/** Where the quote is now: the occurrence whose surroundings match best. Null once it is gone. */
export function locateAnchor(text: string, anchor: DocAnchor): { start: number; end: number } | null {
  if (!anchor.quote) return null;
  let best: { start: number; end: number } | null = null;
  let bestScore = -1;
  for (let at = text.indexOf(anchor.quote); at !== -1; at = text.indexOf(anchor.quote, at + 1)) {
    const end = at + anchor.quote.length;
    const score =
      sharedEnd(text.slice(Math.max(0, at - CONTEXT_CHARS), at), anchor.prefix) +
      sharedStart(text.slice(end, end + CONTEXT_CHARS), anchor.suffix);
    if (score > bestScore) {
      best = { start: at, end };
      bestScore = score;
    }
  }
  return best;
}
