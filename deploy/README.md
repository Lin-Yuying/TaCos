# TaCos team server

The server stores data only. It starts no agent CLI and holds no model key: each member's Agent runs on their own computer. TaCos listens on `127.0.0.1:3200`, and members reach it through an SSH tunnel that the desktop app opens.

## Install or update

1. Download `TaCos-Server-<version>-linux-x64.tar.gz` from the release to the server.
2. Unpack it: `tar -xzf TaCos-Server-<version>-linux-x64.tar.gz`.
3. Run the installer: `sudo ./deploy/install.sh ./payload`.

The installer adds the `tacos` account, `/opt/tacos`, `/var/lib/tacos`, `/etc/tacos/env` and three systemd units. It changes nothing else on the machine. The first run creates the admin password in `/etc/tacos/env` and does not print it.

## Add a member

1. In the desktop app, have the member open **TaCos Server…** and click **Show my SSH key for the admin**.
2. On the server, add the line the member sends: `sudo /opt/tacos/deploy/add-member-key.sh "<line>"`.
3. Have the member enter `tacos@<server>` under **Team server over SSH** and connect.

The key can only forward to the TaCos port and the realtime document socket one port above it, which also listens on `127.0.0.1`. It opens no shell.

## Backup

`tacos-backup.timer` copies the database and uploads to `/var/lib/tacos/backups/<date>` once a day and keeps 14 days. The copies are on the same machine, so they do not protect against losing the server.

To restore, stop `tacos.service`, copy `tacos.db` and `uploads` from a backup into `/var/lib/tacos/data`, set the owner to `tacos`, and start the service.
