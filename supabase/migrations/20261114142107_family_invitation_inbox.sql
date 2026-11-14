-- Recipient-facing household invitations remain private. Unlike the owner
-- management list, these functions expose only pending invitations whose
-- recipient email exactly matches the signed-in Auth email.
create function public.get_my_family_invitations()
returns table (
  invitation_id uuid,
  family_name text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
declare actor_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  if actor_email = '' then return; end if;

  return query
    select invitation.id, family.name, invitation.expires_at, invitation.created_at
    from public.family_invitations invitation
    join public.families family on family.id = invitation.family_id
    where invitation.status = 'pending'
      and invitation.expires_at > now()
      and lower(invitation.invited_email) = actor_email
    order by invitation.created_at desc;
end;
$$;

create function public.accept_family_invitation_by_id(p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  invitation public.family_invitations%rowtype;
  actor_id uuid := (select auth.uid());
  actor_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  select * into invitation from public.family_invitations
    where id = p_invitation_id
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

revoke all on function public.get_my_family_invitations() from public, anon;
revoke all on function public.accept_family_invitation_by_id(uuid) from public, anon;
grant execute on function public.get_my_family_invitations() to authenticated;
grant execute on function public.accept_family_invitation_by_id(uuid) to authenticated;
