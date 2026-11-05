// What the editor shows for `![[page]]`. The body stays on the other page; this only
// decides which text to draw inside the card.

type EmbedPage = { id: string; title: string };

export type EmbedPreview = {
  id: string | null;
  label: string;
  body: string | null;
  missing: boolean;
};

export function embedPreview(
  pages: { lookup: Record<string, EmbedPage>; embeds?: Record<string, string> } | undefined,
  title: string,
  pageId: string | null,
): EmbedPreview {
  if (!pages) return { id: null, label: title, body: null, missing: false };
  const target = (pageId ? pages.lookup[pageId] : undefined) ?? pages.lookup[title.trim().toLowerCase()];
  if (!target) return { id: null, label: title, body: null, missing: true };
  const body = pages.embeds?.[target.id];
  return { id: target.id, label: target.title, body: body === undefined ? null : body, missing: false };
}
