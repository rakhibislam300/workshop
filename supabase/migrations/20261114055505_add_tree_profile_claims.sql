-- Account-linked tree profiles: a household can request a verified Jibon user
-- to maintain their own personal record without granting tree relationship control.
alter table public.tree_people add column linked_user_id uuid references auth.users(id) on delete set null;
alter table public.tree_people add column linked_at timestamptz;
create unique index tree_people_linked_user_idx on public.tree_people(linked_user_id) where linked_user_id is not null;

create table public.tree_profile_claims (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references public.tree_people(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  claimant_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check(status in ('pending','accepted','declined','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check((status='pending' and responded_at is null) or (status<>'pending' and responded_at is not null))
);
create index tree_profile_claims_claimant_idx on public.tree_profile_claims(claimant_id,status,created_at desc);
create index tree_profile_claims_family_idx on public.tree_profile_claims(family_id,status);
alter table public.tree_profile_claims enable row level security;
revoke all on public.tree_profile_claims from anon,authenticated;
grant select on public.tree_profile_claims to authenticated;
create policy tree_profile_claims_select on public.tree_profile_claims for select to authenticated using(
  claimant_id=(select auth.uid()) or requested_by=(select auth.uid()) or
  (select app_private.has_family_role(family_id,array['owner','admin']::public.family_role[]))
);

drop policy tree_people_read on public.tree_people;
create policy tree_people_read on public.tree_people for select to authenticated using(
  app_private.has_family_access(family_id) or linked_user_id=(select auth.uid()) or exists(
    select 1 from public.tree_profile_claims claim
    where claim.person_id=tree_people.id and claim.claimant_id=(select auth.uid()) and claim.status='pending'
  )
);
drop policy tree_people_edit on public.tree_people;
create policy tree_people_edit on public.tree_people for update to authenticated
  using(app_private.has_family_role(family_id,array['owner','admin']::public.family_role[]) or linked_user_id=(select auth.uid()))
  with check(app_private.has_family_role(family_id,array['owner','admin']::public.family_role[]) or linked_user_id=(select auth.uid()));

create or replace function app_private.validate_tree() returns trigger language plpgsql set search_path='' as $$
declare
  canonical_parent uuid;
  canonical_child uuid;
  privileged_editor boolean;
begin
 if tg_table_name='tree_people' then
   privileged_editor:=app_private.has_family_role(new.family_id,array['owner','admin']::public.family_role[]);
   if new.family_id<>old.family_id then raise exception 'A person cannot be moved to another family'; end if;
   if new.linked_user_id is distinct from old.linked_user_id
      and not privileged_editor
      and current_setting('app.tree_profile_claim',true) is distinct from 'accept'
   then raise exception 'Only a verified profile claim can change the linked account'; end if;
   return new;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(new.family_id::text, 0));
 if new.kind in ('partner','spouse','husband','wife') then
   if exists(select 1 from public.tree_edges
     where family_id=new.family_id and kind in ('partner','spouse','husband','wife')
       and ((from_person=new.from_person and to_person=new.to_person) or (from_person=new.to_person and to_person=new.from_person)))
   then raise exception 'This partnership already exists'; end if;
   return new;
 end if;
 if new.kind in ('parent','father','mother','adoptive_parent','step_parent','guardian') then
   canonical_parent:=new.from_person; canonical_child:=new.to_person;
 elsif new.kind in ('child','son','daughter') then
   canonical_parent:=new.to_person; canonical_child:=new.from_person;
 else
   return new;
 end if;
 if exists(
   select 1 from public.tree_edges e
   where e.family_id=new.family_id
     and (case when e.kind in ('child','son','daughter') then e.to_person else e.from_person end)=canonical_parent
     and (case when e.kind in ('child','son','daughter') then e.from_person else e.to_person end)=canonical_child
     and e.kind in ('parent','father','mother','adoptive_parent','step_parent','guardian','child','son','daughter')
 ) then raise exception 'This parent and child relationship already exists'; end if;
 if exists(
   with recursive parent_edges(parent_id,child_id) as (
     select case when kind in ('child','son','daughter') then to_person else from_person end,
            case when kind in ('child','son','daughter') then from_person else to_person end
     from public.tree_edges
     where family_id=new.family_id and kind in ('parent','father','mother','adoptive_parent','step_parent','guardian','child','son','daughter')
   ), descendants(id) as (
     select canonical_child
     union
     select e.child_id from parent_edges e join descendants d on e.parent_id=d.id
   ) select 1 from descendants where id=canonical_parent
 ) then raise exception 'This relationship would create an ancestry loop'; end if;
 return new;
end $$;
revoke all on function app_private.validate_tree() from public,anon,authenticated;

create function public.create_tree_person(
  p_family_id uuid, p_name text, p_birth_year integer, p_death_year integer,
  p_biography text, p_birthplace text, p_related_to uuid default null,
  p_relationship text default null, p_co_parent uuid default null, p_account_email text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); person_id uuid; target_user uuid; related_family uuid;
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
  if p_related_to is not null then
    select family_id into related_family from public.tree_people where id=p_related_to;
    if related_family is distinct from p_family_id then raise exception 'Related person must belong to this family'; end if;
  end if;
  if p_co_parent is not null then
    select family_id into related_family from public.tree_people where id=p_co_parent;
    if related_family is distinct from p_family_id then raise exception 'Second parent must belong to this family'; end if;
  end if;
  if nullif(trim(coalesce(p_account_email,'')),'') is not null then
    select id into target_user from auth.users where lower(email)=lower(trim(p_account_email)) and email_confirmed_at is not null;
    if target_user is null then raise exception 'No verified Jibon account matches that email'; end if;
    if exists(select 1 from public.tree_people where linked_user_id=target_user) then raise exception 'That Jibon account already manages a tree profile'; end if;
  end if;
  insert into public.tree_people(family_id,name,birth_year,death_year,biography,birthplace)
  values(p_family_id,trim(p_name),p_birth_year,p_death_year,trim(coalesce(p_biography,'')),trim(coalesce(p_birthplace,''))) returning id into person_id;
  if p_related_to is not null then
    insert into public.tree_edges(family_id,from_person,to_person,kind) values(p_family_id,person_id,p_related_to,p_relationship);
    if p_co_parent is not null then
      if p_relationship in ('parent','father','mother','adoptive_parent','step_parent','guardian') then
        insert into public.tree_edges(family_id,from_person,to_person,kind) values(p_family_id,p_co_parent,p_related_to,'parent');
      else
        insert into public.tree_edges(family_id,from_person,to_person,kind) values(p_family_id,person_id,p_co_parent,p_relationship);
      end if;
    end if;
  end if;
  if target_user is not null then
    insert into public.tree_profile_claims(person_id,family_id,requested_by,claimant_id) values(person_id,p_family_id,actor,target_user);
  end if;
  return person_id;
end $$;
revoke all on function public.create_tree_person(uuid,text,integer,integer,text,text,uuid,text,uuid,text) from public,anon;
grant execute on function public.create_tree_person(uuid,text,integer,integer,text,text,uuid,text,uuid,text) to authenticated;

create function public.respond_tree_profile_claim(p_claim_id uuid,p_action text) returns void language plpgsql security definer set search_path='' as $$
declare claim public.tree_profile_claims%rowtype; actor uuid:=auth.uid();
begin
  if actor is null then raise exception 'Sign in first'; end if;
  select * into claim from public.tree_profile_claims where id=p_claim_id for update;
  if not found or claim.claimant_id<>actor or claim.status<>'pending' then raise exception 'Profile request is unavailable'; end if;
  if p_action='accept' then
    if exists(select 1 from public.tree_people where linked_user_id=actor) then raise exception 'Your account already manages a tree profile'; end if;
    perform set_config('app.tree_profile_claim','accept',true);
    update public.tree_people set linked_user_id=actor,linked_at=now() where id=claim.person_id;
    update public.tree_profile_claims set status='accepted',responded_at=now() where id=claim.id;
  elsif p_action='decline' then
    update public.tree_profile_claims set status='declined',responded_at=now() where id=claim.id;
  else raise exception 'Invalid profile request response'; end if;
end $$;
revoke all on function public.respond_tree_profile_claim(uuid,text) from public,anon;
grant execute on function public.respond_tree_profile_claim(uuid,text) to authenticated;

drop policy tree_photos_read on storage.objects;
drop policy tree_photos_insert on storage.objects;
drop policy tree_photos_update on storage.objects;
drop policy tree_photos_delete on storage.objects;
create policy tree_photos_read on storage.objects for select to authenticated using(
  bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where storage.objects.name=p.family_id::text||'/'||p.id::text and (app_private.has_family_access(p.family_id) or p.linked_user_id=(select auth.uid())))
);
create policy tree_photos_insert on storage.objects for insert to authenticated with check(
  bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where storage.objects.name=p.family_id::text||'/'||p.id::text and (app_private.has_family_role(p.family_id,array['owner','admin']::public.family_role[]) or p.linked_user_id=(select auth.uid())))
);
create policy tree_photos_update on storage.objects for update to authenticated using(
  bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where storage.objects.name=p.family_id::text||'/'||p.id::text and (app_private.has_family_role(p.family_id,array['owner','admin']::public.family_role[]) or p.linked_user_id=(select auth.uid())))
) with check(
  bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where storage.objects.name=p.family_id::text||'/'||p.id::text and (app_private.has_family_role(p.family_id,array['owner','admin']::public.family_role[]) or p.linked_user_id=(select auth.uid())))
);
create policy tree_photos_delete on storage.objects for delete to authenticated using(
  bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where storage.objects.name=p.family_id::text||'/'||p.id::text and (app_private.has_family_role(p.family_id,array['owner','admin']::public.family_role[]) or p.linked_user_id=(select auth.uid())))
);
