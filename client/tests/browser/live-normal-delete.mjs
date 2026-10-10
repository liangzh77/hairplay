// Post-deploy check: on the deployed site with Web Locks available, deleting a
// generated picture performs exactly one synchronized write and reports it.
import {assert, jpegDataUrl, launchBrowser, liveBase} from './harness.mjs';

const url = liveBase();
const jpeg = await jpegDataUrl();
const browser = await launchBrowser();
const errors = [];
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(url,{waitUntil:'networkidle'});
 await p.evaluate(image=>localStorage.setItem('hairplay.generations.v1',JSON.stringify([{id:'gen-live',name:'庞巴杜发型',image,created:new Date().toISOString(),source:'ai'}])),jpeg);
 await p.reload({waitUntil:'networkidle'});
 assert.equal(await p.evaluate(()=>typeof navigator.locks),'object');
 await p.evaluate(()=>{window.__writes=0;const o=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(String(k)==='hairplay.generations.v1')window.__writes++;return o.call(this,k,v)};});
 await p.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 await p.locator('uni-button[aria-label^="AI 生成记录"]').first().click();
 await p.locator('uni-button').filter({hasText:'删除这张'}).click();
 await p.locator('uni-button').filter({hasText:'确认删除'}).click();
 await p.locator('.notice').filter({hasText:'已从本机删除'}).first().waitFor({timeout:15000});
 const message='';
 const writes=await p.evaluate(()=>window.__writes);
 const kept=await p.evaluate(()=>JSON.parse(localStorage.getItem('hairplay.generations.v1')).length);
 const notices=await p.locator('.notice').allInnerTexts();
 console.log(JSON.stringify({message,includesWebLocks:/Web Locks/.test(message),writes,kept,notices:notices.filter(t=>/删除/.test(t))}));
 assert.equal(writes,1,'exactly one synchronized write');
 assert.equal(kept,0,'the picture must be deleted');
 assert.ok(notices.some(t=>/已从本机删除/.test(t)),'success must be reported');
 console.log('LIVE_NORMAL_DELETE_OK errors='+errors.length);
}catch(e){console.error(e);process.exitCode=1;}finally{await browser.close();}
