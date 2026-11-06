# U-08: Notification channels and mobile

Status: **not planned** (decision 2026-11-06: the team works at the computer
only; email, push, PWA/mobile and digests are unnecessary). Kept as a benchmark
and design record; no implementation is scheduled. In-app Inbox is #78;
Slack/webhooks are #80.

## Why (recorded before the decision)

Notifications exist only inside TaCos (Inbox + unread badge). Team members who
are not looking at the app miss assignments, mentions, review requests and
agent handoff finishes. Linear/GitHub/Slack all deliver email and mobile/push.
The Inbox PR (#78) adds per-user notification preferences; this PR gives those
preferences channels to control.

## Current implementation

- In-app Inbox with unread badge; notification types for assignments,
  comments, mentions, claims, review, agent handoff, workspace deletion (#78
  reworks the Inbox, adds preferences/mutes).
- Live refresh (1.5 s) updates open pages; desktop Electron app; no PWA
  manifest/service worker.
- No email, push, SMS or mobile app; no digest; no quiet hours.
- Slack notifications will be covered by #80 for automation rules, but personal
  event notifications to Slack are not planned there.

## Researched best practice

- Linear notifications: in-app Inbox + email + desktop + mobile push + Slack;
  per-event notification settings, channel selection, and view subscriptions
  (https://linear.app/docs/inbox.md, https://linear.app/docs/slack.md).
- GitHub notifications: in-app inbox, email, GitHub Mobile, watch settings and
  custom filters; read state syncs across channels
  (https://docs.github.com/en/subscriptions-and-notifications/get-started/configuring-notifications).
- Slack: channel/mention controls, notification schedules/quiet hours.
- PWA best practices: installable manifest, service worker, web push with VAPID,
  offline shell for read-only; native apps only when push/offline needs exceed
  the browser.

Common pattern: a **channel preference matrix** (event type × channel),
quiet hours/digests, reliable delivery with retries, and read-state sync.

## Comparison

| Capability | TaCos today | Linear | GitHub | Slack |
| --- | --- | --- | --- | --- |
| In-app inbox | Yes (#78) | Yes | Yes | Yes |
| Email notifications | No | Yes | Yes | Yes |
| Desktop push | No | Yes | Yes | Yes |
| Mobile app / push | No | Yes | Yes (iOS/Android) | Yes |
| PWA install | No | — | — | — |
| Per-event channel prefs | No (only Inbox prefs planned) | Yes | Yes | Yes |
| Quiet hours / schedule | No | Some | Some | Yes |
| Digest | No | Some | Some | — |
| Slack channel delivery | No (#80 rules only) | Yes | No | N/A |
| Read-state sync across channels | No | Yes | Yes | N/A |

## Gaps, in priority order

1. **No out-of-app channel.** Assignments/mentions/reviews are missed when the
   app is closed.
2. **No channel preference matrix.** #78 preferences only affect the Inbox.
3. **No quiet hours or digest.** Every event would be disruptive if pushed.
4. **No mobile/PWA.** No installable app, offline read-only shell or push.
5. **No delivery reliability model** (queue, retries, bounce handling,
   unsubscribe).
6. **No cross-channel read state.** Reading in one place should mark others.

## Candidate scope (one PR, four commits)

### Commit 1 — Channel model and preferences

- Extend the #78 per-user notification preferences to channel dimensions:
  `in_app`, `email`, `push`, `slack` (slack via #80 later; keep the enum
  extensible), per event type; quiet hours and digest cadence (instant/daily/
  weekly).
- Settings → Notifications UI: matrix, quiet hours, digest time, per-workspace
  overrides (personal prefs first; a workspace policy is not planned).
- Server-side decision function: event → channels, respecting prefs, mutes
  (#78), quiet hours and digest batching.

### Commit 2 — Email delivery

- Admin SMTP settings (host/port/TLS/user/password/from name), test email;
  secrets encrypted.
- Templated notification/digest emails with deep links; reply-to disabled or
  inbound parse marked follow-up; unsubscribe/manage link; list-unsubscribe
  header; bounce/error logging.
- Delivery queue in SQLite with retries/backoff and rate limiting; tests with a
  fake SMTP transport; owner-only configuration, per-user opt-in (email
  verified).

### Commit 3 — Web push and PWA

- Service worker + manifest: installable PWA, offline read-only shell for
  Inbox/tasks (cached last view), "add to home screen" guidance.
- Web push: VAPID keys, subscription table per device, permission prompt after
  opt-in, delivery via the same decision function, quiet hours respected.
- iOS Safari push constraints documented; fallback to email.
- Mobile-responsive polish for Inbox/task panel (no native app in this PR).

### Commit 4 — Checks and docs

- `check-notification-preferences.ts` (matrix/quiet hours/digest decisions),
  `check-email-delivery.ts` (fake SMTP, retries, unsubscribe, no secret in
  logs), `check-push-subscriptions.ts` (subscribe/send/prune), PWA
  installability check.
- README/runbook (SMTP, VAPID, mobile), screenshots.

## Acceptance criteria

1. A user can opt into email/push per event type, set quiet hours and a digest
   cadence; events route according to the matrix and are suppressed by mutes.
2. Email arrives through configured SMTP with a working deep link and
   unsubscribe; failed sends retry with backoff and never log credentials.
3. The app is installable as a PWA; push subscriptions can be created/removed;
   a push arrives for an opted-in event and respects quiet hours.
4. Reading a notification in one channel marks it read in the others (at least
   in-app/email link).
5. Guests/members without email verification are not emailed; owner/admin only
   configures SMTP/VAPID.
6. Existing Inbox/#78 preferences, Slack/webhooks (#80) and desktop behavior do
   not regress; tsc, i18n, agents-md, `check:harness` and build pass.

## Out of scope

- Native iOS/Android apps (PWA first).
- SMS, chat apps (Slack is #80 for rules; personal Slack DMs follow-up).
- Marketing/announcement email.
- Inbound email-to-task (could be a follow-up with #80).
- Push via APNs/FCM (web push only in this PR).

## Open decisions

1. Order: email first (recommended) or web push/PWA first?
2. Email transport: SMTP config (recommended, self-host friendly) or a provider
   API?
3. Digest: daily only (recommended) or daily + weekly?
4. Mobile: PWA first (recommended) or plan a native shell later?
5. Quiet hours: user timezone (recommended) and per-workspace defaults?

## Dependencies

- #78 for notification preferences/mutes/Inbox.
- #80 for Slack/webhook delivery and reuse of the automation channel.
- U-12 for self-host configuration UX.

## Files likely touched

- `src/db/schema.ts` / `src/db/client.ts` — channel prefs, push subscriptions,
  delivery queue, SMTP settings (encrypted).
- New `src/lib/notify/` (decision, email, push, digest) and a delivery worker
  (in-process interval, no new daemon).
- Settings → Notifications/SMTP pages; service worker/manifest; Inbox links.
- `src/lib/i18n/zh.ts`, README/runbook, new checks.
