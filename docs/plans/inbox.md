# Inbox overhaul

Status: planned as **one PR** (decided 2026-11-06). No implementation started.
This plan was written after checking the current Inbox code and comparing it
with Linear's and GitHub's notification inboxes.

## Why

The current Inbox is a flat list of the latest 50 notifications, with only
"Mark all read", "Clear all" and a per-row delete. Notifications about
assignments and comments are stored as English sentences, so the Chinese UI
shows English. Older notifications are unreachable, there is no filtering or
grouping, and the destructive actions cannot be undone.

## Current implementation

- Page: `src/app/[workspaceId]/notifications/page.tsx` -> `NotificationsView`
  in `src/components/notifications-view.tsx`; data in `listNotifications`
  (`src/lib/issues.ts`), limited to 50 rows, newest first.
- Writes: `notify` in `src/lib/issues.ts`, plus calls in `agent-handoff.ts` and
  page helpers. `body` sometimes holds a full English sentence
  (`assigned`, `commented`, `workspace_deleted`) and sometimes just an actor
  name or identifier (claim, mention, blocker, handoff); the view localizes the
  latter but prints the former as-is.
- Read state and unread count: `markNotificationsRead`,
  `markNotificationRead`, `unreadNotificationCount`; the sidebar badge polls
  `/api/internal/<workspace>/notifications?countOnly=1` every 10s.
- Realtime: `LiveRefresh` refreshes the page when the notifications revision
  changes.
- No schema for preferences or mutes, no snooze, no done/archive, no search,
  no filters, no grouping, no pagination.

## Best practice (researched 2026-11-06)

Linear Inbox https://linear.app/docs/inbox.md

- Auto-subscribe on create / assign / mention.
- Priority vs Other tabs; keyboard G I, J/K, U / Alt-U, H snooze, Backspace,
  Shift-S unsubscribe; quick search by issue/type/assignee/team/project;
  display options include snoozed, unread first and grouping; snooze until a
  time; 2,000-notification cap.

GitHub notifications
https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications

- Triage: Done (removed from the inbox, retained), Saved (kept indefinitely),
  Unsubscribe; reason labels; custom filters; grouping by repository or date;
  watch settings per repository and event type; read state synced across
  inbox, email and mobile.

Shared pattern: subscription model + triage states (unread/read, done/saved,
snoozed) + filters/search/grouping + bulk actions with undo + "why am I seeing
this" + per-event preferences + retention and pagination.

## Scope: one PR, all of it

Commits inside the PR may be split by phase; the PR is not merged until every
phase is done. Status words are `todo`, `doing`, `done`, `blocked`.

### P0 — correctness

- [ ] Store notifications as structured payloads (actor name or id, issue
      identifier/title or page title, date) instead of prebuilt English
      sentences; render the sentence in the reader's locale. Cover `assigned`,
      `commented`, `mentioned`, `doc_commented`, `doc_mentioned`, `blocker`,
      `claimed`, `released`, `claim_transferred`, `due_soon`, `handoff_*` and
      `workspace_deleted`.
- [ ] Make the list reachable beyond 50 rows: cursor pagination with a "Load
      more" control (server limit stays bounded), or an explicit retention
      policy surfaced in the UI.
- [ ] Make the unread badge and the list use the same set: the badge must not
      count rows the inbox cannot show.

### P1 — triage

- [ ] Tabs: Unread / Mentions / Assigned / All (with counts).
- [ ] Group rows by issue/page and collapse repeats into one row with a count;
      expanding shows the individual events.
- [ ] Mark read / mark unread per row; Mark all read stays.
- [ ] Done (archive) with undo; Clear all and per-row delete become soft
      deletes with an undo toast.
- [ ] Quick search across issue identifier/title, actor and notification type.

### P2 — control

- [ ] Mute/unsubscribe a task or document, and a project, from the row or the
      detail panel; muted items stop notifying.
- [ ] Notification preferences per event type (assignments, comments,
      mentions, claims, blockers, agent handoffs, due reminders) plus "All
      notifications" on/off.
- [ ] Snooze a notification until a time; it returns to the inbox then (reuse
      the existing reminder presets and date handling).
- [ ] Keyboard shortcuts: G I, J/K, U / Alt-U, Backspace, H (snooze),
      Shift-S (unsubscribe) at minimum.

### P3 — lifecycle

- [ ] Retention policy (for example 2,000 rows or 90 days) and a documented
      statement in the UI.
- [ ] Server mode: optional daily digest or email delivery behind a setting,
      only if it can reuse the existing mail configuration; otherwise record it
      as a follow-up.
- [ ] Audit counters for the new actions in the existing activity/log paths.

## Schema and API notes

- `notifications.body` becomes a JSON payload column (or a new `data` column
  added with `addColumnIfMissing`); keep a one-time backfill for existing rows
  so old notifications still render.
- New columns for triage: `state` (unread/read/done), `snoozed_until`,
  `deleted_at` (soft delete). New table for mutes and preferences
  (`notification_prefs` per user/workspace, `notification_mutes` with scope
  type/id). All schema changes must go through `bootstrap()` and be idempotent.
- Server actions in `src/app/workspace-misc-actions.ts` and lib functions in
  `src/lib/issues.ts`; same business-layer rule as everywhere else.
- The internal API used by the badge must stay lightweight (count only).

## Checks and evidence

- New check scripts:
  - `check-inbox-payload.ts` — structured payloads render correctly in both
    locales, including old rows after backfill.
  - `check-inbox-triage.ts` — tabs/grouping/counts, mark unread, done and undo,
    soft delete, search, and pagination beyond 50 rows.
  - `check-inbox-prefs.ts` — mutes suppress notifications, preferences gate
    event types, snooze returns at the right time.
- Update `check-notification-badge.ts` (or equivalent) so badge and list agree.
- Smoke test plus `npm run check:harness`; real UI screenshots at 1440 and 1100
  for the new Inbox.
- No real-model run needed.

## Acceptance criteria

1. Chinese UI shows no English notification sentences; English UI still reads
   naturally; language switch changes the rendered text without a DB rewrite.
2. The inbox can reach more than 50 notifications; the badge equals the unread
   rows the inbox can show.
3. Tabs, grouping and search return the expected rows; repeated events on one
   task collapse into one row with a count.
4. Mark unread, Done, undo, soft delete and Clear all have no data-loss dead
   ends.
5. Muting a task/document/project stops new notifications for it; preferences
   gate each event type.
6. Snooze hides a row and brings it back at the chosen time.
7. Old rows created before this PR still render after the backfill.

## Open questions

- Retention: row cap or age-based, and what the number is.
- Whether "Done" should keep the row searchable or hide it entirely.
- Which shortcut set to ship (the Linear set above, or a subset).
- Digest/email: whether it ships in this PR or is recorded as a follow-up.
- Do we expose preferences per workspace or per user?
