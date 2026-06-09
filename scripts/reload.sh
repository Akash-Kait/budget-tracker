#!/usr/bin/env bash
#
# reload — refresh the app after pulling changes or a schema change.
#
# Runs the full sequence that avoids the usual gotchas:
#   1. npm install            — pick up new/changed dependencies (e.g. recharts)
#   2. prisma db push         — apply schema columns AND regenerate the Prisma client
#                               (a stale client is what causes "Unknown argument costBasis")
#   3. CAS sidecar venv       — provision Python + casparser for CAS PDF import (optional;
#                               skipped gracefully if python3 is absent — CAS import just 501s)
#   4. rm -rf .next           — drop Turbopack's cache so it can't serve the old client
#   5. npm run dev            — start the dev server (unless --no-dev)
#
# Usage:
#   npm run reload            # install + db push + cas sidecar + clear cache + start dev
#   npm run reload -- --seed  # also reseed demo data (DESTRUCTIVE: wipes current data)
#   npm run reload -- --no-dev
#   npm run reload -- --no-cas  # skip the CAS Python-sidecar provisioning
#
set -euo pipefail
cd "$(dirname "$0")/.."

SEED=0
RUN_DEV=1
RUN_CAS=1
for arg in "$@"; do
  case "$arg" in
    --seed) SEED=1 ;;
    --no-dev) RUN_DEV=0 ;;
    --no-cas) RUN_CAS=0 ;;
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

if [ "$RUN_CAS" -eq 1 ]; then
  # Optional CAS-import sidecar: a Python venv with casparser (MIT parser only). Non-fatal — if
  # python3 is missing or the install fails, CAS import simply returns 501 and the rest works.
  # The venv lives at scripts/.venv (gitignored; per-OS, never committed). Idempotent.
  echo "▸ Provisioning CAS-import sidecar (casparser, optional)…"
  if command -v python3 >/dev/null 2>&1; then
    [ -x scripts/.venv/bin/python ] || python3 -m venv scripts/.venv || true
    if [ -x scripts/.venv/bin/python ] && scripts/.venv/bin/pip install --quiet -r scripts/requirements.txt; then
      echo "  ✓ casparser ready for CAS PDF import."
    else
      echo "  ⚠ couldn't install casparser — CAS import will return 501 until set up (see docs/ARCHITECTURE.md)."
    fi
  else
    echo "  ⚠ python3 not found — CAS import disabled until Python 3 + casparser are installed."
  fi
fi

echo "▸ Clearing Next.js build cache (.next)…"
rm -rf .next

if [ "$RUN_DEV" -eq 1 ]; then
  echo "▸ Starting dev server…"
  exec npm run dev
fi

echo "✓ Reloaded. Run 'npm run dev' when ready."
