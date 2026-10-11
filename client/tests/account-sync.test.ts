import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AccountCoordinator,StaleResponse,type Resource} from '../src/core/account-sync';
const A={email:'a@example.invalid',context:'a'.repeat(32)},B={email:'b@example.invalid',context:'b'.repeat(32)};
const stamp=(revision:number,account=A)=>({owner:account.email,context:account.context,revision});
const setup=()=>{const c=new AccountCoordinator();assert.ok(c.settleProbe(c.beginProbe(),A));return c;};
test('session change, unknown identity and same-account relogin reject old results',()=>{
 const c=setup(),a=c.capture();assert.ok(c.valid(a));
 c.invalidate();assert.equal(c.valid(a),false);assert.throws(()=>c.capture());
 c.settleProbe(c.beginProbe(),A);assert.equal(c.valid(a),false); // same Cookie after quarantine still has a new local generation
 c.settleProbe(c.beginProbe(),B);assert.throws(()=>c.accept(a,'gallery',stamp(9)),StaleResponse);
 c.settleProbe(c.beginProbe(),{...A,context:'c'.repeat(32)});
 assert.equal(c.valid(a),false);assert.throws(()=>c.accept(c.capture(),'favorites',stamp(1)),StaleResponse);
});
test('latest session probe only: old refresh cannot replace a newer login or logout',()=>{
 const c=setup(),stale=c.beginProbe(),fresh=c.beginProbe();
 assert.ok(c.settleProbe(fresh,A));assert.equal(c.settleProbe(stale,B),false); // latest same-context confirmation must still order probes
 const old=c.beginProbe(),newer=c.beginProbe();
 assert.ok(c.settleProbe(newer,B));assert.equal(c.settleProbe(old,A),false);
 const queued=c.beginProbe();c.invalidate();assert.equal(c.settleProbe(queued,A),false);assert.equal(c.session,null);
});
test('both resources order GET/mutation responses, ABA caches, equal revisions and lock-wait rechecks',()=>{
 for(const resource of ['favorites','gallery'] as Resource[]){
  const c=setup(),t=c.capture();
  c.accept(t,resource,stamp(1));const old=stamp(1);
  c.accept(t,resource,stamp(3));assert.throws(()=>c.accept(t,resource,stamp(2)),StaleResponse);
  assert.equal(c.permit(t,resource,old),false);
  assert.deepEqual(c.accept(t,resource,stamp(3)),stamp(3));
  assert.equal(c.permit(t,resource,stamp(3),stamp(5)),false); // storage event not yet delivered
  assert.equal(c.known(A.email,resource),5);
  assert.throws(()=>c.accept(t,resource,stamp(4)),StaleResponse);
  c.accept(t,resource,stamp(5));assert.equal(c.permit(t,resource,stamp(5),stamp(5)),true);
  // Other account resource revisions do not establish our truth.
  assert.equal(c.observe(resource,stamp(8,B)),'mismatch');assert.equal(c.session,null);assert.equal(c.valid(t),false);
 }
});
test('owner/context metadata are not authentication and malformed revisions fail closed',()=>{
 const c=setup(),t=c.capture();
 for(const bad of [{},stamp(-1),stamp(1.5),stamp(Number.MAX_SAFE_INTEGER+1),{...stamp(1),context:''},{...stamp(1),owner:B.email}])assert.throws(()=>c.accept(t,'favorites',bad),StaleResponse);
 assert.equal(c.observe('gallery',stamp(1)),'newer');assert.equal(c.observe('gallery',stamp(1)),'same');
 c.invalidate();c.observe('gallery',stamp(100));assert.equal(c.session,null);assert.throws(()=>c.capture());
});
