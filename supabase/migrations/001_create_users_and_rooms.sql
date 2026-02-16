-- Create users table (Telegram users)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint UNIQUE NOT NULL,
  username text,
  first_name text,
  last_name text,
  photo_url text,
  auth_date bigint,
  auth_user_id uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index for telegram_id
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);

-- Create index for auth_user_id
CREATE INDEX IF NOT EXISTS idx_users_auth_user_id ON users(auth_user_id);

-- Create rooms table
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid REFERENCES users(id) NOT NULL,
  is_personal boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create room_memberships table
CREATE TABLE IF NOT EXISTS room_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) NOT NULL,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at timestamptz DEFAULT now(),
  UNIQUE(user_id, room_id)
);

-- Create indexes for room_memberships
CREATE INDEX IF NOT EXISTS idx_room_memberships_user ON room_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_room_memberships_room ON room_memberships(room_id);

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_memberships ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users
CREATE POLICY "Users visible to room members" ON users
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM room_memberships rm1
      JOIN room_memberships rm2 ON rm1.room_id = rm2.room_id
      WHERE rm2.user_id = users.id
        AND rm1.user_id IN (
          SELECT id FROM users WHERE auth_user_id = auth.uid()
        )
    )
  );

-- RLS Policies for rooms
CREATE POLICY "Rooms visible to members" ON rooms
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM room_memberships
      WHERE room_id = rooms.id
        AND user_id IN (
          SELECT id FROM users WHERE auth_user_id = auth.uid()
        )
    )
  );

-- RLS Policies for room_memberships
CREATE POLICY "User can see own memberships" ON room_memberships
  FOR ALL USING (
    user_id IN (
      SELECT id FROM users WHERE auth_user_id = auth.uid()
    )
  );

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
