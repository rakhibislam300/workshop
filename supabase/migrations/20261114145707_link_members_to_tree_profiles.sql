-- A person can have one self-managed tree profile in each family. Their
-- account-owned details are the source used when they join another household.
alter table public.profiles add column birth_year integer check (birth_year between 1000 and 2200);
alter table public.profiles add column death_year integer check (death_year between 1000 and 2200);
alter table public.profiles add column birthplace text not null default '' check (length(birthplace) <= 160);
alter table public.profiles add column biography text not null default '' check (length(biography) <= 2000);
alter table public.profiles add constraint profiles_year_order check (death_year is null or birth_year is null or death_year >= birth_year);

drop index if exists public.tree_people_linked_user_idx;
create unique index tree_people_linked_user_family_idx
  on public.tree_people (family_id, linked_user_id) where linked_user_id is not null;

-- Preserve the details a person has already explicitly claimed before using
-- them to seed any subsequently linked household tree profile.
with latest_linked_profile as (
  select distinct on (person.linked_user_id) person.linked_user_id, person.name, person.birth_year, person.death_year, person.birthplace, person.biography
  from public.tree_people person
  where person.linked_user_id is not null
  order by person.linked_user_id, person.updated_at desc
)
update public.profiles profile set
  display_name = linked.name,
  birth_year = linked.birth_year,
  death_year = linked.death_year,
  birthplace = linked.birthplace,
  biography = linked.biography
from latest_linked_profile linked where linked.linked_user_id = profile.id;

create function app_private.ensure_tree_person_for_member(p_family_id uuid, p_user_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare person_id uuid; account_profile public.profiles%rowtype;
begin
  if p_user_id is null or not exists(select 1 from public.family_memberships where family_id = p_family_id and user_id = p_user_id) then
    raise exception 'Family membership is required';
  end if;
  -- Serialize this per-family creation without granting edit access to members.
  perform 1 from public.families where id = p_family_id for update;
  select id into person_id from public.tree_people where family_id = p_family_id and linked_user_id = p_user_id;
  if person_id is not null then return person_id; end if;
  select * into account_profile from public.profiles where id = p_user_id;
  if not found then raise exception 'Account profile is unavailable'; end if;
  insert into public.tree_people (family_id, name, birth_year, death_year, birthplace, biography, linked_user_id, linked_at)
    values (p_family_id, coalesce(nullif(trim(account_profile.display_name), ''), 'Jibon member'), account_profile.birth_year, account_profile.death_year, account_profile.birthplace, account_profile.biography, p_user_id, now())
    returning id into person_id;
  return person_id;
end;
$$;

create function public.ensure_my_family_tree_profile(p_family_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid());
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  return app_private.ensure_tree_person_for_member(p_family_id, actor_id);
end;
$$;

create function public.update_my_tree_profile(
  p_person_id uuid, p_name text, p_birth_year integer, p_death_year integer, p_birthplace text, p_biography text
)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); person public.tree_people%rowtype;
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  select * into person from public.tree_people where id = p_person_id for update;
  if not found or person.linked_user_id <> actor_id then raise exception 'You can only update your accepted profile'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'Enter a valid full name'; end if;
  if p_birth_year is not null and p_birth_year not between 1000 and 2200 then raise exception 'Enter a valid birth year'; end if;
  if p_death_year is not null and p_death_year not between 1000 and 2200 then raise exception 'Enter a valid death year'; end if;
  if p_birth_year is not null and p_death_year is not null and p_death_year < p_birth_year then raise exception 'Death year cannot precede birth year'; end if;
  if length(coalesce(p_birthplace, '')) > 160 or length(coalesce(p_biography, '')) > 2000 then raise exception 'Profile details are too long'; end if;
  update public.profiles set display_name = trim(p_name), birth_year = p_birth_year, death_year = p_death_year, birthplace = trim(coalesce(p_birthplace, '')), biography = trim(coalesce(p_biography, '')) where id = actor_id;
  update public.tree_people set name = trim(p_name), birth_year = p_birth_year, death_year = p_death_year, birthplace = trim(coalesce(p_birthplace, '')), biography = trim(coalesce(p_biography, '')) where linked_user_id = actor_id;
end;
$$;

create or replace function public.accept_family_invitation(p_token uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare invitation public.family_invitations%rowtype; actor_id uuid := (select auth.uid()); actor_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  select * into invitation from public.family_invitations where token_hash = encode(extensions.digest(p_token::text, 'sha256'), 'hex') and status = 'pending' and expires_at > now() for update;
  if not found then raise exception 'This invitation is invalid, expired, or already used'; end if;
  if actor_email = '' or lower(invitation.invited_email) <> actor_email then raise exception 'Sign in with the email address that received this invitation'; end if;
  insert into public.family_memberships (family_id, user_id, role) values (invitation.family_id, actor_id, 'member') on conflict (family_id, user_id) do nothing;
  perform app_private.ensure_tree_person_for_member(invitation.family_id, actor_id);
  update public.family_invitations set status = 'accepted', accepted_by = actor_id, accepted_at = now() where id = invitation.id;
  insert into public.family_activity (family_id, actor_user_id, action, entity_type, entity_id) values (invitation.family_id, actor_id, 'accepted', 'invitation', invitation.id);
  return invitation.family_id;
end;
$$;

create or replace function public.accept_family_invitation_by_id(p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare invitation public.family_invitations%rowtype; actor_id uuid := (select auth.uid()); actor_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  select * into invitation from public.family_invitations where id = p_invitation_id and status = 'pending' and expires_at > now() for update;
  if not found then raise exception 'This invitation is invalid, expired, or already used'; end if;
  if invitation.invited_user_id is not null and invitation.invited_user_id <> actor_id then raise exception 'This invitation belongs to another account'; end if;
  if invitation.invited_user_id is null and (actor_email = '' or lower(invitation.invited_email) <> actor_email) then raise exception 'Sign in with the email address that received this invitation'; end if;
  insert into public.family_memberships (family_id, user_id, role) values (invitation.family_id, actor_id, 'member') on conflict (family_id, user_id) do nothing;
  perform app_private.ensure_tree_person_for_member(invitation.family_id, actor_id);
  update public.family_invitations set status = 'accepted', accepted_by = actor_id, accepted_at = now() where id = invitation.id;
  insert into public.family_activity (family_id, actor_user_id, action, entity_type, entity_id) values (invitation.family_id, actor_id, 'accepted', 'invitation', invitation.id);
  return invitation.family_id;
end;
$$;

create or replace function public.review_family_join_request(p_request_id uuid, p_approved boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare request public.family_join_requests%rowtype; actor_id uuid := (select auth.uid());
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  select * into request from public.family_join_requests where id = p_request_id and status = 'pending' for update;
  if not found then raise exception 'This join request is no longer pending'; end if;
  if not app_private.has_family_role(request.family_id, array['owner', 'admin']::public.family_role[]) then raise exception 'Only a family owner or admin can review this request'; end if;
  update public.family_join_requests set status = case when p_approved then 'approved' else 'declined' end, reviewed_by = actor_id, reviewed_at = now() where id = request.id;
  if p_approved then
    insert into public.family_memberships (family_id, user_id, role) values (request.family_id, request.requester_user_id, 'member') on conflict (family_id, user_id) do nothing;
    perform app_private.ensure_tree_person_for_member(request.family_id, request.requester_user_id);
  end if;
  insert into public.family_activity (family_id, actor_user_id, action, entity_type, entity_id) values (request.family_id, actor_id, case when p_approved then 'approved_join_request' else 'declined_join_request' end, 'join_request', request.id);
  return request.family_id;
end;
$$;

-- The original claim flow predated shared households and allowed an account to
-- manage only one tree person globally. Scope that invariant to one family.
create or replace function public.create_tree_person(
  p_family_id uuid, p_name text, p_birth_year integer, p_death_year integer,
  p_biography text, p_birthplace text, p_related_to uuid default null,
  p_relationship text default null, p_co_parent uuid default null, p_account_email text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); person_id uuid; target_user uuid; related_family uuid;
begin
  if actor is null or not app_private.has_family_role(p_family_id,array['owner','admin']::public.family_role[]) then raise exception 'Only family owners and admins can add people'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 120 then raise exception 'Enter a valid full name'; end if;
  if p_birth_year is not null and p_birth_year not between 1000 and 2200 then raise exception 'Enter a valid birth year'; end if;
  if p_death_year is not null and p_death_year not between 1000 and 2200 then raise exception 'Enter a valid death year'; end if;
  if p_birth_year is not null and p_death_year is not null and p_death_year<p_birth_year then raise exception 'Death year cannot precede birth year'; end if;
  if length(coalesce(p_biography,''))>2000 or length(coalesce(p_birthplace,''))>160 then raise exception 'Profile details are too long'; end if;
  if (p_related_to is null) <> (p_relationship is null) then raise exception 'Choose both a relationship and the related person'; end if;
  if p_co_parent is not null and (p_related_to is null or p_relationship not in ('parent','father','mother','adoptive_parent','step_parent','guardian','child','son','daughter')) then raise exception 'A second parent can only be used with a parent or child relationship'; end if;
  if p_co_parent=p_related_to then raise exception 'Choose a different second parent'; end if;
  if p_related_to is not null then select family_id into related_family from public.tree_people where id=p_related_to; if related_family is distinct from p_family_id then raise exception 'Related person must belong to this family'; end if; end if;
  if p_co_parent is not null then select family_id into related_family from public.tree_people where id=p_co_parent; if related_family is distinct from p_family_id then raise exception 'Second parent must belong to this family'; end if; end if;
  if nullif(trim(coalesce(p_account_email,'')),'') is not null then
    select id into target_user from auth.users where lower(email)=lower(trim(p_account_email)) and email_confirmed_at is not null;
    if target_user is null then raise exception 'No verified Jibon account matches that email'; end if;
    if exists(select 1 from public.tree_people where family_id=p_family_id and linked_user_id=target_user) then raise exception 'That Jibon account already manages a profile in this family'; end if;
  end if;
  insert into public.tree_people(family_id,name,birth_year,death_year,biography,birthplace) values(p_family_id,trim(p_name),p_birth_year,p_death_year,trim(coalesce(p_biography,'')),trim(coalesce(p_birthplace,''))) returning id into person_id;
  if p_related_to is not null then
    insert into public.tree_edges(family_id,from_person,to_person,kind) values(p_family_id,person_id,p_related_to,p_relationship);
    if p_co_parent is not null then
      if p_relationship in ('parent','father','mother','adoptive_parent','step_parent','guardian') then insert into public.tree_edges(family_id,from_person,to_person,kind) values(p_family_id,p_co_parent,p_related_to,'parent');
      else insert into public.tree_edges(family_id,from_person,to_person,kind) values(p_family_id,person_id,p_co_parent,p_relationship); end if;
    end if;
  end if;
  if target_user is not null then insert into public.tree_profile_claims(person_id,family_id,requested_by,claimant_id) values(person_id,p_family_id,actor,target_user); end if;
  return person_id;
end;
$$;

create or replace function public.respond_tree_profile_claim(p_claim_id uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare claim public.tree_profile_claims%rowtype; actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'Sign in first'; end if;
  select * into claim from public.tree_profile_claims where id=p_claim_id for update;
  if not found or claim.claimant_id<>actor or claim.status<>'pending' then raise exception 'Profile request is unavailable'; end if;
  if p_action='accept' then
    if exists(select 1 from public.tree_people where family_id=claim.family_id and linked_user_id=actor) then raise exception 'Your account already manages a profile in this family'; end if;
    perform set_config('app.tree_profile_claim','accept',true);
    update public.tree_people set linked_user_id=actor,linked_at=now() where id=claim.person_id;
    update public.tree_profile_claims set status='accepted',responded_at=now() where id=claim.id;
  elsif p_action='decline' then update public.tree_profile_claims set status='declined',responded_at=now() where id=claim.id;
  else raise exception 'Invalid profile request response'; end if;
end;
$$;

revoke all on function app_private.ensure_tree_person_for_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.ensure_my_family_tree_profile(uuid) from public, anon;
revoke all on function public.update_my_tree_profile(uuid, text, integer, integer, text, text) from public, anon;
grant execute on function public.ensure_my_family_tree_profile(uuid) to authenticated;
grant execute on function public.update_my_tree_profile(uuid, text, integer, integer, text, text) to authenticated;
