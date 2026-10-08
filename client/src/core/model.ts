import catalogData from './catalog.json';
export const categories=['所有风格','潮流','万圣节','圣诞节','中发','短发','长发','刘海','编发','盘发','男士','现代','传统','世界杯'];
export interface Style {id:string;name:string;category:string;group:string;image:string;partial:boolean}
export const catalog:Style[]=catalogData;
export function filterStyles(category:string,query:string){const q=query.trim().toLowerCase();return catalog.filter(s=>(category==='所有风格'||s.group===category)&&`${s.name} ${s.category}`.toLowerCase().includes(q));}
export interface DemoRecord {id:string;name:string;image:string;created:string;demo:true;beforeLabel:string}
export interface State {version:1;bannerHidden:boolean;rememberOptions:boolean;options:Record<string,string>;records:DemoRecord[]}
export const initialState=():State=>({version:1,bannerHidden:false,rememberOptions:true,options:{},records:[]});
export function decodeState(value:unknown):State{
 try{const v=typeof value==='string'?JSON.parse(value):value;if(!v||v.version!==1)return initialState();
 const safe=initialState();safe.bannerHidden=v.bannerHidden===true;safe.rememberOptions=v.rememberOptions!==false;
 if(v.options&&typeof v.options==='object') for(const k of ['风格类型','护理程度','偏好长度','发色偏好'])if(typeof v.options[k]==='string'&&v.options[k].length<30)safe.options[k]=v.options[k];
 if(Array.isArray(v.records))safe.records=v.records.filter((r:any)=>r&&r.demo===true&&typeof r.id==='string'&&typeof r.name==='string'&&r.name.length<100&&catalog.some(s=>s.image===r.image)&&typeof r.created==='string'&&typeof r.beforeLabel==='string').slice(0,50);
 return safe;}catch{return initialState();}
}
export interface PhotoMeta {size:number;type:string;width?:number;height?:number}
export function validatePhoto(p:PhotoMeta):string{
 if(!['image/jpeg','image/png','image/webp'].includes(p.type))return '请选择 JPG、PNG 或 WebP 图片';
 if(p.size<=0)return '文件为空或已损坏';if(p.size>8*1024*1024)return '图片不得超过 8 MB';
 if(p.width!==undefined&&p.height!==undefined&&(p.width<32||p.height<32||p.width*p.height>24_000_000))return '图片尺寸需至少 32×32，且不超过 2400 万像素';return '';
}
export interface GenerationRequest {photo:string;styleId?:string;options:Record<string,string>;requirements:string;demo:boolean}
export interface GenerationResult {demo:true;style:Style}
export interface GenerationService {generate(request:GenerationRequest):Promise<GenerationResult>}
export class LocalGenerationService implements GenerationService{
 async generate(r:GenerationRequest):Promise<GenerationResult>{if(!r.photo)throw new Error('请先上传您的照片');if(!r.demo)throw new Error('AI 服务未配置。照片未上传，请配置服务后重试，或显式选择演示模式。');
 const style=catalog.find(s=>s.id===r.styleId)||catalog.find(s=>s.id==='catalog-53-1')!;return {demo:true,style};}
}
export function makeRecord(result:GenerationResult):DemoRecord{return {id:`demo-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,name:result.style.name,image:result.style.image,created:new Date().toISOString(),demo:true,beforeLabel:'目录示例对比，非用户照片生成'};}
export function removeRecords(state:State,ids:string[]){return {...state,records:state.records.filter(r=>!ids.includes(r.id))};}
