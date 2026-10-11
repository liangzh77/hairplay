// Gallery end to end against a stubbed account API: upload -> generate ->
// cloud album -> cross-device visibility, detail -> download the 2K original ->
// delete, favourites synced with the account, and the failure paths (a failed
// cloud delete, a failed local cache write, an unsigned-out user, invalid
// payloads, two tabs) that only a real browser can exercise.
//
// Locator note: index.vue renders notices and errors as `<view class="notice">`
// / `<view class="error">`, not as `<uni-text>`. Always wait for the observable
// effect on the element that really renders it.
import {
	assert, launchBrowser, readGenerations, readRepo, repoPath, startStatic, STATE_KEY,
} from './harness.mjs';

const styleJpeg = await readRepo('client/src/static/catalog/ai-catalog-44-1.jpg');
const styleB64 = styleJpeg.toString('base64');
const cloudJpeg = await readRepo('client/src/static/catalog/ai-catalog-44-0.jpg');
const photoPath = repoPath('client/src/static/catalog/ai-catalog-44-0.jpg');
const realJpeg = () => 'data:image/jpeg;base64,' + styleB64;
const HEX = '0123456789abcdef';
const newId = () => Array.from({length: 24}, () => HEX[Math.floor(Math.random() * 16)]).join('');

const json = (res, code, body) => { res.writeHead(code, {'Content-Type': 'application/json'}); res.end(JSON.stringify(body)); };
const readBody = async req => { let raw = ''; for await (const chunk of req) raw += chunk; try { return JSON.parse(raw) || {}; } catch { return {}; } };

// The account state lives on the "server": the browser only ever sees it through
// the API, exactly like production.
const album = [];
let favorites = null; // null = this account has never stored favourites
const signedIn = () => ({email: 'qa@example.invalid', gender: 'male', remaining: 3});
let session = signedIn();
let generateCalls = 0, deleteFailures = false, deleteCalls = 0, importCalls = 0;
const favoriteWrites = [];
const row = (name, style, bytes) => ({id: newId(), name, style, created: new Date().toISOString(), size: bytes.length, bytes});

const server = await startStatic({
	handler: async (req, res, url) => {
		const path = url.pathname;
		if (path === '/hairplay/api/session') { json(res, 200, {account: session}); return true; }
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
			json(res, 200, {images: album.map(({bytes, ...meta}) => meta)});
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
			res.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': String(found.bytes.length), 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff'});
			res.end(found.bytes);
			return true;
		}
		if (path === '/hairplay/api/favorites') {
			if (req.method === 'POST') {
				const body = await readBody(req);
				if (!session) { json(res, 401, {error: '登录状态已失效，请重新登录'}); return true; }
				favorites = Array.isArray(body.ids) ? body.ids : [];
				favoriteWrites.push([...favorites]);
				json(res, 200, {ids: favorites});
				return true;
			}
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
	const generateOnce = async target => {
		await target.locator('.tabs uni-button[aria-label="导航 AI匹配"]').click();
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

	// 1. A signed-in generation is stored in the account and cached locally.
	await page.goto(url, {waitUntil: 'networkidle'});
	const confirmCopy = await generateOnce(page);
	assert.equal(confirmCopy, '您选中的照片将由有型服务端发送至火山方舟 Seedream 进行发型编辑，消耗云端额度（每账户终身 3 张，失败不扣）。生成结果会保存到您的云端账户——在其它设备登录同一邮箱也能看到——并在本机保留一份缓存；上传的原照片不会被保存。不要上传未经他人同意的照片。', 'the upload confirmation must state where the picture goes');
	await generatedNotice(page);
	assert.equal(generateCalls, 1);
	assert.equal(album.length, 1, 'the account must own the generated picture');
	const cached = (await readGenerations(page))[0];
	assert.equal(cached.cloud, album[0].id, 'the local cache must point at the account copy');
	assert.ok(cached.id.startsWith('gen-') && cached.image.startsWith('data:image/jpeg;base64,'));
	assert.ok(!cached.image.includes(styleB64), 'only the downscaled copy is cached');
	assert.equal(cached.name, '庞巴杜发型');
	await page.locator('uni-button').filter({hasText: '查看相册'}).click();
	await cards(page).first().waitFor();
	assert.equal(await cards(page).count(), 1);
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
	assert.equal(favoriteWrites.at(-1)?.length, 1, 'the account must store the favourite');
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
	assert.deepEqual(favoriteWrites.at(-1), [], 'removing a favourite must reach the account');
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
	assert.equal(await anonymous.locator('uni-button[aria-label^="收藏的模板"]').count(), 1, 'local favourites are still that device\'s own');
	assert.ok((await anonymous.evaluate(key => JSON.parse(localStorage.getItem(key)).favorites.length, STATE_KEY)) > 0);
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
	await page.goto(url, {waitUntil: 'networkidle'});
	const localFavorites = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).favorites.map(f => f.styleId), STATE_KEY);
	assert.ok(localFavorites.length > 0);
	assert.deepEqual(favoriteWrites.at(-1), localFavorites, 'the first sign-in must push the local list up');
	assert.deepEqual(favorites, localFavorites);
	summary.push('favorites_adoption=OK');

	// 7. A failed cloud delete must keep both copies and say so.
	album.length = 0;
	await generateOnce(page);
	await generatedNotice(page);
	const before = await readGenerations(page);
	const deletesBefore = deleteCalls;
	deleteFailures = true;
	await page.locator('uni-button').filter({hasText: '查看相册'}).click();
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
	await lost.locator('uni-button').filter({hasText: '查看相册'}).click();
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
	const good = id => ({id, name: '庞巴杜发型', image: realJpeg(), created: new Date().toISOString(), source: 'ai'});
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
	await local.locator('uni-button[aria-label="AI 生成记录 庞巴杜发型"]').first().click();
	await local.locator('.ai-badge').filter({hasText: '仅保存在本机'}).waitFor();
	await local.locator('uni-button').filter({hasText: '同步到云端'}).click();
	await local.locator('.notice').filter({hasText: '已同步到云端账户'}).waitFor();
	assert.equal(importCalls, 1);
	assert.equal(album.length, 1, 'the imported picture must reach the account');
	const imported = (await readGenerations(local)).find(r => r.id === 'gen-local');
	assert.equal(imported?.cloud, album[0].id, 'the local record must remember the account id');
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
	await one.locator('.notice').filter({hasText: '已删除这张图片'}).first().waitFor();
	await two.locator('.notice').filter({hasText: '已删除这张图片'}).first().waitFor();
	assert.equal(album.length, 0, 'both account copies must be gone');
	for (const p of [one, two]) {
		await p.reload({waitUntil: 'networkidle'});
		await p.waitForFunction(() => JSON.parse(localStorage.getItem('hairplay.generations.v1') || '[]').length === 0);
		await openGallery(p);
		assert.equal(await cards(p).count(), 0, 'a reload must not resurrect a picture deleted elsewhere');
	}
	await one.close();
	await two.close();
	summary.push('cross_tab_converges=OK');

	assert.deepEqual(errors, [], 'no page exceptions: ' + errors.join(' | '));
	console.log('GALLERY_BROWSER_OK ' + summary.join(' ') + ' generate_calls=' + generateCalls + ' imports=' + importCalls + ' errors=0');
} finally {
	await browser?.close();
	server.close();
}
