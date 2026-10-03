#!/usr/bin/env bash
# install.sh — drop the citymarket-db backup infrastructure onto a host.
#
# Run as root:
#
#   sudo ./install.sh
#
# What it does:
#   1. Copies citymarket-db-backup and citymarket-db-restore-test to
#      /usr/local/bin/ (chmod 700, owned by root).
#   2. Copies citymarket-db-backup.cron to /etc/cron.d/ (chmod 600).
#   3. Creates /var/backups/citymarket_db/ (chmod 700) — backup dir.
#   4. Touches the two log files in /var/log/ (chmod 644).
#   5. Runs a one-off backup + restore-test to prove the install.
#
# Idempotent: every step is safe to re-run.
set -euo pipefail

cd "$(dirname "$0")"

if [[ $EUID -ne 0 ]]; then
  echo "must run as root (sudo $0)" >&2
  exit 1
fi

install -m 700 -o root -g root citymarket-db-backup       /usr/local/bin/citymarket-db-backup
install -m 700 -o root -g root citymarket-db-restore-test /usr/local/bin/citymarket-db-restore-test
install -m 600 -o root -g root citymarket-db-backup.cron  /etc/cron.d/citymarket-db-backup

install -d -m 700 -o root -g root /var/backups/citymarket_db
touch /var/log/citymarket-db-backup.log
touch /var/log/citymarket-db-restore-test.log
chmod 644 /var/log/citymarket-db-backup.log /var/log/citymarket-db-restore-test.log

echo "==> install: scripts in /usr/local/bin/, cron in /etc/cron.d/citymarket-db-backup"
echo "==> schedule:"
echo "    daily    02:00 UTC  pg_dump       (/usr/local/bin/citymarket-db-backup)"
echo "    weekly   sun 03:30  restore-test  (/usr/local/bin/citymarket-db-restore-test)"
echo
echo "==> one-off backup + restore-test to verify install"
/usr/local/bin/citymarket-db-backup
/usr/local/bin/citymarket-db-restore-test
