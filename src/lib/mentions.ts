// H-COLLAB-10: "@username" mentions in comments and task descriptions.
// A mention cannot follow a character of an address or a path, so an email address such
// as a@b.com is not a mention. It can follow Chinese text, which has no spaces.
export const MENTION_RE = /(^|[^A-Za-z0-9_.+\-/@])@([A-Za-z0-9][A-Za-z0-9_.-]*[A-Za-z0-9_]|[A-Za-z0-9])/g;

// Unique usernames in the text, in lowercase, in the order that they appear.
export function parseMentions(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(MENTION_RE)) {
    const name = match[2].toLowerCase();
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

// The usernames a document's Markdown mentions. Code is quoted text, not an address to anyone.
export function parseDocMentions(markdown: string): string[] {
  return parseMentions(markdown.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " "));
}

// Splits text into plain parts and mention parts for display.
export function splitMentions(text: string): Array<{ text: string; mention?: string }> {
  const parts: Array<{ text: string; mention?: string }> = [];
  let last = 0;
  for (const match of text.matchAll(MENTION_RE)) {
    const start = (match.index ?? 0) + match[1].length;
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: `@${match[2]}`, mention: match[2].toLowerCase() });
    last = start + match[2].length + 1;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
