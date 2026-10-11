import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {AuthStore} from './auth.mjs';
const bytes=readFileSync(new URL('../client/src/static/catalog/ai-catalog-53-0.jpg',import.meta.url));
test('real legacy gallery migration is process-safe, preserves images and dedupes retries',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'hairplay-migration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'old.sqlite'),db=new DatabaseSync(path);
 // Exact gallery schema from 68c22d9 (no hash). No mock database.
 db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT NOT NULL UNIQUE); CREATE TABLE gallery(id TEXT PRIMARY KEY,user INTEGER NOT NULL,name TEXT NOT NULL,style TEXT,created INTEGER NOT NULL,size INTEGER NOT NULL,bytes BLOB NOT NULL);');
 db.prepare('INSERT INTO users VALUES(?,?)').run(1,'legacy@example.invalid');
 db.prepare('INSERT INTO gallery VALUES(?,?,?,?,?,?,?)').run('a'.repeat(24),1,'旧图',null,123,bytes.length,bytes);db.close();
 const code=`import {AuthStore} from ${JSON.stringify(new URL('./auth.mjs',import.meta.url).href)};const s=new AuthStore(${JSON.stringify(path)});s.close();`;
 await Promise.all([1,2,3].map(()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--input-type=module','-e',code]);let err='';child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('exit',rc=>rc===0?resolve():reject(Error(err)));})));
 const store=new AuthStore(path);t.after(()=>store.close());
 assert.equal(store.countImages(1),1);assert.deepEqual(Buffer.from(store.image(1,'a'.repeat(24)).bytes),bytes);
 assert.equal(store.addImage(1,{name:'重试'},bytes).id,'a'.repeat(24));assert.equal(store.countImages(1),1);
 const other=readFileSync(new URL('../client/src/static/catalog/ai-dracula.jpg',import.meta.url));store.addImage(1,{name:'新图'},other);assert.equal(store.countImages(1),2);
 assert.ok(store.db.prepare('PRAGMA index_list(gallery)').all().some(i=>i.name==='gallery_user_hash'));
});
