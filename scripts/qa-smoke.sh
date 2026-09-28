#!/bin/bash
# Wrapper for qa-smoke.mjs that sets BASE_URL to the city-market port.
# Runs via cron every 5 min (see crontab -l).

set -e

APP="/var/www/citymarkets.sa/city-market-app"
LOG="$APP/logs/qa-smoke.log"
MAX_SIZE=1048576  # 1MB

# Load .env.local so DATABASE_URL is available
if [[ -f "$APP/.env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$APP/.env.local"
  set +a
fi

export BASE_URL="http://127.0.0.1:3005"

# Rotate log if too big
if [[ -f "$LOG" ]] && [[ $(stat -c%s "$LOG") -gt $MAX_SIZE ]]; then
  mv "$LOG" "$LOG.1"
  : > "$LOG"
fi

cd "$APP"
node scripts/qa-smoke.mjs >> "$LOG" 2>&1
EXIT=$?

if [[ $EXIT -ne 0 ]]; then
  echo "$(date -Is) qa-smoke FAIL exit=$EXIT" >> "$LOG"
  # Touch alert file (the watch script handles it)
  touch /tmp/citymarket-qa-fail
fi

exit $EXIT
