import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { issueRef } from "./format";
import { listProjects } from "./issues";

export type SearchHit = {
  kind: "doc" | "task" | "task_comment" | "doc_comment";
  id: string;
  // The page or the task this hit opens; a comment opens its parent.
  openId: string;
  title: string;
  ref: string | null;
  snippet: string;
  updatedAt: string;
};

type Row = {
  id: string;
  open_id: string;
  title: string;
  project_name: string | null;
  number: number | null;
  identifier: string | null;
  body: string;
  updated_at: string;
};

const PER_KIND = 20;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 100;

function terms(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

/** The trigram index only answers terms of 3+ characters; shorter ones, such as most Chinese words, scan. */
function matchClause(words: string[]) {
  if (words.every((word) => [...word].length >= 3)) {
    const phrases = words.map((word) => `"${word.replace(/"/g, '""')}"`).join(" ");
    return { where: sql`search_fts MATCH ${phrases}`, order: sql`bm25(search_fts)` };
  }
  const likes = words.map((word) => {
    const pattern = `%${word.replace(/[\\%_]/g, "\\$&")}%`;
    return sql`(search_fts.title LIKE ${pattern} ESCAPE '\\' OR search_fts.body LIKE ${pattern} ESCAPE '\\')`;
  });
  return { where: sql.join(likes, sql` AND `), order: sql`search_fts.rowid DESC` };
}

function snippetOf(body: string, words: string[]): string {
  const lower = body.toLowerCase();
  const found = words.map((word) => lower.indexOf(word.toLowerCase())).filter((at) => at >= 0);
  const at = found.length ? Math.min(...found) : 0;
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const piece = body.slice(start, at + SNIPPET_AFTER).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${piece}${at + SNIPPET_AFTER < body.length ? "…" : ""}`;
}

/** Everything this person may read in the workspace. Others' private documents and hidden projects never match. */
export async function searchWorkspace(
  workspaceId: string,
  viewerId: string,
  query: string
): Promise<SearchHit[]> {
  const words = terms(query);
  if (!words.length) return [];
  const { where, order } = matchClause(words);
  const db = getDb();
  const projectIds = (await listProjects(workspaceId, viewerId)).map((project) => project.id);
  const inProjects = projectIds.length
    ? sql`i.project_id IN (${sql.join(projectIds.map((id) => sql`${id}`), sql`, `)})`
    : sql`0`;
    const scope = sql`search_fts.workspace_id = ${workspaceId} AND ${where}`;
  const readablePage = sql`p.deleted_at IS NULL AND (p.shared = 1 OR p.created_by = ${viewerId})`;
  const readableIssue = sql`i.deleted_at IS NULL AND ${inProjects}`;

  const run = (body: ReturnType<typeof sql>) => db.all<Row>(body);

  const docs = run(sql`
    SELECT p.id, p.id AS open_id, p.title, NULL AS project_name, NULL AS number, NULL AS identifier,
           p.doc AS body, p.updated_at
    FROM search_fts JOIN pages p ON p.id = search_fts.ref_id
    WHERE search_fts.kind = 'doc' AND ${scope} AND ${readablePage}
    ORDER BY ${order} LIMIT ${PER_KIND}`);
  const tasks = run(sql`
    SELECT i.id, i.id AS open_id, i.title, pr.name AS project_name, i.number, i.identifier,
           i.description AS body, i.updated_at
    FROM search_fts JOIN issues i ON i.id = search_fts.ref_id LEFT JOIN projects pr ON pr.id = i.project_id
    WHERE search_fts.kind = 'task' AND ${scope} AND ${readableIssue}
    ORDER BY ${order} LIMIT ${PER_KIND}`);
  const taskComments = run(sql`
    SELECT c.id, i.id AS open_id, i.title, pr.name AS project_name, i.number, i.identifier,
           c.body, c.created_at AS updated_at
    FROM search_fts JOIN comments c ON c.id = search_fts.ref_id JOIN issues i ON i.id = c.issue_id
    LEFT JOIN projects pr ON pr.id = i.project_id
    WHERE search_fts.kind = 'task_comment' AND ${scope} AND ${readableIssue}
    ORDER BY ${order} LIMIT ${PER_KIND}`);
  const docComments = run(sql`
    SELECT c.id, p.id AS open_id, p.title, NULL AS project_name, NULL AS number, NULL AS identifier,
           c.body, c.created_at AS updated_at
    FROM search_fts JOIN page_comments c ON c.id = search_fts.ref_id JOIN pages p ON p.id = c.page_id
    WHERE search_fts.kind = 'doc_comment' AND c.deleted_at IS NULL AND ${scope} AND ${readablePage}
    ORDER BY ${order} LIMIT ${PER_KIND}`);

  const hit = (kind: SearchHit["kind"]) => (row: Row): SearchHit => ({
    kind,
    id: row.id,
    openId: row.open_id,
    title: row.title,
    ref: row.identifier ? issueRef({ projectName: row.project_name, number: row.number, identifier: row.identifier }) : null,
    snippet: snippetOf(row.body, words),
    updatedAt: row.updated_at,
  });
  return [
    ...docs.map(hit("doc")),
    ...tasks.map(hit("task")),
    ...taskComments.map(hit("task_comment")),
    ...docComments.map(hit("doc_comment")),
  ];
}
