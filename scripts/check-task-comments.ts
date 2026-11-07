// U-11: task comments thread one level, edit/delete/resolve and react; edits and
// deletes land in the task timeline, and one comment sends one notice per person.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-comments-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { and, eq, inArray } = await import("drizzle-orm");
  const { comments, events, notifications, projects, users, watchers } = await import("../src/db/schema");
  const lib = (await import("../src/lib/issues")) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const people = await db.select().from(users).limit(2);
  const alex = people[0];
  const sam = people[1];
  assert(project && alex && sam, "seeded workspace with two members required");
  const ws = project.workspaceId;
  const actor = { kind: "user" as const, userId: alex.id, displayName: alex.displayName };
  const other = { kind: "user" as const, userId: sam.id, displayName: sam.displayName };

  const created = (await lib.createIssue(
    ws,
    { title: "Comment target", project: project.key, assigneeIds: [sam.id] },
    actor
  )) as { issue: { id: string; identifier: string } };
  const issueId = created.issue.id;

  const notices = async (userId: string, type?: string) =>
    db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.issueId, issueId),
          eq(notifications.userId, userId),
          type ? eq(notifications.type, type) : undefined
        )
      );

  // 1. Top-level comment with a mention: the mentioned watcher gets one notice, the
  //    actor gets none, and writing it follows the task.
  const first = (await lib.addComment(ws, issueId, "Top comment @sam", actor)) as {
    comments: Array<{ id: string; parentId: string | null }>;
  };
  const top = first.comments.at(-1)!;
  assert(top.parentId === null, "top-level comment has no parent");
  assert((await notices(sam.id, "mentioned")).length === 1, "mention sends one notice");
  assert((await notices(sam.id, "commented")).length === 0, "mention replaces the comment notice");
  assert((await notices(alex.id)).length === 0, "self-actions never notify the actor");

  // 2. Reply: one level, parent author hears about it once.
  const replied = (await lib.addComment(ws, issueId, "A reply", other, { parentId: top.id })) as {
    comments: Array<{ id: string; parentId: string | null }>;
  };
  const reply = replied.comments.at(-1)!;
  assert(reply.parentId === top.id, "reply points at its parent");
  assert((await notices(alex.id, "commented")).length === 1, "reply notifies the parent author");

  // 3. One level only: replying to a reply is refused.
  let deep = false;
  try {
    await lib.addComment(ws, issueId, "Too deep", actor, { parentId: reply.id });
  } catch {
    deep = true;
  }
  assert(deep, "a reply to a reply must be refused");

  // 4. Edit: author only, stamped, recorded in the timeline.
  const edited = (await lib.editComment(ws, issueId, top.id, "Top comment, edited", actor)) as {
    comments: Array<{ id: string; body: string; editedAt: string | null }>;
  };
  const editedTop = edited.comments.find((comment) => comment.id === top.id)!;
  assert(editedTop.body === "Top comment, edited" && editedTop.editedAt, "edit stamps the comment");
  let foreignEdit = false;
  try {
    await lib.editComment(ws, issueId, top.id, "Not mine", other);
  } catch {
    foreignEdit = true;
  }
  assert(foreignEdit, "another member cannot edit the comment");
  const timeline = await db.select().from(events).where(eq(events.issueId, issueId));
  assert(timeline.some((event) => event.type === "comment_edited"), "edit is in the task timeline");

  // 5. Resolve/reopen.
  const resolved = (await lib.setCommentResolved(ws, issueId, top.id, true, other)) as {
    comments: Array<{ id: string; resolvedAt: string | null }>;
  };
  assert(resolved.comments.find((comment) => comment.id === top.id)?.resolvedAt, "thread resolves");
  const reopened = (await lib.setCommentResolved(ws, issueId, top.id, false, other)) as {
    comments: Array<{ id: string; resolvedAt: string | null }>;
  };
  assert(
    reopened.comments.find((comment) => comment.id === top.id)?.resolvedAt === null,
    "thread reopens"
  );

  // 6. Fixed reactions: one per person, toggle off, mine is viewer-specific.
  const reacted = (await lib.toggleCommentReaction(ws, issueId, top.id, "👍", sam.id)) as {
    comments: Array<{ id: string; reactions: Array<{ emoji: string; count: number; mine: boolean }> }>;
  };
  const samReaction = reacted.comments.find((comment) => comment.id === top.id)!.reactions.find((item) => item.emoji === "👍")!;
  assert(samReaction.count === 1 && samReaction.mine === true, "reaction counts for its owner");
  const alexView = (await lib.getIssueDetail(ws, issueId, alex.id)) as {
    comments: Array<{ id: string; reactions: Array<{ emoji: string; count: number; mine: boolean }> }>;
  };
  const alexReaction = alexView.comments.find((comment) => comment.id === top.id)!.reactions.find((item) => item.emoji === "👍")!;
  assert(alexReaction.count === 1 && alexReaction.mine === false, "reaction is not mine for another viewer");
  const unreacted = (await lib.toggleCommentReaction(ws, issueId, top.id, "👍", sam.id)) as {
    comments: Array<{ id: string; reactions: Array<{ emoji: string }> }>;
  };
  assert(
    !unreacted.comments.find((comment) => comment.id === top.id)!.reactions.some((item) => item.emoji === "👍"),
    "clicking the same reaction removes it"
  );
  let badEmoji = false;
  try {
    await lib.toggleCommentReaction(ws, issueId, top.id, "🚀", sam.id);
  } catch {
    badEmoji = true;
  }
  assert(badEmoji, "only the fixed reaction set is accepted");

  // 7. Soft delete keeps the thread and clears the words; restore brings them back.
  const deleted = (await lib.deleteComment(ws, issueId, top.id, actor)) as {
    comments: Array<{ id: string; body: string; deletedAt: string | null }>;
  };
  const tombstone = deleted.comments.find((comment) => comment.id === top.id)!;
  assert(tombstone.deletedAt && tombstone.body === "", "delete keeps a tombstone without the words");
  const stillThere = await db
    .select()
    .from(comments)
    .where(eq(comments.id, top.id));
  assert(stillThere.length === 1, "soft delete keeps the row");
  assert(
    (await db.select().from(events).where(eq(events.issueId, issueId))).some(
      (event) => event.type === "comment_deleted"
    ),
    "delete is in the task timeline"
  );
  const restored = (await lib.restoreComment(ws, issueId, top.id, actor)) as {
    comments: Array<{ id: string; body: string; deletedAt: string | null }>;
  };
  assert(
    restored.comments.find((comment) => comment.id === top.id)?.body === "Top comment, edited",
    "restore brings the words back"
  );

  // 8. Dedupe: a mentioned watcher who is also the parent author gets exactly one row.
  const before = (await notices(alex.id)).length;
  await lib.addComment(ws, issueId, "@alex one notice please", other, { parentId: top.id });
  const after = (await notices(alex.id)).length;
  assert(after - before === 1, "watcher + mention + reply collapse into one notice");
  const latest = (await notices(alex.id)).at(-1)!;
  assert(latest.type === "mentioned", "the explicit mention is the notice that wins");

  const watcherRows = await db
    .select()
    .from(watchers)
    .where(eq(watchers.scopeId, issueId));
  assert(watcherRows.some((row) => row.userId === alex.id), "commenting follows the task");
  assert(watcherRows.some((row) => row.userId === sam.id), "assigning follows the task");

  const activity = await db
    .select()
    .from(events)
    .where(and(eq(events.issueId, issueId), inArray(events.type, ["commented", "comment_edited", "comment_deleted", "comment_resolved", "comment_reopened"])));
  assert(activity.length >= 6, "comment lifecycle is recorded in activity");

  console.log("check-task-comments: pass");
}

main().catch((err) => {
  console.error("check-task-comments: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
