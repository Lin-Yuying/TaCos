#!/usr/bin/env bash
# Installs or updates TaCos on a Linux server. Run as root from the unpacked release folder:
#   sudo ./deploy/install.sh ./payload
# Adds only its own account, folders and systemd units, and listens only on localhost.
set -euo pipefail

PAYLOAD="${1:?usage: install.sh <payload dir>}"
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
TACOS_DATA_DIR=/var/lib/tacos/data
TACOS_SEED_DEMO=0
TACOS_ADMIN_PASSWORD=$ADMIN_PASSWORD
ENV
  echo "Admin password saved to /etc/tacos/env. It is not printed here."
fi

rm -rf /opt/tacos/app.new
cp -R "$PAYLOAD" /opt/tacos/app.new
rm -rf /opt/tacos/app.old
[ -d /opt/tacos/app ] && mv /opt/tacos/app /opt/tacos/app.old
mv /opt/tacos/app.new /opt/tacos/app

install -m 644 "$HERE/backup.mjs" /opt/tacos/deploy/backup.mjs
install -m 755 "$HERE/add-member-key.sh" /opt/tacos/deploy/add-member-key.sh
install -m 644 "$HERE/tacos.service" "$HERE/tacos-backup.service" "$HERE/tacos-backup.timer" /etc/systemd/system/
sed -i "s/^PORT=.*/PORT=$PORT/" /etc/tacos/env
systemctl daemon-reload
systemctl enable --now tacos-backup.timer
systemctl enable tacos.service
systemctl restart tacos.service
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/login"; then
    echo "TaCos is running on 127.0.0.1:$PORT"
    exit 0
  fi
  sleep 2
done
echo "TaCos did not answer on 127.0.0.1:$PORT. See: journalctl -u tacos -n 50" >&2
exit 1
