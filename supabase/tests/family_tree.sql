-- Run as postgres in a Supabase SQL session; all fixtures roll back.
begin;
do $$
declare
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 fa uuid:=gen_random_uuid(); fb uuid:=gen_random_uuid();
 p1 uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); p3 uuid:=gen_random_uuid();
 invite uuid; before_count int; blocked boolean;
 ea text:=a::text||'@example.invalid'; eb text:=b::text||'@example.invalid';
begin
 insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 (a,ea,now(),'{}'),(b,eb,now(),'{}'),(outsider,outsider::text||'@example.invalid',now(),'{}');
 insert into public.families(id,name,created_by) values(fa,'Tree regression A',a),(fb,'Tree regression B',b);
 insert into public.family_memberships(family_id,user_id,role) values(fa,a,'owner'),(fb,b,'owner'),(fa,outsider,'member');
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claim.sub',a::text,true);
 assert current_user='authenticated','RLS test must run authenticated';
 insert into public.tree_people(id,family_id,name) values(p1,fa,'Parent'),(p2,fa,'Child'),(p3,fa,'Grandchild');
 insert into public.tree_edges(family_id,from_person,to_person,kind) values(fa,p1,p2,'parent'),(fa,p2,p3,'adoptive_parent');
 insert into public.tree_edges(family_id,from_person,to_person,kind) values(fa,p2,p3,'cousin');
 blocked:=false;
 begin insert into public.tree_edges(family_id,from_person,to_person,kind) values(fa,p3,p1,'parent');
 exception when raise_exception then blocked:=true; end;
 assert blocked,'Ancestry cycle must fail';
 blocked:=false;
 begin insert into public.tree_people(family_id,name) values(fb,'Intruder');
 exception when insufficient_privilege then blocked:=true; end;
 assert blocked,'Cross-family write must fail';
 update public.tree_people set biography='Updated' where id=p1;
 assert (select biography='Updated' from public.tree_people where id=p1),'Owner can update';
 invite:=public.invite_relative(eb,'Account A','parent');
 blocked:=false;
 begin perform public.respond_relative(invite,'accept','A');
 exception when raise_exception then blocked:=true; end;
 assert blocked,'Sender cannot accept';
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 assert (select count(*)=3 from public.tree_people where family_id=fa),'Members can read';
 assert not exists(select 1 from public.relative_connections where id=invite),'Nonparticipant cannot read invitations';
 blocked:=false;
 begin perform public.respond_relative(invite,'accept','Intruder');
 exception when raise_exception then blocked:=true; end;
 assert blocked,'Nonparticipant cannot accept';
 blocked:=false;
 begin insert into public.tree_people(family_id,name) values(fa,'Member edit');
 exception when insufficient_privilege then blocked:=true; end;
 assert blocked,'Member cannot edit tree';
 perform set_config('request.jwt.claim.sub',b::text,true);
 assert not exists(select 1 from public.tree_people where family_id=fa),'Other family cannot read tree';
 assert exists(select 1 from public.relative_connections where id=invite),'Recipient can see invitation';
 select count(*) into before_count from public.family_memberships where user_id=b;
 blocked:=false;
 begin perform public.respond_relative(invite,'accept',null);
 exception when check_violation then blocked:=true; end;
 assert blocked,'Acceptance requires shared name';
 perform public.respond_relative(invite,'accept','Account B');
 assert (select status='accepted' from public.relative_connections where id=invite),'Acceptance persisted';
 assert (select count(*)=before_count from public.family_memberships where user_id=b),'Acceptance must not grant memberships';
 assert not exists(select 1 from public.tree_people where family_id=fa),'Acceptance must not expose tree';
 perform public.respond_relative(invite,'disconnect');
 assert (select status='revoked' from public.relative_connections where id=invite),'Disconnect persisted';
 perform public.respond_relative(invite,'block');
 perform set_config('request.jwt.claim.sub',a::text,true);
 blocked:=false;
 begin perform public.invite_relative(eb,'Account A','parent');
 exception when raise_exception then blocked:=true; end;
 assert blocked,'Blocked invitations must fail';
 delete from public.tree_people where id=p2;
 assert not exists(select 1 from public.tree_edges where from_person=p2 or to_person=p2),'Deleting person cascades relationships';
 perform set_config('role','postgres',true);
 -- Admins must be able to edit despite not owning the families row.
 update public.family_memberships set role='admin' where family_id=fa and user_id=outsider;
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 insert into public.tree_edges(family_id,from_person,to_person,kind) values(fa,p3,p1,'son');
 assert exists(select 1 from public.tree_edges where from_person=p3 and to_person=p1 and kind='son'),'Admin can add a son relationship';
 perform set_config('role','postgres',true);
end $$;
rollback;
select 'PASS: tree CRUD, cycle rejection, owner/admin/member roles, cross-family isolation, invitation consent, block, no membership escalation; fixtures rolled back' as result;

-- Account-linked profile: acceptance permits detail edits only, never edge edits.
begin;
do $$
declare
  owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid(); family_id uuid:=gen_random_uuid(); parent_id uuid:=gen_random_uuid(); created_person_id uuid; created_claim_id uuid; denied boolean:=false;
  owner_email text:=owner_id::text||'@example.invalid'; member_email text:=member_id::text||'@example.invalid';
begin
  insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values (owner_id,owner_email,now(),'{}'),(member_id,member_email,now(),'{}');
  insert into public.families(id,name,created_by) values(family_id,'Profile claim verification',owner_id);
  insert into public.family_memberships(family_id,user_id,role) values(family_id,owner_id,'owner');
  perform set_config('role','authenticated',true); perform set_config('request.jwt.claim.sub',owner_id::text,true);
  insert into public.tree_people(id,family_id,name) values(parent_id,family_id,'Parent');
  created_person_id:=public.create_tree_person(family_id,'Linked child',2010,null,'Original story','Home',parent_id,'son',null,member_email);
  select claim.id into created_claim_id from public.tree_profile_claims claim where claim.person_id=created_person_id;
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  assert (select count(*)=1 from public.tree_people person where person.id=created_person_id),'Recipient cannot preview pending profile';
  perform public.respond_tree_profile_claim(created_claim_id,'accept');
  update public.tree_people set biography='Corrected by account holder' where id=created_person_id;
  assert (select biography='Corrected by account holder' and linked_user_id=member_id from public.tree_people person where person.id=created_person_id),'Accepted member could not update own profile';
  begin insert into public.tree_edges(family_id,from_person,to_person,kind) values(family_id,created_person_id,parent_id,'son'); exception when insufficient_privilege then denied:=true; end;
  assert denied,'Claimed member must not be able to rewrite family relationships';
  perform set_config('role','postgres',true);
end $$;
rollback;
select 'PASS: accepted profile claim permits personal details only' as result;
