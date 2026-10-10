import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// The platform layer talks to `uni`, which the mini-program/H5 runtime provides.
// A tiny in-memory implementation lets us drive the storage rules directly.
const store=new Map<string,string>();
(globalThis as unknown as {uni:unknown}).uni={
 getStorageSync:(key:string)=>store.get(key)??'',
 setStorageSync:(key:string,value:string)=>{store.set(key,value);},
};
const {loadGenerations,storeGenerations,mutateGenerations}=await import('../src/platform/index');

const jpegB64=readFileSync(new URL('../src/static/catalog/ai-catalog-44-0.jpg',import.meta.url)).toString('base64');
const image='data:image/jpeg;base64,'+jpegB64;
const record=(id:string)=>({id,name:'庞巴杜发型',image,created:'2026-10-10T00:00:00.000Z',source:'ai' as const});

test('a concurrent writer cannot resurrect a deleted generation',async()=>{
 store.set('hairplay.generations.v1',JSON.stringify([record('gen-a'),record('gen-b')]));
 // Another tab re-writes its stale snapshot (still containing gen-a) between our
 // write and our read-back, exactly once.
 const realSet=store.set.bind(store) as (k:string,v:string)=>void;
 let interfered=false;
 const originalSetItem=(globalThis as unknown as {uni:{setStorageSync:(k:string,v:string)=>void}}).uni.setStorageSync;
 (globalThis as unknown as {uni:{setStorageSync:(k:string,v:string)=>void}}).uni.setStorageSync=(k,v)=>{
  originalSetItem(k,v);
  if(!interfered&&k==='hairplay.generations.v1'){interfered=true;realSet(k,JSON.stringify([record('gen-a'),record('gen-b')]));}
 };
 const result=await mutateGenerations(list=>list.filter(r=>r.id!=='gen-a'));
 (globalThis as unknown as {uni:{setStorageSync:(k:string,v:string)=>void}}).uni.setStorageSync=originalSetItem;
 assert.equal(result.ok,true,result.message);
 assert.equal(interfered,true);
 assert.deepEqual(loadGenerations().map(r=>r.id),['gen-b'],'the deletion must survive the stale write');
});

test('a write that never sticks is reported, never faked',async()=>{
 store.set('hairplay.generations.v1',JSON.stringify([record('gen-a')]));
 const originalSetItem=(globalThis as unknown as {uni:{setStorageSync:(k:string,v:string)=>void}}).uni.setStorageSync;
 // A no-op writer: every attempt silently loses the write.
 (globalThis as unknown as {uni:{setStorageSync:(k:string,v:string)=>void}}).uni.setStorageSync=()=>{};
 const result=await mutateGenerations(list=>list.filter(r=>r.id!=='gen-a'));
 (globalThis as unknown as {uni:{setStorageSync:(k:string,v:string)=>void}}).uni.setStorageSync=originalSetItem;
 assert.equal(result.ok,false);
 assert.match(result.message,/未生效|失败/);
 assert.deepEqual(loadGenerations().map(r=>r.id),['gen-a']);
});

test('the writer refuses a payload the reader would only drop',()=>{
 for(const bad of ['data:image/jpeg;base64,/9j/'+'A'.repeat(2_000),'data:image/png;base64,AAAA',image.slice(0,-8)+'AAAAAAAA']){
  assert.match(storeGenerations([{...record('gen-x'),image:bad}]),/格式无效|过大/);
 }
 assert.equal(storeGenerations([record('gen-x')]),'');
 assert.equal(loadGenerations().length,1);
 assert.match(storeGenerations(Array.from({length:7},(_,i)=>record(`gen-${i}`))),/最多保留 6 张/);
});

test('a browser without Web Locks fails closed instead of writing unlocked',async()=>{
 store.set('hairplay.generations.v1',JSON.stringify([record('gen-a'),record('gen-b')]));
 const nav=globalThis.navigator as unknown as {locks?:unknown};
 const hadLocks=Object.prototype.hasOwnProperty.call(nav,'locks'),previous=nav.locks;
 Object.defineProperty(globalThis,'window',{value:{},configurable:true});
 nav.locks=undefined;
 try{
  const result=await mutateGenerations(list=>list.filter(r=>r.id!=='gen-a'));
  assert.equal(result.ok,false,'an unsynchronized runtime must not report success');
  assert.match(result.message,/Web Locks/);
  assert.deepEqual(loadGenerations().map(r=>r.id),['gen-a','gen-b'],'nothing may be written without a lock');
 }finally{
  if(hadLocks)nav.locks=previous;else delete nav.locks;
  delete (globalThis as unknown as {window?:unknown}).window;
 }
});

test('a browser with Web Locks serializes the read-modify-write under the storage lock',async()=>{
 store.set('hairplay.generations.v1',JSON.stringify([record('gen-a'),record('gen-b')]));
 const nav=globalThis.navigator as unknown as {locks?:unknown};
 const hadLocks=Object.prototype.hasOwnProperty.call(nav,'locks'),previous=nav.locks;
 const names:string[]=[],held:string[]=[];
 Object.defineProperty(globalThis,'window',{value:{},configurable:true});
 nav.locks={request:async(name:string,options:unknown,fn:()=>Promise<void>)=>{
  assert.equal((options as {signal?:unknown}|undefined)?.signal instanceof AbortSignal,true,'acquisition must be bounded by a timeout signal');
  while(held.includes(name))await new Promise(r=>setTimeout(r,1));
  names.push(name);held.push(name);
  try{await fn();}finally{held.splice(held.indexOf(name),1);}
 }};
 try{
  const result=await mutateGenerations(list=>list.filter(r=>r.id!=='gen-a'));
  assert.equal(result.ok,true,result.message);
  assert.deepEqual(names,['hairplay.storage.hairplay.generations.v1'],'the lock name must derive from the storage key');
  assert.deepEqual(loadGenerations().map(r=>r.id),['gen-b']);
 }finally{
  if(hadLocks)nav.locks=previous;else delete nav.locks;
  delete (globalThis as unknown as {window?:unknown}).window;
 }
});
