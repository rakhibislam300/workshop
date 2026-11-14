create or replace function app_private.validate_tree() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='tree_people' then
   if new.family_id<>old.family_id then raise exception 'A person cannot be moved to another family'; end if;
   return new;
 end if;
 -- Serialize family graph changes to avoid concurrent ancestry cycles.
 perform pg_advisory_xact_lock(hashtextextended(new.family_id::text, 0));
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
create or replace function public.invite_relative(p_email text,p_name text,p_relationship text) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 actor uuid := auth.uid(); own_email text := app_private.connection_email();
 target text := lower(trim(p_email)); target_id uuid; result uuid;
begin
 if actor is null or own_email is null then raise exception 'Verify your email and sign in first'; end if;
 if target=own_email then raise exception 'You cannot invite yourself'; end if;
 if target is null or target !~ '^[^ @]+@[^ @]+[.][^ @]+$' or length(target)>320 then raise exception 'Enter a valid email'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text, 1));
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

