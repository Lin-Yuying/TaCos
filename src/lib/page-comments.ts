import crypto from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { pageComments, users } from "../db/schema";
import type { DocAnchor } from "./doc-anchor";
import { TacosError, listMembers, notify, nowIso } from "./issues";
import { parseMentions } from "./mentions";
import { getPage, pageVisible, requirePageLevel, type DocPage, type PageAuthor } from "./pages";
import { autoFollow, watcherIds } from "./watchers";
import { recordActivity } from "./activity";

export type PageComment = {
  id: string;
  body: string;
  bodyLoaded?:boolean;
  quote: string | null;
  prefix: string;
  suffix: string;
  via: string;
  resolvedAt: string | null;
  parentId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  author: PageAuthor | null;
};

async function readablePage(workspaceId: string, pageId: string, viewerId: string): Promise<DocPage> {
  const page = await getPage(workspaceId, pageId, viewerId);
  if (!page) throw new TacosError("Page not found", 404);
  return page;
}

export async function listPageComments(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  read: {ids?:string[];summary?:boolean}={}
): Promise<PageComment[]> {
  await readablePage(workspaceId, pageId, viewerId);
  const rows = await getDb()
    .select({
      id: pageComments.id,
      body: read.summary?sql<string>`''`:pageComments.body,
      quote: pageComments.quote,
      prefix: pageComments.prefix,
      suffix: pageComments.suffix,
      via: pageComments.via,
      resolvedAt: pageComments.resolvedAt,
      parentId: pageComments.parentId,
      editedAt: pageComments.editedAt,
      deletedAt: pageComments.deletedAt,
      createdAt: pageComments.createdAt,
      authorId: users.id,
      displayName: users.displayName,
      avatar: users.avatar,
    })
    .from(pageComments)
    .leftJoin(users, eq(users.id, pageComments.authorId))
    .where(and(eq(pageComments.pageId, pageId),read.ids?inArray(pageComments.id,read.ids):undefined))
    .orderBy(asc(pageComments.createdAt));
  return rows.map(({ authorId, displayName, avatar, ...row }) => ({
    ...row,
    body: row.deletedAt ? "" : row.body,
    bodyLoaded:!read.summary,
    author: authorId ? { id: authorId, displayName: displayName ?? "", avatar } : null,
  }));
}

// A mentioned member who can read the page gets one notice; a page watcher gets one
// comment notice. U-11 dedupes watcher + mention into a single Inbox row and never
// notifies the author about their own comment.
async function notifyPageComment(
  page: DocPage,
  body: string,
  authorId: string,
  parentAuthorId?: string | null
): Promise<void> {
  const names = parseMentions(body);
  const members = await listMembers(page.workspaceId);
  const author = members.find((member) => member.id === authorId);
  const who = author?.displayName ?? "";
  const send = (userId: string, type: "doc_mentioned" | "doc_commented") =>
    notify({
      workspaceId: page.workspaceId,
      userId,
      issueId: "",
      pageId: page.id,
      type,
      body: who,
      data: { actorName: who, title: page.title },
    });
  const mentioned = new Set<string>();
  for (const member of members) {
    if (!names.includes(member.username.toLowerCase())) continue;
    if (!pageVisible(page, member.id)) continue;
    if (member.id === authorId) continue;
    // A mention follows the document.
    await autoFollow(page.workspaceId, member.id, "page", page.id, "mention");
    await send(member.id, "doc_mentioned");
    mentioned.add(member.id);
  }
  const targets = new Set(await watcherIds(page.workspaceId, "page", page.id));
  if (page.createdBy) targets.add(page.createdBy);
  if (parentAuthorId) targets.add(parentAuthorId);
  targets.delete(authorId);
  for (const userId of mentioned) targets.delete(userId);
  // A private page's watcher list may include people from when it was shared; never
  // send them a document title they can no longer open, and never notify removed members.
  const memberIds = new Set(members.map((member) => member.id));
  for (const userId of targets) {
    if (!memberIds.has(userId) || !pageVisible(page, userId)) continue;
    await send(userId, "doc_commented");
  }
}

export async function addPageComment(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  input: { body: string; anchor?: DocAnchor | null; parentId?: string | null },
  options: { via?: string;incremental?:boolean } = {}
): Promise<PageComment[]> {
  const page = await readablePage(workspaceId, pageId, viewerId);
  await requirePageLevel(page, viewerId, "comment");
  const body = input.body.trim();
  if (!body) throw new TacosError("Comment cannot be empty");
  if (body.length > 5_000) throw new TacosError("Comment is too long (5k characters max)");
  if(input.parentId){const parent=await commentOn(pageId,input.parentId);if(parent.deletedAt)throw new TacosError("This comment was deleted. Reply to another comment.",409);}
  const quote = input.anchor?.quote ?? "";
  const id=crypto.randomUUID();
  await getDb().insert(pageComments).values({
    id,
    pageId,
    workspaceId,
    authorId: viewerId,
    body,
    parentId:input.parentId??null,
    quote: quote ? quote.slice(0, 1_000) : null,
    prefix: quote ? (input.anchor?.prefix ?? "").slice(0, 64) : "",
    suffix: quote ? (input.anchor?.suffix ?? "").slice(0, 64) : "",
    via: options.via ?? "you",
    createdAt: nowIso(),
  });
  // U-11: commenting follows the document, and the page's Activity row appears.
  await autoFollow(workspaceId, viewerId, "page", pageId, "comment");
  const parent = input.parentId ? await commentOn(pageId, input.parentId) : null;
  await notifyPageComment(page, body, viewerId, parent?.authorId ?? null);
  const member = (await listMembers(workspaceId)).find((entry) => entry.id === viewerId);
  await recordActivity({
    workspaceId,
    objectType: "document",
    objectId: pageId,
    type: "page_commented",
    data: { title: page.title, commentId: id, preview: body.slice(0, 160) },
    actor: { kind: "user", userId: viewerId, displayName: member?.displayName ?? "A member" },
    projectId: page.projectId,
    ownerId: page.createdBy,
    visibility: page.shared ? "workspace" : "private",
  });
  return listPageComments(workspaceId, pageId, viewerId,{ids:options.incremental?[id]:undefined});
}

async function commentOn(pageId: string, commentId: string) {
  const [row] = await getDb()
    .select()
    .from(pageComments)
    .where(and(eq(pageComments.pageId, pageId), eq(pageComments.id, commentId)))
    .limit(1);
  if (!row) throw new TacosError("Comment not found", 404);
  return row;
}

export async function setPageCommentResolved(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  commentId: string,
  resolved: boolean,
  options:{incremental?:boolean}={}
): Promise<PageComment[]> {
  await requirePageLevel(await readablePage(workspaceId, pageId, viewerId), viewerId, "comment");
  await commentOn(pageId, commentId);
  const page = await readablePage(workspaceId, pageId, viewerId);
  await getDb()
    .update(pageComments)
    .set({ resolvedAt: resolved ? nowIso() : null })
    .where(eq(pageComments.id, commentId));
  const member = (await listMembers(workspaceId)).find((entry) => entry.id === viewerId);
  await recordActivity({
    workspaceId,
    objectType: "document",
    objectId: pageId,
    type: resolved ? "page_comment_resolved" : "page_comment_reopened",
    data: { title: page.title, commentId },
    actor: { kind: "user", userId: viewerId, displayName: member?.displayName ?? "A member" },
    projectId: page.projectId,
    ownerId: page.createdBy,
    visibility: page.shared ? "workspace" : "private",
  });
  return listPageComments(workspaceId, pageId, viewerId,{ids:options.incremental?[commentId]:undefined});
}

/** The author takes back their own words; the page's owner can clear anyone's. */
export async function removePageComment(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  commentId: string,
  options:{incremental?:boolean}={}
): Promise<PageComment[]> {
  const page = await readablePage(workspaceId, pageId, viewerId);
  const row = await commentOn(pageId, commentId);
  if (row.authorId !== viewerId && page.createdBy !== viewerId) {
    throw new TacosError("You cannot delete this comment", 403);
  }
  await getDb().update(pageComments).set({deletedAt:nowIso()}).where(eq(pageComments.id, commentId));
  return listPageComments(workspaceId, pageId, viewerId,{ids:options.incremental?[commentId]:undefined});
}

export async function editPageComment(workspaceId:string,pageId:string,viewerId:string,commentId:string,body:string,options:{incremental?:boolean}={}):Promise<PageComment[]> {
 const page=await readablePage(workspaceId,pageId,viewerId);await requirePageLevel(page,viewerId,"comment");
 const row=await commentOn(pageId,commentId);if(row.authorId!==viewerId)throw new TacosError("Only the author can edit this comment",403);
 if(row.deletedAt)throw new TacosError("Restore the comment before editing",409);
 const text=body.trim();if(!text||text.length>5000)throw new TacosError("Enter between 1 and 5000 characters",400);
 await getDb().update(pageComments).set({body:text,editedAt:nowIso()}).where(eq(pageComments.id,commentId));return listPageComments(workspaceId,pageId,viewerId,{ids:options.incremental?[commentId]:undefined});
}
export async function restorePageComment(workspaceId:string,pageId:string,viewerId:string,commentId:string,options:{incremental?:boolean}={}):Promise<PageComment[]> {
 const page=await readablePage(workspaceId,pageId,viewerId);await requirePageLevel(page,viewerId,"comment");
 const row=await commentOn(pageId,commentId);if(row.authorId!==viewerId&&page.createdBy!==viewerId)throw new TacosError("You cannot restore this comment",403);
 await getDb().update(pageComments).set({deletedAt:null}).where(eq(pageComments.id,commentId));return listPageComments(workspaceId,pageId,viewerId,{ids:options.incremental?[commentId]:undefined});
}
