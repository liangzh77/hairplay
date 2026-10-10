// One-off dev tool: (re)generate a catalogue sample picture with Volcengine Ark.
//
// These prompts produced the shipped catalogue samples
// `client/src/static/catalog/ai-catalog-55-0.jpg` (long locs) and
// `ai-catalog-55-1.jpg` (Bantu knots); they are recorded here as the provenance
// of those files. This is not part of the build or the release pipeline, and it
// spends real Ark quota, so it only runs when called on purpose:
//
//   node tools/generate-catalog-images.mjs 55-1 /tmp/ai-catalog-55-1.jpg
//
// Requires the owner-only `.secrets/ark.env` (never committed) and a checkout
// with `npm install` done.
import {readFileSync, writeFileSync} from 'node:fs';
import sharp from 'sharp';

const [, , id = '55-1', out = `/tmp/ai-catalog-${id}.jpg`] = process.argv;
const env = Object.fromEntries(readFileSync(new URL('../.secrets/ark.env', import.meta.url), 'utf8').split(/\r?\n/).filter(line => /^[A-Z_]+=.*/.test(line)).map(line => {
	const pos = line.indexOf('=');
	return [line.slice(0, pos), line.slice(pos + 1).trim().replace(/^['"]|['"]$/g, '')];
}));
if (!env.VOLCENGINE_ARK_API_KEY || !env.VOLCENGINE_ARK_MODEL || !env.VOLCENGINE_ARK_BASE_URL) throw Error('Missing local private Ark config');

const tasks = [
	{id: '55-0', width: 1024, height: 1536, prompt: 'Fashion hairstyle catalogue photography, a fictional adult East Asian woman, clear natural East Asian facial appearance, detailed long natural dark locs (dreadlocks), dozens of distinct well-formed slim locks flowing over shoulders and framing face; authentic hairstyle texture and visible hairline, friendly relaxed portrait, neutral gray blouse, subtle bright hair salon interior, realistic photographic skin and hair, frontal three-quarter head and upper torso, vertical portrait composition, even flattering natural light, clean background, no text, no watermark, not a real person or celebrity.'},
	{id: '55-1', width: 1200, height: 1200, prompt: 'Fashion hairstyle catalogue photography, a fictional adult East Asian woman, clear natural East Asian facial appearance, accurate Bantu knots hairstyle: many small separate neatly parted twisted round hair knots uniformly distributed across the scalp, all knots visible, defined parting lines and natural dark hair texture; direct gaze, simple neutral gray top, bright neutral hair salon background, perfectly upright symmetrical front-facing centered head and shoulders square portrait, camera held level, no head tilt, hairstyle top and sides fully visible, photorealistic lighting and skin, no text, no watermark, not a real person or celebrity.'},
];

const task = tasks.find(t => t.id === id);
if (!task) throw Error(`Unknown catalogue task ${id}; known: ${tasks.map(t => t.id).join(', ')}`);
const response = await fetch(env.VOLCENGINE_ARK_BASE_URL.replace(/\/$/, '') + '/images/generations', {
	method: 'POST',
	headers: {authorization: 'Bearer ' + env.VOLCENGINE_ARK_API_KEY, 'content-type': 'application/json'},
	body: JSON.stringify({model: env.VOLCENGINE_ARK_MODEL, prompt: task.prompt, size: '2K', response_format: 'b64_json', watermark: false}),
	signal: AbortSignal.timeout(165000),
});
if (!response.ok) throw Error(`Generation failed ${task.id} HTTP ${response.status}`);
const payload = await response.json();
const raw = payload?.data?.[0]?.b64_json;
if (typeof raw !== 'string' || raw.length < 60000 || raw.length > 16000000) throw Error('Invalid Ark image payload for ' + task.id);
const bytes = Buffer.from(raw, 'base64');
const info = await sharp(bytes, {limitInputPixels: 25_000_000}).metadata();
if (!['jpeg', 'png', 'webp'].includes(info.format) || !info.width || !info.height || info.width < 512 || info.height < 512) throw Error('Invalid Ark image format for ' + task.id);
const jpg = await sharp(bytes, {limitInputPixels: 25_000_000}).rotate().resize({width: task.width, height: task.height, fit: 'inside', withoutEnlargement: true}).jpeg({quality: 85, mozjpeg: true}).toBuffer();
writeFileSync(out, jpg, {mode: 0o600});
console.log('Generated', task.id, 'format=jpeg', jpg.length, 'bytes', `dimensions=${info.width}x${info.height}`, '->', out);
