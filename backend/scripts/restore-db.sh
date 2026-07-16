#!/bin/sh
# Restores a .sql.gz dump produced by backup-db.sh into DATABASE_URL.
# DESTRUCTIVE: this overwrites existing data. Confirms before running.
#
# Usage: DATABASE_URL=postgresql://... ./scripts/restore-db.sh backups/tourist_access_20260101_030000.sql.gz
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$SCRIPT_DIR")"

DUMP_FILE="${1:-}"
if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "Usage: $0 <path-to-dump.sql.gz>" >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ] && [ -f "$BACKEND_DIR/.env" ]; then
  DATABASE_URL=$(grep -E '^DATABASE_URL=' "$BACKEND_DIR/.env" | tail -n1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[restore] FATAL: DATABASE_URL not set and not found in backend/.env" >&2
  exit 1
fi

# Prisma's "?schema=" query param isn't a libpq URI parameter — psql rejects
# it outright, so strip it before use.
DATABASE_URL=$(echo "$DATABASE_URL" | sed -E 's/[?&]schema=[^&]*//')

echo "[restore] About to overwrite the database at:"
echo "  $DATABASE_URL"
echo "[restore] with dump: $DUMP_FILE"
printf "[restore] Type 'yes' to continue: "
read -r CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "[restore] Aborted."
  exit 1
fi

gunzip -c "$DUMP_FILE" | psql "$DATABASE_URL"
echo "[restore] Done."
