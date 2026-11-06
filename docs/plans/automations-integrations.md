# Automations (internal only)

Status: **deferred for now** and trimmed on 2026-11-06 for a 5-person internal
team. Internal rules only: **no Slack, GitHub, inbound/outbound webhooks or any
other integration**. No implementation started.

## Why

The repository has no internal automation/workflow code. For a 5-person team
this is a convenience, not a must-have; the plan is kept only for rules that act
inside TaCos ("when X happens, do Y", including delegating to an agent). Revisit
when manual coordination is actually a bottleneck.

Existing pieces to build on:

- Inbox (#78) notification surface.
- Agent (#79) delegation, review and runs.
- Workspace revisions + `LiveRefresh` as the signal source.
- Reminders/due-soon notifications for "due" triggers.
- Events/activity stream for the run log.
- No new daemon is needed for the first version.

## Benchmarks

- Linear triage rules: trigger + conditions + actions, including delegating to
  an agent. https://linear.app/docs/assigning-issues.md
- Notion Custom Agents: schedule/event triggers, explicit grants, activity and
  audit. https://www.notion.com/help/custom-agents
- Asana workflow builder: rules with project/task conditions.
  https://www.atlassian.com/software/rovo

Common pattern: **trigger + conditions + actions**, with permissions, an
execution log and loop protection. External delivery is not required for the
internal plan.

## Candidate scope (one PR, three commits)

### Commit 1 — Rule engine and data model

- Tables `automation_rules` (workspace, name, enabled, creator, trigger,
  conditions JSON, actions JSON, last run, version) and `automation_runs`
  (rule, event, status, action results, error, duration, idempotency key,
  timestamps). Audit configuration changes.
- Triggers: task created, status changed, assigned, claimed/released, delegated
  to an agent, due soon, comment added, mention, agent run finished/failed,
  document updated. Store the schema generically; expose only the triggers the
  team uses.
- Conditions: project, label, priority, assignee presence, text contains,
  status, and "not triggered by this rule" loop protection.
- Actions (internal only): set status/assignee/labels, add comment, notify
  users, delegate/start a workspace agent run, create a document/task.
  Actions execute in order; failures do not roll back earlier actions and are
  recorded.
- Evaluator: called from the business layer after mutations and from the
  revision path; idempotency key per `(rule, event)`; bounded retries for
  in-process actions.

### Commit 2 — Settings → Automations UI

- Owner/admin create rules from templates ("when assigned, delegate to agent",
  "when status is review, comment and notify", "when due in 2 days, comment")
  or from scratch.
- Enable/disable, reorder actions, dry-run against a chosen task or the last
  matching event, inspect the run log.
- Permissions: owner/admin create/edit; members see enabled rules and their own
  triggered runs; agents/API/MCP cannot create rules.

### Commit 3 — Scheduler, docs and checks

- Scheduler for due/scheduled triggers: single in-process interval, no daemon.
- `check-automation-rules.ts` (match, loop protection, idempotency, dry-run),
  `check-automation-scheduler.ts` (due boundary, restart safety).
- README, i18n, screenshots.

## Out of scope

- All external integrations: Slack, GitHub, inbound/outbound webhooks, email,
  push, mobile, A2A/external agents.
- A Zapier-style app directory; two-way issue/PR sync.
- Cross-workspace rules; custom scripting inside rules.

## Decisions

1. Deferred until the team needs it; if implemented, one PR with three commits.
2. Internal actions only; no external integration surface.
3. Owner/admin create/edit rules; members read; agents/API/MCP cannot create.
4. Scheduler is a single in-process interval (no external cron or daemon).
5. Rule actions that delegate/start an agent reuse #79's delegation/review path;
   #79 owns delegation-start and finish/failure notifications, #80 owns the
   internal rule engine only.

## Dependencies

- #78 for Inbox notifications; #79 for delegation/agent runs.
- #77 is **not** required (no inbound webhooks or external callers).

## Files likely touched

- `src/db/schema.ts` / `src/db/client.ts` — rule/run tables and indexes.
- New `src/lib/automations/` — triggers, evaluator, actions, scheduler.
- `src/lib/issues.ts`, `src/lib/agent-handoff.ts`, `src/lib/pages.ts` — call the
  evaluator after mutations.
- `src/app/workspace-misc-actions.ts` / new actions file; Settings UI.
- `src/lib/i18n/zh.ts`, README, checks.

## Acceptance (if revived)

1. Owner creates a rule; members see it; agents cannot create rules.
2. Matching events execute actions in order; non-matching events do nothing.
3. Loop protection and idempotency prevent duplicate runs.
4. Delegation actions use the real #79 run/review path.
5. Run log shows trigger, actions, duration and errors.
6. Scheduler executes due rules once across restarts.
7. Existing Inbox/Agent/API/MCP/tasks do not regress; tsc/i18n/agents-md/
   `check:harness`/build pass.
