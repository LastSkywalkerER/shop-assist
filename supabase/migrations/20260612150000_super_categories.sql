-- Super categories: coarse analytics grouping over expense categories.
-- Analytics defaults to the super-category breakdown; categories outside any
-- super category are shown under «Другое».
-- Additive-only per project rules.

CREATE TABLE IF NOT EXISTS super_categories_sync (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS super_categories_sync_room_idx
  ON super_categories_sync (room_id, updated_at);

ALTER TABLE super_categories_sync ENABLE ROW LEVEL SECURITY;

-- RLS via is_room_member() (SECURITY DEFINER, uses auth.uid()), per
-- docs/AI_FEATURE_NOTES.md (avoids the stale-JWT 42501 trap).
DROP POLICY IF EXISTS "super_categories room access" ON super_categories_sync;
CREATE POLICY "super_categories room access" ON super_categories_sync
  FOR ALL TO authenticated
  USING (public.is_room_member(room_id))
  WITH CHECK (public.is_room_member(room_id));

-- Realtime so peers see new super categories live.
ALTER PUBLICATION supabase_realtime ADD TABLE super_categories_sync;

-- Auto-bump updated_at on UPDATE so deletions/tombstones propagate to peers.
DROP TRIGGER IF EXISTS set_updated_at_on_update ON super_categories_sync;
CREATE TRIGGER set_updated_at_on_update
  BEFORE UPDATE ON super_categories_sync
  FOR EACH ROW EXECUTE FUNCTION public.sync_table_set_updated_at();

-- Category → super category link (nullable; ungrouped categories fall under
-- «Другое» in the default analytics breakdown).
ALTER TABLE expense_categories_sync ADD COLUMN IF NOT EXISTS super_category_id uuid;
