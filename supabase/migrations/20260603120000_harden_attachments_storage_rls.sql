-- Harden sync-attachments Storage RLS.
--
-- The four storage.objects policies for the `sync-attachments` bucket were the
-- last place in the attachment / OCR feature still gating access on the
-- client-editable, stale-prone `auth.jwt() -> user_metadata ->> room_id`.
-- pending_receipt_scans and the *_sync tables already use the SECURITY DEFINER
-- membership check. When a user's active room drifts from the room_id baked
-- into their JWT (e.g. a room switch that didn't refresh the token, or a
-- session restored from localStorage without reconciliation), uploads failed
-- with `new row violates row-level security policy` even though the user is a
-- member of the target room.
--
-- Fix: switch all four policies to public.is_room_member(<room_uuid>), reading
-- the room id from the first path segment ({room_id}/...). The uuid regex guard
-- keeps a malformed object name from raising on the ::uuid cast (which would
-- error the query instead of cleanly denying). This matches the recommended
-- pattern in docs/AI_FEATURE_NOTES.md and clears the Supabase linter's
-- rls_references_user_metadata warning for these policies.

DROP POLICY IF EXISTS "Room members can read attachments"   ON storage.objects;
DROP POLICY IF EXISTS "Room members can upload attachments" ON storage.objects;
DROP POLICY IF EXISTS "Room members can update attachments" ON storage.objects;
DROP POLICY IF EXISTS "Room members can delete attachments" ON storage.objects;

CREATE POLICY "Room members can read attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'sync-attachments'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND public.is_room_member(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "Room members can upload attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'sync-attachments'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND public.is_room_member(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "Room members can update attachments"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'sync-attachments'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND public.is_room_member(((storage.foldername(name))[1])::uuid)
)
WITH CHECK (
  bucket_id = 'sync-attachments'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND public.is_room_member(((storage.foldername(name))[1])::uuid)
);

CREATE POLICY "Room members can delete attachments"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'sync-attachments'
  AND (storage.foldername(name))[1] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  AND public.is_room_member(((storage.foldername(name))[1])::uuid)
);
