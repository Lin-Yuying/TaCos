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

Areas still to deep-dive in later rounds (with their reference products):

| Round | Areas | Benchmark products |
| --- | --- | --- |
| 2 | Tasks/views/planning/insights | Linear, Asana, Height, ClickUp |
| 3 | Docs/search/collab/notifications | Notion, Confluence, Slack, Google Docs |
| 4 | Agent/automations/platform | Claude Code/Agent SDK, Codex, Cursor, OpenHands, A2A, MCP |
| 5 | Enterprise/desktop/import-export/channels | Linear/Notion enterprise, GitHub, mobile-first tools |

## 3. Gap and priority matrix

Priority: P0 blocks team growth or external collaboration; P1 high product
value; P2 later / depends on other work.

| Area | Main gap | Priority | Proposed PR |
| --- | --- | --- | --- |
| Sharing & permissions | External guests/public links, private projects/tasks, access audit, invite flow | P0 | U-01 |
| Insights & analytics | No reporting on flow, delegation, agent usage | P1 (after #79/#80 data) | U-02 |
| Planning | No cycles/milestones/roadmap/goals | P1 | U-03 |
| Docs & knowledge | No version-diff review, backlinks, templates, unified doc search | P1/P2 | U-04 |
| Import/export & portability | No workspace export/import | P2 (anti-lock-in, pairs with enterprise) | U-05 |
| Enterprise & governance | No SSO/OIDC, audit UI, retention, admin console | P2 (when team grows or TaCos is shared externally) | U-06 |
| External agent platform | No A2A/registry/external agents | P2 (after #80 automations) | U-07 |
| Channels & mobile | No email/push/PWA/mobile | P2/P3 | U-08 |
| Search & command palette | Partial; no unified search | P2 (can fold into U-04 or a small PR) | — |

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

Benchmarks: Linear Insights, Asana dashboards.
Scope: task flow/cycle time, backlog and completion trends, delegation/agent
coverage, token and subscription utilization from #79, automation impact from
#80; workspace dashboards, filters and export. Depends on #79/#80 data.

### U-03 — Planning layer

Benchmarks: Linear cycles/roadmap/initiatives, Asana goals/timeline.
Scope: cycles/sprints, milestones, roadmap view, goals and progress, timeline;
integrates with existing board/list/calendar.

### U-04 — Documents and knowledge depth

Benchmarks: Notion, Confluence.
Scope: version-diff review and restore UI (history already exists), backlinks,
templates, unified document search, block/page references, possibly public
pages later (but public sharing is part of U-01).

### U-05 — Import, export and data portability

Scope: workspace export (JSON/markdown/attachments), import from Notion/
Linear/Markdown, backup/restore UX. Pairs with enterprise governance and
prevents lock-in.

### U-06 — Enterprise and governance

Scope: SSO/OIDC, SCIM or invite domain controls, project-level admin and
permission templates, admin audit UI, retention policy, data residency/export,
security settings. Do when the team or customers need it.

### U-07 — External agent platform

Scope: A2A server/client support, agent registry and discovery, permissions for
external agents, plugin/marketplace seed. Depends on U-05/U-06 for governance
and #80 for action targets.

### U-08 — Channels and mobile

Scope: email notifications, push, PWA/mobile-friendly shell, notification
preferences per channel. Can be pulled earlier if the team works away from the
desktop app.

### Small continuous PRs

- Unified search and command-palette expansion.
- Notification channel polish.
- UI/perf fixes from fresh-context reviews.

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
roadmap, draft PR with `docs/plans/sharing-permissions.md`.

Round 2: tasks/views/planning/insights.
Round 3: docs/search/collaboration/notifications.
Round 4: agent/automations/platform.
Round 5: enterprise/desktop/import-export/channels.
Round 6: consolidate, finalize the PR sequence, and prepare implementation
orders. Implementation starts only after the owner approves the plans.

## 6. Open decisions for the owner

1. Confirm U-01 (sharing/permissions) as the next planned block after
   #77-#80, or move U-02/U-03 ahead.
2. Scope of U-01: internal-only sharing first, or external guests + public
   links in the same PR?
3. Should private projects be part of U-01 or a separate smaller PR?
4. Import/export: before or after enterprise governance?
5. How many deep-dive rounds before implementation starts: continue the loop
   until every area has a plan (recommended), or stop after the next few.
