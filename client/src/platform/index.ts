import {decodeState,decodeGenerations,isGeneratedRecord,isSavedStyle,FAVORITE_LIMIT,GENERATION_LIMIT,type State,type Gender,type GeneratedRecord,type SavedStyle,validatePhoto} from '../core/model';
export type {Gender} from '../core/model';
import {assetUrl} from '../core/assets';
const KEY='hairai.study.v1';
export function loadState(){try{return decodeState(uni.getStorageSync(KEY));}catch{return decodeState(null);}}
export function storeState(s:State){try{uni.setStorageSync(KEY,JSON.stringify(s));return '';}catch{return '本地存储空间不足，记录未保存。请删除旧收藏或生成记录后重试。';}}
const GEN_KEY='hairplay.generations.v1';
export function loadGenerations():GeneratedRecord[]{try{return decodeGenerations(uni.getStorageSync(GEN_KEY));}catch{return [];}}
export function storeGenerations(list:GeneratedRecord[]){
 // The writer enforces the same rules as the reader: never persist an
 // oversized or non-JPEG payload that decodeGenerations would silently drop.
 if(list.length>GENERATION_LIMIT)return `本机相册最多保留 ${GENERATION_LIMIT} 张生成图片。`;
 if(!list.every(isGeneratedRecord))return '生成图片过大或格式无效，未能保存到本机相册；请用“下载到本机”自行保存。';
 try{uni.setStorageSync(GEN_KEY,JSON.stringify(list));return '';}catch{return '本机存储空间不足，生成图片未能保存；请删除旧生成记录后重试，或直接下载到本机。';}}
// Web Locks are the only way to make a read-modify-write atomic across tabs of
// the same origin: a second tab waits for the first one to finish and then reads
// inside the lock, so its earlier UI snapshot can never overwrite a deletion.
// A runtime without the API cannot fall back to the retry loop: two tabs that
// each write their own stale snapshot both read back what they wrote, so the
// loop cannot see the conflict and a deleted picture comes back. There is no
// lock-free read-modify-write over localStorage, so such a runtime FAILS CLOSED
// instead of writing — a refused save is recoverable, a resurrected delete is
// not. Mini-program runtimes have one instance per user and no shared tabs, so
// they keep writing directly. A tab that wedges while holding the lock cannot
// block a user forever either: acquisition gives up after LOCK_TIMEOUT_MS and
// the caller reports an honest, retriable failure rather than writing unlocked.
const LOCK_TIMEOUT_MS=5000;
const NO_LOCK_MESSAGE='当前浏览器不支持安全的本地并发写入（缺少 Web Locks）。为避免本机相册的图片被其它标签页误删或复活，本次操作未执行；请使用最新版 Chrome/Edge/Safari 打开，或先点「下载这张」把图片保存到本机。';
type LockCapableNavigator=Navigator&{locks?:{request:(name:string,options:unknown,fn:()=>Promise<void>)=>Promise<void>}};
export async function withStorageLock<T>(key:string,fn:()=>T):Promise<T>{
 if(typeof window==='undefined'||typeof navigator==='undefined')return fn();
 const locks=(navigator as LockCapableNavigator).locks;
 if(!locks||typeof locks.request!=='function')throw new Error(NO_LOCK_MESSAGE);
 const controller=typeof AbortController==='undefined'?undefined:new AbortController();
 const timer=controller?setTimeout(()=>controller.abort(),LOCK_TIMEOUT_MS):undefined;
 let value!:T,failed=false,failure:unknown,blocked=false;
 try{await locks.request(`hairplay.storage.${key}`,controller?{signal:controller.signal}:undefined,async()=>{try{value=fn();}catch(e){failed=true;failure=e;}});}
 catch{blocked=true;}
 if(timer!==undefined)clearTimeout(timer);
 if(blocked)throw new Error('另一个标签页正在写入本机相册，本次操作未生效，请稍后重试。');
 if(failed)throw failure;
 return value;}
const MUTATE_ATTEMPTS=5;
export async function mutateGenerations(mutate:(list:GeneratedRecord[])=>GeneratedRecord[]):Promise<{ok:boolean;message:string}>{
 try{return await withStorageLock(GEN_KEY,()=>{
 let last='';
 for(let attempt=0;attempt<MUTATE_ATTEMPTS;attempt++){
  const next=mutate(loadGenerations());
  last=storeGenerations(next);
  if(last)return {ok:false,message:last};
  // Read back before claiming success: a write another tab overwrote, or one the
  // storage silently refused, is a failure here and not a silent rollback of what
  // the user just did. The whole list is compared, not just the ids, because a
  // lost field update (a cloud link, a replaced image) is a lost write too.
  if(JSON.stringify(loadGenerations())===JSON.stringify(next))return {ok:true,message:''};
 }
 return {ok:false,message:last||'另一个标签页同时改动了本机相册，本次删除未生效，请重试。'};});}
 catch(e){return {ok:false,message:e instanceof Error&&e.message?e.message:'本机相册写入未生效，请稍后重试。'};}}
// Preferences and favourites share this device's state blob, so they need the
// same locked read-modify-write as the generated pictures: a signed-in sync that
// wrote the cache unlocked could resurrect a favourite another tab just removed.
// Without Web Locks there is no safe write at all, and the caller reports that
// honestly instead of pretending the local cache is current.
export async function mutateState(mutate:(state:State)=>State):Promise<{ok:boolean;message:string}>{
 try{return await withStorageLock(KEY,()=>{
 let last='';
 for(let attempt=0;attempt<MUTATE_ATTEMPTS;attempt++){
  const next=mutate(loadState());
  last=storeState(next);
  if(last)return {ok:false,message:last};
  // Read back before claiming success: a write another tab overwrote is a
  // failure here, not a silent rollback of what the user just did.
  if(JSON.stringify(loadState())===JSON.stringify(next))return {ok:true,message:''};
 }
 return {ok:false,message:last||'另一个标签页同时改动了本机设置，本次操作未生效，请重试。'};});}
 catch(e){return {ok:false,message:e instanceof Error&&e.message?e.message:'本机设置写入未生效，请稍后重试。'};}}
// Confirm that what we are about to store really is a decodable JPEG, so a
// broken payload is reported as a failure instead of being written and then
// silently dropped by the reader.
export async function verifyGeneratedImage(dataUrl:string):Promise<boolean>{
 // #ifdef H5
 try{const img=new Image();img.src=dataUrl;await img.decode();return true;}catch{return false;}
 // #endif
 // #ifdef MP-WEIXIN
 return typeof dataUrl==='string'&&dataUrl.startsWith('data:image/jpeg;base64,');
 // #endif
}
// Shrink the 2K upstream result to a display-sized JPEG before storing it in the
// browser, so a few local copies stay well inside the origin storage quota.
export async function prepareGeneratedImage(dataUrl:string):Promise<string>{
 // #ifdef H5
 const img=new Image();img.src=dataUrl;try{await img.decode();}catch{throw new Error('浏览器无法读取生成图片');}
 const scale=Math.min(1,1080/Math.max(img.naturalWidth,img.naturalHeight));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器无法处理生成图片');
 ctx.drawImage(img,0,0,canvas.width,canvas.height);
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('生成图片转换失败')),'image/jpeg',0.82));
 canvas.width=0;canvas.height=0;
 const out=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('生成图片读取失败'));reader.readAsDataURL(blob);});
 if(!out.startsWith('data:image/jpeg;base64,'))throw new Error('生成图片格式无效');
 return out;
 // #endif
 // #ifdef MP-WEIXIN
 return dataUrl;
 // #endif
}
export async function downloadGenerated(image:string,name:string):Promise<string>{
 // #ifdef H5
 const a=document.createElement('a');a.href=image;a.download=`HairPlay-AI-${name||'style'}.jpg`;document.body.appendChild(a);a.click();a.remove();
 return '已下载到本机';
 // #endif
 // #ifdef MP-WEIXIN
 uni.showToast({title:'小程序请使用图片预览；保存相册尚待真机验证',icon:'none'});
 // #endif
 return '此端暂无导出功能';
}
export interface Account {email:string;gender:Gender;remaining:number}
// One place decides how a failed API call is reported. The wording must never
// claim success or blame the user's input for a network/authentication problem:
// every caller turns these strings into an on-screen failure notice.
function apiBase(){return import.meta.env.BASE_URL+'api/';}
// A conditional write answers 409 with the authoritative list, so the caller must
// be able to read that body instead of seeing a generic failure message.
async function apiRequest(path:string,init:RequestInit={},accept:number[]=[200]):Promise<any>{
 // #ifdef H5
 let response:Response;try{response=await fetch(apiBase()+path,{credentials:'same-origin',cache:'no-store',...init});}
 catch{throw Error('无法连接有型服务，请检查网络后重试');}
 const data=await response.json().catch(()=>({error:'服务返回异常'}));
 if(!response.ok&&!accept.includes(response.status))throw Error(typeof data.error==='string'&&data.error?data.error:response.status===401?'登录状态已失效，请重新登录':'服务暂不可用，请稍后重试');
 return data;
 // #endif
 // #ifdef MP-WEIXIN
 throw Error('小程序端账户服务尚未接入');
 // #endif
}
const jsonPost=(body:unknown):RequestInit=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
export async function accountApi(path:string,body?:Record<string,string|null>):Promise<{account?:Account|null}>{
 // #ifdef MP-WEIXIN
 throw Error('小程序邮箱登录与真实生成尚未接入');
 // #endif
 return apiRequest(path,body?jsonPost(body):{});
}
export interface CloudImage {id:string;name:string;style:string|null;created:string;size:number}
// The cloud album is the authoritative list for a signed-in account: the local
// records are only a cache, so every sync and every deletion asks the server.
export async function cloudAlbum():Promise<CloudImage[]>{
 const data=await apiRequest('gallery');
 if(!Array.isArray(data?.images))throw Error('云端相册返回异常，请稍后重试');
 return data.images.filter((r:any)=>r&&typeof r.id==='string'&&/^[0-9a-f]{24}$/.test(r.id)).map((r:any)=>({id:r.id,name:typeof r.name==='string'?r.name:'AI 发型',style:typeof r.style==='string'?r.style:null,created:typeof r.created==='string'?r.created:new Date().toISOString(),size:Number(r.size)||0}));
}
export async function cloudImageData(id:string):Promise<string>{
 // #ifdef H5
 let response:Response;try{response=await fetch(apiBase()+'gallery/'+id,{credentials:'same-origin',cache:'no-store'});}catch{throw Error('无法连接有型服务，请检查网络后重试');}
 if(!response.ok)throw Error(response.status===404?'这张图片已不在云端账户中':'云端图片读取失败，请稍后重试');
 const blob=await response.blob();
 if(blob.size<1_024||blob.size>4*1024*1024||blob.type&&!blob.type.startsWith('image/jpeg'))throw Error('云端图片格式无效');
 return await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(Error('云端图片读取失败'));reader.readAsDataURL(blob);});
 // #endif
 throw Error('小程序端账户服务尚未接入');
}
export async function cloudDelete(id:string):Promise<boolean>{
 const data=await apiRequest('gallery/delete',jsonPost({id}));
 return data?.deleted===true;
}
export async function cloudImport(image:string,name:string,styleId?:string):Promise<{id:string;created:string}>{
 const data=await apiRequest('gallery/import',jsonPost({image,name,style:styleId}));
 if(typeof data?.id!=='string'||!/^[0-9a-f]{24}$/.test(data.id))throw Error('云端相册返回异常，请稍后重试');
 return {id:data.id,created:typeof data.created==='string'?data.created:new Date().toISOString()};
}
export async function cloudFavorites():Promise<{ids:string[];initialized:boolean}>{
 const data=await apiRequest('favorites');
 return {ids:styleIds(data?.ids),initialized:data?.initialized===true};
}
function styleIds(value:unknown):string[]{return Array.isArray(value)?value.filter((id:unknown):id is string=>typeof id==='string'):[];}
// Adopting this device's list is only allowed once. A 409 means another device
// already stored a list, so the answer to adopt is that list, not ours.
export async function cloudSaveFavorites(ids:string[]):Promise<{ids:string[];conflict:boolean}>{
 const data=await apiRequest('favorites',jsonPost({ids}),[200,409]);
 return {ids:styleIds(data?.ids),conflict:data?.ok!==true};
}
// One atomic edit on the server's current list: another device's concurrent
// removal can no longer be undone by this device's stale snapshot.
export async function cloudEditFavorite(action:'add'|'remove',styleId:string):Promise<string[]>{
 const data=await apiRequest('favorites',jsonPost({[action]:styleId}));
 if(!Array.isArray(data?.ids))throw Error('收藏同步返回异常，请稍后重试');
 return styleIds(data.ids);
}
export function setupImageCache():()=>void{
 // #ifdef H5
 if(import.meta.env.DEV||!window.isSecureContext||!('serviceWorker' in navigator))return ()=>{};
 const scope=import.meta.env.BASE_URL;
 const publicPrefix=new URL(scope+'static/',location.origin).href;
 const opened=new Set<string>();let worker:ServiceWorker|null=null;let timer:ReturnType<typeof setTimeout>|undefined;let stopped=false;
 const flush=()=>{timer=undefined;if(!worker||!opened.size||stopped)return;
  const urls=[...opened];opened.clear();for(let i=0;i<urls.length;i+=60)worker.postMessage({type:'CACHE_OPENED_IMAGES',urls:urls.slice(i,i+60)});
 };
 const remember=(img:HTMLImageElement)=>{if(stopped||!img.complete||img.naturalWidth<1)return;
  const url=img.currentSrc||img.src;if(!url.startsWith(publicPrefix))return;
  opened.add(url);if(worker&&!timer)timer=setTimeout(flush,30);
 };
 const onLoad=(event:Event)=>{if(event.target instanceof HTMLImageElement)remember(event.target);};
 const refreshWorker=()=>{if(stopped)return;worker=navigator.serviceWorker.controller;
  document.querySelectorAll<HTMLImageElement>('img[src]').forEach(remember);
  if(worker&&opened.size&&!timer)timer=setTimeout(flush,30);
 };
 document.addEventListener('load',onLoad,true);
 navigator.serviceWorker.addEventListener('controllerchange',refreshWorker);
 void navigator.serviceWorker.register(scope+'hairplay-images-sw.js',{scope,updateViaCache:'none'}).then(async registration=>{
  await navigator.serviceWorker.ready;if(stopped)return;
  refreshWorker();worker ||= registration.active;
  if(worker&&opened.size&&!timer)timer=setTimeout(flush,30);
 }).catch(()=>{document.removeEventListener('load',onLoad,true);navigator.serviceWorker.removeEventListener('controllerchange',refreshWorker);});
 return ()=>{stopped=true;clearTimeout(timer);document.removeEventListener('load',onLoad,true);navigator.serviceWorker.removeEventListener('controllerchange',refreshWorker);};
 // #endif
 return ()=>{};
}
export interface Photo {url:string;width:number;height:number}
export async function pickPhoto(onReading?:()=>void):Promise<Photo|null>{
 // `onReading` fires once a file has actually been chosen and the bytes are
 // about to be decoded, so callers can distinguish "no photo yet" from
 // "photo still being read".
 // #ifdef H5
 return new Promise((resolve,reject)=>{const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.setAttribute('aria-label','选择本地照片');input.style.display='none';document.body.appendChild(input);
 const clean=()=>input.remove();input.oncancel=()=>{clean();resolve(null);};input.onchange=async()=>{const file=input.files?.[0];if(!file){clean();resolve(null);return;}onReading?.();try{const error=validatePhoto(file);if(error)throw new Error(error);const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();const dimensions=validatePhoto({...file,size:file.size,type:file.type,width:img.naturalWidth,height:img.naturalHeight});if(dimensions)throw new Error(dimensions);resolve({url,width:img.naturalWidth,height:img.naturalHeight});}catch(e){URL.revokeObjectURL(url);throw e;}}catch(e){reject(e);}finally{clean();}};input.click();});
 // #endif
 // #ifdef MP-WEIXIN
 return new Promise((resolve,reject)=>uni.chooseImage({count:1,sizeType:['original'],sourceType:['album','camera'],success:async(res)=>{onReading?.();try{const f=(res.tempFiles as UniApp.ChooseImageSuccessCallbackResultFile[])[0];const path=res.tempFilePaths[0];const ext=path.split('.').pop()?.toLowerCase();const type=ext==='png'?'image/png':ext==='webp'?'image/webp':ext==='jpg'||ext==='jpeg'?'image/jpeg':'';const info=await uni.getImageInfo({src:path});const error=validatePhoto({size:f.size,type,width:info.width,height:info.height});if(error)throw new Error(error);resolve({url:path,width:info.width,height:info.height});}catch(e){reject(e);}},fail:(e)=>e.errMsg.includes('cancel')?resolve(null):reject(new Error('无法读取照片，请重试'))}));
 // #endif
}
export async function generateLiveImage(photo:Photo,styleId:string,requirements:string):Promise<{image:string;cloud:string}>{
 // #ifdef H5
 // The file picker MIME may be wrong (e.g. HEIC/PNG bytes named .jpg). The image
 // has already been decoded for preview; re-encode those pixels as real JPEG.
 // This also strips EXIF/GPS metadata and bounds the upload dimensions.
 const img=new Image();img.src=photo.url;
 try{await img.decode();}catch{throw new Error('浏览器无法解码这张照片，请换一张 JPG、PNG 或 WebP');}
 const scale=Math.min(1,2048/Math.max(img.naturalWidth,img.naturalHeight));
 const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('浏览器无法处理照片');
 ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
 const jpeg=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?.type==='image/jpeg'?resolve(blob):reject(new Error('照片转换为 JPG 失败')),'image/jpeg',0.88));
 canvas.width=0;canvas.height=0;
 if(jpeg.size>8*1024*1024)throw new Error('转换后的照片超过 8 MB，请选择较小图片');
 const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('无法读取照片'));reader.readAsDataURL(jpeg);});
 let response:Response;
 try{response=await fetch(import.meta.env.BASE_URL+'api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({photo:dataUrl,styleId,requirements})});}
 catch{throw new Error('本机 AI 服务未启动；照片没有发送到火山云');}
 if(response.status===404)throw new Error('AI 服务未配置：请先启动本机服务；照片没有发送到火山云');
 const result=await response.json().catch(()=>({error:'服务返回异常'}));
 if(!response.ok)throw new Error(typeof result.error==='string'?result.error:'AI 生成失败');
 if(typeof result.image!=='string'||!result.image.startsWith('data:image/jpeg;base64,'))throw new Error('生成图片无效');
 // The account id is what makes the picture visible on another device. A server
 // that stored the picture but returned no id leaves the caller to re-read the
 // account list instead of inventing a link it cannot verify.
 return {image:result.image,cloud:typeof result.record?.id==='string'&&/^[0-9a-f]{24}$/.test(result.record.id)?result.record.id:''};
 // #endif
 // #ifdef MP-WEIXIN
 throw new Error('小程序端真实 AI 服务尚未接入；照片没有上传');
 // #endif
}
export function releasePhoto(photo:Photo|null){
 // #ifdef H5
 if(photo?.url.startsWith('blob:'))URL.revokeObjectURL(photo.url);
 // #endif
}
// Modal DOM access is restricted to the H5 platform layer.
let restoreFocus:HTMLElement|null=null;
let modalFrame=0;
export function lockModal(lock:boolean){
 // #ifdef H5
 cancelAnimationFrame(modalFrame);
 document.body.style.overflow=lock?'hidden':'';
 if(lock){restoreFocus=document.activeElement as HTMLElement;modalFrame=requestAnimationFrame(()=>{document.querySelectorAll('.screen,.tabs,.bottom-action').forEach(e=>e.setAttribute('inert',''));(document.querySelector('.modal-close') as HTMLElement|null)?.focus();});}
 else{document.querySelectorAll('[inert]').forEach(e=>e.removeAttribute('inert'));restoreFocus?.focus();restoreFocus=null;}
 // #endif
}
export function setupModalKeyboard(){
 // #ifdef H5
 const handler=(e:KeyboardEvent)=>{if(e.key!=='Tab')return;const dialog=document.querySelector('.modal');if(!dialog)return;const elements=Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input,textarea,[tabindex="0"]')).filter(el=>el.getClientRects().length);const first=elements[0],last=elements[elements.length-1];if(!first)return;if(e.shiftKey&&(document.activeElement===first||!dialog.contains(document.activeElement))){e.preventDefault();last.focus();}else if(!e.shiftKey&&(document.activeElement===last||!dialog.contains(document.activeElement))){e.preventDefault();first.focus();}};
 document.addEventListener('keydown',handler);return ()=>document.removeEventListener('keydown',handler);
 // #endif
 return ()=>{};
}
export function setupEscape(close:()=>void){
 // #ifdef H5
 const handler=(e:KeyboardEvent)=>{if(e.key==='Escape')close();};window.addEventListener('keydown',handler);return ()=>window.removeEventListener('keydown',handler);
 // #endif
 return ()=>{};
}
export function setupBack(back:()=>void){
 // #ifdef H5
 const handler=()=>back();window.addEventListener('popstate',handler);return ()=>window.removeEventListener('popstate',handler);
 // #endif
 return ()=>{};
}
export function pushLocalHistory(){
 // #ifdef H5
 window.history.pushState({hairai:true},'',window.location.href);
 // #endif
}
export function backLocalHistory(){
 // #ifdef H5
 window.history.back();return;
 // #endif
}
export async function downloadStyle(url:string,name:string):Promise<string>{
 // #ifdef H5
 const href=assetUrl(url);let objectUrl='';
 // Browser downloads can bypass Service Worker fetch handlers. Use only the
 // current public image cache; never cache or download private/generated photos.
 try{if('caches' in window){const names=(await caches.keys()).filter(key=>key.startsWith('hairplay-public-images-'));
  for(const key of names){const response=await(await caches.open(key)).match(href);
   if(response?.ok&&response.headers.get('content-type')?.startsWith('image/jpeg')){
    const blob=await response.blob();if(blob.size>0&&blob.size<=2*1024*1024)objectUrl=URL.createObjectURL(blob);
    break;
   }
  }
 }}catch{/* storage disabled: download from the public URL instead */}
 const a=document.createElement('a');a.href=objectUrl||href;a.download=`HairPlay-模板-${name}.jpg`;document.body.appendChild(a);a.click();a.remove();
 if(objectUrl)setTimeout(()=>URL.revokeObjectURL(objectUrl),60_000);
 return '已下载目录图片（非 AI 生成）';
 // #endif
 // #ifdef MP-WEIXIN
 uni.showToast({title:'小程序请使用图片预览；保存相册尚待真机验证',icon:'none'});
 // #endif
 return '此端暂无导出功能';
}
// Download the untouched 2K original from the account, not the downscaled local
// copy. Same-origin with the session cookie, so the anchor download works.
export async function downloadCloudImage(id:string,name:string):Promise<string>{
 // #ifdef H5
 let response:Response;try{response=await fetch(apiBase()+'gallery/'+id,{credentials:'same-origin',cache:'no-store'});}catch{throw Error('无法连接有型服务，请检查网络后重试');}
 if(!response.ok)throw Error(response.status===404?'这张图片已不在云端账户中':'云端原图下载失败，请稍后重试');
 const blob=await response.blob();
 if(blob.size<1_024||blob.size>4*1024*1024)throw Error('云端原图大小异常，已取消下载');
 const objectUrl=URL.createObjectURL(blob);
 const a=document.createElement('a');a.href=objectUrl;a.download=`HairPlay-AI-${name||'style'}.jpg`;document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(objectUrl),60_000);
 return '已下载云端原图';
 // #endif
 // #ifdef MP-WEIXIN
 uni.showToast({title:'小程序请使用图片预览；保存相册尚待真机验证',icon:'none'});
 // #endif
 return '此端暂无导出功能';
}
export function capsuleInset(){
 // #ifdef MP-WEIXIN
 try{return uni.getMenuButtonBoundingClientRect().bottom+12;}catch{return 48;}
 // #endif
 return 0;
}
