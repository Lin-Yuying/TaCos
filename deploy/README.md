# TaCos team server

The server stores data only. It starts no agent CLI and holds no model key: each member's Agent runs on their own computer. TaCos listens on `127.0.0.1:3200`, and members reach it through an SSH tunnel that the desktop app opens.

## Install or update

1. Download `TaCos-Server-<version>-linux-x64.tar.gz` from the release to the server.
2. Unpack it: `tar -xzf TaCos-Server-<version>-linux-x64.tar.gz`.
3. Run the installer: `sudo ./deploy/install.sh ./payload`.

The installer adds the `tacos` account, `/opt/tacos`, `/var/lib/tacos`, `/etc/tacos/env` and three systemd units. It changes nothing else on the machine. The first run creates the admin password in `/etc/tacos/env` and does not print it.

An update does these steps and stops if one fails:

1. Requires 1 GB free on `/var/lib/tacos`.
2. Copies the database and uploads to a verified `pre_upgrade-*` backup.
3. Moves the running app to `/opt/tacos/app.old` and starts the new app.
4. Checks `/api/health` reports the new version. If it does not, it tells you the rollback command.

Open **Settings → System** to see the version, disk, backup and rollback state before and after an upgrade.

## Add a member

1. In the desktop app, have the member open **TaCos Server…** and click **Show my SSH key for the admin**.
2. On the server, add the line the member sends: `sudo /opt/tacos/deploy/add-member-key.sh "<line>"`.
3. Have the member enter `tacos@<server>` under **Team server over SSH** and connect.

The key can only forward to the TaCos port and the realtime document socket one port above it, which also listens on `127.0.0.1`. It opens no shell.

## Backup

`tacos-backup.timer` copies the database and uploads to `/var/lib/tacos/backups/<date>` once a day and keeps 14 days. Every copy is checked with SQLite's `integrity_check` and gets a `manifest.json` naming the app version, size and hash. The copies are on the same machine, so they do not protect against losing the server; copy the folder elsewhere for that.

In **Settings → System**, a site admin can set retention between 1 and 90 days and click **Back up now**. The workspace owner can also download a diagnostics bundle. That bundle has logs, redacted configuration and the schema version, never database rows or secrets.

## Restore

Restore from **Settings → System → Backups**, or by hand on the server.

In the product (workspace owner only):

1. Pick a backup made by the running version. Backups from another version are listed but cannot be restored.
2. Type `RESTORE` in the confirmation dialog.
3. The server creates a safety backup, replaces the database, and checks integrity. If the swap fails, the safety backup is put back.
4. Restart the service: `sudo systemctl restart tacos`.

By hand: stop `tacos.service`, copy `tacos.db` from a backup into `/var/lib/tacos/data`, remove `tacos.db-wal` and `tacos.db-shm`, set the owner to `tacos`, and start the service. Uploaded files are not replaced by a restore; the backup keeps a copy if you need an older file.

## Rollback

One command, as root:

```bash
sudo /opt/tacos/deploy/rollback.sh
```

It puts `/opt/tacos/app.old` back, restores the newest verified `pre_upgrade` backup, keeps a copy of the database it replaced at `/var/lib/tacos/backups/pre-rollback-<time>.db`, and checks `/login`. It refuses to run without a pre-upgrade backup. The replaced app stays at `/opt/tacos/app.failed`. Older versions are not auto-rollback targets: one step back, not a version history.

## Updates and signing

The server is updated only with the release tarball and `deploy/install.sh`; it has no remote update control. The desktop app uses the stable channel and shows release notes, failure state and whether the build is signed in **Settings → System**. Unsigned or ad-hoc builds open the GitHub download page instead of installing in place.

Code signing and notarization remain with the owner. Without a Developer ID (macOS) or a trusted Authenticode certificate (Windows), the installer labels the build unsigned and the in-app update cannot replace it silently.

## Runner and tunnel

Members' computers connect through the SSH tunnel; the server never starts a runner and never controls one. **Settings → System → Runners** shows, read-only, which computers are online, when each was last seen, which harnesses are ready, and recent run errors. If a computer is offline, open TaCos on it and check the tunnel; there is no remote restart.
