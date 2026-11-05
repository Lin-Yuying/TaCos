// H-COLLAB-10: "@username" mentions in comments and task descriptions.
// A mention cannot follow a character of an address or a path, so an email address such
// as a@b.com is not a mention. It can follow Chinese text, which has no spaces.
const BEFORE = "(^|[^A-Za-z0-9_.+\\-/@])";
// Any other username is written @[name], because only the brackets say where it ends:
// Chinese has no spaces, and a username may hold them.
const BRACKETED = "\\[([^\\]\\n]+)\\]";
const PLAIN = "[A-Za-z0-9][A-Za-z0-9_.-]*[A-Za-z0-9_]|[A-Za-z0-9]";
const MENTION_RE = new RegExp(`${BEFORE}@(?:${BRACKETED}|(${PLAIN}))`, "g");
// A notice also goes out for a hand-typed @张三 followed by a space or punctuation.
const NOTICE_RE = new RegExp(`${BEFORE}@(?:${BRACKETED}|([\\p{L}\\p{N}](?:[\\p{L}\\p{N}_.-]*[\\p{L}\\p{N}_])?))`, "gu");
const PLAIN_NAME = new RegExp(`^(?:${PLAIN})$`);

// A username as it is stored and compared.
export function normalizeUsername(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

// Letters of any language, digits, spaces and punctuation. The marks that write a mention
// and line breaks are out.
export function validUsername(name: string): boolean {
  const length = [...name].length;
  return length >= 1 && length <= 40 && !/[@[\]\p{Cc}]/u.test(name);
}

// How the text writes a mention of this username.
export function mentionText(username: string): string {
  return PLAIN_NAME.test(username) ? `@${username}` : `@[${username}]`;
}

// Unique usernames in the text, normalized, in the order that they appear.
export function parseMentions(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(NOTICE_RE)) {
    const name = normalizeUsername(match[2] ?? match[3]);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

// The usernames a document's Markdown mentions. Code is quoted text, not an address to anyone.
export function parseDocMentions(markdown: string): string[] {
  return parseMentions(markdown.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " "));
}

export type MentionPerson = { id: string; username: string; displayName: string };

/** Workspace members named in the text who cannot read a private page (not its author). */
export function mentionedMembersWithoutAccess(
  page: { shared: boolean; createdBy: string },
  members: MentionPerson[],
  text: string,
  options: { doc?: boolean } = {}
): MentionPerson[] {
  const names = (options.doc ? parseDocMentions : parseMentions)(text);
  if (!names.length || page.shared) return [];
  return members.filter(
    (member) => names.includes(member.username.toLowerCase()) && member.id !== page.createdBy
  );
}

// Splits text into plain parts and mention parts for display.
export function splitMentions(text: string): Array<{ text: string; mention?: string }> {
  const parts: Array<{ text: string; mention?: string }> = [];
  let last = 0;
  for (const match of text.matchAll(MENTION_RE)) {
    const start = (match.index ?? 0) + match[1].length;
    if (start > last) parts.push({ text: text.slice(last, start) });
    const name = match[2] ?? match[3];
    parts.push({ text: `@${name}`, mention: normalizeUsername(name) });
    last = start + match[0].length - match[1].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
