# Project Rules

## Versioning

- Any code changes → increment app version in `package.json` (`version`)
- DB schema changes (`src/db/schemas/*.schema.ts`) → also increment `version` in the affected schema (DB version is computed as max across all schemas in `src/db/version.ts`)

## Code Style

- All comments and documentation must be in English
