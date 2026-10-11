import catalogData from './catalog.json';
export const categories=['所有风格','潮流','万圣节','圣诞节','中发','短发','长发','刘海','编发','盘发','男士','现代','传统','世界杯'];
export interface Style {id:string;name:string;category:string;group:string;image:string;partial:boolean}
export type Gender='male'|'female'|null;
export const catalog:Style[]=catalogData;
export function heroStyleFor(gender:Gender|undefined):Style{
 const id=gender==='male'?'catalog-54-1':'catalog-44-1';
 const style=catalog.find(s=>s.id===id);if(!style)throw new Error('缺少首页示例发型');return style;
}
export function filterStyles(category:string,query:string){const q=query.trim().toLowerCase();return catalog.filter(s=>(category==='所有风格'||s.group===category)&&`${s.name} ${s.category}`.toLowerCase().includes(q));}
// A saved style is a catalogue entry the user kept. It is a copy of the public
// catalogue metadata plus the catalogue image path, so the gallery can render it
// without a network round-trip, and it is synced with the account (the account
// list is authoritative once it exists).
export interface SavedStyle {id:string;styleId:string;name:string;image:string;created:string}
export const FAVORITE_LIMIT=50;
export interface State {version:1;bannerHidden:boolean;rememberOptions:boolean;options:Record<string,string>;favorites:SavedStyle[]}
export const initialState=():State=>({version:1,bannerHidden:false,rememberOptions:true,options:{},favorites:[]});
function mergeFavorites(preferred:unknown,legacy:unknown):SavedStyle[]{
 const out:SavedStyle[]=[];
 for(const source of [preferred,legacy])if(Array.isArray(source))for(const r of source){const saved=normalizeSavedStyle(r);if(saved&&!out.some(x=>x.styleId===saved.styleId))out.push(saved);}
 return out.slice(0,FAVORITE_LIMIT);
}
function normalizeSavedStyle(value:unknown):SavedStyle|null{
 const r=value as any;if(!r||typeof r!=='object')return null;
 // Records written before favourites existed were catalogue examples, so they
 // migrate by image path instead of being thrown away.
 const style=catalog.find(s=>s.id===r.styleId)||catalog.find(s=>s.image===r.image);
 if(!style||typeof r.name!=='string'||r.name.length<1||r.name.length>60||typeof r.created!=='string')return null;
 return {id:`fav-${style.id}`,styleId:style.id,name:r.name,image:style.image,created:r.created};
}
export function decodeState(value:unknown):State{
 try{const v=typeof value==='string'?JSON.parse(value):value;if(!v||v.version!==1)return initialState();
 const safe=initialState();safe.bannerHidden=v.bannerHidden===true;safe.rememberOptions=v.rememberOptions!==false;
 if(v.options&&typeof v.options==='object') for(const k of ['风格类型','护理程度','偏好长度','发色偏好'])if(typeof v.options[k]==='string'&&v.options[k].length<30)safe.options[k]=v.options[k];
 safe.favorites=mergeFavorites(v.favorites,v.records);
 return safe;}catch{return initialState();}
}
export interface PhotoMeta {size:number;type:string;width?:number;height?:number}
export function validatePhoto(p:PhotoMeta):string{
 if(!['image/jpeg','image/png','image/webp'].includes(p.type))return '请选择 JPG、PNG 或 WebP 图片';
 if(p.size<=0)return '文件为空或已损坏';if(p.size>8*1024*1024)return '图片不得超过 8 MB';
 if(p.width!==undefined&&p.height!==undefined&&(p.width<32||p.height<32||p.width*p.height>24_000_000))return '图片尺寸需至少 32×32，且不超过 2400 万像素';return '';
}
export function makeSavedStyle(style:Style):SavedStyle{return {id:`fav-${style.id}`,styleId:style.id,name:style.name,image:style.image,created:new Date().toISOString()};}
export function isSavedStyle(value:unknown):value is SavedStyle{
 const r=value as SavedStyle|undefined;
 if(!r||typeof r!=='object')return false;
 const style=catalog.find(s=>s.id===r.styleId);
 return !!style&&r.id===`fav-${style.id}`&&r.image===style.image&&typeof r.name==='string'&&r.name.length>0&&r.name.length<=60&&typeof r.created==='string';}
export function decodeFavorites(value:unknown):SavedStyle[]{
 try{const v=typeof value==='string'?JSON.parse(value):value;if(!Array.isArray(v))return [];return mergeFavorites(v,null);}catch{return [];}
}
export function insertFavorite(list:SavedStyle[],style:Style){return [makeSavedStyle(style),...list.filter(r=>r.styleId!==style.id)].slice(0,FAVORITE_LIMIT);}
export function removeFavorites(list:SavedStyle[],styleIds:string[]){return list.filter(r=>!styleIds.includes(r.styleId));}
// AI results live in their own list: the account keeps the 2K original on the
// server, while this device keeps a downscaled copy as a cache, so the gallery
// still renders offline and after the localStorage cache is cleared.
export const GENERATION_LIMIT=6;
export const GENERATION_IMAGE_MAX=2_200_000;
export interface GeneratedRecord {id:string;name:string;image:string;created:string;source:'ai';cloud?:string}
const CLOUD_ID=/^[0-9a-f]{24}$/;
const B64='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function b64Group(group:string):number[]{const v=[0,1,2,3].map(i=>B64.indexOf(group[i]));return [(v[0]<<2)|(v[1]>>4),((v[1]&15)<<4)|(v[2]>>2),((v[2]&3)<<6)|v[3]];}
// A stored picture is only trusted when it is structurally a JPEG: the SOI
// marker, a segment marker right after it (real JPEGs always start a segment
// there, so marker-plus-zeros padding is refused), a valid base64 alphabet, and
// the EOI marker (FF D9) as the last two decoded bytes. A payload that merely
// claims to be image/jpeg — or that no browser could ever decode — is refused
// on read as well as on write.
export function jpegEndsWithEoi(body:string):boolean{
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(body))return false;
 const pad=body.endsWith('==')?2:body.endsWith('=')?1:0,raw=body.replace(/=+$/,'');
 if(raw.length<8)return false;
 if(!jpegHasSegments(body))return false;
 if(pad===0){const bytes=b64Group(raw.slice(-4));return bytes[1]===0xff&&bytes[2]===0xd9;}
 if(pad===1){const g=b64Group(raw.slice(-3)+'A');return g[0]===0xff&&g[1]===0xd9;}
 const prev=b64Group(raw.slice(-6,-2)),last=b64Group(raw.slice(-2)+'AA');return prev[2]===0xff&&last[0]===0xd9;}
// SOI (FF D8) followed by a real opening segment: a segment marker an encoder
// actually emits first (APPn, COM, DQT, DHT or a frame header) and a declared
// length that could hold one. The stuffed byte FF 00, reserved codes like FF 02
// and zero-length segments such as FF E0 00 00 are refused, because filler or
// garbage after SOI is not a JPEG a browser could decode. This is a cheap
// structural gate, not a full JPEG parse: the authoritative check is the write
// path's browser decode (`verifyGeneratedImage`), which runs before anything is
// stored.
const JPEG_FIRST_SEGMENT=new Set<number>([0xdb,0xfe,...Array.from({length:0x10},(_,i)=>0xc0+i),...Array.from({length:0x10},(_,i)=>0xe0+i)]);
export function jpegHasSegments(body:string):boolean{
 if(body.length<8||!/^[A-Za-z0-9+/]+={0,2}$/.test(body))return false;
 // b64Group decodes three bytes per four characters, so the marker code (byte 3)
 // and the length field live in the first two groups.
 const head=[...b64Group(body.slice(0,4)),...b64Group(body.slice(4,8))];
 if(head[0]!==0xff||head[1]!==0xd8||head[2]!==0xff)return false;
 if(!JPEG_FIRST_SEGMENT.has(head[3]))return false;
 const length=(head[4]<<8)|head[5];
 const pad=body.endsWith('==')?2:body.endsWith('=')?1:0,bytes=(body.length/4)*3-pad;
 return length>=8&&length<=bytes-4;}
export function isValidGeneratedImage(image:unknown):image is string{
 if(typeof image!=='string')return false;
 if(!image.startsWith('data:image/jpeg;base64,/9j/'))return false;
 if(image.length<1_024||image.length>GENERATION_IMAGE_MAX)return false;
 return jpegEndsWithEoi(image.slice('data:image/jpeg;base64,'.length));}
export function isGeneratedRecord(value:unknown):value is GeneratedRecord{
 const r=value as GeneratedRecord|undefined;
 return !!r&&typeof r==='object'&&r.source==='ai'&&typeof r.id==='string'&&r.id.startsWith('gen-')&&typeof r.name==='string'&&r.name.length>0&&r.name.length<=60&&typeof r.created==='string'&&(r.cloud===undefined||CLOUD_ID.test(r.cloud))&&isValidGeneratedImage(r.image);}
// A stored pointer to a cloud copy that is not a server id is dropped instead of
// invalidating the whole record: the cached picture is still a picture the user
// generated, so it stays visible as a local-only result.
export function sanitizeGeneratedRecord(value:unknown):GeneratedRecord|null{
 if(!value||typeof value!=='object')return null;
 const {cloud,...rest}=value as GeneratedRecord;
 if(!isGeneratedRecord({...rest,cloud:undefined}))return null;
 return cloud!==undefined&&CLOUD_ID.test(cloud)?{...rest,cloud}:rest as GeneratedRecord;}
export function makeGeneratedRecord(name:string,image:string,cloud?:string):GeneratedRecord{
 const record:GeneratedRecord={id:`gen-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,name:name.slice(0,60)||'AI 发型',image,created:new Date().toISOString(),source:'ai'};
 return cloud&&CLOUD_ID.test(cloud)?{...record,cloud}:record;}
export function decodeGenerations(value:unknown):GeneratedRecord[]{
 try{const v=typeof value==='string'?JSON.parse(value):value;if(!Array.isArray(v))return [];
  return v.map(sanitizeGeneratedRecord).filter((r):r is GeneratedRecord=>!!r).slice(0,GENERATION_LIMIT);}catch{return [];}
}
export function insertGeneration(list:GeneratedRecord[],record:GeneratedRecord){return [record,...list.filter(r=>r.id!==record.id)].slice(0,GENERATION_LIMIT);}
export function removeGenerations(list:GeneratedRecord[],ids:string[]){return list.filter(r=>!ids.includes(r.id));}
