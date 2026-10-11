import {toRaw} from 'vue';
import {AccountCoordinator,StaleResponse,validStamp,type Ticket,type Resource,type Stamp} from '../core/account-sync';
export {StaleResponse};
export const accountSync=new AccountCoordinator();
export const GALLERY_STAMP='hairplay.gallery.stamp.v2';
const receipts=new WeakMap<object,{ticket:Ticket;resource:Resource;stamp:Stamp;data:object}>();
const baselines=new WeakMap<Ticket,Partial<Record<Resource,string>>>();
export function captureRequest(resource?:Resource){const ticket=accountSync.capture();if(resource)baselines.set(ticket,{[resource]:JSON.stringify(readStamp(resource))});return ticket;}
let quarantine:()=>void=()=>{};
export function onQuarantine(fn:()=>void){quarantine=fn;}
export function quarantineAccount(){accountSync.invalidate();quarantine();}
export function readStamp(resource:Resource):unknown {
 try{
  const raw=uni.getStorageSync(resource==='gallery'?GALLERY_STAMP:'hairai.study.v1');
  const data=typeof raw==='string'?JSON.parse(raw):raw;
  return resource==='gallery'?data:data?.accountFavorites;
 }catch{return null;}
}
export function observeStorage(resource:Resource){const status=accountSync.observe(resource,readStamp(resource));if(status==='mismatch')quarantine();return status;}
function conflicts(ticket:Ticket,cache:unknown){const s=cache as Partial<Stamp>|null;return !!s&&((typeof s.owner==='string'&&s.owner!==ticket.owner)||(typeof s.context==='string'&&s.context!==ticket.context));}
export function acceptResponse<T extends object>(ticket:Ticket,resource:Resource,data:T,acknowledgement=false):T {
 if(!accountSync.valid(ticket))throw new StaleResponse();
 // Observe any greater peer revision even if the storage event has not arrived.
 const cached=readStamp(resource);
 if(conflicts(ticket,cached)&&JSON.stringify(cached)!==baselines.get(ticket)?.[resource]){quarantineAccount();throw new StaleResponse();}
 if(validStamp(cached)&&cached.owner===ticket.owner&&cached.context===ticket.context)accountSync.observe(resource,cached);
 // A successful first adoption has a separate captured-ID cleanup obligation.
 // It may acknowledge the commit without authorizing an obsolete list/cache.
 let stamp:Stamp;
 if(acknowledgement&&accountSync.valid(ticket)&&validStamp(data)&&data.owner===ticket.owner&&data.context===ticket.context){
  stamp={owner:data.owner,context:data.context,revision:data.revision};
  if(data.revision>=accountSync.known(ticket.owner,resource))accountSync.accept(ticket,resource,data);
 }else stamp=accountSync.accept(ticket,resource,data);
 receipts.set(data,{ticket,resource,stamp,data});return data;
}
export function attachReceipt<T extends object>(target:T,source:object):T {const receipt=receipts.get(toRaw(source));if(!receipt)throw new StaleResponse();receipts.set(target,receipt);return target;}
export function receiptData(value:object):object {const receipt=receipts.get(toRaw(value));if(!receipt)throw new StaleResponse();return receipt.data;}
export function receiptStamp(value:object):Stamp {const receipt=receipts.get(toRaw(value));if(!receipt)throw new StaleResponse();return receipt.stamp;}
export function responseGuard(value:object):()=>boolean {
 const receipt=receipts.get(toRaw(value));if(!receipt)return ()=>false;
 // A verified current session may replace an older-session cache. A later change
 // to a DIFFERENT owner/context must quarantine before old operations can commit.
 const baseline=baselines.get(receipt.ticket)?.[receipt.resource];
 return ()=>{
  if(!accountSync.valid(receipt.ticket))return false;
  const cached=readStamp(receipt.resource);
  if(conflicts(receipt.ticket,cached)){
   if(JSON.stringify(cached)!==baseline){accountSync.invalidate();quarantine();return false;}
   return accountSync.permit(receipt.ticket,receipt.resource,receipt.stamp);
  }
  return accountSync.permit(receipt.ticket,receipt.resource,receipt.stamp,cached);
 };
}
export function captureGuard(){const ticket=accountSync.capture();return ()=>accountSync.valid(ticket);}
export function boundHeaders(ticket:Ticket){if(!accountSync.valid(ticket))throw new StaleResponse();return {'x-hairplay-context':ticket.context};}
export function rememberGallery(value:object){const stamp=receiptStamp(value);if(JSON.stringify(readStamp('gallery'))===JSON.stringify(stamp))return;uni.setStorageSync(GALLERY_STAMP,JSON.stringify(stamp));if(JSON.stringify(readStamp('gallery'))!==JSON.stringify(stamp))throw Error('相册版本未能写入，未保存旧缓存');}
