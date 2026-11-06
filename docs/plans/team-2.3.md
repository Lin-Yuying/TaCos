# TaCos 2.3 plan

Branch: `feat/team-2.3-all`. Every session reads this file and `git log`, runs the smoke test, takes the first item whose status is `todo`, and commits that one item.

Smoke test: `npx tsc --noEmit && npm run -s i18n:check && npx tsx scripts/check-agents-md.ts`.

Status values: `todo`, `doing`, `done`, `blocked`. `done` needs the evidence named under "Pass". A check is never weakened to reach `done`.

Item-level checks stay cheap (types, check scripts). End-to-end tests and screenshots run once, on the whole batch, in item 26.

## Decisions

- Every item here ships in one version, 2.3.0.
- Documents stay stored as Markdown. Color, toggle and callout use custom syntax that round-trips.
- Public components come first. npm lists these as MIT on 2026-11-05: `@tiptap/extension-drag-handle-react`, `@tiptap/extension-details`, `@tiptap/extension-color`, `@tiptap/extension-text-style`, `@tiptap/extension-highlight`, `@tiptap/extension-link`, `@tiptap/extension-code-block-lowlight`, `lowlight`.
- A shared chat takes one turn at a time. A member can fork it from any message into their own private chat.
- "Move forward with Agent" becomes "Work on it in chat" and sends the first message itself, only on a new empty chat. "Hand to my Agent" becomes "Hand to Agent in background" and keeps its behaviour. Writes still follow the approval level.
- Sidebar order: Inbox, Agent; Tasks (My Tasks, Open Tasks, All Tasks, Review); Projects; Documents (Shared, Private); Your team. Bottom: Help, Trash, Settings. Labels moves into Settings.
- Active, Unassigned and Agent tasks are quick filters in the task list header, not sidebar rows (2026-11-06).
- Board columns run todo, in progress, done, canceled. List grouping keeps in progress first.
- CodeBuddy tool loading (2026-11-05, CodeBuddy 2.171.0, one tool on a local stub): `alwaysLoad` with `--tools DeferExecuteTool` calls the tool directly in 3 of 3 runs, 4.3 to 12.1 s; the old setting went through ToolSearch in 3 of 3, 6.2 to 10.8 s. Two runs asked to write a file made none.
- Local direct output, a document cache and a local replica are not in this plan. They wait for the timing data from item 2.

## Items

| # | Item | Status | Pass |
|---|---|---|---|
| 1 | New chat composer can send again after a chat was started | done | Check script or E2E in item 26: second chat sends |
| 2 | Per-turn timing log: model, tool requests with bytes, output upload, approval wait; try the CodeBuddy tool-loading setting | done | Check script: a turn writes every segment |
| 3 | Members change their own display name in Settings | done | Check script: own name changes; empty and over-long names refused |
| 4 | Paste and upload images and files in the Agent composer, handed to the harness on the member's computer | done | Check script: `npx tsx scripts/check-composer-attachments.ts`; real-model check in item 26 |
| 5 | Selected image in a document shows selection; delete leaves the cursor in place with no jump | done | Check script: `node --import tsx scripts/check-doc-image-selection.ts`; screenshots in item 26 |
| 6 | The two Agent buttons: new names, chat button sends the first message | done | Check script: empty chat sends once; existing chat sends nothing |
| 7 | Shared chat: one turn at a time, says who is using it; fork from a message | done | `node --import tsx scripts/check-collab-shared-chat.ts`; smoke: `npx tsc --noEmit && npm run -s i18n:check && node --import tsx scripts/check-agents-md.ts` |
| 8 | @ someone who cannot see the document: warn and offer sharing; @ yourself notifies | done | Check script: warning condition; self-mention notification |
| 9 | One left edge for title, toolbar and content on every page; board fills the width and stays readable with the task panel open; board column order; line icon for documents; Documents page groups match the sidebar; read items in Inbox stay legible | done | `node --import tsx scripts/check-team-2.3-layout.ts`; screenshots at 1440 and 1100 wide deferred to item 26 |
| 10 | Sidebar order per Decisions; one word for workspace; the document + matches the project + and shows it is working | done | `check-agents-md` glossary; screenshots in item 26 |
| 11 | Updates panel shows rendered inline changes, tables as tables | done | Check script over text and table diffs |
| 12 | Updates by several editors merge into one entry that collapses | done | `node --import tsx scripts/check-doc-update-groups.ts` |
| 13 | Table: add and delete rows and columns | done | `node --import tsx scripts/check-doc-table-edit.ts` |
| 14 | Drag blocks; turn a block into another type | done | `node --import tsx scripts/check-doc-block-turn.ts`; screenshots in item 26 |
| 15 | Link and color in the selection toolbar | done | `node --import tsx scripts/check-doc-color-syntax.ts` |
| 16 | Toggle and callout blocks | done | `node --import tsx scripts/check-doc-toggle-callout.ts` |
| 17 | Code highlighting in the document editor | done | `node --import tsx scripts/check-doc-code-highlight.ts` |
| 18 | Comment count in the page margin | done | `node --import tsx scripts/check-doc-comment-count.ts`; screenshots in item 26 |
| 19 | Embedded page content shows in the editor | done | Confirmed the editor drew only the title. `node --import tsx scripts/check-doc-page-embed.ts`; screenshots in item 26 |
| 20 | Agent view for tasks | done | `node --import tsx scripts/check-agent-task-view.ts`; screenshots in item 26 |
| 21 | Blocker report from a task, notifying the right person | done | `node --import tsx scripts/check-blocker-report.ts` |
| 22 | Sub-tasks | done | `node --import tsx scripts/check-subtasks.ts` |
| 23 | Task dependencies | done | `node --import tsx scripts/check-task-dependencies.ts` |
| 24 | Recurring tasks | done | `node --import tsx scripts/check-recurrence.ts` |
| 25 | Fix the six open security findings from the 2.2 review | done | `node --import tsx scripts/check-security-2.2.ts` |
| 26 | Batch E2E and screenshots with real models and new data dirs; fresh-context review; fix findings | done | Report lists tested and untested |
| 27 | Version 2.3.0, PR for the user to merge; after the merge, tag and publish | done | PR merged as #62; tag `v2.3.0` on `ed52d45`; release published |
| 28 | Fix the four must-fix findings from the fresh-context review | done | Four fixes, three new check scripts, smoke and `npm run check:harness` 87/87 pass |

### Item 26: batch E2E and review

- Ran on an isolated worktree (`/Volumes/Storage/tacos-e2e-wt`, checked out at `0cb2513`) with one new data dir (`/tmp/tacos-e2e-2.3.oosMcr`, `mktemp -d`), zh-CN locale, on `localhost:3100`. The dev server needs the `localhost` host: Next 16 blocks dev resources from `127.0.0.1` without `allowedDevOrigins`, which leaves the login form unhydrated.
- Real model: one Codex CLI 0.166.0 / GPT-6 Luna turn returned `OK`; `/api/ai/chat` returned 200; the turn took about 47 s. Screenshot `model-turn.png`.
- Screenshots: 11 PNGs under `/Volumes/Storage/tacos-shots/out/2.3/`, at 1440 and 1100 wide. Board columns read todo, in progress, done, canceled at both widths with no overflow. Sidebar order matches Decisions. Settings shows the display name and the locale switch. Board layout is stored in `tacos.issues.layout`, not in the URL.
- Smoke `npx tsc --noEmit && npm run -s i18n:check && npx tsx scripts/check-agents-md.ts` passed: 719 strings in code, 994 in zh.ts, 0 missing.
- `npm run check:harness`: 84/84 checks pass after the fixes below.
- Four checks failed before this item. Three asserted 2.2 behaviour that 2.3 changed: `listThreadTasks` returns `ref` from `issueRef` instead of `identifier`; `startTaskChat` offers an opening message for a chat that never ran a turn; the layout passes `agentAllowed` from the harness gate together with existing threads. Those assertions were updated to the new behaviour, and `check-collab-agent-advance` gained a case for reopening a chat that already has messages. The fourth failure came from a duplicate blank line in `README.md` that the editor round trip folds; the line was removed. No check was weakened.
- Not verified on this machine: real Pi, OpenCode, DeepSeek and WorkBuddy turns; English-locale screenshots; desktop packaging; server deployment; interactive document editing (toggle, callout, table rows, code highlight, page embed), which pass their check scripts but were not driven in the UI. A fresh-context review of the batch did not produce a report before this commit, so no findings from it were fixed here; the four fixes above came from `npm run check:harness`. The review completed afterwards, and its findings are fixed in item 28.

#### Fresh-context review (completed after the item 26 commit)

The review report is `/tmp/tacos-2.3-review.md` on this machine (142 lines, not committed). This section records its conclusions so they stay readable after the machine is gone. It was a read-only review of `65c3db7..0cb2513` (41 commits, 133 files, +6601/-599), with the current source read again at `3bf8ef9` to confirm the line numbers still hold. It found 10 findings: one release-gate blocker, four must-fix before release, five observations.

- Tested by the reviewer: `git log`, `git diff --stat`, every module's actual diff, current source for line numbers, `node scripts/check-i18n.mjs` (0 missing / 45 unused), `AGENTS.md`, this plan, a check that no `text-[Npx]` size appeared in the src diff, and a per-item judgement of items 1-25 against their Pass column.
- Not verified by the reviewer: `npx tsc --noEmit`, `npm run build`, `npm run lint`, any `scripts/check-*.ts`, `npm run check:harness`, real-model E2E, 1440/1100 screenshots, desktop packaging, server deployment, UI-driven interactive document editing, shared-document (Yjs) concurrency under whole-document replacement, exhaustive toggle/callout/color round trips, and server-mode attachment fetch. The reviewer did not re-run the smoke, the 84 checks or the screenshots recorded above; those stay as this item's own evidence, not independently confirmed by the review.
- Findings 2, 3, 4 and 5 are fixed in item 28. Findings 6-10 stay open as observations; they are listed there with the reason they were not fixed before this release.

### Item 27: version 2.3.0

- Version raised to 2.3.0 in `package.json` and `package-lock.json`.
- `origin/main` was merged first (4 commits, 2.2.3). Three files conflicted and the 2.3 side was kept: `doc-tree.tsx` (Decisions ask for Documents (Shared, Private)), `list-header.tsx` and `project-workspace.tsx` (item 9 asks for one left edge via `PAGE_INSET`). Keeping the 2.3 side reverts main's 2.2.3 "one document tree" change. The independent 2.2.3 fixes in `doc-panel.tsx`, `project-meta.tsx` and `zh.ts` were merged.
- After the merge commit, the smoke test and `npm run check:harness` were re-run: 84/84 checks pass.
- PR #62 (`feat/team-2.3-all` into `main`) is open and ready. After the fresh-context review found a release blocker, it was converted to draft and a "do not merge yet" comment was added. Item 28 then fixed the four must-fix findings on this branch, and the PR was marked ready again. The user merges it manually.
- Tagging `v2.3.0` and publishing the release follow the user's merge. Deploy stays with the user.
- Status `done`: release published.
- Merged as PR #62 (merge commit `9c1f81f`). Two release blockers surfaced in CI and were fixed on top of `main`: PR #64 regenerated `package-lock.json` (`npm ci` missed `@emnapi/runtime@1.11.3` and `@emnapi/core@1.11.3`; the 2.3 batch added eight `@tiptap/extension-*` dependencies without regenerating the lock, and local `node_modules` kept every check green), and PR #65 moved the macOS release job to `macos-15` (GitHub retired the macOS 14 runner image on 2026-11-02, so `macos-14` no longer schedules runners).
- The tag was deleted and re-tagged onto `ed52d45` after both fixes merged: a tag-triggered workflow reads its file from the tagged tree. The third build passed all three platforms and published the release.
- Release `TaCos v2.3.0` at https://github.com/Lin-Yuying/TaCos/releases/tag/v2.3.0 with seven assets: Windows installer, `latest.yml`, macOS arm64 dmg, `*-mac.zip`, `latest-mac.yml`, Linux AppImage, and the Linux server tarball. Deploy stays with the user.

### Item 28: fix the fresh-context review's must-fix findings

Four findings were marked must-fix before release. All four were fixed; one new check script covers each fix except findings 2 and 4, which share one.

- Finding 2 (`blockedBy` bypassed project visibility): `addDependency` and `removeDependency` in `src/lib/issues.ts` take a `viewerId` and call `assertSeesIssue` on the second task. `src/app/actions.ts` passes `user.id`. `getIssueDetail` filters `dependencies` by the viewer's visible projects when a `viewerId` is given and see-all is off; without a `viewerId` it keeps the old behaviour. All five `addDependency` calls in `scripts/check-task-dependencies.ts` were updated to pass the viewer.
- Finding 3 (shared-chat lock and MCP grant had no `finally`): `settle()` in `src/lib/agent-turn-record.ts` calls `onEnd` from a `finally` block, and `pull()` settles on an upstream read error before rethrowing. `cancel()` already settled. `src/app/api/ai/chat/route.ts` was not changed: a `try/finally` around `return Response` would release the lock before the stream ends.
- Finding 4 (`restoreProject` had no authorization, Trash leaked hidden projects): `restoreProject` now calls `assertProjectOwner`; `restoreProjectAction` passes `user.id` and calls `assertSeesProject`; `listTrashedProjects(workspaceId, viewerId?)` filters by the viewer's projects when see-all is off, and `src/app/[workspaceId]/trash/page.tsx` passes `user.id`. The filter uses a new `ownTrashedProjectCondition` instead of `ownProjectCondition`: the latter requires `deleted_at IS NULL`, which no Trash row satisfies, so reusing it would have made every restricted member's Trash empty, including projects they deleted and can restore.
- Finding 5 (release blocker, the 2.2.3 regression): `src/components/doc-tree.tsx` keeps the Shared and Private sections required by Decisions, but dropping a page on a section no longer passes `shared` to `movePage`. Cross-section dragging only reorders or un-nests. An explicit sharing change still goes through `setPageSharedAction` when a page is created. This keeps the 2.3 layout without reviving the v2.2.3 privacy footgun that `233cfa3` fixed.

New checks: `scripts/check-review-visibility.ts` (findings 2 and 4), `scripts/check-review-turn-release.ts` (finding 3), `scripts/check-review-doc-drag.ts` (finding 5). Each is picked up by `scripts/check-all.ts`. The visibility check refuses a hidden `blockedBy` on both add and remove, filters a hidden dependency out of the restricted viewer's task detail, hides a hidden project from the outsider's Trash while the owner still sees it, keeps the no-viewer call's old behaviour, rejects an unauthorized restore with 403, and checks that a restricted member still sees and can restore a project they deleted themselves.

Each check was verified against unfixed code. Restoring the old `doc-tree.tsx` and `agent-turn-record.ts` makes their checks fail; swapping `ownTrashedProjectCondition` back to `ownProjectCondition` fails on "a restricted member sees a project they deleted themselves"; removing the two `assertSeesIssue(workspaceId, blockedBy, viewerId)` calls fails on `expected "Issue "HID-1" not found"`. The source was restored byte-identically after each check and the visibility check passed again. The three checks are not empty assertions.

Verification: smoke test `npx tsc --noEmit && npm run -s i18n:check && npx tsx scripts/check-agents-md.ts` passes (721 strings in code, 996 in zh.ts, 0 missing); `npm run check:harness` passes 87/87 with all three new checks listed as `ok`.

Findings 6-10 remain open as observations, not fixed before this release: fork offered on optimistic `local-*` / `streaming-*` messages; `openNextOccurrence` firing on every `updateIssue` / `moveIssue`; `dispatchTurn` replacing the whole document instead of dispatching `turnBlock`'s own transaction; toggle/callout read and written by two separate parsers; and a dirty worktree if a release is cut locally. The last one is handled by tagging from a clean checkout after the merge, not by committing `next.config.ts` (the user asked to keep that change uncommitted).

Scope note on finding 2: `getIssueDetail` filters dependencies only when a `viewerId` is given. Callers that pass no viewer keep the old behaviour. This includes `mcp/server.ts:150` (`get_issue`), which was checked and does not return `dependencies` at all — it returns `detail.issue`, `comments` and `events` — so it does not expose the hidden dependency titles this finding is about. The internal `src/lib/issues.ts` calls that pass no viewer also keep the old behaviour by design. Filtering those paths was not part of this release.

### Item 29: fix the 2.3.0 upgrade path (server boot failed on a 2.2 database)

The v2.3.0 server tarball was deployed to the team's Tencent Cloud host on 2026-11-06. The installer's own self-check timed out: `/login` answered 500 in a loop, and `journalctl -u tacos` repeated `SqliteError: An error occurred while loading instrumentation hook: no such column: parent_id`.

- Cause: `src/db/client.ts` created `issues_parent_idx` inside the `DDL` block that `bootstrap()` runs first, while the `ALTER TABLE issues ADD COLUMN parent_id` that makes the column exist ran after that block. A database created by 2.2 has no `parent_id`, so `sqlite.exec(DDL)` threw on the index, `bootstrap()` never reached the `ALTER`, `getDb()` threw on every call, and the instrumentation hook failed with it. Every request answered 500, and a restart repeated the same order. Fresh installs were unaffected because `CREATE TABLE` writes the column before any index runs, which is why the whole E2E suite (new data directory every run) passed.
- Fix: both tree indexes (`issues_parent_idx`, `pages_parent_idx`) moved out of `DDL` to the point in `bootstrap()` after `addColumnIfMissing` has guaranteed `parent_id` on `issues` and `pages`. `pages.parent_id` gained an `addColumnIfMissing` call for the same reason.
- `origin/main` gained an independent fix for the same ordering while this branch was open (`feature/ui-reliability`, PR #63: the DDL line removed and `sqlite.exec("CREATE INDEX IF NOT EXISTS issues_parent_idx ...")` placed right after `addColumnIfMissing(issues, parent_id)`, with `scripts/check-task-upgrade.ts`). This branch was rebased onto it; the merged form guarantees the column on both tables first and then creates both indexes in one `exec`, so the page tree is covered and no statement is duplicated.
- Regression check: `scripts/check-upgrade-old-db.ts` builds the 2.2 shape of `issues` (no `parent_id`, one row), points `TACOS_DATA_DIR` at it and calls `getDb()`. It asserts the column appears, both indexes exist and the old row survives. Checked against unfixed code: stashing the `client.ts` change makes the check throw `SQLITE_ERROR: no such column: parent_id`, and the fix was restored with `git stash pop`. Picked up by `scripts/check-all.ts`.
- Live host recovered before the fix: service stopped, `tacos.db` copied to `/var/lib/tacos/data/tacos.db.bak-pre-2.3.0`, `ALTER TABLE issues ADD COLUMN parent_id TEXT` applied by hand, service started. `/login` answers 200 and the journal is clean since the restart. That host now matches what this item makes bootstrap do on its own.
- Verification: `npx tsc --noEmit` exits 0; `npm run check:harness` passes 88/88 with `check-upgrade-old-db.ts` listed as `ok`. Not verified: a real 2.2-to-2.3 upgrade through the installer, which needs a second host and stays with the user.
