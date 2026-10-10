export function inspectHistory(data,year) {
  const h=data.hourly,errors=[];
  const variables=['precipitation','temperature_2m','relative_humidity_2m','surface_pressure'];
  const start=Date.parse(year+'-01-01T00:00:00+07:00'),end=Date.parse((year+1)+'-01-01T00:00:00+07:00');
  const expected=(end-start)/3600000;
  if(!h||!Array.isArray(h.time))return {year,pass:false,errors:['Missing hourly time'],rows:0,expected_rows:expected};
  if(data.utc_offset_seconds!==25200)errors.push('UTC offset must be +07:00');
  if(h.time.length!==expected)errors.push('Incorrect annual row count');
  if(new Set(h.time).size!==h.time.length)errors.push('Duplicate timestamps');
  if(h.time.some((t,i)=>Date.parse(t+'+07:00')!==start+i*3600000))errors.push('Timestamp gap, ordering or annual boundary mismatch');
  const units={precipitation:'mm',temperature_2m:'°C',relative_humidity_2m:'%',surface_pressure:'hPa'};
  const profiles={};
  for(const v of variables){
    const values=h[v];
    if(!Array.isArray(values)||values.length!==h.time.length){errors.push(v+': length mismatch');continue;}
    if(data.hourly_units?.[v]!==units[v])errors.push(v+': unexpected units');
    const valid=values.filter(x=>typeof x==='number'&&Number.isFinite(x));
    const invalid=values.length-valid.length;
    if(invalid)errors.push(v+': missing or non-finite values');
    const outside=valid.filter(x=>v==='precipitation'?x<0:v==='relative_humidity_2m'?x<0||x>100:v==='temperature_2m'?x< -80||x>65:x<300||x>1100).length;
    if(outside)errors.push(v+': values outside broad physical range');
    profiles[v]={missing:invalid,out_of_range:outside,min:valid.length?Math.min(...valid):null,max:valid.length?Math.max(...valid):null};
  }
  const rain=h.precipitation||[];
  const numeric=rain.filter(x=>typeof x==='number'&&Number.isFinite(x));
  return {year,pass:errors.length===0,errors,rows:h.time.length,expected_rows:expected,profiles,
    annual_rain_mm:numeric.length===expected?Number(numeric.reduce((s,x)=>s+x,0).toFixed(2)):null,
    wet_hours:numeric.filter(x=>x>0).length,source_grid:{latitude:data.latitude,longitude:data.longitude},retrieved_at:data.retrieved_at};
}
