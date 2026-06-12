#!/bin/sh
# Nightly encrypted backup: pg_dump -> age -> rclone -> rotate
# Source this env file for secrets (no plaintext keys on disk):
#   AGE_RECIPIENT=age1...
#   RCLONE_REMOTE=b2         (rclone remote name configured via `rclone config`)
#
# Install on VPS: copy to /opt/statok/backup.sh, chmod +x
# Host cron [manual-owner]: 30 3 * * * /opt/statok/backup.sh >> /var/log/statok-backup.log 2>&1
set -eu

. /opt/statok/backup.env

STAMP=$(date +%Y%m%d-%H%M)
DIR=/opt/statok/backups
mkdir -p "$DIR"

# 1) dump from postgres container (custom format: compact, restores via pg_restore)
docker exec statok-postgres-1 pg_dump -U statok -Fc statok > "$DIR/statok-$STAMP.dump"

# 2) encrypt with age public key (private key never on VPS)
age -r "$AGE_RECIPIENT" -o "$DIR/statok-$STAMP.dump.age" "$DIR/statok-$STAMP.dump"
rm "$DIR/statok-$STAMP.dump"

# 3) upload to remote storage (Backblaze B2 / S3)
rclone copy "$DIR/statok-$STAMP.dump.age" "$RCLONE_REMOTE:statok-backups/"

# 4) rotation: keep 14 newest locally, delete remote files older than 30 days
ls -1t "$DIR"/statok-*.dump.age | tail -n +15 | xargs -r rm
rclone delete --min-age 30d "$RCLONE_REMOTE:statok-backups/"
