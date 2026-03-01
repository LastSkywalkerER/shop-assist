-- Add creator_name column to shopping list and expenses sync tables
ALTER TABLE shopping_list_items_sync ADD COLUMN IF NOT EXISTS creator_name TEXT;
ALTER TABLE expenses_sync ADD COLUMN IF NOT EXISTS creator_name TEXT;
