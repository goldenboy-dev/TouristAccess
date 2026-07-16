#!/bin/sh
set -e

echo "[entrypoint] Applying pending Prisma migrations..."
npx prisma migrate deploy

if [ "$RUN_SEED_ON_BOOT" = "true" ]; then
  echo "[entrypoint] RUN_SEED_ON_BOOT=true, running seed (idempotent)..."
  node prisma/seed.js
fi

echo "[entrypoint] Starting server..."
exec node src/index.js
