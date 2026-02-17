-- Room invites table for sharing rooms via deep links
CREATE TABLE IF NOT EXISTS room_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  invite_code text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  role text NOT NULL DEFAULT 'editor',
  expires_at timestamptz,
  max_uses integer,
  use_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_room_invites_code ON room_invites (invite_code);
CREATE INDEX IF NOT EXISTS idx_room_invites_room ON room_invites (room_id);

ALTER TABLE room_invites ENABLE ROW LEVEL SECURITY;

-- Room members can view invites for their rooms
CREATE POLICY "Room members can view invites"
  ON room_invites FOR SELECT TO authenticated
  USING (
    room_id IN (
      SELECT rm.room_id FROM room_memberships rm
      JOIN users u ON u.id = rm.user_id
      WHERE u.auth_user_id = auth.uid()
    )
  );

-- Only invite creator can manage (update/delete) their invites
CREATE POLICY "Room owner can manage invites"
  ON room_invites FOR ALL TO authenticated
  USING (
    created_by IN (SELECT id FROM users WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    created_by IN (SELECT id FROM users WHERE auth_user_id = auth.uid())
  );
