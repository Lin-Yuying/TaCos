import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { issueRef } from "./format";
import { seesAllTasks } from "./issues";
import { isAutomationManager } from "./automations/store";
import type { SQL } from "drizzle-orm/sql";
import {
  GROUP_ORDER,
  KIND_GROUP,
  SEARCH_KINDS,
  dateBound,
  kindsForGroup,
  type SearchFilters,
  type SearchGroup,
  type SearchKind,
  type SearchSort,
} from "./search-query";

/** How a result opens: a task/document panel, an Agent thread, or a plain link. */
export type SearchTarget = "issue" | "page" | "thread" | "link";

export type SearchHit = {
  kind: SearchKind;
  id: string;
  // The page or task this hit opens; a comment opens its parent.
  openId: string;
  title: string;
  ref: string | null;
  snippet: string;
  // Project name, @username, parent title, trigger type: the line under the title.
  context: string | null;
  byline: string | null;
  updatedAt: string;
  createdAt: string;
  target: SearchTarget;
  href: string | null;
};

export type SearchOptions = {
  group?: SearchGroup;
  sort?: SearchSort;
  filters?: SearchFilters;
  limit?: number;
  offset?: number;
  // Palette mode: keep the first N of every kind instead of a global page.
  perKindLimit?: number;
  includeCounts?: boolean;
};

export type SearchResult = {
  hits: SearchHit[];
  total: number;
  counts: Partial<Record<SearchKind, number>>;
  tookMs: number;
  group: SearchGroup;
  query: string;
};

type Row = {
  id: string;
  open_id: string;
  title: string;
  ref: string | null;
  body: string;
  context: string | null;
  byline: string | null;
  created_at: string;
  updated_at: string;
  target?: SearchTarget;
  href?: string | null;
};

type Ctx = {
  workspaceId: string;
  viewerId: string;
  match: SQL;
  matchOrder: SQL;
  sort: SearchSort;
  filters: SearchFilters;
  projectId: string | null;
  assignee: string | null;
  status: string | null;
  seesAll: boolean;
  canManageAutomations: boolean;
  limit: number;
};

const MAX_LIMIT = 50;
const MAX_FETCH_PER_KIND = 400;
// A page is ranked in memory, so both sides of a page boundary must come from the
// same fetched window. Fetching at least this many per kind keeps pages disjoint.
const MIN_FETCH_PER_KIND = 200;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 100;

// Kinds that can carry a project filter; people, labels and rules are workspace-wide.
const PROJECT_AWARE = new Set<SearchKind>([
  "task",
  "task_comment",
  "doc",
  "doc_comment",
  "project",
  "agent_thread",
  "attachment",
]);

function terms(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

/** The trigram index only answers terms of 3+ characters; shorter ones, such as most Chinese words, scan. */
function matchClause(words: string[]) {
  const longWords = words.filter((word) => [...word].length >= 3);
  if (longWords.length) {
    const phrases = longWords.map((word) => `"${word.replace(/"/g, '""')}"`).join(" ");
    const shortLikes = words
      .filter((word) => [...word].length < 3)
      .map((word) => {
        const pattern = `%${word.replace(/[\\%_]/g, "\\$&")}%`;
        return sql`(search_fts.title LIKE ${pattern} ESCAPE '\\' OR search_fts.body LIKE ${pattern} ESCAPE '\\')`;
      });
    return {
      where: sql`search_fts MATCH ${phrases}${
        shortLikes.length ? sql` AND ${sql.join(shortLikes, sql` AND `)}` : sql``
      }`,
      order: sql`bm25(search_fts)`,
    };
  }
  const likes = words.map((word) => {
    const pattern = `%${word.replace(/[\\%_]/g, "\\$&")}%`;
    return sql`(search_fts.title LIKE ${pattern} ESCAPE '\\' OR search_fts.body LIKE ${pattern} ESCAPE '\\')`;
  });
  return { where: sql.join(likes, sql` AND `), order: sql`search_fts.rowid DESC` };
}

function snippetOf(body: string, words: string[]): string {
  if (!body) return "";
  const lower = body.toLowerCase();
  const found = words
    .map((word) => lower.indexOf(word.toLowerCase()))
    .filter((at) => at >= 0);
  const at = found.length ? Math.min(...found) : 0;
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const piece = body.slice(start, at + SNIPPET_AFTER).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${piece}${at + SNIPPET_AFTER < body.length ? "…" : ""}`;
}

/** A number for "relevance": title matches count far more than body repeats. */
function relevance(row: Row, words: string[]): number {
  const title = (row.title ?? "").toLowerCase();
  const body = (row.body ?? "").toLowerCase();
  const phrase = words.join(" ").toLowerCase();
  let score = 0;
  if (title && phrase && title === phrase) score += 200;
  else if (title && phrase && title.startsWith(phrase)) score += 120;
  else if (title && phrase && title.includes(phrase)) score += 80;
  for (const word of words) {
    const needle = word.toLowerCase();
    if (!needle) continue;
    if (title.includes(needle)) score += 30;
    let at = 0;
    let found = 0;
    while (found < 3) {
      const next = title.indexOf(needle, at);
      if (next < 0) break;
      score += 8;
      found += 1;
      at = next + needle.length;
    }
    found = 0;
    at = 0;
    while (found < 5) {
      const next = body.indexOf(needle, at);
      if (next < 0) break;
      score += 2;
      found += 1;
      at = next + needle.length;
    }
  }
  return score;
}

function dateConditions(created: string, updated: string, filters: SearchFilters): SQL[] {
  const out: SQL[] = [];
  const createdFrom = dateBound(filters.createdFrom, false);
  const createdTo = dateBound(filters.createdTo, true);
  const updatedFrom = dateBound(filters.updatedFrom, false);
  const updatedTo = dateBound(filters.updatedTo, true);
  if (createdFrom) out.push(sql`${sql.raw(created)} >= ${createdFrom}`);
  if (createdTo) out.push(sql`${sql.raw(created)} <= ${createdTo}`);
  if (updatedFrom) out.push(sql`${sql.raw(updated)} >= ${updatedFrom}`);
  if (updatedTo) out.push(sql`${sql.raw(updated)} <= ${updatedTo}`);
  return out;
}

function orderClause(ctx: Ctx, updated: string, created: string, id: string): SQL {
  if (ctx.sort === "updated") return sql`${sql.raw(updated)} DESC, ${sql.raw(id)} DESC`;
  if (ctx.sort === "created") return sql`${sql.raw(created)} DESC, ${sql.raw(id)} DESC`;
  return ctx.matchOrder;
}

function join(conds: SQL[]): SQL {
  return sql.join(conds, sql` AND `);
}

/** The same project visibility rule listProjects applies: creators and members, or see-all roles. */
function projectVisible(projectAlias: string, ctx: Ctx): SQL {
  const alias = sql.raw(projectAlias);
  // A trashed project hides its tasks from admins too; only live projects count.
  if (ctx.seesAll) {
    return sql`EXISTS (
      SELECT 1 FROM projects visible
      WHERE visible.id = ${alias}.project_id AND visible.deleted_at IS NULL
    )`;
  }
  return sql`EXISTS (
    SELECT 1 FROM projects visible
    WHERE visible.id = ${alias}.project_id AND visible.deleted_at IS NULL AND (
      visible.created_by = ${ctx.viewerId} OR EXISTS (
        SELECT 1 FROM project_members visible_member
        WHERE visible_member.project_id = visible.id AND visible_member.user_id = ${ctx.viewerId}
      )
    )
  )`;
}

function assigneeConditions(issueAlias: string, ctx: Ctx): SQL[] {
  if (!ctx.assignee) return [];
  const alias = sql.raw(issueAlias);
  if (ctx.assignee === "none") {
    return [
      sql`NOT EXISTS (SELECT 1 FROM issue_assignees assignment WHERE assignment.issue_id = ${alias}.id)`,
    ];
  }
  return [
    sql`EXISTS (SELECT 1 FROM issue_assignees assignment WHERE assignment.issue_id = ${alias}.id AND assignment.user_id = ${ctx.assignee})`,
  ];
}

const toHit = (kind: SearchKind, row: Row, words: string[]): SearchHit => ({
  kind,
  id: row.id,
  openId: row.open_id,
  title: row.title,
  ref: row.ref,
  snippet: snippetOf(row.body ?? "", words),
  context: row.context,
  byline: row.byline,
  updatedAt: row.updated_at,
  createdAt: row.created_at,
  target: row.target ?? "link",
  href: row.href ?? null,
});

// --- entity adapters -------------------------------------------------------------

function docRows(ctx: Ctx): Row[] {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'doc'`,
    ctx.match,
    sql`p.deleted_at IS NULL`,
    sql`(p.shared = 1 OR p.created_by = ${ctx.viewerId})`,
    ...dateConditions("p.created_at", "p.updated_at", ctx.filters),
  ];
  if (ctx.projectId) conds.push(sql`p.project_id = ${ctx.projectId}`);
  return getDb().all<Row>(sql`
    SELECT p.id, p.id AS open_id, p.title, NULL AS ref, p.doc AS body,
           u.display_name AS byline, pr.name AS context,
           p.created_at, p.updated_at
    FROM search_fts
    JOIN pages p ON p.id = search_fts.ref_id
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN projects pr ON pr.id = p.project_id
    WHERE ${join(conds)}
    ORDER BY ${orderClause(ctx, "p.updated_at", "p.created_at", "p.id")} LIMIT ${ctx.limit}`).map(
    (row) => ({ ...row, target: "page" as const })
  );
}

function docCount(ctx: Ctx): number {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'doc'`,
    ctx.match,
    sql`p.deleted_at IS NULL`,
    sql`(p.shared = 1 OR p.created_by = ${ctx.viewerId})`,
    ...dateConditions("p.created_at", "p.updated_at", ctx.filters),
  ];
  if (ctx.projectId) conds.push(sql`p.project_id = ${ctx.projectId}`);
  return countOf(sql`SELECT COUNT(*) AS n FROM search_fts JOIN pages p ON p.id = search_fts.ref_id WHERE ${join(conds)}`);
}

function taskRows(ctx: Ctx): Row[] {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'task'`,
    ctx.match,
    sql`i.deleted_at IS NULL`,
    projectVisible("i", ctx),
    ...assigneeConditions("i", ctx),
    ...(ctx.status ? [sql`i.status = ${ctx.status}`] : []),
    ...dateConditions("i.created_at", "i.updated_at", ctx.filters),
  ];
  if (ctx.projectId) conds.push(sql`i.project_id = ${ctx.projectId}`);
  const rows = getDb().all<Row & { project_name: string | null; number: number; identifier: string }>(sql`
    SELECT i.id, i.id AS open_id, i.title, i.identifier, i.number, pr.name AS project_name,
           i.description AS body, u.display_name AS byline, pr.name AS context,
           i.created_at, i.updated_at
    FROM search_fts
    JOIN issues i ON i.id = search_fts.ref_id
    LEFT JOIN projects pr ON pr.id = i.project_id
    LEFT JOIN users u ON u.id = i.created_by
    WHERE ${join(conds)}
    ORDER BY ${orderClause(ctx, "i.updated_at", "i.created_at", "i.id")} LIMIT ${ctx.limit}`);
  return rows.map((row) => ({
    ...row,
    ref: issueRef({ projectName: row.project_name, number: row.number, identifier: row.identifier }),
    target: "issue" as const,
  }));
}

function taskCount(ctx: Ctx): number {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'task'`,
    ctx.match,
    sql`i.deleted_at IS NULL`,
    projectVisible("i", ctx),
    ...assigneeConditions("i", ctx),
    ...(ctx.status ? [sql`i.status = ${ctx.status}`] : []),
    ...dateConditions("i.created_at", "i.updated_at", ctx.filters),
  ];
  if (ctx.projectId) conds.push(sql`i.project_id = ${ctx.projectId}`);
  return countOf(sql`SELECT COUNT(*) AS n FROM search_fts JOIN issues i ON i.id = search_fts.ref_id WHERE ${join(conds)}`);
}

function taskCommentRows(ctx: Ctx): Row[] {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'task_comment'`,
    ctx.match,
    sql`i.deleted_at IS NULL`,
    projectVisible("i", ctx),
    ...dateConditions("c.created_at", "c.created_at", ctx.filters),
  ];
  if (ctx.projectId) conds.push(sql`i.project_id = ${ctx.projectId}`);
  const rows = getDb().all<Row & { project_name: string | null; number: number; identifier: string }>(sql`
    SELECT c.id, i.id AS open_id, i.title, i.identifier, i.number, pr.name AS project_name,
           c.body, u.display_name AS byline, pr.name AS context,
           c.created_at, c.created_at AS updated_at
    FROM search_fts
    JOIN comments c ON c.id = search_fts.ref_id
    JOIN issues i ON i.id = c.issue_id
    LEFT JOIN projects pr ON pr.id = i.project_id
    LEFT JOIN users u ON u.id = c.author_id
    WHERE ${join(conds)}
    ORDER BY ${orderClause(ctx, "c.created_at", "c.created_at", "c.id")} LIMIT ${ctx.limit}`);
  return rows.map((row) => ({
    ...row,
    ref: issueRef({ projectName: row.project_name, number: row.number, identifier: row.identifier }),
    target: "issue" as const,
  }));
}

function taskCommentCount(ctx: Ctx): number {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'task_comment'`,
    ctx.match,
    sql`i.deleted_at IS NULL`,
    projectVisible("i", ctx),
    ...dateConditions("c.created_at", "c.created_at", ctx.filters),
  ];
  if (ctx.projectId) conds.push(sql`i.project_id = ${ctx.projectId}`);
  return countOf(sql`SELECT COUNT(*) AS n FROM search_fts
    JOIN comments c ON c.id = search_fts.ref_id
    JOIN issues i ON i.id = c.issue_id WHERE ${join(conds)}`);
}

function docCommentRows(ctx: Ctx): Row[] {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'doc_comment'`,
    ctx.match,
    sql`c.deleted_at IS NULL`,
    sql`p.deleted_at IS NULL`,
    sql`(p.shared = 1 OR p.created_by = ${ctx.viewerId})`,
    ...dateConditions("c.created_at", "c.created_at", ctx.filters),
  ];
  if (ctx.projectId) conds.push(sql`p.project_id = ${ctx.projectId}`);
  return getDb().all<Row>(sql`
    SELECT c.id, p.id AS open_id, p.title, NULL AS ref, c.body,
           u.display_name AS byline, pr.name AS context,
           c.created_at, c.created_at AS updated_at
    FROM search_fts
    JOIN page_comments c ON c.id = search_fts.ref_id
    JOIN pages p ON p.id = c.page_id
    LEFT JOIN projects pr ON pr.id = p.project_id
    LEFT JOIN users u ON u.id = c.author_id
    WHERE ${join(conds)}
    ORDER BY ${orderClause(ctx, "c.created_at", "c.created_at", "c.id")} LIMIT ${ctx.limit}`).map(
    (row) => ({ ...row, target: "page" as const })
  );
}

function docCommentCount(ctx: Ctx): number {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'doc_comment'`,
    ctx.match,
    sql`c.deleted_at IS NULL`,
    sql`p.deleted_at IS NULL`,
    sql`(p.shared = 1 OR p.created_by = ${ctx.viewerId})`,
    ...dateConditions("c.created_at", "c.created_at", ctx.filters),
  ];
  if (ctx.projectId) conds.push(sql`p.project_id = ${ctx.projectId}`);
  return countOf(sql`SELECT COUNT(*) AS n FROM search_fts
    JOIN page_comments c ON c.id = search_fts.ref_id
    JOIN pages p ON p.id = c.page_id WHERE ${join(conds)}`);
}

function projectRows(ctx: Ctx): Row[] {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'project'`,
    ctx.match,
    sql`pr.deleted_at IS NULL`,
    ctx.seesAll
      ? sql`1`
      : sql`(pr.created_by = ${ctx.viewerId} OR EXISTS (
          SELECT 1 FROM project_members pm WHERE pm.project_id = pr.id AND pm.user_id = ${ctx.viewerId}
        ))`,
    ...dateConditions("pr.created_at", "pr.created_at", ctx.filters),
  ];
  if (ctx.projectId) conds.push(sql`pr.id = ${ctx.projectId}`);
  return getDb().all<Row>(sql`
    SELECT pr.id, pr.id AS open_id, pr.name AS title, pr.key,
           pr.description AS body, u.display_name AS byline, pr.key AS context,
           pr.created_at, pr.created_at AS updated_at
    FROM search_fts
    JOIN projects pr ON pr.id = search_fts.ref_id
    LEFT JOIN users u ON u.id = pr.created_by
    WHERE ${join(conds)}
    ORDER BY ${orderClause(ctx, "pr.created_at", "pr.created_at", "pr.id")} LIMIT ${ctx.limit}`).map(
    (row) => ({ ...row, href: `/${ctx.workspaceId}/projects/${row.id}` })
  );
}

function projectCount(ctx: Ctx): number {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'project'`,
    ctx.match,
    sql`pr.deleted_at IS NULL`,
    ctx.seesAll
      ? sql`1`
      : sql`(pr.created_by = ${ctx.viewerId} OR EXISTS (
          SELECT 1 FROM project_members pm WHERE pm.project_id = pr.id AND pm.user_id = ${ctx.viewerId}
        ))`,
    ...dateConditions("pr.created_at", "pr.created_at", ctx.filters),
  ];
  if (ctx.projectId) conds.push(sql`pr.id = ${ctx.projectId}`);
  return countOf(sql`SELECT COUNT(*) AS n FROM search_fts JOIN projects pr ON pr.id = search_fts.ref_id WHERE ${join(conds)}`);
}

function personRows(ctx: Ctx): Row[] {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'person'`,
    ctx.match,
    ...dateConditions("wm.created_at", "wm.created_at", ctx.filters),
  ];
  return getDb().all<Row>(sql`
    SELECT u.id, u.id AS open_id, u.display_name AS title, NULL AS ref,
           '' AS body, '@' || u.username AS context, NULL AS byline,
           wm.created_at, wm.created_at AS updated_at
    FROM search_fts
    JOIN users u ON u.id = search_fts.ref_id
    JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = ${ctx.workspaceId}
    WHERE ${join(conds)}
    ORDER BY ${orderClause(ctx, "wm.created_at", "wm.created_at", "u.id")} LIMIT ${ctx.limit}`).map(
    (row) => ({ ...row, href: `/${ctx.workspaceId}/people/${row.id}` })
  );
}

function personCount(ctx: Ctx): number {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'person'`,
    ctx.match,
    ...dateConditions("wm.created_at", "wm.created_at", ctx.filters),
  ];
  return countOf(sql`SELECT COUNT(*) AS n FROM search_fts
    JOIN users u ON u.id = search_fts.ref_id
    JOIN workspace_members wm ON wm.user_id = u.id AND wm.workspace_id = ${ctx.workspaceId}
    WHERE ${join(conds)}`);
}

function labelRows(ctx: Ctx): Row[] {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'label'`,
    ctx.match,
    ...dateConditions("l.created_at", "l.created_at", ctx.filters),
  ];
  return getDb().all<Row>(sql`
    SELECT l.id, l.id AS open_id, l.name AS title, NULL AS ref, '' AS body,
           NULL AS context, NULL AS byline, l.created_at, l.created_at AS updated_at
    FROM search_fts
    JOIN labels l ON l.id = search_fts.ref_id
    WHERE ${join(conds)}
    ORDER BY ${orderClause(ctx, "l.created_at", "l.created_at", "l.id")} LIMIT ${ctx.limit}`).map(
    (row) => ({
      ...row,
      href: `/${ctx.workspaceId}/?label=${encodeURIComponent(row.title)}`,
    })
  );
}

function labelCount(ctx: Ctx): number {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'label'`,
    ctx.match,
    ...dateConditions("l.created_at", "l.created_at", ctx.filters),
  ];
  return countOf(sql`SELECT COUNT(*) AS n FROM search_fts JOIN labels l ON l.id = search_fts.ref_id WHERE ${join(conds)}`);
}

function threadRows(ctx: Ctx): Row[] {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'agent_thread'`,
    ctx.match,
    sql`(t.visibility = 'shared' OR t.created_by = ${ctx.viewerId})`,
    ...dateConditions("t.created_at", "t.updated_at", ctx.filters),
  ];
  if (ctx.projectId) conds.push(sql`t.project_id = ${ctx.projectId}`);
  return getDb().all<Row>(sql`
    SELECT t.id, t.id AS open_id, t.title, NULL AS ref, search_fts.body AS body,
           u.display_name AS byline, pr.name AS context,
           t.created_at, t.updated_at
    FROM search_fts
    JOIN agent_threads t ON t.id = search_fts.ref_id
    LEFT JOIN projects pr ON pr.id = t.project_id
    LEFT JOIN users u ON u.id = t.created_by
    WHERE ${join(conds)}
    ORDER BY ${orderClause(ctx, "t.updated_at", "t.created_at", "t.id")} LIMIT ${ctx.limit}`).map(
    (row) => ({
      ...row,
      target: "thread" as const,
      href: `/${ctx.workspaceId}/agent?thread=${row.id}`,
    })
  );
}

function threadCount(ctx: Ctx): number {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'agent_thread'`,
    ctx.match,
    sql`(t.visibility = 'shared' OR t.created_by = ${ctx.viewerId})`,
    ...dateConditions("t.created_at", "t.updated_at", ctx.filters),
  ];
  if (ctx.projectId) conds.push(sql`t.project_id = ${ctx.projectId}`);
  return countOf(sql`SELECT COUNT(*) AS n FROM search_fts JOIN agent_threads t ON t.id = search_fts.ref_id WHERE ${join(conds)}`);
}

function attachmentRows(ctx: Ctx): Row[] {
  const pageVisible = sql`(p.id IS NOT NULL AND p.deleted_at IS NULL AND (p.shared = 1 OR p.created_by = ${ctx.viewerId}))`;
  const threadVisible = sql`(t.id IS NOT NULL AND (t.visibility = 'shared' OR t.created_by = ${ctx.viewerId}))`;
  const pageScope = ctx.projectId ? sql`p.project_id = ${ctx.projectId}` : sql`1`;
  const threadScope = ctx.projectId ? sql`t.project_id = ${ctx.projectId}` : sql`1`;
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'attachment'`,
    ctx.match,
    sql`a.complete = 1 AND a.page_id <> 'agent-draft'`,
    sql`((${pageVisible} AND ${pageScope}) OR (${threadVisible} AND ${threadScope}))`,
    ...dateConditions("a.created_at", "a.created_at", ctx.filters),
  ];
  const rows = getDb().all<
    Row & {
      target_id: string | null;
      target_kind: "page" | "thread";
      parent_title: string | null;
      uploader: string | null;
    }
  >(sql`
    SELECT a.id, a.id AS open_id, a.name AS title, NULL AS ref, '' AS body,
           CASE WHEN t.id IS NOT NULL THEN t.id ELSE p.id END AS target_id,
           CASE WHEN t.id IS NOT NULL THEN 'thread' ELSE 'page' END AS target_kind,
           COALESCE(p.title, t.title) AS parent_title,
           u.display_name AS uploader,
           a.created_at, a.created_at AS updated_at
    FROM search_fts
    JOIN attachments a ON a.id = search_fts.ref_id
    LEFT JOIN pages p ON p.id = a.page_id
    LEFT JOIN agent_threads t ON ('thread:' || t.id) = a.page_id
    LEFT JOIN users u ON u.id = a.uploader_id
    WHERE ${join(conds)}
    ORDER BY ${orderClause(ctx, "a.created_at", "a.created_at", "a.id")} LIMIT ${ctx.limit}`);
  return rows.map((row) => {
    const isThread = row.target_kind === "thread";
    return {
      ...row,
      open_id: row.target_id ?? row.id,
      context: row.parent_title,
      byline: row.uploader,
      target: (isThread ? "thread" : "page") as SearchTarget,
      href: isThread ? `/${ctx.workspaceId}/agent?thread=${row.target_id}` : null,
    };
  });
}

function attachmentCount(ctx: Ctx): number {
  const pageVisible = sql`(p.id IS NOT NULL AND p.deleted_at IS NULL AND (p.shared = 1 OR p.created_by = ${ctx.viewerId}))`;
  const threadVisible = sql`(t.id IS NOT NULL AND (t.visibility = 'shared' OR t.created_by = ${ctx.viewerId}))`;
  const pageScope = ctx.projectId ? sql`p.project_id = ${ctx.projectId}` : sql`1`;
  const threadScope = ctx.projectId ? sql`t.project_id = ${ctx.projectId}` : sql`1`;
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'attachment'`,
    ctx.match,
    sql`a.complete = 1 AND a.page_id <> 'agent-draft'`,
    sql`((${pageVisible} AND ${pageScope}) OR (${threadVisible} AND ${threadScope}))`,
    ...dateConditions("a.created_at", "a.created_at", ctx.filters),
  ];
  return countOf(sql`SELECT COUNT(*) AS n FROM search_fts
    JOIN attachments a ON a.id = search_fts.ref_id
    LEFT JOIN pages p ON p.id = a.page_id
    LEFT JOIN agent_threads t ON ('thread:' || t.id) = a.page_id
    WHERE ${join(conds)}`);
}

function triggerType(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { type?: unknown };
    return typeof parsed.type === "string" ? parsed.type : raw;
  } catch {
    return raw;
  }
}

function automationRows(ctx: Ctx): Row[] {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'automation'`,
    ctx.match,
    ctx.canManageAutomations ? sql`1` : sql`r.enabled = 1`,
    ...dateConditions("r.created_at", "r.updated_at", ctx.filters),
  ];
  return getDb().all<Row & { trigger: string }>(sql`
    SELECT r.id, r.id AS open_id, r.name AS title, NULL AS ref, r.trigger AS body,
           r.trigger, u.display_name AS byline, NULL AS context,
           r.created_at, r.updated_at
    FROM search_fts
    JOIN automation_rules r ON r.id = search_fts.ref_id
    LEFT JOIN users u ON u.id = r.updated_by
    WHERE ${join(conds)}
    ORDER BY ${orderClause(ctx, "r.updated_at", "r.created_at", "r.id")} LIMIT ${ctx.limit}`).map((row) => ({
    ...row,
    context: triggerType(row.trigger),
    href: `/${ctx.workspaceId}/settings#automations`,
  }));
}

function automationCount(ctx: Ctx): number {
  const conds = [
    sql`search_fts.workspace_id = ${ctx.workspaceId}`,
    sql`search_fts.kind = 'automation'`,
    ctx.match,
    ctx.canManageAutomations ? sql`1` : sql`r.enabled = 1`,
    ...dateConditions("r.created_at", "r.updated_at", ctx.filters),
  ];
  return countOf(sql`SELECT COUNT(*) AS n FROM search_fts JOIN automation_rules r ON r.id = search_fts.ref_id WHERE ${join(conds)}`);
}

function countOf(query: SQL): number {
  const [row] = getDb().all<{ n: number }>(query);
  return Number(row?.n ?? 0);
}

const ROWS: Record<SearchKind, (ctx: Ctx) => Row[]> = {
  task: taskRows,
  task_comment: taskCommentRows,
  doc: docRows,
  doc_comment: docCommentRows,
  project: projectRows,
  person: personRows,
  label: labelRows,
  agent_thread: threadRows,
  attachment: attachmentRows,
  automation: automationRows,
};

const COUNTS: Record<SearchKind, (ctx: Ctx) => number> = {
  task: taskCount,
  task_comment: taskCommentCount,
  doc: docCount,
  doc_comment: docCommentCount,
  project: projectCount,
  person: personCount,
  label: labelCount,
  agent_thread: threadCount,
  attachment: attachmentCount,
  automation: automationCount,
};

// Results are grouped by entity kind. Groups with the strongest first hit come first,
// then the fixed tab order; every group keeps the chosen sort inside it.
function groupOrder(
  hits: (SearchHit & { score: number })[],
  sort: SearchSort
): Map<SearchGroup, number> {
  const best = new Map<SearchGroup, string | number>();
  for (const hit of hits) {
    const group = KIND_GROUP[hit.kind];
    const value = sort === "updated" ? hit.updatedAt : sort === "created" ? hit.createdAt : hit.score;
    const current = best.get(group);
    if (
      current === undefined ||
      (typeof value === "number" && typeof current === "number" && value > current) ||
      (typeof value === "string" && typeof current === "string" && value > current)
    ) {
      best.set(group, value);
    }
  }
  return new Map(
    GROUP_ORDER.filter((group) => best.has(group))
      .sort((a, b) => {
        const left = best.get(a)!;
        const right = best.get(b)!;
        if (typeof left === "number" && typeof right === "number") return right - left;
        if (typeof left === "string" && typeof right === "string") return right.localeCompare(left);
        return 0;
      })
      .map((group, index) => [group, index])
  );
}

function compareHits(
  order: Map<SearchGroup, number>,
  sort: SearchSort
): (a: SearchHit & { score: number }, b: SearchHit & { score: number }) => number {
  return (a, b) => {
    const groupA = order.get(KIND_GROUP[a.kind]) ?? 999;
    const groupB = order.get(KIND_GROUP[b.kind]) ?? 999;
    if (groupA !== groupB) return groupA - groupB;
    if (sort === "updated") return b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id);
    if (sort === "created") return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
    return b.score - a.score || b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
  };
}

function clamp(value: number | undefined, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

/** Everything the viewer may read, across every indexed entity, filtered and ranked. */
export async function search(
  workspaceId: string,
  viewerId: string,
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult> {
  const started = Date.now();
  const words = terms(query);
  const group = options.group ?? "all";
  const sort = options.sort ?? "relevance";
  const limit = clamp(options.limit, 1, MAX_LIMIT);
  const offset = clamp(options.offset, 0, 100_000);
  const filters: SearchFilters = { ...options.filters };
  if (!words.length) {
    return { hits: [], total: 0, counts: {}, tookMs: Date.now() - started, group, query: "" };
  }
  const match = matchClause(words);
  const [seesAll, canManageAutomations] = await Promise.all([
    seesAllTasks(workspaceId, viewerId),
    isAutomationManager(workspaceId, viewerId),
  ]);
  const assignee = filters.assignee === "me" ? viewerId : filters.assignee?.trim() || null;
  const projectId = filters.projectId?.trim() || null;
  const status = filters.status?.trim() || null;
  const taskOnly = Boolean(assignee || status);
  const projectScoped = Boolean(projectId);
  const allowed = (kind: SearchKind) =>
    (!taskOnly || kind === "task") && (!projectScoped || PROJECT_AWARE.has(kind));
  const requested = kindsForGroup(group).filter(allowed);
  const fetchLimit = Math.min(
    options.perKindLimit ?? Math.max(limit + offset, MIN_FETCH_PER_KIND),
    MAX_FETCH_PER_KIND
  );
  const ctx: Ctx = {
    workspaceId,
    viewerId,
    match: match.where,
    matchOrder: match.order,
    sort,
    filters,
    projectId,
    assignee,
    status,
    seesAll,
    canManageAutomations,
    limit: fetchLimit,
  };

  const raw: (Row & { kind: SearchKind })[] = [];
  for (const kind of requested) {
    for (const row of ROWS[kind](ctx)) raw.push({ ...row, kind });
  }
  const hits = raw.map((row) => {
    const hit = toHit(row.kind, row, words);
    return { ...hit, score: relevance(row, words) };
  });
  const order = groupOrder(hits, sort);
  hits.sort(compareHits(order, sort));

  const counts: Partial<Record<SearchKind, number>> = {};
  if (options.includeCounts) {
    for (const kind of SEARCH_KINDS) {
      counts[kind] = allowed(kind) ? COUNTS[kind](ctx) : 0;
    }
  }
  const total = options.includeCounts
    ? requested.reduce((sum, kind) => sum + (counts[kind] ?? 0), 0)
    : hits.length;
  const page = options.perKindLimit ? hits : hits.slice(offset, offset + limit);
  return {
    hits: page.map(({ score, ...hit }) => {
      void score;
      return hit;
    }),
    total,
    counts,
    tookMs: Date.now() - started,
    group,
    query: query.trim(),
  };
}

/** The old shape: every kind, up to 20 each, for callers that just want a list. */
export async function searchWorkspace(
  workspaceId: string,
  viewerId: string,
  query: string
): Promise<SearchHit[]> {
  const result = await search(workspaceId, viewerId, query, {
    perKindLimit: 20,
    limit: 200,
    includeCounts: false,
  });
  return result.hits;
}
