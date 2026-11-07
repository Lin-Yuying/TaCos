/**
 * docs/plans/team-2.3.md item 9: page inset, board columns, document groups, inbox read styles.
 * Screenshots at 1440 and 1100px stay in item 26.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

const constants = read("src/lib/constants.ts");
assert.match(
  constants,
  /export const BOARD_STATUS_ORDER: Status\[\] = \["todo", "in_progress", "done", "canceled"\]/,
  "board columns must run todo, in progress, done, canceled"
);
assert.match(
  constants,
  /export const STATUS_ORDER: Status\[\] = \["in_progress", "todo", "done", "canceled"\]/,
  "list grouping keeps in progress first"
);

const board = read("src/components/issue-board.tsx");
assert.match(board, /BOARD_STATUS_ORDER/, "board must use BOARD_STATUS_ORDER");
assert.match(board, /PAGE_BOARD/, "board must use shared page chrome");

const taskBar = read("src/components/task-view-bar.tsx");
assert.match(taskBar, /PAGE_INSET/, "filter toolbar must share the page left edge");

const docsIndex = read("src/components/docs-index.tsx");
assert.match(docsIndex, /page\.shared \? t\("Shared"\) : t\("Private"\)/, "docs index rows state Shared or Private");
assert.doesNotMatch(docsIndex, /My pages/, "docs groups must match the sidebar, not author split");

const inbox = read("src/components/notifications-view.tsx");
assert.match(inbox, /data-inbox-read=/, "inbox rows expose read state for styling");
assert.doesNotMatch(inbox, /opacity-60/, "read inbox rows must stay legible");

const shell = read("src/components/workspace-shell.tsx");
assert.match(
  shell,
  /href=\{`\/\$\{workspaceId\}\/docs`\}[\s\S]{0,120}FileText size=\{14\}/,
  "Documents nav uses the line icon"
);
assert.doesNotMatch(shell, /BookOpen/, "Documents nav must not use BookOpen");

console.log("check-team-2.3-layout: pass");
