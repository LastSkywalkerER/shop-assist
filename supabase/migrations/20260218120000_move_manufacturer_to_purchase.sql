-- Move manufacturer, package_volume from products to purchases
-- Add variety field to purchases

ALTER TABLE purchases_sync
  ADD COLUMN IF NOT EXISTS manufacturer TEXT,
  ADD COLUMN IF NOT EXISTS package_volume TEXT,
  ADD COLUMN IF NOT EXISTS variety TEXT;

ALTER TABLE products_sync
  DROP COLUMN IF EXISTS manufacturer,
  DROP COLUMN IF EXISTS package_volume;
