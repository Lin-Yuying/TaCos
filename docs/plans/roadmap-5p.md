# TaCos roadmap for a 5-person internal team

Status: **recommended reset, 2026-11-06.** Supersedes the sequencing in
`product-roadmap.md` while keeping the deeper plan documents. No production code
has been written for the items below.

## Context and principles

TaCos is used by **five internal people**, on their computers. There is no
external sharing, no external agents, no email/push/mobile and no third-party
integrations. That removes a large part of the previous roadmap.

Principles:

1. Build only what removes a recurring daily friction for these five people.
2. Prefer small PRs; defer features until someone asks twice.
3. Keep the existing workspace model (projects, tasks, docs, in-app Inbox,
   CLI/API agents); no new permissions/enterprise layer.
4. Each implementation PR gets a real end-to-end test, not just checks.
5. Deferred plans stay in `docs/plans/` as design records.

## What is worth building now

### 0. Merge the Inbox (#82)

Already implemented and E2E-tested: triage, structured notifications, Done,
snooze, mutes, 90-day retention. Merge it first; it is the daily notification
surface.

### 1. Agent essentials (trimmed #79)

The current Agent tab works with local CLI harnesses, but server mode needs the
desktop runner and task delegation/review is missing. Keep only:

- **Built-in API Agent**: server-side loop using the existing Model API
  settings; used when the desktop runner is offline.
- **Delegation and review**: delegate a task to a workspace/personal agent,
  human keeps ownership, approve / request changes / retry, Inbox
  notifications.
- **Token usage**: record and show tokens per run/thread; observe-only.

Defer from the original #79 plan: subscription-remaining UI, ACP adapter,
native harness resume/session contract, governance/audit, automation triggers,
A2A.

Why now: it makes the Agent usable on the shared server without every person's
desktop runner, and puts agent work on tasks where the team already looks.

### 2. Task UX essentials (trimmed U-09)

Keep the two things five people will use daily:

- Multi-select bulk edit: status, assignee, priority, labels, due date, project.
- Display options: layout, grouping, ordering, property visibility per view
  (personal, not shared).

Defer: shared workspace/project views, view subscriptions, task templates,
estimate field, cross-group drag complexity.

Why: the team already lives in task lists/boards; bulk edit and a couple of
display controls remove repetitive work without building a view platform.

### 3. Operations essentials (trimmed U-12)

Keep the safety net for the self-hosted/server setup:

- System health page: version, DB size/integrity, disk, uptime, backup age.
- Verified backup + restore from the UI, with typed confirmation and a safety
  backup before restore.

Defer: update channels/rollback UX, diagnostics bundle, runner admin page,
signing/notarization, deploy preflight.

Why: five people depend on the server; verified backups and a visible health
page are cheap insurance. The rest of U-12 is platform polish.

## Backlog (defer until asked)

- **#77 Agent access + U-13 external API/MCP surface**: no external consumers
  yet; built-in Agent does not need them.
- **#80 internal automations**: integrations removed; rules can wait until
  manual coordination is a real bottleneck.
- **U-10 search**: current command palette/list search covers docs, tasks and
  comments; corpus is small.
- **U-11 collaboration**: comments/activity already work for five people;
  threads/follow/workspace activity can wait.
- **U-03 planning**: projects + due dates are enough for now; cycles,
  milestones and initiatives are heavy.
- **U-02 insights**: five people can see the work directly; no analytics.
- **U-05 import/export**: no migration need; backups cover the safety case.
- **U-04 documents depth**: current docs/editor/version/comments are strong;
  backlinks/templates wait until the knowledge base is actually used.
- **U-13b page API**: with #77/U-13.

## Not planned

- U-01 Sharing and permissions (internal only).
- U-06 Enterprise/governance (5-person team).
- U-07 External agents/A2A (internal agents only).
- U-08 Channels/mobile (desktop only).
- Slack, GitHub, webhook and all other integrations.

## Recommended order

1. Merge **#82 Inbox**.
2. **Agent essentials** (one PR, three commits).
3. **Task UX essentials** (one PR, two commits).
4. **Operations essentials** (one PR, two commits).
5. Revisit the backlog only when there is a concrete request.

Each PR: tsc, i18n, `check:harness`, build, plus a real browser E2E of the
changed flow; screenshots at 1440/1100 where UI changed.
