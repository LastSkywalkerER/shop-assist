-- Expense participants: people who share part of an expense's cost.
--
-- The main payer stays on expenses_sync (creator_name); this table holds the
-- co-payers / consumers and how their share is computed. Additive-only per
-- project rules (new table + policy + realtime + trigger).

CREATE TABLE IF NOT EXISTS expense_participants_sync (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL,
  name text NOT NULL,
  share_mode text NOT NULL,            -- 'equal' | 'amount' | 'items'
  share_amount numeric,                -- used when share_mode = 'amount'
  item_ids jsonb,                      -- receipt item ids; used when share_mode = 'items'
  settled_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS expense_participants_sync_room_idx
  ON expense_participants_sync (room_id, updated_at);
CREATE INDEX IF NOT EXISTS expense_participants_sync_expense_idx
  ON expense_participants_sync (expense_id);

ALTER TABLE expense_participants_sync ENABLE ROW LEVEL SECURITY;

-- RLS via is_room_member() (SECURITY DEFINER, uses auth.uid()) rather than the
-- user_metadata JWT claim. This is the documented best practice in
-- docs/AI_FEATURE_NOTES.md: it avoids the stale-JWT 42501 trap and does not
-- depend on the client-editable user_metadata. The replication push handler
-- still independently checks the room_id, so this is fully compatible.
DROP POLICY IF EXISTS "expense_participants room access" ON expense_participants_sync;
CREATE POLICY "expense_participants room access" ON expense_participants_sync
  FOR ALL TO authenticated
  USING (public.is_room_member(room_id))
  WITH CHECK (public.is_room_member(room_id));

-- Realtime so peers see participant changes live (mirrors 20260216151308).
ALTER PUBLICATION supabase_realtime ADD TABLE expense_participants_sync;

-- Auto-bump updated_at on UPDATE so deletions/tombstones propagate to peers'
-- pull queries (mirrors 20260518130000_bump_updated_at_on_sync_changes.sql).
DROP TRIGGER IF EXISTS set_updated_at_on_update ON expense_participants_sync;
CREATE TRIGGER set_updated_at_on_update
  BEFORE UPDATE ON expense_participants_sync
  FOR EACH ROW EXECUTE FUNCTION public.sync_table_set_updated_at();
