import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
// Promoted from Astra high's independent real-API probes; upstream/email are fake-only.
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AuthStore} from '../../../server/auth.mjs';
import {createApp} from '../../../server/ark.mjs';
import {assert,startStatic,launchBrowser,repoPath,STATE_KEY,GENERATIONS_KEY} from './harness.mjs';
const bytes=readFileSync(repoPath('client/src/static/catalog/ai-catalog-53-0.jpg'));
const browser=await launchBrowser(),failures=[];
const btn=(p,t)=>p.locator('uni-button').filter({hasText:new RegExp('^'+t+'$')});
const nav=(p,t)=>p.locator('[aria-label="导航 '+t+'"]').click();
const poll=async fn=>{for(let i=0;i<150;i++){if(await fn())return;await new Promise(r=>setTimeout(r,30))}throw Error('timeout')};
async function begin(p){await nav(p,'AI匹配');const chooser=p.waitForEvent('filechooser');chooser.catch(()=>{});await p.locator('uni-button').filter({hasText:'选择本地照片'}).click();await (await chooser).setFiles(repoPath('client/src/static/catalog/ai-catalog-44-0.jpg'));await p.locator('.photo-area').waitFor();await btn(p,'试试 AI 发型').click();await btn(p,'确认上传并生成').click();}
async function fixture({favorites=[],noBC=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'hairplay-real-race-')),store=new AuthStore(dir+'/auth.sqlite');
 const A='a@example.invalid',B='b@example.invalid';
 const token=store.verify(A,store.issue(A,'a')),a=store.session(token);
 const firstB=store.verify(B,store.issue(B,'b')),b=store.session(firstB);store.logout(firstB);store.db.prepare('DELETE FROM sends').run();
 const codeB=store.issue(B,'b-login');store.setFavorites(a.id,favorites);store.setFavorites(b.id,['catalog-44-1']);
 let app;const s={upstreamCalls:0,generateRequests:[],holdUpstream:false,release:null};const server=await startStatic({handler:(req,res,url)=>{if(!url.pathname.startsWith('/hairplay/api/'))return false;
  if(url.pathname.endsWith('/generate')){const token=(req.headers.cookie||'').split('hairplay=')[1]?.split(';')[0];s.generateRequests.push({owner:store.session(token)?.email});}
  app.emit('request',req,res);return true;
 }});
 app=createApp({auth:store,config:{key:'FAKE-ONLY',model:'fake-only',endpoint:'https://never-contact.invalid'},mailer:{send:async()=>{throw Error('REAL EMAIL FORBIDDEN')}},origins:[server.origin],base:'/hairplay/',fetchImpl:async()=>{s.upstreamCalls++;if(s.holdUpstream)await new Promise(r=>s.release=r);return new Response(JSON.stringify({data:[{b64_json:bytes.toString('base64')}]}));}});
 const context=await browser.newContext({viewport:{width:390,height:844}});
 if(noBC)await context.addInitScript(()=>Object.defineProperty(window,'BroadcastChannel',{value:undefined}));
 await context.addInitScript(()=>{window.reviewWrites=[];const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){let rows;try{rows=JSON.parse(v)}catch{};window.reviewWrites.push({key:k,clouds:Array.isArray(rows)?rows.map(r=>r.cloud||null):null});return set.call(this,k,v)}});
 await context.route('**/*',route=>new URL(route.request().url()).origin===server.origin?route.continue():route.abort());
 await context.addCookies([{name:'hairplay',value:token,domain:'127.0.0.1',path:'/hairplay/',httpOnly:true,sameSite:'Lax'}]);
 const p=await context.newPage();p.setDefaultTimeout(5000);await p.goto(server.url,{waitUntil:'networkidle'});
 const change=async page=>{await nav(page,'个人资料');await btn(page,'退出登录').click();await page.locator('.auth-message').filter({hasText:'已退出登录'}).waitFor();await page.locator('#auth-email input').fill(B);await page.locator('#auth-code input').fill(codeB);await btn(page,'注册 / 登录').click();await page.locator('.auth-message').filter({hasText:'登录成功'}).waitFor();};
 return {p,context,s,store,a,b,change,url:server.url,codeB,token,close:async()=>{s.release?.();await context.close();await server.close();app.close();store.close();rmSync(dir,{recursive:true,force:true})}};
}
export {fixture,begin,btn,nav,poll,browser,bytes,assert,STATE_KEY,GENERATIONS_KEY};
