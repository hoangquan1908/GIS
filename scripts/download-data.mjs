import { mkdir,writeFile } from 'node:fs/promises';
const root=new URL('../data/',import.meta.url);
await mkdir(root,{recursive:true});
const datasets=[
 ['weather-forecast.json','https://api.open-meteo.com/v1/forecast?latitude=20.9708&longitude=105.7788&hourly=precipitation,precipitation_probability,temperature_2m&past_days=1&forecast_days=3&timezone=Asia%2FBangkok'],
 ['rainfall-history-2025.json','https://archive-api.open-meteo.com/v1/archive?latitude=20.9708&longitude=105.7788&start_date=2025-01-01&end_date=2025-12-31&hourly=precipitation,temperature_2m&models=era5&timezone=Asia%2FBangkok']
];
let failed=false;
for(const [name,url] of datasets){
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const data=await response.json();
    if(!data.hourly?.time?.length)throw Error('Missing hourly data');
    await writeFile(new URL(name,root),JSON.stringify({retrieved_at:new Date().toISOString(),request_url:url,data_kind:name.includes('history')?'ERA5 reanalysis, NOT station observations':'Weather forecast, NOT observations',...data},null,2));
    console.log(`${name}: ${data.hourly.time.length} hourly records downloaded`);
  }catch(e){failed=true;console.error(`${name}: ${e.message}`);}
}
if(failed)process.exitCode=1;
