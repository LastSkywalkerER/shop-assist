-- Sync Google identity email into both public.users.email and auth.users.email
-- when the existing primary email is synthetic ({tg_id}@telegram.user) or NULL.
-- Replaces handle_new_identity to handle future link operations and backfills
-- existing rows that linked Google before this migration.

CREATE OR REPLACE FUNCTION public.handle_new_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_identity_email text;
  v_current_au_email text;
BEGIN
  IF NEW.provider = 'google' THEN
    v_identity_email := NEW.identity_data ->> 'email';

    UPDATE public.users
    SET google_id = NEW.identity_data ->> 'sub',
        avatar_url = COALESCE(avatar_url, NEW.identity_data ->> 'avatar_url', NEW.identity_data ->> 'picture'),
        display_name = COALESCE(display_name, NEW.identity_data ->> 'full_name', NEW.identity_data ->> 'name'),
        email = CASE
          WHEN (email IS NULL OR email LIKE '%@telegram.user')
            AND v_identity_email IS NOT NULL
          THEN v_identity_email
          ELSE email
        END
    WHERE auth_user_id = NEW.user_id;

    IF v_identity_email IS NOT NULL THEN
      SELECT email INTO v_current_au_email FROM auth.users WHERE id = NEW.user_id;
      IF v_current_au_email IS NULL OR v_current_au_email LIKE '%@telegram.user' THEN
        UPDATE auth.users
        SET email = v_identity_email,
            email_confirmed_at = COALESCE(email_confirmed_at, now())
        WHERE id = NEW.user_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


-- Backfill: existing rows that linked Google before this migration ran ------
UPDATE public.users pu
SET
  google_id = COALESCE(pu.google_id, i.identity_data ->> 'sub'),
  avatar_url = COALESCE(pu.avatar_url, i.identity_data ->> 'avatar_url', i.identity_data ->> 'picture'),
  display_name = COALESCE(pu.display_name, i.identity_data ->> 'full_name', i.identity_data ->> 'name'),
  email = CASE
    WHEN (pu.email IS NULL OR pu.email LIKE '%@telegram.user')
      AND (i.identity_data ->> 'email') IS NOT NULL
    THEN i.identity_data ->> 'email'
    ELSE pu.email
  END
FROM auth.identities i
WHERE i.user_id = pu.auth_user_id
  AND i.provider = 'google'
  AND (
    pu.google_id IS NULL
    OR pu.email IS NULL
    OR pu.email LIKE '%@telegram.user'
  );

UPDATE auth.users au
SET email = i.identity_data ->> 'email',
    email_confirmed_at = COALESCE(au.email_confirmed_at, now())
FROM auth.identities i
WHERE i.user_id = au.id
  AND i.provider = 'google'
  AND (au.email IS NULL OR au.email LIKE '%@telegram.user')
  AND (i.identity_data ->> 'email') IS NOT NULL;
