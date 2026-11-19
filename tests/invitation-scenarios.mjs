import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function invitationScenarios(db) {
  const q = async (sql, params = []) => (await db.query(sql, params)).rows;
  const signIn = async user => {
    await db.exec('reset role');
    await q(`select set_config('request.jwt.claims', $1, true),
      set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.email', $3, true)`,
    [JSON.stringify({ sub: user.id, email: user.email }), user.id, user.email]);
    await db.exec('set local role authenticated');
  };
  let failures = 0;
  async function scenario(name, test) {
    await db.exec('begin');
    try {
      const users = [];
      for (const name of ['Owner', 'Recipient', 'Outsider', 'Admin']) {
        const id = randomUUID(), email = `${id}@example.invalid`;
        await q(`insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
          values($1,$2,now(),jsonb_build_object('display_name',$3::text))`, [id, email, name]);
        const [row] = await q(`select p.jibon_id, m.family_id from public.profiles p
          join public.family_memberships m on m.user_id=p.id where p.id=$1`, [id]);
        users.push({ id, email, ...row });
      }
      const [owner, recipient, outsider, admin] = users;
      await signIn(owner);
      const [{ id: anchor }] = await q('select public.ensure_my_family_tree_profile($1) as id', [owner.family_id]);
      const invite = async (overrides = {}) => {
        const v = { family: owner.family_id, email: recipient.email, jibon: null, name: 'Invited person', kind: 'son', anchor, ...overrides };
        return (await q('select * from public.create_relationship_aware_family_invitation($1,$2,$3,$4,$5,$6)',
          [v.family, v.email, v.jibon, v.name, v.kind, v.anchor]))[0];
      };
      const accept = async id => q('select public.accept_family_invitation_by_id($1)', [id]);
      await test({ owner, recipient, outsider, admin, anchor, invite, accept });
      console.log(`PASS invitation: ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL invitation: ${name}: ${error.message}`);
    } finally {
      await db.exec('rollback; reset role');
    }
  }

  await scenario('no tree or membership before consent; name and directional edge after acceptance', async ({owner,recipient,anchor,invite,accept}) => {
    const invitation = await invite();
    assert.equal((await q('select id from public.tree_people where family_id=$1', [owner.family_id])).length, 1);
    await signIn(recipient);
    assert.equal((await q('select * from public.family_memberships where family_id=$1', [owner.family_id])).length, 0);
    await accept(invitation.invitation_id);
    const [person] = await q('select * from public.tree_people where family_id=$1 and linked_user_id=$2', [owner.family_id,recipient.id]);
    assert.equal(person.name, 'Invited person');
    assert.equal((await q('select * from public.tree_edges where from_person=$1 and to_person=$2 and kind=$3', [person.id,anchor,'son'])).length, 1);
    assert.equal((await q('select role from public.family_memberships where family_id=$1 and user_id=$2', [owner.family_id,recipient.id]))[0].role, 'member');
  });
  await scenario('Jibon ID delivery, recipient-only preview/inbox, and wrong-account rejection', async ({recipient,outsider,invite,accept}) => {
    const invitation = await invite({email:null,jibon:recipient.jibon_id,kind:'daughter'});
    assert.equal(invitation.direct,true); assert.equal(invitation.invitation_token,null);
    await signIn(outsider);
    assert.deepEqual(await q('select * from public.get_relationship_aware_family_invitations()'), []);
    await db.exec('savepoint denied');
    await assert.rejects(accept(invitation.invitation_id), /another account/);
    await db.exec('rollback to denied');
    await signIn(recipient);
    assert.equal((await q('select * from public.get_relationship_aware_family_invitations()'))[0].invitee_relationship, 'daughter');
    await accept(invitation.invitation_id);
  });
  await scenario('reissue cancels the previous token and queued email; replay is rejected', async ({recipient,invite}) => {
    const old = await invite();
    await q('select public.queue_family_invitation_email($1,$2)',[old.invitation_id,old.invitation_token]);
    const current = await invite(); assert.equal(current.reissued,true);
    await db.exec('reset role');
    assert.equal((await q('select status from public.collaboration_email_deliveries where family_invitation_id=$1',[old.invitation_id]))[0].status,'cancelled');
    await signIn(recipient);
    await db.exec('savepoint stale');
    await assert.rejects(q('select public.accept_family_invitation($1)', [old.invitation_token]), /invalid, expired, or already used/);
    await db.exec('rollback to stale');
    await q('select public.accept_family_invitation($1)', [current.invitation_token]);
    await db.exec('savepoint replay');
    await assert.rejects(q('select public.accept_family_invitation($1)', [current.invitation_token]), /invalid, expired, or already used/);
    await db.exec('rollback to replay');
  });
  await scenario('expired invitation grants nothing', async ({owner,recipient,invite,accept}) => {
    const invitation = await invite();
    await db.exec('reset role');
    await q("update public.family_invitations set expires_at=now()-interval '1 second' where id=$1", [invitation.invitation_id]);
    await signIn(recipient);
    assert.deepEqual(await q('select * from public.get_relationship_aware_family_invitations()'),[]);
    await db.exec('savepoint expired');
    await assert.rejects(accept(invitation.invitation_id), /invalid, expired, or already used/);
    await db.exec('rollback to expired');
    assert.equal((await q('select * from public.family_memberships where family_id=$1',[owner.family_id])).length,0);
  });
  await scenario('existing linked profile reused without overwriting personal details', async ({owner,recipient,anchor,invite,accept}) => {
    await db.exec('reset role');
    const [{id}] = await q(`insert into public.tree_people(family_id,name,linked_user_id,linked_at)
      values($1,'My chosen name',$2,now()) returning id`,[owner.family_id,recipient.id]);
    await signIn(owner); const invitation = await invite();
    await signIn(recipient); await accept(invitation.invitation_id);
    const people = await q('select id,name from public.tree_people where family_id=$1 and linked_user_id=$2',[owner.family_id,recipient.id]);
    assert.deepEqual(people,[{id,name:'My chosen name'}]);
    assert.equal((await q('select id from public.tree_edges where from_person=$1 and to_person=$2',[id,anchor])).length,1);
  });
  await scenario('foreign or unlinked anchor rejected', async ({owner,outsider,invite}) => {
    await signIn(outsider);
    const [{id}] = await q('select public.ensure_my_family_tree_profile($1) as id',[outsider.family_id]);
    await signIn(owner);
    await db.exec('savepoint wrong');
    await assert.rejects(invite({anchor:id}), /own linked family-tree profile/);
    await db.exec('rollback to wrong');
    const [{id: unlinked}] = await q("insert into public.tree_people(family_id,name) values($1,'Unlinked') returning id",[owner.family_id]);
    await db.exec('savepoint unlinked');
    await assert.rejects(invite({anchor:unlinked}), /own linked family-tree profile/);
    await db.exec('rollback to unlinked');
  });
  await scenario('deleted anchor prevents partial membership acceptance', async ({owner,recipient,anchor,invite,accept}) => {
    const invitation = await invite();
    await q('delete from public.tree_people where id=$1',[anchor]);
    await signIn(recipient);
    await db.exec('savepoint missing');
    await assert.rejects(accept(invitation.invitation_id), /profile|relationship|unavailable/i);
    await db.exec('rollback to missing');
    assert.equal((await q('select * from public.family_memberships where family_id=$1',[owner.family_id])).length,0);
  });
  await scenario('acceptance rechecks inviter authority', async ({owner,recipient,admin,invite,accept}) => {
    await db.exec('reset role');
    await q("insert into public.family_memberships(family_id,user_id,role) values($1,$2,'admin')",[owner.family_id,admin.id]);
    await signIn(admin);
    const [{id}] = await q('select public.ensure_my_family_tree_profile($1) as id',[owner.family_id]);
    const invitation = await invite({anchor:id});
    await signIn(owner);
    await q("select public.update_family_member_role($1,$2,'member')",[owner.family_id,admin.id]);
    await signIn(recipient);
    await db.exec('savepoint removed');
    await assert.rejects(accept(invitation.invitation_id), /inviter|authoriz|unavailable/i);
    await db.exec('rollback to removed');
  });
  await scenario('existing equivalent parent edge is reused', async ({owner,recipient,anchor,invite,accept}) => {
    await db.exec('reset role');
    const [{id}] = await q("insert into public.tree_people(family_id,name,linked_user_id) values($1,'Existing child',$2) returning id",[owner.family_id,recipient.id]);
    await q("insert into public.tree_edges(family_id,from_person,to_person,kind) values($1,$2,$3,'parent')",[owner.family_id,anchor,id]);
    await signIn(owner); const invitation = await invite();
    await signIn(recipient); await accept(invitation.invitation_id);
    assert.equal((await q('select id from public.tree_edges where family_id=$1',[owner.family_id])).length,1);
  });
  await scenario('ancestry conflict rolls back membership and leaves invitation pending', async ({owner,recipient,anchor,invite,accept}) => {
    await db.exec('reset role');
    const [{id}] = await q("insert into public.tree_people(family_id,name,linked_user_id) values($1,'Existing parent',$2) returning id",[owner.family_id,recipient.id]);
    await q("insert into public.tree_edges(family_id,from_person,to_person,kind) values($1,$2,$3,'parent')",[owner.family_id,id,anchor]);
    await signIn(owner); const invitation=await invite();
    await signIn(recipient); await db.exec('savepoint conflict');
    await assert.rejects(accept(invitation.invitation_id),/ancestry loop/); await db.exec('rollback to conflict');
    await db.exec('reset role');
    assert.equal((await q('select * from public.family_memberships where family_id=$1 and user_id=$2',[owner.family_id,recipient.id])).length,0);
    assert.equal((await q('select status from public.family_invitations where id=$1',[invitation.invitation_id]))[0].status,'pending');
  });
  await scenario('unlinked person cannot be edited through self-profile RPC', async ({owner,outsider}) => {
    const [{id}] = await q("insert into public.tree_people(family_id,name) values($1,'Unlinked person') returning id",[owner.family_id]);
    await signIn(outsider);
    await db.exec('savepoint profile');
    await assert.rejects(q("select public.update_my_tree_profile($1,'Intruder',null,null,'','')",[id]), /only update your accepted profile/);
    await db.exec('rollback to profile');
  });
  await scenario('tree-only sharing exposes portraits and tree, denies household data and edits, revokes immediately', async ({owner,recipient,outsider,anchor}) => {
    const family=owner.family_id;
    await q("insert into public.tasks(family_id,user_id,title) values($1,$2,'Private task')",[family,owner.id]);
    await q("insert into public.bills(family_id,user_id,title,amount,due_date) values($1,$2,'Private bill',100.01,current_date)",[family,owner.id]);
    await q("insert into public.appointments(family_id,user_id,title,appointment_at) values($1,$2,'Private appointment',now())",[family,owner.id]);
    await q("insert into public.family_members(family_id,user_id,name) values($1,$2,'Private assignment profile')",[family,owner.id]);
    await q("insert into public.financial_transactions(family_id,created_by,type,title,amount) values($1,$2,'expense','Private expense',10.01)",[family,owner.id]);
    const [{id:list}] = await q("insert into public.shopping_lists(family_id,created_by,title) values($1,$2,'Private shopping') returning id",[family,owner.id]);
    await q("insert into public.shopping_items(family_id,created_by,list_id,title) values($1,$2,$3,'Private item')",[family,owner.id,list]);
    await q(`insert into public.documents(id,family_id,owner_user_id,title,visibility,original_filename,mime_type,size_bytes,storage_path)
      values(gen_random_uuid(),$1,$2,'Shared household document','family','test.txt','text/plain',5,$3)`,[family,owner.id,`${family}/test/file`]);
    await q("insert into storage.objects(bucket_id,name) values('family-tree-photos',$1),('family-documents',$2)",[`${family}/${anchor}`,`${family}/test/file`]);
    const tables=['tasks','bills','appointments','family_members','financial_transactions','shopping_lists','shopping_items','documents','family_memberships','family_activity'];
    for(const table of tables) assert.ok((await q(`select * from public.${table} where family_id=$1`,[family])).length>0,`${table}: fixture must exist`);
    const [{id:share}] = await q('select public.invite_tree_viewer($1,$2) as id',[family,recipient.jibon_id]);
    await signIn(outsider); await db.exec('savepoint wrongshare');
    await assert.rejects(q('select public.respond_tree_share($1,true)',[share]), /unavailable/);
    await db.exec('rollback to wrongshare');
    await signIn(recipient);
    assert.deepEqual(await q('select * from public.tree_people where family_id=$1',[family]),[]);
    await q('select public.respond_tree_share($1,true)',[share]);
    assert.equal((await q('select id from public.tree_people where family_id=$1',[family])).length,1);
    assert.equal((await q("select name from storage.objects where bucket_id='family-tree-photos'" )).length,1);
    assert.deepEqual(await q("select name from storage.objects where bucket_id='family-documents'"),[]);
    for(const table of tables) assert.deepEqual(await q(`select * from public.${table} where family_id=$1`,[family]),[],`${table} leaked to tree viewer`);
    await db.exec('savepoint viewerwrite');
    await assert.rejects(q("insert into public.tree_people(family_id,name) values($1,'Intruder')",[family]), /row-level security/);
    await db.exec('rollback to viewerwrite');
    assert.deepEqual(await q("update public.tree_people set name='Intruder' where id=$1 returning id",[anchor]),[]);
    await signIn(owner); await q('select public.revoke_tree_share($1)',[share]);
    await signIn(recipient);
    assert.deepEqual(await q('select id from public.tree_people where family_id=$1',[family]),[]);
    assert.deepEqual(await q("select name from storage.objects where bucket_id='family-tree-photos'"),[]);
  });
  await scenario('task/bill/appointment CRUD, exact outstanding total, dates, and account isolation', async ({owner,outsider}) => {
    const family=owner.family_id;
    const [{id:task}] = await q("insert into public.tasks(family_id,user_id,title,due_date) values($1,$2,'Task',current_date-1) returning id",[family,owner.id]);
    const [{id:bill}] = await q("insert into public.bills(family_id,user_id,title,amount,due_date) values($1,$2,'Bill',123.45,current_date-1) returning id",[family,owner.id]);
    const [{id:appointment}] = await q("insert into public.appointments(family_id,user_id,title,appointment_at) values($1,$2,'Appointment',now()+interval '1 day') returning id",[family,owner.id]);
    assert.equal((await q('select count(*)::int as count from public.tasks where not is_completed and due_date<current_date'))[0].count,1);
    assert.equal((await q('select sum(amount)::text as total from public.bills where not is_paid'))[0].total,'123.45');
    assert.equal((await q('select count(*)::int as count from public.appointments where appointment_at>now()'))[0].count,1);
    await signIn(outsider);
    for(const table of ['tasks','bills','appointments']) {
      assert.deepEqual(await q(`select * from public.${table} where family_id=$1`,[family]),[]);
      assert.deepEqual(await q(`update public.${table} set title='Intruder' where family_id=$1 returning id`,[family]),[]);
      assert.deepEqual(await q(`delete from public.${table} where family_id=$1 returning id`,[family]),[]);
    }
    await signIn(owner);
    await q('update public.tasks set is_completed=true where id=$1',[task]);
    await q('update public.bills set is_paid=true where id=$1',[bill]);
    await q("update public.appointments set title='Updated appointment' where id=$1",[appointment]);
    assert.equal((await q('select count(*)::int as count from public.tasks where not is_completed and due_date<current_date'))[0].count,0);
    assert.equal((await q('select coalesce(sum(amount),0)::text as total from public.bills where not is_paid'))[0].total,'0');
    for(const [table,id] of [['tasks',task],['bills',bill],['appointments',appointment]])
      assert.equal((await q(`delete from public.${table} where id=$1 returning id`,[id])).length,1);
  });
  assert.equal(failures,0,`${failures} invitation regression(s) failed`);
}
