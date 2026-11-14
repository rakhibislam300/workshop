-- Run as postgres after every migration. Fixtures roll back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid(); recipient_id uuid := gen_random_uuid(); outsider_id uuid := gen_random_uuid();
  owner_email text := owner_id::text || '@example.invalid'; recipient_email text := recipient_id::text || '@example.invalid'; outsider_email text := outsider_id::text || '@example.invalid';
  family_id uuid; owner_person_id uuid; recipient_person_id uuid; invitation_id uuid; invitation_token uuid;
  preview_count integer; denied boolean := false;
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
    (owner_id, owner_email, now(), '{}'::jsonb),
    (recipient_id, recipient_email, now(), '{}'::jsonb),
    (outsider_id, outsider_email, now(), '{}'::jsonb);

  select membership.family_id into family_id from public.family_memberships membership
    where membership.user_id = owner_id and membership.role = 'owner' limit 1;
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claim.email', owner_email, true);
  owner_person_id := public.ensure_my_family_tree_profile(family_id);

  select created.invitation_id, created.invitation_token into invitation_id, invitation_token
    from public.create_relationship_aware_family_invitation(
      family_id, recipient_email, null, 'Invited Sister', 'sister', owner_person_id
    ) created;
  assert invitation_token is not null, 'Email invitations must return one secure token to the inviter';
  assert exists(select 1 from public.family_invitations where id = invitation_id and invited_user_id is null),
    'Email invitation must remain email-bound rather than become an account inbox invite';

  perform set_config('request.jwt.claim.sub', outsider_id::text, true);
  perform set_config('request.jwt.claim.email', outsider_email, true);
  begin
    select count(*) into preview_count from public.get_family_invitation_preview(invitation_token);
    if preview_count <> 0 then raise exception 'Outsider saw an invitation preview'; end if;
  exception when raise_exception then denied := true; end;
  assert denied, 'Outsider must not view invitation relationship context';

  perform set_config('request.jwt.claim.sub', recipient_id::text, true);
  perform set_config('request.jwt.claim.email', recipient_email, true);
  assert exists(
    select 1 from public.get_relationship_aware_family_invitations() inbox
    where inbox.invitation_id = invitation_id and inbox.inviter_name is not null and inbox.invitee_relationship = 'sister'
  ), 'Recipient must receive relationship context in their own inbox';
  perform public.accept_family_invitation(invitation_token);
  assert exists(select 1 from public.family_memberships where family_id = family_id and user_id = recipient_id),
    'Acceptance must grant the household membership';
  select id into recipient_person_id from public.tree_people where family_id = family_id and linked_user_id = recipient_id;
  assert recipient_person_id is not null, 'Acceptance must link exactly one tree person to the recipient';
  assert (select name = 'Invited Sister' from public.tree_people where id = recipient_person_id),
    'The new tree person must use the invite-time name';
  assert exists(select 1 from public.tree_edges where family_id = family_id and from_person = recipient_person_id and to_person = owner_person_id and kind = 'sister'),
    'Acceptance must create the declared relationship edge';
  assert not exists(select 1 from public.family_tree_shares where family_id = family_id and recipient_user_id = recipient_id),
    'Workspace invitations must not depend on tree-only sharing';
end $$;
rollback;
select 'PASS: relationship-aware household invitation creates membership, linked tree profile, relationship edge, and recipient-only context' as result;
