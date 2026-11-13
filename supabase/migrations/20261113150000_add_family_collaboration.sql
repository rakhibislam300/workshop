-- Phase 1: upgrade the single-account workspace into family-scoped collaboration.
-- This migration preserves legacy rows by creating one owner family per existing account,
-- then backfilling every existing local profile, task, bill, and appointment.

create type public.family_role as enum ('owner', 'admin', 'member');

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.family_memberships (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.family_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table public.family_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  invited_email text not null check (char_length(trim(invited_email)) between 3 and 320),
  token_hash text not null unique check (char_length(token_hash) = 64),
  invited_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'accepted') = (accepted_at is not null)),
  check ((status = 'accepted') = (accepted_by is not null))
);

create unique index family_invitations_one_pending_email_idx
  on public.family_invitations (family_id, lower(invited_email))
  where status = 'pending';

create table public.family_activity (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (char_length(trim(action)) between 1 and 80),
  entity_type text not null check (char_length(trim(entity_type)) between 1 and 60),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create index family_memberships_user_family_idx on public.family_memberships (user_id, family_id);
create index family_memberships_family_role_idx on public.family_memberships (family_id, role);
create index family_invitations_family_status_idx on public.family_invitations (family_id, status, expires_at);
create index family_activity_family_created_idx on public.family_activity (family_id, created_at desc);

alter table public.family_members add column family_id uuid;
alter table public.tasks add column family_id uuid;
alter table public.bills add column family_id uuid;
alter table public.appointments add column family_id uuid;

-- Include every account represented by legacy data, including a historical account
-- whose profile trigger may have been unavailable at creation time.
with legacy_users as (
  select id as user_id, nullif(trim(display_name), '') as display_name from public.profiles
  union
  select user_id, null from public.family_members
  union
  select user_id, null from public.tasks
  union
  select user_id, null from public.bills
  union
  select user_id, null from public.appointments
), normalized_users as (
  select user_id, max(display_name) as display_name from legacy_users group by user_id
)
insert into public.families (name, created_by)
select left(coalesce(display_name, 'My') || '''s household', 120), user_id
from normalized_users;

insert into public.family_memberships (family_id, user_id, role)
select id, created_by, 'owner'::public.family_role from public.families;

update public.family_members item set family_id = family.id
from public.families family where family.created_by = item.user_id;
update public.tasks item set family_id = family.id
from public.families family where family.created_by = item.user_id;
update public.bills item set family_id = family.id
from public.families family where family.created_by = item.user_id;
update public.appointments item set family_id = family.id
from public.families family where family.created_by = item.user_id;

alter table public.family_members alter column family_id set not null;
alter table public.tasks alter column family_id set not null;
alter table public.bills alter column family_id set not null;
alter table public.appointments alter column family_id set not null;

alter table public.family_members
  add constraint family_members_family_id_fkey foreign key (family_id) references public.families(id) on delete cascade,
  add constraint family_members_id_family_id_key unique (id, family_id);
alter table public.tasks
  add constraint tasks_family_id_fkey foreign key (family_id) references public.families(id) on delete cascade;
alter table public.bills
  add constraint bills_family_id_fkey foreign key (family_id) references public.families(id) on delete cascade;
alter table public.appointments
  add constraint appointments_family_id_fkey foreign key (family_id) references public.families(id) on delete cascade;

alter table public.tasks drop constraint tasks_assigned_member_same_household;
alter table public.appointments drop constraint appointments_assigned_member_same_household;
drop index public.tasks_assigned_member_user_idx;
drop index public.appointments_assigned_member_user_idx;
alter table public.tasks add constraint tasks_assigned_member_same_family
  foreign key (assigned_member_id, family_id) references public.family_members(id, family_id)
  on delete set null (assigned_member_id);
alter table public.appointments add constraint appointments_assigned_member_same_family
  foreign key (assigned_member_id, family_id) references public.family_members(id, family_id)
  on delete set null (assigned_member_id);

create index family_members_family_name_idx on public.family_members (family_id, name);
create index tasks_family_due_idx on public.tasks (family_id, is_completed, due_date);
create index tasks_assigned_member_family_idx on public.tasks (assigned_member_id, family_id);
create index bills_family_due_idx on public.bills (family_id, is_paid, due_date);
create index appointments_family_at_idx on public.appointments (family_id, appointment_at);
create index appointments_assigned_member_family_idx on public.appointments (assigned_member_id, family_id);

create trigger families_updated_at before update on public.families
  for each row execute function app_private.set_updated_at();
create trigger family_memberships_updated_at before update on public.family_memberships
  for each row execute function app_private.set_updated_at();
create trigger family_invitations_updated_at before update on public.family_invitations
  for each row execute function app_private.set_updated_at();

create function app_private.has_family_access(p_family_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.family_memberships membership
      where membership.family_id = p_family_id
        and membership.user_id = (select auth.uid())
    );
$$;

create function app_private.has_family_role(p_family_id uuid, p_roles public.family_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and exists (
      select 1 from public.family_memberships membership
      where membership.family_id = p_family_id
        and membership.user_id = (select auth.uid())
        and membership.role = any(p_roles)
    );
$$;

-- Keep legacy user_id as an immutable creator/audit field after family scoping.
create function app_private.prevent_legacy_owner_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'The original creator cannot be changed';
  end if;
  return new;
end;
$$;

create trigger family_members_creator_immutable before update on public.family_members
  for each row execute function app_private.prevent_legacy_owner_change();
create trigger tasks_creator_immutable before update on public.tasks
  for each row execute function app_private.prevent_legacy_owner_change();
create trigger bills_creator_immutable before update on public.bills
  for each row execute function app_private.prevent_legacy_owner_change();
create trigger appointments_creator_immutable before update on public.appointments
  for each row execute function app_private.prevent_legacy_owner_change();

create function app_private.log_family_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  source_row jsonb;
  source_family_id uuid;
  source_id uuid;
begin
  source_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  source_family_id := (source_row ->> 'family_id')::uuid;
  source_id := (source_row ->> 'id')::uuid;
  insert into public.family_activity (family_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (source_family_id, (select auth.uid()), lower(tg_op), tg_table_name, source_id, '{}'::jsonb);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger family_members_activity after insert or update or delete on public.family_members
  for each row execute function app_private.log_family_activity();
create trigger tasks_activity after insert or update or delete on public.tasks
  for each row execute function app_private.log_family_activity();
create trigger bills_activity after insert or update or delete on public.bills
  for each row execute function app_private.log_family_activity();
create trigger appointments_activity after insert or update or delete on public.appointments
  for each row execute function app_private.log_family_activity();

-- Public RPCs are intentionally small, explicit authority boundaries. They are
-- protected by an authenticated caller, validate their arguments, and re-check
-- all relevant permission and invitation conditions within PostgreSQL.
create function public.create_family(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  new_family_id uuid;
  actor_id uuid := (select auth.uid());
  clean_name text := trim(coalesce(p_name, ''));
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if char_length(clean_name) not between 1 and 120 then
    raise exception 'Family name must be between 1 and 120 characters';
  end if;
  insert into public.families (name, created_by) values (clean_name, actor_id) returning id into new_family_id;
  insert into public.family_memberships (family_id, user_id, role) values (new_family_id, actor_id, 'owner');
  insert into public.family_activity (family_id, actor_user_id, action, entity_type, entity_id)
    values (new_family_id, actor_id, 'created', 'family', new_family_id);
  return new_family_id;
end;
$$;

create function public.accept_family_invitation(p_token uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  invitation public.family_invitations%rowtype;
  actor_id uuid := (select auth.uid());
  actor_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  select * into invitation from public.family_invitations
    where token_hash = encode(extensions.digest(p_token::text, 'sha256'), 'hex')
      and status = 'pending'
      and expires_at > now()
    for update;
  if not found then raise exception 'This invitation is invalid, expired, or already used'; end if;
  if actor_email = '' or lower(invitation.invited_email) <> actor_email then
    raise exception 'Sign in with the email address that received this invitation';
  end if;
  insert into public.family_memberships (family_id, user_id, role)
    values (invitation.family_id, actor_id, 'member')
    on conflict (family_id, user_id) do nothing;
  update public.family_invitations
    set status = 'accepted', accepted_by = actor_id, accepted_at = now()
    where id = invitation.id;
  insert into public.family_activity (family_id, actor_user_id, action, entity_type, entity_id)
    values (invitation.family_id, actor_id, 'accepted', 'invitation', invitation.id);
  return invitation.family_id;
end;
$$;

revoke all on function app_private.has_family_access(uuid) from public;
revoke all on function app_private.has_family_role(uuid, public.family_role[]) from public;
revoke all on function app_private.prevent_legacy_owner_change() from public;
revoke all on function app_private.log_family_activity() from public;
grant usage on schema app_private to authenticated;
grant execute on function app_private.has_family_access(uuid) to authenticated;
grant execute on function app_private.has_family_role(uuid, public.family_role[]) to authenticated;
revoke all on function public.create_family(text) from public;
revoke all on function public.accept_family_invitation(uuid) from public;
grant execute on function public.create_family(text) to authenticated;
grant execute on function public.accept_family_invitation(uuid) to authenticated;

revoke all on public.families, public.family_memberships, public.family_invitations, public.family_activity from anon, authenticated;
grant select, update on public.families to authenticated;
grant select on public.family_memberships, public.family_activity to authenticated;
grant select, insert, delete on public.family_invitations to authenticated;
grant select, insert, update, delete on public.family_members, public.tasks, public.bills, public.appointments to authenticated;

alter table public.families enable row level security;
alter table public.family_memberships enable row level security;
alter table public.family_invitations enable row level security;
alter table public.family_activity enable row level security;

drop policy family_select_own on public.family_members;
drop policy family_insert_own on public.family_members;
drop policy family_update_own on public.family_members;
drop policy family_delete_own on public.family_members;
drop policy tasks_select_own on public.tasks;
drop policy tasks_insert_own on public.tasks;
drop policy tasks_update_own on public.tasks;
drop policy tasks_delete_own on public.tasks;
drop policy bills_select_own on public.bills;
drop policy bills_insert_own on public.bills;
drop policy bills_update_own on public.bills;
drop policy bills_delete_own on public.bills;
drop policy appointments_select_own on public.appointments;
drop policy appointments_insert_own on public.appointments;
drop policy appointments_update_own on public.appointments;
drop policy appointments_delete_own on public.appointments;

create policy families_select_member on public.families for select to authenticated
  using ((select app_private.has_family_access(id)));
create policy families_update_owner on public.families for update to authenticated
  using ((select app_private.has_family_role(id, array['owner']::public.family_role[])))
  with check ((select app_private.has_family_role(id, array['owner']::public.family_role[])));
create policy family_memberships_select_member on public.family_memberships for select to authenticated
  using ((select app_private.has_family_access(family_id)));
create policy family_invitations_select_admin on public.family_invitations for select to authenticated
  using ((select app_private.has_family_role(family_id, array['owner', 'admin']::public.family_role[])));
create policy family_invitations_insert_admin on public.family_invitations for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and (select app_private.has_family_role(family_id, array['owner', 'admin']::public.family_role[]))
  );
create policy family_invitations_delete_admin on public.family_invitations for delete to authenticated
  using ((select app_private.has_family_role(family_id, array['owner', 'admin']::public.family_role[])));
create policy family_activity_select_member on public.family_activity for select to authenticated
  using ((select app_private.has_family_access(family_id)));

create policy family_members_select_member on public.family_members for select to authenticated
  using ((select app_private.has_family_access(family_id)));
create policy family_members_insert_member on public.family_members for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy family_members_update_member on public.family_members for update to authenticated
  using ((select app_private.has_family_access(family_id)))
  with check ((select app_private.has_family_access(family_id)));
create policy family_members_delete_member on public.family_members for delete to authenticated
  using ((select app_private.has_family_access(family_id)));

create policy tasks_select_member on public.tasks for select to authenticated
  using ((select app_private.has_family_access(family_id)));
create policy tasks_insert_member on public.tasks for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy tasks_update_member on public.tasks for update to authenticated
  using ((select app_private.has_family_access(family_id)))
  with check ((select app_private.has_family_access(family_id)));
create policy tasks_delete_member on public.tasks for delete to authenticated
  using ((select app_private.has_family_access(family_id)));

create policy bills_select_member on public.bills for select to authenticated
  using ((select app_private.has_family_access(family_id)));
create policy bills_insert_member on public.bills for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy bills_update_member on public.bills for update to authenticated
  using ((select app_private.has_family_access(family_id)))
  with check ((select app_private.has_family_access(family_id)));
create policy bills_delete_member on public.bills for delete to authenticated
  using ((select app_private.has_family_access(family_id)));

create policy appointments_select_member on public.appointments for select to authenticated
  using ((select app_private.has_family_access(family_id)));
create policy appointments_insert_member on public.appointments for insert to authenticated
  with check (user_id = (select auth.uid()) and (select app_private.has_family_access(family_id)));
create policy appointments_update_member on public.appointments for update to authenticated
  using ((select app_private.has_family_access(family_id)))
  with check ((select app_private.has_family_access(family_id)));
create policy appointments_delete_member on public.appointments for delete to authenticated
  using ((select app_private.has_family_access(family_id)));
