-- Each account can see its own files in doc-pictures (Luke's OK in chat, 2026-11-13: "Yes, add it").
--
-- Why: Supabase removes only a file the account can see under the storage rules, and nothing let an account see its own
-- doc pictures (the bucket is public, so reading a picture by its address never needed a rule). Removal therefore found
-- nothing and quietly did nothing: deleting a document left its pictures behind. With this, a document's owner frees
-- their own pictures when they delete it, and the delete rule already in place ("doc pictures removed by their filer")
-- finally has rows to act on. Nobody sees anybody else's files through this; the pictures were already public by address.
--
-- The rule reads only the row's own columns: never storage.objects itself (20261113032500_doc_pictures_upload_rule.sql
-- says why). Re-runnable: dropped and recreated by name.

drop policy if exists "doc pictures seen by their filer" on storage.objects;
create policy "doc pictures seen by their filer" on storage.objects
  for select to authenticated
  using (bucket_id = 'doc-pictures' and owner_id = (auth.uid())::text);
