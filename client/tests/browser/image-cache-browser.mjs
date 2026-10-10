// Service Worker image cache under /hairplay/: a slow first-navigation image is
// still cached, the hash URL bypasses a stale HTTP-cache entry, repeat views and
// gallery downloads are served from CacheStorage, and the rollback build of the
// worker (same URL) clears the caches and unregisters itself.
import {assert, approvedAssets, launchBrowser, repoPath, startStatic} from './harness.mjs';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const root = repoPath('client/dist/build/h5');
const approved = approvedAssets;
const rev = approved['static/catalog/ai-catalog-55-1.jpg'].slice(0, 16);
const pathTarget = '/hairplay/static/catalog/ai-catalog-55-1.jpg';
const count = new Map();
let resetMode = false, delayWorker = true, delayFirstImage = true;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Counts, artificial latency and the rollback variant of the worker are served
// here; everything else falls through to the built bundle.
const server = await startStatic({
	dir: root,
	handler: async (req, res, url) => {
		const path = url.pathname;
		if (path === '/hairplay/api/session') { res.setHeader('Content-Type', 'application/json'); res.end('{"account":null}'); return true; }
		if (path === '/hairplay/hairplay-images-sw.js') {
			count.set(path, (count.get(path) || 0) + 1);
			if (delayWorker) { delayWorker = false; await sleep(1200); }
			res.setHeader('Content-Type', 'application/javascript');
			res.end(resetMode ? await readFile(repoPath('client/scripts/hairplay-images-sw-reset.js')) : await readFile(resolve(root, 'hairplay-images-sw.js')));
			return true;
		}
		if (path === pathTarget) {
			count.set(path, (count.get(path) || 0) + 1);
			if (url.search && delayFirstImage) { delayFirstImage = false; await sleep(2100); }
			res.setHeader('Content-Type', 'image/jpeg');
			if (!url.search) res.setHeader('Cache-Control', 'public,max-age=86400');
			res.end(url.search ? await readFile(resolve(root, 'static/catalog/ai-catalog-55-1.jpg')) : Buffer.from('OLD_IMAGE_HTTP_CACHE'));
			return true;
		}
		return false;
	},
});
const url = server.url;
const target = `${url}static/catalog/ai-catalog-55-1.jpg?v=${rev}`;
let browser;
try{
 browser=await launchBrowser();const ctx=await browser.newContext();const p=await ctx.newPage();
 await p.goto(`${url}`,{waitUntil:'domcontentloaded'});
 // Prime a different, stale no-query browser HTTP-cache entry; the new hash URL must avoid it.
 assert.equal(await p.evaluate(async url=>(await fetch(url)).text(),target.split('?')[0]),'OLD_IMAGE_HTTP_CACHE');
 // Start loading while the worker is still installing. The image finishes only after ready.
 await p.evaluate(url=>new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=reject;img.src=url;document.body.append(img)}),target);
 await p.evaluate(async()=>{await navigator.serviceWorker.ready;await new Promise(resolve=>{if(navigator.serviceWorker.controller)resolve();else navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true})})});
 let cached=false;for(let i=0;i<65;i++){cached=await p.evaluate(async url=>{const names=(await caches.keys()).filter(name=>name.startsWith('hairplay-public-images-'));if(names.length!==1)return false;return !!(await(await caches.open(names[0])).match(url))},target);if(cached)break;await sleep(180)}assert.ok(cached,'slow first-navigation image was not cached');
 const result=await p.evaluate(async url=>{const names=(await caches.keys()).filter(n=>n.startsWith('hairplay-public-images-'));const cache=await caches.open(names[0]);const response=await cache.match(url);if(!response)return {missing:true,names,entries:(await cache.keys()).map(req=>req.url)};return {sha:await crypto.subtle.digest('SHA-256',await response.arrayBuffer()).then(a=>Array.from(new Uint8Array(a)).map(x=>x.toString(16).padStart(2,'0')).join('')),entries:(await cache.keys()).map(req=>req.url)}},target);
 const bytes=await readFile(resolve(root,'static/catalog/ai-catalog-55-1.jpg'));assert.equal(result.sha,createHash('sha256').update(bytes).digest('hex'));
 assert.ok(result.entries.every(entry=>entry.startsWith(`${url}static/`)&&!entry.includes('/api/')&&!entry.includes('blob:')&&!entry.includes('data:')));
 const before=count.get(pathTarget);const other=await ctx.newPage(),cdp=await ctx.newCDPSession(other);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});let hit=false;
 cdp.on('Network.responseReceived',event=>{if(event.response.url===target&&event.response.fromServiceWorker)hit=true});
 await other.goto(`${url}`,{waitUntil:'networkidle'});
 await other.evaluate(url=>new Promise((resolve,reject)=>{const img=new Image();img.onload=resolve;img.onerror=reject;img.src=url;document.body.append(img)}),target);
 assert.equal(count.get(pathTarget),before,'cached image refetched over network');assert.ok(hit,'Second page image should be served by worker');
 await other.evaluate(()=>localStorage.setItem('hairai.study.v1',JSON.stringify({version:1,bannerHidden:false,rememberOptions:true,options:{},records:[{id:'demo-cache',name:'班图结',image:'/static/catalog/ai-catalog-55-1.jpg',created:'2026-10-10T00:00:00.000Z',demo:true,beforeLabel:'示例'}]})));
 await other.reload({waitUntil:'networkidle'});await other.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
 await other.locator('uni-button[aria-label="模板示例 班图结"]').click();
 const download=other.waitForEvent('download');await other.locator('uni-button').filter({hasText:'下载演示图片'}).click();await download;
 assert.equal(count.get(pathTarget),before,'gallery download of an opened public image should use CacheStorage');
 // A rollback uses the reset worker at the same URL to delete CacheStorage and unregister.
 resetMode=true;await other.close();await p.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration('/hairplay/');await reg.update()});
 let reset=false;for(let i=0;i<65;i++){reset=await p.evaluate(async()=>!(await navigator.serviceWorker.getRegistration('/hairplay/'))&&!(await caches.keys()).some(n=>n.startsWith('hairplay-public-images-')));if(reset)break;await sleep(180)}assert.ok(reset,'rollback reset must clear caches and unregister worker');
 console.log('PASS subpath SW: first-navigation slow image cached, old HTTP-cache bytes bypassed via hash URL, repeat view and gallery download avoid network, rollback reset clears caches and unregisters.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
