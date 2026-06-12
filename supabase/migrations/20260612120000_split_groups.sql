-- Split groups: settlement scopes decoupled from expense categories.
-- Categories stay a pure analytics dimension; the who-owes-whom math is now
-- scoped by split groups ("Trip to Grodno", "Flatmates", ...).
-- Additive-only per project rules.

CREATE TABLE IF NOT EXISTS split_groups_sync (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS split_groups_sync_room_idx
  ON split_groups_sync (room_id, updated_at);

ALTER TABLE split_groups_sync ENABLE ROW LEVEL SECURITY;

-- RLS via is_room_member() (SECURITY DEFINER, uses auth.uid()), per
-- docs/AI_FEATURE_NOTES.md (avoids the stale-JWT 42501 trap).
DROP POLICY IF EXISTS "split_groups room access" ON split_groups_sync;
CREATE POLICY "split_groups room access" ON split_groups_sync
  FOR ALL TO authenticated
  USING (public.is_room_member(room_id))
  WITH CHECK (public.is_room_member(room_id));

-- Realtime so peers see new groups live.
ALTER PUBLICATION supabase_realtime ADD TABLE split_groups_sync;

-- Auto-bump updated_at on UPDATE so deletions/tombstones propagate to peers.
DROP TRIGGER IF EXISTS set_updated_at_on_update ON split_groups_sync;
CREATE TRIGGER set_updated_at_on_update
  BEFORE UPDATE ON split_groups_sync
  FOR EACH ROW EXECUTE FUNCTION public.sync_table_set_updated_at();

-- Expense → split group link (nullable; old expenses stay ungrouped by design).
ALTER TABLE expenses_sync ADD COLUMN IF NOT EXISTS split_group_id uuid;

-- Note: expense_settlements_sync.category_id is NOT renamed (additive-only
-- rule). New repayment rows store a split group id in that column; legacy
-- rows keep their category id and are preserved but no longer shown in the
-- group settlement UI.
COMMENT ON COLUMN expense_settlements_sync.category_id IS
  'Settlement scope id: split group id for new rows, legacy expense category id for old rows.';
