// Post-deploy check: on the deployed site, a runtime without Web Locks must
// refuse the delete (no unlocked write, picture kept, no false success).
import {assert, jpegDataUrl, launchBrowser, liveBase} from './harness.mjs';

const url = liveBase();
const jpeg = await jpegDataUrl();
const browser = await launchBrowser();
const errors = [];
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844}});
 await ctx.addInitScript(()=>Object.defineProperty(navigator,'locks',{configurable:true,value:undefined}));
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(url,{waitUntil:'networkidle'});
 await p.evaluate(image=>localStorage.setItem('hairplay.generations.v1',JSON.stringify([{id:'gen-live',name:'庞巴杜发型',image,created:new Date().toISOString(),source:'ai'}])),jpeg);
 await p.reload({waitUntil:'networkidle'});
 assert.equal(await p.evaluate(()=>typeof navigator.locks),'undefined');
 await p.evaluate(()=>{window.__writes=0;const o=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(String(k)==='hairplay.generations.v1')window.__writes++;return o.call(this,k,v)};});
 await p.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 await p.locator('uni-button[aria-label^="AI 生成记录"]').first().click();
 await p.locator('uni-button').filter({hasText:'删除这张'}).click();
 await p.locator('uni-button').filter({hasText:'确认删除'}).click();
 await p.locator('.error').first().waitFor({timeout:15000});
 const message=await p.locator('.error').first().innerText();
 const writes=await p.evaluate(()=>window.__writes);
 const kept=await p.evaluate(()=>JSON.parse(localStorage.getItem('hairplay.generations.v1')).length);
 const notices=await p.locator('.notice').allInnerTexts();
 console.log(JSON.stringify({message,includesWebLocks:/Web Locks/.test(message),writes,kept,notices:notices.filter(t=>/删除/.test(t))}));
 assert.match(message,/Web Locks/,'the live build must fail closed');
 assert.equal(writes,0,'no unlocked write');
 assert.equal(kept,1,'the picture must survive');
 assert.deepEqual(notices.filter(t=>/已从本机删除|已删除所选/.test(t)),[],'no false success');
 console.log('LIVE_FAILCLOSED_OK errors='+errors.length);
}catch(e){console.error(e);process.exitCode=1;}finally{await browser.close();}
