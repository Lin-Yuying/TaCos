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

## Release and deploy (done)

- Tag `v2.5.1` points at `49090bb` ("release: v2.5.1") on main; merge `3dfc365` for
  #101 precedes it. The tag workflow (Desktop installers, run 42469581956) completed
  successfully and published seven assets: macOS arm64 DMG + updater ZIP +
  `latest-mac.yml`, Windows x64 NSIS installer + `latest.yml`, Linux x64 AppImage, and
  `TaCos-Server-2.5.1-linux-x64.tar.gz`.
- Server deploy to `ubuntu@43.130.57.28`: manual backup
  `/var/lib/tacos/backups/manual-pre-2.5.1`, installer pre-upgrade backup
  `pre_upgrade-2026-11-08_10-57-41-27b3` (appVersion 2.5.0, integrity ok, sha256 in its
  manifest). The release tarball was installed over `/opt/tacos/app`; the previous 2.5.0
  stays at `/opt/tacos/app.old`.
- Verified: `tacos.service` active with 0 restarts; `/api/health` reports
  `version: 2.5.1`, `status: ok`, `integrity: ok`, schemaVersion 602, ~32.7 GB free;
  `/login` and `/api/health` return 200; data counts unchanged from the pre-upgrade
  baseline (7 users, 3 workspaces, 19 issues, 14 pages, 6 comments, 8 agent threads);
  site-admin login reaches `/admin` and the instance console lists all 7 members.
- Observed: the production `/admin` page logs one minified React hydration warning
  (#418) in the automated run — the same observation as the 2.5.0 deploy; the page
  renders correctly. Immediately after the deploy the journal shows a few "Failed to
  find Server Action" errors from tabs opened before the upgrade; that is expected
  Next.js stale-deployment behavior and clears after a refresh.
- Not verified over the tunnel: workspace UI with a real member account (the site admin
  is not a workspace member and member passwords are not known).
- Rollback: `sudo /opt/tacos/deploy/rollback.sh` (refuses without a verified
  pre-upgrade backup).
