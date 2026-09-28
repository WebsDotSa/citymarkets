#!/bin/bash
# start.sh — entry for PM2 to launch city-market-app with .env.local loaded.
# Replaces the manual `setsid nohup npx next start -p 3006`.

set -e

cd /var/www/citymarkets.sa/city-market-app

# Load env from .env.local (export all)
if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

# Hardcoded port for city-market-app. PM2 (in ecosystem.config.cjs) does NOT
# pass PORT through reliably. If you change the port, update here AND in
# /usr/local/bin/citymarket-watch.sh AND the nginx upstream.
PORT="${CITYMARKET_PORT:-3006}"
exec ./node_modules/.bin/next start -p "$PORT"
