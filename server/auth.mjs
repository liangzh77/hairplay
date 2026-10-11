import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,statSync,lstatSync,openSync,closeSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {randomBytes,randomInt,createHash,createHmac,timingSafeEqual} from 'node:crypto';
export const normalizeEmail=v=>typeof v==='string'?v.trim().toLowerCase():'';
export const validEmail=email=>typeof email==='string'&&email.length<=254&&/^[a-z0-9.!#$%&'*+\/?=^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email);
export const validGender=gender=>gender===null||gender==='male'||gender==='female';
// Cloud copies of generated pictures. Imports do not consume the lifetime
// generation quota, so the album size cannot be inferred from it: this cap is
// enforced for both paths, which is the only way "the cloud album never exceeds
// the quota" stays true for an account that imported pictures as well.
export const GALLERY_LIMIT=3;
export const GALLERY_MAX_BYTES=4*1024*1024;
// Style ids the client may favourite; anything else is refused, so a stolen
// session cannot turn the account row into arbitrary storage.
export const validStyleId=id=>typeof id==='string'&&/^[a-z0-9-]{1,40}$/.test(id);
export const FAVORITE_LIMIT=50;
export class AuthStore{
 constructor(path,{now=Date.now}={}){
  if(!path||path===':memory:')throw Error('Persistent database required');
  mkdirSync(dirname(resolve(path)),{recursive:true,mode:0o700});
  try{if(!lstatSync(path).isFile())throw Error('Database must be a regular file');}catch(e){if(e.code!=='ENOENT')throw e;}
  try{closeSync(openSync(path,'wx',0o600));}catch(e){if(e.code!=='EEXIST')throw e;}
  chmodSync(path,0o600);this.db=new DatabaseSync(path);this.now=now;
  this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY,v TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT NOT NULL UNIQUE);
   CREATE TABLE IF NOT EXISTS codes(email TEXT PRIMARY KEY,hash TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS sends(id INTEGER PRIMARY KEY,ip TEXT NOT NULL,email TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS sends_created ON sends(created);
   CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user INTEGER NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,user INTEGER NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS jobs_user ON jobs(user,state);
   CREATE TABLE IF NOT EXISTS gallery(id TEXT PRIMARY KEY,user INTEGER NOT NULL,name TEXT NOT NULL,style TEXT,created INTEGER NOT NULL,size INTEGER NOT NULL,bytes BLOB NOT NULL,hash TEXT);
   CREATE INDEX IF NOT EXISTS gallery_user ON gallery(user,created);
   CREATE TABLE IF NOT EXISTS favorites(user INTEGER PRIMARY KEY,ids TEXT NOT NULL,updated INTEGER NOT NULL);
  `);
  // Serialize check + migration across processes; legacy rows keep gender NULL.
  this.db.exec('BEGIN IMMEDIATE');
  try{
   if(!this.db.prepare('PRAGMA table_info(users)').all().some(col=>col.name==='gender'))this.db.exec("ALTER TABLE users ADD COLUMN gender TEXT CHECK(gender IN ('male','female') OR gender IS NULL)");
   // The content hash is what makes an import idempotent; older databases (a
   // rehearsal, or a release from before the column existed) are migrated here.
   if(!this.db.prepare('PRAGMA table_info(gallery)').all().some(col=>col.name==='hash'))this.db.exec('ALTER TABLE gallery ADD COLUMN hash TEXT');
   this.db.exec('CREATE INDEX IF NOT EXISTS gallery_user_hash ON gallery(user,hash)');
   // Preserve positional INSERTs in the real rollback targets. Transfer the
   // unpublished four-column intermediate schema without replacing the DB.
   this.db.exec('CREATE TABLE IF NOT EXISTS session_contexts(hash TEXT PRIMARY KEY,context TEXT NOT NULL UNIQUE)');
   if(this.db.prepare('PRAGMA table_info(sessions)').all().some(col=>col.name==='context')){
    this.db.exec(`INSERT OR IGNORE INTO session_contexts SELECT hash,context FROM sessions WHERE context IS NOT NULL;
     ALTER TABLE sessions DROP COLUMN context;`);
   }
   this.db.exec(`CREATE TRIGGER IF NOT EXISTS session_context_cleanup AFTER DELETE ON sessions BEGIN DELETE FROM session_contexts WHERE hash=OLD.hash; END;
    DELETE FROM session_contexts WHERE hash NOT IN (SELECT hash FROM sessions);`);
   const sessionContext=this.db.prepare('INSERT INTO session_contexts(hash,context) VALUES(?,?)');
   for(const row of this.db.prepare('SELECT hash FROM sessions WHERE hash NOT IN (SELECT hash FROM session_contexts)').all())sessionContext.run(row.hash,randomBytes(16).toString('hex'));
   this.db.exec(`CREATE TABLE IF NOT EXISTS resource_revisions(user INTEGER PRIMARY KEY,favorites INTEGER NOT NULL DEFAULT 0,gallery INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO resource_revisions SELECT users.id,EXISTS(SELECT 1 FROM favorites WHERE user=users.id),EXISTS(SELECT 1 FROM gallery WHERE user=users.id) FROM users;`);
   // Triggers survive rollback to services unaware of revision counters.
   // Actual legacy writes, including ABA, advance the persistent versions.
   this.db.exec(`CREATE TRIGGER IF NOT EXISTS revision_favorites_insert AFTER INSERT ON favorites BEGIN
     INSERT INTO resource_revisions(user) SELECT NEW.user WHERE NOT EXISTS(SELECT 1 FROM resource_revisions WHERE user=NEW.user);
     UPDATE resource_revisions SET favorites=favorites+1 WHERE user=NEW.user; END;
    CREATE TRIGGER IF NOT EXISTS revision_favorites_update AFTER UPDATE OF ids ON favorites WHEN NEW.ids IS NOT OLD.ids BEGIN
     INSERT INTO resource_revisions(user) SELECT NEW.user WHERE NOT EXISTS(SELECT 1 FROM resource_revisions WHERE user=NEW.user);
     UPDATE resource_revisions SET favorites=favorites+1 WHERE user=NEW.user; END;
    CREATE TRIGGER IF NOT EXISTS revision_favorites_delete AFTER DELETE ON favorites BEGIN
     INSERT INTO resource_revisions(user) SELECT OLD.user WHERE NOT EXISTS(SELECT 1 FROM resource_revisions WHERE user=OLD.user);
     UPDATE resource_revisions SET favorites=favorites+1 WHERE user=OLD.user; END;
    CREATE TRIGGER IF NOT EXISTS revision_gallery_insert AFTER INSERT ON gallery BEGIN
     INSERT INTO resource_revisions(user) SELECT NEW.user WHERE NOT EXISTS(SELECT 1 FROM resource_revisions WHERE user=NEW.user);
     UPDATE resource_revisions SET gallery=gallery+1 WHERE user=NEW.user; END;
    CREATE TRIGGER IF NOT EXISTS revision_gallery_delete AFTER DELETE ON gallery BEGIN
     INSERT INTO resource_revisions(user) SELECT OLD.user WHERE NOT EXISTS(SELECT 1 FROM resource_revisions WHERE user=OLD.user);
     UPDATE resource_revisions SET gallery=gallery+1 WHERE user=OLD.user; END;`);
   // Backfill legacy pictures without changing their ids or bytes.
   const update=this.db.prepare('UPDATE gallery SET hash=? WHERE id=?');
   for(const row of this.db.prepare('SELECT id,bytes FROM gallery WHERE hash IS NULL').all())update.run(createHash('sha256').update(row.bytes).digest('hex'),row.id);
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  this.db.prepare('INSERT OR IGNORE INTO meta VALUES (?,?)').run('pepper',randomBytes(32).toString('hex'));
  this.pepper=this.db.prepare('SELECT v FROM meta WHERE k=?').get('pepper').v;
  for(const suffix of ['-wal','-shm']){try{chmodSync(path+suffix,0o600);}catch{}}
  if(statSync(path).mode&0o077)throw Error('Unsafe database permissions');
 }
 hash(v){return createHmac('sha256',this.pepper).update(v).digest('hex');}
 tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 issue(email,ip){
  if(!validEmail(email))throw Object.assign(Error('请输入有效邮箱'),{status:400});
  return this.tx(()=>{
   const n=this.now();this.db.prepare('DELETE FROM sends WHERE created<?').run(n-3600000);
   const recent=this.db.prepare('SELECT created FROM sends WHERE (email=? OR ip=?) AND created>?').all(email,ip,n-3600000);
   const counts=this.db.prepare('SELECT SUM(email=?) AS e,SUM(ip=?) AS i FROM sends WHERE created>?').get(email,ip,n-3600000);
   const total=this.db.prepare('SELECT count(*) n FROM sends').get().n;
   if(recent.some(r=>n-r.created<60000)||counts.e>=5||counts.i>=5||total>=100)throw Object.assign(Error('发送过于频繁，请稍后重试'),{status:429});
   this.db.prepare('INSERT INTO sends(ip,email,created) VALUES(?,?,?)').run(ip,email,n);
   // Treat known and unknown addresses identically even when registration is full.
   // Otherwise SMTP failures/timing reveal which addresses are registered.
   const previous=this.db.prepare('SELECT hash FROM codes WHERE email=?').get(email)?.hash;
   let code,hash;do{code=String(randomInt(0,1000000)).padStart(6,'0');hash=this.hash(email+':'+code);}while(hash===previous);
   this.db.prepare('INSERT OR REPLACE INTO codes VALUES(?,?,?,0)').run(email,hash,n+600000);
   return code;
  });
 }
 invalidate(email,code){this.db.prepare('DELETE FROM codes WHERE email=? AND hash=?').run(email,this.hash(email+':'+code));}
 verify(email,code,gender=null){if(!validGender(gender))throw Object.assign(Error('请选择男、女或不填写'),{status:400});return this.tx(()=>{
  const n=this.now(),row=this.db.prepare('SELECT * FROM codes WHERE email=?').get(email);
  const hash=this.hash(email+':'+String(code));
  if(!row||row.expires<=n||row.attempts>=5)return null;
  this.db.prepare('UPDATE codes SET attempts=attempts+1 WHERE email=?').run(email);
  if(typeof code!=='string'||!/^\d{6}$/.test(code)||!timingSafeEqual(Buffer.from(hash),Buffer.from(row.hash)))return null;
  this.db.prepare('DELETE FROM codes WHERE email=?').run(email);
  let user=this.db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if(!user){if(this.db.prepare('SELECT count(*) n FROM users').get().n>=100)return null;this.db.prepare('INSERT INTO users(email,gender) VALUES(?,?)').run(email,gender);user=this.db.prepare('SELECT * FROM users WHERE email=?').get(email);}
  const token=randomBytes(32).toString('base64url');this.db.prepare('DELETE FROM sessions WHERE expires<=?').run(n);
  const sessionHash=this.hash(token);
  this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sessionHash,user.id,n+7*86400000);
  this.db.prepare('INSERT INTO session_contexts VALUES(?,?)').run(sessionHash,randomBytes(16).toString('hex'));return token;
 });}
 session(token){if(!token||! /^[A-Za-z0-9_-]{43}$/.test(token))return null;return this.tx(()=>{
  const hash=this.hash(token),row=this.db.prepare('SELECT users.*,session_contexts.context FROM sessions JOIN users ON user=users.id LEFT JOIN session_contexts ON session_contexts.hash=sessions.hash WHERE sessions.hash=? AND expires>?').get(hash,this.now());
  if(!row)return null;
  // Old processes can insert after constructor backfill. Serialize lazy fill.
  if(!row.context){row.context=randomBytes(16).toString('hex');this.db.prepare('INSERT INTO session_contexts VALUES(?,?)').run(hash,row.context);}
  return row;
 });}
 logout(token){if(token)this.db.prepare('DELETE FROM sessions WHERE hash=?').run(this.hash(token));}
 setGender(user,gender){if(!validGender(gender))throw Object.assign(Error('请选择男、女或不填写'),{status:400});this.db.prepare('UPDATE users SET gender=? WHERE id=?').run(gender,user);}
 recover(){this.db.prepare("UPDATE jobs SET state='failed' WHERE state='pending' AND created<?").run(this.now()-600000);}
 remaining(user){this.recover();return Math.max(0,3-this.db.prepare("SELECT count(*) n FROM jobs WHERE user=? AND state IN ('success','pending')").get(user).n);}
 reserve(user){return this.tx(()=>{if(this.remaining(user)<1)return null;
  if(this.db.prepare("SELECT count(*) n FROM jobs WHERE state='pending' OR created>?").get(this.now()-3600000).n>=3||this.db.prepare("SELECT count(*) n FROM jobs WHERE state='pending'").get().n>0)throw Object.assign(Error('生成繁忙或达到每小时服务预算'),{status:429});
  const id=randomBytes(16).toString('hex');this.db.prepare("INSERT INTO jobs VALUES(?,?,'pending',?)").run(id,user,this.now());return id;});}
 finish(id,ok){this.db.prepare("UPDATE jobs SET state=? WHERE id=? AND state='pending'").run(ok?'success':'failed',id);}
 // The stored picture and the consumed quota are one commit: a successful
 // generation is never charged without its cloud copy, and a rolled back insert
 // (bad bytes, full disk, full album) leaves the job pending so `finish(id,false)`
 // refunds the quota. The cap applies to this path too — a generation must not be
 // the fourth row of an account that spent its three slots on imports.
 #addImage(user,meta,bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<1024||bytes.length>GALLERY_MAX_BYTES)throw Object.assign(Error('图片大小无效'),{status:400});
  // Identical bytes are the same picture: a retry after a failed local cache
  // write, or a second tap on「同步到云端」, must return the existing row instead
  // of spending another slot or filling the album with duplicates.
  const hash=createHash('sha256').update(bytes).digest('hex');
  const seen=this.db.prepare('SELECT id,created FROM gallery WHERE user=? AND hash=?').get(user,hash);
  if(seen)return {id:seen.id,created:seen.created};
  if(this.db.prepare('SELECT count(*) n FROM gallery WHERE user=?').get(user).n>=GALLERY_LIMIT)throw Object.assign(Error('云端相册最多保存 '+GALLERY_LIMIT+' 张图片，请先删除一张再试'),{status:429});
  const id=randomBytes(12).toString('hex'),created=this.now();
  this.db.prepare('INSERT INTO gallery VALUES(?,?,?,?,?,?,?,?)').run(id,user,String(meta?.name||'AI 发型').slice(0,60)||'AI 发型',validStyleId(meta?.style)?meta.style:null,created,bytes.length,bytes,hash);
  return {id,created};
 }
 revision(user,resource){if(!['favorites','gallery'].includes(resource))throw Error('Unknown resource');return this.db.prepare(`SELECT ${resource} revision FROM resource_revisions WHERE user=?`).get(user)?.revision??0;}
 #gallerySnapshot(user){return {images:this.listImages(user),revision:this.revision(user,'gallery')};}
 gallerySnapshot(user){return this.tx(()=>this.#gallerySnapshot(user));}
 #favoritesSnapshot(user){const ids=this.favorites(user);return {ids:ids??[],initialized:ids!==null,revision:this.revision(user,'favorites')};}
 favoritesSnapshot(user){return this.tx(()=>this.#favoritesSnapshot(user));}
 imageSnapshot(user,id){return this.tx(()=>({image:this.image(user,id),revision:this.revision(user,'gallery')}));}
 finishWithImage(id,meta,bytes){return this.tx(()=>{
  const row=this.db.prepare("SELECT user FROM jobs WHERE id=? AND state='pending'").get(id);
  if(!row)return null;
  const saved=this.#addImage(row.user,meta,bytes);
  this.db.prepare("UPDATE jobs SET state='success' WHERE id=? AND state='pending'").run(id);
  return {...saved,...this.#gallerySnapshot(row.user)};});}
 addImage(user,meta,bytes){return this.tx(()=>({...this.#addImage(user,meta,bytes),...this.#gallerySnapshot(user)}));}
 // Newest first; picture ids are random, so the rowid (insertion order) is the
 // tie-break: two pictures added in the same millisecond must not swap order
 // between reloads.
 listImages(user){return this.db.prepare('SELECT id,name,style,created,size FROM gallery WHERE user=? ORDER BY created DESC,rowid DESC').all(user);}
 image(user,id){return this.db.prepare('SELECT name,style,created,size,bytes FROM gallery WHERE id=? AND user=?').get(id,user)||null;}
 deleteImage(user,id){return this.deleteImageSnapshot(user,id).deleted;}
 deleteImageSnapshot(user,id){return this.tx(()=>{const deleted=this.db.prepare('DELETE FROM gallery WHERE id=? AND user=?').run(id,user).changes>0;return {deleted,...this.#gallerySnapshot(user)};});}
 countImages(user){return this.db.prepare('SELECT count(*) n FROM gallery WHERE user=?').get(user).n;}
 // `null` means the account never stored favourites (first sync adopts the local
 // list); `[]` means the account deliberately has none, so the empty list wins.
 favorites(user){const row=this.db.prepare('SELECT ids FROM favorites WHERE user=?').get(user);if(!row)return null;
  try{const ids=JSON.parse(row.ids);return Array.isArray(ids)?ids.filter(validStyleId).slice(0,FAVORITE_LIMIT):[];}catch{return [];}}
 setFavorites(user,ids){return this.tx(()=>this.#setFavorites(user,ids));}
 #setFavorites(user,ids){
  this.db.prepare('INSERT INTO favorites VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET ids=excluded.ids,updated=excluded.updated').run(user,JSON.stringify(ids),this.now());
 }
 // Adopting this device's list is only allowed while the account has no list of
 // its own. Afterwards every change is one atomic add/remove on the server's
 // current list, so two devices editing from stale snapshots cannot resurrect a
 // favourite the other one just removed.
 adoptFavorites(user,ids){return this.tx(()=>{
  if(this.db.prepare('SELECT ids FROM favorites WHERE user=?').get(user))return {...this.#favoritesSnapshot(user),conflict:true};
  const unique=[...new Set(ids)].slice(0,FAVORITE_LIMIT);this.#setFavorites(user,unique);return {...this.#favoritesSnapshot(user),conflict:false};});}
 addFavorite(user,styleId){return this.tx(()=>{
  const current=this.favorites(user)??[];
  if(current.includes(styleId))return this.#favoritesSnapshot(user);
  if(current.length>=FAVORITE_LIMIT)throw Object.assign(Error('最多收藏 '+FAVORITE_LIMIT+' 个模板，请先取消一个'),{status:429});
  const ids=[styleId,...current];this.#setFavorites(user,ids);return this.#favoritesSnapshot(user);});}
 removeFavorite(user,styleId){return this.tx(()=>{
  const current=this.favorites(user)??[],ids=current.filter(id=>id!==styleId);
  // The row is written even when nothing changed, so the removal is recorded for
  // the other devices instead of leaving the account "never synced".
  this.#setFavorites(user,ids);return this.#favoritesSnapshot(user);});}
 close(){this.db.close();}
}
