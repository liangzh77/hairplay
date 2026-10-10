// Post-deploy check on the live site: clicking the generate button the instant a
// large photo is chosen must never claim the photo is missing.
import {assert, launchBrowser, liveBase, repoPath} from './harness.mjs';

const url = liveBase();
const photoPath = repoPath('client/src/static/catalog/ai-catalog-44-0.jpg');
const browser = await launchBrowser();
const errors = [];
try {
	const ctx = await browser.newContext({viewport: {width: 390, height: 844}});
	const p = await ctx.newPage();
	p.on('pageerror', e => errors.push(String(e)));
	await p.goto(url, {waitUntil: 'networkidle'});
	await p.locator('.tabs uni-button[aria-label="导航 AI匹配"]').click();
	await p.locator('uni-button').filter({hasText: '演示模式（非 AI 生成）'}).click();
	const chooser = p.waitForEvent('filechooser');
	await p.locator('uni-button').filter({hasText: '选择本地照片'}).click();
	await (await chooser).setFiles(photoPath);
	await p.locator('uni-button').filter({hasText: '生成演示'}).click();
	assert.equal(await p.locator('.error').filter({hasText: '请先上传您的照片'}).count(), 0, 'a photo being read is not a missing photo');
	const reading = await p.locator('uni-text').filter({hasText: '正在读取照片'}).count();
	if (!await p.locator('uni-button').filter({hasText: '确认演示'}).count()) {
		await p.locator('.photo-area').waitFor();
		await p.locator('uni-button').filter({hasText: '生成演示'}).click();
	}
	await p.locator('uni-button').filter({hasText: '确认演示'}).waitFor();
	console.log(`LIVE_PICKING_RACE_OK reading_state_seen=${reading > 0} errors=${errors.length}`);
} finally {
	await browser.close();
}
if (errors.length) throw new Error(errors.join('; '));
