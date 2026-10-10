<script setup lang="ts">
import {computed,nextTick,onMounted,onUnmounted,ref,watch} from 'vue';
import {assetUrl} from '../../core/assets';
import {loginRequest} from '../../core/login';
import {onBackPress} from '@dcloudio/uni-app';
import {catalog,categories,filterStyles,heroStyleFor,LocalGenerationService,makeRecord,makeGeneratedRecord,insertGeneration,removeGenerations,RECORD_LIMIT,type Style,type DemoRecord,type GeneratedRecord} from '../../core/model';
import {loadState,storeState,pickPhoto,generateLiveImage,releasePhoto,lockModal,setupEscape,setupBack,pushLocalHistory,backLocalHistory,downloadDemo,capsuleInset,setupModalKeyboard,setupImageCache,loadGenerations,mutateGenerations,withStorageLock,prepareGeneratedImage,downloadGenerated,verifyGeneratedImage,accountApi,type Account,type Gender,type Photo} from '../../platform';
const state=ref(loadState());const generations=ref<GeneratedRecord[]>(loadGenerations());const tab=ref('发现');const category=ref('所有风格');const query=ref('');const detail=ref<Style|null>(null);const galleryDetail=ref<DemoRecord|null>(null);const generatedDetail=ref<GeneratedRecord|null>(null);const generationSaved=ref(true);const liveName=ref('');const photo=ref<Photo|null>(null);const picking=ref(false);const error=ref('');const notice=ref('');const loading=ref(false);const advanced=ref(false);const requirements=ref('');const color=ref('保持原色');const demo=ref(false);const result=ref<Style|null>(null);const modal=ref('');const info=ref('');const selectMode=ref(false);const selected=ref<string[]>([]);const compare=ref(false);const scrollTop=ref(0);let rememberedScroll=0;let currentScroll=0;
const account=ref<Account|null>(null);const signupGender=ref<Gender>(null);const email=ref('');const code=ref('');const authBusy=ref(false);const authMessage=ref('');const cooldown=ref(0);let cooldownTimer:ReturnType<typeof setInterval>|undefined;let stopImageCache=()=>{};
// uni-input can emit a delayed model update. Capture the native keystroke value
// before its internal debounce so a quick tap uses what the user actually typed.
const lastTyped:{email:string|null;code:string|null}={email:null,code:null};
function captureAuthInput(event:Event){const input=event.target;if(!(input instanceof HTMLInputElement))return;const id=input.closest('uni-input')?.id;if(id==='auth-email')lastTyped.email=input.value;if(id==='auth-code')lastTyped.code=input.value;}
async function refreshAccount():Promise<boolean>{try{account.value=(await accountApi('session')).account||null;return true;}catch(e){account.value=null;authMessage.value=e instanceof Error?e.message:'登录服务未接入';return false;}}
onMounted(()=>{if(typeof document!=='undefined')document.addEventListener('input',captureAuthInput,true);stopImageCache=setupImageCache();void refreshAccount();
 // Another tab may add or delete local records; re-read instead of trusting a stale snapshot.
 if(typeof window!=='undefined')window.addEventListener('storage',syncLocalStores);});
onUnmounted(()=>{clearInterval(cooldownTimer);stopImageCache();if(typeof document!=='undefined')document.removeEventListener('input',captureAuthInput,true);if(typeof window!=='undefined')window.removeEventListener('storage',syncLocalStores);});
function syncLocalStores(){generations.value=loadGenerations();state.value=loadState();if(generatedDetail.value&&!generations.value.some(r=>r.id===generatedDetail.value?.id))generatedDetail.value=null;}
watch([tab,account],()=>{void nextTick().then(()=>{if(typeof document==='undefined')return;
 document.querySelector('#auth-email input')?.setAttribute('autocomplete','email');
 document.querySelector('#auth-code input')?.setAttribute('autocomplete','one-time-code');
});},{flush:'post'});
function visibleAuthValue(id:string,fallback:string){
 // uni-input may flush v-model after a fast click; submit the value actually visible to the user.
 if(typeof document==='undefined')return fallback;
 return (document.querySelector(`#${id} input`) as HTMLInputElement|null)?.value??fallback;
}
async function authAction(action:'code'|'login'|'logout'){if(authBusy.value||(action==='code'&&cooldown.value>0))return;
 const shownEmail=lastTyped.email??visibleAuthValue('auth-email',email.value),shownCode=lastTyped.code??visibleAuthValue('auth-code',code.value);
 let body:Record<string,string>;try{body=loginRequest(action,shownEmail,shownCode);}catch(e){authMessage.value=e instanceof Error?e.message:'请检查输入';return;}
 email.value=shownEmail;code.value=shownCode;
 if(action==='login'&&signupGender.value)body.gender=signupGender.value;
 authBusy.value=true;try{
 await accountApi('auth/'+action,body);
 if(action==='code'){authMessage.value='验证码发送请求已受理，请查看收件箱和垃圾箱；10分钟内有效。';cooldown.value=60;clearInterval(cooldownTimer);cooldownTimer=setInterval(()=>{cooldown.value--;if(cooldown.value<=0)clearInterval(cooldownTimer);},1000);}
 else{code.value='';lastTyped.code=null;if(!await refreshAccount())return;
  if(action==='login'&&!account.value)throw new Error('未建立登录状态，请重试');
  signupGender.value=null;
  authMessage.value=action==='logout'?'已退出登录':'登录成功';}
 }catch(e){authMessage.value=e instanceof Error?e.message:'登录失败';}finally{authBusy.value=false;}}
async function chooseGender(gender:Gender){
 if(authBusy.value)return;
 if(!account.value){signupGender.value=gender;return;}
 authBusy.value=true;try{await accountApi('auth/gender',{gender});if(await refreshAccount())authMessage.value='示例偏好已更新';}
 catch(e){authMessage.value=e instanceof Error?e.message:'更新失败';}finally{authBusy.value=false;}
}
const options=ref<Record<string,string>>({...state.value.options});
const groups=[{name:'风格类型',items:['职业','时尚','经典','前卫','休闲']},{name:'护理程度',items:['低','中','高']},{name:'偏好长度',items:['短发','中发','长发']},{name:'发色偏好',items:['推荐新色','保持原色']}];
const styles=computed(()=>filterStyles(category.value,query.value));const left=computed(()=>styles.value.filter((_,i)=>i%2===0));const right=computed(()=>styles.value.filter((_,i)=>i%2===1));const inDetail=computed(()=>!!detail.value||!!galleryDetail.value||!!generatedDetail.value);const inset=capsuleInset();
function persist(){const message=storeState(state.value);if(message)error.value=message;return !message;}
// Every mutation re-reads storage first, so a second tab can never resurrect a
// record (or a private generated picture) another tab just deleted.
// Every mutation re-reads storage first, so a second tab can never resurrect a
// record (or a private generated picture) another tab just deleted; and every
// write is read back, so a lost write is never reported as success.
async function commitGenerations(mutate:(list:GeneratedRecord[])=>GeneratedRecord[]):Promise<{ok:boolean;message:string}>{
 const result=await mutateGenerations(mutate);generations.value=loadGenerations();
 return result.ok?{ok:true,message:''}:{ok:false,message:result.message||'本机相册写入未生效，请检查本机存储空间后重试。'};}
async function commitRecords(ids:string[]):Promise<{ok:boolean;message:string}>{
 // Same lock + read-modify-write + read-back rule as the generated list, so a
 // template deletion here is not resurrected by a stale snapshot from another tab.
 try{return await withStorageLock('hairai.study.v1',()=>{
  for(let attempt=0;attempt<5;attempt++){
   const latest=loadState(),next=latest.records.filter(r=>!ids.includes(r.id));
   if(next.length===latest.records.length)return {ok:true,message:''};
   state.value={...latest,records:next};
   const writeError=persist()?'':(error.value||'模板示例写入失败');
   const after=loadState();state.value=after;error.value=writeError;
   if(ids.every(id=>!after.records.some(r=>r.id===id)))return {ok:true,message:''};
   if(writeError)return {ok:false,message:writeError};
  }
  return {ok:false,message:'另一个标签页同时改动了本机相册，本次模板删除未生效，请重试。'};});}
 catch(e){return {ok:false,message:e instanceof Error&&e.message?e.message:'模板示例记录未删除，请稍后重试。'};}}
function showInfo(message:string){info.value=message;modal.value='info';}
function closeModal(){if(modal.value==='liveResult')liveImage.value='';modal.value='';}
watch(modal,v=>lockModal(!!v));
watch(options,v=>{if(state.value.rememberOptions){state.value.options={...v};persist();}},{deep:true});
function switchTab(name:string){tab.value=name;error.value='';notice.value='';result.value=null;liveImage.value='';scrollTop.value=0;currentScroll=0;}
function setCategory(name:string){category.value=name;}
function openStyle(s:Style){rememberedScroll=currentScroll;detail.value=s;scrollTop.value=0;error.value='';result.value=null;pushLocalHistory();}
function openRecord(r:DemoRecord){if(selectMode.value){toggleSelected(r.id);return;}rememberedScroll=currentScroll;galleryDetail.value=r;compare.value=false;scrollTop.value=0;pushLocalHistory();}
function openGenerated(g:GeneratedRecord){if(selectMode.value){toggleSelected(g.id);return;}rememberedScroll=currentScroll;generatedDetail.value=g;scrollTop.value=0;pushLocalHistory();}
function toggleSelected(id:string){selected.value=selected.value.includes(id)?selected.value.filter(x=>x!==id):[...selected.value,id];}
function goBack(fromHistory=false){if(modal.value){closeModal();return;}if(inDetail.value){detail.value=null;galleryDetail.value=null;generatedDetail.value=null;result.value=null;error.value='';scrollTop.value=rememberedScroll;if(!fromHistory)backLocalHistory();}}
const stopModalKeyboard=setupModalKeyboard();const stopBack=setupBack(()=>goBack(true));const stopEscape=setupEscape(()=>modal.value?closeModal():inDetail.value?goBack():undefined);
onBackPress(()=>{if(modal.value||inDetail.value){goBack();return true;}return false;});
onUnmounted(()=>{stopBack();stopEscape();stopModalKeyboard();releasePhoto(photo.value);lockModal(false);});
async function choose(){error.value='';try{const picked=await pickPhoto(()=>{picking.value=true;});if(picked){releasePhoto(photo.value);photo.value=picked;result.value=null;liveImage.value='';}}catch(e){error.value=e instanceof Error?e.message:'照片无法读取，请重试';}finally{picking.value=false;}}
function removePhoto(){releasePhoto(photo.value);photo.value=null;result.value=null;liveImage.value='';}
function start(){error.value='';if(!demo.value&&!account.value){error.value='请先到个人资料使用邮箱登录';return;}if(!demo.value&&account.value?.remaining===0){error.value='账户终身 3 张成功生成额度已用完';return;}// A photo still being read is not a missing photo: pickPhoto() only sets it once the picture has been decoded and measured.
 if(picking.value){error.value='照片正在读取，请稍候再试';return;}if(!photo.value){error.value='请先上传您的照片';return;}modal.value=demo.value?'demo':'confirmUpload';}
async function generate(){closeModal();loading.value=true;result.value=null;liveImage.value='';error.value='';try{
 if(!photo.value)throw new Error('请先上传您的照片');
 if(demo.value){const res=await new LocalGenerationService().generate({photo:photo.value.url,styleId:detail.value?.id,options:{...options.value,...(detail.value?{'发色偏好':color.value}:{})},requirements:requirements.value,demo:true});result.value=res.style;modal.value='result';}
 else{const image=await generateLiveImage(photo.value,detail.value?.id||'catalog-53-1',requirements.value);
  const name=detail.value?.name||catalog.find(s=>s.id==='catalog-53-1')?.name||'AI 发型';liveName.value=name;
  let stored='',failure='';
  try{stored=await prepareGeneratedImage(image);if(!await verifyGeneratedImage(stored))failure='生成结果无法再次读取';}catch{failure='本机压缩失败';}
  liveImage.value=stored||image;
  if(failure){generationSaved.value=false;error.value=`生成图片已显示，但${failure}，未能存入相册；请点击「下载这张」自行保存，关闭后可能无法找回。`;}
  else{
   const record=makeGeneratedRecord(name,stored);
   const {ok,message}=await commitGenerations(list=>insertGeneration(list,record));
   generationSaved.value=ok;
   if(ok)notice.value='生成图片已保存到相册「我的生成」';
   else error.value=message||'本机相册保存失败：图片过大或本机存储空间不足。请点击「下载这张」自行保存，关闭后可能无法找回。';
  }
  modal.value='liveResult';}
 }catch(e){error.value=e instanceof Error?e.message:'处理失败，请重试';}finally{loading.value=false;if(!demo.value)await refreshAccount();}}
function saveResult(){if(!result.value)return;const r=makeRecord({demo:true,style:result.value});
 const latest=loadState();state.value={...latest,records:[r,...latest.records].slice(0,RECORD_LIMIT)};
 if(!persist()){state.value=loadState();return;}const after=loadState();state.value=after;
 if(!after.records.some(x=>x.id===r.id)){error.value='本机存储写入未生效，演示记录未保存';return;}
 closeModal();notice.value='演示记录已保存；私人照片未持久化';}
async function downloadRecord(){if(!galleryDetail.value)return;
 try{notice.value=await downloadDemo(galleryDetail.value.image,galleryDetail.value.name);}catch{notice.value='目录图片下载失败，请重试';}
}
async function deleteSelected(){const ids=selected.value;if(!ids.length)return;
 // AI 生成图片是不可恢复的一半：它没写成功就直接停手，绝不顺手删掉模板示例，
 // 也不谎称全部成功；模板示例失败时明确说明生成图片已经删掉了。
 const removed=await commitGenerations(list=>removeGenerations(list,ids));
 if(!removed.ok){closeModal();error.value=`本机相册删除未生效，模板示例记录未被删除：${removed.message}`;return;}
 const records=await commitRecords(ids);
 closeModal();
 if(!records.ok){
  const left=state.value.records.filter(r=>ids.includes(r.id)).map(r=>r.id);
  selected.value=left;selectMode.value=left.length>0;
  error.value=`AI 生成图片已删除，但模板示例记录未删除：${records.message}`;return;}
 error.value='';selected.value=[];selectMode.value=false;notice.value='已删除所选记录';}
async function deleteGenerated(){if(!generatedDetail.value)return;
 const {ok,message}=await commitGenerations(list=>removeGenerations(list,[generatedDetail.value!.id]));
 closeModal();
 if(!ok){error.value=message;return;}
 error.value='';generatedDetail.value=null;notice.value='已从本机删除这张生成图片';}
async function downloadGeneratedRecord(){if(!generatedDetail.value)return;
 try{await downloadGenerated(generatedDetail.value.image,generatedDetail.value.name);notice.value='已下载到本机（文件名以 HairPlay-AI 开头）';}catch{notice.value='下载失败，请重试';}
}
async function downloadLive(){if(!liveImage.value)return;
 try{await downloadGenerated(liveImage.value,liveName.value||'发型');notice.value='已下载到本机（文件名以 HairPlay-AI 开头）';}catch{notice.value='下载失败，请重试';}
}
function toggleSelect(){selectMode.value=!selectMode.value;selected.value=[];}
function hideBanner(){state.value.bannerHidden=true;persist();}
function toggleRemember(){state.value.rememberOptions=!state.value.rememberOptions;if(!state.value.rememberOptions)state.value.options={};else state.value.options={...options.value};persist();}
const previewUrl=computed(()=>modal.value==='photo'?photo.value?.url:modal.value==='generatedPreview'?generatedDetail.value?.image:modal.value==='galleryPreview'?galleryDetail.value?.image:detail.value?.image);
// Local pictures (blob/data URLs) must never be rewritten into public asset URLs.
const previewSrc=computed(()=>{const url=previewUrl.value||'';return url.startsWith('data:')||url.startsWith('blob:')?url:assetUrl(url);});
const beforeImage='/static/catalog/placeholder.svg';
const liveImage=ref('');
const chosenGender=computed(()=>account.value?account.value.gender??null:signupGender.value);
const heroStyle=computed(()=>heroStyleFor(chosenGender.value));
</script>

<template>
 <view class="app" :style="{'padding-top':inset+'px'}">
  <scroll-view class="screen" :scroll-y="!modal" :scroll-top="scrollTop" @scroll="currentScroll=$event.detail.scrollTop" :class="{'locked':!!modal,'with-action':!!detail}" :style="{'height':`calc(100vh - ${inset}px)`}">
   <view class="content">
    <template v-if="detail">
     <view class="topbar"><button aria-label="返回" class="back" @click="goBack()"><image :src="assetUrl('/static/icons/back.svg')" /></button><text class="eyebrow">创建造型</text><view class="back-spacer" /></view>
     <text class="section-title">选择的造型</text>
     <view class="style-panel">
      <view class="style-photo"><image :src="assetUrl(detail.image)" mode="aspectFill" /><button class="expand" aria-label="放大造型图片" @click="modal='preview'"><image :src="assetUrl('/static/icons/expand.svg')" /></button></view>
      <text class="style-name">{{detail.name}}</text><text class="description">{{detail.id==='catalog-53-1'?'顶部蓬松的复古造型':detail.id==='dracula'?'光亮后梳油头配美人尖':'目录示例 · 原版详细说明未采集'}}</text><text class="tag">{{detail.category==='男士'?'男性化':detail.category}}</text>
     </view>
     <text class="section-title">上传您的照片</text>
    </template>
    <template v-else-if="galleryDetail">
     <view class="topbar"><button aria-label="返回" class="back" @click="goBack()"><image :src="assetUrl('/static/icons/back.svg')" /></button><text class="eyebrow">已保存的风格</text><view class="back-spacer" /></view>
     <text class="section-title">{{galleryDetail.name}}</text><text class="muted">{{new Date(galleryDetail.created).toLocaleDateString()}}</text>
     <view class="demo-badge">演示记录 · 目录示例，非 AI 生成</view>
     <view class="compare-image"><image :src="assetUrl(compare?beforeImage:galleryDetail.image)" mode="aspectFit" /><text class="compare-label">{{compare?'前：占位示意图':'后：目录示例'}}</text><button class="compare-toggle" @click="compare=!compare">点击比较</button></view>
     <text class="muted">比较仅展示占位示意图与目录示例，不是您的照片生成效果。</text>
     <button class="outline wide" @click="modal='galleryPreview'">放大演示图片</button>
     <button class="gold wide" @click="downloadRecord()">下载演示图片</button>
     <button class="outline wide" @click="goBack();switchTab('发现')">尝试其他</button>
    </template>
    <template v-else-if="generatedDetail">
     <view class="topbar"><button aria-label="返回" class="back" @click="goBack()"><image :src="assetUrl('/static/icons/back.svg')" /></button><text class="eyebrow">我的生成</text><view class="back-spacer" /></view>
     <text class="section-title">{{generatedDetail.name}}</text><text class="muted">{{new Date(generatedDetail.created).toLocaleDateString()}}</text>
     <view class="ai-badge block">AI 生成 · 仅保存在本机</view>
     <view class="generated-image"><image :src="generatedDetail.image" mode="aspectFit" /></view>
     <text class="privacy">这张图片由您上传的照片经火山方舟生成，保存在本机浏览器；上传的原照片不会被保存。删除后无法恢复。</text>
     <button class="outline wide" @click="modal='generatedPreview'">放大查看</button>
     <button class="gold wide" @click="downloadGeneratedRecord()">下载到本机</button>
     <button class="outline wide" @click="modal='deleteGenerated'">删除这张</button>
     <view v-if="error" class="error" role="alert"><text>{{error}}</text></view>
     <view v-if="notice" class="notice" role="status">{{notice}}</view>
     <button class="outline wide" @click="goBack()">返回相册</button>
    </template>
    <template v-else-if="tab==='发现'">
     <view v-if="!state.bannerHidden" class="invite"><text>免费试用 · 每个账户终身 3 张成功生成</text><button aria-label="关闭邀请横幅" class="invite-close" @click="hideBanner">×</button></view>
     <text class="eyebrow discover-label">发现</text>
     <view v-if="category==='所有风格'&&!query" class="hero"><view><text class="hero-title">找到您的完美造型</text><button class="hero-link" @click="switchTab('AI匹配')">AI匹配 →</button></view><button class="hero-card" @click="openStyle(heroStyle)"><image :src="assetUrl(heroStyle.image)" mode="aspectFill" /><text>{{heroStyle.name}}</text><text class="muted">{{heroStyle.category}}</text></button></view>
     <view class="search"><image class="search-icon" :src="assetUrl('/static/icons/search.svg')" /><input v-model="query" aria-label="搜索发型" placeholder="搜索发型..." confirm-type="search" /><button v-if="query" aria-label="清空搜索" @click="query=''">×</button></view>
     <button class="upload-prompt" @click="switchTab('AI匹配')"><text class="scissors">✂</text><view><text>有喜欢的发型照片？</text><text class="muted">上传照片，在自己脸上试试同款发型</text></view><text class="chevron">›</text></button>
     <view class="categories"><view v-for="(row,i) in [categories.slice(0,4),categories.slice(4,10),categories.slice(10)]" :key="i" class="category-row"><button v-for="c in row" :key="c" :class="{active:category===c}" :aria-label="'分类 '+c" @click="setCategory(c)">{{c==='男士'?'男':c}}</button></view></view>
     <view class="list-title"><text>{{category}}</text><text class="muted">{{styles.length}}</text></view>
     <view v-if="!styles.length" class="empty"><text class="empty-title">没有找到匹配的发型</text><text class="muted">试试其他关键词或分类</text><button class="outline" @click="query='';category='所有风格'">重置筛选</button></view>
     <view v-else class="catalog"><view v-for="(column,j) in [left,right]" :key="j" class="catalog-column" :class="{'large-column':j===0}"><button v-for="s in column" :key="s.id" class="catalog-card" :aria-label="'查看 '+s.name" @click="openStyle(s)"><image :src="assetUrl(s.image)" :mode="s.partial?'aspectFill':'aspectFit'" :class="{portrait:s.partial}" /><text>{{s.name}}</text><text class="muted">{{s.category}}</text></button></view></view>
     <text class="catalog-note">{{catalog.length}} 个 AI 生成的目录样图。邮箱登录后可申请试用真实生成；演示模式无需登录。</text>
    </template>
    <template v-else-if="tab==='AI匹配'">
     <text class="eyebrow">AI匹配</text><text class="page-title ai-title">获得个性化发型推荐</text><text class="section-title">上传您的照片</text>
    </template>
    <template v-else-if="tab==='画廊'">
     <view class="gallery-heading"><text class="page-title">相册</text><button class="outline" :disabled="!generations.length&&!state.records.length" @click="toggleSelect">{{selectMode?'取消':'选择'}}</button></view><text class="description">AI 生成结果和收藏的模板示例分开管理</text>
     <view class="gallery-section">
      <view class="section-head"><text class="section-title">我的生成</text><text class="count-badge">{{String(generations.length).padStart(2,'0')}}</text></view>
      <text class="muted">用您的照片生成的造型，保存在本机浏览器；上传的原照片不会保存。</text>
      <view v-if="!generations.length" class="empty-mini"><text class="empty-title">还没有 AI 生成记录</text><text class="muted">在「AI匹配」登录并生成后，会自动保存到这里</text><button class="outline" @click="switchTab('AI匹配')">去生成</button></view>
      <view v-else class="gallery-grid"><button v-for="g in generations" :key="g.id" class="gallery-card" :aria-label="'AI 生成记录 '+g.name" @click="openGenerated(g)"><image :src="g.image" mode="aspectFill" /><text v-if="selectMode" class="selection">{{selected.includes(g.id)?'☑':'□'}}</text><text class="card-badge ai">AI 生成</text><text>{{g.name}}</text><text class="muted">{{new Date(g.created).toLocaleDateString()}}</text></button></view>
     </view>
     <view class="gallery-section">
      <view class="section-head"><text class="section-title">模板示例</text><text class="count-badge">{{String(state.records.length).padStart(2,'0')}}</text></view>
      <text class="muted">从风格目录保存的示例图，不是您照片的生成效果。</text>
      <view v-if="!state.records.length" class="empty-mini"><text class="empty-title">还没有保存的模板示例</text><text class="muted">在「发现」选好风格，开启演示模式即可保存</text><button class="outline" @click="switchTab('发现')">浏览风格</button></view>
      <view v-else class="gallery-grid"><button v-for="r in state.records" :key="r.id" class="gallery-card" :aria-label="'模板示例 '+r.name" @click="openRecord(r)"><image :src="assetUrl(r.image)" mode="aspectFill" /><text v-if="selectMode" class="selection">{{selected.includes(r.id)?'☑':'□'}}</text><text class="card-badge template">模板 · 非 AI 生成</text><text>{{r.name}}</text><text class="muted">{{new Date(r.created).toLocaleDateString()}}</text></button></view>
     </view>
     <button v-if="selectMode" class="danger wide" :disabled="!selected.length" @click="modal='delete'">删除所选（{{selected.length}}）</button>
     <view v-if="error" class="error" role="alert"><text>{{error}}</text></view>
     <view v-if="notice" class="notice" role="status">{{notice}}</view>
    </template>
    <template v-else-if="tab==='个人资料'">
     <text class="eyebrow">ACCOUNT</text><view class="profile-heading"><text class="page-title">个人资料</text></view>
     <view class="plan-panel">
      <text class="section-title">邮箱登录 · 免费试用</text>
      <text class="auth-label">性别（选填，仅用于示例展示）</text>
      <view class="gender-choices" role="group" aria-label="示例展示性别">
       <button class="outline" :class="{chosen:chosenGender==='male'}" :aria-pressed="chosenGender==='male'" :disabled="authBusy" @click="chooseGender('male')">男</button>
       <button class="outline" :class="{chosen:chosenGender==='female'}" :aria-pressed="chosenGender==='female'" :disabled="authBusy" @click="chooseGender('female')">女</button>
       <button class="outline" :class="{chosen:chosenGender===null}" :aria-pressed="chosenGender===null" :disabled="authBusy" @click="chooseGender(null)">不填写</button>
      </view>
      <template v-if="account"><text class="description">已登录：{{account.email}}</text><text class="description" role="status">剩余额度：{{account.remaining}} / 3 张（终身）</text><button class="outline wide" :disabled="authBusy" @click="authAction('logout')">退出登录</button></template>
      <template v-else>
       <text class="auth-step">1 · 填写邮箱并发送验证码</text>
       <label class="auth-label" for="auth-email">邮箱地址</label>
       <input id="auth-email" class="auth-input" v-model="email" aria-label="邮箱地址" placeholder="name@example.com" maxlength="254" autocomplete="email" inputmode="email" :disabled="authBusy" />
       <button class="outline wide" :disabled="authBusy||cooldown>0" @click="authAction('code')">{{cooldown>0?cooldown+'秒后可重发':'发送验证码'}}</button>
       <text class="auth-step">2 · 输入邮件里的6位验证码</text>
       <text class="description">首次登录自动注册</text>
       <label class="auth-label" for="auth-code">邮箱验证码</label>
       <input id="auth-code" class="auth-input" v-model="code" aria-label="邮箱验证码" placeholder="6位数字" maxlength="6" autocomplete="one-time-code" inputmode="numeric" :disabled="authBusy" @confirm="authAction('login')" />
       <button class="gold wide" :disabled="authBusy" @click="authAction('login')">{{authBusy?'处理中…':'注册 / 登录'}}</button>
      </template>
      <text v-if="authMessage" class="auth-message" role="status" aria-live="polite">{{authMessage}}</text>
     </view>
     <button class="setting-row" @click="modal='language'"><image class="setting-icon" :src="assetUrl('/static/icons/language.svg')" /><view><text>语言</text><text class="muted">更改应用程序语言</text></view><text class="language-value">简体中文</text><text class="chevron">›</text></button>
     <button class="setting-row" @click="showInfo('有型（HairPlay）静态演示；分享服务未连接，不会自动发送分享。')"><image class="setting-icon" :src="assetUrl('/static/icons/share.svg')" /><view><text>分享应用</text><text class="muted">告诉朋友 有型（HairPlay）</text></view><text class="chevron">›</text></button>
     <button class="setting-row" @click="showInfo('反馈服务未连接；您输入的数据和照片不会发送到新服务。')"><text class="setting-icon">♧</text><view><text>发送反馈</text><text class="muted">帮助我们改进 有型（HairPlay）</text></view><text class="chevron">›</text></button>
     <button class="setting-row" @click="modal='settings'"><text class="setting-icon">⚙</text><view><text>本地设置</text><text class="muted">隐私与偏好</text></view><text class="chevron">›</text></button>
     <view class="brand"><text>有型（HairPlay）</text><text class="muted">版本 0.1.0 · 非官方</text></view>
    </template>
    <template v-if="detail||(!inDetail&&tab==='AI匹配')">
     <view class="photo-area" v-if="photo"><image :src="assetUrl(photo.url)" mode="aspectFit" @click="modal='photo'" /><button aria-label="移除照片" class="remove-photo" @click="removePhoto">×</button><button class="replace-photo" @click="choose">更换照片</button></view>
     <button v-else class="photo-empty" :disabled="picking" @click="choose"><text class="empty-icon">{{picking?'…':'＋'}}</text><text>{{picking?'正在读取照片…':'选择本地照片'}}</text><text class="muted">JPG / PNG / WebP · 最大 8 MB</text></button>
     <text class="privacy">选择照片后仅在本机预览；仅当您确认使用真实 AI，照片才会经有型服务端发送至火山方舟。演示模式不上传。所选照片刷新后清除，AI 生成结果会保存在本机相册。</text>
     <template v-if="!detail"><text class="section-title tips-title">最佳效果提示</text><view class="tips"><view v-for="(tip,i) in ['使用清晰、光线充足的照片','面部应清晰可见','避免使用重滤镜或浓妆']" :key="tip"><text class="muted">0{{i+1}}</text><text>{{tip}}</text></view></view><button class="advanced-toggle" @click="advanced=!advanced"><view><text class="section-title">高级选项（可选）</text><text class="muted">{{Object.values(options).filter(Boolean).join(' · ')||'未选择偏好'}}</text></view><text>{{advanced?'⌃':'⌄'}}</text></button><view v-if="advanced" class="advanced"><view v-for="g in groups" :key="g.name" class="option-group"><text class="eyebrow">{{g.name}}</text><view class="chips"><button v-for="item in g.items" :key="item" class="outline" :class="{chosen:options[g.name]===item}" @click="options[g.name]=options[g.name]===item?'':item">{{item}}</button></view></view></view></template>
     <template v-else><text class="section-title">发色偏好</text><view class="chips"><button v-for="c in ['保持原色','乌黑色','棕色','金色']" :key="c" class="outline" :class="{chosen:color===c}" @click="color=c">{{c}}</button></view></template>
     <view v-if="detail||advanced" class="requirements"><text class="eyebrow">附加要求</text><textarea v-model="requirements" aria-label="附加要求" placeholder="例如：工作时易于打理、适合戴眼镜、低维护..." maxlength="200" /><text class="counter">{{requirements.length}} / 200</text></view>
     <button class="demo-choice" :class="{chosen:demo}" @click="demo=!demo"><text>{{demo?'☑':'□'}} 演示模式（非 AI 生成）</text></button><text class="privacy">真实 AI 需邮箱登录和服务端连接，会消耗云端额度；账户终身最多成功生成3张。演示不上传、不扣次数。</text>
     <button v-if="!detail" class="gold wide generate" :disabled="loading||picking" @click="start">{{loading?'处理中…':picking?'照片读取中…':demo?'生成演示':'试试 AI 发型'}}</button>
    </template>
    <view v-if="error" class="error" role="alert"><text>{{error}}</text><button v-if="error.includes('服务未配置')" class="outline" :disabled="loading" @click="start">重试</button></view><view v-if="notice" class="notice" role="status">{{notice}}</view>
   </view>
  </scroll-view>
  <view v-if="detail" class="bottom-action"><button class="gold" :disabled="loading||picking" @click="start">{{loading?'处理中…':picking?'照片读取中…':demo?'生成演示':'试试 AI 发型'}}</button><text>每账户终身 3 张成功生成；失败与演示不扣</text></view>
  <view v-else-if="!galleryDetail&&!generatedDetail" class="tabs"><button v-for="(name,i) in ['发现','AI匹配','画廊','个人资料']" :key="name" :class="{current:tab===name}" :aria-label="'导航 '+name" @click="switchTab(name)"><image :src="assetUrl(`/static/icons/${i}.svg`)" /><text>{{name}}</text></button></view>
  <view v-if="modal" class="modal-backdrop" @click.self="closeModal" @touchmove.self.stop.prevent>
   <view class="modal" :class="{'image-modal':['preview','photo','galleryPreview','generatedPreview'].includes(modal)}" role="dialog" aria-modal="true">
    <button aria-label="关闭对话框" class="modal-close" @click="closeModal">×</button>
    <template v-if="['preview','photo','galleryPreview','generatedPreview'].includes(modal)"><image :src="previewSrc" mode="aspectFit" /><text class="muted">{{modal==='photo'?'您的本地照片（未上传）':modal==='generatedPreview'?generatedDetail?.name+' · AI 生成（本机保存）':'目录示例 · 本地研究'}}</text></template>
    <template v-else-if="modal==='info'"><text class="modal-title">本地研究说明</text><text class="modal-copy">{{info}}</text><button class="gold wide" @click="closeModal">知道了</button></template>
    <template v-else-if="modal==='demo'"><text class="modal-title">确认演示模式</text><text class="modal-copy">这不是 AI 生成。您的照片不会上传或变换；结果只是现有目录示例，可保存标记为“演示”的本地记录。</text><button class="gold wide" @click="generate">确认演示</button><button class="outline wide" @click="closeModal">取消</button></template>
    <template v-else-if="modal==='confirmUpload'"><text class="modal-title">确认发送照片？</text><text class="modal-copy">您选中的照片将由有型服务端发送至火山方舟 Seedream 进行发型编辑，消耗云端额度。生成结果会自动保存到本机相册「我的生成」，可随时删除；上传的原照片不会被保存。不要上传未经他人同意的照片。</text><button class="gold wide" @click="generate">确认上传并生成</button><button class="outline wide" @click="closeModal">取消</button></template>
    <template v-else-if="modal==='liveResult'&&liveImage"><text class="modal-title">AI 发型试戴 · 实验结果</text><image class="result-image" :src="liveImage" mode="aspectFit" /><text class="modal-copy">结果可能改变面貌或细节，请自行核对；{{generationSaved?'已保存到相册「我的生成」，可随时删除。':'尚未保存到本机相册，请先点击「下载这张」，关闭后可能无法找回。'}}</text><button v-if="!generationSaved" class="gold wide" @click="downloadLive()">下载这张</button><button class="gold wide" @click="closeModal();switchTab('画廊')">查看相册</button><button class="outline wide" @click="closeModal">关闭</button></template>
    <template v-else-if="modal==='result'&&result"><text class="modal-title">演示结果 · 非 AI 生成</text><image class="result-image" :src="assetUrl(result.image)" mode="aspectFit" /><text class="modal-copy">{{result.name}} · 现有目录示例，不是您的照片生成效果。</text><button class="gold wide" @click="saveResult">保存演示记录</button><button class="outline wide" @click="closeModal">关闭</button></template>
    <template v-else-if="modal==='delete'"><text class="modal-title">删除所选的 {{selected.length}} 条记录？</text><text class="modal-copy">将从本机相册删除所选记录；AI 生成图片删除后无法恢复，也不会影响您的账户额度。</text><button class="danger wide" @click="deleteSelected">确认删除</button><button class="outline wide" @click="closeModal">取消</button></template>
    <template v-else-if="modal==='deleteGenerated'"><text class="modal-title">删除这张生成图片？</text><text class="modal-copy">将从本机相册删除「{{generatedDetail?.name}}」，删除后无法恢复；不会影响账户额度和目录模板。</text><button class="danger wide" @click="deleteGenerated">确认删除</button><button class="outline wide" @click="closeModal">取消</button></template>
    <template v-else-if="modal==='settings'"><text class="modal-title">本地设置</text><button class="outline wide" @click="toggleRemember">{{state.rememberOptions?'☑':'□'}} 记住高级选项偏好</button><text class="modal-copy">上传的原照片不会保存在本站或本机；AI 生成结果与演示记录只留在本机浏览器，可随时删除。演示模式不联网。</text><button class="outline wide" @click="state.bannerHidden=false;persist();notice='邀请横幅已恢复'">恢复邀请横幅</button><button class="gold wide" @click="closeModal">完成</button></template>
    <template v-else-if="modal==='language'"><text class="modal-title">选择语言</text><text class="modal-copy">当前：简体中文。其他语言翻译尚未实现，不会假保存为已切换。</text><view class="language-list"><button v-for="lang in ['English','Español','Français','Deutsch','Italiano','Português','简体中文','繁體中文','日本語','한국어','Bahasa Indonesia','Русский']" :key="lang" :disabled="lang!=='简体中文'">{{lang}} {{lang==='简体中文'?'✓ 当前':'· 未实现'}}</button></view><button class="gold wide" @click="closeModal">完成</button><button class="outline wide" @click="closeModal">取消</button></template>
   </view>
  </view>
 </view>
</template>

<style scoped>
.gender-choices{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 18px}.gender-choices button{flex:1;min-width:70px;min-height:38px;font-size:13px;padding:7px}.auth-step{display:block;font-size:14px;font-weight:600;line-height:1.6;margin-top:22px}.auth-label{display:block;font-size:13px;color:#444;margin:12px 0 7px}.auth-input{display:block;box-sizing:border-box;width:100%;height:48px;border:1px solid #999;border-radius:6px;padding:0 10px;background:#fff;font-size:16px;color:#222}.auth-input:focus-within{border-color:#9c7a26;outline:2px solid #9c7a2640}.auth-message{display:block;font-size:13px;color:#55451e;line-height:1.7;margin-top:16px}
.app{max-width:560px;margin:auto;position:relative;background:white;height:100vh;overflow:hidden}.screen{height:100vh}.content{padding:12px 22px 110px}.screen.locked{overflow:hidden;pointer-events:none}.eyebrow{display:block;color:#999;font-size:11px;letter-spacing:2px;line-height:1.6}.muted{display:block;color:#999;font-size:12px;line-height:1.6}.description{display:block;color:#666;line-height:1.6;font-size:14px}.page-title{display:block;font-style:italic;font-size:34px;line-height:1.4;margin:18px 0 10px}.section-title{display:block;font-style:italic;font-size:20px;line-height:1.4;margin:26px 0 12px}.gold{background:#9c7a26;color:white;border:1px solid #9c7a26;min-height:50px;letter-spacing:2px}.outline{border:1px solid #e9e9e9;min-height:40px;padding:8px 14px}.wide{width:100%;margin-top:18px}.chosen{border-color:#9c7a26!important;background:#faf7ef;color:#987824}.invite{height:40px;display:flex;align-items:center;background:#f9f6ef;border:1px solid #f4f0e7;border-radius:9px;gap:5px;padding:0 10px}.gift{color:#9c7a26;font-size:20px}.invite-text{padding:0;flex:1;font-size:13px;white-space:nowrap}.invite-link{font-size:11px;color:#9c7a26;padding:0 4px}.invite-close{color:#999;font-size:23px;padding:0 2px}.discover-label{margin-top:22px}.search{display:flex;align-items:center;gap:12px;border-bottom:1px solid #eee;height:46px;margin:8px 0 18px}.search-icon{font-size:30px;color:#777;line-height:1}.search input{flex:1;height:40px;font-size:15px;min-width:0}.search button{font-size:22px}.upload-prompt{display:flex;align-items:center;text-align:left;border:1px solid #ececec;width:100%;min-height:72px;padding:12px 16px;gap:14px}.upload-prompt view{flex:1}.upload-prompt view>text:first-child{display:block;font-size:15px;line-height:1.6}.upload-prompt .muted{font-size:12px}.scissors{font-size:23px;color:#9c7a26}.chevron{color:#999;font-size:28px;line-height:1}.categories{border-bottom:1px solid #eee;padding:23px 0 14px}.category-row{display:flex;gap:20px;align-items:center;margin-bottom:21px}.category-row:last-child{margin-bottom:0}.category-row button{padding:0;font-size:19px;color:#b9b9b9;min-height:32px;white-space:nowrap}.category-row:not(:first-child){gap:20px}.category-row .active{color:#9c7a26;border-bottom:1px solid #9c7a26;font-style:italic}.category-row:last-child button:first-child{width:38px;text-align:left}.list-title{display:flex;justify-content:space-between;align-items:end;padding:22px 0 14px}.list-title>text:first-child{font-style:italic;font-size:27px}.catalog{display:flex;gap:10px;align-items:start}.catalog-column{width:41.3%;min-width:0}.large-column{width:55.8%}.catalog-card{display:block;width:100%;padding:0;text-align:left;margin-bottom:13px}.catalog-card image{display:block;width:100%;height:auto;aspect-ratio:1}.catalog-card image.portrait{aspect-ratio:533/617}.catalog-card>text:not(.muted){display:block;font-size:14px;line-height:1.5;margin-top:7px}.catalog-card .muted{font-size:11px}.catalog-note{display:block;font-size:11px;color:#888;line-height:1.7;border-top:1px solid #eee;padding-top:18px;margin-top:20px}.tabs{position:absolute;bottom:0;left:0;right:0;display:flex;background:#fff;border-top:1px solid #eee;box-shadow:0 -1px 3px #00000005;padding:8px 0 calc(7px + env(safe-area-inset-bottom))}.tabs button{width:25%;padding:0;color:#999;font-size:11px;display:flex;align-items:center;flex-direction:column;gap:5px;min-height:48px}.tabs image{height:25px;width:25px;opacity:.55}.tabs .current{color:#0784ff}.tabs .current image{opacity:1}.hero{display:flex;align-items:center;gap:18px;padding:25px 0 10px;min-height:285px}.hero>view{width:48%}.hero-title{font-size:27px;font-style:italic;line-height:1.3;display:block}.hero-link{font-size:11px;color:#9c7a26;padding:0;margin-top:24px;text-align:left}.hero-card{width:48%;padding:0;text-align:left}.hero-card image{width:100%;height:215px}.hero-card>text{display:block;font-size:12px}.hero-card .muted{font-size:10px}.topbar{display:flex;align-items:center;justify-content:space-between;height:46px;margin-bottom:0}.topbar+.section-title{margin-top:12px}.back image{width:25px;height:25px}.expand image{width:21px;height:21px;box-shadow:none;border-radius:0}.back{border:1px solid #eee;border-radius:50%;width:36px;height:36px;font-size:26px;padding:0;line-height:1}.back-spacer{width:36px}.topbar .eyebrow{font-size:11px}.style-panel{border:1px solid #e9e9e9;text-align:center;padding:15px 16px 22px}.style-photo{width:72%;aspect-ratio:1;margin:auto;position:relative}.style-photo image{width:100%;height:100%;border-radius:26px;box-shadow:0 4px 16px #0003}.expand{position:absolute;right:8px;top:8px;width:30px;height:30px;border-radius:10px;background:#555d;color:white;font-size:23px;padding:0}.style-name{display:block;font-size:25px;font-style:italic;margin:17px 0 12px}.style-panel .description{font-size:14px}.tag{display:inline-block;font-size:11px;letter-spacing:2px;border:1px solid #eee;padding:8px 12px;margin-top:18px}.photo-empty{width:100%;min-height:225px;border:1px dashed #ddd;background:#fafafa;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px}.empty-icon{font-size:37px;color:#aaa}.photo-area{position:relative;background:#fafafa;margin-top:12px}.photo-area image{width:100%;height:400px;display:block}.remove-photo{position:absolute;top:12px;right:12px;width:36px;height:36px;border-radius:50%;background:#222b;color:white;font-size:25px;padding:0}.replace-photo{position:absolute;right:12px;bottom:12px;padding:9px 12px;font-size:11px;letter-spacing:2px}.privacy{display:block;color:#999;font-size:11px;line-height:1.7;margin-top:12px}.bottom-action{position:absolute;bottom:0;left:0;right:0;background:white;border-top:1px solid #e5e5e5;padding:16px 22px calc(8px + env(safe-area-inset-bottom))}.bottom-action button{width:100%}.bottom-action>text{display:block;color:#999;font-size:10px;text-align:center;margin-top:5px}.with-action .content{padding-bottom:140px}.ai-title{font-size:32px;letter-spacing:-1px;margin-top:24px;margin-bottom:30px}.tips-title{margin-top:30px;padding-bottom:16px;border-bottom:1px solid #eee}.tips>view{display:flex;gap:14px;align-items:center;padding:14px 0;border-bottom:1px solid #eee}.tips>view>text:last-child{font-size:14px}.advanced-toggle{width:100%;display:flex;justify-content:space-between;align-items:center;padding:0 0 15px;border-bottom:1px solid #eee;text-align:left;margin:26px 0 18px}.advanced-toggle .section-title{margin:0 0 5px}.advanced-toggle>text{font-size:24px;color:#777}.option-group{margin:24px 0}.chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 20px}.chips button{font-size:13px;min-height:36px;padding:8px 12px}.requirements{margin-top:24px}.requirements textarea{display:block;width:100%;min-height:95px;height:95px;padding:12px;border:1px solid #eee;font-size:12px;line-height:1.6;margin-top:10px}.counter{display:block;text-align:right;color:#aaa;font-size:10px;margin-top:8px}.demo-choice{font-size:12px;border:1px solid #eee;width:100%;padding:12px;text-align:left;margin-top:22px}.generate{margin-top:22px}.error{display:flex;flex-direction:column;gap:10px;background:#fff2f0;border:1px solid #e4a29a;color:#aa3023;padding:12px;font-size:13px;line-height:1.6;margin-top:16px}.notice{background:#f5f7ed;color:#64723b;font-size:12px;padding:12px;line-height:1.6;margin-top:16px}.empty{min-height:240px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center}.empty-title{font-size:19px}.gallery-heading{display:flex;justify-content:space-between;align-items:center}.gallery-heading .page-title{margin-top:0;font-size:30px}.gallery-heading button{font-size:12px;min-height:36px}.saved-count{margin:18px 0 34px;border-bottom:1px solid #eee;padding-bottom:20px}.gallery-grid{display:flex;flex-wrap:wrap;gap:12px}.gallery-card{width:calc(50% - 6px);padding:0;text-align:left;position:relative}.gallery-card image{width:100%;height:210px}.gallery-card>text{display:block;font-size:13px;margin-top:5px}.gallery-card .demo-badge{font-size:10px}.selection{position:absolute;right:8px;top:8px;background:white;padding:4px}.demo-badge{background:#faf6e9;color:#9c7a26;font-size:11px;padding:7px;line-height:1.6;margin:12px 0}.danger{background:#ad3c32;color:white;min-height:42px}.compare-image{position:relative;background:#f6f6f6}.compare-image image{width:100%;height:450px}.compare-label{position:absolute;left:10px;top:10px;background:#fff;padding:7px;font-size:11px}.compare-toggle{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);font-size:12px;padding:8px 12px}.profile-heading{display:flex;align-items:center;justify-content:space-between}.profile-heading .page-title{margin-top:18px}.credits{color:#ffb700;font-size:18px;align-self:start;margin:10px 60px 0 0}.plan-panel{background:#fafaf8;border:1px solid #eee;margin:30px 0 22px;padding:24px}.plan-panel .section-title{margin:0 0 14px}.plan-panel .gold{margin-top:18px}.plan-line{height:1px;background:#e1e3e5;margin:16px 0}.setting-row{display:flex;align-items:center;width:100%;min-height:80px;border-top:1px solid #eee;padding:18px 0;text-align:left;gap:24px}.setting-row>view{flex:1}.setting-row>view>text:first-child{font-size:18px;display:block}.setting-row .muted{font-size:11px;letter-spacing:1px;margin-top:5px}.setting-icon{font-size:25px;width:32px;height:32px;flex-shrink:0}.plan-title{display:flex;align-items:center;gap:14px}.plan-title image{width:24px;height:24px;flex-shrink:0}.invite button{background:transparent}.gift{width:18px;height:18px;flex-shrink:0}.search-icon{width:18px;height:18px;flex-shrink:0}.language-value{font-size:11px;color:#777;white-space:nowrap}.brand{border-top:1px solid #eee;text-align:center;padding:30px 0}.brand>text{display:block;margin-bottom:8px}.brand>text:first-child{font-style:italic;font-size:19px}.modal-backdrop{position:absolute;inset:0;background:#0009;z-index:30;display:flex;align-items:center;justify-content:center;padding:20px}.modal{position:relative;background:white;max-height:calc(100vh - 60px);overflow:auto;width:100%;padding:34px 20px 20px;border-radius:5px}.modal-close{position:absolute;right:6px;top:4px;font-size:27px;min-width:36px;min-height:36px;padding:0;z-index:1}.modal-title{display:block;font-size:21px;line-height:1.5;margin-bottom:15px}.modal-copy{font-size:14px;line-height:1.8;display:block}.image-modal{padding:40px 10px 16px;text-align:center}.image-modal image{width:100%;height:65vh}.result-image{width:100%;height:260px}.language-list{max-height:44vh;overflow:auto;margin:15px 0}.language-list button{display:block;width:100%;text-align:left;border-top:1px solid #eee;padding:12px}.language-list button[disabled]{opacity:.45}
.gold{display:flex;align-items:center;justify-content:center}.invite-text{text-align:left}.plan-panel .description{font-size:13px}.plan-panel .section-title{font-size:21px}.style-name{font-size:22px;line-height:1.4;margin-top:12px}.style-panel .description{font-size:12px}.tag{padding:7px 10px;font-size:10px}.style-photo .expand image{width:21px;height:21px;box-shadow:none;border-radius:0}.expand{display:flex;align-items:center;justify-content:center}.back{display:flex;align-items:center;justify-content:center}.bottom-action .gold{font-size:12px;min-height:46px}.invite-close{font-size:20px;font-weight:300}.modal-backdrop{position:fixed;max-width:560px;margin:auto}.app{height:100dvh}.content{padding-bottom:calc(110px + env(safe-area-inset-bottom))}
.gallery-section{margin-top:30px}.gallery-section:first-of-type{margin-top:6px}.section-head{display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid #eee;padding-bottom:9px}.section-head .section-title{margin:0}.count-badge{font-size:12px;color:#999;letter-spacing:2px}.section-head+.muted{margin:9px 0 15px}.empty-mini{min-height:158px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;text-align:center;background:#fafafa;border:1px dashed #e5e5e5;padding:18px}.empty-mini .empty-title{font-size:15px}.empty-mini button{min-height:36px;font-size:12px;padding:6px 14px}.card-badge{display:inline-block;font-size:10px;letter-spacing:1px;padding:3px 7px;line-height:1.4;margin:6px 0 2px}.card-badge.ai{background:#eef4fb;color:#2f6fa8}.card-badge.template{background:#faf6e9;color:#9c7a26}.ai-badge.block{display:inline-block;background:#eef4fb;color:#2f6fa8;font-size:11px;letter-spacing:1px;padding:7px 10px;margin:12px 0}.generated-image{background:#f6f6f6;margin-top:9px}.generated-image image{width:100%;height:420px;display:block}
@media(max-width:375px){.content{padding-left:18px;padding-right:18px}.category-row{gap:18px}.category-row:not(:first-child){gap:18px}.category-row button{font-size:18px}.invite-text{font-size:12px}.ai-title{font-size:31px}.setting-row{gap:16px}}
</style>
