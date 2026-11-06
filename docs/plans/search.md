# U-10: Unified search and command palette

Status: plan for a future PR. No implementation started. Written 2026-11-06
(loop round 3).

## Why

TaCos has a working full-text index and a command palette, but search is still
narrow: it covers documents, tasks and comments only, has no filters or scopes,
and no dedicated results page. As the workspace grows (projects, people, agent
threads, automation rules, attachments), "where is that thing?" becomes a
daily friction point. Every serious work tool treats search as a first-class
surface.

## Current implementation

- SQLite FTS (`search_fts`) over docs, tasks, task comments and doc comments;
  permission-aware (private docs/hidden projects never match); snippets and
  per-kind limit 20 (`src/lib/search.ts`).
- Command palette (`src/components/command-palette.tsx`, cmdk) calls
  `/api/internal/<workspace>/search`, with commands mixed in.
- List header search filters the current list; no search page.
- Not searchable: projects, people, labels, agent threads/messages, attachments,
  automation rules, page comments (doc comments are searchable), workspace
  settings.
- No filters/qualifiers, no recent searches, no sorting, no scopes, no saved
  searches; Chinese short terms fall back to LIKE scans.

## Researched best practice

Linear Search (https://linear.app/docs/search):

- `/` opens global search; `O` `I` for recent issues; `Cmd/Ctrl F` searches the
  current view.
- Command-menu prefixes narrow results: `i` issues, `p` projects, `u` users,
  `t` teams, `l` labels, `f` favorites, `d` documents.
- Filters can be applied after the query (`@` mentions create filters);
  results can sort by relevance/updated/created; up to 500 results; exact
  quoted phrases; stop-word handling.

GitHub search (https://docs.github.com/en/search-github/getting-started-with-searching-on-github/about-searching-on-github):

- Global vs scoped search (repository/org), suggestions and completions in the
  search box, advanced search UI that builds qualifiers, sorting/filtering.
- Search covers many entity types (repos, issues, code, users, commits).

Notion: global search from the sidebar with page/workspace scope and recent
history. The shared pattern: one entry point, fast results, scopes/qualifiers,
recent/suggested items, and permissions respected.

## Comparison

| Capability | TaCos today | Linear | GitHub | Notion |
| --- | --- | --- | --- | --- |
| Global search entry | Command palette (`/` not bound) | `/` + command menu | Search bar + command palette | Sidebar search |
| Entities covered | Docs, tasks, comments | Issues, projects, docs, users, labels | Repos, issues, code, users, commits | Pages, databases, content |
| Scopes | Workspace only | Workspace + current view | Global/repo/org | Workspace/page |
| Filters/qualifiers | None | Filters, `@` in query | Qualifiers + advanced UI | Filters |
| Sorting | None | Relevance/updated/created | Best match/updated | Relevance |
| Recent/suggestions | No | Recent searches/issues | Suggestions/completions | Recent pages |
| Saved searches | No | Views/favorites | — | — |
| Keyboard prefixes | None | `i p u t l f d` | Command palette | — |
| Permissions | Yes | Yes | Yes | Yes |

## Gaps, in priority order

1. **Coverage.** Projects, people, labels, agent threads/messages, attachments
   and automation rules are not searchable.
2. **No filters/scopes.** A result list cannot be narrowed by kind, project,
   assignee, date or status.
3. **No results page.** The palette is the only surface; there is no full-page
   search with sorting, grouping or pagination beyond 20/kind.
4. **No recent/saved searches** or suggestions; every search starts from zero.
5. **Chinese/short-term quality.** FTS trigram needs 3+ characters; short terms
   fall back to LIKE scans, which will not scale.
6. **No keyboard prefixes/scopes**; the palette mixes commands and results.

## Candidate scope (one PR, four commits)

### Commit 1 — Index coverage and ranking

- Extend the index/tables to projects, people, labels, agent threads/messages
  (title + last reply), attachments (name), and automation rules (name/trigger).
- Central `search()` with entity adapters, permission checks and consistent
  ranking (relevance, then updated).
- Snippet generation for each entity; unresolved/deleted rows excluded.

### Commit 2 — Search page and filters

- Full-page search (`/search` or a workspace search route) with query, kind
  tabs, filters (project, assignee, created/updated date, status), sorting and
  pagination; results grouped by kind; keyboard navigation.
- Open result in a peek/panel where relevant, preserving the search state.
- Scoped search: current view/list search stays, but the page can be narrowed
  by project/person from a link.

### Commit 3 — Command palette and scopes

- Bind `/` and `Cmd/Ctrl K` consistently; support prefixes (`i`, `p`, `u`, `d`,
  `a` for agent, `f` for files/attachments) and `@`-style filters.
- Recent searches and recent items; suggestions before typing; commands still
  available alongside results.
- Saved searches can use U-09 shared views; otherwise a personal recent list.

### Commit 4 — Checks and docs

- `check-search-coverage.ts`: every entity type returns expected hits and
  permissions exclude private docs/projects.
- `check-search-filters.ts`: filters/sorts/pagination, Chinese/short terms,
  snippets.
- UI screenshots; README; smoke + harness; performance assertion on a seeded
  dataset (e.g. 10k tasks/1k docs).

## Acceptance criteria

1. Searching returns hits from all supported entity types, with permissions
   applied (existing project/page visibility rules).
2. A full search page supports kind/project/assignee/date filters, sorting and
   pagination; results match the palette for the same query.
3. Keyboard prefixes narrow results; recent searches/items persist per user;
   `/` and `Cmd/Ctrl K` open search consistently.
4. Chinese and short (1-2 character) queries return useful results without a
   full table scan; snippets highlight the match.
5. Search performance on a seeded workspace stays within the agreed budget
   (e.g. < 300 ms server time).
6. Existing command palette commands still work; no regression to list search.
7. tsc, i18n, agents-md, `check:harness` and build pass.

## Out of scope

- Vector/semantic search or AI answers (possible later).
- External search (Slack, GitHub) before #80/U-07.
- Full query language with boolean operators; start with simple qualifiers.
- Search analytics.

## Decisions (accepted 2026-11-06, with a UI design gate)

1. Build **both** the command palette and a full search page.
2. `/` opens the search page; `Cmd/Ctrl K` opens the command palette; both
   return the same results for the same query.
3. v1 covers all listed entities (projects, people, labels, agent threads and
   messages, attachment names, automation rules).
4. Saved searches are personal/recent only in this PR; shared saved searches
   come from U-09's shared views.
5. Chinese search uses FTS5 trigram + LIKE fallback; a CJK tokenizer is a
   follow-up.
6. Permissions reuse the existing project/page visibility rules (no guests).

**UI gate (explicit requirement):** search is a daily-use surface, so the
implementation must be design-reviewed before merge:

- One obvious entry: `/` search page, `Cmd/Ctrl K` palette; no shortcut
  conflicts; palette commands stay separate from results, and prefixes are
  discoverable rather than required.
- Search page layout: query bar, kind tabs, one compact filter row, grouped
  results; empty state shows recent searches/items; loading keeps the previous
  results visible with a subtle skeleton; error/empty states are explicit.
- Palette: no kitchen-sink commands; results and commands visually separated;
  recent queries/items; keyboard navigation and Escape behavior match the rest
  of the app.
- Narrow widths (1100 and 640 container) must remain usable; results and
  filters must not overflow or hide the only entry point.
- A wireframe/screenshot review with the owner is part of the UI commits before
  final polish; acceptance includes screenshots at 1440/1100/640.

## Dependencies

- U-04 for page links/backlinks and templates as searchable entities.
- U-09 for shared saved searches (optional).

## Files likely touched

- `src/lib/search.ts` + new entity adapters; FTS schema/bootstrap changes.
- `/api/internal/[workspace]/search` and a new search route/page.
- `src/components/command-palette.tsx`, new search results components.
- `src/lib/i18n/zh.ts`, README, new checks.
