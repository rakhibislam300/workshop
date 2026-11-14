-- Additive: household membership and existing records remain unchanged.
create table public.tree_people (
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null references public.families(id) on delete cascade,
 name text not null check(length(trim(name)) between 1 and 120),
 birth_year integer check(birth_year between 1000 and 2200),
 death_year integer check(death_year between 1000 and 2200),
 biography text not null default '' check(length(biography)<=2000),
 birthplace text not null default '' check(length(birthplace)<=160),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,family_id),
 check(death_year is null or birth_year is null or death_year>=birth_year)
);
create index tree_people_family_idx on public.tree_people(family_id);
create table public.tree_edges (
 id uuid primary key default gen_random_uuid(),
 family_id uuid not null references public.families(id) on delete cascade,
 from_person uuid not null,
 to_person uuid not null,
 kind text not null check(kind in ('parent','adoptive_parent','step_parent','partner')),
 created_at timestamptz not null default now(),
 foreign key(from_person,family_id) references public.tree_people(id,family_id) on delete cascade,
 foreign key(to_person,family_id) references public.tree_people(id,family_id) on delete cascade,
 check(from_person<>to_person),
 unique(from_person,to_person,kind)
);
create index tree_edges_family_idx on public.tree_edges(family_id);
create index tree_edges_from_idx on public.tree_edges(from_person,family_id);
create index tree_edges_to_idx on public.tree_edges(to_person,family_id);
alter table public.tree_people enable row level security;
alter table public.tree_edges enable row level security;
revoke all on public.tree_people,public.tree_edges from anon,authenticated;
grant select,insert,update,delete on public.tree_people to authenticated;
grant select,insert,delete on public.tree_edges to authenticated;
create policy tree_people_read on public.tree_people for select to authenticated using(app_private.has_family_access(family_id));
create policy tree_people_add on public.tree_people for insert to authenticated with check(app_private.has_family_role(family_id,array['owner','admin']::public.family_role[]));
create policy tree_people_edit on public.tree_people for update to authenticated using(app_private.has_family_role(family_id,array['owner','admin']::public.family_role[])) with check(app_private.has_family_role(family_id,array['owner','admin']::public.family_role[]));
create policy tree_people_delete on public.tree_people for delete to authenticated using(app_private.has_family_role(family_id,array['owner','admin']::public.family_role[]));
create policy tree_edges_read on public.tree_edges for select to authenticated using(app_private.has_family_access(family_id));
create policy tree_edges_add on public.tree_edges for insert to authenticated with check(app_private.has_family_role(family_id,array['owner','admin']::public.family_role[]));
create policy tree_edges_delete on public.tree_edges for delete to authenticated using(app_private.has_family_role(family_id,array['owner','admin']::public.family_role[]));

create function app_private.validate_tree() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='tree_people' then
   if new.family_id<>old.family_id then raise exception 'A person cannot be moved to another family'; end if;
   return new;
 end if;
 -- Serialize family graph changes to avoid concurrent ancestry cycles.
 perform 1 from public.families where id=new.family_id for update;
 if new.kind='partner' then
   if exists(select 1 from public.tree_edges where kind='partner' and from_person=new.to_person and to_person=new.from_person)
   then raise exception 'This partnership already exists'; end if;
 elsif exists(
   with recursive descendants(id) as (
     select new.to_person
     union
     select e.to_person from public.tree_edges e join descendants d on e.from_person=d.id
       where e.family_id=new.family_id and e.kind<>'partner'
   ) select 1 from descendants where id=new.from_person
 ) then raise exception 'This relationship would create an ancestry loop'; end if;
 return new;
end $$;
create trigger tree_person_immutable before update on public.tree_people for each row execute function app_private.validate_tree();
create trigger tree_edges_validate before insert on public.tree_edges for each row execute function app_private.validate_tree();
create trigger tree_people_updated before update on public.tree_people for each row execute function app_private.set_updated_at();
create trigger tree_people_activity after insert or update or delete on public.tree_people for each row execute function app_private.log_family_activity();
create trigger tree_edges_activity after insert or delete on public.tree_edges for each row execute function app_private.log_family_activity();
revoke all on function app_private.validate_tree() from public,anon,authenticated;

-- Photos are private and fetched through authenticated Storage, never public URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('family-tree-photos','family-tree-photos',false,3145728,array['image/jpeg','image/png','image/webp']);
create policy tree_photos_read on storage.objects for select to authenticated using(
 bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where name=p.family_id::text||'/'||p.id::text and app_private.has_family_access(p.family_id))
);
create policy tree_photos_insert on storage.objects for insert to authenticated with check(
 bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where name=p.family_id::text||'/'||p.id::text and app_private.has_family_role(p.family_id,array['owner','admin']::public.family_role[]))
);
create policy tree_photos_update on storage.objects for update to authenticated using(
 bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where name=p.family_id::text||'/'||p.id::text and app_private.has_family_role(p.family_id,array['owner','admin']::public.family_role[]))
) with check(
 bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where name=p.family_id::text||'/'||p.id::text and app_private.has_family_role(p.family_id,array['owner','admin']::public.family_role[]))
);
create policy tree_photos_delete on storage.objects for delete to authenticated using(
 bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where name=p.family_id::text||'/'||p.id::text and app_private.has_family_role(p.family_id,array['owner','admin']::public.family_role[]))
);

create function app_private.connection_email() returns text language sql stable security definer set search_path='' as $$
 select lower(email) from auth.users where id=(select auth.uid()) and email_confirmed_at is not null
$$;
revoke all on function app_private.connection_email() from public,anon;
grant execute on function app_private.connection_email() to authenticated;

create table public.relative_connections (
 id uuid primary key default gen_random_uuid(),
 sender_id uuid not null references auth.users(id) on delete cascade,
 recipient_email text not null check(length(recipient_email) between 3 and 320),
 recipient_id uuid references auth.users(id) on delete cascade,
 sender_name text not null check(length(trim(sender_name)) between 1 and 120),
 recipient_name text check(length(trim(recipient_name)) between 1 and 120),
 relationship text not null check(relationship in ('parent','child','sibling','partner','cousin','grandparent','grandchild','aunt_uncle','niece_nephew','other_relative')),
 status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled','revoked','blocked','expired')),
 expires_at timestamptz not null default now()+interval '14 days',
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(recipient_id is null or recipient_id<>sender_id)
);
create index relative_connections_sender_idx on public.relative_connections(sender_id,created_at desc);
create index relative_connections_email_idx on public.relative_connections(recipient_email);
create index relative_connections_recipient_idx on public.relative_connections(recipient_id);
alter table public.relative_connections enable row level security;
revoke all on public.relative_connections from anon,authenticated;
grant select on public.relative_connections to authenticated;
create policy relative_connections_participants on public.relative_connections for select to authenticated using(
 sender_id=(select auth.uid()) or recipient_id=(select auth.uid()) or
 (recipient_id is null and recipient_email=(select app_private.connection_email()))
);
-- Only participant-checked RPCs can change consent state.
create function public.invite_relative(p_email text,p_name text,p_relationship text) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid(); own_email text := app_private.connection_email();
 target text := lower(trim(p_email)); target_id uuid; result uuid;
begin
 if actor is null or own_email is null then raise exception 'Verify your email and sign in first'; end if;
 if target=own_email then raise exception 'You cannot invite yourself'; end if;
 if target is null or target !~ '^[^ @]+@[^ @]+[.][^ @]+$' or length(target)>320 then raise exception 'Enter a valid email'; end if;
 perform pg_advisory_xact_lock(hashtextextended(least(own_email,target)||greatest(own_email,target),0));
 select id into target_id from auth.users where lower(email)=target and email_confirmed_at is not null;
 if (select count(*) from public.relative_connections where sender_id=actor and created_at>now()-interval '1 day')>=10
 then raise exception 'Daily invitation limit reached'; end if;
 update public.relative_connections set status='expired',updated_at=now() where status='pending' and expires_at<=now() and
 (sender_id=actor or recipient_id=actor or recipient_email=own_email);
 if exists(select 1 from public.relative_connections where status in ('pending','accepted','blocked') and
 ((sender_id=actor and (recipient_email=target or recipient_id=target_id)) or
 (sender_id=target_id and (recipient_id=actor or recipient_email=own_email))))
 then raise exception 'A connection or invitation already exists, or this connection is unavailable'; end if;
 insert into public.relative_connections(sender_id,recipient_email,recipient_id,sender_name,relationship)
 values(actor,target,target_id,trim(p_name),p_relationship) returning id into result;
 return result;
end $$;
create function public.respond_relative(p_id uuid,p_action text,p_name text default null) returns void
language plpgsql security definer set search_path='' as $$
declare c public.relative_connections%rowtype; actor uuid:=auth.uid(); is_recipient boolean;
begin
 if actor is null then raise exception 'Sign in first'; end if;
 select * into c from public.relative_connections where id=p_id for update;
 if not found then raise exception 'Invitation unavailable'; end if;
 is_recipient := coalesce(c.recipient_id=actor or (c.recipient_id is null and c.recipient_email=app_private.connection_email()),false);
 if c.sender_id<>actor and not is_recipient then raise exception 'Invitation unavailable'; end if;
 if p_action='accept' and is_recipient and c.status='pending' and c.expires_at>now() then
   update public.relative_connections set status='accepted',recipient_id=actor,recipient_name=trim(p_name),updated_at=now() where id=p_id;
 elsif p_action='decline' and is_recipient and c.status='pending' then
   update public.relative_connections set status='declined',recipient_id=actor,updated_at=now() where id=p_id;
 elsif p_action='cancel' and c.sender_id=actor and c.status='pending' then
   update public.relative_connections set status='cancelled',updated_at=now() where id=p_id;
 elsif p_action='disconnect' and c.status='accepted' then
   update public.relative_connections set status='revoked',updated_at=now() where id=p_id;
 elsif p_action='block' and is_recipient and c.status in ('pending','accepted','revoked','declined') then
   update public.relative_connections set status='blocked',recipient_id=actor,updated_at=now() where id=p_id;
 else raise exception 'This action is no longer available'; end if;
end $$;
revoke all on function public.invite_relative(text,text,text),public.respond_relative(uuid,text,text) from public,anon;
grant execute on function public.invite_relative(text,text,text),public.respond_relative(uuid,text,text) to authenticated;
