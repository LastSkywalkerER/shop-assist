-- Global currency rates table (NBRB official rates).
-- Unlike other *_sync tables, this one is NOT room-scoped: rates are the same
-- for every user, so there is no room_id column and RLS grants read access
-- to every authenticated user. Writes happen only via service_role from the
-- fetch-nbrb-rates edge function.
--
-- `rate` is normalized to "BYN per 1 unit of foreign currency" — the original
-- NBRB scale (e.g. 100 for RUB) is preserved in the `scale` column for audit.

CREATE TABLE IF NOT EXISTS currency_rates_sync (
  id uuid PRIMARY KEY,
  currency text NOT NULL,
  date date NOT NULL,
  rate numeric(18, 6) NOT NULL,
  scale integer NOT NULL DEFAULT 1,
  source text NOT NULL DEFAULT 'nbrb',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  _deleted boolean NOT NULL DEFAULT false,
  UNIQUE (currency, date)
);

CREATE INDEX IF NOT EXISTS idx_currency_rates_sync_updated ON currency_rates_sync (updated_at);
CREATE INDEX IF NOT EXISTS idx_currency_rates_sync_date ON currency_rates_sync (date DESC);
CREATE INDEX IF NOT EXISTS idx_currency_rates_sync_currency_date ON currency_rates_sync (currency, date DESC);

ALTER TABLE currency_rates_sync ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read currency rates" ON currency_rates_sync;
CREATE POLICY "Authenticated read currency rates"
  ON currency_rates_sync
  FOR SELECT
  TO authenticated
  USING (true);
