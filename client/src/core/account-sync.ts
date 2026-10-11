// Pure account/response state machine. Cookie authentication belongs to the API,
// never to this public context or to browser storage.
export type Resource='favorites'|'gallery';
export interface SessionContext {email:string;context:string}
export interface Stamp {owner:string;context:string;revision:number}
export interface Ticket {owner:string;context:string;generation:number}
export class StaleResponse extends Error {constructor(){super('账户或资源已变更，已忽略旧结果');}}
export const validStamp=(v:unknown):v is Stamp=>{
 const s=v as Stamp|null;
 return !!s&&typeof s.owner==='string'&&typeof s.context==='string'&&/^[0-9a-f]{32}$/.test(s.context)&&Number.isSafeInteger(s.revision)&&s.revision>=0;
};
export class AccountCoordinator {
 generation=0;
 private probe=0;
 session:SessionContext|null=null;
 private revisions=new Map<string,number>();
 private key(owner:string,resource:Resource){return `${owner}\n${resource}`;}
 known(owner:string,resource:Resource){return this.revisions.get(this.key(owner,resource))??0;}
 invalidate(){this.generation++;this.probe++;this.session=null;}
 beginProbe(){return {probe:++this.probe,generation:this.generation};}
 probeCurrent(p:{probe:number;generation:number}){return p.probe===this.probe&&p.generation===this.generation;}
 settleProbe(p:{probe:number;generation:number},next:SessionContext|null){
  if(!this.probeCurrent(p))return false;
  if(next&&(!next.email||! /^[0-9a-f]{32}$/.test(next.context)))throw Error('账户服务合同无效，请刷新页面');
  if(this.session?.context!==next?.context||this.session?.email!==next?.email)this.generation++;
  this.session=next;return true;
 }
 capture():Ticket {
  if(!this.session)throw Error('账户尚未核验，请重新登录');
  return {owner:this.session.email,context:this.session.context,generation:this.generation};
 }
 valid(t:Ticket){return t.generation===this.generation&&t.owner===this.session?.email&&t.context===this.session?.context;}
 observe(resource:Resource,stamp:unknown):'unknown'|'mismatch'|'newer'|'same' {
  if(!validStamp(stamp))return 'unknown';
  if(this.session&&(stamp.owner!==this.session.email||stamp.context!==this.session.context)){this.invalidate();return 'mismatch';}
  const known=this.known(stamp.owner,resource);
  if(stamp.revision<=known)return 'same';
  this.revisions.set(this.key(stamp.owner,resource),stamp.revision);return 'newer';
 }
 accept(t:Ticket,resource:Resource,stamp:unknown){
  if(!this.valid(t)||!validStamp(stamp)||stamp.owner!==t.owner||stamp.context!==t.context||stamp.revision<this.known(t.owner,resource))throw new StaleResponse();
  this.revisions.set(this.key(t.owner,resource),stamp.revision);return {owner:stamp.owner,context:stamp.context,revision:stamp.revision};
 }
 permit(t:Ticket,resource:Resource,stamp:Stamp,cache?:unknown){
  if(!this.valid(t))return false;
  if(validStamp(cache)){
   if(cache.owner!==t.owner||cache.context!==t.context){this.invalidate();return false;}
   this.observe(resource,cache);
  }
  return this.valid(t)&&stamp.owner===t.owner&&stamp.context===t.context&&stamp.revision>=this.known(t.owner,resource);
 }
}
