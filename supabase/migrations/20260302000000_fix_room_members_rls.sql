-- Fix RLS so users can see all members in rooms they belong to,
-- and read user profiles of those members.

-- Drop old restrictive policies
DROP POLICY IF EXISTS "User can see own memberships" ON room_memberships;
DROP POLICY IF EXISTS "Users can read own record" ON users;

-- room_memberships: can see all rows for rooms you are a member of
CREATE POLICY "Members can see room memberships"
  ON room_memberships FOR SELECT TO authenticated
  USING (
    room_id IN (
      SELECT rm.room_id FROM room_memberships rm
      WHERE (rm.user_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'user_db_id')
    )
  );

-- users: can read own record OR records of users sharing a room with you
CREATE POLICY "Users can read own record"
  ON users FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR id IN (
      SELECT rm.user_id FROM room_memberships rm
      WHERE rm.room_id IN (
        SELECT rm2.room_id FROM room_memberships rm2
        WHERE (rm2.user_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'user_db_id')
      )
    )
  );
