// U-11 review threads: Request changes / Approve is one marked task comment that moves
// the task review state, lands in the timeline and sends one Inbox review notice.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.TACOS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "tacos-review-thread-"));

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function main() {
  const { getDb } = await import("../src/db/client");
  const { and, eq } = await import("drizzle-orm");
  const { events, notifications, projects, users } = await import("../src/db/schema");
  const lib = (await import("../src/lib/issues")) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const db = getDb();
  const [project] = await db.select().from(projects).limit(1);
  const people = await db.select().from(users).limit(2);
  const alex = people[0];
  const sam = people[1];
  assert(project && alex && sam, "seeded workspace with two members required");
  const ws = project.workspaceId;

  // An agent publishes a task; the person who ran the agent is its publisher/reviewer.
  const agent = {
    kind: "agent" as const,
    label: "codex",
    via: "mcp" as const,
    publishedBy: alex.id,
  };
  const published = (await lib.createIssue(
    ws,
    { title: "Review thread target", project: project.key },
    agent
  )) as { issue: { id: string; reviewStatus: string } };
  const issueId = published.issue.id;
  assert(published.issue.reviewStatus === "pending", "an agent task starts pending");

  const pending = (await lib.listPendingReview(ws)) as Array<{
    id: string;
    reviewCommentCount: number;
    latestReviewCommentId: string | null;
  }>;
  assert(pending.some((row) => row.id === issueId), "the task is in the review queue");
  assert(
    pending.find((row) => row.id === issueId)!.reviewCommentCount === 0,
    "a fresh queue row has no review comments"
  );

  // 1. Request changes: one marked comment, status rejected, one notice to the publisher.
  const first = (await lib.addReviewComment(ws, issueId, sam.id, "request_changes", "Please add a test")) as {
    issue: { reviewStatus: string; reviewedBy: string | null };
    comments: Array<{ id: string; body: string; reviewState: string | null; deletedAt: string | null }>;
  };
  const marked = first.comments.at(-1)!;
  assert(marked.reviewState === "changes_requested", "the comment carries the review marker");
  assert(marked.body === "Please add a test", "the review comment keeps its words");
  assert(
    first.issue.reviewStatus === "pending",
    "Request changes keeps a pending task in the review queue"
  );
  assert(first.issue.reviewedBy === sam.id, "the decision records its reviewer");
  const stillQueued = (await lib.listPendingReview(ws)) as Array<{
    id: string;
    reviewCommentCount: number;
    latestReviewCommentId: string | null;
  }>;
  const queued = stillQueued.find((row) => row.id === issueId)!;
  assert(queued, "the task is still in the review queue");
  assert(queued.reviewCommentCount === 1, "the queue counts review comments");
  assert(queued.latestReviewCommentId === marked.id, "the queue deep-links to the review comment");
  const reviewNotices = await db
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.issueId, issueId),
        eq(notifications.userId, alex.id),
        eq(notifications.type, "review_decision")
      )
    );
  assert(reviewNotices.length === 1, "the publisher gets exactly one review notice");
  const payload = JSON.parse(reviewNotices[0].data ?? "{}") as { decision?: string; commentId?: string };
  assert(payload.decision === "changes_requested", "the notice names the decision");
  assert(payload.commentId === marked.id, "the notice deep-links to the review comment");
  assert(
    (await db.select().from(events).where(eq(events.issueId, issueId))).some(
      (event) => event.type === "review_rejected"
    ),
    "the decision is in the task timeline"
  );

  // 2. Request changes without words is refused; Approve without words is allowed.
  let emptyChange = false;
  try {
    await lib.addReviewComment(ws, issueId, sam.id, "request_changes", "   ");
  } catch {
    emptyChange = true;
  }
  assert(emptyChange, "Request changes needs a reason");
  const approved = (await lib.addReviewComment(ws, issueId, sam.id, "approve", "")) as {
    issue: { reviewStatus: string };
    comments: Array<{ id: string; reviewState: string | null; body: string }>;
  };
  assert(approved.issue.reviewStatus === "approved", "Approve moves the task to approved");
  const approval = approved.comments.at(-1)!;
  assert(approval.reviewState === "approve" && approval.body === "", "Approve is a marked, wordless review");
  const allNotices = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.issueId, issueId), eq(notifications.userId, alex.id)));
  assert(
    allNotices.filter((row) => row.type === "review_decision").length === 2,
    "one notice per review decision, no duplicates"
  );

  // 3. The reviewer is not notified about their own decision.
  const self = (await lib.addReviewComment(ws, issueId, alex.id, "approve", "Looks good")) as {
    comments: Array<{ reviewState: string | null }>;
  };
  assert(self.comments.at(-1)!.reviewState === "approve", "the publisher can review their own task");
  const alexNotices = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.issueId, issueId), eq(notifications.userId, alex.id)));
  assert(alexNotices.length === 2, "a self-review adds no notice");

  // 4. Review comments are ordinary task comments: they thread, edit and delete.
  const reply = (await lib.addComment(ws, issueId, "Replying to the review", {
    kind: "user",
    userId: alex.id,
    displayName: alex.displayName,
  }, { parentId: approval.id })) as { comments: Array<{ id: string; parentId: string | null }> };
  assert(reply.comments.at(-1)!.parentId !== null, "review comments thread one level");

  // 5. The review queue still refuses a second decision through the old action.
  const queueTask = (await lib.createIssue(
    ws,
    { title: "Queue decision target", project: project.key },
    agent
  )) as { issue: { id: string } };
  await lib.reviewIssue(ws, queueTask.issue.id, sam.id, "reject");
  let twice = false;
  try {
    await lib.reviewIssue(ws, queueTask.issue.id, sam.id, "approve");
  } catch {
    twice = true;
  }
  assert(twice, "the queue still refuses a second review");

  // 6. A review comment on a task with no prior review also works and notifies the
  //    creator as a watcher, once.
  const normal = (await lib.createIssue(
    ws,
    { title: "Normal review target", project: project.key, assigneeIds: [sam.id] },
    { kind: "user", userId: alex.id, displayName: alex.displayName }
  )) as { issue: { id: string } };
  await lib.addReviewComment(ws, normal.issue.id, sam.id, "request_changes", "Change this");
  const normalNotices = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.issueId, normal.issue.id), eq(notifications.userId, alex.id)));
  assert(
    normalNotices.filter((row) => row.type === "review_decision").length === 1,
    "a normal task's creator gets one review notice"
  );

  console.log("check-review-threads: pass");
}

main().catch((err) => {
  console.error("check-review-threads: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
});
