-- Expense-import ignore list: names the user chose to skip when importing an
-- expense list (bulk upload). Rows whose name is (almost) identical are hidden
-- from the reconcile list and skipped on future recognitions. Room-scoped and
-- synced so the whole room shares one ignore list. Additive-only per project rules.

CREATE TABLE IF NOT EXISTS expense_import_ignores_sync (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS expense_import_ignores_sync_room_idx
  ON expense_import_ignores_sync (room_id, updated_at);

ALTER TABLE expense_import_ignores_sync ENABLE ROW LEVEL SECURITY;

-- RLS via is_room_member() (SECURITY DEFINER, uses auth.uid()), per
-- docs/AI_FEATURE_NOTES.md (avoids the stale-JWT 42501 trap).
DROP POLICY IF EXISTS "expense_import_ignores room access" ON expense_import_ignores_sync;
CREATE POLICY "expense_import_ignores room access" ON expense_import_ignores_sync
  FOR ALL TO authenticated
  USING (public.is_room_member(room_id))
  WITH CHECK (public.is_room_member(room_id));

-- Realtime so peers see ignore-list changes live.
ALTER PUBLICATION supabase_realtime ADD TABLE expense_import_ignores_sync;

-- Auto-bump updated_at on UPDATE so deletions/tombstones propagate to peers.
DROP TRIGGER IF EXISTS set_updated_at_on_update ON expense_import_ignores_sync;
CREATE TRIGGER set_updated_at_on_update
  BEFORE UPDATE ON expense_import_ignores_sync
  FOR EACH ROW EXECUTE FUNCTION public.sync_table_set_updated_at();
