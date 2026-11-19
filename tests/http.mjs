import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL || 'http://localhost:3000';
const id='00000000-0000-4000-8000-000000000001';
let checked=0;
const request=async(path,options={})=>fetch(base+path,{redirect:'manual',signal:AbortSignal.timeout(10000),...options});
for(const path of ['/api/family-invitations/inbox',`/api/families/${id}/invitations`,'/api/tree-shares',`/api/family-tree?family_id=${id}`,'/api/relative-connections',`/api/calendar/export?family_id=${id}`]) {
  const r=await request(path); assert.equal(r.status,401,path); checked++;
}
for(const [path,body] of [
  ['/api/family-invitations/accept',{token:id}],['/api/family-invitations/inbox',{id}],
  [`/api/families/${id}/invitations`,{email:'test@example.invalid',invitee_name:'Test',invitee_relationship:'son',inviter_tree_person_id:id}],
  ['/api/family-tree/me',{family_id:id}],['/api/smart-add',{input:'A test'}],['/api/family-assistant/execute',{}],
]) {
  const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
  assert.equal((await request(path,options)).status,401,`${path} requires a session`); checked++;
  assert.equal((await request(path,{...options,headers:{...options.headers,Origin:'https://untrusted.invalid'}})).status,403,`${path} rejects cross-origin`); checked++;
}
for(const path of ['/api/family-invitations/accept','/api/family-invitations/inbox']) {
  assert.equal((await request(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400,`${path} malformed JSON`); checked++;
}
const external=await request('/auth/callback?next=%2F%2Fevil.example');
const destination=new URL(external.headers.get('location'),base);
assert.equal(destination.origin,new URL(base).origin,'Callback cannot redirect to another origin'); checked++;
const invitation=`/invitations/accept?token=${id}`;
const accept=await request(invitation);
// App Router can start streaming before an asynchronous auth check redirects.
const acceptHtml=await accept.text();
const streamedRedirect=acceptHtml.match(/NEXT_REDIRECT;replace;([^;]+);307;/)?.[1];
assert.ok([303,307].includes(accept.status) || (accept.status===200 && streamedRedirect),'Unauthenticated invitation page must redirect');
const login=new URL(accept.headers.get('location') || streamedRedirect,base);
assert.equal(login.pathname,'/auth/login'); assert.equal(login.searchParams.get('next'),invitation); checked++;
for(const path of [login.pathname+login.search,`/auth/register?next=${encodeURIComponent(invitation)}`]) {
  const r=await request(path); assert.equal(r.status,200,path);
  assert.ok((await r.text()).includes(encodeURIComponent(invitation)),'Switching auth forms preserves invitation'); checked++;
}
console.log(`PASS ${checked} localhost HTTP checks (auth, origins, JSON, redirect safety, invitation return path)`);
