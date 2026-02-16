-- RLS Policies for sync tables
-- Users can only access data from their own room (room_id matches JWT metadata)

-- Products sync
CREATE POLICY "User room access" ON products_sync
  FOR ALL TO authenticated
  USING (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'))
  WITH CHECK (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'));

-- Stores sync
CREATE POLICY "User room access" ON stores_sync
  FOR ALL TO authenticated
  USING (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'))
  WITH CHECK (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'));

-- Purchases sync
CREATE POLICY "User room access" ON purchases_sync
  FOR ALL TO authenticated
  USING (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'))
  WITH CHECK (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'));

-- Expense categories sync
CREATE POLICY "User room access" ON expense_categories_sync
  FOR ALL TO authenticated
  USING (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'))
  WITH CHECK (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'));

-- Expenses sync
CREATE POLICY "User room access" ON expenses_sync
  FOR ALL TO authenticated
  USING (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'))
  WITH CHECK (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'));

-- Receipts sync
CREATE POLICY "User room access" ON receipts_sync
  FOR ALL TO authenticated
  USING (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'))
  WITH CHECK (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'));

-- Receipt items sync
CREATE POLICY "User room access" ON receipt_items_sync
  FOR ALL TO authenticated
  USING (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'))
  WITH CHECK (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'));

-- Expense attachments sync
CREATE POLICY "User room access" ON expense_attachments_sync
  FOR ALL TO authenticated
  USING (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'))
  WITH CHECK (room_id::text = (auth.jwt() -> 'user_metadata' ->> 'room_id'));
