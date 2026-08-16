#!/usr/bin/env bash
#
# Apply ONE migration file from this checkout to the remote Supabase project.
#
# For the normal flow prefer the CLI (`supabase db push`) — it applies every
# pending migration and records them in the migration history. This script is
# for the one-off case: a single file straight from a feature branch, with no
# linking step and no other pending migration coming along for the ride.
#
# Credentials (either one, checked in this order; `.env` is sourced first):
#   SUPABASE_ACCESS_TOKEN  personal access token (sbp_...), from
#                          https://supabase.com/dashboard/account/tokens
#                          → runs the SQL through the Management API.
#   SUPABASE_DB_URL        direct Postgres connection string
#                          (Dashboard → Project Settings → Database → URI)
#                          → runs the SQL through psql.
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=sbp_... scripts/apply-migration.sh supabase/migrations/<file>.sql
#   SUPABASE_DB_URL='postgresql://...' scripts/apply-migration.sh supabase/migrations/<file>.sql
#
# Override the target project with PROJECT_REF=<ref> when needed.

set -euo pipefail

PROJECT_REF="${PROJECT_REF:-lmdjawmxlxpecxrnkyis}"

log() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."

MIGRATION="${1:-}"
[[ -n "$MIGRATION" ]] || fail "Usage: scripts/apply-migration.sh <path/to/migration.sql>"
[[ -f "$MIGRATION" ]] || fail "Migration file not found: $MIGRATION"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

log "Applying $MIGRATION to project $PROJECT_REF"
echo "--- SQL ---"
cat "$MIGRATION"
echo "-----------"

if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  command -v curl >/dev/null || fail "curl not found"
  command -v node >/dev/null || fail "node not found (used to JSON-encode the SQL)"

  BODY="$(node -e 'process.stdout.write(JSON.stringify({query: require("fs").readFileSync(process.argv[1], "utf8")}))' "$MIGRATION")"

  RESPONSE="$(curl -sS -w $'\n%{http_code}' -X POST \
    "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$BODY")"

  STATUS="$(tail -n1 <<<"$RESPONSE")"
  echo "$RESPONSE" | sed '$d'
  [[ "$STATUS" == 2* ]] || fail "Management API returned HTTP $STATUS"
elif [[ -n "${SUPABASE_DB_URL:-}" ]]; then
  command -v psql >/dev/null || fail "psql not found. Install postgresql-client or use SUPABASE_ACCESS_TOKEN instead."
  psql "$SUPABASE_DB_URL" --single-transaction -v ON_ERROR_STOP=1 -f "$MIGRATION"
else
  fail "Set SUPABASE_ACCESS_TOKEN (sbp_...) or SUPABASE_DB_URL. See the header of this script."
fi

log "Done. Migrations in this repo are additive and idempotent — re-running is safe."
