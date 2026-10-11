import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=()=>readFileSync(new URL('../src/pages/index/index.vue',import.meta.url),'utf8');
const platform=()=>readFileSync(new URL('../src/platform/index.ts',import.meta.url),'utf8');

test('gallery separates AI generations from saved templates',()=>{
 const ui=page();
 assert.match(ui,/class="section-head"><text class="section-title">我的生成<\/text>/);
 assert.match(ui,/class="section-head"><text class="section-title">收藏的模板<\/text>/);
 assert.match(ui,/class="card-badge ai">\{\{g\.cloud\?'AI 生成 · 云端':'AI 生成 · 仅本机'\}\}/);
 assert.match(ui,/class="card-badge template">模板 · 非 AI 生成</);
 // No demo mode is left anywhere in the product UI.
 assert.doesNotMatch(ui,/演示|demo|LocalGenerationService|saveResult/);
 // Generated pictures are data URLs: they must never be passed through the
 // public asset URL builder, which only knows catalog paths.
 assert.match(ui,/<image v-if="g\.image" :src="g\.image" mode="aspectFill" \/>/);
 assert.match(ui,/<image :src="generatedDetail\.image" mode="aspectFit" \/>/);
 assert.match(ui,/generations=ref<GeneratedRecord\[\]>\(loadGenerations\(\)\)/);
 assert.doesNotMatch(ui,/assetUrl\(g\.image\)|assetUrl\(generatedDetail\.image\)/);
});

test('the account album is authoritative and its pictures are cached locally',()=>{
 const ui=page(),layer=platform();
 assert.match(ui,/async function syncCloudAlbum\(\)/);
 assert.match(ui,/const images=await cloudAlbum\(\);/);
 // A response for the account the user just left is dropped, not rendered.
 assert.match(ui,/current=responseGuard\(images\);if\(!current\(\)\)return;/);
 assert.match(ui,/if\(!current\(\)\)return;\s*cloudImages\.value=images;/);
 // A cached picture that is gone from the account is purged, so a deletion made
 // on another device can never be resurrected by this browser's cache.
 assert.match(ui,/commitGenerations\(list=>\{rememberGallery\(images\);return list\.filter\(r=>\(!r\.cloud\|\|live\.has\(r\.cloud\)\)&&\(!importedPointers\.value\[r\.id\]\|\|live\.has\(importedPointers\.value\[r\.id\]\)\)\);\},current\)/);
 assert.match(ui,/const cached=new Map\(generations\.value\.filter\(r=>r\.cloud\)/);
 assert.match(ui,/for\(const r of generations\.value\)\{\s*if\(r\.cloud\)continue;/);
 assert.doesNotMatch(ui,/if\(!list\.some\(i=>i\.cloud===linked\)\)list\.push/); // pending local link cannot recreate a deleted cloud row
 assert.match(ui,/async function cacheCloudImages\(images:CloudImage\[\],current:\(\)=>boolean\)/);
 // A cached copy that no longer decodes is downloaded again instead of shown broken.
 assert.match(ui,/const cached=generations\.value\.find\(r=>r\.cloud===img\.id\);\s*if\(cached&&await verifyGeneratedImage\(cached\.image\)\)continue;/);
 assert.match(ui,/const raw=await cloudImageData\(img\.id\);stored=await prepareGeneratedImage\(raw\)/);
 // A cached copy that still decodes is kept; one that no longer decodes is
 // replaced in place, and a missing one is inserted.
 assert.match(ui,/const cached=generations\.value\.find\(r=>r\.cloud===img\.id\);/);
 assert.match(ui,/if\(at<0\)return insertGeneration\(list,\{\.\.\.makeGeneratedRecord\(img\.name,stored,img\.id\),\.\.\.receiptStamp\(images\)\}\);\s*const next=\[\.\.\.list\];next\[at\]=\{\.\.\.list\[at\],name:img\.name,image:stored,\.\.\.receiptStamp\(images\)\};return next;\},current\)/);
 // The freshly downloaded copy wins over the cached bytes in the album too.
 assert.match(ui,/image:memoryImages\.value\[img\.id\]\|\|cached\.get\(img\.id\)\?\.image\|\|generations\.value\.find\(r=>importedPointers\.value\[r\.id\]===img\.id\)\?\.image\|\|''/);
 // A picture the device cannot write to its own storage is still rendered from
 // memory, and saying so is part of the notice.
 assert.match(ui,/memoryImages\.value=\{\.\.\.memoryImages\.value,\[img\.id\]:stored\}/);
 // The original is fetched with no-store so a shared HTTP cache cannot keep it.
 assert.match(layer,/credentials:'same-origin',cache:'no-store'/);
 // A picture that only exists on this device can be pushed to the account.
 assert.match(ui,/const saved=await cloudImport\(item\.image,item\.name\)/);
 assert.match(ui,/async function syncToCloud\(item:AlbumItem\)\{if\(item\.cloud\)return;/);
 assert.match(ui,/importedPointers\.value=\{\.\.\.importedPointers\.value,\[item\.id\]:saved\.id\}/);
 assert.match(ui,/重试本机关联/);
});

test('successful generation is stored in the account and disclosed before upload',()=>{
 const ui=page(),layer=platform();
 assert.match(ui,/commitGenerations\(list=>\{rememberGallery\(result\);return insertGeneration\(list\.filter\(r=>!r\.cloud\|\|live\.has\(r\.cloud\)\),record\);\},current\)/);
 assert.match(ui,/prepareGeneratedImage\(image\)/);
 assert.match(ui,/if\(current\)requireCurrent\(current\);return mutate\(list\)/);
 // Cross-tab writes are serialized with Web Locks when the runtime has them.
 assert.match(layer,/export async function withStorageLock/);
 assert.match(layer,/await locks\.request\(`hairplay\.storage\.\$\{key\}`/);
 assert.match(layer,/return await withStorageLock\(GEN_KEY,\(\)=>/);
 assert.match(layer,/export async function mutateState\(mutate:\(state:State\)=>State\)/);
 assert.match(layer,/return await withStorageLock\(KEY,\(\)=>\{/);
 // Read-back compares the whole list, so a lost field update (a cloud link or a
 // replaced image) is a failure too, not just a lost id.
 assert.match(layer,/if\(JSON\.stringify\(loadGenerations\(\)\)===JSON\.stringify\(next\)\)return \{ok:true,message:''\}/);
 assert.match(layer,/if\(JSON\.stringify\(loadState\(\)\)===JSON\.stringify\(next\)\)return \{ok:true,message:''\}/);
 // A tab that wedges while holding the lock must fail honestly, never write unsynchronized.
 assert.match(layer,/另一个标签页正在写入本机相册，本次操作未生效，请稍后重试/);
 assert.match(layer,/controller\.abort\(\),LOCK_TIMEOUT_MS\)/);
 // Without the API a browser runtime must fail closed, and a mini-program
 // runtime (no window) has a single instance and writes directly.
 assert.match(layer,/typeof window==='undefined'\|\|typeof navigator==='undefined'/);
 assert.match(layer,/throw new Error\(NO_LOCK_MESSAGE\)/);
 // The picture is stored by the server in the same transaction that consumes the
 // quota, so a successful generation is always visible in the account.
 assert.match(ui,/生成结果会保存到您的云端账户——在其它设备登录同一邮箱也能看到——并在本机保留一份缓存/);
 assert.match(ui,/if\(failure\)\{generationSaved\.value=true;error\.value=`生成图片已显示，但/);
 assert.match(ui,/cloudImages\.value=cloudSnapshotImages\(result\)/);
 assert.match(layer,/const GEN_KEY='hairplay\.generations\.v1'/);
 assert.match(layer,/const KEY='hairai\.study\.v1'/);
 assert.match(layer,/export function storeGenerations/);
 assert.match(layer,/list\.every\(isGeneratedRecord\)/);
 assert.match(layer,/1080\/Math\.max\(img\.naturalWidth,img\.naturalHeight\)/);
 // The cloud link is the server id; a response without one is not guessed at.
 assert.match(layer,/return attachReceipt\(\{image:result\.image,cloud:typeof result\.record\?\.id==='string'&&\/\^\[0-9a-f\]\{24\}\$\/\.test\(result\.record\.id\)\?result\.record\.id:''\},result\)/);
 // A full account album is refused before the paid call, so a refused generation
 // never spends the account's lifetime quota.
 assert.match(ui,/if\(\(cloudImages\.value\?\.length\|\|0\)>=CLOUD_LIMIT\)\{error\.value=/);
 assert.match(ui,/本次不会消耗额度/);
 assert.match(ui,/云端返回的图片编号缺失，已重新从账户同步相册/);
 // Downloads keep their honest provenance in the file name.
 assert.match(layer,/a\.download=`HairPlay-AI-\$\{name\|\|'style'\}\.jpg`/);
 assert.match(layer,/a\.download=`HairPlay-模板-\$\{name\}\.jpg`/);
});

test('templates are favourited, synced with the account and removable',()=>{
 const ui=page(),layer=platform();
 assert.match(ui,/async function toggleFavorite\(style:Style\)/);
 assert.match(ui,/function isFavorite\(styleId:string\)/);
 assert.match(ui,/class="outline wide" :disabled="loading" @click="toggleFavorite\(detail\)">\{\{isFavorite\(detail\.id\)\?'★ 已收藏这个模板':'☆ 收藏这个模板'\}\}/);
 assert.match(ui,/async function syncFavoritesWithAccount\(\)/);
 assert.match(ui,/snapshot:object=await cloudFavorites\(\)/);
 // A brand-new account adopts the local list; an existing account list wins, and
 // the 409 answer to a stale adoption is adopted instead of overwritten.
 assert.match(ui,/const captured=loadState\(\)\.favorites/);
 assert.match(ui,/const adopted=await cloudSaveFavorites\(captured\.map\(f=>f\.styleId\)\)/);
 assert.match(ui,/const clearIds=conflict\?\[\]:captured\.map/);
 assert.match(ui,/const next=orderFavorites\(wanted,cached\?\.owner===owner\?cached\.items:accountFavorites\.value\)/);
 assert.match(layer,/export async function cloudFavorites\(\)/);
 assert.match(layer,/export async function cloudSaveFavorites\(ids:string\[\]\)/);
 assert.match(layer,/apiRequest\('favorites',jsonPost\(\{ids\}\),\[200,409\]\)/);
 // A signed-in edit is one atomic add/remove on the server's current list, so a
 // stale snapshot cannot resurrect a favourite another device removed.
 assert.match(layer,/export async function cloudEditFavorite\(action:'add'\|'remove',styleId:string\)/);
 assert.match(layer,/apiRequest\('favorites',jsonPost\(\{\[action\]:styleId\}\)\)/);
 // Anonymous favourites still get the locked read-modify-write + read-back loop.
 assert.match(ui,/async function updateFavorites\(style:Style,add:boolean\)/);
 assert.match(ui,/ids=await cloudEditFavorite\(add\?'add':'remove',style\.id\)/);
 assert.match(ui,/const written=await mutateState\(latest=>\{\s*requireCurrent\(current\);\s*const next=add\?insertFavorite\(latest\.favorites,style\)/);
 assert.match(layer,/另一个标签页同时改动了本机设置，本次操作未生效，请重试/);
 assert.match(ui,/const \{ok,message\}=await updateFavorites\(style,!on\)/);
 assert.match(ui,/最多收藏 \$\{FAVORITE_LIMIT\} 个模板，请先取消一个。/);
 // The saved template screen never pretends the catalog example was generated.
 assert.match(ui,/模板示例 · 目录图片，不是 AI 生成/);
 assert.match(ui,/这是风格目录里的示例图，不是您照片的生成效果。/);
 assert.match(ui,/function tryFavorite\(f:SavedStyle\)/);
});

test('AI records can be deleted from the gallery and from the detail screen',()=>{
 const ui=page();
 assert.match(ui,/async function removeAlbumItems\(items:DeleteTarget\[\],identityCurrent:\(\)=>boolean\)/);
 // Failed cloud targets retain their cache; only accepted successes enter cloudIds.
 assert.match(ui,/const result=await cloudDelete\(id\);current=responseGuard\(result\);\s*if\(!current\(\)\)throw new StaleResponse\(\);\s*lastDelete=result;cloudIds.push\(id\)/);
 assert.match(ui,/云端删除未全部完成（已完成/);
 assert.match(ui,/const \{ok,message\}=await removeAlbumItems\(intent.items,intent.current\)/);
 assert.match(ui,/type DeleteTarget=Pick<AlbumItem,'id'\|'name'\|'cloud'>/);
 assert.match(ui,/items:items.map\(\(\{id,name,cloud\}\)=>\(\{id,name,cloud\}\)\)/);
 assert.match(ui,/function clearAccountView\(\)\{deleteIntent.value=null;/);
 assert.match(ui,/function closeModal\(\)\{deleteIntent.value=null;/);
 assert.match(ui,/图片已从账户删除，但本机缓存未能清除/);
 assert.match(ui,/function deleteGenerated\(\)/);
 assert.match(ui,/modal==='deleteGenerated'/);
 assert.match(ui,/删除后无法恢复；不会退回已使用的生成额度/);
 assert.match(ui,/generatedDetail\.value=null/);
 assert.match(ui,/v-else-if="!favoriteDetail&&!generatedDetail" class="tabs"/);
 // A second tab must re-read storage instead of overwriting it with a stale snapshot,
 // and a failed write must resync the UI from storage instead of faking success.
 assert.match(ui,/window\.addEventListener\('storage',syncLocalStores\)/);
 assert.match(ui,/function syncLocalStores\(event\?:StorageEvent\)/);
 assert.match(ui,/if\(!ok\)\{error\.value=message;return;\}/);
 assert.match(ui,/尚未保存，请先点击「下载这张」。/);
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
