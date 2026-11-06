import crypto from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { notifications, pageComments, users } from "../db/schema";
import type { DocAnchor } from "./doc-anchor";
import { TacosError, listMembers, nowIso } from "./issues";
import { parseMentions } from "./mentions";
import { getPage, pageVisible, requirePageLevel, type DocPage, type PageAuthor } from "./pages";

export type PageComment = {
  id: string;
  body: string;
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
  viewerId: string
): Promise<PageComment[]> {
  await readablePage(workspaceId, pageId, viewerId);
  const rows = await getDb()
    .select({
      id: pageComments.id,
      body: pageComments.body,
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
    .where(eq(pageComments.pageId, pageId))
    .orderBy(asc(pageComments.createdAt));
  return rows.map(({ authorId, displayName, avatar, ...row }) => ({
    ...row,
    body: row.deletedAt ? "" : row.body,
    author: authorId ? { id: authorId, displayName: displayName ?? "", avatar } : null,
  }));
}

// A mentioned member who can read the page gets one notice; its author gets one for any
// other comment. The person who wrote the comment gets none.
async function notifyPageComment(page: DocPage, body: string, authorId: string): Promise<void> {
  const names = parseMentions(body);
  const members = await listMembers(page.workspaceId);
  const author = members.find((member) => member.id === authorId);
  const who = author?.displayName ?? "";
  const send = (userId: string, type: "doc_mentioned" | "doc_commented") =>
    getDb().insert(notifications).values({
      id: crypto.randomUUID(),
      workspaceId: page.workspaceId,
      userId,
      issueId: "",
      pageId: page.id,
      type,
      body: who,
      createdAt: nowIso(),
    });
  const mentioned = new Set<string>();
  for (const member of members) {
    if (!names.includes(member.username.toLowerCase())) continue;
    if (member.id === authorId || !pageVisible(page, member.id)) continue;
    await send(member.id, "doc_mentioned");
    mentioned.add(member.id);
  }
  if (page.createdBy !== authorId && !mentioned.has(page.createdBy)) {
    await send(page.createdBy, "doc_commented");
  }
}

export async function addPageComment(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  input: { body: string; anchor?: DocAnchor | null; parentId?: string | null },
  options: { via?: string } = {}
): Promise<PageComment[]> {
  const page = await readablePage(workspaceId, pageId, viewerId);
  await requirePageLevel(page, viewerId, "comment");
  const body = input.body.trim();
  if (!body) throw new TacosError("Comment cannot be empty");
  if (body.length > 5_000) throw new TacosError("Comment is too long (5k characters max)");
  if(input.parentId){const parent=await commentOn(pageId,input.parentId);if(parent.deletedAt)throw new TacosError("This comment was deleted. Reply to another comment.",409);}
  const quote = input.anchor?.quote ?? "";
  await getDb().insert(pageComments).values({
    id: crypto.randomUUID(),
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
  await notifyPageComment(page, body, viewerId);
  return listPageComments(workspaceId, pageId, viewerId);
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
  resolved: boolean
): Promise<PageComment[]> {
  await requirePageLevel(await readablePage(workspaceId, pageId, viewerId), viewerId, "comment");
  await commentOn(pageId, commentId);
  await getDb()
    .update(pageComments)
    .set({ resolvedAt: resolved ? nowIso() : null })
    .where(eq(pageComments.id, commentId));
  return listPageComments(workspaceId, pageId, viewerId);
}

/** The author takes back their own words; the page's owner can clear anyone's. */
export async function removePageComment(
  workspaceId: string,
  pageId: string,
  viewerId: string,
  commentId: string
): Promise<PageComment[]> {
  const page = await readablePage(workspaceId, pageId, viewerId);
  const row = await commentOn(pageId, commentId);
  if (row.authorId !== viewerId && page.createdBy !== viewerId) {
    throw new TacosError("You cannot delete this comment", 403);
  }
  await getDb().update(pageComments).set({deletedAt:nowIso()}).where(eq(pageComments.id, commentId));
  return listPageComments(workspaceId, pageId, viewerId);
}

export async function editPageComment(workspaceId:string,pageId:string,viewerId:string,commentId:string,body:string):Promise<PageComment[]> {
 const page=await readablePage(workspaceId,pageId,viewerId);await requirePageLevel(page,viewerId,"comment");
 const row=await commentOn(pageId,commentId);if(row.authorId!==viewerId)throw new TacosError("Only the author can edit this comment",403);
 if(row.deletedAt)throw new TacosError("Restore the comment before editing",409);
 const text=body.trim();if(!text||text.length>5000)throw new TacosError("Enter between 1 and 5000 characters",400);
 await getDb().update(pageComments).set({body:text,editedAt:nowIso()}).where(eq(pageComments.id,commentId));return listPageComments(workspaceId,pageId,viewerId);
}
export async function restorePageComment(workspaceId:string,pageId:string,viewerId:string,commentId:string):Promise<PageComment[]> {
 const page=await readablePage(workspaceId,pageId,viewerId);await requirePageLevel(page,viewerId,"comment");
 const row=await commentOn(pageId,commentId);if(row.authorId!==viewerId&&page.createdBy!==viewerId)throw new TacosError("You cannot restore this comment",403);
 await getDb().update(pageComments).set({deletedAt:null}).where(eq(pageComments.id,commentId));return listPageComments(workspaceId,pageId,viewerId);
}
