-- Phase 1 follow-up: owner-controlled roles/removal and family-visible display names.

drop policy profile_select_own on public.profiles;
create policy profile_select_own_or_family on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.family_memberships membership
      where membership.user_id = profiles.id
        and (select app_private.has_family_access(membership.family_id))
    )
  );

create function public.update_family_member_role(p_family_id uuid, p_user_id uuid, p_role public.family_role)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  current_role public.family_role;
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if not (select app_private.has_family_role(p_family_id, array['owner']::public.family_role[])) then
    raise exception 'Only a family owner can change roles';
  end if;
  if p_user_id = actor_id then raise exception 'An owner cannot change their own role'; end if;
  select role into current_role from public.family_memberships
    where family_id = p_family_id and user_id = p_user_id for update;
  if not found then raise exception 'This collaborator is not in the family'; end if;
  if current_role = 'owner' and p_role <> 'owner' and (
    select count(*) from public.family_memberships where family_id = p_family_id and role = 'owner'
  ) <= 1 then raise exception 'Every family needs at least one owner'; end if;
  update public.family_memberships set role = p_role where family_id = p_family_id and user_id = p_user_id;
  insert into public.family_activity (family_id, actor_user_id, action, entity_type, metadata)
    values (p_family_id, actor_id, 'updated_role', 'collaborator', jsonb_build_object('member_user_id', p_user_id, 'role', p_role));
end;
$$;

create function public.remove_family_collaborator(p_family_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  target_role public.family_role;
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if not (select app_private.has_family_role(p_family_id, array['owner']::public.family_role[])) then
    raise exception 'Only a family owner can remove a collaborator';
  end if;
  if p_user_id = actor_id then raise exception 'An owner cannot remove themselves'; end if;
  select role into target_role from public.family_memberships
    where family_id = p_family_id and user_id = p_user_id for update;
  if not found then raise exception 'This collaborator is not in the family'; end if;
  if target_role = 'owner' and (
    select count(*) from public.family_memberships where family_id = p_family_id and role = 'owner'
  ) <= 1 then raise exception 'Every family needs at least one owner'; end if;
  delete from public.family_memberships where family_id = p_family_id and user_id = p_user_id;
  insert into public.family_activity (family_id, actor_user_id, action, entity_type, metadata)
    values (p_family_id, actor_id, 'removed', 'collaborator', jsonb_build_object('member_user_id', p_user_id));
end;
$$;

revoke all on function public.update_family_member_role(uuid, uuid, public.family_role) from public, anon;
revoke all on function public.remove_family_collaborator(uuid, uuid) from public, anon;
grant execute on function public.update_family_member_role(uuid, uuid, public.family_role) to authenticated;
grant execute on function public.remove_family_collaborator(uuid, uuid) to authenticated;
