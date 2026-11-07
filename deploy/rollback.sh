#!/usr/bin/env bash
# U-12: one-command server rollback.
# Puts the previous app (app.old) back and restores its newest pre-upgrade backup. Stops
# the service, verifies the backup before touching the live database, keeps a copy of the
# current database beside the backups, restarts, and checks /login.
# Run as root: sudo /opt/tacos/deploy/rollback.sh
set -euo pipefail

APP=/opt/tacos/app
OLD=/opt/tacos/app.old
ENV_FILE=/etc/tacos/env
DATA=/var/lib/tacos/data
NODE=/opt/tacos/node/bin/node
FAILED=/opt/tacos/app.failed

[ -d "$OLD" ] || { echo "No previous app at $OLD. Nothing to roll back to." >&2; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Missing $ENV_FILE." >&2; exit 1; }

PORT="$(sed -n 's/^PORT=//p' "$ENV_FILE" | head -1)"
PORT="${PORT:-3200}"
CONFIGURED_BACKUPS="$(sed -n 's/^TACOS_BACKUP_DIR=//p' "$ENV_FILE" | head -1)"
BACKUP_DIR="${TACOS_BACKUP_DIR:-${CONFIGURED_BACKUPS:-/var/lib/tacos/backups}}"
PREVIOUS_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$OLD/package.json" 2>/dev/null | head -1)"
PREVIOUS_VERSION="${PREVIOUS_VERSION:-unknown}"

SNAP="$(ls -1dt "$BACKUP_DIR"/pre_upgrade-* 2>/dev/null | head -1 || true)"
[ -n "$SNAP" ] || { echo "No pre-upgrade backup in $BACKUP_DIR. Refusing to roll back without restoring data." >&2; exit 1; }
[ -f "$SNAP/tacos.db" ] || { echo "$SNAP has no tacos.db." >&2; exit 1; }

echo "Verifying $SNAP/tacos.db before stopping the service."
"$NODE" -e '
const Database = require("/opt/tacos/app/node_modules/better-sqlite3");
const db = new Database(process.argv[1], { readonly: true, fileMustExist: true });
const result = db.pragma("integrity_check", { simple: true });
db.close();
if (result !== "ok") { console.error(`integrity check failed: ${result}`); process.exit(1); }
' "$SNAP/tacos.db"

echo "Rolling back to version $PREVIOUS_VERSION with $SNAP."
# If anything below fails, bring the service back up rather than leaving it stopped.
trap 'systemctl start tacos.service >/dev/null 2>&1 || true' EXIT
systemctl stop tacos.service

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if [ -f "$DATA/tacos.db" ]; then
  install -o tacos -g tacos -m 600 "$DATA/tacos.db" "$BACKUP_DIR/pre-rollback-$STAMP.db"
  echo "Current database copied to $BACKUP_DIR/pre-rollback-$STAMP.db"
fi
rm -f "$DATA/tacos.db-wal" "$DATA/tacos.db-shm"
install -o tacos -g tacos -m 600 "$SNAP/tacos.db" "$DATA/tacos.db"

rm -rf "$FAILED"
mv "$APP" "$FAILED"
mv "$OLD" "$APP"
systemctl start tacos.service

for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login"; then
    trap - EXIT
    echo "TaCos $PREVIOUS_VERSION is running on 127.0.0.1:$PORT."
    echo "The replaced app is kept at $FAILED. Uploaded files were not replaced."
    exit 0
  fi
  sleep 2
done
trap - EXIT
echo "TaCos did not answer after the rollback. See: journalctl -u tacos -n 50" >&2
exit 1
