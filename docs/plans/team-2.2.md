# TaCos 2.2 team collaboration plan

Branch: `feat/team-2.2`. Every session reads this file and `git log`, runs the smoke test, takes the first item whose status is `todo`, and commits that one item.

Smoke test: `npx tsc --noEmit && npm run -s i18n:check && npx tsx scripts/check-agents-md.ts`.

Status values: `todo`, `doing`, `done`, `blocked`. `done` needs the evidence named under "Pass". A check is never weakened to reach `done`. When the same failure survives two different fixes, mark the item `blocked`, paste the failure output under it, and take the next item.

Item-level checks stay cheap (types, check scripts). End-to-end tests and screenshots run once, on the whole batch, in item 15.

## Decisions

- The server stores data only. Each member's Agent runs on that member's computer with that member's subscription or API.
- Members reach the server through an SSH tunnel. TaCos listens only on server localhost.
- No teamspace layer. Shared means visible to every member of the workspace.
- Public components come first, per `AGENTS.md`: TipTap core + `@tiptap/markdown`, Yjs + Hocuspocus, Pragmatic drag and drop, Uppy + tus, TanStack Table and Virtual, FullCalendar free month view, `diff`, `cmdk`, SQLite FTS5.
- Not used: paid TipTap extensions, BlockNote, ssh2, dnd-kit.

## Items

| # | Item | Status | Pass |
|---|---|---|---|
| 0 | Replace the custom editor with TipTap + `@tiptap/markdown` for documents | done | Round-trip script over real samples shows no unexplained difference |
| 1 | Server mode, SSH tunnel in desktop, deployment files, daily backup, security triage, Linux build | done | Check script: server mode refuses every CLI path; tunnel reconnects after a killed ssh |
| 2 | Agent on the member's computer: outbound runner, capability report without keys, events, approval, cancel, offline notice | done | Check script: turn runs through the runner with server mode on; no key reaches the server |
| 3 | Document versions, restore, updates panel with diff, save conflict prompt | done | Check script: stale save is refused; restore creates a new version |
| 4 | Document trash | done | Check script: delete, restore, purge |
| 5 | Document and paragraph comments, count, @ notify | done | Check script: anchor survives an edit before it; mention creates a notification |
| 6 | Document permissions: visible to all; view, comment or edit per person | done | Check script: each level allows and refuses the right actions |
| 7 | Global search over documents, tasks, comments | done | Check script: 3+ character and 2-character Chinese queries both hit; private documents of others do not |
| 8 | Sidebar shared and private tree, multi-level breadcrumb, document favorites | done | Check script for move rules; screenshots in item 15 |
| 9 | Cover, image and attachment upload with size limit | done | Check script: over-limit upload refused; resumed upload completes |
| 10 | Database on tasks: custom fields, table, board, calendar views, filter, sort | done | Check script for field and filter logic; screenshots in item 15 |
| 11 | Agent partial edit and undo, shown in updates panel | todo | Check script: partial edit leaves other text unchanged; undo restores |
| 12 | Agent workspace-level read and search, cross-workspace read; writes name a target | todo | Check script: write without target refused; no read outside joined workspaces |
| 13 | Hand a task to own Agent, queue while computer is off, write back comment and notify | todo | Check script: queued turn runs when runner returns; write asks for approval by default |
| 14 | Realtime co-editing, presence avatars, cursors | todo | Two clients converge in a check script; if unstable, `blocked` and 2.2 ships without it |
| 15 | Batch E2E and screenshots with real models and new data dirs; fresh-context review; fix findings | todo | Report lists tested and untested |
| 16 | Deploy to the server without touching morula or Caddy; add this Mac's public key | todo | `curl` through the tunnel returns the app; memory measured |
| 17 | Push, open PR; after the user merges by hand, tag `v2.2.0` and publish "TaCos 2.2" | todo | Release has its assets; title set |

## Notes

- Item 0: only documents moved to TipTap (`src/components/document-editor.tsx`). Task descriptions and project overviews keep `markdown-editor.tsx`, because overview comments and rewrites anchor on its selection API. Code blocks in the document editor have no syntax highlighting yet.
- Item 0: `scripts/check-editor-roundtrip.ts` passes on 6 samples. Two differences are on purpose: a wrapped list item becomes one line, and trailing spaces go. `2 * 3 * 4` is written `2 \* 3 \* 4`, because the reader would otherwise read it as italic.
- FTS5: `ENABLE_FTS5` is compiled into better-sqlite3 13.0.3 (`PRAGMA compile_options`) and a trigram table matched a 3-character Chinese query.
- Item 1: `scripts/check-server-mode.ts` drives the tunnel with a fake ssh. The real server is exercised in item 16. The Linux job in the release workflow has not run yet.
- Item 1, security triage of the 11 review findings for server mode. Fixed: a removed member's API key stops working; signing out ends the browser's switch-back right; a password reset ends old sessions and switch-back rights; skill folders are refused on a server. No longer apply on a server: 1 (registration leading to commands, since no CLI starts there) and 10 (approval runs on the server). Registration stays open on a server because only people whose SSH key was added can reach it. Left open, listed for the user: 4 (per-project visibility bypasses; the team has no private projects), 6 (any member can revoke a key), 7 (an admin can demote the owner), 8 (deleted creator's workspaces), 9 (no login rate limit; the tunnel limits who can try), 11 (deleted usernames can be reused).
- Item 2: `scripts/check-runner.ts` drives the real routes and the built runner with a fake pi and a fake model API on loopback. Real harnesses and models are exercised in item 15. Keys on a member's computer live in `~/.tacos/runner/config.json`, mode 0600, not encrypted, and the settings page says so. Anyone with admin on the server, or anyone whose text an Agent reads, can steer that person's Agent on their own computer: approval levels are the guard.
- Item 3: uses `diff` 9.0.0 (BSD-3-Clause) for line diffs. Edits by one person within 10 minutes are one version; each Agent edit is its own. A stale save returns a prompt. A writer who leaves the page with refused text gets that text kept as an `unsaved` version; the page does not change. Each page keeps its newest 200 versions. The panel and prompt are exercised in item 15.
- Item 5: a passage comment stores its quote with 32 characters on each side, in the plain text of the editor document, and finds its place by text. The plan said Yjs relative positions; that would tie comments to item 14, which may be blocked, and text survives the Markdown stored by every other path. A quote that was rewritten leaves the comment in the panel with a note. A reader who cannot edit now gets the read-only editor, so selection and highlights work the same way; embedded pages show as a link card there, as they do for writers.

### Item 6: document permissions

Levels are view, comment and edit (`src/lib/page-level.ts`). A shared page has one level for every member (`pages.share_level`, default edit, as 2.1 behaved), and `page_access` overrides it for one person, up or down. Only the author changes sharing, and a change covers the subtree. A new subpage copies its parent's sharing and people's levels, and creating one needs edit on the parent. Visibility itself stays all or nothing: shared means every member sees it.

### Item 7: global search

`search_fts` (FTS5 trigram) is kept in step by SQL triggers and filled once when an older database opens. Terms of 3+ characters use the index; a query with a shorter term scans with LIKE. `src/lib/search.ts` filters hits by what the person may read: the workspace's project visibility, shared or own documents, nothing deleted. The palette (`cmdk`, Cmd+K) shows documents, tasks and comments, and each comment opens its parent.

### Item 8: sidebar tree, breadcrumb, favorites

`src/components/doc-tree.tsx` shows Shared and Private sections and moves pages with Pragmatic drag and drop plus its tree-item hitbox. `movePage` takes a new parent and a `beforeId`; a page under a parent has the parent's sharing, and a move that changes who can see a page needs its owner. Dropping on a section's heading moves the page to that section's top level. Favorites of documents use `page_favorites` next to the project favorites.

### Item 9: uploads

`@tus/server` with `@tus/file-store` handles `/api/uploads`, and `@uppy/core` with `@uppy/tus` sends files in 5 MB chunks, below the 10 MB that Next's middleware buffers per request. Limits: 25 MB per file (`TACOS_UPLOAD_MAX_MB`), 5 GB per workspace (`TACOS_WORKSPACE_QUOTA_MB`). Starting an upload needs edit on the page, and only the starter may continue it. `/api/files/<id>` checks the reader's access to the page and shows a file inline only when its first bytes are PNG, JPEG, GIF or WebP, so SVG and HTML always download. Files are removed with a purge; unfinished uploads after a day.

### Item 10: database on tasks

- Fields belong to the workspace, not to a project, because Notion's one-database-per-view does not map onto tasks shared across projects. Any member can add a field. Its creator or a workspace admin can delete it, and the server refuses everyone else.
- Filter and sort live in `src/lib/task-view.ts` with no database, so the browser runs them and the check script tests them. They apply to the list, board, table and calendar.
- A view's filter and sort are saved per browser in localStorage. Saved shared views are not built.
- The calendar is a month view. Dragging a task to another day changes its due date. Tasks with no due date are counted above the calendar.
- TanStack Table 9 and FullCalendar 7 are the current major versions. FullCalendar 7 replaces `@fullcalendar/core`, `daygrid` and `interaction` with subpaths of `@fullcalendar/react` and needs `temporal-polyfill`.
