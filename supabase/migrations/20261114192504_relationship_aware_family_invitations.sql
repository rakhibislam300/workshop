-- A household workspace invitation can also establish the invited person's
-- first declared tree relationship. Tree-only sharing remains completely
-- separate in family_tree_shares and never calls these functions.
alter table public.family_invitations
  add column invitee_name text check (invitee_name is null or length(trim(invitee_name)) between 1 and 120),
  add column invitee_relationship text check (invitee_relationship is null or invitee_relationship in (
    'parent','father','mother','adoptive_parent','step_parent','guardian',
    'child','son','daughter','sibling','brother','sister',
    'partner','spouse','husband','wife',
    'grandparent','grandfather','grandmother','grandchild','grandson','granddaughter',
    'aunt_uncle','aunt','uncle','niece_nephew','niece','nephew','cousin','in_law','other_relative'
  )),
  add column inviter_tree_person_id uuid;

alter table public.family_invitations
  add constraint family_invitations_inviter_tree_person_family_fkey
  foreign key (inviter_tree_person_id, family_id)
  references public.tree_people(id, family_id)
  on delete set null (inviter_tree_person_id);

create index family_invitations_pending_relationship_idx
  on public.family_invitations (family_id, inviter_tree_person_id, created_at desc)
  where status = 'pending' and inviter_tree_person_id is not null;

-- This one authority boundary creates either a Jibon-ID inbox invitation or
-- an email-bound link invitation. It exposes the raw token once, and only to
-- the inviting owner/admin for email delivery. The token is never persisted.
create function public.create_relationship_aware_family_invitation(
  p_family_id uuid,
  p_email text,
  p_jibon_id text,
  p_invitee_name text,
  p_invitee_relationship text,
  p_inviter_tree_person_id uuid
)
returns table (invitation_id uuid, invitation_token uuid, direct boolean, reissued boolean)
language plpgsql security definer set search_path = '' as $$
declare
  actor_id uuid := (select auth.uid());
  target_user_id uuid;
  target_email text;
  normalized_email text := lower(trim(coalesce(p_email, '')));
  normalized_jibon_id text := upper(trim(coalesce(p_jibon_id, '')));
  normalized_name text := trim(coalesce(p_invitee_name, ''));
  normalized_relationship text := trim(coalesce(p_invitee_relationship, ''));
  new_invitation_id uuid;
  raw_token uuid := gen_random_uuid();
  did_reissue boolean := false;
  direct_invitation boolean := normalized_jibon_id <> '';
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if not app_private.has_family_role(p_family_id, array['owner', 'admin']::public.family_role[]) then
    raise exception 'Only a family owner or admin can invite members';
  end if;
  if (normalized_email = '') = (normalized_jibon_id = '') then
    raise exception 'Enter either a Jibon ID or an email address';
  end if;
  if length(normalized_name) not between 1 and 120 then raise exception 'Enter the invited person''s name'; end if;
  if normalized_relationship not in (
    'parent','father','mother','adoptive_parent','step_parent','guardian',
    'child','son','daughter','sibling','brother','sister',
    'partner','spouse','husband','wife',
    'grandparent','grandfather','grandmother','grandchild','grandson','granddaughter',
    'aunt_uncle','aunt','uncle','niece_nephew','niece','nephew','cousin','in_law','other_relative'
  ) then raise exception 'Choose a valid family relationship'; end if;

  -- The selected node must be the inviter's own linked profile, so an admin
  -- cannot accidentally assert a relationship on behalf of another person.
  if not exists(
    select 1 from public.tree_people person
    where person.id = p_inviter_tree_person_id
      and person.family_id = p_family_id
      and person.linked_user_id = actor_id
  ) then raise exception 'Add your own linked family-tree profile before sending this invitation'; end if;

  if normalized_jibon_id <> '' then
    if normalized_jibon_id !~ '^JBN-U-[A-F0-9]{10}$' then raise exception 'Enter a valid Jibon ID'; end if;
    select profile.id, lower(user_account.email) into target_user_id, target_email
      from public.profiles profile join auth.users user_account on user_account.id = profile.id
      where profile.jibon_id = normalized_jibon_id and user_account.email_confirmed_at is not null;
    if target_user_id is null then raise exception 'No verified Jibon account matches that ID'; end if;
  else
    if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(normalized_email) > 320 then
      raise exception 'Enter a valid email address';
    end if;
    target_email := normalized_email;
    select id into target_user_id from auth.users where lower(email) = normalized_email and email_confirmed_at is not null;
  end if;
  if target_user_id = actor_id then raise exception 'You cannot invite your own account'; end if;
  if target_user_id is not null and exists(
    select 1 from public.family_memberships where family_id = p_family_id and user_id = target_user_id
  ) then raise exception 'This person already belongs to the family'; end if;

  -- There is one actionable invitation per account/email. Cancelling the old
  -- row also cancels a queued email through the existing delivery trigger.
  with cancelled as (
    update public.family_invitations
      set status = 'cancelled'
      where family_id = p_family_id and status = 'pending'
        and (lower(invited_email) = target_email or (target_user_id is not null and invited_user_id = target_user_id))
      returning id
  ) select exists(select 1 from cancelled) into did_reissue;

  insert into public.family_invitations (
    family_id, invited_email, invited_user_id, invited_by, token_hash,
    invitee_name, invitee_relationship, inviter_tree_person_id
  ) values (
    p_family_id, target_email, case when direct_invitation then target_user_id else null end, actor_id,
    encode(extensions.digest(raw_token::text, 'sha256'), 'hex'),
    normalized_name, normalized_relationship, p_inviter_tree_person_id
  ) returning id into new_invitation_id;

  insert into public.family_activity(family_id, actor_user_id, action, entity_type, entity_id)
    values (p_family_id, actor_id, 'invited_with_relationship', 'invitation', new_invitation_id);
  return query select new_invitation_id, case when direct_invitation then null else raw_token end, direct_invitation, did_reissue;
end;
$$;

-- This helper is only called while the acceptance function holds the
-- invitation row lock. It preserves existing linked profiles, otherwise
-- creates exactly one profile from the invitation and then records the
-- declared, directional relationship to the inviter's profile.
create function app_private.complete_relationship_aware_family_invitation(
  p_invitation public.family_invitations,
  p_actor_id uuid
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  person_id uuid;
  account_profile public.profiles%rowtype;
begin
  insert into public.family_memberships (family_id, user_id, role)
    values (p_invitation.family_id, p_actor_id, 'member')
    on conflict (family_id, user_id) do nothing;

  select id into person_id from public.tree_people
    where family_id = p_invitation.family_id and linked_user_id = p_actor_id;
  if person_id is null then
    select * into account_profile from public.profiles where id = p_actor_id;
    if not found then raise exception 'Account profile is unavailable'; end if;
    insert into public.tree_people (
      family_id, name, birth_year, death_year, birthplace, biography, linked_user_id, linked_at
    ) values (
      p_invitation.family_id,
      coalesce(nullif(trim(p_invitation.invitee_name), ''), nullif(trim(account_profile.display_name), ''), 'Jibon member'),
      account_profile.birth_year, account_profile.death_year, account_profile.birthplace, account_profile.biography,
      p_actor_id, now()
    ) returning id into person_id;
  end if;

  if p_invitation.inviter_tree_person_id is not null and p_invitation.invitee_relationship is not null
    and not exists(
      select 1 from public.tree_edges edge
      where edge.family_id = p_invitation.family_id
        and edge.from_person = person_id
        and edge.to_person = p_invitation.inviter_tree_person_id
        and edge.kind = p_invitation.invitee_relationship
    )
  then
    insert into public.tree_edges(family_id, from_person, to_person, kind)
      values (p_invitation.family_id, person_id, p_invitation.inviter_tree_person_id, p_invitation.invitee_relationship);
  end if;
  return person_id;
end;
$$;

create or replace function public.accept_family_invitation(p_token uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  invitation public.family_invitations%rowtype;
  actor_id uuid := (select auth.uid());
  actor_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  select * into invitation from public.family_invitations
    where token_hash = encode(extensions.digest(p_token::text, 'sha256'), 'hex')
      and status = 'pending' and expires_at > now()
    for update;
  if not found then raise exception 'This invitation is invalid, expired, or already used'; end if;
  if invitation.invited_user_id is not null and invitation.invited_user_id <> actor_id then
    raise exception 'This invitation belongs to another account';
  end if;
  if invitation.invited_user_id is null and (actor_email = '' or lower(invitation.invited_email) <> actor_email) then
    raise exception 'Sign in with the email address that received this invitation';
  end if;
  perform app_private.complete_relationship_aware_family_invitation(invitation, actor_id);
  update public.family_invitations set status = 'accepted', accepted_by = actor_id, accepted_at = now() where id = invitation.id;
  insert into public.family_activity(family_id, actor_user_id, action, entity_type, entity_id)
    values (invitation.family_id, actor_id, 'accepted', 'invitation', invitation.id);
  return invitation.family_id;
end;
$$;

create or replace function public.accept_family_invitation_by_id(p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  invitation public.family_invitations%rowtype;
  actor_id uuid := (select auth.uid());
  actor_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  select * into invitation from public.family_invitations
    where id = p_invitation_id and status = 'pending' and expires_at > now()
    for update;
  if not found then raise exception 'This invitation is invalid, expired, or already used'; end if;
  if invitation.invited_user_id is not null and invitation.invited_user_id <> actor_id then
    raise exception 'This invitation belongs to another account';
  end if;
  if invitation.invited_user_id is null and (actor_email = '' or lower(invitation.invited_email) <> actor_email) then
    raise exception 'Sign in with the email address that received this invitation';
  end if;
  perform app_private.complete_relationship_aware_family_invitation(invitation, actor_id);
  update public.family_invitations set status = 'accepted', accepted_by = actor_id, accepted_at = now() where id = invitation.id;
  insert into public.family_activity(family_id, actor_user_id, action, entity_type, entity_id)
    values (invitation.family_id, actor_id, 'accepted', 'invitation', invitation.id);
  return invitation.family_id;
end;
$$;

-- The recipient can see only the context of their own actionable invitation.
-- No owner-side invitation list or unrelated profile data is exposed.
create function public.get_relationship_aware_family_invitations()
returns table (
  invitation_id uuid, family_name text, inviter_name text, invitee_name text,
  invitee_relationship text, expires_at timestamptz, created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); actor_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  return query
    select invitation.id, family.name, coalesce(nullif(inviter_profile.display_name, ''), 'A family member'),
      invitation.invitee_name, invitation.invitee_relationship, invitation.expires_at, invitation.created_at
    from public.family_invitations invitation
    join public.families family on family.id = invitation.family_id
    left join public.profiles inviter_profile on inviter_profile.id = invitation.invited_by
    where invitation.status = 'pending' and invitation.expires_at > now()
      and (invitation.invited_user_id = actor_id or (invitation.invited_user_id is null and actor_email <> '' and lower(invitation.invited_email) = actor_email))
    order by invitation.created_at desc;
end;
$$;

create function public.get_family_invitation_preview(p_token uuid)
returns table (family_name text, inviter_name text, invitee_name text, invitee_relationship text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); actor_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  return query
    select family.name, coalesce(nullif(inviter_profile.display_name, ''), 'A family member'),
      invitation.invitee_name, invitation.invitee_relationship, invitation.expires_at
    from public.family_invitations invitation
    join public.families family on family.id = invitation.family_id
    left join public.profiles inviter_profile on inviter_profile.id = invitation.invited_by
    where invitation.token_hash = encode(extensions.digest(p_token::text, 'sha256'), 'hex')
      and invitation.status = 'pending' and invitation.expires_at > now()
      and (invitation.invited_user_id = actor_id or (invitation.invited_user_id is null and actor_email <> '' and lower(invitation.invited_email) = actor_email));
end;
$$;

revoke all on function public.create_relationship_aware_family_invitation(uuid, text, text, text, text, uuid) from public, anon;
revoke all on function public.accept_family_invitation(uuid) from public, anon;
revoke all on function public.accept_family_invitation_by_id(uuid) from public, anon;
revoke all on function public.get_relationship_aware_family_invitations() from public, anon;
revoke all on function public.get_family_invitation_preview(uuid) from public, anon;
revoke all on function app_private.complete_relationship_aware_family_invitation(public.family_invitations, uuid) from public, anon, authenticated;
grant execute on function public.create_relationship_aware_family_invitation(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.accept_family_invitation(uuid) to authenticated;
grant execute on function public.accept_family_invitation_by_id(uuid) to authenticated;
grant execute on function public.get_relationship_aware_family_invitations() to authenticated;
grant execute on function public.get_family_invitation_preview(uuid) to authenticated;
