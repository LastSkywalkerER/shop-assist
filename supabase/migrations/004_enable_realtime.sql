-- Enable Realtime for all sync tables

ALTER PUBLICATION supabase_realtime ADD TABLE products_sync;
ALTER PUBLICATION supabase_realtime ADD TABLE stores_sync;
ALTER PUBLICATION supabase_realtime ADD TABLE purchases_sync;
ALTER PUBLICATION supabase_realtime ADD TABLE expense_categories_sync;
ALTER PUBLICATION supabase_realtime ADD TABLE expenses_sync;
ALTER PUBLICATION supabase_realtime ADD TABLE receipts_sync;
ALTER PUBLICATION supabase_realtime ADD TABLE receipt_items_sync;
ALTER PUBLICATION supabase_realtime ADD TABLE expense_attachments_sync;
