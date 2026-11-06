# Product roadmap: future PR pipeline

Status: **historical planning record**, superseded for sequencing on
2026-11-06 by `docs/plans/roadmap-5p.md` (five-person internal, desktop-only
team). The individual plan documents remain the detailed reference; U-01, U-06,
U-07 and U-08 are not planned. This file keeps the earlier proposals for
context. Real GitHub PR numbers are assigned when a PR is opened.

The loop this plan runs in: each round deep-dives one or two product areas,
writes or updates a plan document, opens a draft plan PR, and reports back. No
production code is written until the owner approves a plan and says to start.

## 1. Current product surface

| Area | What exists today | Notes / gaps |
| --- | --- | --- |
| Workspaces & identity | Multi-workspace, join-code invite link (`/join/<code>`), owner/admin/member roles, leave, 30-day recycle bin, site super-admin at `/admin` | No guest role, no email invite, no SSO |
| Sharing & permissions | Private pages shared to the workspace with view/comment/edit and per-member overrides (subtree-wide); project membership drives task visibility when `membersSeeAllTasks=0`; project overview grants (comment/edit); agent threads private/shared | **Not planned (U-01): company-internal use only.** Current workspace-internal sharing stays as-is; no guests/public links/private projects |
| Projects | Markdown overview, resources, icons/colors, favorites, 30-day trash | No project visibility toggle beyond membership; no project-level admin |
| Tasks | List/board/table/calendar, subtasks, dependencies, recurrence, claims, review status, blockers, labels, priorities, multiple assignees, custom task fields, comments, activity | No per-task sharing, no saved shared views, no cycles/milestones |
| Documents | Page tree, private/shared, version history (200/page), comments, Yjs live collaboration, attachments, cover/icon, AI inline edit, project documents | No version-diff review UI, no backlinks, no templates, no global document search UI |
| Collaboration | Comments, mentions, in-app Inbox, live refresh (1.5 s), activity timeline | No presence indicators, no email/push channels |
| Search & navigation | Command palette (cmdk), list search/filters, saved personal views, `src/lib/search.ts` | No unified search across tasks/docs/comments/projects |
| Notifications | In-app Inbox + unread badge; #78 overhauls it | No email/push |
| Agent | Chat threads, 5 CLI harnesses, approvals, handoff runs, shared threads, skills; #79 upgrades identity/delegation/review/usage | No built-in API loop yet, no native sessions/compaction (in #79) |
| Agent access | REST API keys + stdio MCP server; #77 adds scopes/expiry/remote MCP | — |
| Automations | None; #80 is an internal-rules-only plan, deferred, no integrations | No code exists |
| Insights & analytics | None | No dashboards, cycle time or usage reporting |
| Planning | None | No cycles, milestones, roadmap, goals |
| Desktop & self-host | Thin/standalone Electron builds, auto-update, server mode + SSH tunnel + desktop runner, storage/recovery settings | No mobile/PWA, no hosted option |
| Enterprise & governance | Roles, admin page, audit events in the activity stream | No SSO/OIDC, no admin audit UI, no retention policy, no data export |
| Import/export | None | No workspace export/import, no public API beyond REST/MCP |
| Channels & mobile | Desktop app only | No email, push, PWA or mobile app |

## 2. Benchmark references

Sharing and permissions (benchmarked in round 1; U-01 is deferred — the company uses TaCos internally only):

- Notion: share with one person inside/outside the workspace (guests), everyone
  at the workspace, or anyone on the web with a link and expiry;
  view/comment/edit levels. https://www.notion.com/help/share-your-work
- Linear: private teams limited to members, team membership management, guest
  role, issue sharing from a private team to specific people, export and API
  caveats. https://linear.app/docs/private-teams
- Google Drive: share with people/groups, visitor sharing for people without a
  Google account, link sharing with expiration and access levels.
  https://support.google.com/drive/answer/9195194
- Confluence: space/page permissions, anonymous access vs public links.
  https://support.atlassian.com/confluence-cloud/
- GitHub: repository visibility and outside collaborators.
  https://docs.github.com/en/organizations/managing-access-to-your-organizations-repositories/adding-outside-collaborators-to-repositories-in-your-organization
- Figma: team/org roles, link access (view/comment/edit).
  https://help.figma.com/hc/en-us/articles/360039482274

Areas deep-dived by rounds, with their reference products:

| Round | Areas | Benchmark products | Status |
| --- | --- | --- | --- |
| 1 | Product surface + sharing/permissions | Notion, Linear, Google Drive, Confluence, GitHub, Figma | done → `sharing-permissions.md` (deferred) |
| 2 | Tasks/views/planning/insights | Linear, Asana, ClickUp | done for planning/insights → `planning.md`, `insights.md`; the views/task-UX slice is U-09 |
| 3 | Docs/search/collaboration/notifications | Notion, Linear, GitHub, Google Docs, Slack | done → `docs-knowledge.md`, `search.md`, `collaboration.md`; notifications covered by #78 (in-app), U-11 (collab) and U-08 (channels) |
| 4 | Agent/automations/platform, views/task UX, self-host ops | A2A, MCP, Claude/Codex, Linear, GitHub, desktop/self-host best practice | done → `external-agents.md`, `views-task-ux.md`, `self-host-ops.md` |
| 5 | Enterprise/import-export/channels | Linear members/roles + audit log, Notion enterprise, GitHub, notification channels | done → `enterprise-governance.md`, `import-export.md`, `channels-mobile.md` |

## 3. Gap and priority matrix

Priority: P0 blocks team growth or external collaboration; P1 high product
value; P2 later / depends on other work.

| Area | Main gap | Priority | Proposed PR |
| --- | --- | --- | --- |
| Insights & analytics | No reporting on flow, delegation, agent usage | P1 (after #79/#80 data) | U-02 |
| Planning | No cycles/milestones/roadmap/goals | P1 | U-03 |
| Docs & knowledge | Backlinks/templates/outline missing (version diff, comments, presence exist) | P1 | U-04 |
| Search | FTS covers docs/tasks/comments only; no filters/scopes/page | P2 | U-10 |
| Collaboration depth | Task comments flat; no follow/watchers; no workspace activity feed | P2 | U-11 |
| Import/export & portability | No workspace export/import | P2 (anti-lock-in, pairs with enterprise) | U-05 |
| Desktop & self-host ops | No health/diagnostics, backup restore UX, update channels | P2 (operational trust) | U-12 |
| External API/MCP coverage | Tasks/comments/labels only; no projects CRUD, pages, task extensions | P1 (after #77) | U-13a/U-13b |
| Views & task UX | Personal saved views only; no shared views/subscriptions/display options | P2 (can pull forward) | U-09 |

## 4. Upcoming PR sequence

Each PR is planned before it is implemented: a plan document under
`docs/plans/`, a draft plan PR, then a separate implementation PR after owner
approval. One PR per item unless the owner asks to split.

### U-01 — Sharing and permissions (deferred, not planned)

Decision 2026-11-06: TaCos is used by internal company members only, so
external guests, public/expiring links, first-class private projects/tasks and
share audit are **not planned**. The deep dive stays at
`docs/plans/sharing-permissions.md` as a benchmark record. Revisit only if
external collaborators become a real requirement; until then the existing
workspace-internal page/project sharing is unchanged.

### U-02 — Insights and analytics

Plan: `docs/plans/insights.md`.
Benchmarks: Linear Insights, Asana dashboards, ClickUp dashboards.
Scope: task flow/cycle time/lead time/WIP, backlog and completion trends,
delegation and agent coverage, token/subscription utilization from #79,
automation impact from #80; workspace/project/agent dashboards, filters, share
link, CSV export. Depends on #79/#80 data for the agent/automation panels; core
task metrics can ship without them.

### U-03 — Planning layer

Plan: `docs/plans/planning.md`.
Benchmarks: Linear cycles/milestones/initiatives, Asana goals/portfolio/timeline.
Scope: cycles with rollover/auto-add/capacity, project milestones with progress,
workspace initiatives and a roadmap/timeline, plus insights/automation hooks;
keeps existing board/list/calendar views.

### U-04 — Documents and knowledge depth

Plan: `docs/plans/docs-knowledge.md`.
Benchmarks: Notion, Confluence, Google Docs.
Current strengths to keep: version history + diff + restore, quoted threaded
comments with resolve, Yjs live collaboration with presence, attachments.
Scope: page links and a backlinks panel, templates (workspace/project), table of
contents/anchors, version lifecycle polish, and links/templates as searchable
entities. Block/database editing stays out.

### U-05 — Import, export and data portability

Plan: `docs/plans/import-export.md`.
Scope: canonical workspace export (JSON + markdown docs + task CSV +
attachments zip), import from Notion/Markdown/Linear CSV with dry-run mapping,
owner/admin-only API/CLI export, audit and no secrets in output. Pairs with U-12
backup UX; prevents lock-in.

### U-06 — Enterprise and governance (deferred, not planned)

Decision 2026-11-06: TaCos is a 5-person internal team; SSO/SCIM, security audit
UI, retention policies and the admin console are **not planned**. The plan stays
at `docs/plans/enterprise-governance.md` as a benchmark record. Revisit only if
the company grows or TaCos is offered to other teams.

### U-07 — External agent platform (deferred, not planned)

Decision 2026-11-06: TaCos runs **internal agents only**. External A2A agents,
a registry and remote delegation are **not planned**. The plan stays at
`docs/plans/external-agents.md` as a benchmark record; revisit only if external
agents become a real requirement.

### U-08 — Channels and mobile (deferred, not planned)

Decision 2026-11-06: the team works at the computer only, so email, web push,
PWA/mobile and digests are **not planned**. In-app Inbox (#78) is the only
notification surface. The plan stays at `docs/plans/channels-mobile.md` as a
benchmark record.

### U-09 — Views and task UX

Plan: `docs/plans/views-task-ux.md`.
Benchmarks: Linear Custom Views + Display options, GitHub Projects views, Asana
saved views.
Scope: shared workspace/project views (today `personal_task_views` is
per-user), view subscriptions, display options (layout/grouping/ordering/
property visibility/defaults), bulk edit, task templates, optional estimate
field needed by U-03. Small-to-medium; can be pulled forward because it improves
every other feature.

### U-10 — Unified search and command palette

Plan: `docs/plans/search.md`.
Benchmarks: Linear Search, GitHub search, Notion search.
Scope: extend the FTS index to projects, people, labels, agent threads,
attachments and automation rules; a full results page with kind/project/
assignee/date filters, sorting and pagination; keyboard prefixes/recent items;
CJK/short-term quality; permissions for guests/private projects. Today the
palette covers docs/tasks/comments only with no filters or scopes.

### U-11 — Collaboration depth

Plan: `docs/plans/collaboration.md`.
Benchmarks: Linear, GitHub, Google Docs, Notion.
Scope: threaded/editable/deleteable/reactionable task comments (page comments
already have threads/quotes/resolve), explicit follow/unfollow with watchers
(auto-follow on create/assign/mention/comment), a workspace activity feed, and
review comments attached to the review state (agent review from #79 reuses it).
Presence is docs-only today; acceptable.

### U-12 — Desktop and self-host operations

Plan: `docs/plans/self-host-ops.md`.
Benchmarks: desktop update/diagnostics practices (VS Code, Linear, Obsidian) and
self-host backup/health/upgrade practices.
Scope: System health/diagnostics page + bundle, verified backup/restore UI and
pre-upgrade backup, desktop update channel/notes/rollback guidance, admin
runner/tunnel status, server upgrade preflight/rollback. Signing/notarization
certificates stay with the owner.

### U-13 — External API / MCP surface expansion

Plan: `docs/plans/api-surface.md`.
Added 2026-11-06 after reviewing what the external API/MCP actually cover.
Benchmarks: Linear GraphQL API, Notion API, GitHub REST, Asana API.
Scope (two implementation PRs): **U-13a** projects CRUD + project membership +
task extensions (custom fields, dependencies, recurrence, claims, review,
blockers, trash restore); **U-13b** pages/documents list/read/create/edit +
page comments; page sharing changes stay out of scope (existing web UI only). All new surface reuses #77 scopes and
project allowlists, with MCP annotations/pagination/output schemas. Attachments,
Inbox, search and API webhooks are recorded as later follow-ups.

### Small continuous PRs

- UI/perf fixes from fresh-context reviews.
- Keyboard/command palette polish (fold into U-10).

These still get a plan note before coding, but can ride along with their area.

## 5. Loop and round plan

This roadmap is produced by the goal loop the owner requested. Each round:

1. Pick one or two areas from the round table.
2. Research the benchmark products and read the current code for that area.
3. Update this roadmap (gaps, priority, PR sequence) and write the area's plan
   document with comparison table, scope, acceptance criteria, checks, open
   decisions.
4. Commit and open/update a draft plan PR.
5. Report what changed and what the next round will cover.

Round 1 (done): product surface inventory, sharing/permissions deep dive, this
roadmap, draft PR #81 (`docs/plans/sharing-permissions.md`).

Round 2 (done): planning (`docs/plans/planning.md`) and insights
(`docs/plans/insights.md`), plus the plan template; U-09 recorded for the
views/task-UX slice.

Round 3 (done): docs knowledge (`docs-knowledge.md`), unified search
(`search.md`) and collaboration depth (`collaboration.md`); notifications are
covered by #78 (in-app) and U-11 (comments/follow).

Round 4 (done): external agents/platform (`external-agents.md`), views and task
UX (`views-task-ux.md`), desktop/self-host operations (`self-host-ops.md`).

Round 5 (done): enterprise/governance (`enterprise-governance.md`), import/
export (`import-export.md`), channels/mobile (`channels-mobile.md`).

Round 6 (next): consolidate the PR sequence and implementation waves below,
verify every area has a plan, then mark the loop complete. Implementation starts
only after the owner approves the plans.

## 6. Implementation order (historical proposal; use roadmap-5p.md)

The waves below were the pre-reset proposal. The active five-person sequence is
in `docs/plans/roadmap-5p.md`.

1. **Foundation (small, independent)**: #78 Inbox → #77 Agent access →
   U-13a external projects/task surface.
2. **Agent and automation value**: #79 Agent → #80 automations/integrations →
   U-09 views/task UX.
3. **Knowledge and flow**: U-04 documents → U-13b external pages API → U-10
   search → U-11 collaboration → U-03 planning.
4. **Insight and operations**: U-02 insights → U-05 import/export → U-12
   desktop/self-host ops.
No channel/mobile work is planned: the team uses TaCos at the computer only.
Enterprise governance, external agents, sharing and channel work are all
deferred (5-person internal team).

Each implementation PR references its plan document, updates the plan status,
ships one item per commit, and must pass the smoke test, `check:harness`, build
and the checks named in the plan.

All plans live in this draft PR (#81) until implementation is approved; each
plan's status is updated when its implementation PR starts.

## 7. Open decisions for the owner

All active areas have a plan; U-01, U-06, U-07 and U-08 are deferred. Remaining
choices before implementation:

1. Approve the recommended implementation waves above, or reorder them.
2. U-12: are code-signing/notarization certificates available (owner action)?

Plan PRs are draft #77-#81; no code has been written.
