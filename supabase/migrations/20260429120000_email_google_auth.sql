-- Email + Google OAuth support for the existing Telegram-only users table.
-- Additive migration: columns, partial unique indexes, NOT NULL relaxations,
-- triggers on auth.users / auth.identities to bootstrap public.users + personal room,
-- and RPCs the client uses to obtain and synchronise account context after sign-in.

-- 1. Columns and indexes -----------------------------------------------------

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS google_id text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url text;

ALTER TABLE public.users ALTER COLUMN telegram_id DROP NOT NULL;
ALTER TABLE public.users ALTER COLUMN auth_date DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
  ON public.users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id_unique
  ON public.users (google_id) WHERE google_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id_unique
  ON public.users (auth_user_id) WHERE auth_user_id IS NOT NULL;


-- 2. Trigger: bootstrap public.users + personal room for new auth users -----
-- Skips Telegram synthetic emails (handled by telegram-auth Edge Function)
-- and is idempotent: skips if a public.users row already references this auth user.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_room_id uuid;
  v_email text := NEW.email;
  v_display_name text;
  v_avatar_url text;
BEGIN
  IF v_email IS NOT NULL AND v_email LIKE '%@telegram.user' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.users WHERE auth_user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  v_display_name := COALESCE(
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'name',
    NEW.raw_user_meta_data ->> 'display_name',
    NULLIF(split_part(COALESCE(v_email, ''), '@', 1), '')
  );
  v_avatar_url := COALESCE(
    NEW.raw_user_meta_data ->> 'avatar_url',
    NEW.raw_user_meta_data ->> 'picture'
  );

  INSERT INTO public.users (auth_user_id, email, display_name, avatar_url)
  VALUES (NEW.id, v_email, v_display_name, v_avatar_url)
  RETURNING id INTO v_user_id;

  INSERT INTO public.rooms (name, owner_id, is_personal)
  VALUES ('Personal', v_user_id, true)
  RETURNING id INTO v_room_id;

  INSERT INTO public.room_memberships (room_id, user_id, role)
  VALUES (v_room_id, v_user_id, 'owner');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 3. Trigger: capture Google identity sub/avatar/display when a Google ------
-- identity is added (initial Google sign-in or linkIdentity from any provider).

CREATE OR REPLACE FUNCTION public.handle_new_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.provider = 'google' THEN
    UPDATE public.users
    SET google_id = NEW.identity_data ->> 'sub',
        avatar_url = COALESCE(avatar_url, NEW.identity_data ->> 'avatar_url', NEW.identity_data ->> 'picture'),
        display_name = COALESCE(display_name, NEW.identity_data ->> 'full_name', NEW.identity_data ->> 'name')
    WHERE auth_user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_identity_created ON auth.identities;
CREATE TRIGGER on_auth_identity_created
AFTER INSERT ON auth.identities
FOR EACH ROW EXECUTE FUNCTION public.handle_new_identity();


-- 4. RPC: get_my_account_context --------------------------------------------
-- Returns { user, personal_room_id, rooms } for the current auth user.
-- SECURITY DEFINER so the client can call it before user_metadata.user_db_id is set.

CREATE OR REPLACE FUNCTION public.get_my_account_context()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_user public.users%ROWTYPE;
  v_personal_room_id uuid;
  v_rooms jsonb;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_user FROM public.users WHERE auth_user_id = v_auth_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user row missing for auth user %', v_auth_uid;
  END IF;

  SELECT id INTO v_personal_room_id
  FROM public.rooms
  WHERE owner_id = v_user.id AND is_personal = true
  LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object(
    'id', r.id,
    'name', r.name,
    'is_personal', r.is_personal,
    'owner_id', r.owner_id,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'role', m.role
  ))
  INTO v_rooms
  FROM public.rooms r
  JOIN public.room_memberships m ON m.room_id = r.id
  WHERE m.user_id = v_user.id;

  RETURN jsonb_build_object(
    'user', to_jsonb(v_user),
    'personal_room_id', v_personal_room_id,
    'rooms', COALESCE(v_rooms, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_account_context() TO authenticated;


-- 5. RPC: sync_account_email ------------------------------------------------
-- Copies a real email from auth.users to public.users, skipping the synthetic
-- telegram email pattern. Used after a TG user attaches a real email/password.

CREATE OR REPLACE FUNCTION public.sync_account_email()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_auth_email text;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT email INTO v_auth_email FROM auth.users WHERE id = v_auth_uid;

  IF v_auth_email IS NULL OR v_auth_email LIKE '%@telegram.user' THEN
    RETURN;
  END IF;

  UPDATE public.users
  SET email = v_auth_email
  WHERE auth_user_id = v_auth_uid
    AND (email IS NULL OR lower(email) <> lower(v_auth_email));
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_account_email() TO authenticated;


-- 6. Lock down callability ---------------------------------------------------
-- Trigger helpers must not be invokable via PostgREST.
-- RPCs should only be callable by authenticated users.

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_identity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_my_account_context() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_account_email() FROM PUBLIC, anon;
