// Narrow-phone layout and storage separation: both gallery sections render at
// 360 and 390 px wide, and generated pictures never enter the Service Worker
// image cache.
import {assert, jpegDataUrl, launchBrowser, startStatic} from './harness.mjs';

const realJpeg = await jpegDataUrl();
const server = await startStatic({
	handler: (req, res, url) => {
		if (url.pathname !== '/hairplay/api/session') return false;
		res.writeHead(200, {'Content-Type': 'application/json'});
		res.end('{"account":null}');
		return true;
	},
});
const url = server.url;
let browser;
try{
 browser=await launchBrowser();
 for(const width of [360,390]){
  const page=await browser.newPage({viewport:{width,height:840}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${url}`,{waitUntil:'domcontentloaded'});
  await page.evaluate(jpeg=>{localStorage.setItem('hairai.study.v1',JSON.stringify({version:1,bannerHidden:true,rememberOptions:true,options:{},records:[{id:'demo-1',name:'许士剪',image:'/static/catalog/ai-catalog-44-1.jpg',created:'2026-10-10T00:00:00.000Z',demo:true,beforeLabel:'示例'}]}));
   localStorage.setItem('hairplay.generations.v1',JSON.stringify([{id:'gen-1',name:'庞巴杜发型',image:jpeg,created:'2026-10-10T00:00:00.000Z',source:'ai'}]))},realJpeg);
  await page.reload({waitUntil:'networkidle'});
  const btn=page.locator('.tabs uni-button[aria-label="导航 画廊"]');await btn.waitFor();
  let ready=false;for(let i=0;i<20&&!ready;i++){await btn.click();ready=await page.evaluate(()=>document.querySelectorAll('.gallery-section').length===2);if(!ready)await page.waitForTimeout(250)}
  assert.ok(ready,'gallery sections never rendered');
  const dom=await page.evaluate(()=>({tabs:document.querySelector('.tabs')?.innerText,sections:Array.from(document.querySelectorAll('.gallery-section')).map(e=>e.innerText),urls:[]}));
  assert.match(dom.tabs,/画廊/);
  assert.equal(dom.sections.length,2);
  assert.match(dom.sections[0],/我的生成\s+01/);
  assert.match(dom.sections[1],/模板示例\s+01/);
  // Rendering-level URL policy is asserted in client/tests/gallery.test.ts; here we
  // confirm the persisted template stays a bare catalog path (versioning is render-time)
  // while the generated picture is a local data URL in its own key.
  const stored=await page.evaluate(()=>({template:JSON.parse(localStorage.getItem('hairai.study.v1')).records.map(r=>r.image),generated:JSON.parse(localStorage.getItem('hairplay.generations.v1')).map(r=>r.image)}));
  assert.deepEqual(stored.template,['/static/catalog/ai-catalog-44-1.jpg']);
  assert.equal(stored.generated.length,1);assert.ok(stored.generated[0].startsWith('data:image/jpeg;base64,'));
  // Browser-level storage separation: the template record lives in the shared
  // state key, generated pictures in their own local key, and never in the SW cache.
  const layers=await page.evaluate(async()=>{const names=(await caches.keys()).filter(n=>n.startsWith('hairplay-public-images-'));const entries=[];for(const n of names)entries.push(...(await (await caches.open(n)).keys()).map(r=>r.url));return {names,entries}});
  assert.ok(layers.entries.every(u=>!u.includes('data:')&&!u.includes('generations')),'generated images must never enter the Service Worker cache');
  assert.deepEqual(errors,[]);
  await page.close();
 }
 console.log('GALLERY_LAYOUT_OK sections=2 widths=360,390 cache_clean=OK');
}finally{await browser?.close();server.close()}
