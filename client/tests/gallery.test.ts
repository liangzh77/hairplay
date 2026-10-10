import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=()=>readFileSync(new URL('../src/pages/index/index.vue',import.meta.url),'utf8');
const platform=()=>readFileSync(new URL('../src/platform/index.ts',import.meta.url),'utf8');

test('gallery separates AI generations from catalog templates',()=>{
 const ui=page();
 assert.match(ui,/class="section-head"><text class="section-title">我的生成<\/text>/);
 assert.match(ui,/class="section-head"><text class="section-title">模板示例<\/text>/);
 assert.match(ui,/class="card-badge ai">AI 生成</);
 assert.match(ui,/class="card-badge template">模板 · 非 AI 生成</);
 // Generated pictures are data URLs: they must never be passed through the
 // public asset URL builder, which only knows catalog paths.
 assert.match(ui,/<image :src="g\.image" mode="aspectFill" \/>/);
 assert.match(ui,/<image :src="generatedDetail\.image" mode="aspectFit" \/>/);
 assert.match(ui,/generations=ref<GeneratedRecord\[\]>\(loadGenerations\(\)\)/);
 assert.doesNotMatch(ui,/assetUrl\(g\.image\)|assetUrl\(generatedDetail\.image\)/);
});

test('successful generation is stored locally and disclosed before upload',()=>{
 const ui=page(),layer=platform();
 assert.match(ui,/commitGenerations\(list=>insertGeneration\(list,record\)\)/);
 assert.match(ui,/prepareGeneratedImage\(image\)/);
 assert.match(ui,/const result=await mutateGenerations\(mutate\);generations\.value=loadGenerations\(\)/);
 // Cross-tab writes are serialized with Web Locks when the runtime has them.
 assert.match(layer,/export async function withStorageLock/);
 assert.match(layer,/await locks\.request\(`hairplay\.storage\.\$\{key\}`/);
 assert.match(layer,/return await withStorageLock\(GEN_KEY,\(\)=>/);
 // A tab that wedges while holding the lock must fail honestly, never write unsynchronized.
 assert.match(layer,/另一个标签页正在写入本机相册，本次操作未生效，请稍后重试/);
 assert.match(layer,/controller\.abort\(\),LOCK_TIMEOUT_MS\)/);
 // Without the API a browser runtime must fail closed, and a mini-program
 // runtime (no window) has a single instance and writes directly.
 assert.match(layer,/typeof window==='undefined'\|\|typeof navigator==='undefined'/);
 assert.match(layer,/throw new Error\(NO_LOCK_MESSAGE\)/);
 assert.match(ui,/生成结果会自动保存到本机相册「我的生成」，可随时删除；上传的原照片不会被保存/);
 assert.match(ui,/已保存到相册「我的生成」，可随时删除/);
 assert.match(layer,/const GEN_KEY='hairplay\.generations\.v1'/);
 assert.match(layer,/export function storeGenerations/);
 assert.match(layer,/list\.every\(isGeneratedRecord\)/);
 assert.match(layer,/1080\/Math\.max\(img\.naturalWidth,img\.naturalHeight\)/);
 // Generated images are local-only: no server upload of results, no Service Worker caching.
 assert.doesNotMatch(layer,/CACHE_OPENED_IMAGES[\s\S]{0,400}generations/);
 assert.match(layer,/a\.download=`HairPlay-AI-\$\{name\|\|'style'\}\.jpg`/);
});

test('AI records can be deleted from the gallery and from the detail screen',()=>{
 const ui=page();
 assert.match(ui,/await commitGenerations\(list=>removeGenerations\(list,ids\)\)/);
 assert.match(ui,/await commitRecords\(ids\)/);
 assert.match(ui,/withStorageLock\('hairai\.study\.v1'/);
 // A failed AI-area write must not delete templates and must say so.
 assert.match(ui,/本机相册删除未生效，模板示例记录未被删除/);
 // A failed template write after a successful AI delete is reported as partial.
 assert.match(ui,/AI 生成图片已删除，但模板示例记录未删除/);
 assert.match(ui,/function deleteGenerated\(\)/);
 assert.match(ui,/modal==='deleteGenerated'/);
 assert.match(ui,/AI 生成图片删除后无法恢复，也不会影响您的账户额度/);
 assert.match(ui,/generatedDetail\.value=null/);
 assert.match(ui,/v-else-if="!galleryDetail&&!generatedDetail" class="tabs"/);
 // A second tab must re-read storage instead of overwriting it with a stale snapshot,
 // and a failed write must resync the UI from storage instead of faking success.
 assert.match(ui,/window\.addEventListener\('storage',syncLocalStores\)/);
 assert.match(ui,/function syncLocalStores\(\)\{generations\.value=loadGenerations\(\);state\.value=loadState\(\)/);
 assert.match(ui,/if\(ids\.every\(id=>!after\.records\.some\(r=>r\.id===id\)\)\)return \{ok:true,message:''\}/);
 assert.match(ui,/if\(!removed\.ok\)\{closeModal\(\);error\.value=`本机相册删除未生效，模板示例记录未被删除/);
 assert.match(ui,/if\(!ok\)\{error\.value=message;return;\}/);
 assert.match(ui,/尚未保存到本机相册，请先点击「下载这张」/);
 assert.match(ui,/@click="downloadLive\(\)">下载这张/);
});

test('a photo that is still being read is never reported as a missing photo',()=>{
 const ui=page(),layer=platform();
 // `picking` covers the decode window only: it starts once a file was chosen,
 // so the file dialog itself does not claim the picture is being read.
 assert.match(layer,/export async function pickPhoto\(onReading\?:\(\)=>void\):Promise<Photo\|null>/);
 assert.match(layer,/const file=input\.files\?\.\[0\];if\(!file\)\{clean\(\);resolve\(null\);return;\}onReading\?\.\(\)/);
 assert.match(layer,/success:async\(res\)=>\{onReading\?\.\(\);try\{/);
 assert.match(ui,/pickPhoto\(\(\)=>\{picking\.value=true;\}\)/);
 assert.match(ui,/finally\{picking\.value=false;\}/);
 // The reading guard must be checked before the missing-photo guard, otherwise
 // a slow decode is still answered with "请先上传您的照片".
 const reading=ui.indexOf("if(picking.value){error.value='照片正在读取，请稍候再试';return;}");
 const missing=ui.indexOf("if(!photo.value){error.value='请先上传您的照片';return;}");
 assert.ok(reading>0&&missing>0&&reading<missing);
 assert.match(ui,/:disabled="loading\|\|picking"/);
 assert.match(ui,/picking\?'照片读取中…'/);
 assert.match(ui,/picking\?'正在读取照片…':'选择本地照片'/);
});
