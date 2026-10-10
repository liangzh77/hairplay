import {readFile,readdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,relative} from 'node:path';
import {imageWorkerCode} from './image-worker-code.mjs';
const root=resolve(process.argv[2] || 'dist/build/h5');
const h5=root.endsWith('/h5');
const expectedWorker=h5?await imageWorkerCode():null;
const approved=JSON.parse(await readFile(new URL('./public-assets.json',import.meta.url),'utf8'));
async function walk(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=resolve(dir,e.name);if(e.name.startsWith('._') || e.name==='__MACOSX' || e.name==='.DS_Store')throw Error(`Metadata prohibited: ${relative(root,p)}`);if(e.isSymbolicLink())throw Error('Symlink in build');if(e.isDirectory())out.push(...await walk(p));else out.push(p);}return out;}
let removed=0;
try {
 for(const p of await walk(root)) {
  const name=relative(root,p);
  // uni copies local ignored research images. Remove ONLY known research names;
  // unknown files fail closed rather than silently becoming public assets.
  if(/^static\/catalog\/(?:catalog-\d+-[01]\.jpg|dracula\.jpg)$/.test(name)){await rm(p);removed++;continue;}
  const data=await readFile(p);
  if(name.startsWith('static/')){
   if(!approved[name] || createHash('sha256').update(data).digest('hex')!==approved[name])throw Error(`Unapproved or changed static asset: ${name}`);
  }else{
   if(name==='hairplay-images-sw.js' && (!h5||data.toString()!==expectedWorker))throw Error('Unapproved public image worker');
   if(h5 && name!=='index.html' && name!=='hairplay-images-sw.js' && !/^assets\/[a-zA-Z0-9_.-]+\.(js|css|svg)$/.test(name))throw Error(`Unexpected output: ${name}`);
   if(name.endsWith('.map'))throw Error('Source maps prohibited');
   if(/\.(?:js|css|html|json|wxml|wxss)$/.test(name) && /(?:\/catalog\/(?:catalog-\d+-[01]\.jpg|dracula\.jpg)|hairai-study\/)/.test(data.toString()))throw Error(`Private reference in ${name}`);
  }
 }
 const files=new Set((await walk(root)).map(p=>relative(root,p)));
 for(const name of Object.keys(approved))if(!files.has(name))throw Error(`Missing approved asset: ${name}`);
 if(h5&&!files.has('hairplay-images-sw.js'))throw Error('Missing public image worker');
 console.log(`Public build verified: ${files.size} files, ${Object.keys(approved).length} SHA-256 approved static assets; removed ${removed} ignored research files.`);
}catch(e){await rm(root,{recursive:true,force:true});throw e;}
