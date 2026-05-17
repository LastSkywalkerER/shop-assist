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
    `google/gemini-2.5-pro`.
- OpenRouter is called server-side from `supabase/functions/ocr-receipt`
  so the API key stays in `OPENROUTER_API_KEY` env var.
- Rate limit per user: 20/min, 200/day, enforced via row count in
  `ai_usage_log`.
- Parsed receipt is consumed in-flight; raw OCR JSON is NOT persisted (no
  schema bump).
- Matching is driven by the validate-pass model. The client sends a
  compact `catalog` (products, categories, stores, ~150 recent expenses)
  with the receipt, and the model returns a `matches` block:
  - `matches.items[]` — per-item productId + confidence
  - `matches.expenseName / expenseCategoryId / expenseLabelConfidence`
  - `matches.existingExpenseId / existingExpenseConfidence`
- `ScanReceiptFlow` accepts model matches whose confidence ≥ 0.8 and
  whose id exists in the catalog. For anything below that bar, or if
  the model omits a field, it falls back to local heuristics:
  - `matchPurchaseForItem` (token-Jaccard + same-store bonus)
  - `matchExpenseForReceipt` (same store + ±1 day + total within 1%)
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

## Files of interest

- `src/components/expenses/ScanReceiptFlow.tsx` — camera + pipeline orchestration.
- `src/components/expenses/ReceiptCameraModal.tsx` — capture UI.
- `src/lib/ai/ocrPipeline.ts` — client orchestrator and resize helpers.
- `src/lib/ai/matching.ts` — purchase / store / expense / label heuristics.
- `src/lib/ai/models.ts` — model catalogue with $/receipt and quality tier.
- `src/lib/supabase/aiSettings.ts` — CRUD for `room_ai_settings`.
- `src/contexts/AiSettingsContext.tsx` — global provider (`useAiSettings()`).
- `src/components/settings/AiSection.tsx` — Settings UI (toggle + selectors).
- `supabase/functions/ocr-receipt/index.ts` — JWT auth, rate limit, OpenRouter call.
- `supabase/migrations/20260517120000_ai_settings_and_usage.sql` — tables + `is_room_member()`.
