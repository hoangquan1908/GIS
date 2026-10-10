import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import server from '../server.mjs';
if(typeof WebSocket==='undefined')throw new Error('Browser verification requires Node.js 22+ (global WebSocket). The website itself supports Node.js 20+.');
const output=new URL('../artifacts/',import.meta.url);
await fs.mkdir(output,{recursive:true});
const profile=await fs.mkdtemp(path.join(tmpdir(),'hadong-browser-'));
const candidates=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean);
const executable=candidates.find(existsSync);
if(!executable)throw new Error('Set CHROME_PATH to a Chromium browser executable.');
let chrome,ws;const pending=new Map();let id=0,weatherFails=false,leafletFails=false;
const exceptions=[],failures=[];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fixture={hourly:{time:[],precipitation:[]}};
for(let i=-2;i<40;i++){fixture.hourly.time.push(new Date(Math.floor(Date.now()/3600000)*3600000+(i+7)*3600000).toISOString().slice(0,16));fixture.hourly.precipitation.push(i<0?0:i%7);}
function command(method,params={}){
 const call=++id;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(call);reject(new Error('CDP timeout: '+method));},20000);
  pending.set(call,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});
  ws.send(JSON.stringify({id:call,method,params}));
 });
}
async function evaluate(expression){
 const result=await command('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(result.exceptionDetails)throw new Error(result.exceptionDetails.text+' '+result.exceptionDetails.exception?.description);
 return result.result.value;
}
async function until(expression,label){
 for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(100);}
 throw new Error('Timed out: '+label);
}
async function click(selector){await evaluate('document.querySelector('+JSON.stringify(selector)+').click()');}
async function input(selector,value,event='input'){
 await evaluate('(()=>{const el=document.querySelector('+JSON.stringify(selector)+');el.value='+JSON.stringify(value)+';el.dispatchEvent(new Event('+JSON.stringify(event)+',{bubbles:true}));})()');
}
async function shot(file){const result=await command('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await fs.writeFile(new URL(file,output),Buffer.from(result.data,'base64'));}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url='http://127.0.0.1:'+server.address().port;
 chrome=spawn(executable,['--headless=new','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'--hide-scrollbars','about:blank'],{windowsHide:true,stdio:'ignore'});
 chrome.on('error',error=>failures.push(error.message));
 let port;
 for(let i=0;i<100;i++){try{port=(await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break;}catch{await delay(100);}}
 if(!port)throw new Error('Headless browser did not start.');
 const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
 const target=targets.find(t=>t.type==='page');
 ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=async event=>{
  const msg=JSON.parse(event.data);
  if(msg.id){const p=pending.get(msg.id);if(p){pending.delete(msg.id);msg.error?p.reject(new Error(msg.error.message)):p.resolve(msg.result);}return;}
  if(msg.method==='Runtime.exceptionThrown')exceptions.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
  if(msg.method==='Fetch.requestPaused'){
   const {requestId,request}=msg.params;
   try{
    if(request.url.includes('api.open-meteo.com')){
     if(weatherFails)await command('Fetch.failRequest',{requestId,errorReason:'Failed'});
     else await command('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'}],body:Buffer.from(JSON.stringify(fixture)).toString('base64')});
    }else if(leafletFails&&request.url.includes('leaflet.js'))await command('Fetch.failRequest',{requestId,errorReason:'Failed'});
    else await command('Fetch.continueRequest',{requestId});
   }catch(error){failures.push(error.message);}
  }
 };
 await command('Runtime.enable');await command('Page.enable');
 await command('Fetch.enable',{patterns:[{urlPattern:'*api.open-meteo.com*'},{urlPattern:'*leaflet.js*'}]});
 await command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
 await command('Page.navigate',{url});
 await until("document.getElementById('kpi-sites')?.textContent!=='—' && !document.getElementById('refresh-btn')?.disabled",'initial dashboard');
 await until("document.querySelectorAll('.location-item').length>0",'location list');
 assert.equal(await evaluate("document.querySelectorAll('.rain-chart .chart-col').length"),24);
 assert.equal(await evaluate("document.getElementById('kpi-reports').textContent"),'0');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await shot('desktop.png');
 const automaticRain=await evaluate("document.querySelector('#rain-table-body tr td:nth-child(2)').textContent");
 assert.equal(await evaluate("document.getElementById('ai-auto-toggle').getAttribute('aria-pressed')"),'true');
 await click('#use-weather-btn');
 assert.equal(await evaluate("document.getElementById('ai-auto-toggle').getAttribute('aria-pressed')"),'false');
 assert.equal(await evaluate("document.getElementById('scenario-rain').value"),'6');
 await click('#refresh-btn');
 await until("!document.getElementById('refresh-btn').disabled",'manual rain refresh');
 assert.equal(await evaluate("document.getElementById('scenario-rain').value"),'6');
 await click('#ai-auto-toggle');
 await until("document.getElementById('scenario-rain').value==="+JSON.stringify(automaticRain),'automatic rain resumed');
 assert.equal(await evaluate("new URLSearchParams(location.search).get('auto')"),'1');
 await command('Page.reload');
 await until("!document.getElementById('refresh-btn')?.disabled && document.querySelectorAll('.location-item').length>0",'automatic mode reload');
 assert.equal(await evaluate("document.getElementById('ai-auto-toggle').getAttribute('aria-pressed')"),'true');
 await click('#alert-sound-toggle');
 assert.equal(await evaluate("document.getElementById('hud-sound-btn').getAttribute('aria-pressed')"),'true');
 await click('#hud-sound-btn');
 assert.equal(await evaluate("document.getElementById('alert-sound-toggle').getAttribute('aria-pressed')"),'false');
 await input('#location-search','zzzz-no-match');
 assert.equal(await evaluate("document.querySelectorAll('.location-item').length"),0);
 assert.match(await evaluate("document.getElementById('location-list').textContent"),/Không tìm thấy/);
 await input('#location-search','van quan');
 assert.ok(await evaluate("document.querySelectorAll('.location-item').length>0"));
 await click('.location-item');
 assert.equal(await evaluate("document.getElementById('location-detail').hidden"),false);
 await input('#location-search','Nguyễn Trãi, Hà Đông');
 assert.ok(await evaluate("document.querySelectorAll('.location-item').length>0"));
 await input('#location-search','');
 await input('#scenario-rain','0');
 await until("document.getElementById('kpi-risk').textContent.trim()==='0 điểm'",'zero rain scenario');
 assert.match(await evaluate("document.getElementById('location-detail').textContent"),/0–0 cm/);
 await input('#scenario-rain','65');
 await until("parseInt(document.getElementById('kpi-risk').textContent)>0",'high rain scenario');
 await input('#scenario-horizon','+2h','change');
 await until("document.getElementById('hud-alert-msg').textContent.includes('+2h')",'HUD uses selected horizon');
 assert.equal(await evaluate("parseInt(document.getElementById('hud-risk-val').textContent.replace(/[^0-9]/g,''))"),await evaluate("parseInt(document.getElementById('kpi-risk').textContent)"));
 await evaluate("document.getElementById('gis-map-section').scrollIntoView({behavior:'instant'})");
 assert.equal(await evaluate("(()=>{const hud=document.getElementById('map-alert-hud').getBoundingClientRect(),zoom=document.querySelector('.leaflet-control-zoom').getBoundingClientRect();return hud.left>=zoom.right||hud.top>=zoom.bottom||hud.bottom<=zoom.top||hud.right<=zoom.left;})()"),true);
 await shot('desktop-map.png');
 await click('[data-hours="6"]');
 assert.equal(await evaluate("document.querySelectorAll('.rain-chart .chart-col').length"),6);
 await click('#open-report');
 assert.equal(await evaluate("document.getElementById('report-dialog').open"),true);
 await input('#rep-name','Kiểm thử trình duyệt');
 await input('#rep-location','Địa điểm thử nghiệm');
 await input('#rep-description','<img src=x onerror=alert(1)>');
 await evaluate("document.getElementById('report-form').requestSubmit()");
 await until("document.getElementById('kpi-reports').textContent==='1'",'report saved');
 assert.equal(await evaluate("document.querySelector('.report-content p').textContent"),'<img src=x onerror=alert(1)>');
 assert.equal(await evaluate("document.querySelector('.report-content img')"),null);
 const report=await evaluate("JSON.parse(localStorage.getItem('hadong-community-reports'))[0]");
 assert.equal(report.status,'unverified');assert.equal(report.coordinates,null);
 await command('Page.reload');
 await until("document.getElementById('kpi-reports')?.textContent==='1' && !document.getElementById('refresh-btn')?.disabled",'state restored');
 assert.equal(await evaluate("document.getElementById('scenario-rain').value"),'65');
 assert.equal(await evaluate("document.getElementById('ai-auto-toggle').getAttribute('aria-pressed')"),'false');
 assert.match(await evaluate("document.getElementById('ai-auto-toggle').textContent"),/Thủ công/);
 assert.equal(await evaluate("document.querySelectorAll('.rain-chart .chart-col').length"),6);
 weatherFails=true;await click('#refresh-btn');
 await until("!document.getElementById('refresh-btn').disabled",'failed weather refresh');
 assert.match(await evaluate("document.getElementById('weather-status').textContent"),/Cập nhật thất bại/);
 assert.equal(await evaluate("document.getElementById('retry-weather').hidden"),false);
 assert.equal(await evaluate("document.getElementById('use-weather-btn').disabled"),true);
 await click('#ai-auto-toggle');
 await until("!document.getElementById('refresh-btn').disabled",'automatic mode with failed weather');
 assert.equal(await evaluate("document.getElementById('scenario-rain').value"),'65');
 assert.match(await evaluate("document.getElementById('auto-mode-status').textContent"),/Cập nhật thất bại/);
 await click('#ai-auto-toggle');
 await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await evaluate('window.scrollTo(0,0)');
 assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
 await until("document.getElementById('sidebar').getBoundingClientRect().right<=0",'mobile sidebar settled');
 await shot('mobile.png');
 await evaluate("document.getElementById('gis-map-section').scrollIntoView({behavior:'instant'})");
 assert.equal(await evaluate("(()=>{const hud=document.getElementById('map-alert-hud').getBoundingClientRect(),zoom=document.querySelector('.leaflet-control-zoom').getBoundingClientRect();return hud.left>=zoom.right||hud.top>=zoom.bottom||hud.bottom<=zoom.top||hud.right<=zoom.left;})()"),true);
 assert.equal(await evaluate("document.getElementById('map-alert-hud').getBoundingClientRect().right<=innerWidth"),true);
 await shot('mobile-map.png');
 await click('#menu-btn');assert.equal(await evaluate("document.getElementById('menu-btn').getAttribute('aria-expanded')"),'true');
 await click('.sidebar nav a[href="#community-section"]');assert.equal(await evaluate("document.getElementById('menu-btn').getAttribute('aria-expanded')"),'false');
 leafletFails=true;
 await command('Network.enable');await command('Network.setCacheDisabled',{cacheDisabled:true});
 await command('Page.reload',{ignoreCache:true});
 await until("!document.getElementById('refresh-btn')?.disabled && document.getElementById('kpi-sites')?.textContent!=='—'",'no CDN fallback');
 assert.match(await evaluate("document.getElementById('map').textContent"),/Chưa tải được bản đồ/);
 assert.equal(await evaluate("document.querySelectorAll('.rain-chart .chart-col').length"),0);
 assert.ok(await evaluate("document.querySelectorAll('.location-item').length>0"));
 assert.equal(await evaluate("document.getElementById('kpi-reports').textContent"),'1');
 await click('#open-report');
 await input('#rep-name','Nháp đang nhập');
 await input('#rep-location','Bản nháp Văn Quán');
 await command('Page.reload',{ignoreCache:true});
 await until("document.getElementById('rep-name')?.value==='Nháp đang nhập' && !document.getElementById('refresh-btn')?.disabled",'draft recovered');
 await click('#open-report');
 assert.match(await evaluate("document.getElementById('draft-status').textContent"),/khôi phục/);
 await click('#clear-draft');
 assert.equal(await evaluate("document.getElementById('rep-name').value"),'');
 await click('#cancel-report');
 const backupPath=fileURLToPath(new URL('report-backup-test.json',output));
 await fs.writeFile(backupPath,JSON.stringify({reports:[{...report,id:'rep-import-smoke',location_name:'Bản sao lưu kiểm thử',status:'verified'}]}));
 const doc=await command('DOM.getDocument');
 const inputNode=await command('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'#import-reports-file'});
 await command('DOM.setFileInputFiles',{nodeId:inputNode.nodeId,files:[backupPath]});
 await until("document.getElementById('kpi-reports').textContent==='2'",'backup imported through file input');
 assert.equal(await evaluate("JSON.parse(localStorage.getItem('hadong-community-reports'))[0].status"),'unverified');
 await command('DOM.setFileInputFiles',{nodeId:inputNode.nodeId,files:[backupPath]});
 await until("document.getElementById('toast').textContent.includes('không có báo cáo mới')",'duplicate backup handled');
 assert.equal(await evaluate("document.getElementById('kpi-reports').textContent"),'2');
 assert.deepEqual(exceptions,[]);
 assert.deepEqual(failures,[]);
 console.log('Browser checks passed: desktop/mobile, map controls, automatic/manual rain and reload, peak selection, stale-weather handling, horizon-consistent alerts, sound toggles, search, weather windows, report persistence, drafts, backup import/deduplication, XSS escaping and missing Leaflet.');
 console.log('Screenshots: artifacts/desktop.png and artifacts/mobile.png. Weather used a deterministic fixture; real network is not verified by this test.');
}finally{
 try{if(ws?.readyState===1)await command('Browser.close');}catch{}
 ws?.close();chrome?.kill();
 server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 // Only remove the exact temporary profile created by this test.
 const resolved=path.resolve(profile);
 if(path.dirname(resolved)===path.resolve(tmpdir())&&path.basename(resolved).startsWith('hadong-browser-')){
   try{await fs.rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:100});}catch{console.log('Temporary browser profile retained at '+resolved);}
 }
}
