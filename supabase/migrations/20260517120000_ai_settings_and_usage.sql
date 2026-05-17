-- AI features: per-room model selection and per-user rate-limit log.
-- Additive-only per project rules.

-- Per-room AI settings: toggle + selected OpenRouter models for each pipeline pass.
CREATE TABLE IF NOT EXISTS room_ai_settings (
  room_id uuid PRIMARY KEY REFERENCES rooms(id) ON DELETE CASCADE,
  ai_enabled boolean NOT NULL DEFAULT false,
  model_extract text,
  model_validate text,
  model_escalate text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE room_ai_settings ENABLE ROW LEVEL SECURITY;

-- Any member of the current room (room_id in JWT) can read and upsert.
CREATE POLICY "room_ai_settings_select"
  ON room_ai_settings FOR SELECT TO authenticated
  USING (room_id = (auth.jwt() ->> 'room_id')::uuid);

CREATE POLICY "room_ai_settings_insert"
  ON room_ai_settings FOR INSERT TO authenticated
  WITH CHECK (room_id = (auth.jwt() ->> 'room_id')::uuid);

CREATE POLICY "room_ai_settings_update"
  ON room_ai_settings FOR UPDATE TO authenticated
  USING (room_id = (auth.jwt() ->> 'room_id')::uuid)
  WITH CHECK (room_id = (auth.jwt() ->> 'room_id')::uuid);

-- Per-call usage log used for rate-limiting and future cost stats.
-- Writes are performed only by the Edge Function via service role; clients
-- may read their own rows.
CREATE TABLE IF NOT EXISTS ai_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id uuid,
  function_name text NOT NULL,
  model text,
  pass text,
  cost_usd numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user_created
  ON ai_usage_log (user_id, created_at DESC);

ALTER TABLE ai_usage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_usage_log_select_own"
  ON ai_usage_log FOR SELECT TO authenticated
  USING ((user_id)::text = ((auth.jwt() -> 'user_metadata') ->> 'user_db_id'));
