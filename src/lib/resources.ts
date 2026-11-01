import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { projectResources } from "../db/schema";
import { TacosError, getOverviewAccess, nowIso } from "./issues";
import { getPage, listPages } from "./pages";

export type ResourceKind = "doc" | "link";

export type ProjectResource = {
  id: string;
  kind: ResourceKind;
  // For a document this is the page's current title; for a link, the label to show.
  title: string;
  url: string | null;
  pageId: string | null;
  icon: string | null;
  createdBy: string;
  createdAt: string;
};

const MAX_RESOURCES = 30;

// Attaching and detaching follow the same rule as editing the Overview: the project
// owner, a workspace admin, or somebody granted "edit" on this overview.
async function requireEditor(workspaceId: string, projectId: string, viewerId: string) {
  const access = await getOverviewAccess(workspaceId, projectId, viewerId);
  if (!access.canView) throw new TacosError("Project not found", 404);
  if (!access.canEdit) throw new TacosError("You cannot change this project's resources", 403);
}

export async function listProjectResources(
  workspaceId: string,
  projectId: string,
  viewerId: string
): Promise<ProjectResource[]> {
  const rows = await getDb()
    .select()
    .from(projectResources)
    .where(eq(projectResources.projectId, projectId))
    .orderBy(projectResources.createdAt);
  if (rows.length === 0) return [];
  // listPages already hides pages the viewer may not read, so a private document
  // attached by somebody else simply does not appear in this viewer's row.
  const pagesById = new Map((await listPages(workspaceId, viewerId)).map((page) => [page.id, page]));
  const out: ProjectResource[] = [];
  for (const row of rows) {
    if (row.kind === "doc") {
      const page = row.pageId ? pagesById.get(row.pageId) : undefined;
      if (!page) continue;
      out.push({
        id: row.id,
        kind: "doc",
        title: page.title,
        url: null,
        pageId: page.id,
        icon: page.icon,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
      });
      continue;
    }
    out.push({
      id: row.id,
      kind: "link",
      title: row.title,
      url: row.url,
      pageId: null,
      icon: null,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    });
  }
  return out;
}

// "github.com/foo" becomes https://github.com/foo; anything that is not a web page is
// rejected here rather than stored as a broken resource.
export function normalizeLink(raw: string): { url: string; title: string } {
  const value = raw.trim();
  if (!value) throw new TacosError("Paste a link");
  if (value.length > 2_048) throw new TacosError("That link is too long");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new TacosError("That does not look like a link");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new TacosError("Only http and https links are supported");
  }
  // A readable fallback label: the site, plus the path when there is one.
  const host = parsed.hostname.replace(/^www\./i, "");
  const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
  return { url: parsed.toString(), title: `${host}${path}`.slice(0, 80) };
}

function toResource(
  row: typeof projectResources.$inferSelect,
  doc?: { title: string; icon: string | null }
): ProjectResource {
  return {
    id: row.id,
    kind: row.kind === "doc" ? "doc" : "link",
    title: doc?.title ?? row.title,
    url: row.url,
    pageId: row.pageId,
    icon: doc?.icon ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export async function addProjectLink(
  workspaceId: string,
  projectId: string,
  viewerId: string,
  input: { url: string; title?: string }
): Promise<ProjectResource> {
  await requireEditor(workspaceId, projectId, viewerId);
  const link = normalizeLink(input.url);
  const db = getDb();
  const existing = await db
    .select()
    .from(projectResources)
    .where(eq(projectResources.projectId, projectId));
  if (existing.length >= MAX_RESOURCES) {
    throw new TacosError(`A project can hold at most ${MAX_RESOURCES} resources`);
  }
  if (existing.some((row) => row.kind === "link" && row.url === link.url)) {
    throw new TacosError("That link is already attached");
  }
  const id = crypto.randomUUID();
  const at = nowIso();
  const title = (input.title ?? "").trim().slice(0, 80) || link.title;
  const record = {
    id,
    projectId,
    kind: "link",
    title,
    url: link.url,
    pageId: null,
    createdBy: viewerId,
    createdAt: at,
  };
  await db.insert(projectResources).values(record);
  return toResource(record);
}

export async function addProjectDoc(
  workspaceId: string,
  projectId: string,
  viewerId: string,
  pageId: string
): Promise<ProjectResource> {
  await requireEditor(workspaceId, projectId, viewerId);
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Document not found", 404);
  const db = getDb();
  const existing = await db
    .select()
    .from(projectResources)
    .where(eq(projectResources.projectId, projectId));
  if (existing.length >= MAX_RESOURCES) {
    throw new TacosError(`A project can hold at most ${MAX_RESOURCES} resources`);
  }
  if (existing.some((row) => row.kind === "doc" && row.pageId === pageId)) {
    throw new TacosError("That document is already attached");
  }
  const id = crypto.randomUUID();
  const at = nowIso();
  const record = {
    id,
    projectId,
    kind: "doc",
    title: page.title,
    url: null,
    pageId,
    createdBy: viewerId,
    createdAt: at,
  };
  await db.insert(projectResources).values(record);
  return toResource(record, { title: page.title, icon: page.icon });
}

export async function removeProjectResource(
  workspaceId: string,
  projectId: string,
  resourceId: string,
  viewerId: string
): Promise<void> {
  await requireEditor(workspaceId, projectId, viewerId);
  const db = getDb();
  const [row] = await db
    .select({ id: projectResources.id })
    .from(projectResources)
    .where(and(eq(projectResources.id, resourceId), eq(projectResources.projectId, projectId)))
    .limit(1);
  if (!row) throw new TacosError("Resource not found", 404);
  await db.delete(projectResources).where(eq(projectResources.id, resourceId));
}
