-- Create sync tables for RxDB replication

-- Products sync
CREATE TABLE IF NOT EXISTS products_sync (
  id uuid PRIMARY KEY,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  manufacturer text,
  package_volume text,
  barcode text,
  category text,
  notes text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_products_sync_room ON products_sync(room_id);
CREATE INDEX IF NOT EXISTS idx_products_sync_updated ON products_sync(updated_at);

-- Stores sync
CREATE TABLE IF NOT EXISTS stores_sync (
  id uuid PRIMARY KEY,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  type text,
  address text,
  chain text,
  notes text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_stores_sync_room ON stores_sync(room_id);
CREATE INDEX IF NOT EXISTS idx_stores_sync_updated ON stores_sync(updated_at);

-- Purchases sync
CREATE TABLE IF NOT EXISTS purchases_sync (
  id uuid PRIMARY KEY,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
  product_id uuid NOT NULL,
  store_id uuid NOT NULL,
  price_byn numeric(10,2) NOT NULL,
  quality_rating integer,
  purchase_date timestamptz NOT NULL,
  notes text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false,
  CONSTRAINT quality_rating_range CHECK (quality_rating IS NULL OR (quality_rating >= 1 AND quality_rating <= 5))
);

CREATE INDEX IF NOT EXISTS idx_purchases_sync_room ON purchases_sync(room_id);
CREATE INDEX IF NOT EXISTS idx_purchases_sync_updated ON purchases_sync(updated_at);

-- Expense categories sync
CREATE TABLE IF NOT EXISTS expense_categories_sync (
  id uuid PRIMARY KEY,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_expense_categories_sync_room ON expense_categories_sync(room_id);
CREATE INDEX IF NOT EXISTS idx_expense_categories_sync_updated ON expense_categories_sync(updated_at);

-- Expenses sync
CREATE TABLE IF NOT EXISTS expenses_sync (
  id uuid PRIMARY KEY,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
  name text,
  store_id uuid,
  amount numeric(10,2) NOT NULL,
  date timestamptz NOT NULL,
  category_id uuid,
  notes text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_expenses_sync_room ON expenses_sync(room_id);
CREATE INDEX IF NOT EXISTS idx_expenses_sync_updated ON expenses_sync(updated_at);
CREATE INDEX IF NOT EXISTS idx_expenses_sync_date ON expenses_sync(date);

-- Receipts sync
CREATE TABLE IF NOT EXISTS receipts_sync (
  id uuid PRIMARY KEY,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
  expense_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_receipts_sync_room ON receipts_sync(room_id);
CREATE INDEX IF NOT EXISTS idx_receipts_sync_updated ON receipts_sync(updated_at);

-- Receipt items sync
CREATE TABLE IF NOT EXISTS receipt_items_sync (
  id uuid PRIMARY KEY,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
  receipt_id uuid NOT NULL,
  name text NOT NULL,
  amount numeric(10,2) NOT NULL,
  manufacturer text,
  package_volume text,
  category text,
  quality_rating integer,
  notes text,
  converted_to_purchase_id uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false,
  CONSTRAINT receipt_items_quality_rating_range CHECK (quality_rating IS NULL OR (quality_rating >= 1 AND quality_rating <= 5))
);

CREATE INDEX IF NOT EXISTS idx_receipt_items_sync_room ON receipt_items_sync(room_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_sync_updated ON receipt_items_sync(updated_at);
CREATE INDEX IF NOT EXISTS idx_receipt_items_sync_receipt ON receipt_items_sync(receipt_id);

-- Expense attachments sync
CREATE TABLE IF NOT EXISTS expense_attachments_sync (
  id uuid PRIMARY KEY,
  room_id uuid REFERENCES rooms(id) ON DELETE CASCADE NOT NULL,
  receipt_id uuid NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  data_url text NOT NULL,
  size integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  _deleted boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_expense_attachments_sync_room ON expense_attachments_sync(room_id);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_sync_updated ON expense_attachments_sync(updated_at);

-- Enable RLS on all sync tables
ALTER TABLE products_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_items_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_attachments_sync ENABLE ROW LEVEL SECURITY;
