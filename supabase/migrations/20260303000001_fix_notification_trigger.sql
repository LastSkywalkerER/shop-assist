-- Fix notification trigger to only fire on new item inserts, not on status changes.
-- When an item is soft-deleted, remove it from the active notification queue.
CREATE OR REPLACE FUNCTION handle_shopping_list_sync_change()
RETURNS TRIGGER AS $$
DECLARE
  five_min_ago TIMESTAMPTZ := NOW() - INTERVAL '5 minutes';
  existing_count INT;
  is_new_task BOOLEAN := false;
  remaining_items JSONB;
BEGIN
  -- Case 1: Soft-delete transition — remove this item from the queue if present
  IF TG_OP = 'UPDATE' AND NEW._deleted = true AND OLD._deleted = false THEN
    SELECT
      COALESCE(
        (SELECT jsonb_agg(elem)
         FROM jsonb_array_elements(nq.items) AS elem
         WHERE elem #>> '{}' <> NEW.name),
        '[]'::jsonb
      )
    INTO remaining_items
    FROM notification_queue nq
    WHERE nq.room_id = NEW.room_id AND nq.type = 'shopping_list_update';

    IF remaining_items IS NOT NULL THEN
      IF jsonb_array_length(remaining_items) = 0 THEN
        DELETE FROM notification_queue
        WHERE room_id = NEW.room_id AND type = 'shopping_list_update';
      ELSE
        UPDATE notification_queue
        SET items = remaining_items, last_updated_at = NOW()
        WHERE room_id = NEW.room_id AND type = 'shopping_list_update';
      END IF;
    END IF;

    RETURN NULL;
  END IF;

  -- Case 2: Any other UPDATE (done toggle, name edit, etc.) — ignore
  IF TG_OP = 'UPDATE' THEN
    RETURN NULL;
  END IF;

  -- Case 3: INSERT — only notify for non-deleted items
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

-- Recreate trigger (same DDL — INSERT OR UPDATE still needed to catch soft-deletes)
DROP TRIGGER IF EXISTS on_shopping_list_item_sync_change ON shopping_list_items_sync;
CREATE TRIGGER on_shopping_list_item_sync_change
AFTER INSERT OR UPDATE ON shopping_list_items_sync
FOR EACH ROW EXECUTE FUNCTION handle_shopping_list_sync_change();
