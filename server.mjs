import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWeatherCache } from './weather-cache.mjs';
import { loadGisData, loadReports, saveReport, getAiForecast, getEarlyAlerts, getDashboardData, getTimelineSimulation, searchLocationRisk, getAvoidanceRoutes, getActionableSolutions } from './flood-engine.mjs';
import * as _appUtils from './app-utils.js';
const root=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.geojson':'application/geo+json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const getWeather=createWeatherCache();
const server=http.createServer(async(req,res)=>{
  const sendJson=(data,code=200)=>{
    res.writeHead(code,{'Content-Type':types['.json'],'X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:JSON.stringify(data));
  };
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/api/')){
      const isReport=url.pathname==='/api/community-reports';
      if(!['GET','HEAD'].includes(req.method)&&!(isReport&&req.method==='POST')){
        res.setHeader('Allow',isReport?'GET, HEAD, POST':'GET, HEAD');
        return sendJson({error:'Phương thức không được hỗ trợ.'},405);
      }
      const rainParam=url.searchParams.get('rain');
      const rain=rainParam===null?35:Number(rainParam);
      if(rainParam!==null&&(!rainParam.trim()||!Number.isFinite(rain)||rain<0||rain>200))return sendJson({error:'Lượng mưa phải nằm trong khoảng 0–200 mm/h.'},400);
      const simulated=data=>({...data,data_mode:'simulation',validated:false});
      switch(url.pathname){
        case '/api/health':return sendJson({app:'hadong-flood-lab',version:2});
        case '/api/weather':return sendJson(await getWeather());
        case '/api/flood-data':return sendJson({...loadGisData(),data_mode:'reference'});
        case '/api/ai-forecast':{
          const horizon=url.searchParams.get('horizon')||'+1h';
          if(!['+30m','+1h','+2h','+3h'].includes(horizon))return sendJson({error:'Khoảng mô phỏng không hợp lệ.'},400);
          const forecast=getAiForecast(horizon,rain);
          forecast.average_confidence_pct=null;
          forecast.top_hotspot.confidence_pct=null;
          forecast.predictions.forEach(p=>{p.confidence_pct=null;});
          return sendJson(simulated(forecast));
        }
        case '/api/dashboard':return sendJson(simulated(getDashboardData(rain)));
        case '/api/alerts':return sendJson(simulated(getEarlyAlerts(rain)));
        case '/api/timeline':return sendJson(simulated(getTimelineSimulation()));
        case '/api/search':{
          const q=(url.searchParams.get('q')||'').trim();
          if(q.length<2||q.length>160)return sendJson({error:'Nhập tên địa điểm từ 2 đến 160 ký tự.'},400);
          const horizon=url.searchParams.get('horizon')||'+1h';
          if(!['+30m','+1h','+2h','+3h'].includes(horizon))return sendJson({error:'Khoảng mô phỏng không hợp lệ.'},400);
          const result=searchLocationRisk(q,rain,horizon);
          if(!result)return sendJson({error:'Không tìm thấy địa điểm.'},404);
          return sendJson(simulated({...result,confidence_pct:null}));
        }
        case '/api/routing':{
          const from=url.searchParams.get('from')||'Bệnh viện 103',to=url.searchParams.get('to')||'KĐT Văn Phú';
          if(!/103/.test(from)||!/văn phú|van phu/i.test(to))return sendJson({error:'Chỉ có tuyến mẫu Bệnh viện 103 → KĐT Văn Phú.'},422);
          return sendJson(simulated(getAvoidanceRoutes(from,to)));
        }
        case '/api/solutions':return sendJson({items:getActionableSolutions(),data_mode:'simulation',validated:false});
        case '/api/community-reports':{
          if(req.method!=='POST')return sendJson(loadReports().map(r=>({...r,status:'unverified',votes:0})));
          if(req.headers.origin&&req.headers.origin!==new URL(req.url,'http://'+req.headers.host).origin)return sendJson({error:'Nguồn gửi không được hỗ trợ.'},403);
          if(!(req.headers['content-type']||'').startsWith('application/json'))return sendJson({error:'Nội dung phải là JSON.'},415);
          const max=2*1024*1024;
          if(Number(req.headers['content-length'])>max)return sendJson({error:'Báo cáo quá lớn.'},413);
          let size=0;const chunks=[];
          for await(const chunk of req){
            size+=chunk.length;
            if(size>max){sendJson({error:'Báo cáo quá lớn.'},413);return;}
            chunks.push(chunk);
          }
          let report;
          try{report=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
          catch{return sendJson({error:'JSON không hợp lệ.'},400);}
          try{return sendJson({success:true,report:saveReport(report)},201);}
          catch(error){return sendJson({error:error.code?'Không lưu được báo cáo.':error.message},error.code?500:400);}
        }
        default:return sendJson({error:'Không tìm thấy API.'},404);
      }
    }
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return sendJson({error:'Phương thức không được hỗ trợ.'},405);}
    let name;
    try{name=decodeURIComponent(url.pathname);}catch{return sendJson({error:'Đường dẫn không hợp lệ.'},400);}
    if(name==='/')name='/index.html';
    const data=name.startsWith('/data/'),base=path.join(root,data?'data':'public');
    let target=path.resolve(base,'.'+(data?name.slice(5):name));
const APP_UTILS_SOURCE = `export function normalizeSearch(value = '') {
  return String(value).toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
}
export function matchLocation(predictions, query) {
  const full = normalizeSearch(query);
  const q = full.replace(/\\bha dong\\b/g, '').trim() || full;
  if (q.length < 2) return null;
  return predictions.map(site => {
    const fields = [site.name, site.street, site.ward].map(normalizeSearch).filter(Boolean);
    return { site, score: Math.max(0, ...fields.map(f => f === q ? 100 : f.includes(q) ? 80 : q.includes(f) && f.length >= 5 ? 60 : 0)) };
  }).filter(x => x.score > 0).sort((a,b) => b.score-a.score)[0]?.site || null;
}
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
export function safePhoto(value) {
  return typeof value === 'string' && /^data:image\\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 1500000 ? value : '';
}
export function validateReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('Báo cáo không hợp lệ.');
  const text = (key, max, required = false) => {
    const value = typeof report[key] === 'string' ? report[key].trim() : '';
    if ((required && !value) || value.length > max) throw new Error('Kiểm tra tên, vị trí và độ dài mô tả.');
    return value;
  };
  const reporter_name = text('reporter_name',80,true), location_name = text('location_name',160,true), description = text('description',1500);
  const coordinates = report.coordinates ?? null;
  if (coordinates !== null && (!Array.isArray(coordinates) || coordinates.length !== 2 || !coordinates.every(Number.isFinite) || Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90)) throw new Error('Tọa độ không hợp lệ.');
  if (!['very_low','low','medium','high','very_high','critical'].includes(report.depth_level)) throw new Error('Chọn mức độ ngập.');
  if (typeof report.depth_cm !== 'number' || !Number.isFinite(report.depth_cm) || report.depth_cm < 0 || report.depth_cm > 500) throw new Error('Độ sâu không hợp lệ.');
  if (report.photo_url && !safePhoto(report.photo_url)) throw new Error('Ảnh phải là PNG, JPEG hoặc WebP và không quá 1 MB.');
  return {reporter_name,location_name,description,coordinates,depth_level:report.depth_level,depth_cm:report.depth_cm,photo_url:safePhoto(report.photo_url)};
}
export function summarizeRain(rows) {
  const valid = rows.filter(r => typeof r.rain === 'number' && Number.isFinite(r.rain) && r.rain >= 0);
  const complete = rows.length > 0 && valid.length === rows.length;
  return { complete, count: valid.length, total: complete ? valid.reduce((sum,r)=>sum+r.rain,0) : null, peak: valid.length ? valid.reduce((a,b)=>a.rain >= b.rain ? a : b) : null };
}
export function mergeReportBackup(existing, payload) {
  if (!payload || !Array.isArray(payload.reports) || payload.reports.length > 1000) throw new Error('Chọn tệp JSON được xuất từ nhật ký báo ngập (tối đa 1.000 báo cáo).');
  const known = new Set(existing.map(r => r.id));
  const added = [];
  for (const report of payload.reports) {
    const validated = validateReport(report);
    if (typeof report.id !== 'string' || !/^rep-[a-zA-Z0-9-]{1,100}$/.test(report.id) || typeof report.reported_at !== 'string' || !Number.isFinite(Date.parse(report.reported_at))) throw new Error('Bản sao lưu có mã hoặc thời gian báo cáo không hợp lệ.');
    if (known.has(report.id)) continue;
    added.push({...validated,id:report.id,reported_at:report.reported_at,status:'unverified',votes:0});
    known.add(report.id);
  }
  return {reports:[...added,...existing],added:added.length};
}
export function scenarioAlert(forecast, rain) {
  const high = forecast.predictions.filter(site => ['high', 'very_high'].includes(site.risk_level));
  const veryHigh = high.filter(site => site.risk_level === 'very_high');
  const level = veryHigh.length >= 2 || high.length >= 6 || rain >= 50 ? 'danger'
    : high.length >= 3 || rain >= 30 ? 'warning' : high.length || rain >= 15 ? 'advisory' : 'normal';
  return {level, affected_count: high.length,
    banner: 'Kịch bản ' + rain + ' mm/h · ' + forecast.horizon + ': ' + high.length + ' điểm nguy cơ cao, trong đó ' + veryHigh.length + ' điểm rất cao. Mô phỏng chưa kiểm định.'};
}`;
    let content;
    try {
      if(!target.startsWith(base+path.sep))return sendJson({error:'Không được truy cập.'},403);
      content=await readFile(target);
    } catch {
      if(name==='/app-utils.js'){
        content=APP_UTILS_SOURCE;
      }else{
        const altBase=data?path.join(root,'public','data'):root;
        const altTarget=path.resolve(altBase,'.'+(data?name.slice(5):name));
        if(altTarget.startsWith(altBase+path.sep)){
          try{content=await readFile(altTarget);}
          catch{return sendJson({error:'Không tìm thấy tài nguyên.'},404);}
        }else{return sendJson({error:'Không tìm thấy tài nguyên.'},404);}
      }
    }
    res.writeHead(200,{'Content-Type':types[path.extname(name)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
    res.end(req.method==='HEAD'?undefined:content);
  }catch(error){
    if(res.headersSent){res.end();return;}
    const api=req.url.startsWith('/api/');
    sendJson({error:api?'Dịch vụ dữ liệu chưa phản hồi. Vui lòng thử lại.':'Không tìm thấy tài nguyên.'},api?502:404);
  }
});
server.requestTimeout=30000;
server.headersTimeout=15000;
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=process.env.PORT===undefined?3000:Number(process.env.PORT);
  const host=process.env.HOST||'127.0.0.1';
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'Cổng đang được sử dụng. Hãy mở web đang chạy hoặc đổi PORT.':error.message);process.exitCode=1;});
  server.listen(port,host,()=>console.log('Hà Đông Flood Lab: http://'+host+':'+server.address().port));
}
export default server;
