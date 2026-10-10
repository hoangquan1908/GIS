import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import server from '../server.mjs';
let base;
before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
test('HTML, modules and data are served correctly',async()=>{
 for(const route of ['/','/app.js','/app-utils.js','/flood-engine.js','/favicon.svg','/data/sites.geojson']){
  const response=await fetch(base+route);assert.equal(response.status,200,route);
 }
 const html=await(await fetch(base)).text();assert.match(html,/Một góc nhìn/);
 assert.match(html,/report-dialog/);
 assert.equal((await fetch(base+'/api/health')).status,200);
 assert.equal((await fetch(base+'/api/missing')).status,404);
});
test('API respects zero rain and labels forecast simulations',async()=>{
 const response=await fetch(base+'/api/ai-forecast?rain=0&horizon=%2B1h');
 const data=await response.json();
 assert.equal(data.data_mode,'simulation');assert.equal(data.validated,false);
 assert.equal(data.average_confidence_pct,null);
 assert.ok(data.predictions.every(p=>p.depth_max_cm===0&&p.confidence_pct===null));
 for(const route of ['/api/dashboard?rain=NaN','/api/dashboard?rain=-5','/api/dashboard?rain=','/api/ai-forecast?horizon=tomorrow'])assert.equal((await fetch(base+route)).status,400);
});
test('unknown places and unsupported routes are explicit',async()=>{
 assert.equal((await fetch(base+'/api/search?q=zzzzzzunknown')).status,404);
 assert.equal((await fetch(base+'/api/search?q=')).status,400);
 assert.equal((await fetch(base+'/api/routing?from=unknown&to=unknown')).status,422);
 const route=await(await fetch(base+'/api/routing')).json();assert.equal(route.data_mode,'simulation');
});
test('invalid report payloads, unsupported methods and cross-origin writes fail',async()=>{
 const post=(body,headers={})=>fetch(base+'/api/community-reports',{method:'POST',headers:{'Content-Type':'application/json',...headers},body});
 assert.equal((await post('{')).status,400);
 assert.equal((await post('{}')).status,400);
 assert.equal((await post('{}',{'Content-Type':'text/plain'})).status,415);
 assert.equal((await post('{}',{Origin:'https://untrusted.example'})).status,403);
 assert.equal((await post(JSON.stringify({data:'a'.repeat(2*1024*1024)}))).status,413);
 assert.equal((await fetch(base+'/api/dashboard',{method:'POST'})).status,405);
 const head=await fetch(base+'/api/health',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
});

test('search uses the same rainfall and horizon as forecast',async()=>{
 const response=await fetch(base+'/api/search?q=Van%20Quan&rain=0&horizon=%2B2h');
 assert.equal(response.status,200);
 assert.equal((await response.json()).depth_range_text,'0–0 cm');
 assert.equal((await fetch(base+'/api/search?q=Van%20Quan&horizon=invalid')).status,400);
});
