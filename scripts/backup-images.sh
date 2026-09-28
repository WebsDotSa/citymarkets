#!/bin/bash
# backup-images.sh — move user-uploaded product images to /var/lib/citymarket-images/
# and symlink public/images -> that location. This keeps the repo clean and
# protects the images from being wiped during `git clean` or a redeploy.
#
# Run once on the host as root. After this, public/images is a symlink to
# /var/lib/citymarket-images, which is backed up nightly by the portfolio
# backup cron (see /root/Obsidian/labs-memory/60-tools/).
set -euo pipefail

APP="/var/www/citymarkets.sa/city-market-app"
SRC="$APP/public/images"
DST="/var/lib/citymarket-images"

if [[ -L "$SRC" ]]; then
  echo "Already a symlink, skipping."
  ls -la "$SRC"
  exit 0
fi

if [[ ! -d "$SRC" ]]; then
  echo "No $SRC directory, nothing to migrate."
  exit 0
fi

echo "Creating $DST..."
mkdir -p "$DST"

echo "Moving files (preserving attributes)..."
rsync -a "$SRC/" "$DST/"

# Verify size matches
SRC_SIZE=$(du -sb "$SRC" | awk '{print $1}')
DST_SIZE=$(du -sb "$DST" | awk '{print $1}')
if [[ "$SRC_SIZE" != "$DST_SIZE" ]]; then
  echo "FATAL size mismatch src=$SRC_SIZE dst=$DST_SIZE"
  exit 1
fi

echo "Replacing $SRC with symlink to $DST..."
rm -rf "$SRC"
ln -s "$DST" "$SRC"

# Verify app still serves an image
TEST_IMG=$(find "$DST" -name '*.jpg' | head -1)
if [[ -n "$TEST_IMG" ]]; then
  REL=${TEST_IMG#$DST/}
  echo "Test image: /$REL"
  ls -la "$SRC/$REL"
fi

echo "Done. Public images now at $DST"
du -sh "$DST"
