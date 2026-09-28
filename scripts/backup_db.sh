#!/bin/bash
# Database backup script for City Market App
# Run daily via cron

set -e

# Configuration
DB_HOST="${DATABASE_HOST:-127.0.0.1}"
DB_PORT="${DATABASE_PORT:-5432}"
DB_NAME="${DATABASE_NAME:-citymarket_db}"
DB_USER="${DATABASE_USER:-citymarket_user}"
DB_PASS="${DATABASE_PASSWORD}"
BACKUP_DIR="/var/www/citymarkets.sa/city-market-app/backups"
RETENTION_DAYS=7

# Create backup directory if not exists
mkdir -p "$BACKUP_DIR"

# Generate timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/${DB_NAME}_${TIMESTAMP}.sql.gz"

# Log start
echo "[$(date)] Starting database backup..."

# Run pg_dump
export PGPASSWORD="$DB_PASS"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
    --no-owner --no-acl --clean \
    | gzip > "$BACKUP_FILE"

# Check if backup succeeded
if [ -f "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ]; then
    # Get file size
    SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "[$(date)] Backup completed: $BACKUP_FILE (Size: $SIZE)"
    
    # Create symlink to latest backup
    ln -sf "$BACKUP_FILE" "$BACKUP_DIR/latest.sql.gz"
else
    echo "[$(date)] ERROR: Backup failed!"
    exit 1
fi

# Clean old backups (keep last 7 days)
find "$BACKUP_DIR" -name "${DB_NAME}_*.sql.gz" -mtime +$RETENTION_DAYS -delete
echo "[$(date)] Old backups cleaned (retention: $RETENTION_DAYS days)"

# Upload to remote storage if configured (optional)
if [ -n "$BACKUP_S3_BUCKET" ]; then
    echo "[$(date)] Uploading to S3..."
    aws s3 cp "$BACKUP_FILE" "s3://$BACKUP_S3_BUCKET/" --storage-class STANDARD_IA
    echo "[$(date)] S3 upload completed"
fi

echo "[$(date)] Backup process finished successfully"
