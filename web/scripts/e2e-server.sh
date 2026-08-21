#!/bin/sh
set -eu

DATABASE_URL="file:$(pwd)/data/goalset-e2e.db"
export DATABASE_URL AUTH_DISABLED=true AI_PROVIDER=local REMINDER_CHANNELS=qq NEXT_TELEMETRY_DISABLED=1

./node_modules/.bin/tsx scripts/e2e-prepare.mts
exec ./node_modules/.bin/next dev --hostname 127.0.0.1 --port 3100
