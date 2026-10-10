// Local gallery end to end: upload -> generate -> save -> detail -> download
// -> delete, plus the failure paths (a lost write, a failed delete, a mixed
// selection, the write-time cap) that only a real browser can exercise.
import {
	assert, launchBrowser, readGenerations, readRepo, repoPath, startStatic,
} from './harness.mjs';

const styleJpeg = await readRepo('client/src/static/catalog/ai-catalog-44-1.jpg');
const styleB64 = styleJpeg.toString('base64');
const photoPath = repoPath('client/src/static/catalog/ai-catalog-44-0.jpg');
const photoB64 = (await readRepo('client/src/static/catalog/ai-catalog-44-0.jpg')).toString('base64');
const realJpeg = () => 'data:image/jpeg;base64,' + styleB64;
let generateCalls = 0;
const json = (res, code, body) => { res.writeHead(code, {'Content-Type': 'application/json'}); res.end(JSON.stringify(body)); };
// A stubbed API: the harness never talks to the real generation service.
const server = await startStatic({
	handler: async (req, res, url) => {
		if (url.pathname === '/hairplay/api/session') { json(res, 200, {account: {email: 'qa@example.invalid', gender: 'male', remaining: 3}}); return true; }
		if (url.pathname === '/hairplay/api/generate') { generateCalls++; for await (const _ of req) {} json(res, 200, {image: realJpeg(), remaining: 2}); return true; }
		return false;
	},
});
const url = server.url;
let browser;
try{
 browser=await launchBrowser();
 const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addInitScript(b64=>{globalThis.__realJpeg='data:image/jpeg;base64,'+b64;},styleB64);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${url}`,{waitUntil:'networkidle'});
  await page.locator('.tabs uni-button[aria-label="导航 AI匹配"]').click();
 const chooser=page.waitForEvent('filechooser');await page.locator('uni-button').filter({hasText:'选择本地照片'}).click();(await chooser).setFiles(photoPath);
 // Wait for the preview: a big photo takes a moment to decode, and clicking
 // before the preview exists would be rejected as "no photo chosen".
 await page.locator('.photo-area').waitFor();
 await page.locator('uni-button').filter({hasText:'试试 AI 发型'}).click();
 await page.locator('uni-text').filter({hasText:'确认发送照片？'}).waitFor();
 const confirmText=await page.locator('.modal-copy').innerText();
 assert.match(confirmText,/生成结果会自动保存到本机相册「我的生成」，可随时删除；上传的原照片不会被保存/);
 await page.locator('uni-button').filter({hasText:'确认上传并生成'}).click();
 await page.locator('uni-text').filter({hasText:'已保存到相册「我的生成」，可随时删除。'}).waitFor();
 assert.equal(generateCalls,1);
 const saved=await readGenerations(page);
 assert.equal(saved.length,1);assert.equal(saved[0].source,'ai');assert.ok(saved[0].id.startsWith('gen-'));assert.equal(saved[0].name,"庞巴杜发型");
 assert.ok(saved[0].image.startsWith('data:image/jpeg;base64,'));assert.ok(saved[0].image.length<3_000_000);
 assert.ok(!saved[0].image.includes(photoB64),'the uploaded photo must not be stored');
 assert.ok(!saved[0].image.includes('blob:'),'blob URLs are not durable and must not be stored');
 assert.ok(saved[0].image.length<styleJpeg.length*4/3+10_000,'stored copy should be a downscaled re-encode');
 await page.locator('uni-button').filter({hasText:'查看相册'}).click();
 await page.locator('uni-text').filter({hasText:'我的生成'}).first().waitFor();
 assert.equal(await page.locator('uni-button[aria-label^="AI 生成记录"]').count(),1);
 assert.match(await page.locator('.gallery-section').first().innerText(),/我的生成\s+01/);
 assert.match(await page.locator('.gallery-section').nth(1).innerText(),/模板示例\s+00/);
 assert.match(await page.locator('.empty-mini').innerText(),/还没有保存的模板示例/);
 // Persistence across a reload, then detail + download + delete.
 await page.reload({waitUntil:'networkidle'});
 await page.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 assert.equal(await page.locator('uni-button[aria-label^="AI 生成记录"]').count(),1);
 await page.locator('uni-button[aria-label^="AI 生成记录"]').click();
 await page.locator('.ai-badge').filter({hasText:'仅保存在本机'}).waitFor();
 const download=page.waitForEvent('download');await page.locator('uni-button').filter({hasText:'下载到本机'}).click();const file=await download;
 assert.equal(file.suggestedFilename(),'HairPlay-AI-庞巴杜发型.jpg');
 await page.locator('uni-button').filter({hasText:'删除这张'}).click();
 await page.locator('uni-button').filter({hasText:'确认删除'}).click();
 await page.locator('.notice').filter({hasText:'已从本机删除这张生成图片'}).first().waitFor();
 assert.deepEqual(await readGenerations(page),[]);
 assert.equal(await page.locator('uni-button[aria-label^="AI 生成记录"]').count(),0);
 await page.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 assert.match(await page.locator('.gallery-section').first().innerText(),/还没有 AI 生成记录/);
 // Multi-select delete keeps templates intact while clearing generations.
 await page.evaluate(()=>localStorage.setItem('hairplay.generations.v1',JSON.stringify([{id:'gen-keep',name:"庞巴杜发型",image:globalThis.__realJpeg,created:new Date().toISOString(),source:'ai'}])));
 await page.reload({waitUntil:'networkidle'});await page.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 await page.locator('uni-button').filter({hasText:'选择'}).click();
 await page.locator('uni-button[aria-label^="AI 生成记录"]').click();
 await page.locator('uni-button').filter({hasText:'删除所选（1）'}).click();
 await page.locator('uni-button').filter({hasText:'确认删除'}).click();
 // Deletes are serialized through a storage lock now, so the write lands after
 // the confirmation click: wait for the UI to confirm before reading storage.
 await page.locator('.notice').filter({hasText:'已删除所选记录'}).first().waitFor();
 assert.deepEqual(await readGenerations(page),[]);

 // Payloads that only claim to be JPEGs must never be trusted or rendered.
 const good=id=>({id,name:"庞巴杜发型",image:realJpeg(),created:new Date().toISOString(),source:'ai'});
 await page.evaluate(list=>localStorage.setItem('hairplay.generations.v1',JSON.stringify(list)),[
  {id:'gen-fake',name:'伪造',image:'data:image/jpeg;base64,AAAA',created:new Date().toISOString(),source:'ai'},
  {id:'gen-bare',name:'空载',image:'data:image/jpeg;base64,',created:new Date().toISOString(),source:'ai'},
  {id:'gen-png',name:'PNG冒充',image:'data:image/png;base64,'+'A'.repeat(2000),created:new Date().toISOString(),source:'ai'},
  {id:'gen-huge',name:'超大',image:'data:image/jpeg;base64,/9j/'+'A'.repeat(2_200_001),created:new Date().toISOString(),source:'ai'},
  // A valid-looking prefix is not enough: these bodies have no JPEG EOI marker.
  {id:'gen-soi',name:'伪 JPEG',image:'data:image/jpeg;base64,/9j/'+'A'.repeat(2_000),created:new Date().toISOString(),source:'ai'},
  {id:'gen-soi2',name:'伪 JPEG2',image:'data:image/jpeg;base64,/9j/'+'!'.repeat(2_000),created:new Date().toISOString(),source:'ai'},
  {id:'gen-trunc',name:'截断真图',image:'data:image/jpeg;base64,'+styleB64.slice(0,-8)+'AAAAAAAA',created:new Date().toISOString(),source:'ai'},
  // Structural openings that are not a JPEG segment an encoder could write:
  // a stuffed byte, a reserved code, and a zero-length APP0 segment.
  ...[['gen-open-stuffed',0x00,0x2a],['gen-open-reserved',0x02,0x2a],['gen-open-zero',0xe0,0x0000]].map(([id,marker,declared])=>({
   id,name:'伪段 '+id,created:new Date().toISOString(),source:'ai',
   image:'data:image/jpeg;base64,'+Buffer.from([0xff,0xd8,0xff,marker,(Number(declared)>>8)&0xff,Number(declared)&0xff,...Array(60).fill(0),0xff,0xd9]).toString('base64'),
  }))]);
 await page.reload({waitUntil:'networkidle'});await page.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 assert.equal(await page.locator('uni-button[aria-label^="AI 生成记录"]').count(),0,'invalid JPEG payloads must be dropped');
 assert.match(await page.locator('.gallery-section').first().innerText(),/还没有 AI 生成记录/);

 // Two tabs must not resurrect what the other tab deleted.
 const seed=[good('gen-a'),{...good('gen-b'),name:'发际纹身渐变'}];
 await page.evaluate(list=>localStorage.setItem('hairplay.generations.v1',JSON.stringify(list)),seed);
 await page.reload({waitUntil:'networkidle'});await page.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 const other=await context.newPage();other.on('pageerror',e=>errors.push(e.message));
 await other.goto(`${url}`,{waitUntil:'networkidle'});await other.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 assert.equal(await other.locator('uni-button[aria-label^="AI 生成记录"]').count(),2);
 await page.locator('uni-button[aria-label^="AI 生成记录"]').first().click();
 await page.locator('uni-button').filter({hasText:'删除这张'}).click();
 await page.locator('uni-button').filter({hasText:'确认删除'}).click();
 await page.locator('.notice').filter({hasText:'已从本机删除这张生成图片'}).first().waitFor();
 assert.deepEqual((await readGenerations(other)).map(r=>r.id),['gen-b'],'storage must lose the record deleted in the other tab');
 await other.reload({waitUntil:'networkidle'});await other.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 assert.equal(await other.locator('uni-button[aria-label^="AI 生成记录"]').count(),1,'reload must not resurrect the deleted record');
 await other.locator('uni-button[aria-label^="AI 生成记录"]').first().click();
 await other.locator('uni-button').filter({hasText:'删除这张'}).click();
 await other.locator('uni-button').filter({hasText:'确认删除'}).click();
 await other.locator('.notice').filter({hasText:'已从本机删除这张生成图片'}).first().waitFor();
 assert.deepEqual(await readGenerations(page),[],'second tab deletion must not write back the first tab record');
 // Both tabs deleting different records at the same moment must converge: no
 // tab may write its stale snapshot back and resurrect the other tab's record.
 await page.evaluate(list=>localStorage.setItem('hairplay.generations.v1',JSON.stringify(list)),seed);
 await page.reload({waitUntil:'networkidle'});await page.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 await other.goto(`${url}`,{waitUntil:'networkidle'});await other.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 assert.equal(await page.locator('uni-button[aria-label^="AI 生成记录"]').count(),2);
 await page.locator('uni-button[aria-label^="AI 生成记录"]').first().click();
 await page.locator('uni-button').filter({hasText:'删除这张'}).click();
 await other.locator('uni-button[aria-label^="AI 生成记录"]').nth(1).click();
 await other.locator('uni-button').filter({hasText:'删除这张'}).click();
 await Promise.all([
  page.locator('uni-button').filter({hasText:'确认删除'}).click(),
  other.locator('uni-button').filter({hasText:'确认删除'}).click(),
 ]);
 // Both tabs report the deletion only after their own write landed, so waiting
 // for that text (not merely for a `.notice` element) is what makes the storage
 // read below meaningful.
 await page.locator('.notice').filter({hasText:'已从本机删除这张生成图片'}).first().waitFor();
 await other.locator('.notice').filter({hasText:'已从本机删除这张生成图片'}).first().waitFor();
 const concurrent=await page.evaluate(()=>JSON.parse(localStorage.getItem('hairplay.generations.v1')||'[]').map(r=>r.id));
 assert.deepEqual(concurrent,[],'simultaneous deletes in two tabs must both stick, got '+JSON.stringify(concurrent));
 assert.equal(await page.locator('uni-button[aria-label^="AI 生成记录"]').count(),0);
 await page.reload({waitUntil:'networkidle'});await page.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 assert.equal(await page.locator('uni-button[aria-label^="AI 生成记录"]').count(),0,'reload must not resurrect concurrently deleted records');
 await other.close();

 // A storage write that silently does nothing must not be reported as saved:
 // run it in a fresh page whose setItem is a no-op for the generations key.
 const full=await context.newPage();full.on('pageerror',e=>errors.push(e.message));
 await full.bringToFront();
 await full.goto(`${url}`,{waitUntil:'networkidle'});
 const beforeWrite=await full.evaluate(()=>localStorage.getItem('hairplay.generations.v1'));
 await full.evaluate(()=>{const orig=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(String(k).includes('hairplay.generations.v1'))return;return orig.call(this,k,v)};});
 await full.locator('.tabs uni-button[aria-label="导航 AI匹配"]').click();
 const chooser2=full.waitForEvent('filechooser');await full.locator('uni-button').filter({hasText:'选择本地照片'}).click();(await chooser2).setFiles(photoPath);
 // A photo of this size needs a moment to decode; clicking 试试 AI 发型 before the
 // preview exists would be answered with "请先上传您的照片".
 await full.locator('.photo-area').waitFor();
 await full.locator('uni-button').filter({hasText:'试试 AI 发型'}).click();
 await full.locator('uni-button').filter({hasText:'确认上传并生成'}).click();
 await full.locator('.modal-copy').filter({hasText:'尚未保存到本机相册'}).waitFor({timeout:60000});
 assert.equal(await full.locator('.notice').filter({hasText:'已保存到相册'}).count(),0,'a lost write must not be announced as saved');
 assert.equal(await full.evaluate(()=>localStorage.getItem('hairplay.generations.v1')),beforeWrite,'the lost write must leave storage untouched');
 assert.equal(await full.locator('uni-button[aria-label^="AI 生成记录"]').count(),0);
 const dl=full.waitForEvent('download');await full.locator('uni-button').filter({hasText:'下载这张'}).click();
 assert.match((await dl).suggestedFilename(),/^HairPlay-AI-.*\.jpg$/);
 await full.close();
 // A delete whose write silently fails must not claim success and must keep the record.
 const del=await context.newPage();del.on('pageerror',e=>errors.push(e.message));
 await del.bringToFront();
 await del.goto(`${url}`,{waitUntil:'networkidle'});
 const seed2=[{id:'gen-del',name:'庞巴杜发型',image:realJpeg(),created:new Date().toISOString(),source:'ai'},{id:'gen-del2',name:'庞巴杜发型',image:realJpeg(),created:new Date().toISOString(),source:'ai'},
  {id:'demo-del',name:'许士剪',image:'/static/catalog/ai-catalog-44-1.jpg',created:new Date().toISOString(),demo:true,beforeLabel:'示例'}];
 await del.evaluate(list=>{localStorage.setItem('hairplay.generations.v1',JSON.stringify(list.slice(0,2)));
  localStorage.setItem('hairai.study.v1',JSON.stringify({version:1,bannerHidden:true,rememberOptions:true,options:{},records:[list[2]]}));},seed2);
 await del.reload({waitUntil:'networkidle'});
 await del.evaluate(()=>{const o=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(String(k).includes('hairplay.generations.v1'))return;return o.call(this,k,v)};});
 await del.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 await del.locator('uni-button[aria-label="AI 生成记录 庞巴杜发型"]').first().click();
 await del.locator('uni-button').filter({hasText:'删除这张'}).click();
 await del.locator('uni-button').filter({hasText:'确认删除'}).click();
 await del.locator('.error').first().waitFor({timeout:5000});
 assert.match(await del.locator('.error').first().innerText(),/未生效|失败/,'a failed delete must be reported');
 assert.equal(await del.locator('.generated-image').count(),1,'the detail screen must stay open when the delete did not stick');
 await del.locator('uni-button').filter({hasText:'返回相册'}).click();
 assert.equal(await del.locator('uni-button[aria-label^="AI 生成记录"]').count(),2,'the records must stay when the delete write did not stick');
 assert.equal(await del.evaluate(()=>JSON.parse(localStorage.getItem('hairplay.generations.v1')).length),2);
 await del.locator('uni-button').filter({hasText:'选择'}).click();
 await del.locator('uni-button[aria-label^="AI 生成记录"]').first().click();
 await del.locator('uni-button[aria-label^="AI 生成记录"]').nth(1).click();
 await del.locator('uni-button').filter({hasText:'删除所选'}).click();
 await del.locator('uni-button').filter({hasText:'确认删除'}).click();
 await del.locator('.error').first().waitFor({timeout:5000});
 assert.equal(await del.evaluate(()=>JSON.parse(localStorage.getItem('hairplay.generations.v1')).length),2,'a failed batch delete must keep every record');
 assert.equal(await del.locator('uni-button[aria-label^="AI 生成记录"]').count(),2);
 await del.close();

 // Mixed selection: the AI area must not be deleted when its own write failed,
 // and a failed template write after a successful AI delete is partial success.
 for(const mode of ['gen-fails','template-fails']){
  const mix=await context.newPage();mix.on('pageerror',e=>errors.push(e.message));await mix.bringToFront();
  await mix.goto(`${url}`,{waitUntil:'networkidle'});
  await mix.evaluate(list=>{localStorage.setItem('hairplay.generations.v1',JSON.stringify([list[0]]));
   localStorage.setItem('hairai.study.v1',JSON.stringify({version:1,bannerHidden:true,rememberOptions:true,options:{},records:[list[2]]}));},seed2);
  await mix.reload({waitUntil:'networkidle'});
  await mix.evaluate(mode=>{const o=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(String(k)===(mode==='gen-fails'?'hairplay.generations.v1':'hairai.study.v1'))return;return o.call(this,k,v)};},mode);
  await mix.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
  await mix.locator('uni-button').filter({hasText:'选择'}).click();
  await mix.locator('uni-button[aria-label^="AI 生成记录"]').click();
  await mix.locator('uni-button[aria-label^="模板示例"]').click();
  await mix.locator('uni-button').filter({hasText:'删除所选'}).click();
  await mix.locator('uni-button').filter({hasText:'确认删除'}).click();
  await mix.locator('.error').first().waitFor({timeout:5000});
  const message=await mix.locator('.error').first().innerText();
  const gens=await mix.evaluate(()=>JSON.parse(localStorage.getItem('hairplay.generations.v1')).length);
  const templates=await mix.evaluate(()=>JSON.parse(localStorage.getItem('hairai.study.v1')).records.length);
  if(mode==='gen-fails'){
   assert.match(message,/本机相册删除未生效/);assert.match(message,/模板示例记录未被删除/);
   assert.equal(gens,1,'a failed AI write must keep the generated picture');assert.equal(templates,1,'a failed AI write must not delete templates');
  }else{
   assert.match(message,/AI 生成图片已删除，但模板示例记录未删除/);
   assert.equal(gens,0,'a successful AI delete must stay deleted');assert.equal(templates,1,'a failed template write must keep the template');
  }
  await mix.close();
 }

 // Template demo records are capped at 50 on write, not only on read.
 const cap=await context.newPage();cap.on('pageerror',e=>errors.push(e.message));
 await cap.bringToFront();
 await cap.goto(`${url}`,{waitUntil:'networkidle'});
 await cap.evaluate(()=>{const r={id:'demo-seed',name:'目录示例',image:'/static/catalog/ai-catalog-44-1.jpg',created:new Date().toISOString(),demo:true,beforeLabel:'目录示例对比，非用户照片生成'};
  localStorage.setItem('hairai.study.v1',JSON.stringify({version:1,bannerHidden:false,rememberOptions:true,options:{},records:Array.from({length:50},(_,i)=>({...r,id:'demo-seed-'+i}))}));});
 await cap.reload({waitUntil:'networkidle'});
 await cap.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 assert.match(await cap.locator('.gallery-section').nth(1).innerText(),/模板示例/);

 await cap.locator('.tabs uni-button[aria-label="导航 AI匹配"]').click();
 const chooser3=cap.waitForEvent('filechooser');await cap.locator('uni-button').filter({hasText:'选择本地照片'}).click();(await chooser3).setFiles(photoPath);
 await cap.locator('.photo-area').waitFor();
 await cap.locator('uni-button').filter({hasText:'演示模式（非 AI 生成）'}).click();
 await cap.locator('uni-button').filter({hasText:'生成演示'}).click();
 await cap.locator('uni-button').filter({hasText:'确认演示'}).click();
 await cap.locator('uni-button').filter({hasText:'保存演示记录'}).click();
 const capped=await cap.evaluate(()=>JSON.parse(localStorage.getItem('hairai.study.v1')||'{}').records||[]);
 assert.equal(capped.length,50,'template records must stay capped at 50 on write');
 assert.ok(capped[0].id.startsWith('demo-')&&capped[0].id!=='demo-seed-0','the newest template record wins the cap');
 await cap.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 assert.match(await cap.locator('.gallery-section').nth(1).innerText(),/模板示例\s+50/);
 await cap.close();
 assert.deepEqual(errors,[],'no page exceptions: '+errors.join(' | '));
 console.log('GALLERY_BROWSER_OK generate_calls=2 persisted=1 detail_download_delete=OK multi_delete=OK invalid_payloads=0 cross_tab_no_resurrect=OK failed_write_reported=OK template_cap=50 delete_write_failure=OK errors=0');
}finally{await browser?.close();server.close()}
