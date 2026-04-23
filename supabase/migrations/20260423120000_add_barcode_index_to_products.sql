-- Additive: speed up barcode-based product lookup.
-- The `barcode` column already exists on products_sync (see 20260216151258_create_sync_tables.sql).
CREATE INDEX IF NOT EXISTS idx_products_sync_barcode ON products_sync (barcode) WHERE barcode IS NOT NULL;
