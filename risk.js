// Experimental scenario index. These thresholds have NOT been calibrated locally.
export function assess(rain1h,rain3h) {
  if (![rain1h,rain3h].every(x=>typeof x==='number' && Number.isFinite(x) && x>=0)) return {level:'unknown',label:'Thiếu dữ liệu',score:null};
  const score=Math.min(100,Math.round(60*Math.min(rain1h/50,1)+40*Math.min(rain3h/100,1)));
  return {score,...(score>=70?{level:'high',label:'Cao'}:score>=35?{level:'medium',label:'Trung bình'}:{level:'low',label:'Thấp'})};
}
export function windowRain(values,index,length=3) {
  if(index<length-1) return null;
  const items=values.slice(index-length+1,index+1);
  return items.length===length && items.every(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0) ? items.reduce((a,b)=>a+b,0):null;
}
export function futureHours(data,now=Date.now()) {
  const h=data?.hourly;
  if(!Array.isArray(h?.time)||!Array.isArray(h?.precipitation)) throw new Error('Dữ liệu mưa không hợp lệ');
  return h.time.map((t,i)=>({time:t,rain:typeof h.precipitation[i]==="number"&&Number.isFinite(h.precipitation[i])&&h.precipitation[i]>=0?h.precipitation[i]:null,rain3h:windowRain(h.precipitation,i)})).filter(x=>new Date(x.time+'+07:00').getTime()>=now).slice(0,24);
}
