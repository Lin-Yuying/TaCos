#!/usr/bin/env bash
# Gives one person's computer the tunnel to TaCos and nothing else: no shell, no other port.
#   sudo /opt/tacos/deploy/add-member-key.sh "ssh-ed25519 AAAA... tacos"
set -euo pipefail

KEY="${1:?usage: add-member-key.sh \"<public key line>\"}"
PORT="$(sed -n 's/^PORT=//p' /etc/tacos/env)"
FILE=/home/tacos/.ssh/authorized_keys

# Checked as a whole: grep looks at each line, and a second line would become an unrestricted key.
if [[ "$KEY" == *$'\n'* ]] || ! printf '%s\n' "$KEY" | grep -Eq '^ssh-(ed25519|rsa) [A-Za-z0-9+/=]+( [^"]*)?$'; then
  echo "That does not look like one public key line." >&2
  exit 1
fi
BODY="$(printf '%s' "$KEY" | cut -d' ' -f2)"
if grep -qF "$BODY" "$FILE"; then
  echo "Already added."
  exit 0
fi
# The realtime document socket sits one port above the app.
printf 'restrict,port-forwarding,permitopen="127.0.0.1:%s",permitopen="127.0.0.1:%s" %s\n' "$PORT" "$((PORT + 1))" "$KEY" >> "$FILE"
echo "Added."
