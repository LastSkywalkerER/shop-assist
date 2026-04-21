#!/usr/bin/env bash
#
# Deploy NBRB currency rates infrastructure to the remote Supabase project.
#
# Actions (in order):
#   1. Apply SQL migrations  — creates currency_rates_sync and pg_cron schedule.
#   2. Deploy edge function  — fetch-nbrb-rates (verify_jwt = true).
#   3. Backfill history      — invokes the function for the last N business
#                              days so the 7-day trend indicator has data.
#
# Requirements:
#   - supabase CLI installed and the project already linked
#     (`supabase link --project-ref lmdjawmxlxpecxrnkyis` once).
#   - SUPABASE_SERVICE_ROLE_KEY (legacy service_role JWT) for the backfill step only.
#     Loads from the environment; if a project `.env` exists, it is sourced first.
#     You may also set SUPABASE_SECRET_KEY in `.env` to the same JWT value when
#     the dashboard labels it that way — it must still be a JWT (eyJ...), not sb_secret_*.
#
# Usage:
#   scripts/deploy-currency-rates.sh                  # all three steps, backfill 10 weekdays
#   scripts/deploy-currency-rates.sh --skip-backfill  # migrations + function only
#   scripts/deploy-currency-rates.sh --only-backfill  # just fire off historical fetches
#   BACKFILL_DAYS=20 scripts/deploy-currency-rates.sh # custom backfill window

set -euo pipefail

PROJECT_REF="lmdjawmxlxpecxrnkyis"
PROJECT_URL="https://${PROJECT_REF}.supabase.co"
FUNCTION_NAME="fetch-nbrb-rates"
BACKFILL_DAYS="${BACKFILL_DAYS:-10}"

SKIP_BACKFILL=false
ONLY_BACKFILL=false
for arg in "$@"; do
  case "$arg" in
    --skip-backfill) SKIP_BACKFILL=true ;;
    --only-backfill) ONLY_BACKFILL=true ;;
    -h|--help)
      sed -n '3,25p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

log() { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-${SUPABASE_SECRET_KEY:-}}"

command -v supabase >/dev/null || fail "supabase CLI not found. Install: https://supabase.com/docs/guides/cli"

if ! $ONLY_BACKFILL; then
  log "Applying SQL migrations to project ${PROJECT_REF}"
  supabase db push

  log "Deploying edge function: ${FUNCTION_NAME}"
  supabase functions deploy "$FUNCTION_NAME"
fi

if $SKIP_BACKFILL; then
  log "Skipping backfill (flag --skip-backfill)."
  exit 0
fi

if [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  warn "SUPABASE_SERVICE_ROLE_KEY not set — cannot run backfill."
  warn "Put the legacy service_role JWT in .env or export it, then re-run with --only-backfill."
  exit 0
fi

log "Backfilling last ${BACKFILL_DAYS} weekdays via ${FUNCTION_NAME}"

i=0
filled=0
# Walk back from today, firing the function for each weekday (Mon–Fri).
# Weekend dates are skipped — NBRB doesn't publish rates for them.
while (( filled < BACKFILL_DAYS )); do
  date_str=$(date -u -d "-${i} day" +%Y-%m-%d 2>/dev/null || date -u -v-"${i}"d +%Y-%m-%d)
  dow=$(date -u -d "$date_str" +%u 2>/dev/null || date -u -j -f "%Y-%m-%d" "$date_str" +%u)
  i=$((i + 1))
  if (( i > 40 )); then
    warn "Walked back 40 days without finishing backfill — stopping."
    break
  fi
  if [[ "$dow" -gt 5 ]]; then
    continue
  fi

  printf '  %s ... ' "$date_str"
  response=$(curl -sS -X POST "${PROJECT_URL}/functions/v1/${FUNCTION_NAME}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"ondate\":\"${date_str}\"}" || true)
  printf '%s\n' "$response"
  filled=$((filled + 1))
done

log "Done."
