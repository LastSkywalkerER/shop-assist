-- Table to store custom (non-Telegram-user) creator names per room
CREATE TABLE IF NOT EXISTS room_custom_names (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(room_id, name)
);

ALTER TABLE room_custom_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "room_custom_names_access" ON room_custom_names
  USING (room_id = (auth.jwt() ->> 'room_id')::uuid);

CREATE POLICY "room_custom_names_insert" ON room_custom_names
  FOR INSERT
  WITH CHECK (room_id = (auth.jwt() ->> 'room_id')::uuid);
