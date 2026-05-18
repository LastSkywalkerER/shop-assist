-- Auto-bump updated_at on row UPDATE for every *_sync table.
--
-- Why: RxDB's doc.remove() flips _deleted=true but does NOT touch the
-- doc's updatedAt field. The push handler upserts the row as-is, so the
-- tombstone in Supabase keeps its old updated_at. Other clients pull via
-- "WHERE updated_at > checkpoint" and never see the deletion. The same
-- trap exists for any doc.patch(...) that forgets to bump updatedAt.
--
-- This trigger forces the server to stamp updated_at = NOW() on every
-- UPDATE, so deletions and any other modifications are always visible
-- to peer clients' pull queries.

CREATE OR REPLACE FUNCTION public.sync_table_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
  sync_tables text[] := ARRAY[
    'products_sync',
    'stores_sync',
    'purchases_sync',
    'expense_categories_sync',
    'expenses_sync',
    'receipts_sync',
    'receipt_items_sync',
    'expense_attachments_sync',
    'shopping_list_items_sync',
    'purchase_attachments_sync'
  ];
BEGIN
  FOREACH t IN ARRAY sync_tables LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at_on_update ON %I;',
      t
    );
    EXECUTE format(
      'CREATE TRIGGER set_updated_at_on_update '
      'BEFORE UPDATE ON %I '
      'FOR EACH ROW EXECUTE FUNCTION public.sync_table_set_updated_at();',
      t
    );
  END LOOP;
END;
$$;

-- One-time fixup: re-stamp updated_at on already-existing tombstones so
-- clients that have stale deletions still pending finally pick them up
-- on their next pull. Safe to run multiple times.
DO $$
DECLARE
  t text;
  sync_tables text[] := ARRAY[
    'products_sync',
    'stores_sync',
    'purchases_sync',
    'expense_categories_sync',
    'expenses_sync',
    'receipts_sync',
    'receipt_items_sync',
    'expense_attachments_sync',
    'shopping_list_items_sync',
    'purchase_attachments_sync'
  ];
BEGIN
  FOREACH t IN ARRAY sync_tables LOOP
    EXECUTE format(
      'UPDATE %I SET updated_at = NOW() WHERE _deleted = true',
      t
    );
  END LOOP;
END;
$$;
