-- Set up pg_cron schedule to process notification queue every 5 minutes.
-- This was applied manually after the initial notification_system migration
-- (which left the cron schedule as a commented-out placeholder).
--
-- NOTE: This migration is idempotent — it uses cron.unschedule to remove any
-- existing job before creating a new one, so it can be re-applied safely.
-- The SERVICE_ROLE_KEY below is the service_role JWT for project lmdjawmxlxpecxrnkyis.

SELECT cron.unschedule('process-notification-queue')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-notification-queue'
);

SELECT cron.schedule(
  'process-notification-queue',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://lmdjawmxlxpecxrnkyis.supabase.co/functions/v1/send-notification',
    body := '{"action":"process_queue"}'::jsonb,
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtZGphd214bHhwZWN4cm5reWlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTI0MTg0MywiZXhwIjoyMDg2ODE3ODQzfQ.RwSAM062G76gGiKchgQzEzV-g_JnKkzS6arcbznMqsQ"}'::jsonb
  );
  $$
);

-- Trigger: immediately call send-notification when a NEW task is inserted into notification_queue.
-- This ensures the "list updated" notification fires right away instead of waiting up to 5 min for cron.
-- The cron job still handles the 30-minute summary notification.
CREATE OR REPLACE FUNCTION notify_on_queue_insert()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://lmdjawmxlxpecxrnkyis.supabase.co/functions/v1/send-notification',
    body := '{"action":"process_queue"}'::jsonb,
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtZGphd214bHhwZWN4cm5reWlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTI0MTg0MywiZXhwIjoyMDg2ODE3ODQzfQ.RwSAM062G76gGiKchgQzEzV-g_JnKkzS6arcbznMqsQ"}'::jsonb
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_notification_queue_insert ON notification_queue;
CREATE TRIGGER on_notification_queue_insert
AFTER INSERT ON notification_queue
FOR EACH ROW EXECUTE FUNCTION notify_on_queue_insert();
