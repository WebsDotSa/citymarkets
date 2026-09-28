#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/apple-developer-merchantid-domain-association"
  echo "Download the file from Moyasar (Apple Pay domains) and pass its path."
  exit 1
fi

SRC="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST_DIR="$ROOT/public/.well-known"
DEST="$DEST_DIR/apple-developer-merchantid-domain-association"

if [[ ! -f "$SRC" ]]; then
  echo "Source file not found: $SRC"
  exit 1
fi

mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST"
chmod 644 "$DEST"

echo "Installed: $DEST"
echo "Verify: curl -s https://citymarkets.sa/.well-known/apple-developer-merchantid-domain-association | head -c 80"
