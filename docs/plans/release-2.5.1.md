# TaCos 2.5.1 release record

Release after **v2.5.0**. Scope is the team feedback document (items 1–7) collected after
the 2.5.0 deploy, plus the tab-close animation fix.

## Merged work

| PR | Item | What shipped |
| --- | --- | --- |
| #101 | 1 Agent page | The composer no longer shows a black frame on focus: the global `:focus-visible` outline moved into `@layer base`, so component `outline-none` wins. The input clears when the message is sent. Approval, harness and model chips stay enabled during a run. Messages typed during a run are queued ("排队中"), can be edited or removed, and are sent when the reply ends. |
| #101 | 2 Inbox | Rows read while Unread is open stay in place until the tab changes. |
| #101 | 3 Documents | Typing after returning to a document is saved again (`8dc07ae`). In the browser, closing the tab with unsynced edits asks first; the desktop app has no such dialog. |
| #101 | 4 Review | Assignees of an agent-published task are notified when it is approved, not when it is published. Review rows show a description excerpt and open the task panel for viewing and editing. |
| #101 | 5 Document page | The "Insert block" row and the table toolbar row are removed; a right-click menu offers cut, copy, paste as plain text, comment, insert, table actions (in a table) and download original (on an image). Shift + right-click keeps the browser menu. Finished uploads leave no status line. Images no longer show a "Download original" link, except as a fallback when the image fails to load. |
| #101 | 6 Pending tasks | Tasks waiting for review are not in My Tasks. Status, assignee and agent delegation changes are rejected with 409 until approved (API, bulk update, collection change, delegate); the panel hides them. The estimate label explains what points mean. |
| #101 | 7 Inbox groups | An expanded group's header shows the task and the update count instead of repeating the first notification; child rows are indented, drop the repeated task line, and have no focus outline. |
| #101 | Tabs | Closing a tab slides it out and the next tab moves up (`a06d048`). |

The feedback PDF mentioned items 8 and 9; the feedback document lists only 1–7, so 8 and 9
are not in this release.

## Verification (branch before merge, on the final code)

- `npx tsc --noEmit`: pass.
- `node scripts/check-i18n.mjs`: 1725 strings in code, 2272 in zh.ts, **0 missing**.
- `npm run check:harness`: **150/150** checks pass.
- `npm run build` with a fresh `TACOS_DATA_DIR`: exit 0.
- ESLint on changed files: 0 errors, no new warnings against the 2.5.0 baseline.
- Server checks on a fresh data dir (server mode): a pending task is excluded from the
  assignee's My Tasks; status change, assignee patch, assignee collection change and
  delegate are rejected with "This task is waiting for review"; a title edit is allowed;
  the assignee has 0 assigned notices at publish and exactly 1 after approval via the
  review action or via a review comment; status change works after approval.
- Browser checks on the production build (fresh data dir, 1400×900): review row excerpt,
  review bar in the panel with no delegation row, estimate tooltip, inbox group header
  "CORE-8 · 收件箱分组任务 | 4 次更新" with 4 indented children and no outline, no insert
  row, context menu in text / table / image, empty upload status after upload, 0 download
  links.
- Real Codex turn on the agent page (local mode, fresh data dir): no focus outline on the
  composer; input empty 400 ms after send; harness, model and approval chips enabled during
  the run; a second message typed during the run was queued and answered after the first
  (both answers stored).

Not run: real Electron runtime for these fixes.
