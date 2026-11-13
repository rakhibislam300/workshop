-- Phase 4: family-scoped private document vault.
-- Storage is private and object access is governed independently from document
-- metadata so a signed-in family member cannot enumerate or fetch private files.

create type public.document_visibility as enum ('private', 'family');
create type public.document_category as enum ('identity', 'medical', 'finance', 'home', 'education', 'other');

create table public.documents (
  id uuid primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  category public.document_category not null default 'other',
  visibility public.document_visibility not null default 'private',
  original_filename text not null check (char_length(trim(original_filename)) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'text/plain')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  storage_path text not null unique check (char_length(storage_path) between 1 and 1024),
  preview_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index documents_family_created_idx on public.documents (family_id, created_at desc);
create index documents_owner_created_idx on public.documents (owner_user_id, created_at desc);
create index documents_family_category_created_idx on public.documents (family_id, category, created_at desc);

create trigger documents_updated_at before update on public.documents
  for each row execute function app_private.set_updated_at();
create trigger documents_activity after insert or update or delete on public.documents
  for each row execute function app_private.log_family_activity();

revoke all on public.documents from anon, authenticated;
grant select, insert, delete on public.documents to authenticated;
alter table public.documents enable row level security;

-- A family-visible document may be read by every current family member. Private
-- documents remain visible only to their uploader, even when the uploader is a
-- member of several families.
create policy documents_select_authorized on public.documents for select to authenticated
  using (
    owner_user_id = (select auth.uid())
    or (visibility = 'family' and (select app_private.has_family_access(family_id)))
  );
create policy documents_insert_owner on public.documents for insert to authenticated
  with check (
    owner_user_id = (select auth.uid())
    and (select app_private.has_family_access(family_id))
  );
create policy documents_delete_owner on public.documents for delete to authenticated
  using (owner_user_id = (select auth.uid()));

-- Supabase Storage is private by default. The bucket also enforces a modest
-- size/type allowlist in depth; the protected upload route repeats validation.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'family-documents',
  'family-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'text/plain']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Paths are generated only by the server route as family-id/document-id/file.
-- The first folder check keeps object creation inside a family the caller is in.
create policy family_documents_insert_member on storage.objects for insert to authenticated
  with check (
    bucket_id = 'family-documents'
    and (storage.foldername(name))[1] in (
      select membership.family_id::text
      from public.family_memberships membership
      where membership.user_id = (select auth.uid())
    )
  );

-- File reads and short-lived signed URLs require the same visibility rule as
-- metadata. There is deliberately no bucket-wide list policy.
create policy family_documents_select_authorized on storage.objects for select to authenticated
  using (
    bucket_id = 'family-documents'
    and exists (
      select 1
      from public.documents document
      where document.storage_path = name
        and (
          document.owner_user_id = (select auth.uid())
          or (document.visibility = 'family' and (select app_private.has_family_access(document.family_id)))
        )
    )
  );

-- Only the uploader can remove the source or a future derived preview. The
-- application deletes objects first, then deletes metadata so this predicate is
-- still available during cleanup.
create policy family_documents_delete_owner on storage.objects for delete to authenticated
  using (
    bucket_id = 'family-documents'
    and exists (
      select 1 from public.documents document
      where (document.storage_path = name or document.preview_path = name)
        and document.owner_user_id = (select auth.uid())
    )
  );
