import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AuthStore} from './auth.mjs';
export function fixture(t){const dir=mkdtempSync(join(tmpdir(),'hairplay-auth-'));let time=Date.now();const path=join(dir,'auth.sqlite');const store=new AuthStore(path,{now:()=>time});t.after(()=>{try{store.close();}catch{}rmSync(dir,{recursive:true,force:true});});return {store,path,advance:n=>time+=n,now:()=>time};}
export function login(store,email='test@example.invalid',ip='test'){const code=store.issue(email,ip);return store.verify(email,code);}
export function start(app){return new Promise(resolve=>app.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+app.address().port)));}
