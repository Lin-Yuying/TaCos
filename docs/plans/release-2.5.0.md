# TaCos 2.5.0 release record

Release after **v2.4.1**. Scope is the UI redesign against design canvas Version 45
(every shipped screen, narrow-window layout; phone layouts stay as they are by rule)
plus the Inbox overhaul plan document.

## Merged work

| PR | Item | What shipped |
| --- | --- | --- |
| #100 | UI redesign | Sidebar grouping, tabs, shared page frame, task list/board/table/grid, task panel with delegation and hand-over, inbox, agent page, documents (index, editor, menus, outline, links, comments, updates, import), projects (overview, properties, resources, timeline, milestones, initiatives, roadmap), planning, insights, search page and command palette, trash and help, settings (all sections plus storage/export/import/system), entry screens, admin console, shared states, desktop screens, narrow-window layout. A six-area comparison pass against the Version 45 canvas fixed clear differences; kept and blocked differences are recorded in `docs/plans/ui-redesign-handoff.md`. |
| #78 | Inbox plan | Documents the planned Inbox overhaul as one PR (90-day retention, searchable Done, full Linear keyboard set, per-user preferences). |

## Verification (branch before merge, on the final code)

- `npx tsc --noEmit`: pass.
- `node scripts/check-i18n.mjs`: 1718 strings in code, 2259 in zh.ts, **0 missing**.
- `npm run check:harness`: **150/150** checks pass at the start of the pass (after the
  `check-agents-md` and `check-desktop-updater-entry` fixes) and again on the final
  comparison-pass code.
- `npm run build` with a fresh `TACOS_DATA_DIR`: exit 0.
- Browser smoke on a fresh data dir (1280×840, plus 640/720/800/900/1280 list-column
  checks): **16/16 flows pass, 0 page errors, 0 console errors**. Covers login, task
  create + panel + comment, document create + editor, docs index, search, Help
  table-of-contents follow, inbox, review, planning/activity/insights, project page,
  agent page, 16 settings pages, and the narrow-column Views menu with no header
  overflow at any tested width.
- Design-board comparison: 100+ boards compared side by side by six fresh-context
  reviewers. Blocked states are listed in the handoff doc: AI proposal (no model key),
  collaboration reconnect (no WebSocket server), permission-paused run, live runner,
  and agent turning-in-progress.

Not run: real Electron runtime (desktop screens compared as static pages only), the
33-flow end-to-end suite (replaced by the browser smoke above), real-model agent turn.

## Known gaps / observations

- Desktop builds remain unsigned (macOS ad-hoc, Windows unsigned), as in 2.4.1.
- Phone boards are not compared: phone layouts are out of scope by project rule.
- Import preview attention rows and import failure reasons remain English (generated in
  `src/lib/import`).
- Task panel width stays 520 (canvas ~420) and filter/sort menus stay separate; recorded
  as kept differences for a follow-up.
- Modals and the command palette now centre in the workspace content column; dialogs
  outside the workspace shell (login, join, onboarding) stay viewport-centred.
- Lint baseline is unchanged from 2.4.1 (pre-existing errors in untouched files).

## Release and deploy (done)

- Tag `v2.5.0` points at the version-bump commit `913603d` on `main`; the two merges
  (`2f785bd` for #100, `43b6713` for #78) precede it. The tag workflow
  (Desktop installers, run 42391233999) completed successfully and published seven
  assets: macOS arm64 DMG + updater ZIP + `latest-mac.yml`, Windows x64 NSIS installer
  + `latest.yml`, Linux x64 AppImage, and `TaCos-Server-2.5.0-linux-x64.tar.gz`.
- Server deploy to `ubuntu@43.130.57.28`: manual backup
  `/var/lib/tacos/backups/manual-pre-2.5.0`, installer pre-upgrade backup
  `pre_upgrade-2026-11-07_16-31-51-bb27` (version 2.4.1, integrity ok). The release
  tarball was installed over `/opt/tacos/app`; the previous 2.4.1 stays at
  `/opt/tacos/app.old`.
- Verified: `tacos.service` active; `/api/health` reports `version: 2.5.0`,
  `status: ok`, `integrity: ok`, schemaVersion 526, ~32.8 GB free; `/login` returns
  200; data counts unchanged from the pre-upgrade baseline (7 users, 3 workspaces,
  14 issues, 13 pages, 2 comments, 7 agent threads); the site-admin login reaches
  `/admin` and the instance console lists all 7 members.
- Observed: the production `/admin` page logged one minified React hydration warning
  (#418) in the automated browser run; the page rendered correctly with the expected
  data, and the same flow is clean in a local dev run. Recorded as an observation, not
  a functional failure.
- Not verified over the tunnel: workspace UI (task create/comment) with a real member
  account — the site admin is not a member of a workspace and member passwords are not
  known. That flow was part of the 16/16 fresh-data browser smoke on the same build.
- Rollback: `sudo /opt/tacos/deploy/rollback.sh` (refuses without a verified
  pre-upgrade backup).
