# Inbox overhaul

Status: planned as **one PR** (decided 2026-11-06). No implementation started.
This plan was written after checking the current Inbox code and comparing it
with Linear's and GitHub's notification inboxes.

Decisions recorded 2026-11-06: retention is **90 days**; Done rows stay
**searchable**; keyboard shortcuts are the **full Linear set**; server-mode
digest/email is a **follow-up**, not this PR; notification preferences are
decided as **per user** with per-user mutes; workspace-level policy is a
follow-up.

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
- [ ] Done (archive) with undo. Done rows leave the Unread / Mentions /
      Assigned / All tabs but stay reachable from search until the 90-day
      sweep.
- [ ] Clear all and per-row delete become soft deletes with an undo toast.
- [ ] Quick search across issue identifier/title, actor and notification type.

### P2 — control

- [ ] Mute/unsubscribe a task or document, and a project, from the row or the
      detail panel; muted items stop notifying.
- [ ] Notification preferences per event type (assignments, comments,
      mentions, claims, blockers, agent handoffs, due reminders) plus "All
      notifications" on/off.
- [ ] Snooze a notification until a time; it returns to the inbox then (reuse
      the existing reminder presets and date handling).
- [ ] Keyboard shortcuts: the full Linear set — G then I (go to Inbox),
      J/K and Up/Down (move), U (read/unread), Alt-U (mark all read),
      H (snooze), Backspace (delete read), Shift-S (unsubscribe).

### P3 — lifecycle

- [ ] Retention: notifications older than **90 days** are swept lazily when the
      inbox or its badge is read (no background job, same pattern as the
      workspace recycle-bin sweep) and the inbox states the policy. Done rows
      stay searchable until the sweep.
- [ ] Audit counters for the new actions in the existing activity/log paths.

Server-mode daily digest / email delivery is **out of this PR** and recorded
as a follow-up (see below).

## Schema and API notes

- Add a `data` JSON column to `notifications` with `addColumnIfMissing()`.
  `notify()` writes the payload there; new rows never store prebuilt English
  sentences in `body`. Keep `body` as the legacy fallback.
- One-time backfill for existing rows: parse the known legacy formats
  (`<who> assigned you to “<title>”`, `<who> commented on “<title>”`,
  `The owner deleted the workspace "<name>".`, plus the types that already
  store a bare actor name or identifier) into `data`. Unknown rows keep
  `data = NULL` and render the stored `body`, so nothing disappears.
- New columns for triage: `state` (`unread`/`read`/`done`), `snoozed_until`,
  `deleted_at` (soft delete). All added with `addColumnIfMissing()` in
  `bootstrap()`; existing rows keep `state = 'unread'` when `read_at` is null,
  otherwise `'read'`.
- New tables: `notification_prefs` (per user, JSON per-event settings; whether
  it also carries workspace defaults is the open question) and
  `notification_mutes` (`user_id`, `workspace_id`, `scope_type`
  issue/page/project, `scope_id`).
- Retention sweep: delete rows older than 90 days (Done included) the first
  time the inbox or the count endpoint is read in a process; keep the badge
  query in the same sweep path.
- Server actions in `src/app/workspace-misc-actions.ts` and lib functions in
  `src/lib/issues.ts`; same business-layer rule as everywhere else.
- The internal API used by the badge must stay lightweight (count only).

## Files the PR will touch

- `src/db/client.ts` — `bootstrap()`: new columns, new tables, legacy backfill,
  90-day sweep helper. Idempotent.
- `src/db/schema.ts` — Drizzle types for the new columns/tables.
- `src/lib/issues.ts` — `notify()` payload; all notification call sites
  (`notifyAssigned`, comments, mentions, claims/release, blockers, handoff,
  due reminders); `listNotifications` with filters/cursor/search and grouped
  rows; mark read/unread; done/undo; soft delete/undo; mute filtering;
  preferences; retention.
- `src/app/workspace-misc-actions.ts` — mark unread, done, undo, mute,
  preferences, load-more/cursor actions (all return `ActionResult`).
- `src/app/[workspaceId]/notifications/page.tsx` — read `searchParams`
  (tab, q, cursor), pass them down; keep `await connection()` + `<Suspense>`.
- `src/components/notifications-view.tsx` — tabs, search box, grouped rows with
  counts, row actions, undo toast, snooze, load more, keyboard handling.
- `src/components/workspace-shell.tsx` — `G I` shortcut and the badge count
  matching the same 90-day/readable set.
- `src/lib/i18n/zh.ts` — new copy; structured notification sentences rendered
  with existing i18n helpers.
- New checks: `check-inbox-payload.ts`, `check-inbox-triage.ts`,
  `check-inbox-prefs.ts`; update the existing badge check. All are discovered
  by `scripts/check-all.ts`.
- No change to `mcp/server.ts` or `/api/v1/*`; notifications stay web-only.

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
2. The inbox can reach more than 50 notifications inside the 90-day window; the
   badge equals the unread rows the inbox can show.
3. Tabs, grouping and search return the expected rows; repeated events on one
   task collapse into one row with a count.
4. Mark unread, Done, undo, soft delete and Clear all have no data-loss dead
   ends.
5. Muting a task/document/project stops new notifications for it; preferences
   gate each event type.
6. Snooze hides a row and brings it back at the chosen time.
7. Old rows created before this PR still render after the backfill; unknown
   legacy rows keep their stored text.
8. A row marked Done disappears from the four tabs but appears in search, and
   is swept together with the rest after 90 days.

## Decisions (confirmed 2026-11-06, no open questions)

- One PR covers P0-P3; commits may be split by phase.
- Retention: 90 days, swept lazily.
- Done rows stay searchable until the sweep.
- Keyboard shortcuts: the full Linear set.
- Preferences are per user with per-user mutes; workspace-level policy,
  digest and email are follow-ups.
- Implement exactly this in the Inbox PR; do not mix in Agent access work.

## Follow-ups (not this PR)

- Server-mode daily digest / email delivery. Needs a mail configuration that
  does not exist yet; revisit after the Inbox PR.
- Notification channels beyond in-app (email/mobile push) for team servers.

## Per-user vs per-workspace preferences

- **Per user**: every member has their own event-type switches and mutes.
  Matches Linear/GitHub; a member can turn off comments or mute a noisy
  project without affecting anyone else. The workspace cannot enforce a
  minimum, so someone can switch off assignments and miss them.
- **Per workspace**: one owner/admin setting applies to everyone. Predictable
  and simpler, but one person's choice changes everyone's inbox, and per-person
  mutes are impossible.

Chosen: per-user preferences with sane defaults for every member, plus
per-user mutes. If the workspace needs a policy, add an owner-level "defaults"
row later instead of forcing everyone.
