#!/usr/bin/env bash
#
# reload — refresh the app after pulling changes or a schema change.
#
# Runs the full sequence that avoids the usual gotchas:
#   1. npm install            — pick up new/changed dependencies (e.g. recharts)
#   2. prisma db push         — apply schema columns AND regenerate the Prisma client
#                               (a stale client is what causes "Unknown argument costBasis")
#   3. rm -rf .next           — drop Turbopack's cache so it can't serve the old client
#   4. npm run dev            — start the dev server (unless --no-dev)
#
# Usage:
#   npm run reload            # install + db push + clear cache + start dev
#   npm run reload -- --seed  # also reseed demo data (DESTRUCTIVE: wipes current data)
#   npm run reload -- --no-dev
#
set -euo pipefail
cd "$(dirname "$0")/.."

SEED=0
RUN_DEV=1
for arg in "$@"; do
  case "$arg" in
    --seed) SEED=1 ;;
    --no-dev) RUN_DEV=0 ;;
    *) echo "reload: unknown option '$arg'" >&2; exit 2 ;;
  esac
done

echo "▸ Installing dependencies…"
npm install

echo "▸ Applying DB schema + regenerating Prisma client (db push)…"
npm run db:push

if [ "$SEED" -eq 1 ]; then
  echo "▸ Reseeding demo data (this wipes current data)…"
  npm run db:seed
fi

echo "▸ Clearing Next.js build cache (.next)…"
rm -rf .next

if [ "$RUN_DEV" -eq 1 ]; then
  echo "▸ Starting dev server…"
  exec npm run dev
fi

echo "✓ Reloaded. Run 'npm run dev' when ready."
