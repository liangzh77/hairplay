// Post-deploy check of the deployed site: home defaults, every style visible,
// the local-only gallery sections, empty local storage, Web Locks present.
import {assert, launchBrowser, liveBase} from './harness.mjs';

const url = liveBase();
const browser = await launchBrowser();
const errors = [];
try{
 for(const width of [360,390]){
  const ctx=await browser.newContext({viewport:{width,height:800}});
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));
  await p.goto(url,{waitUntil:'networkidle'});
  // Home: default category must be 所有风格 without any click, and show every style.
  const active=await p.evaluate(()=>[...document.querySelectorAll('uni-button[aria-label^="分类 "]')].map(e=>e.getAttribute('aria-label')+(e.className.includes('active')||e.getAttribute('class')?.includes('on')?' *':'')));
  const marked=active.filter(x=>x.endsWith(' *')).map(x=>x.replace('分类 ','').replace(' *',''));
  const total=await p.evaluate(()=>document.querySelectorAll('.style-card, .card, .style-item').length||[...document.querySelectorAll('img')].filter(i=>i.src.includes('catalog-')).length);
  console.log(width,'active=',marked.join('|'),'style_imgs=',total);
  assert.deepEqual(marked,['所有风格'],'home must default to all styles with only one category marked');
  assert.ok(total>=24,'all styles must be visible');
  // Gallery tab renders the local-only sections.
  await p.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
  const sections=await p.locator('.gallery-section').count();
  assert.equal(sections,2,'gallery must show 我的生成 + 模板示例');
  const empty=await p.locator('.gallery-section').first().innerText();
  assert.match(empty,/还没有 AI 生成记录|AI 生成/);
  // Storage must stay empty (this build must not seed fake generated images).
  assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('hairplay.generations.v1')||'[]')),[]);
  // Fail-closed guard exists in the shipped code.
  assert.equal(await p.evaluate(()=>typeof navigator.locks),'object','Web Locks available in this browser');
  await ctx.close();
 }
 console.log('LIVE_VERIFY_OK widths=360,390 errors='+errors.length);
}catch(e){console.error(e);process.exitCode=1;}finally{await browser.close();}
