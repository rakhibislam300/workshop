-- Durable server-only delivery for collaboration links. Browser roles can see
-- only safe status values on the parent records; recipient addresses and the
-- one-time invitation token remain in this private queue.
create type public.collaboration_email_delivery_kind as enum ('family_invitation', 'tree_profile_claim');
create type public.collaboration_email_delivery_status as enum ('pending', 'sent', 'failed', 'cancelled');

alter table public.family_invitations
  add column email_delivery_status text not null default 'not_requested'
    check (email_delivery_status in ('not_requested', 'queued', 'sent', 'failed', 'cancelled'));
alter table public.tree_profile_claims
  add column email_delivery_status text not null default 'not_requested'
    check (email_delivery_status in ('not_requested', 'queued', 'sent', 'failed', 'cancelled'));

create table public.collaboration_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  kind public.collaboration_email_delivery_kind not null,
  family_id uuid not null references public.families(id) on delete cascade,
  family_invitation_id uuid unique references public.family_invitations(id) on delete cascade,
  tree_profile_claim_id uuid unique references public.tree_profile_claims(id) on delete cascade,
  recipient_email text not null check (char_length(trim(recipient_email)) between 3 and 320),
  invitation_token uuid,
  status public.collaboration_email_delivery_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  provider_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (kind = 'family_invitation' and family_invitation_id is not null and tree_profile_claim_id is null and invitation_token is not null)
    or (kind = 'tree_profile_claim' and tree_profile_claim_id is not null and family_invitation_id is null and invitation_token is null)
  ),
  check ((status = 'sent') = (sent_at is not null))
);

create index collaboration_email_pending_idx
  on public.collaboration_email_deliveries (next_attempt_at)
  where status = 'pending';
create index collaboration_email_family_idx
  on public.collaboration_email_deliveries (family_id, created_at desc);

create trigger collaboration_email_deliveries_updated_at before update on public.collaboration_email_deliveries
  for each row execute function app_private.set_updated_at();

revoke all on public.collaboration_email_deliveries from anon, authenticated;
alter table public.collaboration_email_deliveries enable row level security;
create policy collaboration_email_deliveries_no_browser_access
  on public.collaboration_email_deliveries for all to authenticated
  using (false) with check (false);

-- These two functions only enqueue canonical delivery types. They never accept
-- an arbitrary URL, subject, or recipient from the browser.
create function public.queue_family_invitation_email(p_invitation_id uuid, p_token uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare invitation public.family_invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into invitation from public.family_invitations
    where id = p_invitation_id for update;
  if not found
    or invitation.status <> 'pending'
    or invitation.expires_at <= now()
    or not app_private.has_family_role(invitation.family_id, array['owner', 'admin']::public.family_role[])
    or invitation.invited_by <> auth.uid()
  then raise exception 'This invitation cannot be queued for email'; end if;
  if invitation.token_hash <> encode(extensions.digest(p_token::text, 'sha256'), 'hex') then
    raise exception 'Invitation token does not match';
  end if;
  insert into public.collaboration_email_deliveries(kind, family_id, family_invitation_id, recipient_email, invitation_token)
    values ('family_invitation', invitation.family_id, invitation.id, invitation.invited_email, p_token)
    on conflict (family_invitation_id) do update set
      recipient_email = excluded.recipient_email,
      invitation_token = excluded.invitation_token,
      status = 'pending', attempts = 0, next_attempt_at = now(), provider_id = null, last_error = null, sent_at = null;
  update public.family_invitations set email_delivery_status = 'queued' where id = invitation.id;
end;
$$;

create function public.queue_tree_profile_claim_email(p_claim_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare claim public.tree_profile_claims%rowtype; claimant_email text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into claim from public.tree_profile_claims where id = p_claim_id for update;
  if not found
    or claim.status <> 'pending'
    or claim.requested_by <> auth.uid()
    or not app_private.has_family_role(claim.family_id, array['owner', 'admin']::public.family_role[])
  then raise exception 'This profile request cannot be queued for email'; end if;
  select email into claimant_email from auth.users where id = claim.claimant_id;
  if claimant_email is null then raise exception 'The account email is unavailable'; end if;
  insert into public.collaboration_email_deliveries(kind, family_id, tree_profile_claim_id, recipient_email)
    values ('tree_profile_claim', claim.family_id, claim.id, claimant_email)
    on conflict (tree_profile_claim_id) do update set
      recipient_email = excluded.recipient_email,
      status = 'pending', attempts = 0, next_attempt_at = now(), provider_id = null, last_error = null, sent_at = null;
  update public.tree_profile_claims set email_delivery_status = 'queued' where id = claim.id;
end;
$$;

create function app_private.cancel_collaboration_email_delivery()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'pending' then
    update public.collaboration_email_deliveries
      set status = 'cancelled'
      where status = 'pending'
        and ((tg_table_name = 'family_invitations' and family_invitation_id = new.id)
          or (tg_table_name = 'tree_profile_claims' and tree_profile_claim_id = new.id));
    new.email_delivery_status := 'cancelled';
  end if;
  return new;
end;
$$;

create trigger family_invitation_cancel_delivery before update of status on public.family_invitations
  for each row execute function app_private.cancel_collaboration_email_delivery();
create trigger tree_profile_claim_cancel_delivery before update of status on public.tree_profile_claims
  for each row execute function app_private.cancel_collaboration_email_delivery();

revoke all on function public.queue_family_invitation_email(uuid, uuid) from public, anon;
revoke all on function public.queue_tree_profile_claim_email(uuid) from public, anon;
grant execute on function public.queue_family_invitation_email(uuid, uuid) to authenticated;
grant execute on function public.queue_tree_profile_claim_email(uuid) to authenticated;
revoke all on function app_private.cancel_collaboration_email_delivery() from public, anon, authenticated;
