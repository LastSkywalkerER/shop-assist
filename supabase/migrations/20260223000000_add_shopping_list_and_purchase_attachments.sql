-- shopping_list_items_sync
CREATE TABLE IF NOT EXISTS shopping_list_items_sync (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_shopping_list_items_sync_room ON shopping_list_items_sync (room_id);
CREATE INDEX IF NOT EXISTS idx_shopping_list_items_sync_updated ON shopping_list_items_sync (updated_at);

ALTER TABLE shopping_list_items_sync ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User room access" ON shopping_list_items_sync FOR ALL TO authenticated
  USING ((room_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'room_id'))
  WITH CHECK ((room_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'room_id'));

ALTER PUBLICATION supabase_realtime ADD TABLE shopping_list_items_sync;

-- purchase_attachments_sync
CREATE TABLE IF NOT EXISTS purchase_attachments_sync (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  purchase_id uuid NOT NULL,
  data_url text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_purchase_attachments_sync_room ON purchase_attachments_sync (room_id);
CREATE INDEX IF NOT EXISTS idx_purchase_attachments_sync_updated ON purchase_attachments_sync (updated_at);

ALTER TABLE purchase_attachments_sync ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User room access" ON purchase_attachments_sync FOR ALL TO authenticated
  USING ((room_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'room_id'))
  WITH CHECK ((room_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'room_id'));

ALTER PUBLICATION supabase_realtime ADD TABLE purchase_attachments_sync;
