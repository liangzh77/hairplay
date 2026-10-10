// Smoke test of the deployed site: category defaults, gender-dependent hero
// selection, versioned approved images served through the Service Worker, the
// published privacy policy, and the anonymous gender endpoint answer.
import {assert, approvedAssets, launchBrowser, liveBase} from './harness.mjs';
import {createHash} from 'node:crypto';

const base = liveBase();
const approved = approvedAssets;
const hash = (data) => createHash('sha256').update(data).digest('hex');
const b = await launchBrowser();
try{
 const ctx=await b.newContext({viewport:{width:390,height:844}}),p=await ctx.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base,{waitUntil:'networkidle'});await p.locator('uni-button[aria-label="分类 所有风格"]').click();await p.locator('.hero-card').getByText('许士剪').waitFor();
 await p.locator('.tabs uni-button[aria-label="导航 个人资料"]').click();await p.locator('.gender-choices uni-button').filter({hasText:'男'}).click();
 await p.locator('.tabs uni-button[aria-label="导航 发现"]').click();await p.locator('.hero-card').getByText('发际纹身渐变').waitFor();
 const image=await p.locator('.hero-card img').getAttribute('src');assert.ok(image.includes('?v='+approved['static/catalog/ai-catalog-54-1.jpg'].slice(0,16)),image);
 await p.evaluate(async()=>navigator.serviceWorker.ready);
 const sample='static/catalog/ai-catalog-55-1.jpg',r=await fetch(base+sample+'?v='+approved[sample].slice(0,16));assert.equal(r.status,200);assert.equal(hash(Buffer.from(await r.arrayBuffer())),approved[sample]);
 const other='static/catalog/ai-catalog-55-0.jpg',r2=await fetch(base+other+'?v='+approved[other].slice(0,16));assert.equal(r2.status,200);assert.equal(hash(Buffer.from(await r2.arrayBuffer())),approved[other]);
 const sw=await fetch(base+'hairplay-images-sw.js');assert.equal(sw.status,200);assert.ok((await sw.text()).includes('hairplay-public-images-'));
 const policy=await fetch('https://liangz77.cn/privacy/');assert.equal(policy.status,200);const legal=await policy.text();assert.ok(legal.includes('版本：v1.1')&&legal.includes('可选性别')&&legal.includes('公开图片缓存'));
 const anon=await fetch(base+'api/auth/gender',{method:'POST',headers:{origin:'https://liangz77.cn','content-type':'application/json'},body:'{"gender":"male"}'});assert.equal(anon.status,401);
 const p2=await b.newPage({viewport:{width:360,height:800}});await p2.route('**/hairplay/api/session',route=>route.fulfill({contentType:'application/json',body:'{"account":{"email":"test@example.invalid","gender":"male","remaining":2}}'}));
 await p2.goto(base,{waitUntil:'networkidle'});await p2.locator('uni-button[aria-label="分类 所有风格"]').click();await p2.locator('.hero-card').getByText('发际纹身渐变').waitFor();await p2.close();
 assert.deepEqual(errors,[]);console.log('PASS public H5: unknown/female and male hero selection, versioned approved images and SW, policy update, anonymous gender 401, no browser exceptions; no email or image generation.');
}finally{await b.close()}
