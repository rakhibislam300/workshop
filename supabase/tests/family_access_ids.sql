-- Run after every migration as postgres in a Supabase SQL session. Fixtures roll back.
begin;
do $$
declare
  owner_id uuid := gen_random_uuid(); recipient_id uuid := gen_random_uuid(); outsider_id uuid := gen_random_uuid();
  owner_email text := owner_id::text || '@example.invalid'; recipient_email text := recipient_id::text || '@example.invalid'; outsider_email text := outsider_id::text || '@example.invalid';
  v_owner_family_id uuid; v_recipient_jibon_id text; v_family_code text; v_invitation_id uuid; v_request_id uuid; denied boolean := false;
begin
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
    (owner_id, owner_email, now(), '{}'::jsonb), (recipient_id, recipient_email, now(), '{}'::jsonb), (outsider_id, outsider_email, now(), '{}'::jsonb);
  select family_id into v_owner_family_id from public.family_memberships where user_id = owner_id and role = 'owner' limit 1;
  select jibon_id into v_recipient_jibon_id from public.profiles where id = recipient_id;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claim.email', owner_email, true);
  select identity.family_code into v_family_code from public.get_jibon_identity(v_owner_family_id) identity;
  assert v_family_code ~ '^JBN-F-[A-F0-9]{10}$', 'Owner must receive a shareable Family Code';
  v_invitation_id := public.create_family_invitation_by_jibon_id(v_owner_family_id, v_recipient_jibon_id);

  perform set_config('request.jwt.claim.sub', outsider_id::text, true);
  perform set_config('request.jwt.claim.email', outsider_email, true);
  assert not exists(select 1 from public.get_my_family_invitations()), 'Outsider must not read another account invitation';
  begin perform public.accept_family_invitation_by_id(v_invitation_id); exception when raise_exception then denied := true; end;
  assert denied, 'Outsider must not accept another account invitation';

  perform set_config('request.jwt.claim.sub', recipient_id::text, true);
  perform set_config('request.jwt.claim.email', recipient_email, true);
  assert exists(select 1 from public.get_my_family_invitations() inbox where inbox.invitation_id = v_invitation_id), 'Recipient must see a Jibon ID invitation';
  perform public.accept_family_invitation_by_id(v_invitation_id);
  assert exists(select 1 from public.family_memberships where family_id = v_owner_family_id and user_id = recipient_id), 'Accepted ID invite must grant membership';

  perform set_config('request.jwt.claim.sub', outsider_id::text, true);
  perform set_config('request.jwt.claim.email', outsider_email, true);
  v_request_id := public.request_join_family_by_code(v_family_code);
  assert exists(select 1 from public.family_join_requests where id = v_request_id and status = 'pending'), 'Family Code must create a pending request, never membership';
  assert not exists(select 1 from public.family_memberships where family_id = v_owner_family_id and user_id = outsider_id), 'Family Code must not grant automatic membership';

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claim.email', owner_email, true);
  assert exists(select 1 from public.get_family_join_requests(v_owner_family_id) pending where pending.request_id = v_request_id), 'Owner must view a pending join request';
  perform public.review_family_join_request(v_request_id, true);
  assert exists(select 1 from public.family_memberships where family_id = v_owner_family_id and user_id = outsider_id), 'Approved request must grant membership';
end $$;
rollback;
select 'PASS: Jibon IDs, recipient-only inbox, Family Code approval, and membership boundaries' as result;
