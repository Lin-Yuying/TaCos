# U-12: Desktop and self-host operations

Status: plan for a future PR. No implementation started. Written 2026-11-06
(loop round 4).

## Why

TaCos ships as a thin Electron shell for an existing server, a standalone build
with its own SQLite, a Linux server tarball, and a desktop runner for server
mode. The code is mature enough to run, but operations are mostly manual: no
in-product health/diagnostics, limited backup/restore UX, unsigned builds, no
update channels, and no admin view of the runner/backup state. As the team
relies on the deployed server, operations become part of the product.

## Current implementation

- Electron: `electron/` shell, thin and standalone builds, electron-updater with
  GitHub releases, signed/ad-hoc handling in `updater.js`, auto-restart
  confirmation, update pill (#72).
- Server: `deploy/install.sh` (Node, systemd unit, backup timer dirs),
  `/opt/tacos/app`, `/var/lib/tacos/data` (SQLite + uploads), `/etc/tacos/env`.
- Desktop standalone: bundled server + private SQLite, data in app userData.
- Server mode: SSH tunnel + per-user desktop runner (`runner/hub.ts`) for CLI
  harnesses; runner status already tracked for the Agent.
- Settings → Storage and recovery (`/settings/storage`) has limited UI.
- Existing safe patterns: idempotent bootstrap, lazy recycle-bin sweeps, lazy
  key-usage/cleanup, backups directory.
- Gaps: no integrity/health page, no in-app backup verification/restore, no
  log bundle/diagnostics, no update channel/rollback UX, unsigned builds (user
  handles signing), no upgrade preflight/dry-run, no runner reconnection UI.

## Researched best practice

- Desktop apps (VS Code, Linear, Obsidian): stable/insider update channels,
  in-app "check for updates" with release notes/rollback guidance, diagnostics
  pages, log export, offline behavior, crash reporting.
- Self-hosted/SaaS-adjacent products: health endpoints, backup verification,
  restore with confirmation, retention, pre-upgrade snapshots, admin
  observability (disk/DB size/version), signed update artifacts/notarization.
- GitHub/Linear notifications and status pages: clear upgrade/rollback
  messaging and a "system status" surface.

Common pattern: **visible system health + verified backups + safe upgrade/rollback
+ diagnostics bundle**, all in-product rather than in runbooks.

## Comparison

| Capability | TaCos today | Desktop best practice | Self-host best practice |
| --- | --- | --- | --- |
| Update channel / rollback | Single GitHub release channel; auto-update | Stable/insider channels, notes, rollback | Versioned deploy + rollback |
| Signing/notarization | Ad-hoc unsigned; Windows unsigned | Signed/notarized | Checksums/signed artifacts |
| Backup verification | Manual/systemd backup; no UI | Local export + cloud | Scheduled verified backups, restore drills |
| Restore UX | DB file copy in runbook | In-app restore | In-app restore with confirmation |
| Health/diagnostics | Logs on disk | Diagnostics page, log export | Health endpoint, metrics, log bundle |
| Runner/tunnel status | Agent handoff shows online; no admin page | N/A | Visible worker status/reconnect |
| Pre-upgrade safety | Manual backup in deploy | Automatic snapshot | Preflight + automatic backup |

## Gaps, in priority order

1. **No system health surface.** Version, DB size/integrity, disk, uptime,
   backup age, service/runner status are only in SSH/runbooks.
2. **No verified backup/restore UX.** Backup timer exists but restore is manual
   and unverified in the product; no pre-upgrade snapshot.
3. **No diagnostics/log bundle.** Turn logs and server logs exist on disk but
   cannot be exported in one redacted bundle.
4. **Update UX is partial.** Update pill works for desktop; server upgrade is a
   manual tarball flow; no channel/rollback guidance.
5. **No runner/tunnel admin state.** Users see "waiting for your computer";
   admins cannot see runner connectivity history/errors in one place.
6. **Signing/notarization** remains external; document the current limitation
   and make the update flow explicit.

## Candidate scope (one PR, four commits)

### Commit 1 — System health and diagnostics

- Settings → System: server version, Node/SQLite versions, DB path/size/WAL,
  `PRAGMA integrity_check`, uploads size, disk free, uptime, service status,
  backup last-run/age, runner status, update channel/version.
- "Download diagnostics bundle": redacted env/config, recent server log, turn
  logs, DB schema version, sizes; never secrets/API keys; size limit.
- Health endpoint for external monitoring (JSON, no secrets).

### Commit 2 — Backup and restore

- Verified backups: reuse the systemd timer, record runs/integrity in a
  `backup_runs` table; retention policy; pre-upgrade automatic backup.
- In-app "Back up now", restore from a selected backup with typed confirmation,
  automatic safety backup before restore, and a post-restore integrity check.
- Settings UI shows last/next backup and lets an owner trigger/download a
  backup; restore allowed only on the instance that owns the data.

### Commit 3 — Upgrade and rollback UX

- Desktop: update channel (stable/insider) + notes/rollback guidance; clearer
  failure states (checksum/signature/restart).
- Server: upgrade preflight (disk, backup, version check), verify new version
  after restart, keep `app.old` rollback path visible in System, and a
  documented one-command rollback.
- Do not implement code signing (owner provides certificates); document what is
  required and surface "unsigned build" state.

### Commit 4 — Runner/tunnel admin and checks

- Admin view of desktop runners: online state, last seen, harness readiness,
  recent errors, and "restart tunnel/runner" guidance (no remote control).
- `check-system-health.ts` (health payload, no secrets, integrity path),
  `check-backup-restore.ts` (backup/restore round-trip on a temp DB, safety
  backup, failure handling), `check-upgrade-preflight.ts` (version/disk/backup
  checks); docs/runbook updates; screenshots.

## Acceptance criteria

1. An owner can open System and see version, DB size/integrity, disk, uptime,
   backup age, runner status, and update channel; no secret appears in the
   diagnostics bundle.
2. "Back up now" produces a verified backup; restore from the UI requires typed
   confirmation, creates a safety backup, and passes integrity check.
3. Pre-upgrade backup runs automatically; rollback to `app.old` is documented
   and visible in System.
4. Desktop update channel/notes/failure states are clear; unsigned builds are
   labelled.
5. Admin runner view shows online/last seen/errors; users see the same
   connectivity state in the Agent/handoff UI.
6. Existing deploy/backup/upgrade flows are not broken; tsc, i18n, agents-md,
   `check:harness` and build pass.

## Out of scope

- Hosted/SaaS offering, multi-node clustering, Kubernetes operator.
- Implement signing/notarization itself (owner handles certificates/CI signing).
- Full observability stack (metrics/tracing backend; U-06/enterprise can add).
- Automatic remote runner control.
- SSO/admin console (U-06).

## Decisions (accepted per recommendation, 2026-11-06)

1. Desktop updates ship the **stable channel only** in v1; insider is a
   follow-up.
2. Backups run **daily with a 14-day retention** (configurable), plus an
   automatic pre-upgrade backup.
3. The diagnostics bundle contains logs, redacted config and the DB schema
   version; **no database data**, with a size cap.
4. Restore supports the **same version only**; cross-version migration stays a
   follow-up. Rollback means the previous `app` plus the pre-upgrade backup.
5. The runner/tunnel admin view is **read-only** (state, last seen, errors,
   guidance); no remote control.
6. Signing/notarization stays with the owner; the UI labels unsigned builds and
   documents what is required.
7. Server rollback guarantees only the previous app version plus the
   pre-upgrade backup; older versions are not auto-rollback targets.
8. **UI gate:** restore is a destructive flow, so confirmations, warnings and
   rollback state must be explicit; System must not become an information dump;
   1440/1100 screenshots are required.

## Dependencies

- U-06 for admin console/roles; U-05 for export/import.
- The desktop updater and deploy scripts already exist; this builds on them.

## Files likely touched

- `electron/updater.js` / `main.js`, package version/update channels.
- `deploy/install.sh`, systemd units, backup scripts/docs.
- `src/app/[workspaceId]/settings/storage` → System/Backup/Updates pages.
- New `src/lib/ops/` (health, diagnostics, backup metadata, runner status).
- `src/lib/runner/hub.ts` status reads; `src/lib/i18n/zh.ts`, README, checks.
