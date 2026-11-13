-- Phase 5: durable, family-scoped document intelligence records.
-- Source-document deletion cascades immediately delete all extracted/derived data.

create type public.document_intelligence_status as enum ('queued', 'processing', 'ready', 'failed');

create table public.document_intelligence (
  document_id uuid primary key references public.documents(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  status public.document_intelligence_status not null default 'queued',
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 3),
  next_attempt_at timestamptz not null default now(),
  extracted_text text check (extracted_text is null or char_length(extracted_text) <= 60000),
  summary text check (summary is null or char_length(summary) <= 2400),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  expiry_date date,
  processor_model text,
  error_message text check (error_message is null or char_length(error_message) <= 500),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'ready') = (processed_at is not null))
);

create index document_intelligence_family_expiry_idx
  on public.document_intelligence (family_id, expiry_date)
  where expiry_date is not null;
create index document_intelligence_owner_idx
  on public.document_intelligence (owner_user_id);
create index document_intelligence_pending_idx
  on public.document_intelligence (next_attempt_at, created_at)
  where status = 'queued';

create trigger document_intelligence_updated_at before update on public.document_intelligence
  for each row execute function app_private.set_updated_at();

revoke all on public.document_intelligence from anon, authenticated;
grant select, insert on public.document_intelligence to authenticated;
alter table public.document_intelligence enable row level security;

-- Derived text follows the visibility of its source document. This deliberately
-- repeats the document policy rather than trusting an unscoped family_id alone.
create policy document_intelligence_select_authorized on public.document_intelligence for select to authenticated
  using (
    exists (
      select 1 from public.documents document
      where document.id = document_id
        and (
          document.owner_user_id = (select auth.uid())
          or (document.visibility = 'family' and (select app_private.has_family_access(document.family_id)))
        )
    )
  );

-- A signed-in owner can enqueue only an empty, initial job for their own source.
-- All state transitions and derived content writes happen in the protected
-- server worker using a server-only service-role credential.
create policy document_intelligence_insert_owner_queue on public.document_intelligence for insert to authenticated
  with check (
    owner_user_id = (select auth.uid())
    and status = 'queued'
    and attempts = 0
    and extracted_text is null
    and summary is null
    and metadata = '{}'::jsonb
    and expiry_date is null
    and processor_model is null
    and error_message is null
    and processed_at is null
    and exists (
      select 1 from public.documents document
      where document.id = document_id
        and document.family_id = family_id
        and document.owner_user_id = (select auth.uid())
    )
  );
