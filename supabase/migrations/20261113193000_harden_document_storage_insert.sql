-- Require every uploaded object to have a caller-owned document record at the
-- exact generated path. This prevents an authenticated family member from
-- using the bucket as an untracked arbitrary-object drop location.

drop policy family_documents_insert_member on storage.objects;
create policy family_documents_insert_member on storage.objects for insert to authenticated
  with check (
    bucket_id = 'family-documents'
    and exists (
      select 1
      from public.documents document
      where document.storage_path = name
        and document.owner_user_id = (select auth.uid())
        and document.family_id::text = (storage.foldername(name))[1]
        and (select app_private.has_family_access(document.family_id))
    )
  );
