-- Async receipt OCR jobs. Cloud-only (no RxDB replication).
-- Lifecycle: pending → processing → ready | failed.
-- Clients INSERT/DELETE; the worker (service role) UPDATEs through the pipeline.

DO $$ BEGIN
  CREATE TYPE pending_scan_status AS ENUM ('pending', 'processing', 'ready', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS pending_receipt_scans (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id                 uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  created_by_user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                  pending_scan_status NOT NULL DEFAULT 'pending',
  image_storage_path      text NOT NULL,
  image_mime              text NOT NULL DEFAULT 'image/jpeg',
  parsed_payload          jsonb,
  prefill_payload         jsonb,
  cost_usd                numeric,
  error_message           text,
  duplicate_of_expense_id uuid,
  processing_started_at   timestamptz,
  completed_at            timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_scans_room_created
  ON pending_receipt_scans (room_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pending_scans_active_status
  ON pending_receipt_scans (status)
  WHERE status IN ('pending', 'processing');

-- Reuse the bump-updated_at helper from 20260518130000_bump_updated_at_on_sync_changes.sql.
DROP TRIGGER IF EXISTS set_updated_at_on_update ON pending_receipt_scans;
CREATE TRIGGER set_updated_at_on_update
  BEFORE UPDATE ON pending_receipt_scans
  FOR EACH ROW EXECUTE FUNCTION public.sync_table_set_updated_at();

ALTER TABLE pending_receipt_scans ENABLE ROW LEVEL SECURITY;

-- Room-scoped via is_room_member() (SECURITY DEFINER). See docs/AI_FEATURE_NOTES.md
-- for why we don't use the user_metadata JWT pattern on new tables.
CREATE POLICY "pending_receipt_scans_select"
  ON pending_receipt_scans FOR SELECT TO authenticated
  USING (public.is_room_member(room_id));

CREATE POLICY "pending_receipt_scans_insert"
  ON pending_receipt_scans FOR INSERT TO authenticated
  WITH CHECK (public.is_room_member(room_id));

-- No client UPDATE policy on purpose — only the edge function (service role)
-- mutates status / parsed_payload / prefill_payload. Clients only DELETE.
CREATE POLICY "pending_receipt_scans_delete"
  ON pending_receipt_scans FOR DELETE TO authenticated
  USING (public.is_room_member(room_id));

-- Enable Realtime so clients see status transitions live.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE pending_receipt_scans;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
