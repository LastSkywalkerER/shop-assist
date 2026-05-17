-- Per-user notification channel preferences.
-- Defaults to true so that anyone with a working channel keeps receiving messages.
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_via_pwa boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_via_telegram boolean NOT NULL DEFAULT true;

-- Web Push subscriptions. One row per browser/device the user has subscribed from.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Mirrors the user_db_id pattern from room_memberships RLS.
CREATE POLICY "User manages own subscriptions"
  ON push_subscriptions FOR ALL TO authenticated
  USING ((user_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'user_db_id'))
  WITH CHECK ((user_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'user_db_id'));
