import { packText,unpackText } from "./compressed-text";
import crypto from "node:crypto";
import { and, sql, getTableColumns, desc, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { getDb } from "../db/client";
import { pageAccess, pageCollab, pageComments, pageFavorites, pageVersions, pages, users } from "../db/schema";
import { attachmentImageType, getAttachment, removePageAttachments } from "./attachments";
import { collabDocWritten, withStoredCollabPage, collabAccessChanged } from "./collab/live";
import { isPageLevel, levelAllows, type PageLevel } from "./page-level";
import { TacosError, getProject, listMembers, notify, nowIso } from "./issues";
import { DOC_UPDATE_MERGE_MS } from "./doc-update-groups";
import { parseDocMentions } from "./mentions";
import { pageLinkTargets, replacePageLinks } from "./page-links";
import { emitAutomationEvent } from "./automations/dispatch";

export type DocPage = {
  id: string;
  workspaceId: string;
  parentId: string | null;
  projectId: string | null;
  title: string;
  icon: string | null;
  doc: string;
  createdBy: string;
  shared: boolean;
  revision: number;
  cover: string | null;
  position: number;
  shareLevel: string;
  // Where the page started, kept for history. Null for a blank page.
  templateId: string | null;
  templateName: string | null;
  createdAt: string;
  updatedAt: string;
};

// What the sidebar and the child-page list need; the body is left in the database.
export type PageSummary = Omit<DocPage, "doc" | "workspaceId" | "revision" | "shareLevel" | "position" | "cover"> & { depth: number; canEdit?: boolean };

export type PageMetadata = Omit<DocPage, "doc"> & { canEdit?: boolean };

export type PageRef = { id: string; title: string; icon: string | null;path?:string };

// The one identity a shared page shows its reader: who wrote it.
export type PageAuthor = { id: string; displayName: string; avatar: string | null };

type PageRow = typeof pages.$inferSelect;

function toPage({ deletedAt: _deletedAt, trashRoot: _trashRoot, ...row }: PageRow): DocPage {
  return { ...row, shared: row.shared === 1 };
}

// A page is readable by its author or, once shared, by the whole workspace. Every
// caller has already proved workspace membership, so "shared" needs no further check.
export function pageVisible(page: DocPage, viewerId: string): boolean {
  return page.shared || page.createdBy === viewerId;
}

async function findPage(workspaceId: string, pageId: string): Promise<DocPage | null> {
  const [row] = await getDb()
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), eq(pages.id, pageId), isNull(pages.deletedAt)))
    .limit(1);
  return row ? toPage(row) : null;
}

export async function listPages(workspaceId: string, viewerId: string): Promise<DocPage[]> {
  const rows = await getDb()
    .select()
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        isNull(pages.deletedAt),
        or(eq(pages.shared, 1), eq(pages.createdBy, viewerId))
      )
    )
    .orderBy(pages.position, pages.createdAt);
  return rows.map(toPage);
}

const { doc: _bodyColumn, ...metadataColumns } = getTableColumns(pages);
export async function listPageMetadata(workspaceId: string, viewerId: string, filter: {parentId?: string;projectId?: string;id?: string} = {}): Promise<PageMetadata[]> {
  const conditions=[eq(pages.workspaceId,workspaceId),isNull(pages.deletedAt),or(eq(pages.shared,1),eq(pages.createdBy,viewerId))];
  if (filter.parentId) conditions.push(eq(pages.parentId,filter.parentId));
  if (filter.projectId) conditions.push(eq(pages.projectId,filter.projectId));
  if (filter.id) conditions.push(eq(pages.id,filter.id));
  const rows=await getDb().select({...metadataColumns,override:pageAccess.level}).from(pages)
    .leftJoin(pageAccess,and(eq(pageAccess.pageId,pages.id),eq(pageAccess.userId,viewerId)))
    .where(and(...conditions)).orderBy(pages.position,pages.createdAt);
  return rows.map(({deletedAt:_deleted,trashRoot:_trash,override,...row})=>({...row,shared:row.shared===1,canEdit:row.createdBy===viewerId||(override??row.shareLevel)==="edit"}));
}

// Iterative traversal preserves true hierarchy without quadratic parent searches or stack overflow.
export function pageTree(items: PageMetadata[]): PageSummary[] {
  const ids=new Set(items.map(page=>page.id));
  const byParent=new Map<string|null,PageMetadata[]>();
  for(const page of items){const parent=page.parentId&&ids.has(page.parentId)?page.parentId:null;const bucket=byParent.get(parent)??[];bucket.push(page);byParent.set(parent,bucket);}
  const out:PageSummary[]=[],seen=new Set<string>();
  const stack=(byParent.get(null)??[]).map(page=>({page,depth:0})).reverse();
  while(stack.length){const {page,depth}=stack.pop()!;if(seen.has(page.id))continue;seen.add(page.id);
    const {doc:_doc,workspaceId:_ws,revision:_revision,shareLevel:_level,position:_position,cover:_cover,...summary}=page as PageMetadata & {doc?:string};
    out.push({...summary,depth});
    const children=byParent.get(page.id)??[];for(let i=children.length-1;i>=0;i--)stack.push({page:children[i],depth:depth+1});
  }
  return out;
}
export async function listPageTree(workspaceId: string, viewerId: string): Promise<PageSummary[]> {
  return pageTree(await listPageMetadata(workspaceId,viewerId));
}

function filterPageQuery(items: PageMetadata[], q?: string): PageMetadata[] {
  const needle = q?.trim().toLowerCase();
  return needle ? items.filter((page) => page.title.toLowerCase().includes(needle)) : items;
}

function newestPageFirst(items: PageMetadata[]): PageMetadata[] {
  return [...items].sort(
    (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)
  );
}

function pageSummary(page: PageMetadata): PageSummary {
  const {
    workspaceId: _workspaceId,
    revision: _revision,
    shareLevel: _shareLevel,
    position: _position,
    cover: _cover,
    ...summary
  } = page;
  return { ...summary, depth: 0 };
}

/** Visible pages without bodies, newest edit first; the REST and MCP list order. */
export async function listPageSummaries(
  workspaceId: string,
  viewerId: string,
  filter: { parentId?: string; projectId?: string; q?: string } = {}
): Promise<PageSummary[]> {
  const pages = await listPageMetadata(workspaceId, viewerId, filter);
  return newestPageFirst(filterPageQuery(pages, filter.q)).map(pageSummary);
}

/**
 * The stdio MCP server runs under the machine account and holds the database itself,
 * so it reads every page, exactly like its issue tools skip per-user visibility.
 */
export async function listAllPageSummaries(
  workspaceId: string,
  filter: { parentId?: string; projectId?: string; q?: string } = {}
): Promise<PageSummary[]> {
  const conditions = [eq(pages.workspaceId, workspaceId), isNull(pages.deletedAt)];
  if (filter.parentId) conditions.push(eq(pages.parentId, filter.parentId));
  if (filter.projectId) conditions.push(eq(pages.projectId, filter.projectId));
  const rows = await getDb()
    .select(metadataColumns)
    .from(pages)
    .where(and(...conditions))
    .orderBy(pages.position, pages.createdAt);
  const items = rows.map(({ deletedAt: _deleted, trashRoot: _trash, ...row }) => ({
    ...row,
    shared: row.shared === 1,
  }));
  return newestPageFirst(filterPageQuery(items, filter.q)).map(pageSummary);
}

export async function getPage(
  workspaceId: string,
  pageId: string,
  viewerId: string
): Promise<DocPage | null> {
  const page = await findPage(workspaceId, pageId);
  if (!page || !pageVisible(page, viewerId)) return null;
  return page;
}

/** Trusted local (stdio) read; the caller already holds the database. */
export async function getPageUnfiltered(
  workspaceId: string,
  pageId: string
): Promise<DocPage | null> {
  return findPage(workspaceId, pageId);
}

// Who wrote the page, for the "Created by" line under a document's title. Read from
// users rather than workspace_members: a page outlives its author's membership.
export async function pageAuthor(userId: string): Promise<PageAuthor | null> {
  const [row] = await getDb()
    .select({ id: users.id, displayName: users.displayName, avatar: users.avatar })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function listChildPages(
  workspaceId: string,
  parentId: string,
  viewerId: string
): Promise<PageSummary[]> {
  return pageTree(await listPageMetadata(workspaceId,viewerId,{parentId})).map(page=>({...page,depth:0}));
}
export async function listProjectPageTree(workspaceId: string,projectId: string,viewerId: string): Promise<PageSummary[]> {
  return pageTree(await listPageMetadata(workspaceId,viewerId,{projectId}));
}

export async function createPage(
  workspaceId: string,
  viewerId: string,
  input: {
    parentId?: string | null;
    projectId?: string | null;
    title?: string;
    doc?: string;
    // Where the starting text came from; recorded on the page and its first version.
    template?: { id: string; name: string };
  } = {},
  // The caller's attribution for the first version, e.g. `api:<key name>` or `mcp`.
  // The UI leaves it unset, so a page written there keeps the lazy "earlier" version.
  options: { via?: string } = {}
): Promise<DocPage> {
  const db = getDb();
  const parentId: string | null = input.parentId ?? null;
  assertDocSize(input.doc ?? "");
  let projectId: string | null = input.projectId ?? null;
  let inherit: DocPage | null = null;
  if (parentId) {
    const parent = await getPage(workspaceId, parentId, viewerId);
    if (!parent) throw new TacosError("Parent page not found", 404);
    if (!levelAllows(await pageLevel(parent, viewerId), "edit")) {
      throw new TacosError("You cannot edit this page", 403);
    }
    inherit = parent;
    // Subpages live wherever their parent lives; a project doc's children are project docs.
    if (projectId === null) projectId = parent.projectId;
  }
  if (projectId && !(await getProject(workspaceId, projectId))) {
    throw new TacosError("Project not found", 404);
  }
  let title = (input.title ?? "").trim().slice(0, 120) || "Untitled";
  // A trailing number keeps "Untitled" pages distinguishable when several are created
  // in a row — [[Untitled]] would otherwise always open the oldest one.
  if (title === "Untitled") {
    const existing = new Set(
      (await listPageMetadata(workspaceId, viewerId)).map((page) => page.title.toLowerCase())
    );
    let n = 2;
    while (existing.has(title.toLowerCase())) title = `Untitled ${n++}`;
  }
  const id = crypto.randomUUID();
  const at = nowIso();
  const [last] = await db
    .select({ position: pages.position })
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), siblingsOf(parentId)))
    .orderBy(desc(pages.position))
    .limit(1);
  await db.insert(pages).values({
    id,
    workspaceId,
    parentId,
    position: (last?.position ?? 0) + POSITION_STEP,
    projectId,
    title,
    icon: null,
    doc: input.doc ?? "",
    createdBy: viewerId,
    // A subpage has its parent's sharing, so a shared tree never hides a branch.
    shared: inherit?.shared ? 1 : 0,
    revision: 0,
    shareLevel: inherit?.shareLevel ?? "edit",
    templateId: input.template?.id ?? null,
    templateName: input.template?.name ?? null,
    createdAt: at,
    updatedAt: at,
  });
  if (inherit?.shared) {
    const people = await db.select().from(pageAccess).where(eq(pageAccess.pageId, inherit.id));
    if (people.length) {
      await db.insert(pageAccess).values(people.map((person) => ({ ...person, pageId: id })));
    }
  }
  const created = await findPage(workspaceId, id);
  if (!created) throw new TacosError("Page not found", 404);
  if (input.template || options.via) {
    recordVersion(
      created,
      {
        title: created.title,
        doc: created.doc,
        actorId: viewerId,
        via: options.via ?? "you",
        reason: input.template ? "template" : "edit",
        templateName: input.template?.name,
      },
      { skipEarlier: true }
    );
  }
  if (created.doc.includes("[[")) await refreshPageLinks(workspaceId, viewerId, created);
  return created;
}

const MARKDOWN_FILE = /\.(md|markdown|mdx|txt)$/i;

/** Folder segments plus the file's stem: `notes/guide/intro.md` → ["notes", "guide", "intro"]. */
export function importSegments(path: string): string[] {
  const parts = path
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part && part !== "." && part !== "..");
  const stem = (parts.pop() ?? "Untitled").replace(MARKDOWN_FILE, "");
  return [...parts, stem || "Untitled"].map((part) => part.slice(0, 120));
}

/** An imported file names its page from its own H1; that heading leaves the body. */
export function splitImportedMarkdown(stem: string, content: string): { title: string; doc: string } {
  const text = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  let first = 0;
  while (first < lines.length && lines[first].trim() === "") first += 1;
  const heading = /^#\s+(.+?)\s*#*$/.exec(lines[first] ?? "");
  if (!heading) return { title: stem, doc: text };
  let body = first + 1;
  while (body < lines.length && lines[body].trim() === "") body += 1;
  return { title: heading[1].trim().slice(0, 120) || stem, doc: lines.slice(body).join("\n") };
}

async function siblingPage(
  workspaceId: string,
  viewerId: string,
  parentId: string | null,
  title: string
): Promise<DocPage | null> {
  const rows=await getDb().select().from(pages).where(and(eq(pages.workspaceId,workspaceId),
    isNull(pages.deletedAt),siblingsOf(parentId),or(eq(pages.shared,1),eq(pages.createdBy,viewerId)),
    sql`1`)).orderBy(pages.position,pages.createdAt);
  const row=rows.find(row=>row.title.toLowerCase()===title.toLowerCase());
  return row?toPage(row):null;
}

export type ImportedPage = { id: string; title: string; created: boolean };

// A reference table imported from a research folder is a legitimate one-megabyte-ish
// document, so the cap only stops a runaway body — it must not decide what can be read.
// The server-action body limit in next.config.ts has to stay above it.
export const MAX_DOC_CHARS = 1_000_000;

function assertDocSize(doc: string): void {
  if (doc.length > MAX_DOC_CHARS)
    throw new TacosError(`Document is too long (${MAX_DOC_CHARS / 1_000_000}M characters max)`);
}

/**
 * One Markdown file per call: a server action's request body is capped, and a folder
 * import can be much larger. A page that already exists is left untouched rather than
 * overwritten — a repeated import reports it as skipped.
 */
export async function importMarkdownPage(
  workspaceId: string,
  viewerId: string,
  input: { path: string; content?: string; parsed?:{title:string;doc:string} }
): Promise<ImportedPage> {
  const segments = importSegments(input.path);
  const stem = segments.pop() ?? "Untitled";
  const { title, doc } = input.parsed??splitImportedMarkdown(stem, input.content??"");
  if(typeof title!=="string"||!title.trim()||title.length>120||typeof doc!=="string")throw new TacosError("Invalid imported document",400);
  assertDocSize(doc);

  let parentId: string | null = null;
  for (const folder of segments) {
    const existing = await siblingPage(workspaceId, viewerId, parentId, folder);
    parentId = existing?.id ?? (await createPage(workspaceId, viewerId, { parentId, title: folder })).id;
  }

  const existing = await siblingPage(workspaceId, viewerId, parentId, title);
  if (existing) return { id: existing.id, title: existing.title, created: false };
  const page = await createPage(workspaceId, viewerId, { parentId, title, doc });
  return { id: page.id, title: page.title, created: true };
}

const POSITION_STEP = 1000;

export async function setPageCover(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  attachmentId: string | null
): Promise<void> {
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Page not found", 404);
  await requirePageLevel(page, viewerId, "edit");
  if (attachmentId) {
    const row = await getAttachment(attachmentId);
    if (!row || !row.complete || row.pageId !== pageId) throw new TacosError("File not found", 404);
    if (!attachmentImageType(attachmentId)) throw new TacosError("A cover has to be an image", 400);
  }
  await getDb().update(pages).set({ cover: attachmentId }).where(eq(pages.id, pageId));
}

function siblingsOf(parentId: string | null) {
  return parentId ? eq(pages.parentId, parentId) : isNull(pages.parentId);
}

/**
 * Moves a page, with its subtree, under a new parent or to the top level, before beforeId or at
 * the end. A page under a parent has the parent's sharing, so a move that changes who can see a
 * page takes its owner; `shared` asks for that at the top level.
 */
export type PageMoveTarget = { parentId: string | null; beforeId?: string | null; shared?: boolean; projectId?: string | null; confirmedImpact?: string };
function moveVersion(workspaceId: string): string {
  const db=getDb();
  const versions=db.all<{domain:string;revision:number}>(sql`SELECT domain,revision FROM workspace_revisions WHERE workspace_id=${workspaceId} AND domain IN ('documents','permissions','projects') ORDER BY domain`);
  return crypto.createHash("sha256").update(JSON.stringify(versions)).digest("hex");
}
async function preparePageMove(workspaceId:string,pageId:string,viewerId:string,target:PageMoveTarget) {
  const db=getDb(),page=await getPage(workspaceId,pageId,viewerId);
  if(!page)throw new TacosError("Document not found",404);
  await requirePageLevel(page,viewerId,"edit");
  const descendants=await descendantsOf(workspaceId,pageId);
  const visible=new Map((await listPageMetadata(workspaceId,viewerId)).map(child=>[child.id,child]));
  for(const child of descendants) {
    const readable=visible.get(child.id);
    if(!readable)throw new TacosError("You cannot move every document in this subtree",403);
    if(!readable.canEdit)throw new TacosError("You cannot edit this page",403);
  }
  const ids=[pageId,...descendants.map((child)=>child.id)];
  const parent=target.parentId?await getPage(workspaceId,target.parentId,viewerId):null;
  if(target.parentId&&!parent)throw new TacosError("Parent page not found",404);
  if(parent){if(ids.includes(parent.id))throw new TacosError("A page cannot move inside itself",400);await requirePageLevel(parent,viewerId,"edit");}
  const projectId=parent?parent.projectId:target.projectId===undefined?page.projectId:target.projectId;
  if(projectId&&!(await getProject(workspaceId,projectId)))throw new TacosError("Project not found",404);
  const shared=parent?parent.shared:target.shared ?? page.shared;
  const people=parent?db.select().from(pageAccess).where(eq(pageAccess.pageId,parent.id)).all():[];
  const oldPeople=db.select().from(pageAccess).where(eq(pageAccess.pageId,pageId)).all();
  const key=(members:typeof people)=>JSON.stringify(members.map((p)=>[p.userId,p.level]).sort());
  const sharingChanged=shared!==page.shared||!!parent&&(parent.shareLevel!==page.shareLevel||key(people)!==key(oldPeople));
  if(sharingChanged&&page.createdBy!==viewerId)throw new TacosError("Only the page owner can change sharing",403);
  const impact={token:moveVersion(workspaceId),requiresConfirmation:sharingChanged||projectId!==page.projectId,descendantCount:descendants.length,shared,level:parent?.shareLevel??page.shareLevel,projectId,sharingChanged};
  return {page,parent,ids,people,impact};
}
export async function previewPageMove(workspaceId:string,pageId:string,viewerId:string,target:PageMoveTarget) {
  return (await preparePageMove(workspaceId,pageId,viewerId,target)).impact;
}
export async function movePage(workspaceId:string,pageId:string,viewerId:string,target:PageMoveTarget):Promise<void> {
  const {page,parent,ids,people,impact}=await preparePageMove(workspaceId,pageId,viewerId,target);
  if(impact.requiresConfirmation&&target.confirmedImpact!==impact.token)throw new TacosError("Review who can access the moved documents before continuing",409);
  getDb().transaction((tx)=>{
    if(moveVersion(workspaceId)!==impact.token)throw new TacosError("The document tree changed. Review the move again.",409);
    applyPageMove(tx,workspaceId,pageId,target,{page,parent,ids,people,impact});
  });
  if(impact.sharingChanged)collabAccessChanged(ids);
}

function applyPageMove(tx:Pick<ReturnType<typeof getDb>,"select"|"insert"|"update"|"delete">,workspaceId:string,pageId:string,target:PageMoveTarget,prepared:Awaited<ReturnType<typeof preparePageMove>>) {
 const {parent,ids,people,impact}=prepared;
    const siblings=tx.select({id:pages.id}).from(pages).where(and(eq(pages.workspaceId,workspaceId),siblingsOf(parent?.id??null),isNull(pages.deletedAt))).orderBy(pages.position,pages.createdAt).all().map((row)=>row.id).filter((id)=>id!==pageId);
    const before=target.beforeId?siblings.indexOf(target.beforeId):-1;
    if(target.beforeId&&before<0)throw new TacosError("The destination changed. Choose it again.",409);
    siblings.splice(before<0?siblings.length:before,0,pageId);
    for(const [index,id]of siblings.entries())tx.update(pages).set({position:(index+1)*POSITION_STEP}).where(eq(pages.id,id)).run();
    tx.update(pages).set({parentId:parent?.id??null}).where(eq(pages.id,pageId)).run();
    tx.update(pages).set({projectId:impact.projectId,...(impact.sharingChanged?{shared:impact.shared?1:0,shareLevel:impact.level}:{})}).where(and(eq(pages.workspaceId,workspaceId),inArray(pages.id,ids))).run();
    if(impact.sharingChanged&&parent){
      tx.delete(pageAccess).where(inArray(pageAccess.pageId,ids)).run();
      if(people.length)tx.insert(pageAccess).values(ids.flatMap((id)=>people.map((person)=>({...person,pageId:id})))).run();
    }
}
/** A batch is reviewed against one tree snapshot and committed in one transaction. */
export async function movePages(workspaceId:string,viewerId:string,pageIds:string[],target:PageMoveTarget,tokens:Record<string,string>) {
 const prepared=[];for(const id of pageIds)prepared.push({id,plan:await preparePageMove(workspaceId,id,viewerId,target)});
 const selected=new Set(pageIds),covered=new Set<string>();
 for(const item of prepared)for(const child of item.plan.ids)if(child!==item.id&&selected.has(child))covered.add(child);
 const roots=prepared.filter(item=>!covered.has(item.id));
 if(target.parentId&&prepared.some(item=>item.plan.ids.includes(target.parentId!)))throw new TacosError("Choose a destination outside the selected documents",400);
 const snapshot=moveVersion(workspaceId);
 for(const item of prepared)if(!tokens[item.id]||tokens[item.id]!==item.plan.impact.token||tokens[item.id]!==snapshot)throw new TacosError("The document tree changed. Review the move again.",409);
 getDb().transaction(tx=>{if(moveVersion(workspaceId)!==snapshot)throw new TacosError("The document tree changed. Review the move again.",409);for(const item of roots)applyPageMove(tx,workspaceId,item.id,target,item.plan);});
 for(const item of roots)if(item.plan.impact.sharingChanged)collabAccessChanged(item.plan.ids);
}

/** The page's parents, top first, as far up as this person may read. */
export async function pageAncestors(workspaceId: string, page: DocPage, viewerId: string): Promise<PageRef[]> {
  const out: PageRef[] = [];
  const seen = new Set([page.id]);
  let at = page.parentId;
  while (at && !seen.has(at)) {
    seen.add(at);
    const parent = await getPage(workspaceId, at, viewerId);
    if (!parent) break;
    out.unshift({ id: parent.id, title: parent.title, icon: parent.icon });
    at = parent.parentId;
  }
  return out;
}

export async function listFavoritePages(workspaceId: string, viewerId: string): Promise<PageRef[]> {
  return getDb()
    .select({ id: pages.id, title: pages.title, icon: pages.icon })
    .from(pageFavorites)
    .innerJoin(pages, eq(pages.id, pageFavorites.pageId))
    .where(
      and(
        eq(pageFavorites.userId, viewerId),
        eq(pages.workspaceId, workspaceId),
        isNull(pages.deletedAt),
        or(eq(pages.shared, 1), eq(pages.createdBy, viewerId))
      )
    )
    .orderBy(pageFavorites.position,pageFavorites.createdAt);
}

export async function isPageFavorite(pageId: string, viewerId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ pageId: pageFavorites.pageId })
    .from(pageFavorites)
    .where(and(eq(pageFavorites.userId, viewerId), eq(pageFavorites.pageId, pageId)))
    .limit(1);
  return Boolean(row);
}

export async function togglePageFavorite(workspaceId: string, pageId: string, viewerId: string): Promise<boolean> {
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Page not found", 404);
  const db = getDb();
  if (await isPageFavorite(pageId, viewerId)) {
    await db.delete(pageFavorites).where(and(eq(pageFavorites.userId, viewerId), eq(pageFavorites.pageId, pageId)));
    return false;
  }
  await db.insert(pageFavorites).values({ userId: viewerId, pageId, createdAt: nowIso() });
  return true;
}

/** What this person may do: the author everything, others by the page's sharing. */
export async function pageLevel(page: DocPage, viewerId: string): Promise<PageLevel | null> {
  if (page.createdBy === viewerId) return "edit";
  if (!page.shared) return null;
  const [row] = await getDb()
    .select({ level: pageAccess.level })
    .from(pageAccess)
    .where(and(eq(pageAccess.pageId, page.id), eq(pageAccess.userId, viewerId)))
    .limit(1);
  const level = row?.level ?? page.shareLevel;
  return isPageLevel(level) ? level : "view";
}

export async function requirePageLevel(page: DocPage, viewerId: string, needed: PageLevel): Promise<void> {
  if (levelAllows(await pageLevel(page, viewerId), needed)) return;
  throw new TacosError(needed === "edit" ? "You cannot edit this page" : "You cannot comment on this page", 403);
}

async function ownedSubtree(workspaceId: string, pageId: string, viewerId: string): Promise<string[]> {
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Page not found", 404);
  if (page.createdBy !== viewerId) throw new TacosError("Only the page owner can change sharing", 403);
  return [pageId, ...(await descendantsOf(workspaceId, pageId)).map((p) => p.id)];
}

export async function listPageAccess(
  workspaceId: string,
  pageId: string,
  viewerId: string
): Promise<{ level: PageLevel; people: Record<string, PageLevel> }> {
  await ownedSubtree(workspaceId, pageId, viewerId);
  const page = await getPage(workspaceId, pageId, viewerId);
  const rows = await getDb().select().from(pageAccess).where(eq(pageAccess.pageId, pageId));
  const people: Record<string, PageLevel> = {};
  for (const row of rows) if (isPageLevel(row.level)) people[row.userId] = row.level;
  return { level: page && isPageLevel(page.shareLevel) ? page.shareLevel : "view", people };
}

/** Like sharing itself, a level covers the page's whole subtree. */
export async function setPageShareLevel(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  level: PageLevel
): Promise<void> {
  const ids = await ownedSubtree(workspaceId, pageId, viewerId);
  await getDb()
    .update(pages)
    .set({ shareLevel: level })
    .where(and(eq(pages.workspaceId, workspaceId), inArray(pages.id, ids)));
  collabAccessChanged(ids);
}

/** A null level puts the person back on the page's shareLevel. */
export async function setPageMemberLevel(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  userId: string,
  level: PageLevel | null
): Promise<void> {
  const ids = await ownedSubtree(workspaceId, pageId, viewerId);
  const db = getDb();
  await db.delete(pageAccess).where(and(inArray(pageAccess.pageId, ids), eq(pageAccess.userId, userId)));
  if (level) await db.insert(pageAccess).values(ids.map((id) => ({ pageId: id, userId, level })));
  collabAccessChanged(ids);
}

// Edits by the same person within DOC_UPDATE_MERGE_MS are one version, so typing does not
// fill the Updates panel. Edits by several people in that window stay separate versions
// and collapse into one panel entry. An Agent's edits stay separate so each one can be
// undone by itself.
const MAX_VERSIONS_PER_PAGE = 200;

type VersionWrite = {
  title: string;
  doc: string;
  actorId: string;
  via: string;
  reason: "edit" | "template" | "restore" | "undo" | "unsaved";
  restoredFrom?: number;
  // Set on the first version of a page created from a template.
  templateName?: string;
};

async function latestVersion(pageId: string) {
  const [row] = await getDb()
    .select()
    .from(pageVersions)
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.seq))
    .limit(1);
  return row ?? null;
}

function recordVersion(
  page: DocPage,
  write: VersionWrite,
  options: { skipEarlier?: boolean } = {}
): void {
  const db = getDb();
  const at = nowIso();
  const packed={text:write.doc,compressed:null};
  let latest = db.select().from(pageVersions).where(eq(pageVersions.pageId,page.id)).orderBy(desc(pageVersions.seq)).get() ?? null;
  if (!latest && page.doc && !options.skipEarlier) {
    // A page written before versions existed, or created with text: keep that text.
    db.insert(pageVersions).values({
      id: crypto.randomUUID(),
      pageId: page.id,
      workspaceId: page.workspaceId,
      seq: 1,
      title: page.title,
      doc: page.doc,
      actorId: page.createdBy,
      via: "you",
      reason: "earlier",
      createdAt: page.updatedAt,
      updatedAt: page.updatedAt,
    }).run();
    latest = db.select().from(pageVersions).where(eq(pageVersions.pageId,page.id)).orderBy(desc(pageVersions.seq)).get() ?? null;
  }
  if (
    latest &&
    write.reason === "edit" &&
    write.via === "you" &&
    latest.reason === "edit" &&
    latest.via === "you" &&
    latest.actorId === write.actorId &&
    Date.now() - Date.parse(latest.createdAt) < DOC_UPDATE_MERGE_MS
  ) {
    db
      .update(pageVersions)
      .set({ title: write.title, doc: packed.text,docCompressed:packed.compressed, updatedAt: at })
      .where(eq(pageVersions.id, latest.id)).run();
    return;
  }
  const seq = (latest?.seq ?? 0) + 1;
  db.insert(pageVersions).values({
    id: crypto.randomUUID(),
    pageId: page.id,
    workspaceId: page.workspaceId,
    seq,
    title: write.title,
    doc: packed.text,docCompressed:packed.compressed,
    actorId: write.actorId,
    via: write.via,
    reason: write.reason,
    restoredFrom: write.restoredFrom ?? null,
    templateName: write.templateName ?? null,
    createdAt: at,
    updatedAt: at,
  }).run();
  db
    .delete(pageVersions)
    .where(and(eq(pageVersions.pageId, page.id), lt(pageVersions.seq, seq - MAX_VERSIONS_PER_PAGE + 1))).run();
}

// One notice to each member newly mentioned in the text who can read the page, including
// a self @. A save that keeps an old mention does not send it again.
async function notifyDocMentions(page: DocPage, doc: string, authorId: string): Promise<void> {
  const before = new Set(parseDocMentions(page.doc));
  const added = parseDocMentions(doc).filter((name) => !before.has(name));
  if (added.length === 0) return;
  const members = await listMembers(page.workspaceId);
  const who = members.find((member) => member.id === authorId)?.displayName ?? "";
  for (const member of members) {
    if (!added.includes(member.username.toLowerCase())) continue;
    if (!pageVisible(page, member.id)) continue;
    await notify({
      workspaceId: page.workspaceId,
      userId: member.id,
      issueId: "",
      pageId: page.id,
      type: "doc_mentioned",
      body: who,
      data: { actorName: who },
    });
  }
}

/** Someone else changed the body after this save's text was loaded. */
export const PAGE_CONFLICT = "This document changed while you were editing it";

// A document save can land every few seconds while someone types. A document.updated
// rule runs at most once per page in this window; the run's idempotency key carries it.
const DOCUMENT_EVENT_WINDOW_MS = 5 * 60_000;

export async function updatePage(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  patch: { title?: string; doc?: string; icon?: string | null; baseRevision?: number },
  options: { via?: string; fromCollab?: boolean } = {}
): Promise<DocPage> {
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Page not found", 404);
  await requirePageLevel(page, viewerId, "edit");

  const next: Partial<typeof pages.$inferInsert> = {};
  if (patch.title != null) {
    const title = patch.title.trim();
    if (title.length > 120) throw new TacosError("Document title must be at most 120 characters", 400);
    if (!title) throw new TacosError("Page title is required");
    if (title !== page.title) next.title = title;
  }
  if (patch.doc != null && patch.doc !== page.doc) {
    assertDocSize(patch.doc);
    if (patch.baseRevision != null && patch.baseRevision !== page.revision) {
      throw new TacosError(PAGE_CONFLICT, 409);
    }
    next.doc = patch.doc;
    next.revision = page.revision + 1;
  }
  if (patch.icon !== undefined) {
    const icon = patch.icon?.trim() ?? "";
    if (icon.length > 8) throw new TacosError("Pick a single emoji as the page icon");
    next.icon = icon || null;
  }
  if (Object.keys(next).length === 0) return page;
  next.updatedAt = nowIso();
  // Links are derived from the text this save is about to store, before the transaction
  // and against what this editor may see. The saved document stays the only source.
  // A document without the `[[` trigger has no outgoing links, but it still has to
  // replace whatever this page recorded before.
  const links =
    next.doc === undefined
      ? null
      : next.doc.includes("[[")
        ? pageLinkTargets(next.doc, await listPageRefs(workspaceId, viewerId))
        : [];
  getDb().transaction(() => {
  const written = getDb()
    .update(pages)
    .set(next)
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        eq(pages.id, pageId),
        eq(pages.revision, page.revision)
      )
    ).run();
  if (written.changes === 0) throw new TacosError(PAGE_CONFLICT, 409);
  if (next.doc !== undefined || next.title !== undefined) {
    recordVersion(page, {
      title: next.title ?? page.title,
      doc: next.doc ?? page.doc,
      actorId: viewerId,
      via: options.via ?? "you",
      reason: "edit",
    });
  }
  if (links) replacePageLinks(workspaceId, pageId, links);
  });
  const updated = await findPage(workspaceId, pageId);
  if (!updated) throw new TacosError("Page not found", 404);
  if (next.doc !== undefined) await notifyDocMentions(page, updated.doc, viewerId);
  if (next.doc !== undefined && !options.fromCollab) collabDocWritten(pageId, updated.doc, updated.revision);
  if (next.doc !== undefined || next.title !== undefined) {
    const [editor] = await getDb()
      .select({ displayName: users.displayName })
      .from(users)
      .where(eq(users.id, viewerId));
    await emitAutomationEvent({
      type: "document.updated",
      workspaceId,
      pageId,
      actorUserId: viewerId,
      actorName: editor?.displayName ?? "A member",
      data: { title: updated.title, projectId: updated.projectId },
      idempotencyKey: `document:${pageId}:${Math.floor(Date.now() / DOCUMENT_EVENT_WINDOW_MS)}`,
    });
  }
  return updated;
}

/** Refused text its writer can no longer resolve: keep it in Updates, leave the page alone. */
export async function keepUnsavedText(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  doc: string
): Promise<void> {
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Page not found", 404);
  await requirePageLevel(page, viewerId, "edit");
  assertDocSize(doc);
  await recordVersion(page, {
    title: page.title,
    doc,
    actorId: viewerId,
    via: "you",
    reason: "unsaved",
  });
}

export type PageVersion = {
  id: string;
  seq: number;
  title: string;
  actor: PageAuthor | null;
  via: string;
  reason: string;
  // The template a first version was created from; null for every ordinary version.
  templateName: string | null;
  restoredFrom: number | null;
  createdAt: string;
  updatedAt: string;
};

export async function listPageVersions(
  workspaceId: string,
  pageId: string,
  viewerId: string
): Promise<PageVersion[]> {
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Page not found", 404);
  const rows = await getDb()
    .select({
      id: pageVersions.id,
      seq: pageVersions.seq,
      title: pageVersions.title,
      via: pageVersions.via,
      reason: pageVersions.reason,
      templateName: pageVersions.templateName,
      restoredFrom: pageVersions.restoredFrom,
      createdAt: pageVersions.createdAt,
      updatedAt: pageVersions.updatedAt,
      actorId: users.id,
      displayName: users.displayName,
      avatar: users.avatar,
    })
    .from(pageVersions)
    .leftJoin(users, eq(users.id, pageVersions.actorId))
    .where(eq(pageVersions.pageId, pageId))
    .orderBy(desc(pageVersions.seq));
  return rows.map(({ actorId, displayName, avatar, ...row }) => ({
    ...row,
    actor: actorId ? { id: actorId, displayName: displayName ?? "", avatar } : null,
  }));
}

export type PageVersionChange = { title: string; doc: string; beforeTitle: string; beforeDoc: string };

/** The text a version replaced. `spanFromId` is the oldest version in a collapsed run of
 *  editors and `versionId` is the newest, so the diff covers the whole run. Kept unsaved
 *  text never counts as the page's past. */
export async function getPageVersionChange(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  versionId: string,
  spanFromId?: string
): Promise<PageVersionChange> {
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Page not found", 404);
  const db = getDb();
  const [version] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.id, versionId)))
    .limit(1);
  if (!version) throw new TacosError("Version not found", 404);
  let from = version;
  if (spanFromId && spanFromId !== versionId) {
    const [spanFrom] = await db
      .select()
      .from(pageVersions)
      .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.id, spanFromId)))
      .limit(1);
    if (!spanFrom || spanFrom.seq > version.seq) throw new TacosError("Version not found", 404);
    from = spanFrom;
  }
  const [before] = await db
    .select({ title: pageVersions.title, doc: pageVersions.doc, docCompressed:pageVersions.docCompressed,reason: pageVersions.reason })
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, pageId), lt(pageVersions.seq, from.seq), inArray(pageVersions.reason, PAGE_TEXT_REASONS)))
    .orderBy(desc(pageVersions.seq))
    .limit(1);
  return {
    title: version.title,
    doc: await unpackText(version.doc,version.docCompressed),
    beforeTitle: before?.title ?? from.title,
    beforeDoc: before?await unpackText(before.doc,before.docCompressed):"",
  };
}

/** A restore adds a new version on top; nothing in the history is removed. */
export async function restorePageVersion(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  versionId: string,
  options: { via?: string } = {}
): Promise<DocPage> {
  const initial = await getPage(workspaceId, pageId, viewerId);
  if (!initial) throw new TacosError("Page not found", 404);
  await requirePageLevel(initial, viewerId, "edit");
  return withStoredCollabPage(pageId, async () => {
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Page not found", 404);
  await requirePageLevel(page, viewerId, "edit");
  const [version] = await getDb()
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, pageId), eq(pageVersions.id, versionId)))
    .limit(1);
  if (!version) throw new TacosError("Version not found", 404);
  return writeBack(page, {
    title: version.title,
    doc: await unpackText(version.doc,version.docCompressed),
    actorId: viewerId,
    via: options.via ?? "you",
    reason: "restore",
    restoredFrom: version.seq,
  });
  });
}

async function writeBack(page: DocPage, write: VersionWrite): Promise<DocPage> {
  const links = write.doc.includes("[[")
    ? pageLinkTargets(write.doc, await listPageRefs(page.workspaceId, write.actorId))
    : [];
  const written = await getDb()
    .update(pages)
    .set({ title: write.title, doc: write.doc, revision: page.revision + 1, updatedAt: nowIso() })
    .where(and(eq(pages.workspaceId, page.workspaceId), eq(pages.id, page.id), eq(pages.revision, page.revision)));
  if (written.changes === 0) throw new TacosError(PAGE_CONFLICT, 409);
  await recordVersion(page, write);
  replacePageLinks(page.workspaceId, page.id, links);
  const updated = await findPage(page.workspaceId, page.id);
  if (!updated) throw new TacosError("Page not found", 404);
  collabDocWritten(page.id, updated.doc, updated.revision);
  return updated;
}

// Versions that were the page's text at some point; kept unsaved text never was.
const PAGE_TEXT_REASONS = ["edit", "template", "restore", "undo", "earlier"];

/**
 * Take back an Agent's edit. Only the page's newest text can be undone this way, because going
 * back further would also drop what came after it: that is what restoring a version is for.
 * Without versionId, the newest version must be an Agent edit by this person.
 */
export async function undoAgentEdit(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  options: { versionId?: string; via?: string } = {}
): Promise<DocPage> {
  const initial = await getPage(workspaceId, pageId, viewerId);
  if (!initial) throw new TacosError("Page not found", 404);
  await requirePageLevel(initial, viewerId, "edit");
  return withStoredCollabPage(pageId, async () => {
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Page not found", 404);
  await requirePageLevel(page, viewerId, "edit");
  const db = getDb();
  const [latest, before] = await db
    .select()
    .from(pageVersions)
    .where(and(eq(pageVersions.pageId, pageId), inArray(pageVersions.reason, PAGE_TEXT_REASONS)))
    .orderBy(desc(pageVersions.seq))
    .limit(2);
  if (options.versionId && options.versionId !== latest?.id) {
    throw new TacosError("This document changed after that edit; restore a version instead", 409);
  }
  if (!latest || latest.via !== "mcp" || latest.reason !== "edit") {
    throw new TacosError("The newest change to this document is not an Agent edit", 409);
  }
  if (!options.versionId && latest.actorId !== viewerId) {
    throw new TacosError("The newest change to this document was made by someone else's Agent", 409);
  }
  return writeBack(page, {
    title: before?.title ?? page.title,
    doc: before?await unpackText(before.doc,before.docCompressed):"",
    actorId: viewerId,
    via: options.via ?? "you",
    reason: "undo",
    restoredFrom: latest.seq,
  });
  });
}

/** For the conflict prompt: the page as it is now and who last changed it. */
export async function pageConflictView(
  workspaceId: string,
  pageId: string,
  viewerId: string
): Promise<{ doc: string; revision: number; by: string | null }> {
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Page not found", 404);
  const latest = await latestVersion(pageId);
  const author = latest ? await pageAuthor(latest.actorId) : null;
  return { doc: page.doc, revision: page.revision, by: author?.displayName ?? null };
}

export async function descendantsOf(workspaceId: string, pageId: string): Promise<PageMetadata[]> {
  const all = await getDb()
    .select(metadataColumns)
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), isNull(pages.deletedAt)));
  const out: PageMetadata[] = [],seen=new Set([pageId]);
  const byParent=new Map<string,typeof all>();
  for(const row of all){if(!row.parentId)continue;const bucket=byParent.get(row.parentId)??[];bucket.push(row);byParent.set(row.parentId,bucket);}
  const queue=[pageId];
  for(let i=0;i<queue.length;i++)for(const row of byParent.get(queue[i])??[]){if(seen.has(row.id))continue;seen.add(row.id);out.push({...row,shared:row.shared===1});queue.push(row.id);}
  return out;
}

/** Sharing a page shares its whole subtree; unsharing takes it back with it. */
export async function setPageShared(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  shared: boolean
): Promise<DocPage> {
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Page not found", 404);
  if (page.createdBy !== viewerId) throw new TacosError("Only the page owner can change sharing", 403);
  const ids = await ownedSubtree(workspaceId,pageId,viewerId);
  await getDb()
    .update(pages)
    .set({ shared: shared ? 1 : 0 })
    .where(and(eq(pages.workspaceId, workspaceId), inArray(pages.id, ids)));
  collabAccessChanged(ids);
  const updated = await findPage(workspaceId, pageId);
  if (!updated) throw new TacosError("Page not found", 404);
  return updated;
}

/** Deleting moves the page and what is inside it to the Trash. */
export async function deletePage(
  workspaceId: string,
  pageId: string,
  viewerId: string
): Promise<string[]> {
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Page not found", 404);
  if (page.createdBy !== viewerId) throw new TacosError("Only the page owner can delete it", 403);
  const ids = [pageId, ...(await descendantsOf(workspaceId, pageId)).map((p) => p.id)];
  await getDb()
    .update(pages)
    .set({ deletedAt: nowIso(), trashRoot: pageId })
    .where(and(eq(pages.workspaceId, workspaceId), inArray(pages.id, ids)));
  // The owner may finish sending text already typed; it is retained in the Trash state.
  collabAccessChanged(ids,viewerId);
  return ids;
}

export type TrashedPage = {
  id: string;
  title: string;
  icon: string | null;
  createdBy: string;
  deletedAt: string;
  // Pages deleted along with this one.
  subpageCount: number;
};

/** One row per deletion. A private page stays visible only to its author here too. */
export async function listTrashedPages(workspaceId: string, viewerId: string): Promise<TrashedPage[]> {
  const rows = await getDb()
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), isNotNull(pages.deletedAt)))
    .orderBy(desc(pages.deletedAt));
  return rows
    .filter((row) => row.id === row.trashRoot && (row.shared === 1 || row.createdBy === viewerId))
    .map((row) => ({
      id: row.id,
      title: row.title,
      icon: row.icon,
      createdBy: row.createdBy,
      deletedAt: row.deletedAt ?? "",
      subpageCount: rows.filter((other) => other.trashRoot === row.id).length - 1,
    }));
}

async function findTrashed(workspaceId: string, pageId: string, viewerId: string): Promise<PageRow> {
  const [row] = await getDb()
    .select()
    .from(pages)
    .where(and(eq(pages.workspaceId, workspaceId), eq(pages.trashRoot, pageId), eq(pages.id, pageId)))
    .limit(1);
  if (!row || !(row.shared === 1 || row.createdBy === viewerId)) {
    throw new TacosError("Page not found", 404);
  }
  return row;
}

export async function restorePage(
  workspaceId: string,
  pageId: string,
  viewerId: string
): Promise<void> {
  const row = await findTrashed(workspaceId, pageId, viewerId);
  await requirePageLevel({ ...row, shared: row.shared === 1 }, viewerId, "edit");
  const db = getDb();
  // A parent that is gone or still in the Trash cannot hold it: it comes back at the top.
  const parent = row.parentId ? await findPage(workspaceId, row.parentId) : null;
  db.$client.transaction(()=>{
   const job=db.$client.prepare("SELECT state,completed FROM maintenance_jobs WHERE id=?").get(`page:${pageId}`) as {state:string;completed:number}|undefined;
   if(job&&(job.state==="running"||job.completed>0))throw new TacosError("Permanent deletion has started. This document cannot be restored.",409);
   db.update(pages).set({deletedAt:null,trashRoot:null}).where(and(eq(pages.workspaceId,workspaceId),eq(pages.trashRoot,pageId))).run();
   if(row.parentId&&!parent)db.update(pages).set({parentId:null}).where(eq(pages.id,pageId)).run();
  }).immediate();
}

/** Removes the page, its subtree and their versions for good. Author or workspace owner. */
export async function purgePage(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  isWorkspaceOwner: boolean
): Promise<void> {
  const row = await findTrashed(workspaceId, pageId, viewerId);
  if (row.createdBy !== viewerId && !isWorkspaceOwner) {
    throw new TacosError("Only the page owner or the workspace owner can delete it forever", 403);
  }
  const {purgePageRecords}=await import("./permanent-cleanup");
  await purgePageRecords(workspaceId,pageId);
}

/** Backlinks and [[Title]] need a cheap title → page lookup for the viewer. */
export async function listPageRefs(workspaceId: string, viewerId: string): Promise<PageRef[]> {
  const rows = await getDb()
    .select({ id: pages.id, title: pages.title, icon: pages.icon,parentId:pages.parentId })
    .from(pages)
    .where(
      and(
        eq(pages.workspaceId, workspaceId),
        isNull(pages.deletedAt),
        or(eq(pages.shared, 1), eq(pages.createdBy, viewerId))
      )
    )
    .orderBy(pages.createdAt);
  const byId=new Map(rows.map(row=>[row.id,row]));
  return rows.map(row=>{const path=[row.title],seen=new Set([row.id]);let parent=row.parentId;while(parent&&!seen.has(parent)){seen.add(parent);const ancestor=byId.get(parent);if(!ancestor)break;path.unshift(ancestor.title);parent=ancestor.parentId;}return{id:row.id,title:row.title,icon:row.icon,path:path.join(" / ")};});
}

/**
 * Resolves every page reference in a document to the page it points at. Used by the
 * reader so `[[Title]]` and `![[Title]]` never need a database call while rendering.
 */
export function pageLookup(refs: PageRef[]): Record<string, PageRef> {
  const out: Record<string, PageRef> = {};
  for (const ref of refs) {
    out[ref.id] = ref;
    const key = ref.title.trim().toLowerCase();
    if (!(key in out)) out[key] = ref;
  }
  return out;
}

/** Rebuilds a page's outgoing links from what it stores. The page is the source of truth. */
async function refreshPageLinks(workspaceId: string, viewerId: string, page: DocPage): Promise<void> {
  const refs = await listPageRefs(workspaceId, viewerId);
  replacePageLinks(workspaceId, page.id, pageLinkTargets(page.doc, refs));
}

export async function pageEmbedSources(
  workspaceId: string,
  viewerId: string,
  doc: string
): Promise<Record<string, string>> {
  const refs = await listPageRefs(workspaceId, viewerId);
  const lookup = pageLookup(refs);
  const ids = new Set<string>();
  for (const match of doc.matchAll(/!\[\[([^\]\n|]+)(?:\|([^\]]+))?\]\]/g)) {
    const byId = match[2] ? lookup[match[2].trim()] : undefined;
    const byTitle = lookup[match[1].trim().toLowerCase()];
    const target = byId ?? byTitle;
    if (target) ids.add(target.id);
  }
  const out: Record<string, string> = {};
  for (const id of ids) {
    const page = await getPage(workspaceId, id, viewerId);
    if (page) out[id] = page.doc;
  }
  return out;
}

export async function compressPageHistory(limit=20) {
 const db=getDb().$client;
 const rows=db.prepare("SELECT id,doc FROM page_versions WHERE doc_compressed IS NULL AND length(doc)>=4096 LIMIT ?").all(limit) as {id:string;doc:string}[];
 for(const row of rows){const packed=await packText(row.doc);db.prepare("UPDATE page_versions SET doc=?,doc_compressed=? WHERE id=? AND doc=? AND doc_compressed IS NULL").run(packed.text,packed.compressed??"",row.id,row.doc);}
}
