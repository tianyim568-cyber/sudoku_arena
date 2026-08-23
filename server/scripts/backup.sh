#!/bin/bash
# Automated backup script for Sudoku Arena PostgreSQL database
#
# Usage: ./backup.sh
#
# Environment variables:
#   BACKUP_DIR - Directory to store backups (default: ./backups)
#   PGHOST, PGUSER, PGPASSWORD, PGDATABASE - PostgreSQL connection
#
# Scheduling:
#   Add to crontab for daily backups at 2 AM:
#   0 2 * * * /path/to/backup.sh >> /var/log/sudoku_backup.log 2>&1

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/sudoku_arena_$TIMESTAMP.dump"

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

echo "[$(date)] Starting backup to $BACKUP_FILE..."

# Use custom format (-F c) with blobs (-b) and verbose (-v)
# Custom format is compressed and supports parallel restore
pg_dump -F c -b -v -f "$BACKUP_FILE"

# Verify backup file was created and has content
if [ ! -s "$BACKUP_FILE" ]; then
  echo "[$(date)] ERROR: Backup file is empty or was not created" >&2
  exit 1
fi

# Get file size in human-readable format
FILE_SIZE=$(ls -lh "$BACKUP_FILE" | awk '{print $5}')

echo "[$(date)] Backup complete: $BACKUP_FILE ($FILE_SIZE)"

# Retention: keep only last 7 days of backups
DELETED_COUNT=$(find "$BACKUP_DIR" -name "sudoku_arena_*.dump" -type f -mtime +7 | wc -l)
if [ "$DELETED_COUNT" -gt 0 ]; then
  echo "[$(date)] Cleaning up $DELETED_COUNT old backup(s)..."
  find "$BACKUP_DIR" -name "sudoku_arena_*.dump" -type f -mtime +7 -delete
fi

echo "[$(date)] Backup process finished successfully"
