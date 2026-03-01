-- Fix infinite recursion in room_memberships RLS policy.
-- The previous policy queried room_memberships from within a policy on room_memberships,
-- causing infinite recursion. Use a SECURITY DEFINER function to break the cycle.

-- Create a security definer function to get current user's room IDs without triggering RLS
CREATE OR REPLACE FUNCTION get_my_room_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT room_id FROM room_memberships
  WHERE (user_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'user_db_id')
$$;

-- Drop recursive policy and recreate using the function
DROP POLICY IF EXISTS "Members can see room memberships" ON room_memberships;

CREATE POLICY "Members can see room memberships"
  ON room_memberships FOR SELECT TO authenticated
  USING (room_id IN (SELECT get_my_room_ids()));

-- Fix users policy to also use the function
DROP POLICY IF EXISTS "Users can read own record" ON users;

CREATE POLICY "Users can read own record"
  ON users FOR SELECT TO authenticated
  USING (
    auth_user_id = auth.uid()
    OR id IN (
      SELECT rm.user_id FROM room_memberships rm
      WHERE rm.room_id IN (SELECT get_my_room_ids())
    )
  );
