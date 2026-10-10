import approved from '../../scripts/public-assets.json';
// Catalog paths stay platform-neutral in storage and unit tests. Versioned H5
// URLs cannot read stale bytes from the browser HTTP cache after an image update.
export function assetUrl(path:string):string {
 // #ifdef H5
 if(path.startsWith('/static/')){
  const hash=(approved as Record<string,string>)[path.slice(1)];
  return import.meta.env.BASE_URL+path.slice(1)+(hash?'?v='+hash.slice(0,16):'');
 }
 // #endif
 return path;
}
