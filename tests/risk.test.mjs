import test from 'node:test';
import assert from 'node:assert/strict';
import {assess,windowRain,futureHours} from '../public/risk.js';
test('missing rainfall never becomes a low risk score',()=>{
  for(const x of [null,undefined,NaN,-1,Infinity,'10'])assert.equal(assess(x,30).level,'unknown');
  assert.equal(windowRain([2,null,5],2),null);
  assert.equal(windowRain([2,3],1),null);
});
test('rolling rain includes final hour without future leakage',()=>{
  assert.equal(windowRain([1,2,3,100],2),6);
});
test('scenario monotonicity and saturation',()=>{
  assert.equal(assess(0,0).score,0);
  assert.equal(assess(100,250).score,100);
  assert.equal(assess(25,60).level,'medium');
  let prev=-1;for(let rain=0;rain<=100;rain++){const next=assess(rain,rain*3).score;assert.ok(next>=prev);prev=next;}
});
test('future windows interpreted in UTC+7 regardless of server timezone',()=>{
  const data={hourly:{time:['2026-09-16T07:00','2026-09-16T08:00','2026-09-16T09:00'],precipitation:[1,2,3]}};
  const result=futureHours(data,Date.parse('2026-09-16T00:30:00Z'));
  assert.equal(result.length,2);assert.equal(result[0].time,'2026-09-16T08:00');assert.equal(result[1].rain3h,6);
});

test('invalid rainfall remains missing in forecast display',()=>{const data={hourly:{time:['2026-09-16T09:00'],precipitation:[-1]}};assert.equal(futureHours(data,Date.parse('2026-09-16T00:00:00Z'))[0].rain,null);});
