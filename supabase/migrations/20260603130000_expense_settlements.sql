-- Expense settlements: recorded repayments within a category, independent of
-- any single expense (e.g. "Оля отдала Косте 171.50 по этой категории").
-- Additive-only per project rules.

CREATE TABLE IF NOT EXISTS expense_settlements_sync (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  category_id uuid NOT NULL,
  from_name text NOT NULL,
  to_name text NOT NULL,
  amount numeric NOT NULL,
  currency text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS expense_settlements_sync_room_idx
  ON expense_settlements_sync (room_id, updated_at);
CREATE INDEX IF NOT EXISTS expense_settlements_sync_category_idx
  ON expense_settlements_sync (category_id);

ALTER TABLE expense_settlements_sync ENABLE ROW LEVEL SECURITY;

-- RLS via is_room_member() (SECURITY DEFINER, uses auth.uid()), per
-- docs/AI_FEATURE_NOTES.md (avoids the stale-JWT 42501 trap).
DROP POLICY IF EXISTS "expense_settlements room access" ON expense_settlements_sync;
CREATE POLICY "expense_settlements room access" ON expense_settlements_sync
  FOR ALL TO authenticated
  USING (public.is_room_member(room_id))
  WITH CHECK (public.is_room_member(room_id));

-- Realtime so peers see recorded payments live.
ALTER PUBLICATION supabase_realtime ADD TABLE expense_settlements_sync;

-- Auto-bump updated_at on UPDATE so deletions/tombstones propagate to peers.
DROP TRIGGER IF EXISTS set_updated_at_on_update ON expense_settlements_sync;
CREATE TRIGGER set_updated_at_on_update
  BEFORE UPDATE ON expense_settlements_sync
  FOR EACH ROW EXECUTE FUNCTION public.sync_table_set_updated_at();
