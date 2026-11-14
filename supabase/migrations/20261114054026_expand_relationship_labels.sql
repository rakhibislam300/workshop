+-- Expand labels without changing existing family records or permissions.
alter table public.tree_edges drop constraint tree_edges_kind_check;
alter table public.tree_edges add constraint tree_edges_kind_check check(kind in (
  'parent','father','mother','adoptive_parent','step_parent','guardian',
  'child','son','daughter','sibling','brother','sister',
  'partner','spouse','husband','wife',
  'grandparent','grandfather','grandmother','grandchild','grandson','granddaughter',
  'aunt_uncle','aunt','uncle','niece_nephew','niece','nephew','cousin','in_law','other_relative'
));
alter table public.relative_connections drop constraint relative_connections_relationship_check;
alter table public.relative_connections add constraint relative_connections_relationship_check check(relationship in (
  'parent','father','mother','child','son','daughter',
  'sibling','brother','sister','partner','spouse','husband','wife',
  'cousin','grandparent','grandfather','grandmother','grandchild','grandson','granddaughter',
  'aunt_uncle','aunt','uncle','niece_nephew','niece','nephew','in_law','other_relative'
));

-- Only direct parent/child labels influence the ancestry graph. This allows
-- cousin and in-law descriptions without fabricating an ancestor path.
create or replace function app_private.validate_tree() returns trigger language plpgsql set search_path='' as $$
declare
  canonical_parent uuid;
  canonical_child uuid;
begin
 if tg_table_name='tree_people' then
   if new.family_id<>old.family_id then raise exception 'A person cannot be moved to another family'; end if;
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
