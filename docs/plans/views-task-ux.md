# U-09: Views and task UX

Status: plan for a future PR. No implementation started. Written 2026-11-06
(loop round 4).

## Why

TaCos task lists are useful but the view layer is thin: saved views are
personal-only (`personal_task_views`), there are no shared/workspace views, no
view subscriptions, and few display options. On the task side, Linear/GitHub
teams expect grouped/ordered views, bulk editing, task templates and
estimate-aware planning. This is the daily-use surface, so gaps are felt
immediately.

## Current implementation

- Views: list, board, table, calendar; per-user saved filters
  (`personal_task_views` with scope/name/value); list-header search; quick
  filters (Active/Unassigned/Agent) from the 2.3 work; no shared views, no view
  subscriptions, no per-view display options.
- Tasks: statuses, priorities, multiple assignees, claims, review status,
  labels, due date + reminders, recurrence, subtasks, dependencies, blockers,
  comments/activity, custom task fields, attachments.
- Linear-like planning (cycles/milestones) is U-03; collaboration threads and
  watchers are U-11; search is U-10.
- No verified bulk edit, task templates, estimates/time tracking, or per-view
  property visibility.

## Researched best practice

Linear Display options (https://linear.app/docs/display-options.md):

- Layout (list/board/timeline), grouping (status, assignee, project, priority,
  cycle, label, parent, team, customer, release…), sub-grouping, ordering
  (status/manual/priority/created/updated/due), manual ordering, sub-issues
  toggle, show empty groups, display properties (ID/status/assignee/priority/
  project/due/milestone/cycle/estimate/labels/links/dates/Pull requests…).
- Display options can be personal or set as the workspace default; keyboard
  shortcuts (`Shift V`, `Cmd/Ctrl B`).
- Group headers show count or estimate; drag between groups adopts the group's
  properties.

Linear Custom Views (https://linear.app/docs/custom-views.md): shared
workspace/team/project views, view owners, favorites, view subscriptions and
Slack notifications, contextual views, and view links.

Adjacent: GitHub Projects views (table/board/roadmap, fields, grouping,
saved views), Asana saved views and bulk actions. Common pattern: **shared,
configurable views + consistent grouping/ordering/property display + view
subscriptions + task bulk operations**.

## Comparison

| Capability | TaCos today | Linear | GitHub Projects | Asana |
| --- | --- | --- | --- | --- |
| Personal saved views | Yes | Yes | Yes | Yes |
| Shared workspace/project views | No | Yes | Yes | Yes |
| View owner / default view | No | Yes | Yes | Yes |
| Layout switch | list/board/table/calendar | list/board/timeline | table/board/roadmap | list/board/timeline/calendar |
| Grouping/ordering | Limited filters only | Rich grouping/ordering/manual | Group/order by fields | Group/sort |
| Display properties | Fixed | Toggle per property | Field visibility | Toggle |
| View subscriptions | No | Yes (inbox/Slack) | Limited | Notifications |
| Bulk edit | Not verified | Yes | Yes | Yes |
| Task templates | No | Templates | Issue forms | Task templates |
| Estimates/time | No estimate field (custom fields only) | Estimates/effort | Custom fields | Estimates/hours |

## Gaps, in priority order

1. **Shared views.** Views are personal; a team cannot curate "this week",
   "blocked", "review queue for project X" and share it.
2. **Display options.** No grouping/ordering/property visibility/manual order
   per view; the layout/filter model is fixed.
3. **View subscriptions.** No notification when an issue enters a view or is
   completed (Inbox #78 and Slack #80 are the channels).
4. **Bulk editing.** Not verified for tasks; multi-select status/assignee/
   label/priority/due edits are table stakes.
5. **Task templates.** No reusable title/description/labels/fields templates.
6. **Estimates.** No estimate field; planning/capacity in U-03 will need one.
7. **Keyboard/command polish.** Partial command palette; no view-specific
   shortcuts.

## Candidate scope (one PR, four commits)

Default one PR; if shared views + subscriptions grow, split UX polish.

### Commit 1 — Shared views

- Replace/extend `personal_task_views` with a `task_views` table: workspace,
  scope (workspace/project), name, definition JSON, shared flag, owner, position,
  default-for-scope, created/updated.
- Migrate personal views; keep personal views private unless shared; workspace
  views visible to members (guests per U-01); view pages in sidebar and project
  pages; duplicate/rename/favorite.

### Commit 2 — Display options

- Per-view layout, grouping (status, assignee, project, priority, label, due,
  cycle once U-03 lands), ordering, manual order, sub-issues, show empty
  groups, and property visibility (ID/status/assignee/priority/project/due/
  labels/dates).
- Save personal overrides; "set as default" for shared views; keyboard
  shortcuts (`Shift V`, layout toggle).
- Group headers with counts; drag between groups adopts the group's property.

### Commit 3 — View subscriptions and notifications

- Subscribe to a view: notify on issue added, completed/canceled, or both
  (Linear model); delivery via Inbox (#78) and Slack/webhooks (#80); personal
  and channel-level subscriptions; mute.
- View-specific settings on the view menu; permissions follow U-01.

### Commit 4 — Bulk edit, templates, estimates, checks

- Multi-select on list/board/table: change status, assignee, priority, labels,
  due date, project; undo-friendly batch action and activity events.
- Task templates: workspace/project templates (title, description, labels,
  priority, fields); create-from-template in composer.
- Optional estimate field (number) if U-03 needs it; otherwise record as
  follow-up.
- `check-views-shared.ts` (sharing/permissions/defaults/migration),
  `check-views-display.ts` (group/order/property logic),
  `check-views-subscriptions.ts` (event → notification),
  `check-tasks-bulk.ts` (bulk edits), UI screenshots.

## Acceptance criteria

1. A member can create a shared workspace/project view; owners can set it as
   default; guests see only views they may access (U-01).
2. Grouping/ordering/layout/property settings persist per view; personal
   overrides do not change others; drag between groups updates the property.
3. Subscribing to a view delivers notifications on added/completed items via
   Inbox and (when configured) Slack/webhook; self-actions can be excluded.
4. Bulk edits apply to all selected tasks atomically with activity events;
   failures report per-task errors.
5. Creating a task from a template fills configured fields; templates are
   manageable by owners.
6. Existing personal views migrate without data loss; tsc, i18n, agents-md,
   `check:harness` and build pass.

## Out of scope

- Time tracking/timesheets and resource leveling.
- WIP limits per column (can be a follow-up).
- Custom field types beyond the existing task fields.
- Cross-workspace views.
- Native mobile view layouts (U-08).

## Open decisions

1. One PR for views + bulk/templates (recommended) or split UX polish?
2. View sharing: workspace/project levels only (recommended) or per-user
   sharing too?
3. Estimates: add a numeric estimate field in this PR (needed by U-03) or leave
   to U-03?
4. Bulk edit: include project move (recommended) or only field edits?
5. Templates: workspace-level first (recommended) or per-project too?

## Dependencies

- #78 for Inbox subscriptions; #80 for Slack/webhook delivery.
- U-01 for view sharing permissions/guests.
- U-03 for cycle/milestone grouping fields.
- U-10 for search/command palette polish.

## Files likely touched

- `src/db/schema.ts` / `src/db/client.ts` — task_views, templates, estimate
  field, indexes.
- `src/lib/task-view.ts`, `src/lib/issues.ts` — view definitions, grouping/
  ordering, bulk edits, templates.
- Task view components (`list-header`, `issue-layout`, board/table), view menu,
  project sidebar; composer templates.
- `src/lib/i18n/zh.ts`, README, new checks.
