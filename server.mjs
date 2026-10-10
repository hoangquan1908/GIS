import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWeatherCache } from './weather-cache.mjs';
import { loadGisData, loadReports, saveReport, getAiForecast, getEarlyAlerts, getDashboardData, getTimelineSimulation, searchLocationRisk, getAvoidanceRoutes, getActionableSolutions } from './flood-engine.mjs';
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
    const target=path.resolve(base,'.'+(data?name.slice(5):name));
    if(!target.startsWith(base+path.sep))return sendJson({error:'Không được truy cập.'},403);
    const content=await readFile(target);
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});
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
