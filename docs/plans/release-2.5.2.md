# TaCos 2.5.2 release record

Release after **v2.5.1**. Scope is the two UI fixes merged in #102. No desktop installer
is produced for this version: both fixes ship from the server, which is where members load
the app from.

## Merged work

| PR | Fix | What shipped |
| --- | --- | --- |
| #102 | Inbox flicker | Opening an unread row no longer replaces the list with the skeleton. The page drops its `<Suspense fallback={ListSkeleton}>` and blocks the route (`instant = false`), the read-row set moves to a module-level store keyed by workspace, and marking a row read no longer calls `router.refresh()`. The list re-reads from the server when the next row opens. |
| #102 | Tabs | Sidebar entries (projects, document tree, recent documents) open in a new tab through `data-nav-new-tab`; links inside a page still replace the current tab. `placeInTabs` is unchanged. |

## Verification (branch before merge, on the final code)

- `npx tsc --noEmit`: no new errors; the only errors are pre-existing ones in generated files under `.next/dev/types`.
- ESLint on the changed files: 0 errors.
- `scripts/check-inbox-ui.ts`: pass, with three new assertions for `instant = false`, no `<Suspense>` around the list, and `data-nav-new-tab`.
- `npm run check:harness`: 147/150. `check-performance-api-usage`, `check-performance-cleanup` and `check-task-upgrade` fail with exit=1 on main as well, with this branch's changes stashed.
- Browser runs on headless Edge 1440×900 with CDP mouse events, separate data directory:
  - Inbox: `[aria-busy]` appeared once at 718ms before the fix and never after it; rows went 13 → 0 → 12 before and stayed at 12 after; the clicked row stayed in place; unread dropped 12 → 11.
  - Tabs: document page then Core in the sidebar went from 1 tab to 2, with both paths under the `tacos.tabs.v1.…` key. Before the fix the document path was written to `tacos.tabs.closed.…`.

## Release and deploy (done)

- Built from `main` at `128740f` with `package.json` at 2.5.2: `npm run build` and
  `npm run server:bundle -- --target=linux-x64`, packed as
  `TaCos-Server-2.5.2-linux-x64.tar.gz` (24 MB).
- Deployed to `ubuntu@43.130.57.28` with `deploy/install.sh`. The installer took the
  pre-upgrade backup `pre_upgrade-2026-11-09_15-22-21-00b3` (appVersion 2.5.1, integrity
  ok) before replacing the app. The previous 2.5.1 stays at `/opt/tacos/app.old`.
- Verified: `tacos.service` active with 0 restarts; `/api/health` reports
  `version: 2.5.2`, `status: ok`, `integrity: ok`, schemaVersion 678, ~30.3 GB free;
  `/login` returns 200. Data counts match the pre-upgrade baseline: 7 users, 3
  workspaces, 26 issues, 15 pages, 8 comments, 8 agent threads, 57 notifications.
  `journalctl -u tacos` shows no errors since the restart.
- The served client bundle contains `data-nav-new-tab`, so the tab fix is in the build
  that is running.
- Rollback: `sudo /opt/tacos/deploy/rollback.sh` (refuses without a verified pre-upgrade
  backup).

## Not done

- No tag and no GitHub release: the desktop installers would carry a version with no
  changes of their own. The next desktop release picks up 2.5.2 as its base.
- No check over the tunnel with a real member account. The site admin is not a workspace
  member and member passwords are not known, so the inbox and tab fixes were verified on
  a local instance instead.
