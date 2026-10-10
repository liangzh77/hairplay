import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function imageWorkerCode(){
 const approved=JSON.parse(await readFile(new URL('./public-assets.json',import.meta.url),'utf8'));
 const images=Object.entries(approved).filter(([name])=>/^static\/(?:catalog\/|icons\/)/.test(name)).sort(([a],[b])=>a.localeCompare(b));
 if(!images.length)throw Error('Missing approved catalogue images');
 const revision=createHash('sha256').update(JSON.stringify(images)).digest('hex').slice(0,16);
 const source=await readFile(new URL('./hairplay-images-sw.js',import.meta.url),'utf8');
 if(source.split('__IMAGE_CACHE_REVISION__').length!==2||source.split('__IMAGE_ASSET_HASHES__').length!==2)throw Error('Worker placeholders missing or duplicated');
 const hashes=Object.fromEntries(images.map(([name,sha])=>[name.slice('static/'.length),sha.slice(0,16)]));
 return source.replace('__IMAGE_CACHE_REVISION__',revision).replace('__IMAGE_ASSET_HASHES__',JSON.stringify(hashes));
}
