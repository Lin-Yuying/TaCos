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

## Release and deploy

- Release `TaCos v2.5.0` published from tag `v2.5.0`; the tag workflow builds Windows,
  macOS and Linux artifacts and the server tarball.
- Server deploy to `ubuntu@43.130.57.28`: pending, this section is updated with the
  backup, version and health evidence after the deploy runs.
