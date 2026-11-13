-- Phase 2: bounded, per-user AI request audit and rate limiting.
-- Prompt text and household context are intentionally never persisted here.

create table public.family_ai_requests (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  prompt_length integer not null check (prompt_length between 1 and 1200),
  created_at timestamptz not null default now()
);

create index family_ai_requests_actor_family_created_idx
  on public.family_ai_requests (actor_user_id, family_id, created_at desc);

alter table public.family_ai_requests enable row level security;
revoke all on public.family_ai_requests from anon, authenticated;

-- Owners and admins may audit only their own family's AI-request metadata.
grant select on public.family_ai_requests to authenticated;
create policy family_ai_requests_select_privileged on public.family_ai_requests
  for select to authenticated
  using ((select app_private.has_family_role(family_id, array['owner', 'admin']::public.family_role[])));

-- This is the only write path. It re-checks membership in PostgreSQL and limits
-- an authenticated person to 12 requests per rolling five-minute window.
create function public.check_and_log_family_ai_request(p_family_id uuid, p_prompt_length integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  recent_requests integer;
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if p_prompt_length not between 1 and 1200 then
    raise exception 'Invalid AI request length';
  end if;
  if not (select app_private.has_family_access(p_family_id)) then
    raise exception 'You do not have access to this family';
  end if;

  select count(*) into recent_requests
    from public.family_ai_requests
    where actor_user_id = actor_id
      and family_id = p_family_id
      and created_at >= now() - interval '5 minutes';
  if recent_requests >= 12 then
    raise exception 'AI request limit reached. Please try again in a few minutes.';
  end if;

  insert into public.family_ai_requests (family_id, actor_user_id, prompt_length)
    values (p_family_id, actor_id, p_prompt_length);
end;
$$;

revoke all on function public.check_and_log_family_ai_request(uuid, integer) from public, anon;
grant execute on function public.check_and_log_family_ai_request(uuid, integer) to authenticated;
