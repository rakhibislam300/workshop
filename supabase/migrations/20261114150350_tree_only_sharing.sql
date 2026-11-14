-- Tree sharing is intentionally separate from family membership. Accepted
-- viewers can read the tree and its portraits only; they never receive a row
-- in family_memberships and therefore cannot see household records.
create table public.family_tree_shares (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  shared_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  expires_at timestamptz not null default now() + interval '14 days',
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status in ('accepted', 'declined', 'revoked')) = (responded_at is not null)),
  check (recipient_user_id <> shared_by)
);
create unique index family_tree_shares_one_active_recipient_idx
  on public.family_tree_shares (family_id, recipient_user_id) where status in ('pending', 'accepted');
create index family_tree_shares_recipient_status_idx on public.family_tree_shares (recipient_user_id, status, created_at desc);
create trigger family_tree_shares_updated_at before update on public.family_tree_shares for each row execute function app_private.set_updated_at();
alter table public.family_tree_shares enable row level security;
revoke all on public.family_tree_shares from anon, authenticated;

create function app_private.has_tree_access(p_family_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and (
    exists(select 1 from public.family_memberships membership where membership.family_id = p_family_id and membership.user_id = auth.uid())
    or exists(select 1 from public.family_tree_shares share where share.family_id = p_family_id and share.recipient_user_id = auth.uid() and share.status = 'accepted')
  )
$$;

create function public.can_view_family_tree(p_family_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app_private.has_tree_access(p_family_id)
$$;

drop policy tree_people_read on public.tree_people;
create policy tree_people_read on public.tree_people for select to authenticated using(
  app_private.has_tree_access(family_id) or linked_user_id = (select auth.uid()) or exists(
    select 1 from public.tree_profile_claims claim where claim.person_id = tree_people.id and claim.claimant_id = (select auth.uid()) and claim.status = 'pending'
  )
);
drop policy tree_edges_read on public.tree_edges;
create policy tree_edges_read on public.tree_edges for select to authenticated using(app_private.has_tree_access(family_id));

drop policy tree_photos_read on storage.objects;
create policy tree_photos_read on storage.objects for select to authenticated using(
  bucket_id = 'family-tree-photos' and exists(
    select 1 from public.tree_people person where storage.objects.name = person.family_id::text || '/' || person.id::text
      and (app_private.has_tree_access(person.family_id) or person.linked_user_id = (select auth.uid()))
  )
);

create function public.invite_tree_viewer(p_family_id uuid, p_jibon_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor_id uuid := (select auth.uid()); target_id uuid; share_id uuid; normalized_id text := upper(trim(coalesce(p_jibon_id, '')));
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  if normalized_id !~ '^JBN-U-[A-F0-9]{10}$' then raise exception 'Enter a valid Jibon ID'; end if;
  if not app_private.has_family_role(p_family_id, array['owner', 'admin']::public.family_role[]) then raise exception 'Only a family owner or admin can share this tree'; end if;
  select id into target_id from public.profiles where jibon_id = normalized_id;
  if target_id is null or target_id = actor_id then raise exception 'This account cannot receive this tree share'; end if;
  if exists(select 1 from public.family_memberships where family_id = p_family_id and user_id = target_id) then raise exception 'This person already has household access'; end if;
  insert into public.family_tree_shares(family_id, recipient_user_id, shared_by) values(p_family_id, target_id, actor_id) returning id into share_id;
  insert into public.family_activity(family_id, actor_user_id, action, entity_type, entity_id) values(p_family_id, actor_id, 'shared_tree', 'tree_share', share_id);
  return share_id;
exception when unique_violation then raise exception 'A pending or accepted tree share already exists for this account';
end;
$$;

create function public.get_my_tree_shares()
returns table (share_id uuid, family_id uuid, family_name text, status text, expires_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  return query select share.id, family.id, family.name, share.status, share.expires_at, share.created_at
    from public.family_tree_shares share join public.families family on family.id = share.family_id
    where share.recipient_user_id = auth.uid()
      and (share.status = 'accepted' or (share.status = 'pending' and share.expires_at > now()))
    order by share.created_at desc;
end;
$$;

create function public.get_family_tree_shares(p_family_id uuid)
returns table (share_id uuid, recipient_jibon_id text, recipient_name text, status text, expires_at timestamptz, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not app_private.has_family_role(p_family_id, array['owner', 'admin']::public.family_role[]) then raise exception 'Only a family owner or admin can manage tree shares'; end if;
  return query select share.id, profile.jibon_id, profile.display_name, share.status, share.expires_at, share.created_at
    from public.family_tree_shares share join public.profiles profile on profile.id = share.recipient_user_id
    where share.family_id = p_family_id order by share.created_at desc;
end;
$$;

create function public.respond_tree_share(p_share_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare share public.family_tree_shares%rowtype; actor_id uuid := (select auth.uid());
begin
  if actor_id is null then raise exception 'Authentication is required'; end if;
  select * into share from public.family_tree_shares where id = p_share_id and status = 'pending' and expires_at > now() for update;
  if not found or share.recipient_user_id <> actor_id then raise exception 'This tree share is unavailable'; end if;
  update public.family_tree_shares set status = case when p_accept then 'accepted' else 'declined' end, responded_at = now() where id = share.id;
  insert into public.family_activity(family_id, actor_user_id, action, entity_type, entity_id) values(share.family_id, actor_id, case when p_accept then 'accepted_tree_share' else 'declined_tree_share' end, 'tree_share', share.id);
  return share.family_id;
end;
$$;

create function public.revoke_tree_share(p_share_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare share public.family_tree_shares%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required'; end if;
  select * into share from public.family_tree_shares where id = p_share_id for update;
  if not found or not app_private.has_family_role(share.family_id, array['owner', 'admin']::public.family_role[]) then raise exception 'Only a family owner or admin can revoke this tree share'; end if;
  if share.status not in ('pending', 'accepted') then raise exception 'This tree share is no longer active'; end if;
  update public.family_tree_shares set status = 'revoked', responded_at = now() where id = share.id;
  insert into public.family_activity(family_id, actor_user_id, action, entity_type, entity_id) values(share.family_id, auth.uid(), 'revoked_tree_share', 'tree_share', share.id);
end;
$$;

revoke all on function app_private.has_tree_access(uuid) from public, anon;
grant execute on function app_private.has_tree_access(uuid) to authenticated;
revoke all on function public.can_view_family_tree(uuid) from public, anon;
revoke all on function public.invite_tree_viewer(uuid, text) from public, anon;
revoke all on function public.get_my_tree_shares() from public, anon;
revoke all on function public.get_family_tree_shares(uuid) from public, anon;
revoke all on function public.respond_tree_share(uuid, boolean) from public, anon;
revoke all on function public.revoke_tree_share(uuid) from public, anon;
grant execute on function public.can_view_family_tree(uuid) to authenticated;
grant execute on function public.invite_tree_viewer(uuid, text) to authenticated;
grant execute on function public.get_my_tree_shares() to authenticated;
grant execute on function public.get_family_tree_shares(uuid) to authenticated;
grant execute on function public.respond_tree_share(uuid, boolean) to authenticated;
grant execute on function public.revoke_tree_share(uuid) to authenticated;
