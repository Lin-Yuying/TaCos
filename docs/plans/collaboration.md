# U-11: Collaboration depth

Status: plan for a future PR. No implementation started. Written 2026-11-06
(loop round 3). Complements #78 (Inbox) and #80 (integrations).

## Why

TaCos already collaborates well in documents (live editing, presence, comments,
mentions) and has task comments, claims, review status and an activity
timeline. But collaboration on tasks is shallower than on docs: comments are
flat, there is no follow/watch toggle, no reactions or edit history, and no
workspace-level activity feed. For a team shell this is a daily-use gap.

## Current implementation

- Task comments: `comments` (issue, author or agent author, body, created);
  mentions create notifications; no edit/delete, threading, reactions or
  resolve.
- Project overview comments (`overview_comments`) and rich page comments
  (quoted passage, thread parent, resolve, edit/delete).
- Mentions: `@` mentions drive `mentioned` / `doc_mentioned` notifications;
  Inbox shows them (#78 rework).
- Follow model: creators and assignees receive comment/claim notices; there is
  no user-facing "Follow / Unfollow" control and no watcher list.
- Live updates: workspace live refresh (1.5 s) refreshes open pages/panels when
  another member changes something; task panels update in place.
- Activity: per-task `events` timeline; no workspace-wide activity feed.
- Review: per-task review status and a review queue page; agent runs add
  review requests (#79).
- Presence: document peers only; tasks/projects have no presence indicators.

## Researched best practice

- Linear: threaded comments, edit/delete, reactions, subscriptions to issues
  (auto-subscribe on create/assign/mention/comment), notification settings,
  activity feed, and Inbox triage (https://linear.app/docs/inbox.md).
- GitHub: PR review comments (inline, resolve), review states
  (approve/request changes/comment), reactions, subscriptions, and a
  notification inbox (https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications).
- Google Docs: inline comments, suggestions/suggesting mode, resolve/reopen,
  comment replies and notifications (https://support.google.com/docs/answer/6033474).
- Notion: page comments with resolve, mentions, page subscriptions; doc-level
  presence (https://www.notion.com/help/share-your-work).

Common pattern: a follow/subscription model + threads/reactions/resolve +
edit/delete history + a place (activity/inbox) that surfaces changes.

## Comparison

| Capability | TaCos today | Linear | GitHub | Google Docs |
| --- | --- | --- | --- | --- |
| Task comment threads | Flat | Threaded | Threaded review comments | Threaded comments |
| Edit/delete comment | No (task comments) | Yes | Yes (edit) | Yes |
| Reactions | No | Yes | Yes | No (emoji on comments?) |
| Resolve/close thread | No | Some | Yes (review) | Yes |
| Follow/unfollow | Implicit (creator/assignees) | Subscribe/unsubscribe | Subscribe | Notify settings |
| Mentions | Yes | Yes | Yes | Yes |
| Presence | Docs only | Inbox/views show avatars | Live | Docs |
| Workspace activity feed | No | Yes (activity) | Yes (notifications) | No |
| Review workflow | Review status + queue | Workflow states | PR reviews | Suggestions |

## Gaps, in priority order

1. **Task comments are flat and final.** No replies, edit, delete, resolve or
   reactions; mistakes cannot be corrected without a new comment.
2. **No explicit follow.** Only creators/assignees are watched; a member cannot
   follow/unfollow a task, project or doc, and there is no watcher list.
3. **No workspace activity feed.** Activity is per task; there is no "what
   changed across the workspace today" surface (Inbox is notifications, not
   activity).
4. **Review workflow is coarse.** Task review status exists, but review
   request/approve/request-changes feedback is not threaded on the task; agent
   review (#79) will need it.
5. **Presence is docs-only.** Tasks/projects have no "who is viewing/editing"
   signal; acceptable for v1, but note it.
6. **Task comment notifications are not configurable per thread** (mute thread/
   task); #78 handles in-app preferences.

## Candidate scope (one PR, four commits)

### Commit 1 — Comment model

- Extend `comments` with `parent_id`, `edited_at`, `deleted_at`,
  `resolved_at`, `reactions` (JSON or separate table), and mention metadata;
  keep old rows compatible.
- Threaded replies, resolve/reopen, edit/delete with history, emoji reactions
  (small fixed set), and mention parsing. Same model reused for overview
  comments where sensible.

### Commit 2 — Follow and watchers

- `issue_watchers` / `page_watchers` / `project_watchers` (or one generic
  `watchers` table) with auto-follow on create/assign/comment/mention (Linear
  model) and an explicit Follow/Unfollow button on the task/page/project.
- Watcher list in the panel; notifications honor follow state; "mute this
  thread/task" as a lightweight follow-off.
- Migration: existing creator/assignee behavior becomes the initial watcher
  set.

### Commit 3 — Activity and review

- Workspace Activity feed: filterable list of task/comment/review/page events
  (reuse `events` + new events), "My activity" and "Following" scopes; link to
  the object.
- Review thread: request changes / approve with comments attached to the task's
  review state; agent handoff/review (#79) can reuse it; review queue links to
  the comments.
- Optional: presence avatars on an open task panel (live refresh already
  exists).

### Commit 4 — Checks and docs

- `check-collaboration-comments.ts`: threads/edit/delete/resolve/reactions,
  mention notifications.
- `check-collaboration-follow.ts`: auto-follow, explicit follow/unfollow,
  notification routing, migration.
- `check-collaboration-activity.ts`: feed events/filters/permissions.
- UI screenshots; README; smoke + harness.

## Acceptance criteria

1. Task comments support replies, resolve/reopen, edit/delete and reactions;
   edits/deletes are reflected in the activity timeline.
2. Members can follow/unfollow a task, project or page; watchers see comment
   notifications and non-watchers do not (except explicit mentions).
3. A workspace activity feed shows recent changes with filters and obeys
   the existing project/page visibility rules.
4. Review request/approve/request-changes comments attach to the task review
   state and appear in the Inbox and review queue.
5. Existing notifications, Inbox, agent handoff and doc comments do not
   regress; tsc, i18n, agents-md, `check:harness` and build pass.

## Out of scope

- Real-time co-editing outside documents (docs already have Yjs).
- Voice/video, chat channels/DMs (Slack integration is #80; no personal channels are planned).
- External guest commenting (not planned: internal company use only).
- Presence/cursors on tasks/projects (optional follow-up).
- Comment moderation/anti-abuse tooling.

## Decisions (accepted per recommendation, 2026-11-06)

1. Task comments support full threading; the UI shows a single reply level with
   a quoted parent (no infinite indentation).
2. Reactions use a small fixed emoji set; no free emoji picker.
3. Follow model: auto-follow on create/assign/mention/comment, with explicit
   Follow/Unfollow and a watcher list; existing creator/assignee behavior is
   migrated to the initial watcher set.
4. A workspace-level Activity feed with filters is in scope; it must be clearly
   distinct from the Inbox (raw activity vs actionable notifications).
5. Review discussions reuse task comments with a review marker; no separate
   review entity.
6. Notifications are deduplicated per event (watcher + mention + reply produce
   one Inbox notice) and self-actions do not notify the actor.
7. Presence/cursors on tasks and projects stay a follow-up.
8. **UI gate:** wireframe/screenshot review before final polish; Activity vs
   Inbox must read differently, the task comment composer must not become
   heavy, and 1440/1100 screenshots are required for acceptance.

## Dependencies

- #78 for notification preferences/Inbox behaviors.
- #79 for agent review/handoff integration.

## Files likely touched

- `src/db/schema.ts` / `src/db/client.ts` — comment fields, watchers table,
  reactions; indexes.
- `src/lib/issues.ts` (comments/watchers/review), `src/lib/pages.ts`,
  `src/lib/agent-handoff.ts` (review integration).
- Comment components in the task panel/project overview/page panel; activity
  feed page; watcher buttons.
- `src/lib/i18n/zh.ts`, README, new checks.
