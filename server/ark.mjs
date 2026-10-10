import {readFile, stat} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const catalog=JSON.parse(await readFile(resolve(projectRoot,'client/src/core/catalog.json'),'utf8'));
const styles=new Map(catalog.map(({id,image})=>[id,image]));
const requestLimit=12*1024*1024;
const imageLimit=8*1024*1024;
import sharp from 'sharp';
import {AuthStore,normalizeEmail,validEmail,validGender} from './auth.mjs';
import {loadMailer} from './mail.mjs';

export async function loadConfig(file=resolve(projectRoot,'.secrets/ark.env')){
 const info=await stat(file);
 if((info.mode&0o077)!==0)throw Error('Ark config must be owner-only (chmod 600)');
 const values={};
 for(const line of (await readFile(file,'utf8')).split(/\r?\n/)){
  if(!line||line.startsWith('#'))continue;
  const match=/^(VOLCENGINE_ARK_API_KEY|VOLCENGINE_ARK_MODEL|VOLCENGINE_ARK_BASE_URL)=([^\r\n]+)$/.exec(line);
  if(!match||Object.hasOwn(values,match[1]))throw Error('Invalid or duplicate Ark configuration');
  values[match[1]]=match[2];
 }
 if(!values.VOLCENGINE_ARK_API_KEY||!/^doubao-seedream-[a-z0-9-]+$/.test(values.VOLCENGINE_ARK_MODEL||'')||values.VOLCENGINE_ARK_BASE_URL!=='https://ark.cn-beijing.volces.com/api/v3')throw Error('Ark config incomplete or endpoint invalid');
 return {key:values.VOLCENGINE_ARK_API_KEY,model:values.VOLCENGINE_ARK_MODEL,endpoint:values.VOLCENGINE_ARK_BASE_URL};
}

function imageData(value){
 const m=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value||'');
 if(!m||m[2].length>Math.ceil(imageLimit/3)*4+4)throw Error('照片必须是 8 MB 以内的 JPG、PNG 或 WebP');
 const bytes=Buffer.from(m[2],'base64');
 if(bytes.length<100||bytes.length>imageLimit||bytes.toString('base64')!==m[2])throw Error('照片数据无效或过大');
 const ok=m[1]==='jpeg'?bytes[0]===255&&bytes[1]===216:m[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!ok)throw Error('照片格式与内容不一致');
 return value;
}
function json(res,status,body){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(JSON.stringify(body));}

export function createApp({config,auth,mailer,origins=['http://127.0.0.1:8767','http://127.0.0.1:8766','http://127.0.0.1:8765'],base='/',trustLoopbackProxy=false,fetchImpl=fetch,readStyle=readFile}={}){
 if(!config)throw Error('Missing server-side Ark configuration');
 if(!auth||!mailer||!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)||origins.length===0)throw Error('Missing authentication/mail/site configuration');
 if(origins.some(o=>{try{return new URL(o).origin!==o;}catch{return true;}}))throw Error('Invalid site origin');
 const secure=origins.every(o=>o.startsWith('https://'));if(!secure&&origins.some(o=>!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(o)))throw Error('HTTPS required');
 const cookieName=secure?'__Secure-hairplay':'hairplay';
 const cookie=token=>`${cookieName}=${token}; Path=${base}; HttpOnly; SameSite=Lax; Max-Age=${token?604800:0}${secure?'; Secure':''}`;
 const token=req=>{const matches=(req.headers.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(cookieName+'='));return matches.length===1?matches[0].slice(cookieName.length+1):'';};
 let active=false;
 return createServer(async(req,res)=>{
  try{
  if(req.url==='/health'&&req.method==='GET'){json(res,200,{status:'ok',imageGeneration:true});return;}
  const route=req.url?.startsWith(base+'api/')?'/api/'+req.url.slice((base+'api/').length):'';
  const origin=req.headers.origin||'';
  if((origin&&!origins.includes(origin))||(req.method==='POST'&&(!origins.includes(origin)||req.headers['content-type']?.split(';')[0]!=='application/json'))){json(res,403,{error:'请求来源不允许'});return;}
  const user=auth.session(token(req));
  // Disabled by default. Enable only for an explicitly configured HTTPS reverse proxy
  // which overwrites X-Real-IP; local/dev callers cannot bypass the IP budget.
  const forwarded=trustLoopbackProxy&&secure&&req.socket.remoteAddress==='127.0.0.1'&&typeof req.headers['x-real-ip']==='string'&&/^[0-9a-fA-F:.]{3,45}$/.test(req.headers['x-real-ip'])?req.headers['x-real-ip']:req.socket.remoteAddress||'unknown';
  if(route==='/api/session'&&req.method==='GET'){json(res,200,{account:user?{email:user.email,gender:user.gender??null,remaining:auth.remaining(user.id)}:null});return;}
  if(!['/api/generate','/api/auth/code','/api/auth/login','/api/auth/logout','/api/auth/gender'].includes(route)||req.method!=='POST'){json(res,404,{error:'Not found'});return;}
  if(route==='/api/auth/logout'){auth.logout(token(req));res.setHeader('set-cookie',cookie(''));json(res,200,{ok:true});return;}
  if((route==='/api/generate'||route==='/api/auth/gender')&&!user){json(res,401,{error:'请先使用邮箱登录'});return;}
  const limit=route==='/api/generate'?requestLimit:2048;
  if(Number(req.headers['content-length'])>limit){json(res,413,{error:'请求过大'});return;}
  const chunks=[];let size=0;let job;let ownsActive=false;
  if(route==='/api/generate'){if(active){json(res,429,{error:'当前生成任务繁忙'});return;}active=true;ownsActive=true;}
  try{
   for await(const part of req){size+=part.length;if(size>limit){json(res,413,{error:'请求过大'});return;}chunks.push(part);}
   const input=JSON.parse(Buffer.concat(chunks).toString('utf8')); 
   if(route==='/api/auth/gender'){
    if(!validGender(input.gender)){json(res,400,{error:'请选择男、女或不填写'});return;}
    auth.setGender(user.id,input.gender);json(res,200,{ok:true});return;
   }
   const email=normalizeEmail(input.email);
   if(route==='/api/auth/code'){
    if(!validEmail(email)){json(res,400,{error:'请输入有效的邮箱地址'});return;}
    const code=auth.issue(email,forwarded);
    try{await mailer.send(email,code);}catch{auth.invalidate(email,code);json(res,503,{error:'邮件服务暂不可用，请稍后重试'});return;}
    json(res,200,{ok:true,message:'如符合注册条件，验证码将在数分钟内送达，请查看收件箱'});return;
   }
   if(route==='/api/auth/login'){
    if(!email){json(res,400,{error:'请先填写邮箱地址'});return;}
    if(!validEmail(email)){json(res,400,{error:'请输入有效的邮箱地址'});return;}
    if(typeof input.code!=='string'||!/^\d{6}$/.test(input.code)){json(res,400,{error:'请输入邮件里的6位数字验证码'});return;}
    const gender=input.gender===undefined?null:input.gender;
    if(!validGender(gender)){json(res,400,{error:'请选择男、女或不填写'});return;}
    const session=auth.verify(email,input.code,gender);if(!session){json(res,400,{error:'验证码无效、过期或暂无法注册，请重试'});return;}
    res.setHeader('set-cookie',cookie(session));json(res,200,{ok:true});return;
   }
   imageData(input.photo);
   const cleaned=await sharp(Buffer.from(input.photo.split(',')[1],'base64'),{limitInputPixels:25_000_000}).rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer();
   const photo='data:image/jpeg;base64,'+cleaned.toString('base64');
   if(typeof input.styleId!=='string'||!styles.has(input.styleId))throw Error('发型编号无效');
   if(input.requirements!==undefined&&(typeof input.requirements!=='string'||input.requirements.length>300))throw Error('要求文字过长');
   const stylePath=styles.get(input.styleId);
   if(!/^\/static\/catalog\/ai-(?:catalog-\d+-[01]|dracula)\.jpg$/.test(stylePath))throw Error('参考图不在允许列表');
   job=auth.reserve(user.id);if(!job){json(res,429,{error:'每个账户终身最多成功生成 3 张图片'});return;}
   const style=await readStyle(resolve(projectRoot,'client/src'+stylePath));
   const prompt=`以图1的成年人物为主体，仅将图1的发型改变为图2所示发型。尽可能保持图1人物五官、身份特征、肤色、服装、姿势与背景；自然发际线，真实摄影效果，不加水印与文字。${input.requirements?'补充要求：'+input.requirements:''}`;
   const upstream=await fetchImpl(config.endpoint+'/images/generations',{method:'POST',headers:{authorization:'Bearer '+config.key,'content-type':'application/json'},body:JSON.stringify({model:config.model,prompt,image:[photo,'data:image/jpeg;base64,'+style.toString('base64')],size:'2K',response_format:'b64_json',watermark:false}),signal:AbortSignal.timeout(150000)});
   if(!upstream.ok)throw Error('火山方舟请求失败（HTTP '+upstream.status+'）');
   const data=await upstream.json();
   const raw=data?.data?.[0]?.b64_json;
   if(typeof raw!=='string'||raw.length>16_000_000)throw Error('火山方舟未返回有效图片');
   const result=Buffer.from(raw,'base64');
   if(result.length<50000||result.length>12_000_000||result.toString('base64')!==raw||result[0]!==255||result[1]!==216)throw Error('火山方舟返回的图片格式不正确');
   await sharp(result,{limitInputPixels:25_000_000}).stats();
   auth.finish(job,true);job=null;
   json(res,200,{image:'data:image/jpeg;base64,'+raw,remaining:auth.remaining(user.id)});
  }catch(e){json(res,e.status|| (job?502:400),{error:job?'生成失败，请稍后重试；未扣成功额度':e.status===429?e.message:'请求无效，请检查输入'});}
  finally{try{if(job)auth.finish(job,false);}finally{if(ownsActive)active=false;}}
  }catch{
   // SQLite lock/corruption and other unexpected errors must not crash Node or leak details.
   if(!res.headersSent)json(res,503,{error:'服务暂不可用，请稍后重试'});
   else res.destroy();
  }
 });
}
if(process.argv[1]&&realpathSync(resolve(process.argv[1]))===realpathSync(fileURLToPath(import.meta.url))){
 const config=await loadConfig();
 const mailer=await loadMailer(resolve(projectRoot,'.secrets/mail.env'));
 const auth=new AuthStore(resolve(projectRoot,'.data/auth.sqlite'));
 const origins=process.env.HAIRPLAY_ORIGIN?[process.env.HAIRPLAY_ORIGIN]:undefined;
 const server=createApp({config,auth,mailer,base:process.env.HAIRPLAY_BASE||'/',origins,trustLoopbackProxy:process.env.HAIRPLAY_TRUST_PROXY==='1'&&process.env.HAIRPLAY_ORIGIN==='https://liangz77.cn'});
 server.listen(8777,'127.0.0.1',()=>console.log('HairPlay Ark local API on http://127.0.0.1:8777 (not public)'));
}
