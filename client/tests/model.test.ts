import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// A real, decodable JPEG so the payload checks are exercised against genuine bytes.
const jpegB64=readFileSync(new URL('../src/static/catalog/ai-catalog-44-0.jpg',import.meta.url)).toString('base64');
const jpegPayload='data:image/jpeg;base64,'+jpegB64;
const fakePayload='data:image/jpeg;base64,/9j/'+'A'.repeat(2_000);
import {catalog,categories,filterStyles,heroStyleFor,initialState,decodeState,validatePhoto,LocalGenerationService,makeRecord,removeRecords,makeGeneratedRecord,decodeGenerations,removeGenerations,insertGeneration,isValidGeneratedImage,jpegEndsWithEoi,jpegHasSegments,GENERATION_LIMIT,GENERATION_IMAGE_MAX,type GeneratedRecord} from '../src/core/model';
test('observed catalog and filtering',()=>{assert.equal(catalog.length,27);assert.equal(categories.length,14);for(const c of categories.slice(1))assert.ok(filterStyles(c,'').length>0,c);assert.equal(filterStyles('男士',' 庞巴杜 ').length,1);assert.equal(filterStyles('男士','no matching result').length,0);assert.equal(filterStyles('所有风格','').length,catalog.length);});
test('all-styles hero follows stored gender, unknown defaults to female example',()=>{
 assert.deepEqual([heroStyleFor('male').id,heroStyleFor('female').id,heroStyleFor(null).id,heroStyleFor(undefined).id],['catalog-54-1','catalog-44-1','catalog-44-1','catalog-44-1']);
 assert.equal(heroStyleFor('male').name,'发际纹身渐变');assert.equal(heroStyleFor(null).name,'许士剪');
});
test('storage round trip and selective deletion',()=>{const state=initialState();state.records.push(makeRecord({demo:true,style:catalog[0]}));state.bannerHidden=true;state.options={'风格类型':'职业'};const restored=decodeState(JSON.stringify(state));assert.deepEqual(restored,state);assert.equal(removeRecords(state,[state.records[0].id]).records.length,0);assert.equal(state.records.length,1);});
test('corrupt storage is tolerated and untrusted images discarded',()=>{for(const input of ['{',null,[],{version:2}])assert.deepEqual(decodeState(input),initialState());const s=decodeState({version:1,options:{'风格类型':42},records:[{demo:true,id:'x',name:'x',image:'https://evil.invalid/private',created:'x',beforeLabel:'x'}]});assert.equal(s.records.length,0);assert.deepEqual(s.options,{});});
test('file limits and dimensions',()=>{const valid={size:120,type:'image/png',width:64,height:64};assert.equal(validatePhoto(valid),'');assert.match(validatePhoto({...valid,type:'text/plain'}),/JPG/);assert.match(validatePhoto({...valid,size:0}),/损坏/);assert.match(validatePhoto({...valid,size:8*1024*1024+1}),/8 MB/);assert.match(validatePhoto({...valid,width:10}),/尺寸/);assert.match(validatePhoto({...valid,width:10000,height:10000}),/尺寸/);});
test('service is explicitly unconfigured and demo opt-in required',async()=>{const service=new LocalGenerationService();const r={photo:'blob:local',options:{},requirements:'test',demo:false};await assert.rejects(service.generate({...r,photo:''}),/上传/);await assert.rejects(service.generate(r),/服务未配置/);const result=await service.generate({...r,demo:true,styleId:catalog[0].id});assert.equal(result.demo,true);assert.equal(result.style.id,catalog[0].id);assert.equal(makeRecord(result).demo,true);});

test('AI generations are local, jpeg-only, bounded and removable',()=>{
 const payload=jpegPayload;
 const record=makeGeneratedRecord('发际纹身渐变',payload);
 assert.equal(record.source,'ai');assert.ok(record.id.startsWith('gen-'));assert.equal(record.name,'发际纹身渐变');
 assert.equal(isValidGeneratedImage(payload),true);
 assert.deepEqual(decodeGenerations(JSON.stringify([record])),[record]);
 assert.deepEqual(decodeGenerations(null),[]);assert.deepEqual(decodeGenerations('{'),[]);assert.deepEqual(decodeGenerations({length:0}),[]);
 const bad=[{...record,source:'demo'},{...record,id:'demo-1'},{...record,image:'data:image/png;base64,AAAA'},{...record,image:'https://evil.invalid/a.jpg'},{...record,name:'x'.repeat(61)},{...record,created:7},
  // A claimed JPEG prefix is not enough: the payload must be real, non-trivial JPEG bytes.
  {...record,image:'data:image/jpeg;base64,'},{...record,image:'data:image/jpeg;base64,!!!!'},{...record,image:'data:image/jpeg;base64,/9j/'},{...record,image:'data:image/jpeg;base64,'+Buffer.from([0x89,0x50,0x4e,0x47]).toString('base64')+'A'.repeat(2_000)},
  {...record,image:'data:image/jpeg;base64,/9j/'+'A'.repeat(GENERATION_IMAGE_MAX)},
  // Claiming a JPEG prefix with no real EOI marker, or truncated real bytes, must fail too.
  {...record,image:fakePayload},
  {...record,image:'data:image/jpeg;base64,'+jpegB64.slice(0,-8)+'AAAAAAAA'},
  {...record,image:'data:image/jpeg;base64,'+jpegB64.slice(0,600)}];
 for(const r of bad)assert.deepEqual(decodeGenerations([r]),[],JSON.stringify(r).slice(0,60));
 assert.equal(isValidGeneratedImage('data:image/jpeg;base64,'),false);
 assert.equal(isValidGeneratedImage(null),false);
 assert.equal(isValidGeneratedImage(fakePayload),false,'a bogus body must not pass a prefix-only check');
 // SOI + zeros padding + EOI is not a decodable JPEG: a segment marker must follow SOI.
 const padded='data:image/jpeg;base64,'+Buffer.concat([Buffer.from([0xff,0xd8]),Buffer.alloc(1_600,0),Buffer.from([0xff,0xd9])]).toString('base64');
 assert.equal(jpegHasSegments(''.concat(Buffer.from([0xff,0xd8,0,0]).toString('base64'))),false);
 // Openings that are not a JPEG segment an encoder could have written: a stuffed
 // byte FF 00, a reserved code FF 02, and a zero-length APP0 segment must all be
 // refused, while a real APP0/DQT opening must still pass.
 const opening=(marker:number,declared:number)=>Buffer.from([0xff,0xd8,0xff,marker,(declared>>8)&0xff,declared&0xff,...Array(Math.max(0,declared-2)).fill(0),0xff,0xd9]).toString('base64');
 assert.equal(jpegHasSegments(opening(0x00,0x2a)),false,'FF 00 is not a segment marker');
 assert.equal(jpegHasSegments(opening(0x02,0x2a)),false,'FF 02 is a reserved code');
 assert.equal(jpegHasSegments(opening(0xe0,0x0000)),false,'a zero-length segment is not a picture');
 assert.equal(jpegHasSegments(opening(0xdb,0x43)),true,'a DQT opening is a real segment');
 assert.equal(jpegHasSegments(opening(0xe0,0x10)),true,'a JFIF APP0 opening is a real segment');
 assert.equal(isValidGeneratedImage(padded),false,'marker-and-zeros padding must not pass');
 assert.equal(isValidGeneratedImage('data:image/jpeg;base64,'+Buffer.from([0xff,0xd8,0xff,0xe0]).toString('base64')),false,'too short to be a real picture');
 assert.equal(jpegHasSegments(jpegB64),true,'a real picture must still pass');
 assert.equal(isValidGeneratedImage(jpegPayload),true);
 assert.equal(jpegEndsWithEoi(jpegB64),true);
 assert.equal(jpegEndsWithEoi(jpegB64.slice(0,-4)+'AAAA'),false);
 const many=Array.from({length:GENERATION_LIMIT+4},(_,i)=>({...record,id:`gen-${i}`}));
 assert.equal(decodeGenerations(many).length,GENERATION_LIMIT);
 assert.equal(GENERATION_LIMIT,6);
 assert.deepEqual(removeGenerations([record],[]),[record]);assert.deepEqual(removeGenerations([record],[record.id]),[]);
 assert.equal(makeGeneratedRecord('','x').name,'AI 发型');
 const inserted=insertGeneration([{...record,id:'gen-old'}],{...record,id:'gen-new'});
 assert.equal(inserted[0].id,'gen-new');assert.equal(inserted.length,2);
 let full:GeneratedRecord[]=[record];for(let i=0;i<GENERATION_LIMIT+3;i++)full=insertGeneration(full,{...record,id:`gen-${i + 100}`});
 assert.equal(full.length,GENERATION_LIMIT);assert.equal(full[0].id,`gen-${100+GENERATION_LIMIT+2}`);assert.equal(new Set(full.map(r=>r.id)).size,GENERATION_LIMIT);
});
