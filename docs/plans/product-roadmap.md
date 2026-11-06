# Product roadmap: future PR pipeline

Status: living plan, round 1 (2026-11-06). Plans first, implementation later,
one PR at a time. Existing plans are #77 (Agent access), #78 (Inbox), #79
(Agent) and #80 (automations/integrations). This document tracks everything
after them as **U-01, U-02, …** (upcoming PRs); real GitHub PR numbers are
assigned when a plan/implementation PR is opened.

The loop this plan runs in: each round deep-dives one or two product areas,
writes or updates a plan document, opens a draft plan PR, and reports back. No
production code is written until the owner approves a plan and says to start.

## 1. Current product surface

| Area | What exists today | Notes / gaps |
| --- | --- | --- |
| Workspaces & identity | Multi-workspace, join-code invite link (`/join/<code>`), owner/admin/member roles, leave, 30-day recycle bin, site super-admin at `/admin` | No guest role, no email invite, no SSO |
| Sharing & permissions | Private pages shared to the workspace with view/comment/edit and per-member overrides (subtree-wide); project membership drives task visibility when `membersSeeAllTasks=0`; project overview grants (comment/edit); agent threads private/shared | No external guests, no public/expiring links, no per-task sharing, no share audit UI; see `docs/plans/sharing-permissions.md` (U-01) |
| Projects | Markdown overview, resources, icons/colors, favorites, 30-day trash | No project visibility toggle beyond membership; no project-level admin |
| Tasks | List/board/table/calendar, subtasks, dependencies, recurrence, claims, review status, blockers, labels, priorities, multiple assignees, custom task fields, comments, activity | No per-task sharing, no saved shared views, no cycles/milestones |
| Documents | Page tree, private/shared, version history (200/page), comments, Yjs live collaboration, attachments, cover/icon, AI inline edit, project documents | No version-diff review UI, no backlinks, no templates, no global document search UI |
| Collaboration | Comments, mentions, in-app Inbox, live refresh (1.5 s), activity timeline | No presence indicators, no email/push channels |
| Search & navigation | Command palette (cmdk), list search/filters, saved personal views, `src/lib/search.ts` | No unified search across tasks/docs/comments/projects |
| Notifications | In-app Inbox + unread badge; #78 overhauls it | No email/push |
| Agent | Chat threads, 5 CLI harnesses, approvals, handoff runs, shared threads, skills; #79 upgrades identity/delegation/review/usage | No built-in API loop yet, no native sessions/compaction (in #79) |
| Agent access | REST API keys + stdio MCP server; #77 adds scopes/expiry/remote MCP | — |
| Automations & integrations | None; #80 plans rules + webhooks + Slack/GitHub | No code exists |
| Insights & analytics | None | No dashboards, cycle time or usage reporting |
| Planning | None | No cycles, milestones, roadmap, goals |
| Desktop & self-host | Thin/standalone Electron builds, auto-update, server mode + SSH tunnel + desktop runner, storage/recovery settings | No mobile/PWA, no hosted option |
| Enterprise & governance | Roles, admin page, audit events in the activity stream | No SSO/OIDC, no admin audit UI, no retention policy, no data export |
| Import/export | None | No workspace export/import, no public API beyond REST/MCP |
| Channels & mobile | Desktop app only | No email, push, PWA or mobile app |

## 2. Benchmark references

Sharing and permissions (U-01, deep-dived in round 1):

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
| 1 | Product surface + sharing/permissions | Notion, Linear, Google Drive, Confluence, GitHub, Figma | done → `sharing-permissions.md` |
| 2 | Tasks/views/planning/insights | Linear, Asana, ClickUp | done for planning/insights → `planning.md`, `insights.md`; the views/task-UX slice is U-09 |
| 3 | Docs/search/collaboration/notifications | Notion, Linear, GitHub, Google Docs, Slack | done → `docs-knowledge.md`, `search.md`, `collaboration.md`; notifications covered by #78 (in-app), U-11 (collab) and U-08 (channels) |
| 4 | Agent/automations/platform, views/task UX, self-host ops | A2A, MCP, Claude/Codex, Linear, GitHub, desktop/self-host best practice | done → `external-agents.md`, `views-task-ux.md`, `self-host-ops.md` |
| 5 | Enterprise/import-export/channels | Linear members/roles + audit log, Notion enterprise, GitHub, notification channels | done → `enterprise-governance.md`, `import-export.md`, `channels-mobile.md` |

## 3. Gap and priority matrix

Priority: P0 blocks team growth or external collaboration; P1 high product
value; P2 later / depends on other work.

| Area | Main gap | Priority | Proposed PR |
| --- | --- | --- | --- |
| Sharing & permissions | External guests/public links, private projects/tasks, access audit, invite flow | P0 | U-01 |
| Insights & analytics | No reporting on flow, delegation, agent usage | P1 (after #79/#80 data) | U-02 |
| Planning | No cycles/milestones/roadmap/goals | P1 | U-03 |
| Docs & knowledge | Backlinks/templates/outline missing (version diff, comments, presence exist) | P1 | U-04 |
| Search | FTS covers docs/tasks/comments only; no filters/scopes/page | P2 | U-10 |
| Collaboration depth | Task comments flat; no follow/watchers; no workspace activity feed | P2 | U-11 |
| Import/export & portability | No workspace export/import | P2 (anti-lock-in, pairs with enterprise) | U-05 |
| Desktop & self-host ops | No health/diagnostics, backup restore UX, update channels | P2 (operational trust) | U-12 |
| Enterprise & governance | No SSO/OIDC, audit UI, retention, admin console | P2 (when team grows or TaCos is shared externally) | U-06 |
| External agent platform | No A2A/registry/external agents | P2 (after #80) | U-07 |
| Channels & mobile | No email/push/PWA/mobile | P2/P3 | U-08 |
| Views & task UX | Personal saved views only; no shared views/subscriptions/display options | P2 (can pull forward) | U-09 |

## 4. Upcoming PR sequence

Each PR is planned before it is implemented: a plan document under
`docs/plans/`, a draft plan PR, then a separate implementation PR after owner
approval. One PR per item unless the owner asks to split.

### U-01 — Sharing and permissions (next after #77-#80)

Deep dive: `docs/plans/sharing-permissions.md`. Adds external guests, share
links with expiry, first-class private projects/tasks, a unified share dialog,
"shared with me", and share audit. Foundational for external collaboration and
for scoping agents/API access.

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
backup UX and U-06 governance; prevents lock-in.

### U-06 — Enterprise and governance

Plan: `docs/plans/enterprise-governance.md`.
Scope: OIDC SSO (SAML/SCIM follow-ups), domain auto-join/SCIM provisioning,
role matrix, owner/admin security audit log (90 days default, filter/API/
webhook), retention policies, session controls and an admin console. Do when
the team or customers need it.

### U-07 — External agent platform

Plan: `docs/plans/external-agents.md`.
Scope: external agent registry (Agent Card discovery, auth, project scope),
A2A client for delegation with streaming/push, optional minimal A2A server to
expose TaCos tasks to an orchestrator, permissions and audit. Depends on #79,
#77, #80 and U-01; OAuth/enterprise federation later.

### U-08 — Channels and mobile

Plan: `docs/plans/channels-mobile.md`.
Scope: per-event channel preferences (in-app/email/push/Slack), SMTP delivery
with queue/retries/unsubscribe, web push + installable PWA (native apps later),
quiet hours and digest, read-state sync. Can be pulled earlier if the team works
away from the desktop app.

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

### Small continuous PRs

- Notification channel polish (fold into U-08).
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
covered by #78 (in-app), U-11 (comments/follow) and U-08 (channels).

Round 4 (done): external agents/platform (`external-agents.md`), views and task
UX (`views-task-ux.md`), desktop/self-host operations (`self-host-ops.md`).

Round 5 (done): enterprise/governance (`enterprise-governance.md`), import/
export (`import-export.md`), channels/mobile (`channels-mobile.md`).

Round 6 (next): consolidate the PR sequence and implementation waves below,
verify every area has a plan, then mark the loop complete. Implementation starts
only after the owner approves the plans.

## 6. Implementation order (recommended waves)

The plans are written; the owner still chooses the order. Recommended waves
respect dependencies and put value early:

1. **Foundation (small, independent)**: #78 Inbox → #77 Agent access → U-01
   sharing/permissions.
2. **Agent and automation value**: #79 Agent → #80 automations/integrations →
   U-09 views/task UX.
3. **Knowledge and flow**: U-04 documents → U-10 search → U-11 collaboration →
   U-03 planning.
4. **Insight and operations**: U-02 insights → U-05 import/export → U-12
   desktop/self-host ops.
5. **Enterprise and platform**: U-06 enterprise/governance → U-07 external
   agents → U-08 channels/mobile.

Each implementation PR references its plan document, updates the plan status,
ships one item per commit, and must pass the smoke test, `check:harness`, build
and the checks named in the plan.

All plans live in this draft PR (#81) until implementation is approved; each
plan's status is updated when its implementation PR starts.

## 7. Open decisions for the owner

All areas now have a plan; these are the choices before implementation starts.

1. Approve the recommended implementation waves above, or reorder them.
2. U-01 (sharing/permissions) scope: internal-only sharing first, or external
   guests + public links in the same PR?
3. U-01: should private projects be part of it or a separate smaller PR?
4. U-03 cycles scope: workspace-wide or per-project?
5. U-08 channels: email first or PWA/web push first?
6. U-06 SSO: OIDC only first or SAML too?
7. U-07 external agents: client + registry only, or also the A2A server?
8. U-12: are code-signing/notarization certificates available (owner action)?

Plan PRs are draft #77-#81; no code has been written.
