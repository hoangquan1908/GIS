import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadGisData,getAiForecast,searchLocationRisk,loadReports,saveReport,importReports,fetchWeatherDirect} from '../public/flood-engine.js';
let storage=new Map(), failStorage=false;
globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>{if(failStorage)throw new Error('QuotaExceeded');storage.set(key,value);}};
const originalFetch=globalThis.fetch;
test('GIS retries, deduplicates concurrent requests, and search has no false fallback',async()=>{
 let calls=0,fail=true;
 globalThis.fetch=async url=>{calls++;if(fail)return {ok:false};return {ok:true,json:()=>readFile(new URL('../data/'+new URL(url).pathname.split('/').pop(),import.meta.url),'utf8').then(JSON.parse)};};
 try{
  await assert.rejects(loadGisData());
  fail=false;calls=0;
  const [first,second]=await Promise.all([loadGisData(),loadGisData()]);
  assert.equal(calls,2);assert.equal(first,second);
  assert.equal(await searchLocationRisk('not a real street zzzz'),null);
  assert.ok((await searchLocationRisk('van quan')).matched_location.includes('Văn Quán'));
  const dry=await getAiForecast('+1h',0);
  assert.ok(dry.predictions.every(p=>p.depth_max_cm===0));
  assert.equal(dry.average_confidence_pct,null);
  assert.ok(dry.predictions.every(p=>p.confidence_pct===null));
 }finally{globalThis.fetch=originalFetch;}
});
test('reports do not seed fabricated entries or promote verification',async()=>{
 storage.clear();assert.deepEqual(await loadReports(),[]);
 const saved=saveReport({reporter_name:'Test',location_name:'Văn Quán',coordinates:null,depth_level:'medium',depth_cm:25});
 assert.equal(saved.status,'unverified');assert.equal(saved.coordinates,null);
 assert.equal((await loadReports()).length,1);
 failStorage=true;
 assert.throws(()=>saveReport({reporter_name:'Test',location_name:'Văn Quán',depth_level:'medium',depth_cm:25}));
 failStorage=false;
 assert.equal((await loadReports()).length,1);
});
test('bad stored JSON is reported without replacing user data',async()=>{
 storage.set('hadong-community-reports','bad json');
 await assert.rejects(loadReports());
 assert.equal(storage.get('hadong-community-reports'),'bad json');
 storage.clear();
});
test('weather shares in-flight work and supports a real forced refresh',async()=>{
 let count=0;
 globalThis.fetch=async()=>{count++;return {ok:true,json:async()=>({hourly:{time:['2026-09-20T01:00'],precipitation:[null]}})};};
 try{
  const [a,b]=await Promise.all([fetchWeatherDirect(),fetchWeatherDirect()]);
  assert.equal(count,1);assert.equal(a,b);assert.equal(a.hourly.precipitation[0],null);
  await fetchWeatherDirect();assert.equal(count,1);
  await fetchWeatherDirect(true);assert.equal(count,2);
  globalThis.fetch=async()=>({ok:true,json:async()=>({hourly:{time:[],precipitation:[]}})});
  await assert.rejects(fetchWeatherDirect(true));
 }finally{globalThis.fetch=originalFetch;}
});

test('backup imports are atomic, deduplicated and never mark data verified',async()=>{
 storage.clear();
 const local=saveReport({reporter_name:'Local',location_name:'Văn Quán',depth_level:'low',depth_cm:12});
 const backup={...local,id:'rep-backup-1',reporter_name:'Backup',status:'verified',votes:999};
 assert.equal(await importReports({reports:[backup,local,backup]}),1);
 const reports=await loadReports();
 assert.equal(reports.length,2);assert.equal(reports[0].status,'unverified');assert.equal(reports[0].votes,0);
 assert.equal(await importReports({reports:[backup]}),0);
 const before=storage.get('hadong-community-reports');
 await assert.rejects(importReports({reports:[{...backup,id:'rep-next'},{...backup,id:'rep-invalid',depth_cm:-5}]}));
 assert.equal(storage.get('hadong-community-reports'),before);
 failStorage=true;
 await assert.rejects(importReports({reports:[{...backup,id:'rep-another'}]}));
 failStorage=false;
 assert.equal(storage.get('hadong-community-reports'),before);
});
