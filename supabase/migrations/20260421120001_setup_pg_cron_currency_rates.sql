-- Schedule fetch-nbrb-rates edge function every weekday at 15:00 Minsk time.
-- Minsk is UTC+3 year-round (no DST), so 15:00 Minsk = 12:00 UTC → cron "0 12 * * 1-5".
--
-- Idempotent: unschedules any prior job with the same name before scheduling.
-- The SERVICE_ROLE_KEY below is the service_role JWT for project lmdjawmxlxpecxrnkyis
-- (same key used in 20260302000002_setup_pg_cron_notification.sql).

SELECT cron.unschedule('fetch-nbrb-currency-rates')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'fetch-nbrb-currency-rates'
);

SELECT cron.schedule(
  'fetch-nbrb-currency-rates',
  '0 12 * * 1-5',
  $$
  SELECT net.http_post(
    url := 'https://lmdjawmxlxpecxrnkyis.supabase.co/functions/v1/fetch-nbrb-rates',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtZGphd214bHhwZWN4cm5reWlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTI0MTg0MywiZXhwIjoyMDg2ODE3ODQzfQ.RwSAM062G76gGiKchgQzEzV-g_JnKkzS6arcbznMqsQ"}'::jsonb
  );
  $$
);
