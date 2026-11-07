# TaCos operations runbook

For the person who runs a TaCos server. The product surface is **Settings → System**; this
runbook explains what to look at and what each action does. It does not cover hosted
deployment, clustering, an observability stack or remote runner control — none of those
ship.

## What runs where

- The server stores data only. It starts no agent CLI and holds no model key.
- Each member's computer runs Agent work through the desktop runner and connects through
  the SSH tunnel the desktop app opens.
- The server and the desktop standalone app each have one SQLite database. Backups and
  restores apply to the instance that owns that database.

## Health

- `GET /api/health` is public, has no secrets and no file paths. It returns `200` when the
  status is `ok` or `warn`, and `503` when the database integrity check fails.
- The System page shows the same data plus paths, schema version and checks.
- `Database integrity` uses SQLite `quick_check` (cached for a minute). Backups and restore
  use the full `integrity_check`.
- Warning thresholds: less than 5 GB free warns, less than 1 GB fails; a backup older than
  48 hours warns; a write-ahead log over 512 MB warns.
- A failing database check is not repaired from this page. Stop writes, restore a verified
  backup or open a support case with the diagnostics bundle.

## Backups

- `tacos-backup.timer` runs daily and keeps 14 days by default. It writes
  `/var/lib/tacos/backups/<date>/` with `tacos.db`, `uploads/` and `manifest.json`.
- **Settings → System → Backups → Back up now** writes the same shape under a `manual-*`
  folder and records the run in `backup_runs`.
- Retention is 1–90 days and is set by the workspace owner. The timer uses
  `TACOS_BACKUP_KEEP_DAYS`; the app uses the saved setting. Set both to the same number.
- Every backup is verified with `integrity_check` and hashed. A failed check deletes the
  partial folder and records a failed run.
- The copies are on the same machine. Copy the backup folder off the server to survive
  losing the machine.

## Restore

Restore only from a backup made by the running version (decision: same version only).

1. Open **Settings → System → Backups** as the workspace owner.
2. Pick a backup whose version matches; older-version backups are listed but not
   selectable.
3. Read the warning, type `RESTORE`, and confirm.
4. TaCos creates a `safety-*` backup, replaces the database, removes the old WAL files and
   runs `integrity_check`. If the swap or the check fails, it puts the safety backup back.
5. Restart the service: `sudo systemctl restart tacos`. On the desktop app, quit and
   reopen it.

Constraints and consequences:

- Restore is refused while any Agent run is queued or running.
- Everyone else must stop editing first. Changes made after the safety backup are lost.
- Database access stops during the swap; requests get a "restoring" 503 and can retry.
- Uploaded files are not replaced. The backup keeps a copy if an older file is needed.
- The `backup_runs` table comes from the restored database; the safety backup is recorded
  there again after the swap.

## Upgrade

Server:

1. Open **Settings → System → Updates**. Resolve any blocked preflight check (disk, backup,
   version, rollback path).
2. Download the release tarball, unpack it, run `sudo ./deploy/install.sh ./payload`.
3. The installer requires 1 GB free, takes a verified `pre_upgrade-*` backup, moves the
   running app to `/opt/tacos/app.old`, starts the new app and checks that `/api/health`
   reports the new version.
4. If the version does not match, the installer prints the rollback command and exits
   non-zero.

Desktop: only the stable channel ships. The update pill in the tab bar downloads and
installs. **Settings → System → Updates** shows the channel, release notes, failure state
and whether the build is signed. Unsigned or ad-hoc builds open the GitHub download page
instead of replacing themselves.

## Rollback

```bash
sudo /opt/tacos/deploy/rollback.sh
```

It stops the service, verifies the newest `pre_upgrade` backup, copies the current database
to `pre-rollback-<time>.db`, restores the backup and `app.old`, starts the service and probes
`/login`. It refuses to run without a pre-upgrade backup. The replaced app stays at
`/opt/tacos/app.failed`; only one version back is kept by design.

## Diagnostics bundle

**Settings → System → Diagnostics → Download diagnostics bundle** returns one text file,
capped at 2 MB:

- version, channel, mode, Node, platform, data/backup/log paths;
- configuration keys beginning with `TACOS_`, plus proxy/Node keys, with values of
  secret-looking keys replaced by `<redacted>`;
- schema version, table/index counts, integrity result;
- the operations log (`~/.tacos/logs/server.log`, or `TACOS_LOG_DIR/server.log`);
- the newest 10 harness turn logs, last 200 lines each.

It contains no database dump, account row, task or document. Known secret values are
replaced everywhere, including inside log lines. Resolve remaining log content before
sharing: turn logs can contain prompts.

## Runners and tunnel

**Settings → System → Runners** is read-only: online state, last seen, harness readiness and
the latest three failed runs per member. If a computer is offline:

1. Open TaCos on that computer.
2. Check **TaCos Server…** and its SSH tunnel.
3. Confirm the harness is enabled and detected in Settings → Harness.

There is no remote restart, disconnect or tunnel control in TaCos.

## Signing

Code signing and notarization stay with the owner. Without a Developer ID (macOS) or a
trusted Authenticode certificate (Windows), **Settings → System** labels the build unsigned
and updates open the GitHub download page. The server tarball has no signature check beyond
the release you download; verify the release checksum before installing.

## Screenshots to capture for this item

The Lead captures the real browser evidence at 1440×900 and 1100×800. Keep these states:

1. System page, healthy server (summary cards + checks).
2. System page with a warning (disk under 5 GB or backup missing).
3. Backups section with at least one verified backup and retention control.
4. Restore dialog with the typed confirmation field empty and the destructive warning.
5. Restore dialog with `RESTORE` typed and the submit button enabled.
6. Restore result banner with the restart command.
7. Updates section with preflight checks and the rollback command.
8. Desktop update details (release notes, channel, unsigned label) when running the desktop
   shell.
9. Runners section with one online and one offline member, and a run error row.
10. Diagnostics section and the downloaded bundle header.

Testids: `system-page`, `system-overall`, `system-refresh`, `system-stat-*`,
`system-checks`, `system-backup`, `backup-now`, `backup-retention`, `backup-list`,
`restore-dialog`, `restore-confirm`, `restore-submit`, `restore-result`, `system-updates`,
`upgrade-preflight`, `upgrade-refresh`, `pre-upgrade-backup`, `rollback-command`,
`desktop-update`, `system-runners`, `system-download-diagnostics`, `system-details`.

## Not covered

- Hosted/SaaS, multi-node clustering, Kubernetes.
- A metrics/tracing backend; `/api/health` is the monitoring surface.
- Automatic runner/tunnel control.
- Code signing automation.
