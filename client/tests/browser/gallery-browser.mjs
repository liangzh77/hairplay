// Gallery end to end against a stubbed account API: upload -> generate ->
// cloud album -> cross-device visibility, detail -> download the 2K original ->
// delete, favourites synced with the account (atomic edits), and the failure
// paths (a failed cloud delete, a failed local cache write, a stale response that
// arrives after signing out, a cache that no longer decodes, a browser without
// Web Locks, concurrent favourite edits, a picture that reaches the account but
// cannot be linked locally, an unsigned-out user, invalid payloads, two tabs)
// that only a real browser can exercise.
//
// Locator note: index.vue renders notices and errors as `<view class="notice">`
// / `<view class="error">`, not as `<uni-text>`. Always wait for the observable
// effect on the element that really renders it.
import {
	assert, launchBrowser, readFavorites, readGenerations, readRepo, repoPath, startStatic, STATE_KEY,
} from './harness.mjs';

const styleJpeg = await readRepo('client/src/static/catalog/ai-catalog-44-1.jpg');
const styleB64 = styleJpeg.toString('base64');
const cloudJpeg = await readRepo('client/src/static/catalog/ai-catalog-44-0.jpg');
const photoPath = repoPath('client/src/static/catalog/ai-catalog-44-0.jpg');
const realJpeg = () => 'data:image/jpeg;base64,' + styleB64;
const HEX = '0123456789abcdef';
const newId = () => Array.from({length: 24}, () => HEX[Math.floor(Math.random() * 16)]).join('');
// A structurally valid JPEG this browser cannot decode: SOI + APP0 + a scan header
// with no scan data + EOI. `isValidGeneratedImage` accepts it (the cheap gate only
// requires the /9j/ opening and a real EOI), Chrome's decoder refuses it — exactly
// the "the cached copy no longer decodes" case the gallery must re-download.
const undecodableJpeg = () => 'data:image/jpeg;base64,' + Buffer.concat([
	Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'),
	Buffer.from('ffda0008010100003f00', 'hex'),
	Buffer.from('ffe00004', 'hex'),
	Buffer.alloc(1200, 0),
	Buffer.from('ffd9', 'hex'),
]).toString('base64');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };

const revisions=new Map();
const snapshot=resource=>{
 const owner=session.email,key=owner+' '+resource,value=resource==='favorites'?JSON.stringify(favorites):JSON.stringify(album.map(i=>i.id));
 const old=revisions.get(key),revision=old?old.revision+(old.value!==value?1:0):0;revisions.set(key,{value,revision});
 return {owner,context:session.context,revision,...(resource==='favorites'?{initialized:favorites!==null}:{images:album.map(({bytes,...meta})=>meta)})};
};
const json = (res, code, body) => {
 if(session&&('ids' in body||'images' in body||'deleted' in body||'record' in body||'id' in body))body={...body,...snapshot('ids' in body?'favorites':'gallery')};
 res.writeHead(code, {'Content-Type': 'application/json'});res.end(JSON.stringify(body));
};
const readBody = async req => { let raw = ''; for await (const chunk of req) raw += chunk; try { return JSON.parse(raw) || {}; } catch { return {}; } };

// The account state lives on the "server": the browser only ever sees it through
// the API, exactly like production.
const album = [];
let favorites = null; // null = this account has never stored favourites
// Direct fixture resets below restore the current mock session, not a login.
// Only the auth/login endpoint renews its public context.
let mockContext=newId()+newId().slice(0,8);
const signedIn = () => ({email: 'qa@example.invalid', context:mockContext,gender: 'male', remaining: 3});
let session = signedIn();
let generateCalls = 0, deleteFailures = false, deleteCalls = 0, importCalls = 0, imageFetches = 0;
// Every favourites write the account receives, in order: `{ids}` is this device
// adopting its local list, `{add}`/`{remove}` is one atomic edit.
const favoriteWrites = [];
// When armed, the next album read is held open until the test releases it, so a
// response can be made to arrive after the user signed out.
let galleryGate = null;
const row = (name, style, bytes) => ({id: newId(), name, style, created: new Date().toISOString(), size: bytes.length, bytes});

const server = await startStatic({
	handler: async (req, res, url) => {
		const path = url.pathname;
		if (path === '/hairplay/api/session') { json(res, 200, {account: session}); return true; }
		if (path === '/hairplay/api/auth/logout') { session = null; json(res, 200, {ok: true}); return true; }
		if (path === '/hairplay/api/auth/code') { json(res, 200, {ok: true}); return true; }
		if (path === '/hairplay/api/auth/login') {
			const body = await readBody(req);
			mockContext=newId()+newId().slice(0,8);
			session = {...signedIn(), email: String(body.email || 'qa@example.invalid')};
			json(res, 200, {ok: true});
			return true;
		}
		if (path === '/hairplay/api/generate') {
			const body = await readBody(req);
			generateCalls++;
			if (!session) { json(res, 401, {error: '登录状态已失效，请重新登录'}); return true; }
			const created = row(body.styleId ? '庞巴杜发型' : 'AI 发型', body.styleId || null, cloudJpeg);
			album.push(created);
			session = {...session, remaining: Math.max(0, session.remaining - 1)};
			json(res, 200, {image: realJpeg(), remaining: session.remaining, record: {id: created.id, created: created.created}});
			return true;
		}
		if (path === '/hairplay/api/gallery' && req.method === 'GET') {
			if (!session) { json(res, 401, {error: '登录状态已失效，请重新登录'}); return true; }
			const captured=snapshot('gallery');
			if (galleryGate) { const gate = galleryGate; galleryGate = null; await gate.promise; }
			res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(captured));
			return true;
		}
		if (path === '/hairplay/api/gallery/delete') {
			const body = await readBody(req);
			deleteCalls++;
			if (!session) { json(res, 401, {error: '登录状态已失效，请重新登录'}); return true; }
			if (deleteFailures) { json(res, 502, {error: '服务暂不可用，请稍后重试'}); return true; }
			const at = album.findIndex(i => i.id === body.id);
			if (at >= 0) album.splice(at, 1);
			json(res, 200, {ok: true, deleted: at >= 0});
			return true;
		}
		if (path === '/hairplay/api/gallery/import') {
			const body = await readBody(req);
			importCalls++;
			if (!session) { json(res, 401, {error: '登录状态已失效，请重新登录'}); return true; }
			const created = row(String(body.name || 'AI 发型'), typeof body.style === 'string' ? body.style : null, Buffer.from(String(body.image).split(',')[1], 'base64'));
			album.push(created);
			json(res, 200, {ok: true, id: created.id, created: created.created});
			return true;
		}
		if (path.startsWith('/hairplay/api/gallery/')) {
			const id = decodeURIComponent(path.slice('/hairplay/api/gallery/'.length));
			const found = album.find(i => i.id === id);
			if (!session || !found) { json(res, 404, {error: '这张图片已不在云端账户中'}); return true; }
			imageFetches++;
			res.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': String(found.bytes.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff','X-HairPlay-Owner':session.email,'X-HairPlay-Context':session.context,'X-HairPlay-Revision':String(snapshot('gallery').revision)});
			res.end(found.bytes);
			return true;
		}
		if (path === '/hairplay/api/favorites') {
			if (req.method === 'POST') {
				const body = await readBody(req);
				if (!session) { json(res, 401, {error: '登录状态已失效，请重新登录'}); return true; }
				// Adopting this device's list is allowed exactly once; a second device that
				// tries to adopt gets the authoritative list back with 409 instead.
				if (Array.isArray(body.ids)) {
					favoriteWrites.push({ids: [...body.ids]});
					if (favorites !== null) { json(res, 409, {ok: false, ids: favorites}); return true; }
					favorites = [...new Set(body.ids)].slice(0, 50);
					json(res, 200, {ok: true, ids: favorites});
					return true;
				}
				const ops = ['add', 'remove'].filter(k => typeof body[k] === 'string');
				if (ops.length !== 1) { json(res, 400, {error: '收藏参数无效'}); return true; }
				const [op] = ops, styleId = body[op];
				favoriteWrites.push({[op]: styleId});
				favorites = favorites || [];
				if (op === 'add') {
					if (!favorites.includes(styleId)) {
						if (favorites.length >= 50) { json(res, 429, {error: '最多收藏 50 个模板，请先取消一个。'}); return true; }
						favorites = [...favorites, styleId];
					}
				} else favorites = favorites.filter(id => id !== styleId);
				json(res, 200, {ok: true, ids: favorites});
				return true;
			}
			if (!session) { json(res, 401, {error: '登录状态已失效，请重新登录'}); return true; }
			json(res, 200, {ids: favorites || [], initialized: favorites !== null});
			return true;
		}
		return false;
	},
});
const url = server.url;
const openGallery = page => page.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
const cards = page => page.locator('uni-button[aria-label^="AI 生成记录"]');
const favoriteCards = page => page.locator('uni-button[aria-label^="收藏的模板"]');
let browser;
const summary = [];
try {
	browser = await launchBrowser();
	const context = await browser.newContext({viewport: {width: 390, height: 844}});
	const errors = [];
	const page = await context.newPage();
	const watch = p => p.on('pageerror', e => errors.push(e.message));
	watch(page);
	const generateOnce = async (target, fromStyle = false) => {
		if (fromStyle) {
			await target.locator('.tabs uni-button[aria-label="导航 发现"]').click();
			await target.locator('.catalog-card[aria-label="查看 庞巴杜发型"]').click();
			await target.locator('.style-photo').waitFor();
		} else await target.locator('.tabs uni-button[aria-label="导航 AI匹配"]').click();
		const chooser = target.waitForEvent('filechooser');
		await target.locator('uni-button').filter({hasText: '选择本地照片'}).click();
		(await chooser).setFiles(photoPath);
		await target.locator('.photo-area').waitFor();
		await target.locator('uni-button').filter({hasText: '试试 AI 发型'}).click();
		await target.locator('.modal-title').filter({hasText: '确认发送照片？'}).waitFor();
		const copy = await target.locator('.modal-copy').innerText();
		await target.locator('uni-button').filter({hasText: '确认上传并生成'}).click();
		return copy;
	};
	const generatedNotice = target => target.locator('.notice').filter({hasText: '生成图片已保存到云端账户'}).waitFor();

	// 1. Generate from a selected style (not just the AI tab): viewing the gallery
	// must exit that higher-priority detail screen and show the saved result.
	await page.goto(url, {waitUntil: 'networkidle'});
	const confirmCopy = await generateOnce(page, true);
	assert.equal(confirmCopy, '您选中的照片将由有型服务端发送至火山方舟 Seedream 进行发型编辑，消耗云端额度（每账户终身 3 张，失败不扣）。生成结果会保存到您的云端账户——在其它设备登录同一邮箱也能看到——并在本机保留一份缓存；上传的原照片不会被保存。不要上传未经他人同意的照片。', 'the upload confirmation must state where the picture goes');
	await generatedNotice(page);
	assert.equal(generateCalls, 1);
	assert.equal(album.length, 1, 'the account must own the generated picture');
	const cached = (await readGenerations(page))[0];
	assert.equal(cached.cloud, album[0].id, 'the local cache must point at the account copy');
	assert.ok(cached.id.startsWith('gen-') && cached.image.startsWith('data:image/jpeg;base64,'));
	assert.ok(!cached.image.includes(styleB64), 'only the downscaled copy is cached');
	assert.equal(cached.name, '庞巴杜发型');
	await page.locator('uni-button').filter({hasText: '查看画廊'}).click();
	await cards(page).first().waitFor();
	assert.equal(await page.locator('.style-photo').count(), 0, 'the selected style must not mask the gallery');
	assert.equal(await page.locator('.modal').count(), 0, 'the result dialog must close');
	assert.equal(await page.locator('.tabs .current').getAttribute('aria-label'), '导航 画廊');
	assert.equal(await cards(page).count(), 1);
	assert.equal(await cards(page).first().getAttribute('aria-label'), `AI 生成记录 ${cached.name}`);
	assert.match(await page.locator('.gallery-section').first().innerText(), /我的生成\s*01/);
	assert.match(await page.locator('.card-badge.ai').first().innerText(), /AI 生成 · 云端/);
	assert.match(await page.locator('.gallery-section').nth(1).innerText(), /收藏的模板\s*00/);
	assert.equal(await page.locator('.empty-mini').count(), 1, 'only the template list is empty');
	assert.match(await page.locator('.empty-mini').innerText(), /还没有收藏的模板/);
	summary.push('cloud_generate=OK');

	// 2. The detail screen downloads the 2K original from the account and its
	//    deletion removes both copies.
	await page.reload({waitUntil: 'networkidle'});
	await openGallery(page);
	await page.locator('.card-badge.ai').first().waitFor();
	assert.equal(await cards(page).count(), 1, 'the account list must survive a reload');
	await cards(page).first().click();
	await page.locator('.ai-badge').filter({hasText: '云端账户'}).waitFor();
	const download = page.waitForEvent('download');
	await page.locator('uni-button').filter({hasText: '下载云端原图'}).click();
	assert.equal((await download).suggestedFilename(), 'HairPlay-AI-庞巴杜发型.jpg');
	await page.locator('.notice').filter({hasText: '已下载云端原图'}).waitFor();
	await page.locator('uni-button').filter({hasText: '删除这张'}).click();
	assert.match(await page.locator('.modal-copy').innerText(), /云端账户和本机缓存/);
	await page.locator('uni-button').filter({hasText: '确认删除'}).click();
	await page.locator('.notice').filter({hasText: '已删除这张图片（云端账户与本机缓存）'}).waitFor();
	assert.equal(album.length, 0, 'the account copy must be deleted too');
	assert.deepEqual(await readGenerations(page), []);
	assert.equal(await cards(page).count(), 0);
	assert.match(await page.locator('.gallery-section').first().innerText(), /还没有 AI 生成记录/);
	summary.push('detail_download_delete=OK');

	// 3. A picture deleted on another device must not come back from the cache.
	await generateOnce(page);
	await generatedNotice(page);
	const otherDevice = album[0].id;
	assert.ok((await readGenerations(page)).some(r => r.cloud === otherDevice));
	album.length = 0; // "another device" deleted it
	await page.goto(url, {waitUntil: 'networkidle'});
	await page.waitForFunction(() => JSON.parse(localStorage.getItem('hairplay.generations.v1') || '[]').length === 0);
	assert.deepEqual(await readGenerations(page), [], 'a cache of a picture the account no longer has must be purged');
	await openGallery(page);
	assert.equal(await cards(page).count(), 0);
	summary.push('cross_device_delete=OK');

	// 4. Favourites are saved to the account, shown in the gallery and removable.
	await page.locator('.tabs uni-button[aria-label="导航 发现"]').click();
	await page.locator('.catalog-card').first().click();
	const favoriteName = await page.locator('.style-name').innerText();
	await page.locator('uni-button').filter({hasText: '☆ 收藏这个模板'}).click();
	await page.locator('.notice').filter({hasText: '已收藏'}).waitFor();
	const favoriteId = await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).accountFavorites.items.at(-1).styleId,STATE_KEY);
	assert.deepEqual(favoriteWrites.at(-1), {add: favoriteId}, 'the account must receive one atomic add');
	assert.deepEqual(favorites, [favoriteId], 'the account list must hold the favourite');
	assert.equal(await page.locator('uni-button').filter({hasText: '★ 已收藏这个模板'}).count(), 1);
	await page.locator('uni-button[aria-label="返回"]').click();
	await openGallery(page);
	assert.match(await page.locator('.gallery-section').nth(1).innerText(), /收藏的模板\s*01/);
	assert.equal(await favoriteCards(page).count(), 1, 'the favourite must appear in the gallery');
	assert.match(await page.locator('.card-badge.template').innerText(), /模板 · 非 AI 生成/);
	await favoriteCards(page).first().click();
	await page.locator('.tag-badge').filter({hasText: '模板示例 · 目录图片，不是 AI 生成'}).waitFor();
	await page.locator('.muted').filter({hasText: '不是您照片的生成效果'}).waitFor();
	const templateDownload = page.waitForEvent('download');
	await page.locator('uni-button').filter({hasText: '下载模板图片'}).click();
	assert.equal((await templateDownload).suggestedFilename(), `HairPlay-模板-${favoriteName}.jpg`);
	await page.locator('uni-button').filter({hasText: '用这个发型试试'}).click();
	await page.locator('.style-name').filter({hasText: favoriteName}).waitFor();
	assert.equal(await page.locator('.tabs').count(), 0, 'choosing a favourite opens the create screen');
	await page.locator('uni-button[aria-label="返回"]').click();
	await page.locator('.tabs').waitFor();
	await openGallery(page);
	await favoriteCards(page).first().click();
	await page.locator('uni-button').filter({hasText: '取消收藏'}).click();
	await page.locator('.notice').filter({hasText: '已取消收藏'}).waitFor();
	assert.deepEqual(favoriteWrites.at(-1), {remove: favoriteId}, 'removing a favourite must be one atomic remove on the account');
	assert.deepEqual(favorites, [], 'the account must no longer hold the favourite');
	await page.locator('uni-button').filter({hasText: '返回相册'}).click();
	assert.equal(await favoriteCards(page).count(), 0);
	summary.push('favorites=OK');

	// 5. Signed out: the account's pictures are hidden (not deleted), favourites
	//    stay local, and generating is refused until the user signs in.
	await generateOnce(page);
	await generatedNotice(page);
	await page.locator('uni-button').filter({hasText: '关闭'}).first().click();
	await page.locator('.tabs uni-button[aria-label="导航 发现"]').click();
	await page.locator('.catalog-card').first().click();
	await page.locator('uni-button').filter({hasText: '☆ 收藏这个模板'}).click();
	await page.locator('.notice').filter({hasText: '已收藏'}).waitFor();
	const cachedIds = (await readGenerations(page)).map(r => r.cloud).filter(Boolean);
	assert.equal(cachedIds.length, 1);
	const anonymous = await context.newPage();
	watch(anonymous);
	session = null;
	await anonymous.goto(url, {waitUntil: 'networkidle'});
	await anonymous.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
	await anonymous.locator('.empty-mini').first().waitFor();
	assert.match(await anonymous.locator('.gallery-section').first().innerText(), /我的生成\s*00/, 'an anonymous browser must not show account pictures');
	assert.equal(await anonymous.locator('uni-button[aria-label^="AI 生成记录"]').count(), 0);
	assert.equal(await anonymous.locator('uni-button').filter({hasText: '登录后保存到云端'}).count(), 1);
	assert.equal(await anonymous.locator('uni-button[aria-label^="收藏的模板"]').count(), 0, 'account favourites must be hidden');
	await anonymous.locator('[aria-label="导航 发现"]').click();
	await anonymous.locator('.catalog-card').first().click();
	await anonymous.locator('uni-button').filter({hasText:'☆ 收藏这个模板'}).click();
	await anonymous.locator('.notice').filter({hasText:'未登录'}).waitFor();
	assert.equal((await readFavorites(anonymous)).length,1);
	await anonymous.locator('[aria-label="返回"]').click();
	await anonymous.locator('.tabs uni-button[aria-label="导航 AI匹配"]').click();
	const chooser = anonymous.waitForEvent('filechooser');
	await anonymous.locator('uni-button').filter({hasText: '选择本地照片'}).click();
	(await chooser).setFiles(photoPath);
	await anonymous.locator('.photo-area').waitFor();
	await anonymous.locator('uni-button').filter({hasText: '试试 AI 发型'}).click();
	await anonymous.locator('.error').filter({hasText: '请先到「个人资料」用邮箱登录'}).waitFor();
	assert.equal(generateCalls, 3, 'an anonymous tap must not reach the generation service');
	assert.ok((await readGenerations(anonymous)).some(r => r.cloud === cachedIds[0]), 'hiding is not deleting');
	await anonymous.close();
	summary.push('signed_out=OK');

	// 6. A brand-new account adopts the favourites this device already has.
	session = signedIn();
	favorites = null;
	const localFavorites = (await readFavorites(page)).map(f=>f.styleId);
	assert.ok(localFavorites.length > 0);
	await page.goto(url, {waitUntil: 'networkidle'});
	assert.deepEqual(favoriteWrites.at(-1)?.ids, localFavorites, 'the first sign-in must push the local list up');
	assert.deepEqual(favorites, localFavorites);
	assert.deepEqual(await readFavorites(page),[], 'successful adoption consumes the local-only items');
	summary.push('favorites_adoption=OK');

	// 7. A failed cloud delete must keep both copies and say so.
	album.length = 0;
	await generateOnce(page);
	await generatedNotice(page);
	const before = await readGenerations(page);
	const deletesBefore = deleteCalls;
	deleteFailures = true;
	await page.locator('uni-button').filter({hasText: '查看画廊'}).click();
	await cards(page).first().click();
	await page.locator('uni-button').filter({hasText: '删除这张'}).click();
	await page.locator('uni-button').filter({hasText: '确认删除'}).click();
	await page.locator('.error').first().waitFor();
	assert.match(await page.locator('.error').first().innerText(), /云端删除未完成/);
	assert.equal(await page.locator('.generated-image').count(), 1, 'the detail screen must stay open');
	assert.notEqual(before.length, 0);
	assert.deepEqual(await readGenerations(page), before, 'a failed account delete must not drop the local copy');
	await page.locator('uni-button').filter({hasText: '返回相册'}).click();
	assert.equal(await cards(page).count(), 1);
	// Retrying after the service recovers must delete for real.
	deleteFailures = false;
	await cards(page).first().click();
	await page.locator('uni-button').filter({hasText: '删除这张'}).click();
	await page.locator('uni-button').filter({hasText: '确认删除'}).click();
	await page.locator('.notice').filter({hasText: '已删除这张图片（云端账户与本机缓存）'}).waitFor();
	assert.equal(deleteCalls - deletesBefore, 2, 'the failed attempt and the retry are the only deletes');
	assert.deepEqual(await readGenerations(page), []);
	assert.equal(album.length, 0);
	summary.push('failed_cloud_delete=OK');

	// 8. A generation whose local cache write fails is reported honestly and is
	//    still in the account.
	album.length = 0;
	const lost = await context.newPage();
	watch(lost);
	await lost.goto(url, {waitUntil: 'networkidle'});
	await generateOnce(lost);
	await generatedNotice(lost);
	await lost.locator('uni-button').filter({hasText: '查看画廊'}).click();
	assert.equal(await cards(lost).count(), 1);
	const dropGenerationWrites = () => lost.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (String(k).includes('hairplay.generations.v1')) return; return original.call(this, k, v); }; });
	await dropGenerationWrites();
	await lost.reload({waitUntil: 'networkidle'});
	// The cache is re-populated on load, but from now on every local write is lost.
	await lost.waitForFunction(() => JSON.parse(localStorage.getItem('hairplay.generations.v1') || '[]').length === 1);
	await dropGenerationWrites();
	await generateOnce(lost);
	await lost.locator('.error').filter({hasText: /未能缓存到本机|未写入|未生效/}).first().waitFor({timeout: 60000});
	assert.equal(await lost.locator('.notice').filter({hasText: '已保存到云端账户'}).count(), 0, 'a lost cache write must not be announced as saved');
	assert.equal(album.length, 2, 'the account still owns both generated pictures');
	assert.ok((await lost.evaluate(() => JSON.parse(localStorage.getItem('hairplay.generations.v1') || '[]').length)) >= 1);
	await lost.close();
	summary.push('lost_cache_write_reported=OK');

	// 9. Local-only records (generated before cloud storage) are shown, can be
	//    pushed to the account, and invalid payloads are never trusted.
	album.length = 0;
	const local = await context.newPage();
	watch(local);
	await local.goto(url, {waitUntil: 'networkidle'});
	// Distinct names bind the clicked record to the asserted ID. The target is
	// deliberately older, so selecting the first descending-time card is wrong.
	const good = id => ({id, name: id === 'gen-local' ? '本机同步目标' : '非法云指针保图', image: realJpeg(),
		created: id === 'gen-local' ? '2026-01-01T00:00:00.000Z' : '2026-01-01T00:00:00.002Z', source: 'ai'});
	await local.evaluate(list => localStorage.setItem('hairplay.generations.v1', JSON.stringify(list)), [
		good('gen-local'),
		{id: 'gen-fake', name: '伪造', image: 'data:image/jpeg;base64,AAAA', created: new Date().toISOString(), source: 'ai'},
		{id: 'gen-bare', name: '空载', image: 'data:image/jpeg;base64,', created: new Date().toISOString(), source: 'ai'},
		{id: 'gen-png', name: 'PNG冒充', image: 'data:image/png;base64,' + 'A'.repeat(2000), created: new Date().toISOString(), source: 'ai'},
		{id: 'gen-huge', name: '超大', image: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(2_200_001), created: new Date().toISOString(), source: 'ai'},
		// A valid-looking prefix is not enough: these bodies have no JPEG EOI marker.
		{id: 'gen-soi', name: '伪 JPEG', image: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(2_000), created: new Date().toISOString(), source: 'ai'},
		{id: 'gen-trunc', name: '截断真图', image: 'data:image/jpeg;base64,' + styleB64.slice(0, -8) + 'AAAAAAAA', created: new Date().toISOString(), source: 'ai'},
		// A bogus cloud pointer is dropped, but the cached picture stays visible.
		{...good('gen-bad-cloud'), cloud: 'nope'},
		// Structural openings that are not a JPEG segment an encoder could write:
		// a stuffed byte, a reserved code, and a zero-length APP0 segment.
		...[[0x00, 0x2a], [0x02, 0x2a], [0xe0, 0x0000]].map(([marker, declared], i) => ({
			id: 'gen-open-' + i, name: '伪段 ' + i, created: new Date().toISOString(), source: 'ai',
			image: 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, marker, (Number(declared) >> 8) & 0xff, Number(declared) & 0xff, ...Array(60).fill(0), 0xff, 0xd9]).toString('base64'),
		})),
	]);
	await local.reload({waitUntil: 'networkidle'});
	await local.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
	assert.equal(await local.locator('uni-button[aria-label^="AI 生成记录"]').count(), 2, 'only the two real JPEGs survive');
	assert.equal(await local.locator('.card-badge.ai').filter({hasText: '仅本机'}).count(), 2);
	const retained = (await readGenerations(local)).find(r => r.id === 'gen-bad-cloud');
	assert.ok(retained, 'an invalid cloud pointer must not discard the valid local image');
	assert.equal(retained.cloud, undefined, 'the invalid cloud pointer must be stripped');
	assert.equal(await cards(local).first().getAttribute('aria-label'), 'AI 生成记录 非法云指针保图');
	assert.equal(await cards(local).nth(1).getAttribute('aria-label'), 'AI 生成记录 本机同步目标', 'the import target must not be the first card');
	await local.locator('uni-button[aria-label="AI 生成记录 本机同步目标"]').click();
	await local.locator('.ai-badge').filter({hasText: '仅保存在本机'}).waitFor();
	await local.locator('uni-button').filter({hasText: '同步到云端'}).click();
	await local.locator('.notice').filter({hasText: '已同步到云端账户'}).waitFor();
	assert.equal(importCalls, 1);
	assert.equal(album.length, 1, 'the imported picture must reach the account');
	const imported = (await readGenerations(local)).find(r => r.id === 'gen-local');
	assert.equal(imported?.cloud, album[0].id, 'the local record must remember the account id');
	const unselected = (await readGenerations(local)).find(r => r.id === 'gen-bad-cloud');
	assert.ok(unselected, 'the unselected local image must remain');
	assert.equal(unselected.cloud, undefined, 'importing the target must not associate the unselected local image');
	await local.locator('.ai-badge').filter({hasText: '云端账户'}).waitFor();
	await local.locator('uni-button').filter({hasText: '返回相册'}).click();
	await local.waitForFunction(() => document.querySelectorAll('.card-badge.ai').length === 2);
	assert.equal(await local.locator('.card-badge.ai').filter({hasText: '云端'}).count(), 1);
	await local.close();
	summary.push('local_only_and_sync=OK');

	// 10. Two tabs deleting different pictures at the same moment must converge:
	//     neither tab may write a stale cache back, and the account list wins.
	album.length = 0;
	const one = await context.newPage(), two = await context.newPage();
	watch(one); watch(two);
	for (const p of [one, two]) {
		await p.goto(url, {waitUntil: 'networkidle'});
		await p.evaluate(() => localStorage.clear());
	}
	for (let i = 0; i < 2; i++) album.push(row(i ? '发际纹身渐变' : '庞巴杜发型', 'catalog-53-1', cloudJpeg));
	for (const p of [one, two]) {
		await p.reload({waitUntil: 'networkidle'});
		await p.waitForFunction(() => JSON.parse(localStorage.getItem('hairplay.generations.v1') || '[]').length === 2);
		await openGallery(p);
		await cards(p).first().waitFor();
		assert.equal(await cards(p).count(), 2);
	}
	await cards(one).first().click();
	await one.locator('uni-button').filter({hasText: '删除这张'}).click();
	await cards(two).nth(1).click();
	await two.locator('uni-button').filter({hasText: '删除这张'}).click();
	await Promise.all([
		one.locator('uni-button').filter({hasText: '确认删除'}).click(),
		two.locator('uni-button').filter({hasText: '确认删除'}).click(),
	]);
	// An acknowledged delete snapshot may already be superseded by the peer's
	// newer commit. v2 silently drops that old snapshot/notice; requiring TWO
	// success notices would require accepting an obsolete response. Preserve the
	// actual two-delete/convergence assertion, BEFORE reload can heal any error.
	for (let n=0;n<100&&album.length;n++)await one.waitForTimeout(30);
	assert.equal(album.length, 0, 'both account copies must be gone');
	for (const p of [one, two]) {
		await p.waitForFunction(() => JSON.parse(localStorage.getItem('hairplay.generations.v1') || '[]').length === 0);
		assert.equal(await p.locator('.error').count(),0,'superseded success is silent, not a failure');
		await p.reload({waitUntil: 'networkidle'});
		await p.waitForFunction(() => JSON.parse(localStorage.getItem('hairplay.generations.v1') || '[]').length === 0);
		await openGallery(p);
		assert.equal(await cards(p).count(), 0, 'a reload must not resurrect a picture deleted elsewhere');
	}
	await one.close();
	await two.close();
	summary.push('cross_tab_converges=OK');

	// 11. A cloud response that arrives after signing out belongs to the account the
	//     user left: it must never repopulate (or cache) that account's pictures for
	//     whoever is signed in now.
	album.length = 0;
	favorites = null;
	session = signedIn();
	album.push(row('庞巴杜发型', 'catalog-53-1', cloudJpeg));
	const late = await context.newPage();
	watch(late);
	await late.goto(url, {waitUntil: 'networkidle'});
	await late.evaluate(() => localStorage.clear());
	const stale = deferred();
	galleryGate = stale;
	await late.reload({waitUntil: 'load'});
	await late.locator('.tabs uni-button[aria-label="导航 个人资料"]').click();
	await late.locator('uni-button').filter({hasText: '退出登录'}).click();
	await late.locator('#auth-email input').waitFor();
	// Whoever signs in next owns an empty album of their own.
	album.length = 0;
	favorites = null;
	await late.locator('#auth-email input').fill('other@example.invalid');
	await late.locator('#auth-code input').fill('123456');
	await late.locator('uni-button').filter({hasText: '注册 / 登录'}).click();
	await late.locator('.description').filter({hasText: '已登录：other@example.invalid'}).first().waitFor();
	await late.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
	await late.locator('.empty-mini').first().waitFor();
	assert.equal(await cards(late).count(), 0, 'the new account must not see the previous account\'s album');
	const fetchesBefore = imageFetches;
	// Release the stale response and give it the window in which a leaked one would
	// show up: nothing about the signed-in view may change.
	stale.resolve();
	await late.waitForTimeout(1200);
	assert.equal(await cards(late).count(), 0, 'a response for the previous account must be dropped');
	assert.deepEqual(await readGenerations(late), [], 'a dropped response must not cache pictures either');
	assert.equal(imageFetches, fetchesBefore, 'a dropped response must not download any picture');
	await late.close();
	summary.push('stale_response_after_signout=OK');

	// 12. A cached copy the browser can no longer decode is re-downloaded from the
	//     account instead of being rendered as a broken picture.
	album.length = 0;
	session = signedIn();
	favorites = null;
	// Isolate the refused writer: active peer synchronizers may legitimately heal
	// this cache, which would defeat this single-page storage-failure premise.
	const staleContext = await browser.newContext({viewport: {width: 390, height: 844}});
	const stalePage = await staleContext.newPage();
	watch(stalePage);
	await stalePage.goto(url, {waitUntil: 'networkidle'});
	await stalePage.evaluate(() => localStorage.clear());
	const target = row('发际纹身渐变', 'catalog-53-1', cloudJpeg);
	album.push(target);
	const undecodable = undecodableJpeg();
	await stalePage.evaluate(([record, key]) => localStorage.setItem(key, JSON.stringify([record])), [
		{id: 'gen-stale', name: '发际纹身渐变', created: target.created, image: undecodable, source: 'ai', cloud: target.id},
		'hairplay.generations.v1',
	]);
	const fetches = imageFetches;
	await stalePage.reload({waitUntil: 'networkidle'});
	await stalePage.waitForFunction(bad => {
		const list = JSON.parse(localStorage.getItem('hairplay.generations.v1') || '[]');
		return list.length === 1 && typeof list[0].image === 'string' && list[0].image !== bad;
	}, undecodable);
	const healed = (await readGenerations(stalePage))[0];
	assert.ok(healed.image.startsWith('data:image/jpeg;base64,/9j/'), 'the replacement must be a real JPEG');
	assert.ok(imageFetches > fetches, 'the browser must re-download the account original');
	await openGallery(stalePage);
	await stalePage.locator('.card-badge.ai').first().waitFor();
	assert.equal(await stalePage.locator('.card-badge.ai').innerText(), 'AI 生成 · 云端');
	// A refused local write must not leave the unreadable bytes rendering: the copy
	// downloaded into memory wins over the cache the browser cannot decode.
	await stalePage.evaluate(([record, key]) => localStorage.setItem(key, JSON.stringify([record])), [
		{id: 'gen-stale', name: '发际纹身渐变', created: target.created, image: undecodable, source: 'ai', cloud: target.id},
		'hairplay.generations.v1',
	]);
	await stalePage.addInitScript(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (String(key).includes('hairplay.generations.v1')) return; return original.call(this, key, value); }; });
	await stalePage.reload({waitUntil: 'networkidle'});
	await openGallery(stalePage);
	await stalePage.locator('.notice').filter({hasText: '本机缓存未能写入'}).first().waitFor();
	await stalePage.locator('.gallery-card img').first().waitFor();
	const shown = await stalePage.locator('.gallery-card img').first().getAttribute('src');
	assert.ok(shown?.startsWith('data:image/jpeg;base64,/9j/') && shown !== undecodable, 'the unreadable cached copy must not be rendered');
	assert.deepEqual((await readGenerations(stalePage)).map(r => r.image), [undecodable], 'the refused write must leave the cache untouched');
	await staleContext.close();
	summary.push('stale_cache_refetched=OK');

	// 13. A browser without Web Locks refuses every local write, but must still show
	//     the account's pictures from memory and say the cache is not on this disk.
	album.length = 0;
	session = signedIn();
	favorites = null;
	album.push(row('庞巴杜发型', 'catalog-53-1', cloudJpeg));
	const noLocksContext = await browser.newContext({viewport: {width: 390, height: 844}});
	await noLocksContext.addInitScript(() => { try { delete Navigator.prototype.locks; } catch { /* already absent */ } });
	const noLocks = await noLocksContext.newPage();
	watch(noLocks);
	await noLocks.goto(url, {waitUntil: 'networkidle'});
	await openGallery(noLocks);
	await noLocks.locator('.card-badge.ai').first().waitFor();
	assert.equal(await noLocks.locator('uni-button[aria-label^="AI 生成记录"]').count(), 1, 'the account picture must still render');
	assert.match(await noLocks.locator('.gallery-card img').first().getAttribute('src'), /^data:image\/jpeg/, 'the picture must render from memory');
	await noLocks.locator('.notice').filter({hasText: '本机缓存未能写入'}).first().waitFor();
	assert.deepEqual(await readGenerations(noLocks), [], 'a refused local write must never be faked');
	await noLocksContext.close();
	summary.push('no_web_locks_memory_render=OK');

	// 14. Two tabs editing the favourite list at the same moment must not undo each
	//     other: every edit is one atomic add/remove on the account's current list.
	album.length = 0;
	session = signedIn();
	favorites = [];
	const tabA = await context.newPage(), tabB = await context.newPage();
	watch(tabA);
	watch(tabB);
	for (const p of [tabA, tabB]) {
		await p.goto(url, {waitUntil: 'networkidle'});
		await p.evaluate(() => localStorage.clear());
		await p.reload({waitUntil: 'networkidle'});
		await p.locator('.tabs uni-button[aria-label="导航 发现"]').click();
	}
	await tabA.locator('.catalog-card').first().click();
	await tabB.locator('.catalog-card').nth(1).click();
	const adds = favoriteWrites.length;
	await Promise.all([
		tabA.locator('uni-button').filter({hasText: '☆ 收藏这个模板'}).click(),
		tabB.locator('uni-button').filter({hasText: '☆ 收藏这个模板'}).click(),
	]);
	const added = favoriteWrites.slice(adds).map(write => write.add).filter(Boolean);
	assert.equal(added.length, 2, 'each tab must send one atomic add');
	assert.equal(new Set(added).size, 2, 'the two tabs must favourite two different templates');
	assert.deepEqual([...favorites].sort(), [...added].sort(), 'both adds must survive on the account');
	for (const p of [tabA, tabB]) {
		await p.reload({waitUntil: 'networkidle'});
		await openGallery(p);
		await p.locator('.card-badge.template').first().waitFor();
		assert.match(await p.locator('.gallery-section').nth(1).innerText(), /收藏的模板\s+02/, 'both tabs must see both favourites');
	}
	await tabA.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
	await tabB.locator('.tabs uni-button[aria-label="导航 画廊"]').click();
	await favoriteCards(tabA).first().click();
	await favoriteCards(tabB).nth(1).click();
	const removes = favoriteWrites.length;
	await Promise.all([
		tabA.locator('uni-button').filter({hasText: '取消收藏'}).click(),
		tabB.locator('uni-button').filter({hasText: '取消收藏'}).click(),
	]);
	const removed = favoriteWrites.slice(removes).map(write => write.remove).filter(Boolean);
	assert.equal(removed.length, 2, 'each tab must send one atomic remove');
	assert.equal(new Set(removed).size, 2, 'the two tabs must remove two different templates');
	assert.deepEqual(favorites, [], 'neither removal may be resurrected by the other tab');
	for (const p of [tabA, tabB]) {
		await p.reload({waitUntil: 'networkidle'});
		await openGallery(p);
		await p.locator('.gallery-section').nth(1).waitFor();
		assert.match(await p.locator('.gallery-section').nth(1).innerText(), /收藏的模板\s+00/);
	}
	await tabA.close();
	await tabB.close();
	summary.push('concurrent_favorites=OK');

	// 15. A local-only picture that reaches the account but cannot be linked in local
	//     storage is reported honestly, and the gallery shows one row for it, not two.
	album.length = 0;
	session = signedIn();
	favorites = null;
	const unlinked = await context.newPage();
	watch(unlinked);
	await unlinked.goto(url, {waitUntil: 'networkidle'});
	await unlinked.evaluate(() => localStorage.clear());
	await unlinked.evaluate(([record, key]) => localStorage.setItem(key, JSON.stringify([record])), [
		{id: 'gen-unlinked', name: '庞巴杜发型', created: new Date().toISOString(), image: realJpeg(), source: 'ai'},
		'hairplay.generations.v1',
	]);
	await unlinked.reload({waitUntil: 'networkidle'});
	await unlinked.waitForFunction(() => JSON.parse(localStorage.getItem('hairplay.generations.v1') || '[]').length === 1);
	await unlinked.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (String(key).includes('hairplay.generations.v1')) return; return original.call(this, key, value); }; });
	const imports = importCalls;
	await openGallery(unlinked);
	await unlinked.locator('uni-button[aria-label^="AI 生成记录"]').first().click();
	await unlinked.locator('uni-button').filter({hasText: '同步到云端'}).click();
	await unlinked.locator('.error').filter({hasText: '未能记住它'}).waitFor();
	assert.equal(importCalls - imports, 1, 'the picture must reach the account exactly once');
	assert.equal(album.length, 1);
	await unlinked.locator('.ai-badge').filter({hasText: '云端账户'}).waitFor();
	await unlinked.locator('uni-button').filter({hasText: '返回相册'}).click();
	assert.equal(await cards(unlinked).count(), 1, 'the account copy and the local record must be one row while linked in memory');
	await unlinked.close();
	summary.push('unlinked_sync_reported=OK');

	assert.deepEqual(errors, [], 'no page exceptions: ' + errors.join(' | '));
	console.log('GALLERY_BROWSER_OK ' + summary.join(' ') + ' generate_calls=' + generateCalls + ' imports=' + importCalls + ' errors=0');
} finally {
	await browser?.close();
	server.close();
}
