#!/bin/sh
# Nightly backup: copies the SQLite database safely while the server runs.
# Add to cron:  0 3 * * * /opt/manifest/deploy/backup.sh
set -e
mkdir -p /opt/manifest/backups
sqlite3 /opt/manifest/data/manifest.db ".backup /opt/manifest/backups/manifest-$(date +%F).db"
find /opt/manifest/backups -name 'manifest-*.db' -mtime +14 -delete
