export function createWeatherCache(fetcher=fetch,now=Date.now) {
  let cached,pending;
  return async function getWeather() {
    if(cached&&now()-cached.time<900000)return cached.data;
    if(!pending)pending=(async()=>{
      const response=await fetcher('https://api.open-meteo.com/v1/forecast?latitude=20.9708&longitude=105.7788&hourly=precipitation,precipitation_probability,temperature_2m&past_days=1&forecast_days=3&timezone=Asia%2FBangkok',{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Weather provider unavailable');
      const data=await response.json();
      if(!Array.isArray(data.hourly?.time)||data.hourly.time.length<24||!Array.isArray(data.hourly.precipitation)||data.hourly.time.length!==data.hourly.precipitation.length)throw new Error('Invalid weather response');
      const time=now();cached={time,data:{...data,retrieved_at:new Date(time).toISOString(),source:'Open-Meteo forecast'}};return cached.data;
    })().finally(()=>{pending=undefined;});
    return pending;
  };
}
