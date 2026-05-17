# Project Rules

## Feature notes

- AI / OCR receipt scanning — see [`docs/AI_FEATURE_NOTES.md`](docs/AI_FEATURE_NOTES.md) for design decisions, gotchas (RLS 42501 stale-JWT fix, mall-name prompt, etc.), and how to debug RLS errors on room-scoped tables.

## Versioning

- Any code changes → increment app version in `package.json` (`version`)
- DB schema changes (`src/db/schemas/*.schema.ts`) → also increment `version` in the affected schema (DB version is computed as max across all schemas in `src/db/version.ts`)

## Supabase Changes

All Supabase changes must be duplicated as local code for reproducibility:
- **Edge Functions** — keep in `supabase/functions/<name>/index.ts`
- **DB migrations** — keep in `supabase/migrations/<timestamp>_<name>.sql`
- **RLS policies, triggers, types, extensions** — include in migration files

### Supabase API keys (`.env`)

- Prefer **`SUPABASE_SECRET_KEY`** from `.env` when calling Supabase over HTTP (e.g. `curl` to Edge Functions with a service key, scripts that need elevated access). In the dashboard this may appear as the newer “secret” style key.
- **`SUPABASE_SERVICE_ROLE_KEY`** is **legacy** naming for the same role; keep supporting it in scripts via fallback only, but use `SUPABASE_SECRET_KEY` for new setup and docs.

## Data Protection

Every schema or data change must preserve existing user data:

### RxDB migration strategies
- Every schema `version` increment requires a corresponding `migrationStrategies[N]` entry in `src/db/database.ts`
- Strategies must handle undefined/null old fields safely
- Never remove or modify a strategy that has already been deployed

### Supabase migrations — additive only
- Allowed: `ADD COLUMN IF NOT EXISTS ... DEFAULT ...`, new tables, new indexes, new policies
- Forbidden: `DROP COLUMN`, `RENAME COLUMN`, `RENAME TABLE`, `DROP TABLE`
- Reason: client and server may temporarily be at different schema versions during updates
- The file `20260218120000_move_manufacturer_to_purchase.sql` is a documented exception (already deployed before this rule)

### Pre-migration backup
- A JSON backup is automatically downloaded whenever the DB version changes at startup (implemented in `src/db/database.ts`)
- Backup filename: `shop-assist-backup-v{version}-{date}.json`
- Users can also create a manual backup at any time from Settings → Резервные копии

### Backup format (`src/db/backup.ts`)
```
BackupFile {
  metadata: { version, appVersion, timestamp, collections, totalDocuments, attachmentSizeBytes }
  collections: { [collectionName]: document[] }
}
```

## Workflow

- Before committing, pushing, applying a database migration, deploying an edge function, or any other action with non-trivial side effects, **explain first what you found, why the action is needed, and what it will change** — then wait for the user to confirm. This applies especially to destructive steps (DELETE, DROP, removal of records, force operations). Do not chain "fix" actions silently.
- Do not leave untracked files in the repo without explaining what they are and whether they should be committed or removed.

## Code Style

- All comments and documentation must be in English
- **Never use `window.confirm` / `window.alert` / `window.prompt`** or any other native browser dialogs. Use the project's shared UI:
  - Yes/no confirmations → `useConfirm()` from `src/contexts/ConfirmDialogContext.tsx` (Promise-based, renders `ConfirmModal`).
  - One-line feedback → `useToast()` from `src/contexts/ToastContext.tsx`.
  - Text input or richer flows → build on top of `src/components/shared/ConfirmModal.tsx` / sibling modals; do not fall back to native dialogs.
