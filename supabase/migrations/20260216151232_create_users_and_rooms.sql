-- Create users table (Telegram users)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint UNIQUE NOT NULL,
  username text,
  first_name text,
  last_name text,
  photo_url text,
  auth_date bigint NOT NULL,
  auth_user_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users (telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON users (auth_user_id);

-- Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid REFERENCES users(id) ON DELETE CASCADE,
  is_personal boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create room_memberships table
CREATE TABLE IF NOT EXISTS room_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE,
  role text DEFAULT 'member',
  joined_at timestamptz DEFAULT now(),
  UNIQUE(user_id, room_id)
);

CREATE INDEX IF NOT EXISTS idx_room_memberships_user ON room_memberships (user_id);
CREATE INDEX IF NOT EXISTS idx_room_memberships_room ON room_memberships (room_id);

-- updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_memberships ENABLE ROW LEVEL SECURITY;

-- RLS: users
CREATE POLICY "Users can read own record"
  ON users FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY "Users can update own record"
  ON users FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- RLS: rooms (visible to members via user_db_id in JWT)
CREATE POLICY "Rooms visible to members"
  ON rooms FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM room_memberships
      WHERE room_memberships.room_id = rooms.id
        AND (room_memberships.user_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'user_db_id')
    )
  );

-- RLS: room_memberships
CREATE POLICY "User can see own memberships"
  ON room_memberships FOR SELECT TO authenticated
  USING ((user_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'user_db_id'));

CREATE POLICY "User can manage own memberships"
  ON room_memberships FOR ALL TO authenticated
  USING ((user_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'user_db_id'))
  WITH CHECK ((user_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'user_db_id'));
