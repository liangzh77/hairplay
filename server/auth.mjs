import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,chmodSync,statSync,lstatSync,openSync,closeSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {randomBytes,randomInt,createHmac,timingSafeEqual} from 'node:crypto';
export const normalizeEmail=v=>typeof v==='string'?v.trim().toLowerCase():'';
export const validEmail=email=>typeof email==='string'&&email.length<=254&&/^[a-z0-9.!#$%&'*+\/?=^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email);
export const validGender=gender=>gender===null||gender==='male'||gender==='female';
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
  `);
  // Serialize check + migration across processes; legacy rows keep gender NULL.
  this.db.exec('BEGIN IMMEDIATE');
  try{
   if(!this.db.prepare('PRAGMA table_info(users)').all().some(col=>col.name==='gender'))this.db.exec("ALTER TABLE users ADD COLUMN gender TEXT CHECK(gender IN ('male','female') OR gender IS NULL)");
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
  this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(this.hash(token),user.id,n+7*86400000);return token;
 });}
 session(token){if(!token||! /^[A-Za-z0-9_-]{43}$/.test(token))return null;return this.db.prepare('SELECT users.* FROM sessions JOIN users ON user=users.id WHERE hash=? AND expires>?').get(this.hash(token),this.now())||null;}
 logout(token){if(token)this.db.prepare('DELETE FROM sessions WHERE hash=?').run(this.hash(token));}
 setGender(user,gender){if(!validGender(gender))throw Object.assign(Error('请选择男、女或不填写'),{status:400});this.db.prepare('UPDATE users SET gender=? WHERE id=?').run(gender,user);}
 recover(){this.db.prepare("UPDATE jobs SET state='failed' WHERE state='pending' AND created<?").run(this.now()-600000);}
 remaining(user){this.recover();return Math.max(0,3-this.db.prepare("SELECT count(*) n FROM jobs WHERE user=? AND state IN ('success','pending')").get(user).n);}
 reserve(user){return this.tx(()=>{if(this.remaining(user)<1)return null;
  if(this.db.prepare("SELECT count(*) n FROM jobs WHERE state='pending' OR created>?").get(this.now()-3600000).n>=3||this.db.prepare("SELECT count(*) n FROM jobs WHERE state='pending'").get().n>0)throw Object.assign(Error('生成繁忙或达到每小时服务预算'),{status:429});
  const id=randomBytes(16).toString('hex');this.db.prepare("INSERT INTO jobs VALUES(?,?,'pending',?)").run(id,user,this.now());return id;});}
 finish(id,ok){this.db.prepare("UPDATE jobs SET state=? WHERE id=? AND state='pending'").run(ok?'success':'failed',id);}
 close(){this.db.close();}
}
