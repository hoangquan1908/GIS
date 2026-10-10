import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {inspectHistory} from './history-quality.mjs';
const root=new URL('../data/history/',import.meta.url);
await mkdir(root,{recursive:true});
const reports=[];
for(let year=2020;year<=2025;year++){
  const url='https://archive-api.open-meteo.com/v1/archive?latitude=20.9708&longitude=105.7788&start_date='+year+'-01-01&end_date='+year+'-12-31&hourly=precipitation,temperature_2m,relative_humidity_2m,surface_pressure&models=era5&timezone=Asia%2FBangkok';
  const target=new URL('era5-'+year+'.json',root);
  let data;
  try{data=JSON.parse(await readFile(target,'utf8'));if(data.request_url!==url||!inspectHistory(data,year).pass)data=null;}catch{}
  if(!data){
    const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw Error('Download '+year+': HTTP '+response.status);
    data={...await response.json(),retrieved_at:new Date().toISOString(),request_url:url,provider:'Open-Meteo / ECMWF ERA5',model:'era5',data_kind:'reanalysis_not_station_observation',requested_location:{latitude:20.9708,longitude:105.7788},spatial_resolution:'ERA5 native grid 0.25 degrees, approximately 25 km; API coordinates are not proof of street-level resolution',license:'CC BY 4.0'};
    const check=inspectHistory(data,year);if(!check.pass)throw Error(JSON.stringify(check));
    await writeFile(new URL('era5-'+year+'.tmp',root),JSON.stringify(data));
    await rename(new URL('era5-'+year+'.tmp',root),target);
  }
  const raw=await readFile(target);
  reports.push({...inspectHistory(data,year),file:'history/era5-'+year+'.json',sha256:createHash('sha256').update(raw).digest('hex'),request_url:url});
  console.log(year+': '+reports.at(-1).rows+' records validated');
}
const report={schema_version:1,generated_at:new Date().toISOString(),dataset:'ERA5 hourly, one representative grid location near Ha Dong',grain:'one modelled hour at one requested location',period:'2020-01-01 / 2025-12-31',total_rows:reports.reduce((s,r)=>s+r.rows,0),pass:reports.every(r=>r.pass),years:reports,flood_labels:0,verified_flood_sites:0,official_boundary_available:false,fitness:{retrospective_rainfall_benchmark:true,street_level_flood_prediction:false,operational_early_warning:false},limitations:['Reanalysis, not local station observations','Coarse 0.25 degree grid cannot resolve street-level rainfall','No verified flood labels, drainage network or official ward boundary','Completeness does not demonstrate accuracy against ground observations']};
await writeFile(new URL('../data-quality.json',root),JSON.stringify(report,null,2));
