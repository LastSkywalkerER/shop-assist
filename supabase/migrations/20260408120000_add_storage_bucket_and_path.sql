-- Create a private Storage bucket for synced attachment files.
-- 10 MB max per object; all mime types allowed (UI restricts to images).
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('sync-attachments', 'sync-attachments', false, 10485760)
ON CONFLICT (id) DO NOTHING;

-- RLS on storage.objects: authenticated users can manage files under their room_id prefix.
-- Path convention: {room_id}/expense_attachments/{id} or {room_id}/purchase_attachments/{id}

CREATE POLICY "Room members can read attachments"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'sync-attachments'
  AND (storage.foldername(name))[1] = ((auth.jwt() -> 'user_metadata') ->> 'room_id')
);

CREATE POLICY "Room members can upload attachments"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'sync-attachments'
  AND (storage.foldername(name))[1] = ((auth.jwt() -> 'user_metadata') ->> 'room_id')
);

CREATE POLICY "Room members can update attachments"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'sync-attachments'
  AND (storage.foldername(name))[1] = ((auth.jwt() -> 'user_metadata') ->> 'room_id')
)
WITH CHECK (
  bucket_id = 'sync-attachments'
  AND (storage.foldername(name))[1] = ((auth.jwt() -> 'user_metadata') ->> 'room_id')
);

CREATE POLICY "Room members can delete attachments"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'sync-attachments'
  AND (storage.foldername(name))[1] = ((auth.jwt() -> 'user_metadata') ->> 'room_id')
);

-- Add storage_path column to both attachment sync tables (nullable, additive only).
ALTER TABLE expense_attachments_sync ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE purchase_attachments_sync ADD COLUMN IF NOT EXISTS storage_path text;

-- Add metadata columns to purchase_attachments_sync (expense already has them).
ALTER TABLE purchase_attachments_sync ADD COLUMN IF NOT EXISTS file_name text;
ALTER TABLE purchase_attachments_sync ADD COLUMN IF NOT EXISTS mime_type text;
ALTER TABLE purchase_attachments_sync ADD COLUMN IF NOT EXISTS size integer;
