import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from './ark.mjs';
import {fixture,start} from './test-support.mjs';
test('after 100 registrations, code requests for known and unknown emails have the same SMTP failure response',async t=>{
 const {store}=fixture(t);
 for(let i=0;i<100;i++)store.db.prepare('INSERT INTO users(email) VALUES(?)').run(`user${i}@example.invalid`);
 let calls=0;const app=createApp({config:{key:'fake',model:'fake',endpoint:'https://example.invalid'},auth:store,origins:['https://example.invalid'],trustLoopbackProxy:true,mailer:{send:async()=>{calls++;throw Error('SMTP PRIVATE');}}});
 const base=await start(app);t.after(()=>app.close());
 const send=(email,ip)=>fetch(base+'/api/auth/code',{method:'POST',headers:{origin:'https://example.invalid','content-type':'application/json','x-real-ip':ip},body:JSON.stringify({email})});
 const known=await send('user0@example.invalid','192.0.2.1'),unknown=await send('new@example.invalid','192.0.2.2');
 assert.equal(known.status,503);assert.equal(unknown.status,503);assert.equal(calls,2);
 assert.deepEqual(await known.json(),await unknown.json());
 assert.equal(store.db.prepare('SELECT count(*) n FROM users').get().n,100);
});
