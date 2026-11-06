# U-03: Planning layer (cycles, milestones, initiatives, roadmap)

Status: plan for a future PR. No implementation started. Written 2026-11-06.

## Why

TaCos has projects and tasks with board/list/table/calendar views, but no
planning layer: no time-boxed cycles, no milestones, no roadmap, no goals or
initiatives. Teams can track work but cannot plan a period, mark a release
stage, or show a roadmap across projects. Linear, Asana and ClickUp all treat
this as a core part of the work-management shell.

## Current implementation

- `projects` (name/key/overview/resources/trash) and `issues` (status,
  priority, due date, recurrence, assignees, claims, review status, custom
  task fields); list/board/table/calendar views; personal saved views.
- No cycle/sprint, milestone, initiative/goal, portfolio, timeline or roadmap
  tables or fields.
- `events` records status/assignee/label changes; `task_fields` supports custom
  fields; due dates and reminders exist (a scheduling seed).
- Projects are the only grouping level (no teams/sub-teams).

## Researched best practice

Linear cycles (https://linear.app/docs/use-cycles.md):

- Time-boxed periods, 1-8 weeks, shared duration and start day per team, with
  optional cooldowns; upcoming cycles are created automatically (up to 15).
- Auto-add active issues without a cycle to the current/next cycle; unfinished
  issues roll over; issues in backlog/triage/canceled do not.
- Capacity dial estimated from the previous three completed cycles; cycle
  calendar subscription (Google/ICS); cycle view with insights.

Linear milestones (https://linear.app/docs/project-milestones.md):

- Project lifecycle stages, optional target dates, progress computed from the
  issues attached; shown on the project timeline and initiative timeline;
  filter/group by milestone; milestones can convert to projects.

Linear initiatives (https://linear.app/docs/initiatives.md):

- Workspace-level objectives grouping projects; properties: status (Proposed /
  Planned / Active / Completed / Canceled), priority, labels, owner, lead team,
  target date, resources, description, projects; health from updates; initiative
  graph; team/private-team initiatives.

Linear custom views (https://linear.app/docs/custom-views.md) and view
subscriptions complete the planning surface: shared views, contextual views,
issue subscriptions per view.

Asana (goals, portfolios, timeline) and ClickUp (sprints, timelines, goals)
cover the same product needs with different names; the common pieces are
time-boxed work, milestone/release stages, a portfolio/roadmap roll-up and
progress computed from items.

## Comparison

| Capability | TaCos today | Linear | Asana / ClickUp |
| --- | --- | --- | --- |
| Time-boxed cycles | None | Cycles (1-8 weeks, cooldowns, auto-create) | Sprints |
| Milestones/releases | None | Project milestones with progress | Milestones/releases |
| Roadmap/timeline | None (calendar of tasks only) | Project/initiative timeline, roadmap views | Timeline, portfolios |
| Objectives/initiatives | None | Initiatives with status/priority/owner | Goals/portfolios |
| Progress roll-up | None | Cycle, milestone, initiative progress | Goals/portfolio progress |
| Capacity/velocity | None | Cycle capacity from last 3 cycles | Workload/portfolio capacity |
| Calendar sharing | Task calendar only | Cycle .ics/Google Calendar | Calendar sync |
| Shared planning views | Personal saved views only | Shared custom views + subscriptions | Shared dashboards/portfolios |
| Planning automation | None (U-05 automations planned) | Auto-add/rollover, cycle automations | Rules/automations |

## Gaps, in priority order

1. **No cycles or time-boxed planning.** Work cannot be scoped to a week or
   sprint, carried over, or reviewed period by period.
2. **No milestones/releases.** Project stages cannot be marked, dated, or
   measured by completion.
3. **No roadmap/timeline.** No cross-project time view of projects, milestones
   and target dates.
4. **No initiatives/goals.** No way to group projects under an objective and
   report progress upward.
5. **No shared planning views.** Saved views are personal only; plans cannot be
   shared with the team (U-09 covers the views gap).
6. **No capacity signal.** No velocity/estimate basis to know whether a cycle
   is realistic.

## Candidate scope (one PR, four commits)

Default: one PR. If cycles alone grow too large, cycles can ship first and
milestones/initiatives follow in a second PR; ask before splitting.

### Commit 1 — Cycles

- `cycles` table: workspace, optional project scope, number/name, starts/ends,
  duration, cooldown, status (upcoming/active/completed), created by.
- `issues.cycle_id` (nullable); cycle membership updates with status.
- Settings: enable cycles, duration 1-8 weeks, start day, upcoming count,
  cooldown; automatic upcoming cycle creation (scheduled/lazy sweep, no
  daemon).
- Cycle view: list/board of its issues, progress and effort, simple burndown,
  capacity estimate from the last three completed cycles (issue count/effort).
- Rollover and auto-add: open issues roll to the next cycle; optionally
  auto-add started/completed issues without a cycle (configurable).
- Cycle calendar subscription (.ics) if cheap; otherwise a calendar view.

### Commit 2 — Milestones

- `project_milestones` table (project, name, description, target date,
  position, created by); `issues.milestone_id`.
- Progress computed from attached issues (started/completed counts), current
  milestone indicator.
- Project timeline view showing milestones and issues by date; filter/group by
  milestone; milestone as an Insights dimension (U-02).
- Optional: convert milestone to project (stretch).

### Commit 3 — Initiatives and roadmap

- `initiatives` table (workspace, name, description, status, priority, owner,
  target date, labels, resources, created by) and `initiative_projects`
  (many-to-many).
- Roll-up progress from projects/milestones; initiative list view with filters.
- Roadmap/timeline view: months/quarters, projects and milestones grouped by
  initiative, target dates; no drag-scheduling in v1 (stretch: drag target
  dates).
- Simple health/update text per initiative/project (stretch; otherwise status +
  target date).

### Commit 4 — Integration, automation and checks

- Insights (U-02): cycle/milestone/initiative dimensions and progress panels.
- Automations (#80): cycle start/end, milestone due/overdue as triggers;
  auto-add/rollover runs inside the planning module even before #80 ships.
- Views (U-09): shared planning views/subscriptions if that lands first.
- Checks: `check-planning-cycles.ts` (duration/start day/rollover/auto-add/
  capacity), `check-planning-milestones.ts` (progress, filtering),
  `check-planning-initiatives.ts` (roll-up, roadmap ordering), plus UI
  screenshots and docs.

## Acceptance criteria

1. Cycles can be enabled with duration/start day/cooldown; upcoming cycles are
   created ahead of time; a cycle view shows its issues and progress.
2. Unfinished issues roll to the next cycle; issues in backlog/triage/canceled
   do not; auto-add can be configured and is idempotent across restarts.
3. Milestones can be created with or without dates, issues attach to them, and
   progress/current milestone appear on the project and timeline.
4. Initiatives group projects; status/priority/owner/target date filter and roll
   up progress; the roadmap/timeline shows projects and milestones by month/
   quarter.
5. Insights panels and automation triggers consume cycles/milestones; the same
   data is consistent across cycle, project, roadmap and insights views.
6. Existing project/task views and personal saved views behave as before; tsc,
   i18n, agents-md, `check:harness` and build pass.

## Out of scope

- Advanced capacity forecasting/resource leveling and time tracking.
- OKR grading/scorecards; cross-workspace or multi-company portfolios.
- GitHub milestone/issue sync and external release tooling.
- Teams/sub-teams (TaCos has projects only; revisit if a team model is added).
- Drag-and-drop scheduling of the roadmap beyond target dates.

## Open decisions

1. Cycle scope: workspace-wide (recommended for one-team workspaces) or
   per-project? Linear uses teams; TaCos has no team level.
2. Milestones: project-only (recommended) or also workspace-level releases?
3. Initiatives naming/semantics: initiatives (recommended, matches Linear) vs
   goals/OKRs.
4. One PR with all four commits (recommended, same pattern as the other plans)
   or split cycles vs milestones/initiatives?
5. Capacity: simple issue/effort velocity from the last three cycles
   (recommended) or leave capacity out of v1?
6. Roadmap view: list/timeline only (recommended) or calendar integration too?
7. Auto-add active issues: on by default or opt-in? Recommendation: opt-in to
   avoid surprising plan changes.

## Dependencies

- U-02 Insights for cycle/milestone/initiative panels.
- #80 for automation triggers (cycles work standalone first).
- U-09 views for shared planning views (optional).
- U-01 sharing for private initiatives/private projects if that lands first.

## Files likely touched

- `src/db/schema.ts`, `src/db/client.ts` — cycles, project_milestones,
  initiatives, initiative_projects, issue cycle/milestone columns, indexes.
- New `src/lib/planning/` — cycle lifecycle/rollover/auto-add/capacity,
  milestone progress, initiative roll-up.
- `src/lib/issues.ts` — issue cycle/milestone fields in create/update and
  filters; events.
- New views: cycles page, project timeline, roadmap/initiatives page; project
  settings for cycles; insight panels.
- `src/lib/i18n/zh.ts`, README, new checks.
