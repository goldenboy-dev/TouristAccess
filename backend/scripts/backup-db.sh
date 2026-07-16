#!/bin/sh
# Dumps the Postgres database pointed to by DATABASE_URL, compressed and
# timestamped, then prunes backups older than BACKUP_RETENTION_DAYS.
#
# Usage:
#   DATABASE_URL=postgresql://... ./scripts/backup-db.sh
#   (or just run it where backend/.env already sets DATABASE_URL)
#
# Scheduling:
#   - Linux/Mac cron (daily at 3am), from the backend/ directory:
#       0 3 * * * cd /path/to/backend && ./scripts/backup-db.sh >> /var/log/tourist-access-backup.log 2>&1
#   - Windows: Task Scheduler running
#       "C:\Program Files\Git\bin\bash.exe" -lc "cd /path/to/backend && ./scripts/backup-db.sh"
#   - Dockerized deploy: run it via `docker compose exec backend ./scripts/backup-db.sh`
#     from the host's cron instead (the backend container has no cron daemon).
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

# Pick up DATABASE_URL from backend/.env if it isn't already in the environment.
if [ -z "${DATABASE_URL:-}" ] && [ -f "$BACKEND_DIR/.env" ]; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' "$BACKEND_DIR/.env" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[backup] FATAL: DATABASE_URL not set and not found in backend/.env" >&2
  exit 1
fi

# Prisma's "?schema=" query param isn't a libpq URI parameter — pg_dump
# rejects it outright, so strip it before use.
DATABASE_URL=$(echo "$DATABASE_URL" | sed -E 's/[?&]schema=[^&]*//')

BACKUP_DIR="${BACKUP_DIR:-$BACKEND_DIR/../backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUT_FILE="$BACKUP_DIR/tourist_access_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "[backup] Dumping database to $OUT_FILE ..."
pg_dump "$DATABASE_URL" | gzip > "$OUT_FILE"
echo "[backup] Done ($(du -h "$OUT_FILE" | cut -f1))."

echo "[backup] Pruning backups older than ${BACKUP_RETENTION_DAYS} days..."
find "$BACKUP_DIR" -name 'tourist_access_*.sql.gz' -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete

echo "[backup] Current backups:"
ls -lh "$BACKUP_DIR"/tourist_access_*.sql.gz 2>/dev/null || echo "  (none)"
