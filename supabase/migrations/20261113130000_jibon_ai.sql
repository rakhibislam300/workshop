-- Jibon AI: one secure household workspace per authenticated account.
create extension if not exists pgcrypto;
create schema if not exists app_private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.family_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  relationship text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text,
  due_date date,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  is_completed boolean not null default false,
  assigned_member_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_assigned_member_same_household
    foreign key (assigned_member_id, user_id) references public.family_members(id, user_id)
    on delete set null (assigned_member_id)
);

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  amount numeric(12,2) not null check (amount >= 0),
  category text not null default 'Other' check (char_length(trim(category)) between 1 and 60),
  due_date date not null,
  is_paid boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  appointment_at timestamptz not null,
  location text,
  assigned_member_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_assigned_member_same_household
    foreign key (assigned_member_id, user_id) references public.family_members(id, user_id)
    on delete set null (assigned_member_id)
);

create index tasks_user_due_idx on public.tasks (user_id, is_completed, due_date);
create index bills_user_due_idx on public.bills (user_id, is_paid, due_date);
create index appointments_user_at_idx on public.appointments (user_id, appointment_at);
create index family_members_user_idx on public.family_members (user_id);

create function app_private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger profiles_updated_at before update on public.profiles for each row execute function app_private.set_updated_at();
create trigger family_members_updated_at before update on public.family_members for each row execute function app_private.set_updated_at();
create trigger tasks_updated_at before update on public.tasks for each row execute function app_private.set_updated_at();
create trigger bills_updated_at before update on public.bills for each row execute function app_private.set_updated_at();
create trigger appointments_updated_at before update on public.appointments for each row execute function app_private.set_updated_at();

-- Auth signup needs elevated rights to create the matching profile; it is not client-callable.
create function app_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(trim(new.raw_user_meta_data ->> 'display_name'), ''));
  return new;
end;
$$;
revoke all on function app_private.handle_new_user() from public;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app_private.handle_new_user();

-- Lock down every exposed application table before granting only necessary app access.
revoke all on public.profiles, public.family_members, public.tasks, public.bills, public.appointments from anon, authenticated;
grant select, insert, update, delete on public.profiles, public.family_members, public.tasks, public.bills, public.appointments to authenticated;
alter table public.profiles enable row level security;
alter table public.family_members enable row level security;
alter table public.tasks enable row level security;
alter table public.bills enable row level security;
alter table public.appointments enable row level security;

create policy "profile_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profile_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = id);
create policy "profile_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "profile_delete_own" on public.profiles for delete to authenticated using ((select auth.uid()) = id);

create policy "family_select_own" on public.family_members for select to authenticated using ((select auth.uid()) = user_id);
create policy "family_insert_own" on public.family_members for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "family_update_own" on public.family_members for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "family_delete_own" on public.family_members for delete to authenticated using ((select auth.uid()) = user_id);

create policy "tasks_select_own" on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy "tasks_insert_own" on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "tasks_update_own" on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tasks_delete_own" on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);

create policy "bills_select_own" on public.bills for select to authenticated using ((select auth.uid()) = user_id);
create policy "bills_insert_own" on public.bills for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "bills_update_own" on public.bills for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "bills_delete_own" on public.bills for delete to authenticated using ((select auth.uid()) = user_id);

create policy "appointments_select_own" on public.appointments for select to authenticated using ((select auth.uid()) = user_id);
create policy "appointments_insert_own" on public.appointments for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "appointments_update_own" on public.appointments for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "appointments_delete_own" on public.appointments for delete to authenticated using ((select auth.uid()) = user_id);
