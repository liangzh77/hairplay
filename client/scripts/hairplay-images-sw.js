/* Public catalogue images only. Never cache API responses, uploads, data/blob URLs or private results.
   Build injects a revision derived from approved image hashes, so replacements cannot stay stale. */
const CACHE_PREFIX='hairplay-public-images-';
const CACHE_NAME=CACHE_PREFIX+'__IMAGE_CACHE_REVISION__';
const hashes=__IMAGE_ASSET_HASHES__;
const scope=new URL(self.registration.scope);
function isPublicImageURL(url){
 if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname+'static/'))return false;
 const name=url.pathname.slice((scope.pathname+'static/').length);
 return Object.hasOwn(hashes,name)&&url.search==='?v='+hashes[name];
}
function isPublicImage(request){
 return request.method==='GET'&&isPublicImageURL(new URL(request.url));
}
function cacheable(response){return response.ok&&response.type==='basic'&&/^image\/(?:jpeg|svg\+xml)(?:;|$)/i.test(response.headers.get('content-type')||'');}
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 const names=await caches.keys();
 await Promise.all(names.filter(name=>name.startsWith(CACHE_PREFIX)&&name!==CACHE_NAME).map(name=>caches.delete(name)));
 await self.clients.claim();
})()));
// The first navigation is not yet SW-controlled. Warm only images already loaded by
// that page, never preload the full catalogue and never touch blob/data/private URLs.
self.addEventListener('message',event=>{
 if(event.data?.type!=='CACHE_OPENED_IMAGES'||!Array.isArray(event.data.urls))return;
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE_NAME);
  const urls=[...new Set(event.data.urls.slice(0,60))];
  await Promise.allSettled(urls.map(async raw=>{
   if(typeof raw!=='string'||raw.length>512)return;
   let url;try{url=new URL(raw);}catch{return;}
   if(!isPublicImageURL(url)||await cache.match(url.href))return;
   const response=await fetch(url.href);
   if(cacheable(response))await cache.put(url.href,response);
  }));
 })());
});
self.addEventListener('fetch',event=>{
 if(!isPublicImage(event.request))return;
 event.respondWith((async()=>{
  try{
   const cache=await caches.open(CACHE_NAME);
   const cached=await cache.match(event.request);
   if(cached)return cached;
   const response=await fetch(event.request);
   if(cacheable(response)){
    try{await cache.put(event.request,response.clone());}catch{/* storage disabled/full: return network image */}
   }
   return response;
  }catch{return fetch(event.request);}
 })());
});
