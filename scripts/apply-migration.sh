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
# SUPABASE_SECRET_KEY (the service_role key) does NOT work here: it is a
# PostgREST credential, and PostgREST only reads and writes rows — there is no
# endpoint that executes DDL. No amount of scripting turns it into one.
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=sbp_... scripts/apply-migration.sh supabase/migrations/<file>.sql
#   SUPABASE_DB_URL='postgresql://...' scripts/apply-migration.sh supabase/migrations/<file>.sql
#
# No credential at hand? `--print` dumps the SQL for the dashboard SQL editor.
#
# Override the target project with PROJECT_REF=<ref> when needed.

set -euo pipefail

PROJECT_REF="${PROJECT_REF:-lmdjawmxlxpecxrnkyis}"

log() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."

PRINT_ONLY=false
MIGRATION=""
for arg in "$@"; do
  case "$arg" in
    --print) PRINT_ONLY=true ;;
    -h|--help) sed -n '3,32p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) MIGRATION="$arg" ;;
  esac
done

[[ -n "$MIGRATION" ]] || fail "Usage: scripts/apply-migration.sh <path/to/migration.sql>"
[[ -f "$MIGRATION" ]] || fail "Migration file not found: $MIGRATION"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

if $PRINT_ONLY; then
  cat "$MIGRATION"
  printf '\n\033[1;36m==>\033[0m Paste the SQL above into %s and press Run.\n' \
    "https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new" >&2
  exit 0
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
  printf '\033[1;31m[error]\033[0m No usable credential found. Pick one:\n' >&2
  if [[ -n "${SUPABASE_SECRET_KEY:-}" || -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
    printf '\n  (SUPABASE_SECRET_KEY is set, but it cannot apply migrations — it is a\n' >&2
    printf '   PostgREST key for reading/writing rows, and DDL has no endpoint there.)\n' >&2
  fi
  cat >&2 <<EOF

  1. SUPABASE_ACCESS_TOKEN — https://supabase.com/dashboard/account/tokens
     "Generate new token", copy the sbp_... value (shown once), then:
       SUPABASE_ACCESS_TOKEN=sbp_... $0 $MIGRATION

  2. SUPABASE_DB_URL — Dashboard → Project Settings → Database →
     Connection string → URI, with [YOUR-PASSWORD] replaced, then:
       SUPABASE_DB_URL='postgresql://...' $0 $MIGRATION

  3. No credential at all — open
     https://supabase.com/dashboard/project/${PROJECT_REF}/sql/new
     and paste the SQL:
       $0 --print $MIGRATION

  Either value can also live in .env instead of the command line (see .env.example).
EOF
  exit 1
fi

log "Done. Migrations in this repo are additive and idempotent — re-running is safe."
