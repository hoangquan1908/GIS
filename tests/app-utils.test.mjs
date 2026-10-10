import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSearch,matchLocation,escapeHtml,safePhoto,validateReport,summarizeRain} from '../public/app-utils.js';
test('Vietnamese searches normalize accents, đ, whitespace and punctuation',()=>{
 assert.equal(normalizeSearch(' Đường NGUYỄN TRÃI, Hà Đông '),'duong nguyen trai ha dong');
 const sites=[{name:'Nguyễn Trãi',street:'',ward:'Hà Đông'},{name:'Đường Văn Quán',street:'Nguyễn Khuyến'}];
 assert.equal(matchLocation(sites,'nguyen trai, ha dong'),sites[0]);
 assert.equal(matchLocation(sites,'duong van quan'),sites[1]);
 assert.equal(matchLocation(sites,'unknown street'),null);
 assert.equal(matchLocation(sites,' '),null);
});
test('user content is escaped and untrusted photo URLs rejected',()=>{
 assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
 assert.equal(safePhoto('javascript:alert(1)'),'');
 assert.equal(safePhoto('https://example.com/private.jpg'),'');
 assert.equal(safePhoto('data:image/svg+xml;base64,PHN2Zz4='),'');
 assert.equal(safePhoto('data:image/png;base64,aGVsbG8='),'data:image/png;base64,aGVsbG8=');
});
const valid={reporter_name:'Người ghi nhận',location_name:'Văn Quán',depth_level:'medium',depth_cm:25};
test('report validation preserves missing coordinates and zero depth',()=>{
 assert.equal(validateReport({...valid,depth_cm:0}).depth_cm,0);
 assert.equal(validateReport(valid).coordinates,null);
 for(const input of [null,{}, {...valid,reporter_name:''},{...valid,coordinates:[181,20]},{...valid,coordinates:['105',20]},{...valid,depth_cm:NaN},{...valid,depth_level:'verified'},{...valid,description:'a'.repeat(1501)}])assert.throws(()=>validateReport(input));
});
test('missing precipitation is not silently summed as zero',()=>{
 assert.equal(summarizeRain([{rain:1},{rain:null}]).total,null);
 assert.equal(summarizeRain([]).total,null);
 assert.equal(summarizeRain([{rain:0},{rain:0}]).total,0);
 assert.equal(summarizeRain([{rain:1},{rain:2.5}]).total,3.5);
 assert.equal(summarizeRain([{rain:-1}]).complete,false);
});


test('scenario alerts use the selected forecast without claiming live observations', async () => {
  const {scenarioAlert} = await import('../public/app-utils.js');
  const dry=scenarioAlert({horizon:'+30m',predictions:[{risk_level:'low'}]},0);
  assert.equal(dry.level,'normal');assert.equal(dry.affected_count,0);
  assert.match(dry.banner,/Mô phỏng chưa kiểm định/);
  const wet=scenarioAlert({horizon:'+3h',predictions:[{risk_level:'high'},{risk_level:'very_high'},{risk_level:'very_high'},{risk_level:'medium'}]},35);
  assert.equal(wet.level,'danger');assert.equal(wet.affected_count,3);
  assert.match(wet.banner,/\+3h/);
});
