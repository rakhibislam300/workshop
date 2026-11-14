-- Every newly registered account needs an immediately usable household. The
-- original profile trigger predates family collaboration, so it created only a
-- profile. This migration upgrades the trigger and repairs affected accounts.
create or replace function app_private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  profile_name text := coalesce(trim(new.raw_user_meta_data ->> 'display_name'), '');
  family_name text := coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), 'My');
  initial_family_id uuid;
begin
  insert into public.profiles (id, display_name)
    values (new.id, profile_name)
    on conflict (id) do nothing;

  insert into public.families (name, created_by)
    values (left(family_name || '''s household', 120), new.id)
    returning id into initial_family_id;
  insert into public.family_memberships (family_id, user_id, role)
    values (initial_family_id, new.id, 'owner');
  insert into public.family_activity (family_id, actor_user_id, action, entity_type, entity_id)
    values (initial_family_id, new.id, 'created', 'family', initial_family_id);
  return new;
end;
$$;
revoke all on function app_private.handle_new_user() from public, anon, authenticated;

-- Backfill only accounts that have no existing workspace. Existing families,
-- memberships, and household records are untouched.
with missing_profiles as (
  select profile.id, coalesce(nullif(trim(profile.display_name), ''), 'My') as display_name
  from public.profiles profile
  where not exists (
    select 1 from public.family_memberships membership where membership.user_id = profile.id
  )
), created_families as (
  insert into public.families (name, created_by)
    select left(display_name || '''s household', 120), id from missing_profiles
    returning id, created_by
), created_memberships as (
  insert into public.family_memberships (family_id, user_id, role)
    select id, created_by, 'owner' from created_families
    returning family_id, user_id
)
insert into public.family_activity (family_id, actor_user_id, action, entity_type, entity_id)
  select family_id, user_id, 'created', 'family', family_id from created_memberships;
