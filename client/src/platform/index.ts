import {decodeState,decodeGenerations,isGeneratedRecord,GENERATION_LIMIT,type State,type Gender,type GeneratedRecord,validatePhoto} from '../core/model';
export type {Gender} from '../core/model';
import {assetUrl} from '../core/assets';
const KEY='hairai.study.v1';
export function loadState(){try{return decodeState(uni.getStorageSync(KEY));}catch{return decodeState(null);}}
export function storeState(s:State){try{uni.setStorageSync(KEY,JSON.stringify(s));return '';}catch{return '本地存储空间不足，记录未保存。请删除旧演示记录后重试。';}}
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
  const before=loadGenerations(),next=mutate(before);
  const removed=before.filter(r=>!next.some(n=>n.id===r.id)).map(r=>r.id);
  last=storeGenerations(next);
  if(last)return {ok:false,message:last};
  const after=loadGenerations();
  const ok=next.every(n=>after.some(r=>r.id===n.id))&&removed.every(id=>!after.some(r=>r.id===id));
  if(ok)return {ok:true,message:''};
 }
 return {ok:false,message:last||'另一个标签页同时改动了本机相册，本次删除未生效，请重试。'};});}
 catch(e){return {ok:false,message:e instanceof Error&&e.message?e.message:'本机相册写入未生效，请稍后重试。'};}}
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
export async function accountApi(path:string,body?:Record<string,string|null>):Promise<{account?:Account|null}>{
 // #ifdef H5
 let r:Response;try{r=await fetch(import.meta.env.BASE_URL+'api/'+path,{credentials:'same-origin',cache:'no-store',...(body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})});}catch{throw Error('邮箱登录服务未启动；公网目前仅静态演示');}
 if(r.status===404)throw Error('邮箱登录服务未部署；公网目前仅静态演示');
 const data=await r.json().catch(()=>({error:'服务返回异常'}));if(!r.ok)throw Error(data.error||'登录服务异常');return data;
 // #endif
 // #ifdef MP-WEIXIN
 throw Error('小程序邮箱登录与真实生成尚未接入');
 // #endif
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
export async function pickPhoto():Promise<Photo|null>{
 // #ifdef H5
 return new Promise((resolve,reject)=>{const input=document.createElement('input');input.type='file';input.accept='image/jpeg,image/png,image/webp';input.setAttribute('aria-label','选择本地照片');input.style.display='none';document.body.appendChild(input);
 const clean=()=>input.remove();input.oncancel=()=>{clean();resolve(null);};input.onchange=async()=>{const file=input.files?.[0];if(!file){clean();resolve(null);return;}try{const error=validatePhoto(file);if(error)throw new Error(error);const url=URL.createObjectURL(file);try{const img=new Image();img.src=url;await img.decode();const dimensions=validatePhoto({...file,size:file.size,type:file.type,width:img.naturalWidth,height:img.naturalHeight});if(dimensions)throw new Error(dimensions);resolve({url,width:img.naturalWidth,height:img.naturalHeight});}catch(e){URL.revokeObjectURL(url);throw e;}}catch(e){reject(e);}finally{clean();}};input.click();});
 // #endif
 // #ifdef MP-WEIXIN
 return new Promise((resolve,reject)=>uni.chooseImage({count:1,sizeType:['original'],sourceType:['album','camera'],success:async(res)=>{try{const f=(res.tempFiles as UniApp.ChooseImageSuccessCallbackResultFile[])[0];const path=res.tempFilePaths[0];const ext=path.split('.').pop()?.toLowerCase();const type=ext==='png'?'image/png':ext==='webp'?'image/webp':ext==='jpg'||ext==='jpeg'?'image/jpeg':'';const info=await uni.getImageInfo({src:path});const error=validatePhoto({size:f.size,type,width:info.width,height:info.height});if(error)throw new Error(error);resolve({url:path,width:info.width,height:info.height});}catch(e){reject(e);}},fail:(e)=>e.errMsg.includes('cancel')?resolve(null):reject(new Error('无法读取照片，请重试'))}));
 // #endif
}
export async function generateLiveImage(photo:Photo,styleId:string,requirements:string):Promise<string>{
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
 return result.image;
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
export async function downloadDemo(url:string,name:string):Promise<string>{
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
 const a=document.createElement('a');a.href=objectUrl||href;a.download=`HairPlay-DEMO-${name}.jpg`;document.body.appendChild(a);a.click();a.remove();
 if(objectUrl)setTimeout(()=>URL.revokeObjectURL(objectUrl),60_000);
 return '已下载目录演示图（非 AI 生成）';
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
