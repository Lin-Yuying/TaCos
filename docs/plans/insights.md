# U-02: Insights and analytics

Status: plan for a future PR (after the current #77-#80 and the U-01 sharing
plan). No implementation started. Written 2026-11-06.

## Why

TaCos records a lot of work history — issue status changes, assignments,
claims, comments, review status, agent runs, automation runs — but there is no
way to answer "how fast do we ship?", "where is work stuck?", "how much work is
delegated to agents?" or "how much are our subscriptions/agents consuming?".
The activity stream is per-task; the product has no aggregated view.

The data for the first version already exists:

- `issues` (status, priority, due date, claim, created/updated, deletion),
  `issue_assignees`, `comments`, `events` (created / status_changed /
  priority_changed / assignee_changed / labels_changed / reordered / blocker),
  `blockers`, `agent_runs` / `agent_steps` / `agent_threads`.
- U-01 adds token usage from the Agent PR (#79) and automation runs from #80.
- No analytics tables, queries, dashboards or export exist today. Task views
  are personal saved filters (`personal_task_views`), not shared reports.

## Current implementation

- No analytics tables, aggregation queries, dashboards, saved reports or CSV
  export exist. Task views are personal saved filters (`personal_task_views`),
  not reports.
- Raw data available today: `issues` (status, priority, due, claim, created/
  updated/deleted), `issue_assignees`, `comments`, `events` (created,
  status_changed, priority_changed, assignee_changed, labels_changed,
  reordered, blocker), `blockers`, `agent_runs` / `agent_steps` /
  `agent_threads`.
- Data added by the plans: token usage (#79), automation runs (#80), sharing/
  access events (U-01), cycles/milestones (U-03).
- Search/views exist but are filtering surfaces, not analytics; no time-in-
  status history beyond `events`.

## Researched best practice

Linear Insights (https://linear.app/docs/insights.md):

- An Insights panel on views; the dataset is the issues in the current view, so
  filters (created at, completed at, status type, label, project, team) define
  the analysis.
- Measures: issue count, effort, cycle time (start to completion), lead time
  (creation to completion), triage time, issue age.
- Slice and segment; bar charts for counts/effort and scatterplots for time
  measures; burn-up charts for cumulative flow over time.
- Sharing: copy a workspace link, export CSV, full-screen view.
- Works best on workspace-level custom views that span projects.

Asana (dashboards/portfolios/goals) and ClickUp (dashboards) follow the same
pattern: saved reports, date ranges, grouping, export, and project/portfolio
roll-ups. The shared lesson: analytics should reuse the same filters as the
lists, not a separate query language.

## Comparison

| Capability | TaCos today | Linear Insights | Asana / ClickUp |
| --- | --- | --- | --- |
| Aggregated metrics | None | Issue count, effort, cycle/lead/triage time, age | Dashboards, workload, goal progress |
| Filters / slice / segment | Personal list filters only | View filters define the dataset; slice/segment | Report filters |
| Time charts | None | Scatterplots, burn-up | Line/bar charts |
| Project/cycle roll-up | None | Project/cycle view panels | Portfolios/dashboards |
| Agent/delegation metrics | None | Not a built-in measure (delegation visible in issue data) | AI usage varies |
| Token/subscription usage | None (Agent PR adds token ledger) | N/A (subscription product) | N/A |
| Automation impact | None (no automation yet) | N/A | Workflow dashboards |
| Share report / link | None | Copy link, CSV export | Share dashboard, export |
| Saved report | Personal views only | Shared custom views + insights panel | Saved dashboards |

## Gaps, in priority order

1. **No aggregated metrics at all.** The product cannot show throughput, WIP,
   cycle time, lead time, workload or delegation coverage.
2. **Time measures need history.** The `events` table records status changes,
   so cycle/lead time and time-in-status are computable; verify coverage for
   older tasks and define the definitions (first started, completed, canceled
   excluded or counted separately).
3. **No workspace-level dataset.** Lists are project/queue scoped; there is no
   cross-project dataset with shared filters.
4. **No agent/usage view.** #79 records tokens per run; nothing aggregates them
   by agent, task, project or period. Same for #80 automation runs.
5. **No export or sharing.** Analytics cannot be shared as a link/CSV or saved
   as a report.
6. **No historical snapshots.** Burn-up/trend charts need either event-based
   reconstruction or a daily snapshot table.

## Candidate scope (one PR, four commits)

### Commit 1 — Metrics layer

- `src/lib/insights.ts`: date-range aggregation over issues/events/agent runs,
  with filters (project, assignee, label, status type, delegation source).
- Metrics: created, completed, canceled, active WIP; lead time (created →
  done); cycle time (first `in_progress` → done); review latency (review
  requested → approved, using review status/events); throughput by week;
  workload by assignee/project; delegation coverage (tasks delegated to agents,
  agent runs, completion rate); agent token usage (#79); automation runs and
  failures (#80).
- Optional daily snapshot table (`insight_daily`) for trends if on-demand
  aggregation becomes slow; SQLite on a small team may not need it first.
- Definitions are codepaths with checks: canceled tasks excluded from lead
  time, sub-tasks counted or rolled up? (decide), deleted tasks excluded,
  timezone policy fixed to the workspace display timezone.

### Commit 2 — Insights UI

- Workspace Insights page: date range picker, filters, metric cards, bar chart
  (count/effort by group), scatter/burn-up (time measures), and a table below.
- Reuse the same filter model as task views (no separate query language).
- Project page Insights panel; cycle/milestone panel once U-03 lands.
- Agent panel: token usage by agent/model/period, delegation coverage.
- Empty and early-data states; no chart library dependency unless one is
  already licensed; otherwise accessible SVG charts.

### Commit 3 — Sharing and export

- Save an insight/report as a workspace view (reuse the views work; personal
  first, shared when U-09 lands).
- Copy link for workspace members; CSV export of the current table.
- Read-only report pages; permission checks reuse U-01's access model.

### Commit 4 — Checks and docs

- `check-insights-metrics.ts`: fixtures with known history verify counts,
  cycle/lead time, review latency, delegation and token aggregation, canceled/
  deleted exclusions, timezone boundaries.
- `check-insights-export.ts`: CSV shape and access control.
- UI screenshots at 1440/1100; README; smoke + harness.

## Acceptance criteria

1. A workspace member can open Insights, pick a date range and filters, and see
   created/completed/WIP, lead time, cycle time and workload that match a
   hand-computed fixture.
2. Time measures are computed from event history and exclude canceled/deleted
   tasks per the documented definitions; timezone boundaries do not shift
   counts.
3. Delegation coverage, agent token usage and automation run counts appear when
   #79/#80 data exists, and show a clear empty state otherwise.
4. An admin/member can copy a link to the current insight and export the table
   as CSV; the exported rows match the screen and respect access.
5. The project panel and workspace page agree for the same filters.
6. No regression to task lists or the Inbox; tsc, i18n, agents-md,
   `check:harness` and build pass.

## Out of scope

- A general BI tool / SQL editor / external warehouse export (Metabase,
  BigQuery, etc.).
- Custom metric formulas and per-user dashboards.
- Forecast/velocity prediction (part of U-03 capacity maybe).
- Billing/invoice reconciliation for subscriptions (we only show tokens and
  subscription usage snapshots from the harness).
- Email scheduled reports (U-08 channels).

## Open decisions

1. Time definitions: cycle time starts at the first `in_progress` status or at
   the claim? Recommendation: first `in_progress`; claim tracked separately.
2. Sub-tasks: counted as separate issues (recommended) with a roll-up toggle,
   or always aggregated into the parent?
3. On-demand aggregation first (recommended for a small SQLite team) or daily
   snapshots from day one?
4. Dashboard set for v1: task flow first, agent/automation panels second
   (recommended), or all at once?
5. Report sharing: workspace members only (recommended) or also guests per
   U-01 levels?
6. Export: CSV only (recommended) or CSV + JSON?

## Dependencies

- Core task metrics: none (available now).
- Token usage panel: #79 (Agent usage ledger).
- Automation panel: #80 (automation runs).
- Shared reports and guest visibility: U-01 (access model) and U-09 (views).

## Files likely touched

- `src/db/schema.ts` / `src/db/client.ts` — optional daily snapshot table and
  indexes; no change to existing tables except indexes for date-range queries.
- New `src/lib/insights.ts` (queries and definitions).
- New `src/components/insights/` (metric cards, charts, filters, table).
- Workspace/project/agent page wiring; CSV export route.
- `src/lib/i18n/zh.ts`, README, new checks.
