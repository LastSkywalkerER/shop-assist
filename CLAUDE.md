# Project Rules

## Versioning

- Any code changes → increment app version in `package.json` (`version`)
- DB schema changes (`src/db/schemas/*.schema.ts`) → also increment `version` in the affected schema (DB version is computed as max across all schemas in `src/db/version.ts`)

## Supabase Changes

All Supabase changes must be duplicated as local code for reproducibility:
- **Edge Functions** — keep in `supabase/functions/<name>/index.ts`
- **DB migrations** — keep in `supabase/migrations/<timestamp>_<name>.sql`
- **RLS policies, triggers, types, extensions** — include in migration files

## Code Style

- All comments and documentation must be in English
