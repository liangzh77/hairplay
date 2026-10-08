import {decodeState,type State,validatePhoto} from '../core/model';
const KEY='hairai.study.v1';
export function loadState(){try{return decodeState(uni.getStorageSync(KEY));}catch{return decodeState(null);}}
export function storeState(s:State){try{uni.setStorageSync(KEY,JSON.stringify(s));return '';}catch{return '本地存储空间不足，记录未保存。请删除旧演示记录后重试。';}}
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
export function downloadDemo(url:string,name:string){
 // #ifdef H5
 const a=document.createElement('a');a.href=url;a.download=`HairAI-DEMO-${name}.jpg`;document.body.appendChild(a);a.click();a.remove();return '已下载目录演示图（非 AI 生成）';
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
