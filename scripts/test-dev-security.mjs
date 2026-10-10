// Regression for Vite file-server bypasses. Uses ONLY a fake fixture, never reads credentials.
import {spawn} from 'node:child_process';
import {writeFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const fixture=resolve(root,'.secrets/__dev-security-fake.txt');
const port=18765,base=`http://127.0.0.1:${port}`;
writeFileSync(fixture,'not-a-real-secret-fixture\n',{mode:0o600,flag:'wx'});
const child=spawn(process.execPath,[resolve(root,'node_modules/.bin/uni'),'--host','127.0.0.1','--port',String(port),'--strictPort'],{cwd:resolve(root,'client'),detached:process.platform!=='win32',stdio:'ignore'});
try{
 let ready=false;
 for(let n=0;n<90;n++){
  if(child.exitCode!==null)throw Error('Vite exited before readiness');
  try{const r=await fetch(base+'/');if(r.ok){ready=true;break;}}catch{}
  await new Promise(r=>setTimeout(r,250));
 }
 assert.ok(ready,'Vite preview did not start');
 for(const path of [fixture,resolve(root,'package.json')])for(const suffix of ['','?import&raw','?raw??']){
  const r=await fetch(base+'/@fs/'+path+suffix,{headers:{origin:'https://attacker.example'}});
  const text=await r.text();
  assert.equal(r.status,403,`Forbidden /@fs path was exposed: ${path} ${suffix}`);
  assert.ok(!text.includes('not-a-real-secret-fixture'));
  assert.notEqual(r.headers.get('access-control-allow-origin'),'*');
 }
 const r=await fetch(base+'/@fs/'+resolve(root,'package.json')+'?import&raw',{headers:{host:'evil.example',origin:'https://attacker.example'}});
 assert.equal(r.status,403);
 console.log('Vite file access, ?raw bypass, CORS and forged Host regressions: PASS');
}finally{
 if(child.exitCode===null){try{if(process.platform==='win32')child.kill();else process.kill(-child.pid,'SIGTERM');}catch{child.kill();}}
 rmSync(fixture,{force:true});
}
