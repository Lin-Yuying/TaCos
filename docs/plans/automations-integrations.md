# Automations and integrations (next functional block)

Status: planned as the next functional block after the three current plans
(Agent access #77, Inbox #78, Agent #79). Research and candidate scope only; no
implementation started. Written 2026-11-06 after checking the codebase and
comparing with Linear, Notion and Asana.

## Why this is next

The repository has **no automation, workflow, webhook, Slack or GitHub
integration code at all** — a full-text search for automation/integration terms
finds nothing. That is the largest functional gap left in the shell comparison:
Linear, Notion and Asana all let a workspace define "when X happens, do Y",
including "delegate to an agent" and "notify Slack".

It is also the natural glue for the three planned PRs:

- Inbox (#78) provides the notification surface a rule can target.
- Agent (#79) provides delegation, review and agent runs as an action; the
  schedule/status trigger builder was explicitly deferred from that plan.
- Agent access (#77) provides API keys, which make inbound webhooks and external
  callers safe.
- The existing revisions/live-refresh, reminders and runner queue are reusable
  primitives; no new daemon is needed for the first version.

## Current implementation

- No rules, triggers, actions, workflows, webhooks, Slack or GitHub integration.
- Existing pieces to build on:
  - `src/lib/agent-handoff.ts` + `src/lib/runner/hub.ts` — queued background
    runs, approvals and finish/failure notifications.
  - Inbox notification types and the Inbox PR's soft-delete/preferences model.
  - `src/lib/api-auth.ts` (from the Agent access PR) — Bearer keys for inbound
    webhook and API callers.
  - Workspace revisions + `LiveRefresh` — the signal a rule engine can observe.
  - Reminders and due-soon notifications — the scheduler seed for "due" triggers.
  - Events/activity stream — the audit trail a rule run can write into.
- No email/push channel; Slack would be the first out-of-app channel.

## Researched best practice

Linear:

- Triage rules route issues by team/status/label and can **delegate to an agent**
  as part of the same flow; issue delegation keeps the human owner.
  https://linear.app/docs/assigning-issues.md
- Slack: admin connects the workspace; members create issues from Slack
  messages, sync comments both ways, receive personal/channel notifications, get
  rich unfurls, and can mention the Linear agent in Slack to act on a thread.
  https://linear.app/docs/slack.md
- GitHub: branch/PR links on issues; the issue's code context stays attached.

Notion Custom Agents:

- Triggers: schedule and page/database events; @mention in pages or comments.
- Runs are background and shared; permissions are explicit page/database grants;
  activity and version history show what an agent did; configuration changes go
  to the audit log; agents can hand work to other agents.
  https://www.notion.com/help/custom-agents

Asana / Atlassian:

- Workflow builder rules and AI teammates inside projects; rules and agents are
  governed by project/workspace permissions and activity.
  https://www.atlassian.com/software/rovo

Common pattern: **trigger + conditions + actions**, with permissions on who can
create rules, an execution log, loop protection, and integrations as first-class
action targets (notify Slack, open a PR, call a webhook).

## Comparison: automation capabilities

| Capability | TaCos today | Linear | Notion Custom Agents | Asana |
| --- | --- | --- | --- | --- |
| Rule triggers | None | Triage rules, status/agent events | Schedule, page/database events, mention | Workflow builder rules |
| Conditions | None | Team, status, label, properties | Page/database filters | Project/task properties |
| Actions | None | Assign, delegate to agent, move status, label, notify | Update pages/databases, notify, hand to another agent | Assign, status, comment, notify |
| Agent as an action | Manual handoff only | Yes (delegation/triage) | Yes (triggered runs) | AI teammates |
| Execution log / audit | Issue events only | Rule activity | Activity + audit log | Activity |
| Out-of-app channels | None | Slack, email, mobile, webhooks | Slack (agents can connect) | Slack, email, webhooks |
| Inbound trigger source | API/MCP calls only | Slack, GitHub, API | Slack, Notion events, API | Slack, API, forms |

## Candidate scope (one PR, four commits)

Default: one PR, matching the pattern of the other plans. If the rule engine and
the Slack/GitHub integrations do not fit together during implementation, the
fallback is to split commit 3 out — ask before splitting.

### Commit 1 — Rule engine and data model

- New tables: `automation_rules` (workspace, name, enabled, creator, trigger,
  conditions JSON, actions JSON, last run, version) and
  `automation_runs` (rule, trigger event, status, action results, error,
  duration, idempotency key, created/finished). Audit every configuration
  change.
- Triggers: task created, status changed, assigned, claimed/released,
  delegated to an agent, due soon, comment added, mention, agent run finished
  or failed, document updated. Start with the task/agent triggers actually used
  by the team; the schema stays generic.
- Conditions: project, label, priority, assignee presence, text contains,
  status, and "not triggered by this rule" loop protection.
- Actions: set status/assignee/labels, add comment, notify users, **delegate to
  a workspace agent / start an agent run**, send Slack message, call outbound
  webhook, create a document/task. Actions run in order; failures do not
  roll back earlier actions and are recorded.
- Evaluation: one evaluator called from the business layer after mutations and
  from the revision/live path; idempotency key per (rule, event) so polling does
  not duplicate runs; bounded retries for external actions with backoff.

### Commit 2 — Settings → Automations UI

- Owner/admin can create rules from templates ("when assigned, delegate to
  agent", "when status is review, notify Slack", "when due in 2 days, comment
  and notify") or from scratch.
- Enable/disable, reorder actions, test/dry-run against a chosen task or the
  last matching event, and inspect the run log with input/action results.
- Permissions: owner/admin create and edit; members see enabled rules and their
  own triggered runs; agents cannot create rules (API/MCP does not expose rule
  creation).

### Commit 3 — Integrations

- **Inbound webhook**: `POST /api/automations/hooks/<id>` authenticated by an
  API key or a per-hook secret, maps a JSON payload to a trigger, with signature
  and replay protection.
- **Outbound webhook**: POST with HMAC signature, timeout, retries, run log.
- **Slack**: workspace connection with an incoming webhook or bot token
  (start with outgoing notifications), a slash command or message action to
  create a task (the reverse direction can start as a simple endpoint), and
  notification formatting that links back to the task.
- **GitHub**: attach branch/PR links to tasks from a webhook payload; full
  two-way issue sync stays out of this PR.
- Secrets stored encrypted (reuse `ai-secret.ts`), never returned to the browser
  after save.

### Commit 4 — Scheduler, docs, checks

- Scheduler for due/scheduled triggers: a single in-process interval (like the
  live/runner paths) scanning due rules; no new daemon. Scheduled agent runs are
  just a trigger with the "delegate/start agent" action from #79.
- Docs: README and a settings-level explanation of rules, integrations and
  secrets.
- Checks: `check-automation-rules.ts` (trigger/condition/action match, loop
  protection, idempotency), `check-automation-integrations.ts` (inbound webhook
  auth + signature, outbound retry, Slack payload, GitHub link),
  `check-automation-scheduler.ts` (due trigger boundary), plus updates to the
  agent/handoff checks. Smoke, `check:harness`, build, screenshots.

## Out of scope (follow-ups)

- Two-way GitHub issue/PR sync; full Slack app marketplace distribution.
- A Zapier-style directory of third-party apps.
- A2A external agents as action targets (later platform step).
- Email/push channels beyond Slack (notification channel work).
- Multi-step branching workflows with loops/conditions on action results.

## Acceptance criteria

1. An owner can create, enable/disable and delete a rule; members see it; agents
   cannot create one.
2. A matching task/agent event runs the actions in order; a non-matching one
   does not; loop protection prevents a rule from retriggering itself.
3. Delegation/agent-run actions start a real agent run through the #79 path and
   the review/notification behavior is unchanged.
4. Inbound webhook requires the configured secret, rejects replays and maps to a
   trigger; outbound webhook signs, retries with backoff and records failures.
5. A Slack notification arrives for a matched rule and links back to the task;
   creating a task from Slack works with the configured connection.
6. A GitHub branch/PR webhook attaches the link to the task.
7. Due/scheduled rules run once per boundary (no duplicates after restart or
   polling) and the run log shows trigger, actions, duration and errors.
8. Secrets are encrypted at rest and never returned to the client; every rule
   change is in the audit/event stream.
9. Existing Inbox, Agent, API/MCP and task behavior do not regress; tsc, i18n,
   agents-md, `check:harness` and `npm run build` pass.
10. README/docs describe rules, integrations and permissions.

## Decisions (accepted per recommendation, 2026-11-06)

1. Only owner/admin can create, edit or delete rules; members see enabled rules
   and their own triggered runs; agents/API/MCP cannot create rules.
2. Slack v1 = outgoing notifications + create a task from Slack; no full Slack
   OAuth app or marketplace distribution in this PR.
3. GitHub is in this PR as "attach branch/PR links from a webhook"; two-way
   issue/PR sync stays a follow-up.
4. One PR with the four commits; the scheduler is a single in-process interval
   (no new daemon, no external cron requirement).
5. Each inbound webhook has a per-hook secret (an API key may additionally be
   required), a timestamp/signature check and replay protection.
6. Outbound webhooks block private/loopback targets by default; an owner may
   explicitly allow them for self-hosted internal endpoints. Sign with HMAC,
   timeout and bounded retries.
7. Rule actions that delegate/start an agent reuse #79's delegation/review path;
   #79 owns only delegation-start and finish/failure notifications, #80 owns the
   general rule engine and external integrations (no duplicate trigger builders).

## Files likely touched

- `src/db/client.ts`, `src/db/schema.ts` — rule/run tables, indexes.
- New `src/lib/automations/` — triggers, evaluator, actions, scheduler,
  webhook signing, Slack/GitHub adapters.
- `src/lib/issues.ts`, `src/lib/agent-handoff.ts`, `src/lib/pages.ts` — call the
  evaluator after mutations; reuse delegation/agent-run API.
- `src/app/api/automations/*`, actions in `src/app/workspace-misc-actions.ts` or
  a new actions file.
- `src/components/settings-view.tsx` / new settings pages; task panel link to
  rule history.
- `src/lib/i18n/zh.ts`, README.
- New checks above; existing agent/handoff checks updated.
