// Post-deploy check on the live site: choosing a large photo and pressing the
// generate button the instant the file dialog closes must never claim that the
// photo is missing -- while the photo is being decoded the button says
// 照片读取中… and a click that slips through is answered with 照片正在读取.
// The run stops at the confirmation dialog, so no account quota is consumed.
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
	const chooser = p.waitForEvent('filechooser');
	await p.locator('uni-button').filter({hasText: '选择本地照片'}).click();
	await (await chooser).setFiles(photoPath);
	// Press immediately: the 540 KB photo may still be decoding.
	const generate = p.locator('uni-button').filter({hasText: /试试 AI 发型|照片读取中/});
	await generate.click();
	assert.equal(await p.locator('.error').filter({hasText: '请先上传您的照片'}).count(), 0,
		'a photo being read is not a missing photo');
	const reading = await p.locator('uni-button').filter({hasText: '照片读取中'}).count();
	// The reading window may already be over; either way the flow must continue.
	await p.locator('uni-button').filter({hasText: '试试 AI 发型'}).click();
	await p.locator('.modal-title').filter({hasText: '确认发送照片？'}).waitFor();
	console.log(`LIVE_PICKING_RACE_OK reading_state_seen=${reading > 0} errors=${errors.length}`);
} finally {
	await browser.close();
}
if (errors.length) throw new Error(errors.join('; '));
