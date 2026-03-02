-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Notification queue table
-- Tracks pending notifications per room. One active task per (room_id, type).
CREATE TABLE IF NOT EXISTS notification_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'shopping_list_update',
  items JSONB NOT NULL DEFAULT '[]',
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  immediate_sent BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(room_id, type)
);

-- RLS enabled with no policies: only service role (edge function) can access
ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;

-- Trigger function: called when a shopping list item is inserted/updated in Supabase.
-- On the first item in a new batch (no active task in last 5 min), immediately calls
-- the send-notification edge function so the "list updated" message arrives right away.
-- Subsequent items within 5 minutes only append to the queue (cron handles 30-min summary).
CREATE OR REPLACE FUNCTION handle_shopping_list_sync_change()
RETURNS TRIGGER AS $$
DECLARE
  five_min_ago TIMESTAMPTZ := NOW() - INTERVAL '5 minutes';
  existing_count INT;
  is_new_task BOOLEAN := false;
BEGIN
  -- Ignore soft-deleted items
  IF NEW._deleted = true THEN
    RETURN NULL;
  END IF;

  -- Check if there's an active task updated within the last 5 minutes
  SELECT COUNT(*) INTO existing_count
  FROM notification_queue
  WHERE room_id = NEW.room_id
    AND type = 'shopping_list_update'
    AND last_updated_at >= five_min_ago;

  IF existing_count > 0 THEN
    -- Append item name to existing task (no new notification needed)
    UPDATE notification_queue
    SET
      items = items || jsonb_build_array(NEW.name),
      last_updated_at = NOW()
    WHERE room_id = NEW.room_id AND type = 'shopping_list_update';
  ELSE
    -- Create new task or replace an expired one
    INSERT INTO notification_queue (room_id, type, items, immediate_sent, created_at, last_updated_at)
    VALUES (NEW.room_id, 'shopping_list_update', jsonb_build_array(NEW.name), false, NOW(), NOW())
    ON CONFLICT (room_id, type) DO UPDATE
      SET
        items = jsonb_build_array(NEW.name),
        immediate_sent = false,
        created_at = NOW(),
        last_updated_at = NOW();
    is_new_task := true;
  END IF;

  -- Immediately call edge function for new tasks (don't wait for cron)
  IF is_new_task THEN
    PERFORM net.http_post(
      url := 'https://lmdjawmxlxpecxrnkyis.supabase.co/functions/v1/send-notification',
      body := '{"action":"process_queue"}'::jsonb,
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtZGphd214bHhwZWN4cm5reWlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTI0MTg0MywiZXhwIjoyMDg2ODE3ODQzfQ.RwSAM062G76gGiKchgQzEzV-g_JnKkzS6arcbznMqsQ"}'::jsonb
    );
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_shopping_list_item_sync_change
AFTER INSERT OR UPDATE ON shopping_list_items_sync
FOR EACH ROW EXECUTE FUNCTION handle_shopping_list_sync_change();

-- pg_cron: process notification queue every 5 minutes
-- IMPORTANT: Replace {{SUPABASE_URL}} and {{SERVICE_ROLE_KEY}} with actual values before applying.
-- The SERVICE_ROLE_KEY can be found in Supabase dashboard → Project Settings → API.
-- Example:
--   SELECT cron.schedule(
--     'process-notification-queue',
--     '*/5 * * * *',
--     $$
--     SELECT extensions.http_post(
--       'https://abcdefgh.supabase.co/functions/v1/send-notification',
--       '{"action":"process_queue"}',
--       'application/json',
--       '{"Authorization":"Bearer eyJhbGc..."}'
--     );
--     $$
--   );
