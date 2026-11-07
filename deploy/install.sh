#!/usr/bin/env bash
# Installs or updates TaCos on a Linux server. Run as root from the unpacked release folder:
#   sudo ./deploy/install.sh ./payload
# Adds only its own account, folders and systemd units, and listens only on localhost.
set -euo pipefail

PAYLOAD="${1:?usage: install.sh <payload dir>}"
PAYLOAD_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PAYLOAD/package.json" 2>/dev/null | head -1)"
[ -n "$PAYLOAD_VERSION" ] || { echo "The payload has no package.json version. Rebuild the server bundle." >&2; exit 1; }
NODE_VERSION="v24.13.0"
# An update keeps the port that members' keys already permit.
KEPT_PORT=""
[ -f /etc/tacos/env ] && KEPT_PORT="$(sed -n 's/^PORT=//p' /etc/tacos/env)"
PORT="${TACOS_PORT:-${KEPT_PORT:-3200}}"
HERE="$(cd "$(dirname "$0")" && pwd)"

if ! id tacos >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/tacos --shell /usr/sbin/nologin tacos
fi
install -d -o tacos -g tacos -m 700 /var/lib/tacos /var/lib/tacos/data /var/lib/tacos/backups
install -d -o tacos -g tacos -m 700 /home/tacos/.ssh
install -o tacos -g tacos -m 600 /dev/null /home/tacos/.ssh/authorized_keys.new
if [ -f /home/tacos/.ssh/authorized_keys ]; then
  rm /home/tacos/.ssh/authorized_keys.new
else
  mv /home/tacos/.ssh/authorized_keys.new /home/tacos/.ssh/authorized_keys
fi
install -d -m 755 /opt/tacos /opt/tacos/deploy

if [ ! -x /opt/tacos/node/bin/node ] || [ "$(/opt/tacos/node/bin/node -v)" != "$NODE_VERSION" ]; then
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz" -o /tmp/tacos-node.tar.xz
  rm -rf /opt/tacos/node
  mkdir -p /opt/tacos/node
  tar -xJf /tmp/tacos-node.tar.xz -C /opt/tacos/node --strip-components=1
  rm /tmp/tacos-node.tar.xz
fi

# U-12 preflight: a release copy plus a verified pre-upgrade backup need room.
FREE_KB="$(df -Pk /var/lib/tacos | awk 'NR==2 {print $4}')"
if [ "${FREE_KB:-0}" -lt 1048576 ]; then
  echo "At least 1 GB must be free on /var/lib/tacos before upgrading (have ${FREE_KB:-0} KB)." >&2
  exit 1
fi

if [ ! -f /etc/tacos/env ]; then
  install -d -m 755 /etc/tacos
  ADMIN_PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -d '+/=')"
  # Only this file: the app folder copied below has to stay readable by the tacos account.
  (umask 077; cat > /etc/tacos/env) <<ENV
NODE_ENV=production
HOSTNAME=127.0.0.1
PORT=$PORT
NODE_OPTIONS=--max-old-space-size=512
TACOS_SERVER_MODE=1
TACOS_APP_ROOT=/opt/tacos/app
TACOS_DATA_DIR=/var/lib/tacos/data
TACOS_SEED_DEMO=0
TACOS_ADMIN_PASSWORD=$ADMIN_PASSWORD
ENV
  echo "Admin password saved to /etc/tacos/env. It is not printed here."
fi

OLD_VERSION=""
[ -f /opt/tacos/app/package.json ] && OLD_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' /opt/tacos/app/package.json | head -1)"

# U-12: one verified pre-upgrade snapshot before the running app is touched.
install -d -m 755 /opt/tacos/deploy
install -m 644 "$HERE/backup.mjs" /opt/tacos/deploy/backup.mjs
install -m 755 "$HERE/rollback.sh" /opt/tacos/deploy/rollback.sh
if [ -f /var/lib/tacos/data/tacos.db ]; then
  echo "Taking a pre-upgrade backup before replacing version ${OLD_VERSION:-unknown} with $PAYLOAD_VERSION."
  if ! runuser -u tacos -- /opt/tacos/node/bin/node /opt/tacos/deploy/backup.mjs --kind=pre_upgrade; then
    echo "The pre-upgrade backup failed. The running app was not replaced." >&2
    exit 1
  fi
fi

rm -rf /opt/tacos/app.new
cp -R "$PAYLOAD" /opt/tacos/app.new
rm -rf /opt/tacos/app.old
[ -d /opt/tacos/app ] && mv /opt/tacos/app /opt/tacos/app.old
mv /opt/tacos/app.new /opt/tacos/app

install -m 755 "$HERE/add-member-key.sh" /opt/tacos/deploy/add-member-key.sh
install -m 644 "$HERE/tacos.service" "$HERE/tacos-backup.service" "$HERE/tacos-backup.timer" /etc/systemd/system/
sed -i "s/^PORT=.*/PORT=$PORT/" /etc/tacos/env
grep -q '^TACOS_APP_ROOT=' /etc/tacos/env || echo 'TACOS_APP_ROOT=/opt/tacos/app' >> /etc/tacos/env
systemctl daemon-reload
systemctl enable --now tacos-backup.timer
systemctl enable tacos.service
systemctl restart tacos.service
# U-12: verify the version that actually came up, not just that a port answers.
for _ in $(seq 1 30); do
  BODY="$(curl -fsS "http://127.0.0.1:$PORT/api/health" 2>/dev/null || true)"
  RUNNING_VERSION="$(printf '%s' "$BODY" | /opt/tacos/node/bin/node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).version||""))}catch{}})')"
  if [ "$RUNNING_VERSION" = "$PAYLOAD_VERSION" ]; then
    echo "TaCos $PAYLOAD_VERSION is running on 127.0.0.1:$PORT"
    exit 0
  fi
  sleep 2
done
echo "TaCos did not report version $PAYLOAD_VERSION on 127.0.0.1:$PORT (last: ${RUNNING_VERSION:-no health response}). See: journalctl -u tacos -n 50" >&2
echo "Roll back with: sudo /opt/tacos/deploy/rollback.sh" >&2
exit 1
