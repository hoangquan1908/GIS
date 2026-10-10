import test from 'node:test';
import assert from 'node:assert/strict';
import {createWeatherCache} from '../weather-cache.mjs';
const payload={hourly:{time:Array.from({length:24},(_,i)=>String(i)),precipitation:Array(24).fill(0)}};
test('concurrent visitors share one upstream request; cache expires',async()=>{
let calls=0,time=0;const get=createWeatherCache(async()=>{calls++;await new Promise(r=>setTimeout(r,10));return {ok:true,json:async()=>payload};},()=>time);
await Promise.all(Array.from({length:20},()=>get()));assert.equal(calls,1);await get();assert.equal(calls,1);time=900001;await get();assert.equal(calls,2);
});
test('provider failure does not poison retries or fabricate data',async()=>{
let calls=0;const get=createWeatherCache(async()=>{calls++;if(calls===1)throw Error('offline');return {ok:true,json:async()=>payload};});
await assert.rejects(get());assert.equal((await get()).hourly.precipitation[0],0);assert.equal(calls,2);
});
test('incomplete provider arrays rejected',async()=>{const get=createWeatherCache(async()=>({ok:true,json:async()=>({hourly:{time:payload.hourly.time,precipitation:[0]}})}));await assert.rejects(get(),/Invalid/);});
