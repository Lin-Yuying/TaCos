// Page-to-page links. v1 records page → page references only, derived from the Markdown
// a page actually stores. Because the document is the source of truth, links are rebuilt
// from it on every save: one transaction replaces the page's outgoing rows, so Yjs
// collaboration never has to write link state and restoring a version puts the same
// links back as its text.
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { pageLinks, pages } from "../db/schema";
import { parseBlocks, parseInline, type Block, type Inline } from "./markdown";
import { nowIso } from "./issues";
import type { PageRef } from "./pages";

export type PageLinkTarget = { id: string; title: string };

export type PageBacklink = PageRef & { path: string };

export type UnresolvedPageLink = {
  sourceId: string;
  sourceTitle: string;
  targetPageId: string;
  targetTitle: string;
};

/** A page reference as written: an id wins over a title when both are present. */
type WrittenRef = { title: string; pageId?: string };

function walkInline(nodes: Inline[], visit: (ref: WrittenRef) => void): void {
  for (const node of nodes) {
    if (node.type === "page") visit({ title: node.text, pageId: node.pageId });
    else if (node.type === "color") walkInline(node.children, visit);
  }
}

function walkBlocks(blocks: Block[], visit: (ref: WrittenRef) => void): void {
  for (const block of blocks) {
    switch (block.kind) {
      case "heading":
        walkInline(block.text, visit);
        break;
      case "paragraph":
      case "quote":
        for (const line of block.lines) walkInline(line, visit);
        break;
      case "list":
      case "todo":
        for (const item of block.items) walkInline(item.text, visit);
        break;
      case "table":
        for (const cell of [...block.header, ...block.rows.flat()]) walkInline(parseInline(cell), visit);
        break;
      case "toggle":
        walkInline(block.summary, visit);
        walkBlocks(block.body, visit);
        break;
      case "callout":
        walkBlocks(block.body, visit);
        break;
      case "embed":
        visit({ title: block.text, pageId: block.pageId });
        break;
      default:
        break;
    }
  }
}

/** The page references in a document's Markdown, including embeds, without touching code. */
export function writtenPageRefs(doc: string): WrittenRef[] {
  const refs: WrittenRef[] = [];
  // parseBlocks already treats fenced code as opaque and parseInline treats inline code
  // as one token, so `[[` inside either never reaches walkInline.
  walkBlocks(parseBlocks(doc), (ref) => {
    if (ref.title.trim()) refs.push(ref);
  });
  return refs;
}

/**
 * Resolves written references to pages this writer may open. `pageId` is authoritative
 * and is what the picker writes; a legacy title-only reference resolves by the same
 * case-insensitive title rule the reader uses. Unresolvable references are not stored.
 */
export function pageLinkTargets(doc: string, refs: PageRef[]): PageLinkTarget[] {
  const byId = new Map(refs.map((ref) => [ref.id, ref]));
  const byTitle = new Map<string, PageRef>();
  for (const ref of refs) {
    const key = ref.title.trim().toLowerCase();
    if (key && !byTitle.has(key)) byTitle.set(key, ref);
  }
  const out: PageLinkTarget[] = [];
  const seen = new Set<string>();
  for (const written of writtenPageRefs(doc)) {
    const target =
      (written.pageId ? byId.get(written.pageId) : undefined) ??
      byTitle.get(written.title.trim().toLowerCase());
    if (!target || seen.has(target.id)) continue;
    seen.add(target.id);
    out.push({ id: target.id, title: target.title });
  }
  return out;
}

/** Replaces one source's outgoing links. Safe inside an outer transaction. */
export function replacePageLinks(
  workspaceId: string,
  sourceId: string,
  targets: PageLinkTarget[],
  options: { sourceKind?: string; createdAt?: string } = {}
): void {
  const db = getDb();
  const sourceKind = options.sourceKind ?? "page";
  db.delete(pageLinks)
    .where(
      and(
        eq(pageLinks.workspaceId, workspaceId),
        eq(pageLinks.sourceKind, sourceKind),
        eq(pageLinks.sourceId, sourceId)
      )
    )
    .run();
  if (targets.length === 0) return;
  const createdAt = options.createdAt ?? nowIso();
  db.insert(pageLinks)
    .values(
      targets.map((target) => ({
        workspaceId,
        sourceKind,
        sourceId,
        targetPageId: target.id,
        targetTitle: target.title,
        createdAt,
      }))
    )
    .run();
}

type VisiblePageRow = { id: string; title: string; icon: string | null; parentId: string | null };

function visiblePageSql(workspaceId: string, viewerId: string) {
  return sql`SELECT id, title, icon, parent_id AS parentId FROM pages
    WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
      AND (shared = 1 OR created_by = ${viewerId})`;
}

/** Paths for the visible pages, built the same way the page picker names them. */
function pathsFor(rows: VisiblePageRow[]): Map<string, string> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const paths = new Map<string, string>();
  for (const row of rows) {
    const chain: VisiblePageRow[] = [];
    const seen = new Set<string>();
    let at: VisiblePageRow | undefined = row;
    while (at && !paths.has(at.id) && !seen.has(at.id)) {
      seen.add(at.id);
      chain.push(at);
      at = at.parentId ? byId.get(at.parentId) : undefined;
    }
    let prefix = at ? paths.get(at.id) ?? "" : "";
    while (chain.length) {
      const node = chain.pop()!;
      prefix = prefix ? `${prefix} / ${node.title}` : node.title;
      paths.set(node.id, prefix);
    }
  }
  return paths;
}

/** The pages that point at this one, as the viewer may read them. */
export async function listPageBacklinks(
  workspaceId: string,
  pageId: string,
  viewerId: string
): Promise<PageBacklink[]> {
  const db = getDb();
  const [target] = await db
    .select({ id: pages.id })
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        eq(pages.id, pageId),
        isNull(pages.deletedAt),
        or(eq(pages.shared, 1), eq(pages.createdBy, viewerId))
      )
    )
    .limit(1);
  if (!target) return [];
  const sources = await db
    .select({
      id: pages.id,
      title: pages.title,
      icon: pages.icon,
      parentId: pages.parentId,
      updatedAt: pages.updatedAt,
    })
    .from(pageLinks)
    .innerJoin(pages, eq(pages.id, pageLinks.sourceId))
    .where(
      and(
        eq(pageLinks.workspaceId, workspaceId),
        eq(pageLinks.sourceKind, "page"),
        eq(pageLinks.targetPageId, pageId),
        isNull(pages.deletedAt),
        or(eq(pages.shared, 1), eq(pages.createdBy, viewerId))
      )
    )
    .orderBy(desc(pages.updatedAt));
  const rows = await db.all<VisiblePageRow>(visiblePageSql(workspaceId, viewerId));
  const paths = pathsFor(rows);
  const seen = new Set<string>();
  const out: PageBacklink[] = [];
  for (const source of sources) {
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    out.push({
      id: source.id,
      title: source.title,
      icon: source.icon,
      path: paths.get(source.id) ?? source.title,
    });
  }
  return out;
}

/**
 * Links whose target is in the Trash, was purged, or is not visible to this reader. The
 * source page still renders the reference as an unresolved mention; this powers the
 * document index's cleanup list.
 */
export async function listUnresolvedPageLinks(
  workspaceId: string,
  viewerId: string
): Promise<UnresolvedPageLink[]> {
  return getDb().all<UnresolvedPageLink>(sql`
    SELECT l.source_id AS sourceId, s.title AS sourceTitle,
           l.target_page_id AS targetPageId, l.target_title AS targetTitle
    FROM page_links l
    JOIN pages s ON s.id = l.source_id
    LEFT JOIN pages t ON t.id = l.target_page_id
      AND t.deleted_at IS NULL AND (t.shared = 1 OR t.created_by = ${viewerId})
    WHERE l.workspace_id = ${workspaceId} AND l.source_kind = 'page'
      AND s.deleted_at IS NULL AND (s.shared = 1 OR s.created_by = ${viewerId})
      AND t.id IS NULL
    ORDER BY s.updated_at DESC, s.title, l.target_title`);
}

/** How many visible pages link to each target, for the document index. */
export async function pageLinkCounts(
  workspaceId: string,
  viewerId: string
): Promise<Record<string, number>> {
  const rows = await getDb().all<{ target: string; count: number }>(sql`
    SELECT l.target_page_id AS target, COUNT(DISTINCT l.source_id) AS count
    FROM page_links l
    JOIN pages s ON s.id = l.source_id
    WHERE l.workspace_id = ${workspaceId} AND l.source_kind = 'page'
      AND s.deleted_at IS NULL AND (s.shared = 1 OR s.created_by = ${viewerId})
    GROUP BY l.target_page_id`);
  return Object.fromEntries(rows.map((row) => [row.target, Number(row.count)]));
}
