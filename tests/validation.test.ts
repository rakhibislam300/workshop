import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeAuthNext } from '../src/lib/auth-redirect';
import { familyInvitationInput, billInput, taskInput, familyAssistantProposal, familyAssistantProposalToInput } from '../src/lib/validation';
import { relationshipToViewer, treeLayout, type TreePerson, type TreeEdge } from '../src/lib/family-tree';

test('auth preserves invitation context and rejects external redirect paths', () => {
  const invitation='/invitations/accept?token=00000000-0000-4000-8000-000000000001';
  assert.equal(safeAuthNext(invitation),invitation);
  for(const input of ['//evil.example','/\\evil.example','/\t/evil.example','https://evil.example','javascript:alert(1)',undefined])
    assert.equal(safeAuthNext(input),'/dashboard');
});
test('invitation requires one recipient, a name, known relationship and UUID anchor', () => {
  const invitation={email:'test@example.invalid',invitee_name:' Son ',invitee_relationship:'son',inviter_tree_person_id:'00000000-0000-4000-8000-000000000001'};
  assert.equal(familyInvitationInput.parse(invitation).invitee_name,'Son');
  for(const bad of [{invitee_name:''},{invitee_relationship:'invented'},{inviter_tree_person_id:'bad'},{jibon_id:'JBN-U-0123456789'},{email:undefined}])
    assert.equal(familyInvitationInput.safeParse({...invitation,...bad}).success,false);
});
test('invalid calendar dates cannot pass manual or AI task validation', () => {
  const task={title:'Visit',priority:'medium'};
  assert.equal(taskInput.safeParse({...task,due_date:'2024-02-29'}).success,true);
  for(const due_date of ['2025-02-29','2026-02-30','2026-13-01'])
    assert.equal(taskInput.safeParse({...task,due_date}).success,false);
});
test('bill requires an explicit amount, never silently coerces null to zero', () => {
  const bill={title:'Bill',category:'Home',due_date:'2026-11-16'};
  assert.equal(billInput.safeParse({...bill,amount:'123.45'}).success,true);
  assert.equal(billInput.safeParse({...bill,amount:0}).success,true);
  for(const amount of [null,'',true,undefined,-1]) assert.equal(billInput.safeParse({...bill,amount}).success,false);
});
test('AI bill with missing amount is incomplete and updates require a target', () => {
  const fields={title:'Bill',description:null,due_date:'2026-11-16',priority:null,assigned_member_id:null,amount:null,category:'Home',is_paid:null,appointment_at:null,location:null};
  const proposal=familyAssistantProposal.parse({operation:'create',entity:'bill',record_id:null,fields});
  assert.equal(familyAssistantProposalToInput(proposal).success,false);
  assert.equal(familyAssistantProposal.safeParse({...proposal,operation:'update'}).success,false);
});
test('tree shows declared relation from the viewer and keeps both parents aligned', () => {
  const people:TreePerson[]=['mother','father','son'].map(id=>({id,family_id:'test',name:id,birth_year:null,death_year:null,biography:'',birthplace:'',updated_at:''}));
  const edges:TreeEdge[]=[{id:'a',from_person:'son',to_person:'mother',kind:'son'},{id:'b',from_person:'son',to_person:'father',kind:'son'}];
  assert.equal(relationshipToViewer('mother','son',edges),'Your son.');
  assert.equal(relationshipToViewer('son','mother',edges),'Your parent.');
  const layout=treeLayout(people,edges);
  assert.equal(layout.positions.get('mother')?.y,layout.positions.get('father')?.y);
  assert.ok(layout.positions.get('son')!.y > layout.positions.get('mother')!.y);
});
