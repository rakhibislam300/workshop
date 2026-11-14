drop policy tree_photos_read on storage.objects;
drop policy tree_photos_insert on storage.objects;
drop policy tree_photos_update on storage.objects;
drop policy tree_photos_delete on storage.objects;
create policy tree_photos_read on storage.objects for select to authenticated using(
 bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where storage.objects.name=p.family_id::text||'/'||p.id::text and app_private.has_family_access(p.family_id))
);
create policy tree_photos_insert on storage.objects for insert to authenticated with check(
 bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where storage.objects.name=p.family_id::text||'/'||p.id::text and app_private.has_family_role(p.family_id,array['owner','admin']::public.family_role[]))
);
create policy tree_photos_update on storage.objects for update to authenticated using(
 bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where storage.objects.name=p.family_id::text||'/'||p.id::text and app_private.has_family_role(p.family_id,array['owner','admin']::public.family_role[]))
) with check(
 bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where storage.objects.name=p.family_id::text||'/'||p.id::text and app_private.has_family_role(p.family_id,array['owner','admin']::public.family_role[]))
);
create policy tree_photos_delete on storage.objects for delete to authenticated using(
 bucket_id='family-tree-photos' and exists(select 1 from public.tree_people p where storage.objects.name=p.family_id::text||'/'||p.id::text and app_private.has_family_role(p.family_id,array['owner','admin']::public.family_role[]))
);


alter table public.relative_connections add constraint accepted_name_required check(status <> 'accepted' or (recipient_name is not null and length(trim(recipient_name)) between 1 and 120));
