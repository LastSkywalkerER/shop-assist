# AI feature — decisions and gotchas

Reference notes for the receipt-scanning / OpenRouter feature. Read before
touching any of: `supabase/functions/ocr-receipt`, `room_ai_settings`,
`ai_usage_log`, `src/lib/ai/**`, `src/contexts/AiSettingsContext`.

## What ships

- Camera FAB on Expenses page (visible only when `room_ai_settings.ai_enabled`).
- Snap → resize to ≤2048px JPEG q=0.85 → 3-pass pipeline:
  - **Pass 1 extract** (vision): default `google/gemini-2.5-flash`.
  - **Pass 2 validate** (text-only): default `openai/gpt-5-mini`.
  - **Pass 3 escalate** (vision, only when validate flags it): default
    `google/gemini-2.5-flash` (cheap, same model family as extract; can
    be swapped for Pro in Settings if you want the heavyweight tier).
- OpenRouter is called server-side from `supabase/functions/ocr-receipt`
  so the API key stays in `OPENROUTER_API_KEY` env var.
- Rate limit per user: 20/min, 200/day, enforced via row count in
  `ai_usage_log`.
- Parsed receipt is consumed in-flight; raw OCR JSON is NOT persisted (no
  schema bump).
- Matching is driven by the validate-pass model with a **grouped**
  catalog. Two flat lists for fields the model must return verbatim,
  two grouped indexes that give the model context to actually match
  against the user's history:
  - `categoryNames[]` — flat (for `expenseCategoryName` field)
  - `storeNames[]` — flat (for `storeName` field)
  - `expenseLabels[]` — each entry `{ name, categories[], stores[],
    items[] }`. The model walks this index to find the historical
    label that fits the receipt, using the nested lists as
    confirmation signals (categories > items > stores).
  - `products[]` — each entry `{ name, categories[], stores[] }`. Same
    pattern for per-item matching: scan product names, confirm via
    nested categories/stores. `items` inside `expenseLabels[]` are
    populated through `receipt → receiptItem.convertedToPurchaseId →
    purchase.productId → product.name` so they're clean canonical
    names, not raw OCR strings. `categories` inside `products[]` are
    expense categories of expenses whose receipts contained that
    product (same chain in reverse).
- For each receipt item the model returns:
  - `cleanedName` — short readable name, ALWAYS provided. Either a
    verbatim entry from `productNames` or a generalized fallback like
    "Футболка женская" (with codes/sizes stripped).
  - `productName` — only when `cleanedName` is verbatim from the
    catalog and the model is sure it's the same product.
  - `variety` — codes / sizes / article numbers stripped from the raw
    name, parked into the item's variety field on save.
  - `confidence` — for the productName binding only.
- For the expense as a whole the model returns:
  - `expenseLabel` — picked from `expenseLabels` if a clear fit
    exists, otherwise a short generated label.
  - `expenseCategoryName` — verbatim entry from `categoryNames` or
    null.
- `ScanReceiptFlow` resolves names to ids by exact (lowercased)
  lookup against the same lists it sent. Label/category are trusted
  unconditionally (they're just pre-fills the user can edit), product
  binding to an existing purchase still requires `confidence ≥ 0.8`.
- Duplicate detection is fully local: `matchExpenseForReceipt`
  compares store + date (±1 day) + total (±1%).
- Local fallbacks when the model returns nothing:
  - `matchPurchaseForItem` (token-Jaccard + same-store bonus)
  - `suggestExpenseLabel` (product→category + historical receipt-item
    →expense voting, history weighted ×1.5)

## Per-room settings storage

- Table `room_ai_settings (room_id PK, ai_enabled, model_extract,
  model_validate, model_escalate, updated_at)`.
- Per-room means all members of a room share the AI tier choice and a
  single OpenRouter bill.

## RLS pattern — DO NOT copy the user_metadata pattern for new tables

The rest of the project guards room-scoped tables with
`(auth.jwt() -> 'user_metadata') ->> 'room_id'`. That has two problems:

1. **Stale JWTs.** A client carrying a session minted before
   `user_metadata.room_id` was populated gets RLS 42501 errors on insert
   even though their DB row exists and the policy text is correct. This
   bit `room_ai_settings` on first roll-out — symptom was
   `new row violates row-level security policy for table "room_ai_settings"`.
2. **`user_metadata` is editable by the client.** Supabase's own linter
   flags this (`rls_references_user_metadata` ERROR). It is OK only
   because the rest of the project already depends on it; do not
   propagate to new tables.

The fix used here, and the recommended pattern going forward, is the
SECURITY DEFINER function `public.is_room_member(p_room_id uuid)` that
joins `auth.uid()` → `users.auth_user_id` → `room_memberships`. It is
robust to stale JWTs (sub claim never goes stale) and reads no
user-writable metadata.

Use it like:

```sql
CREATE POLICY my_table_select ON my_table FOR SELECT TO authenticated
  USING (public.is_room_member(room_id));
```

## Resolved issues, by symptom

| Symptom | Root cause | Fix |
|---|---|---|
| `new row violates row-level security policy for table "room_ai_settings"` on first toggle | Initial policy read `auth.jwt() ->> 'room_id'` (top-level), but in this project room_id lives under `user_metadata` | Commit `e26987b` — moved to `(auth.jwt() -> 'user_metadata') ->> 'room_id'` |
| Same RLS error after the metadata fix | JWT issued before `user_metadata.room_id` was populated (stale session); also `user_metadata` is user-editable, flagged by Supabase linter | Replaced with `is_room_member()` SECURITY DEFINER via `room_memberships` and `auth.uid()` |
| Mall name (ТРЦ Палаццо) missing from `store.address` | Extract prompt didn't tell the model to glue mall name in front of the street address | Updated `EXTRACT_PROMPT` in `ocr-receipt/index.ts` and re-deployed |
| AddExpense form had empty Name / Category after a successful scan | OCR flow only filled store, date, total, items — not the expense label | Added `suggestExpenseLabel()` in `src/lib/ai/matching.ts`, threaded through `ScanReceiptFlow` and `AddExpense` |
| TS error `erasableSyntaxOnly` rejected `constructor(... public readonly code?: string)` | Project's tsconfig uses `erasableSyntaxOnly` which forbids parameter properties | Rewrote `OcrError` with explicit field declaration |
| Item / category / expense matching relied on local Jaccard only; weak matches and no global view | Validate pass got only the receipt; the model couldn't actually compare against the user's history | Validate now receives a compact `catalog` (products / categories / stores / recent expenses) and returns `matches` block with confidence per item, expense label, and duplicate-expense check. Client picks model verdict if confidence ≥ 0.8, falls back to local Jaccard otherwise. |
| Camera FAB overlapped the bottom quick-add input | FAB was at `bottom-[88px]` which sits inside the quick-add bar's vertical band | Raised to `bottom-[160px]` |
| Scan card spins on "Распознаём чек…" forever | The kickoff POST to `start-receipt-scan` failed (offline / `TypeError: Failed to fetch`) so the row stayed `pending`; the orphan/retry UI only covered long-stuck `processing` rows, never `pending` ones | `PendingScanRow` now treats `pending` rows older than `PENDING_STUCK_MS` (60s) as stuck and shows retry/delete, plus a 15s tick so the UI appears without a Realtime event; `start-receipt-scan` force-claim now also matches `pending` so a retry flips it to `processing` |
| Saving an OCR-prefilled expense throws RxDB `CONFLICT` (409) | First save succeeded locally but `promotePendingScan`'s remote row delete failed (offline), so the "готово" card lingered; re-opening + re-saving re-inserted the same stable `receiptItem` / attachment ids → CONFLICT (and a duplicate empty expense) | Added a local consumed-scans registry (`src/lib/ai/consumedScans.ts`): the card is hidden the instant the local save succeeds (even offline), `usePendingScans` filters it out, retries the deferred delete on each refetch, and prunes ids once the server row is gone |
| `new row violates row-level security policy` on receipt scan upload (`Не удалось загрузить чек`) | The four `sync-attachments` Storage policies were the last in the feature still gating on `user_metadata.room_id`. When the active room drifted from the JWT room (a room switch that didn't refresh the token; the AuthContext session-restore fast-path trusts localStorage and skips `completeAccount()`'s JWT reconcile), the path-prefix check failed even for a real member | (A) Migration `20260603120000_harden_attachments_storage_rls.sql` switches all four policies to `is_room_member((foldername)[1]::uuid)`, matching `pending_receipt_scans` and the `*_sync` tables. (B) `reconcileJwtRoom()` in `auth.ts`, called from the AuthContext restore path, heals a drifted JWT `room_id` in the background so Storage RLS + replication push target the active room |
| Validate pass returned HTTP 400 `Invalid schema for response_format 'receipt': In context=(..., 'required' is required to be supplied and to be an array including every key in properties` | OpenAI strict json_schema mode (GPT-5 mini, 4.1) requires every property under `properties` to appear in `required` for ANY object subschema, including the object variant of a nullable union. Gemini was permissive so extract didn't catch this, but GPT-5 strict on validate rejected the request. | All object subschemas in `RECEIPT_JSON_SCHEMA` now list every key in `required`; optional fields use `type: ['T', 'null']` and the extract prompt tells the model to write `null` rather than omit. |

## How to fix RLS 42501 on similar features in the future

1. Confirm RLS is actually on and the policy text is correct
   (`SELECT polname, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid) FROM pg_policy WHERE polrelid = '<schema.table>'::regclass;`).
2. Confirm the data the policy reads actually exists for that user
   (e.g. `auth.users.raw_user_meta_data->>'room_id'`).
3. If both look right, suspect a stale JWT. The user's currently active
   session may have been minted before the metadata was populated. Two
   options:
   - Have the user re-login or call `supabase.auth.refreshSession()`.
   - **Better**: re-write the policy to not depend on user_metadata at
     all. Use `auth.uid()` plus a SECURITY DEFINER lookup function
     (`is_room_member` is already there for room-scoped checks).

## Deployment checklist

- `OPENROUTER_API_KEY` in Supabase Edge Functions secrets.
- Apply pending migrations.
- Deploy `ocr-receipt` (any change to the prompt = re-deploy needed).
- Bump `package.json` version per project rule.

## Debugging — Edge Function logs

The deployed `ocr-receipt` function emits a structured log line at every
step. Each line is prefixed with `[ocr-receipt:<reqId>:<step>:+<ms>]`
where `<reqId>` is an 8-char id unique per request, so a single OCR
scan can be grepped out of the log stream end-to-end.

Steps you can expect, in order:

```
request:start                  — method + url
env:check                      — flags for the three required env vars
auth:ok                        — { auth_user_id, email }
user_lookup                    — implicit on success (no extra line)
jwt:metadata                   — { user_id, room_id }
rate_limit:check               — { perMinute, perDay, limits }
body:received                  — pass, model, sizes, flags
prep:image                     — extract/escalate: decoded byte count
prep:extract_prompt            — extract/escalate: full prompt as a multi-line block
prep:catalog_stats             — validate: per-list counts
prep:catalog_productNames_sample
prep:catalog_categoryNames
prep:catalog_storeNames
prep:catalog_expenseLabels
prep:catalog_recentExpenses    — full recentExpenses array
prep:validate_receipt          — full receipt JSON entering validate
prep:validate_catalog          — full catalog JSON entering validate
prep:validate_prompt_size      — total chars + approx tokens
prep:validate_prompt           — final user message verbatim
openrouter:call                — { pass, model }
openrouter:request_summary
openrouter:msg                 — one block per message part (image_url is
                                 logged with the data: prefix only, payload bytes count)
openrouter:response_meta       — { http, ms }
openrouter:usage               — token counts from the provider
openrouter:content             — raw assistant content verbatim
openrouter:parsed_summary      — counts + match hints
openrouter:parsed_full         — normalized payload pretty-printed
cost:estimate                  — { model, cost_usd, usage }
usage_log:inserted             — or :insert_failed
request:done                   — final summary
```

Errors and warnings appear as `console.warn`/`console.error` with the
same prefix; in the Supabase dashboard they're tagged as `WARN`/`ERROR`.

Reading the logs:
- **Supabase Dashboard** → Edge Functions → `ocr-receipt` → Logs tab.
- **From here** (via MCP): `get_logs(service: 'edge-function')` then
  grep the response for `ocr-receipt:<reqId>` once you have a request
  id (it shows up in the first log line of any scan).

## Debugging — local script

`scripts/debug-ocr-prompt.mjs` builds the exact catalog the client would
send for a room and prints the full validate-pass user message
(prompt + receipt JSON + catalog JSON). Useful when matching looks off
and you need to see whether the relevant past expense is even in the
catalog and whether its receipt items are attached.

```
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_SECRET_KEY=<service-role-key> \
  node scripts/debug-ocr-prompt.mjs <room_id> [receipt.json]
```

Optional flags:
- `--send` — also call OpenRouter with the assembled message and print
  the JSON response (needs `OPENROUTER_API_KEY`).
- `--model=<id>` — override the validate model (default `openai/gpt-5-mini`).
- `--no-prompt` — only run the request, skip dumping the prompt.

If `receipt.json` is omitted the script uses a hardcoded "футболка 33 BYN"
sample so you can sanity-check the одежда case quickly.

## Quantity & unit-price on receipt items

Since app version 1.12.12 / receiptItem schema v6, each receipt item carries
a `quantity` (decimal, step 0.001, default 1) and `amount` is the
**unit price** — price per 1 шт / 1 кг / 1 л. Line total = `amount × quantity`.

The OCR extract prompt now asks the model to decompose each line:
- `2 × 50.00 = 100.00` → `quantity=2, amount=50.00`
- `0.350 кг × 12.50 = 4.38` → `quantity=0.350, amount=12.50`
- `Молоко 1л — 3.50` → `quantity=1, amount=3.50`

When the model cannot decompose a line, it returns
`quantity=1, amount=lineTotal, needsReview=true`. The flag is **transient
UI state only** — it surfaces a yellow "Требует проверки" badge in the
AddExpense form and is dropped on save. The validate-pass sum-check is
`Σ amount × quantity ≈ total` (1% tolerance).

Purchases still store `purchase.price = item.amount` (unit price); no
quantity is persisted on purchases, so price-history queries work
unchanged.

## Async scan flow (since 1.13.0)

The camera FAB no longer blocks the user while OCR runs. The flow is now:

1. Capture photo → resize → upload to `sync-attachments/{room_id}/pending_scans/{scanId}.jpg`.
2. INSERT a `pending_receipt_scans` row (status=`pending`).
3. POST `start-receipt-scan` edge function. It transitions status to
   `processing`, returns 202, and runs the 3-pass pipeline in
   `EdgeRuntime.waitUntil` (with a feature-detect fallback to inline await
   so the local CLI still works).
4. The worker writes `status='ready' | 'failed'` plus `parsed_payload` and a
   fully-resolved `prefill_payload` (server-side equivalent of the old
   client matching code).
5. Clients watching `ExpensesDashboard` see the row update via Realtime on
   `supabase_realtime` publication and re-render the pending row. Tap →
   `/expenses/add` with `ocrPrefill` carrying both the parsed data and
   `pendingScanId` / `pendingScanStoragePath`.
6. On save: `expense_attachments_sync` row is inserted with
   `storage_path = pendingScanStoragePath` (no re-upload), then the
   pending row is deleted (storage object stays as the attachment).
7. On cancel: confirm dialog → both row and storage object are removed.

Tables, RLS and Realtime live in `supabase/migrations/20260518140000_pending_receipt_scans.sql`.

The edge function reuses `_shared/openrouter.ts`, `_shared/log.ts`,
`_shared/types.ts`, `_shared/matching.ts`, `_shared/catalog.ts`,
`_shared/resolve.ts`. The old `ocr-receipt` function is preserved verbatim
(now a thin wrapper over `_shared/`) so `scripts/debug-ocr-prompt.mjs`
keeps working.

Retry semantics: `start-receipt-scan` accepts `{ force: true }` to reclaim
either `failed` rows or `processing` rows older than 10 minutes
(orphan recovery for crashed workers). Atomic claim via `WHERE id=$1 AND
status IN ('failed','processing')` so two concurrent invocations can't
both pick up the same row.

The pending table is **cloud-only** — no RxDB collection, no schema
version bump. Client subscribes directly via `usePendingScans(roomId)`.

## Files of interest

- `src/components/expenses/ScanReceiptFlow.tsx` — camera + pipeline orchestration.
- `src/components/expenses/ReceiptCameraModal.tsx` — capture UI.
- `src/lib/ai/ocrPipeline.ts` — client orchestrator and resize helpers.
- `src/lib/ai/matching.ts` — purchase / store / expense / label heuristics.
- `src/lib/ai/models.ts` — model catalogue with $/receipt and quality tier.
- `src/lib/supabase/aiSettings.ts` — CRUD for `room_ai_settings`.
- `src/contexts/AiSettingsContext.tsx` — global provider (`useAiSettings()`).
- `src/components/settings/AiSection.tsx` — Settings UI (toggle + selectors).
- `supabase/functions/ocr-receipt/index.ts` — JWT auth, rate limit, OpenRouter call (sync single-pass; kept for `scripts/debug-ocr-prompt.mjs`).
- `supabase/functions/start-receipt-scan/index.ts` — async orchestrator, runs full pipeline in `EdgeRuntime.waitUntil`.
- `supabase/functions/_shared/*.ts` — prompts, JSON schema, logger, catalog builder, server-side matching.
- `supabase/migrations/20260517120000_ai_settings_and_usage.sql` — tables + `is_room_member()`.
- `supabase/migrations/20260518140000_pending_receipt_scans.sql` — async scan jobs table + RLS + Realtime.
- `src/hooks/usePendingScans.ts` — Realtime subscription for pending rows.
- `src/components/expenses/PendingScanRow.tsx` — list row with spinner / ready / failed / orphan states.
- `src/lib/ai/pendingScans.ts` — client helpers: `startScan`, `retryScan`, `deletePendingScan`, `promotePendingScan`.
