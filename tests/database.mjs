import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { invitationScenarios } from './invitation-scenarios.mjs';
const legacyUser = '00000000-0000-4000-8000-000000000099';

const db = new PGlite({ extensions: { pgcrypto } });
let stage = 'platform bootstrap';
try {
  await db.exec(await readFile(new URL('./support/platform.sql', import.meta.url), 'utf8'));
  const migrations = (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  for (const file of migrations) {
    stage = file;
    const sql = (await readFile(`supabase/migrations/${file}`, 'utf8'))
      .replace('create extension if not exists pg_cron with schema pg_catalog;', '-- Test platform supplies cron registration only.');
    await db.exec(sql);
    if (file === '20261113130000_jibon_ai.sql') {
      await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'legacy@example.invalid','{"display_name":"Legacy user"}')`,[legacyUser]);
      await db.query(`insert into public.tasks(user_id,title,due_date) values($1,'Legacy task','2026-01-01')`,[legacyUser]);
      await db.query(`insert into public.bills(user_id,title,amount,due_date) values($1,'Legacy bill',100.01,'2026-01-01')`,[legacyUser]);
    }
    console.log(`PASS migration ${file}`);
  }
  stage='legacy record preservation';
  const {rows:legacy}=await db.query(`select t.title as task,b.title as bill,b.amount::text as amount,m.role
    from public.tasks t join public.bills b on b.family_id=t.family_id
    join public.family_memberships m on m.family_id=t.family_id and m.user_id=t.user_id where t.user_id=$1`,[legacyUser]);
  assert.deepEqual(legacy,[{task:'Legacy task',bill:'Legacy bill',amount:'100.01',role:'owner'}]);
  console.log('PASS legacy users, records, money, and ownership preserved across migration chain');
  for (const file of (await readdir('supabase/tests')).filter(f => f.endsWith('.sql')).sort()) {
    stage = file;
    await db.exec(await readFile(`supabase/tests/${file}`, 'utf8'));
    const { rows } = await db.query('select count(*)::int as count from auth.users');
    assert.equal(rows[0].count, 1, `${file} must roll back its test accounts and preserve legacy fixture`);
    console.log(`PASS SQL suite ${file}`);
  }
  stage = 'invitation edge cases';
  await invitationScenarios(db);
  stage = 'RLS audit';
  const { rows: unprotected } = await db.query(`select tablename from pg_tables
    where schemaname='public' and not rowsecurity`);
  assert.deepEqual(unprotected, [], 'Every application table must enable RLS');
  const { rows: [privileges] } = await db.query(`select
    has_function_privilege('authenticated','app_private.complete_relationship_aware_family_invitation(public.family_invitations,uuid)','execute') as client_helper,
    has_function_privilege('anon','public.accept_family_invitation(uuid)','execute') as anonymous_accept,
    has_function_privilege('anon','public.update_my_tree_profile(uuid,text,integer,integer,text,text)','execute') as anonymous_profile,
    has_function_privilege('authenticated','public.update_my_tree_profile(uuid,text,integer,integer,text,text)','execute') as signed_in_profile`);
  assert.deepEqual(privileges, {client_helper:false, anonymous_accept:false, anonymous_profile:false, signed_in_profile:true});
  console.log('PASS invitation/profile function privilege boundaries');
  console.log(`PASS RLS audit; ${migrations.length} migrations; isolated test database disposed after run`);
} catch (error) {
  console.error(`FAIL ${stage}: ${error.message}`);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
