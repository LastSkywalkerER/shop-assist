-- Expense groups: free-form buckets of expenses (a trip, a renovation, a
-- project), independent from categories. An expense keeps its category and may
-- additionally belong to one group, so analytics can be sliced by group, by
-- category, or by both at once (the intersection).
--
-- The group is stored denormalized on the expense as a name (the same way
-- product categories are handled) instead of its own table: RxDB's
-- open-source build caps a database at 16 collections and the client is
-- already at that limit, so no 17th synced collection can be added.
--
-- Additive-only per project rules.

ALTER TABLE expenses_sync ADD COLUMN IF NOT EXISTS group_name text;

-- Lists and analytics filter expenses by group name inside a room.
CREATE INDEX IF NOT EXISTS expenses_sync_room_group_idx
  ON expenses_sync (room_id, group_name);
