# Database Backup & Restore Procedures

This document describes how to backup and restore the Sudoku Arena PostgreSQL database.

## Backup

### Full Database Backup

```bash
# Using pg_dump with custom format (compressed, parallel)
pg_dump -h localhost -U postgres -d sudoku_arena -F c -b -v -f backup_$(date +%Y%m%d_%H%M%S).dump

# Or using plain SQL format (human-readable, larger file)
pg_dump -h localhost -U postgres -d sudoku_arena -f backup_$(date +%Y%m%d_%H%M%S).sql
```

### Environment Variables

Set these before running backup/restore commands:

```bash
export PGHOST=localhost
export PGUSER=postgres
export PGPASSWORD=your_password
export PGDATABASE=sudoku_arena
```

Then backup simplifies to:

```bash
pg_dump -F c -b -v -f backup_$(date +%Y%m%d_%H%M%S).dump
```

## Restore

### From Custom Format Backup

```bash
# Drop and recreate database (WARNING: destroys existing data)
dropdb sudoku_arena
createdb sudoku_arena

# Restore
pg_restore -h localhost -U postgres -d sudoku_arena -v backup_FILE.dump
```

### From SQL Format Backup

```bash
# Drop and recreate database
dropdb sudoku_arena
createdb sudoku_arena

# Restore
psql -h localhost -U postgres -d sudoku_arena < backup_FILE.sql
```

### Restore with Prisma Migrations

After restoring, run migrations to ensure schema is current:

```bash
cd server
npm run migrate:up
```

## Remote Database (Production)

For production databases on cloud providers (AWS RDS, Azure, etc.):

```bash
# Use the DATABASE_URL from environment
pg_dump "$DATABASE_URL" -F c -b -v -f prod_backup_$(date +%Y%m%d_%H%M%S).dump

# Restore to local for testing
pg_restore -d sudoku_arena_local -v prod_backup_FILE.dump
```

## Automated Backup Script

Create `server/scripts/backup.sh`:

```bash
#!/bin/bash
# Automated backup script for Sudoku Arena

set -e

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/sudoku_arena_$TIMESTAMP.dump"

mkdir -p "$BACKUP_DIR"

echo "Starting backup to $BACKUP_FILE..."
pg_dump -F c -b -v -f "$BACKUP_FILE"

# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "sudoku_arena_*.dump" -type f -mtime +7 -delete

echo "Backup complete: $BACKUP_FILE"
ls -lh "$BACKUP_FILE"
```

Make executable:

```bash
chmod +x server/scripts/backup.sh
```

### Schedule with Cron (Linux/Mac)

Add to crontab for daily backups at 2 AM:

```bash
crontab -e
# Add this line:
0 2 * * * /path/to/server/scripts/backup.sh >> /var/log/sudoku_backup.log 2>&1
```

## Data Verification

After restore, verify data integrity:

```bash
# Check user count
psql -d sudoku_arena -c "SELECT COUNT(*) FROM users;"

# Check competition count
psql -d sudoku_arena -c "SELECT COUNT(*) FROM competitions;"

# Check for orphaned records
psql -d sudoku_arena -c "
  SELECT 'orphaned_rounds' as issue, COUNT(*) 
  FROM rounds r 
  LEFT JOIN competitions c ON r.competition_id = c.id 
  WHERE c.id IS NULL;
"
```

## Emergency Recovery

If the server crashes and you need to recover quickly:

1. **Stop the server**
   ```bash
   pm2 stop sudoku-arena
   # or
   systemctl stop sudoku-arena
   ```

2. **Restore from latest backup**
   ```bash
   pg_restore -d sudoku_arena -v latest_backup.dump
   ```

3. **Run migrations**
   ```bash
   cd server
   npm run migrate:up
   ```

4. **Restart server**
   ```bash
   pm2 start sudoku-arena
   # or
   systemctl start sudoku-arena
   ```

5. **Check logs**
   ```bash
   pm2 logs sudoku-arena
   # or
   journalctl -u sudoku-arena -f
   ```

## Backup Storage Recommendations

- **Development**: Local disk is fine
- **Production**: Use cloud storage (S3, Azure Blob, GCS)
- **Retention**: Keep 7 daily + 4 weekly + 12 monthly backups
- **Encryption**: Encrypt backups at rest for production
- **Testing**: Test restore procedure quarterly

## Troubleshooting

### "permission denied" errors

Ensure PostgreSQL user has sufficient privileges:

```sql
GRANT ALL PRIVILEGES ON DATABASE sudoku_arena TO postgres;
```

### "connection refused" errors

Check PostgreSQL is running and accepting connections:

```bash
sudo systemctl status postgresql
sudo systemctl start postgresql
```

### Large backup files

Use custom format with compression:

```bash
pg_dump -F c -Z 9 -f backup.dump  # Maximum compression
```

### Parallel backup (faster for large databases)

```bash
pg_dump -F d -j 4 -f backup_dir/  # 4 parallel jobs
```
