/**
 * Task navigation: four sidebar queues, the other three task views as quick filters in
 * the task list header, and a My Tasks heading that is not the member's name.
 */
import fs from "node:fs";
import path from "node:path";

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function slice(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, `could not slice ${start} … ${end}`);
  return source.slice(from, to);
}

function main() {
  const shell = read("src/components/workspace-shell.tsx");
  const sidebar = slice(shell, "function SidebarNav(", "// A group heading in the folded sidebar");
  const rail = slice(shell, "function SidebarRail(", "function useSidebarWidth(");

  for (const [name, body] of [
    ["sidebar", sidebar],
    ["rail", rail],
  ] as const) {
    // The four queues that stay in the navigation.
    assert(body.includes("My Tasks"), `${name} must keep My Tasks`);
    assert(body.includes("Open Tasks"), `${name} must keep Open Tasks`);
    assert(body.includes("All Tasks"), `${name} must keep All Tasks`);
    assert(body.includes("Review"), `${name} must keep Review`);
    // The three filters that moved to the list header must not come back as rows.
    assert(
      !body.includes('link({ view: "active" })') && !body.includes("?view=active"),
      `${name} must not list the Active view`,
    );
    assert(
      !body.includes('link({ view: "all", assignee: "none" })') &&
        !body.includes("?view=all&assignee=none") &&
        !body.includes("?assignee=none"),
      `${name} must not list the Unassigned view`,
    );
    assert(
      !body.includes('link({ view: "agent" })') && !body.includes("?view=agent"),
      `${name} must not list the Agent tasks view`,
    );
  }
  assert(
    shell.includes("allTasksActive"),
    "All Tasks must stay highlighted for the quick-filter views",
  );

  const header = read("src/components/list-header.tsx");
  assert(header.includes("data-task-quick-views"), "quick filters must mark themselves for tests");
  for (const view of ['view: "active"', 'assignee: "none"', 'view: "agent"']) {
    assert(header.includes(view), `quick filters must link ${view}`);
  }
  assert(
    header.includes('assigneeParam === "me"') && header.includes('t("My Tasks")'),
    "My Tasks heading must use its own label, not the member's name",
  );

  // The three removed rows must be saveable as personal views.
  const taskView = read("src/lib/task-view.ts");
  assert(taskView.includes('"source"'), "task views must offer a Source filter");
  assert(taskView.includes('filter.value === "active"'), "Active must match the two open statuses");
  const bar = read("src/components/task-view-bar.tsx");
  for (const choice of ['value: "active"', 'key === "source"', 'value: "agent"', 'value: "person"']) {
    assert(bar.includes(choice), `filter choices must include ${choice}`);
  }

  // Badge counts for the two queues that carry work to do.
  assert(shell.includes("badge={openTasks || null}"), "Open Tasks must show its count");
  assert(shell.includes("badge={reviewTasks || null}"), "Review must show its count");
  assert(shell.includes("tag={openTasks ? openTasks : undefined}"), "the rail flyout must show the Open Tasks count");
  assert(shell.includes("tag={reviewTasks ? reviewTasks : undefined}"), "the rail flyout must show the Review count");
  const layout = read("src/app/[workspaceId]/layout.tsx");
  assert(layout.includes("countOpenTasks") && layout.includes("countPendingReview"), "the layout must count both queues");
  const issues = read("src/lib/issues.ts");
  assert(
    issues.includes("export async function countOpenTasks") &&
      issues.includes("export async function countPendingReview"),
    "issues.ts must expose both queue counts",
  );

  const zh = read("src/lib/i18n/zh.ts");
  for (const copy of [
    '"My Tasks": "我的任务"',
    'Active: "未完成"',
    'Unassigned: "未分配"',
    '"Agent tasks": "Agent 任务"',
    'Review: "待审核"',
  ]) {
    assert(zh.includes(copy), `missing Chinese label ${copy}`);
  }

  console.log("check-task-quick-views: pass");
}

try {
  main();
} catch (err) {
  console.error("check-task-quick-views: fail -", err instanceof Error ? err.message : err);
  process.exit(1);
}
