-- Acceptance is atomic: stale authority or an unavailable relationship anchor
-- must fail before granting membership. Keep legacy context-free invites valid.
create or replace function app_private.complete_relationship_aware_family_invitation(
  p_invitation public.family_invitations, p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  person_id uuid;
  account_profile public.profiles%rowtype;
  proposed_parent uuid;
  proposed_child uuid;
  already_linked boolean := false;
  parents constant text[] := array['parent','father','mother','adoptive_parent','step_parent','guardian'];
  children constant text[] := array['child','son','daughter'];
  partners constant text[] := array['partner','spouse','husband','wife'];
  siblings constant text[] := array['sibling','brother','sister'];
begin
  if p_actor_id is null or p_actor_id is distinct from auth.uid() then raise exception 'Authentication is required'; end if;
  -- Match the existing profile creation lock and serialize profile reuse.
  perform 1 from public.families where id = p_invitation.family_id for update;
  if not exists(select 1 from public.family_memberships
    where family_id = p_invitation.family_id and user_id = p_invitation.invited_by and role in ('owner','admin'))
  then raise exception 'The inviter is no longer authorized; ask a current owner or admin for a new invitation'; end if;
  if p_invitation.invitee_relationship is not null then
    perform 1 from public.tree_people where id = p_invitation.inviter_tree_person_id
      and family_id = p_invitation.family_id and linked_user_id = p_invitation.invited_by for share;
    if not found then raise exception 'The inviter profile is unavailable; ask for a new invitation'; end if;
  end if;

  insert into public.family_memberships(family_id,user_id,role)
    values(p_invitation.family_id,p_actor_id,'member') on conflict(family_id,user_id) do nothing;
  select id into person_id from public.tree_people where family_id = p_invitation.family_id and linked_user_id = p_actor_id;
  if person_id is null then
    select * into account_profile from public.profiles where id = p_actor_id;
    if not found then raise exception 'Account profile is unavailable'; end if;
    insert into public.tree_people(family_id,name,birth_year,death_year,birthplace,biography,linked_user_id,linked_at)
      values(p_invitation.family_id,coalesce(nullif(trim(p_invitation.invitee_name),''),nullif(trim(account_profile.display_name),''),'Jibon member'),
        account_profile.birth_year,account_profile.death_year,account_profile.birthplace,account_profile.biography,p_actor_id,now()) returning id into person_id;
  end if;

  if p_invitation.invitee_relationship is not null then
    if person_id = p_invitation.inviter_tree_person_id then raise exception 'A person cannot be related to themselves'; end if;
    perform pg_advisory_xact_lock(hashtextextended(p_invitation.family_id::text,0));
    select exists(select 1 from public.tree_edges where family_id = p_invitation.family_id
      and from_person = person_id and to_person = p_invitation.inviter_tree_person_id
      and kind = p_invitation.invitee_relationship) into already_linked;
    if p_invitation.invitee_relationship = any(parents || children) then
      proposed_parent := case when p_invitation.invitee_relationship = any(parents) then person_id else p_invitation.inviter_tree_person_id end;
      proposed_child := case when p_invitation.invitee_relationship = any(children) then person_id else p_invitation.inviter_tree_person_id end;
      select exists(select 1 from public.tree_edges where family_id = p_invitation.family_id
        and kind = any(parents || children)
        and (case when kind = any(children) then to_person else from_person end) = proposed_parent
        and (case when kind = any(children) then from_person else to_person end) = proposed_child) into already_linked;
    elsif p_invitation.invitee_relationship = any(partners || siblings) then
      select exists(select 1 from public.tree_edges where family_id = p_invitation.family_id
        and kind = any(case when p_invitation.invitee_relationship = any(partners) then partners else siblings end)
        and ((from_person = person_id and to_person = p_invitation.inviter_tree_person_id)
          or (to_person = person_id and from_person = p_invitation.inviter_tree_person_id))) into already_linked;
    end if;
    if not already_linked then
      insert into public.tree_edges(family_id,from_person,to_person,kind)
        values(p_invitation.family_id,person_id,p_invitation.inviter_tree_person_id,p_invitation.invitee_relationship);
    end if;
  end if;
  return person_id;
end;
$$;
revoke all on function app_private.complete_relationship_aware_family_invitation(public.family_invitations,uuid) from public,anon,authenticated;

-- NULL linked_user_id must fail ownership checks, not evaluate to unknown.
create or replace function public.update_my_tree_profile(
  p_person_id uuid, p_name text, p_birth_year integer, p_death_year integer, p_birthplace text, p_biography text
) returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); person public.tree_people%rowtype;
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  select * into person from public.tree_people where id = p_person_id for update;
  if not found or person.linked_user_id is distinct from actor_id then raise exception 'You can only update your accepted profile'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'Enter a valid full name'; end if;
  if p_birth_year is not null and p_birth_year not between 1000 and 2200 then raise exception 'Enter a valid birth year'; end if;
  if p_death_year is not null and p_death_year not between 1000 and 2200 then raise exception 'Enter a valid death year'; end if;
  if p_birth_year is not null and p_death_year is not null and p_death_year < p_birth_year then raise exception 'Death year cannot precede birth year'; end if;
  if length(coalesce(p_birthplace,'')) > 160 or length(coalesce(p_biography,'')) > 2000 then raise exception 'Profile details are too long'; end if;
  update public.profiles set display_name=trim(p_name),birth_year=p_birth_year,death_year=p_death_year,
    birthplace=trim(coalesce(p_birthplace,'')),biography=trim(coalesce(p_biography,'')) where id=actor_id;
  update public.tree_people set name=trim(p_name),birth_year=p_birth_year,death_year=p_death_year,
    birthplace=trim(coalesce(p_birthplace,'')),biography=trim(coalesce(p_biography,'')) where linked_user_id=actor_id;
end;
$$;
revoke all on function public.update_my_tree_profile(uuid,text,integer,integer,text,text) from public,anon;
grant execute on function public.update_my_tree_profile(uuid,text,integer,integer,text,text) to authenticated;
