import { loadGisData, loadReports, saveReport, importReports, fetchWeatherDirect, getAiForecast, getTimelineSimulation, getAvoidanceRoutes, getAiRain24hAnalysis, getActionableSolutions, getDepthLabel, weatherCondition, ROUTE_PRESETS, RISK_COLORS, RISK_LABELS } from './flood-engine.js';
import { normalizeSearch, matchLocation, escapeHtml as esc, safePhoto, summarizeRain, scenarioAlert } from './app-utils.js';
import { futureHours } from './risk.js';
const $ = id => document.getElementById(id);
const state = { rain:35, horizon:'+1h', hours:24, risk:'all', query:'', forecast:null, weather:null, weatherFailed:false, reports:[], timeline:null, selected:null, coords:null, photo:'', picking:false, refresh:null, aiAuto:true, soundEnabled:false, alertData:null };
let map, userMarker, reportMarker, selectedPopup, timelineTimer, toastTimer, scenarioVersion=0, photoVersion=0;
const layers = {};
const WEATHER_REFRESH_MS = 15 * 60 * 1000;
function playAlertChime() {
  if (!state.soundEnabled) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.35);
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); ctx.close().catch(()=>{}); };
    osc.start(); osc.stop(ctx.currentTime + 0.35);
  } catch {}
}
function updateMapAlertHud() {
  const hud = $('map-alert-hud');
  if (!hud || !state.forecast) return;
  try {
    const alert = scenarioAlert(state.forecast, state.rain);
    const previousLevel = state.alertData?.level;
    state.alertData = alert;
    hud.className = 'map-alert-hud ' + (alert.level === 'danger' ? 'danger' : alert.level === 'warning' ? 'warning' : '');
    const badge = $('hud-alert-level');
    if (badge) {
      badge.className = 'hud-level level-' + alert.level;
      badge.textContent = alert.level === 'danger' ? '🔴 NGUY HIỂM' : alert.level === 'warning' ? '🟠 CẢNH BÁO' : alert.level === 'advisory' ? '🟡 CHÚ Ý' : '🟢 THẤP';
    }
    const msg = $('hud-alert-msg');
    if (msg) msg.textContent = alert.banner;
    const rainVal = $('hud-rain-val');
    if (rainVal) rainVal.innerHTML = '🌧️ Mưa: <b>' + state.rain.toFixed(1) + ' mm/h</b>';
    const riskVal = $('hud-risk-val');
    if (riskVal) riskVal.innerHTML = '⚡ <b>' + alert.affected_count + ' điểm nguy cơ</b>';
    const focusBtn = $('hud-focus-top');
    if (focusBtn) {
      if (alert.affected_count > 0 && state.forecast?.top_hotspot) {
        focusBtn.hidden = false;
        focusBtn.textContent = 'Xem ' + state.forecast.top_hotspot.name + ' ↗';
        focusBtn.onclick = () => {
          const topSite = state.forecast?.predictions?.find(s => s.name === state.forecast.top_hotspot.name);
          if (topSite) focusSite(topSite);
        };
      } else {
        focusBtn.hidden = true;
      }
    }
    if (alert.level !== previousLevel && (alert.level === 'danger' || alert.level === 'warning')) playAlertChime();
  } catch {}
}
function updateEarlyWarnings() {
  const fc = state.forecast;
  if (!fc) return;
  const alert = scenarioAlert(fc, state.rain);
  const card = document.getElementById('early-warning-section');
  const badge = $('ew-level-badge');
  const banner = $('ew-banner');
  const list = $('ew-warnings-list');
  if (!card || !badge || !banner || !list) return;
  // Update card border class
  card.className = 'section-block card early-warning-card' + (alert.level === 'danger' ? ' level-danger' : alert.level === 'warning' ? ' level-warning' : '');
  // Badge
  const badgeMap = { normal: '🟢 BÌNH THƯỜNG', advisory: '🟡 CHÚ Ý', warning: '🟠 CẢNH BÁO', danger: '🔴 NGUY HIỂM' };
  badge.textContent = badgeMap[alert.level] || '🟢 BÌNH THƯỜNG';
  badge.className = 'ew-badge level-' + alert.level;
  // Banner
  banner.textContent = alert.banner;
  banner.className = 'ew-banner-text' + (alert.level === 'danger' ? ' danger' : alert.level === 'warning' ? ' warning' : '');
  // Warnings list from early_warnings
  const warnings = fc.early_warnings || [];
  if (!warnings.length) {
    list.innerHTML = '<div class="empty-state"><span class="empty-icon">✅</span><strong>Chưa có điểm nguy cơ ngập sớm</strong><span>Kịch bản mưa hiện tại chưa vượt ngưỡng cảnh báo tại các điểm tham chiếu.</span></div>';
    return;
  }
  list.innerHTML = warnings.map(w => `
    <div class="ew-warning-item risk-${w.risk_level}">
      <span class="ew-warn-icon">${w.depth_icon || '⚠️'}</span>
      <div class="ew-warn-body">
        <div class="ew-warn-name">${esc(w.name)}</div>
        <div class="ew-warn-district">${esc(w.district || '')}</div>
        <div class="ew-warn-depth">${esc(w.depth_label || '')}</div>
      </div>
      <span class="ew-warn-time">~${w.start_offset_min} phút<br>(${esc(w.start_time)})</span>
    </div>
  `).join('');
}
function renderRainLayer() {
  if (!layers.rain || !map) return;
  layers.rain.clearLayers();
  const rain = state.rain;
  const color = rain >= 45 ? '#dc2626' : rain >= 25 ? '#ea580c' : rain >= 12 ? '#f59e0b' : '#3b82f6';
  if (rain > 0) L.polygon([
    [20.995, 105.765],
    [20.998, 105.795],
    [20.978, 105.805],
    [20.950, 105.785],
    [20.945, 105.750],
    [20.970, 105.740]
  ], {
    color,
    weight: 2,
    dashArray: '4, 8',
    interactive: false,
    fillColor: color,
    fillOpacity: Math.min(0.35, Math.max(0.06, rain / 130))
  }).addTo(layers.rain);

  const gauge = L.circleMarker([20.9708, 105.7788], {
    radius: 10,
    color: '#ffffff',
    weight: 3,
    fillColor: color,
    fillOpacity: 0.95,
    className: rain >= 25 ? 'pulsing-beacon' : ''
  }).addTo(layers.rain);
  gauge.bindPopup('<b>🌧️ Điểm đại diện dự báo Hà Đông</b><br>Mưa đầu vào kịch bản: <b style="color:' + color + '">' + rain.toFixed(1) + ' mm/h</b><br><small>Mô phỏng chưa kiểm định · Tọa độ 20.9708° N · 105.7788° E</small>');
  gauge.bindTooltip('🌧️ <b>' + rain.toFixed(1) + ' mm/h</b>', { permanent: true, direction: 'top' });
}
function notify(message, error=false) {
  clearTimeout(toastTimer); $('toast').textContent=message; $('toast').classList.toggle('error',error); $('toast').hidden=false;
  toastTimer=setTimeout(()=>{$('toast').hidden=true;},5500);
}
function empty(message, detail='') { return '<div class="empty-state"><span class="empty-icon">⌁</span><strong>'+esc(message)+'</strong><span>'+esc(detail)+'</span></div>'; }
function setPressed(selector, current, key) { document.querySelectorAll(selector).forEach(el=>{const active=el.dataset[key]===String(current);el.classList.toggle('active',active);el.setAttribute('aria-pressed',active);}); }
function persist() {
  const params=new URLSearchParams();
  params.set('rain',state.rain);params.set('horizon',state.horizon);params.set('hours',state.hours);params.set('auto',state.aiAuto?'1':'0');
  if(state.query)params.set('q',state.query);if(state.risk!=='all')params.set('risk',state.risk);
  history.replaceState(null,'',location.pathname+'?'+params+location.hash);
}
function restore() {
  const p=new URLSearchParams(location.search), rain=Number(p.get('rain'));
  if(p.has('rain')&&p.get('rain').trim()!==''&&Number.isFinite(rain)&&rain>=0&&rain<=100){state.rain=rain;state.aiAuto=false;}
  if(['0','1'].includes(p.get('auto')))state.aiAuto=p.get('auto')==='1';
  renderAutoMode();
  if(['+30m','+1h','+2h','+3h','+6h','+12h','+24h'].includes(p.get('horizon')))state.horizon=p.get('horizon');
  if([6,12,24,48,72].includes(Number(p.get('hours'))))state.hours=Number(p.get('hours'));
  if(p.get('risk')==='high')state.risk='high';
  state.query=(p.get('q')||'').slice(0,160);
  $('scenario-rain').value=state.rain;$('scenario-rain-value').value=state.rain+' mm/h';$('scenario-horizon').value=state.horizon;$('location-search').value=state.query;
  setPressed('[data-hours]',state.hours,'hours');setPressed('[data-risk]',state.risk,'risk');
}
function popup(site) {
  const warn = ['high','very_high'].includes(site.risk_level);
  const note = site.note ? '<br><em class="popup-note">📌 '+esc(site.note)+'</em>' : '';
  const solution = site.solution ? '<br><small>💡 '+esc(site.solution)+'</small>' : '';
  return '<b>'+esc(site.name)+'</b><br>'+esc(site.street||'')+'<br><b>'+(site.depth_icon||'🌊')+' '+esc(site.depth_label||site.depth_range_text)+'</b><br>Nguy cơ: '+esc(site.risk_label)+(warn?' · <span style="color:#b91c1c">CẢNH BÁO</span>':'')+'<br><small>Dự báo bắt đầu ngập: '+esc(site.start_time)+' (~'+site.start_offset_min+' ph)</small>'+note+solution+'<br><small>Mô phỏng, chưa được kiểm định.</small>';
}
function markerLabel(site) {
  const warn = ['high','very_high'].includes(site.risk_level);
  if (!warn) return esc(site.name);
  const shortNote = (site.note || site.depth_label || 'Cảnh báo ngập').slice(0, 72);
  return '<div class="flood-label"><b>'+(site.depth_icon||'⚠️')+' '+esc(site.name)+'</b><span>'+esc(shortNote)+(site.note && site.note.length > 72 ? '…' : '')+'</span></div>';
}
function scrollMap(){ $('gis-map-section').scrollIntoView({behavior:'smooth'}); }
function focusSite(site, pan=true) {
  state.selected=site.id;
  const detail=$('location-detail');detail.hidden=false;
  detail.innerHTML='<div><span class="mini-tag">Kịch bản '+state.rain+' mm/h</span><h3>'+esc(site.name)+'</h3><p>'+esc(site.street||'')+' · '+esc(site.ward||'')+'</p>'+(site.note?'<p class="detail-note">📌 '+esc(site.note)+'</p>':'')+(site.solution?'<p class="detail-solution">💡 '+esc(site.solution)+'</p>':'')+'</div><div class="detail-depth">'+(site.depth_icon||'🌊')+' '+esc(site.depth_label)+' · '+esc(site.depth_range_text)+'<small>Bắt đầu ngập khoảng '+esc(site.start_time)+' · Mô phỏng chưa kiểm định</small></div>';
  document.querySelectorAll('.location-item').forEach(btn=>btn.classList.toggle('selected',btn.dataset.id===site.id));
  if(map){const [lng,lat]=site.coordinates;if(pan)map.flyTo([lat,lng],15);if(pan||selectedPopup?.isOpen()){selectedPopup ||= L.popup();selectedPopup.setLatLng([lat,lng]).setContent(popup(site)).openOn(map);}}
  else if(pan)notify('Bản đồ chưa khả dụng. Bạn vẫn có thể xem thông tin địa điểm.');
}
function filteredSites() {
  const q=normalizeSearch(state.query);
  return (state.forecast?.predictions||[]).filter(s=>(!q||matchLocation([s],state.query))&&(state.risk==='all'||['high','very_high'].includes(s.risk_level))).sort((a,b)=>b.depth_max_cm-a.depth_max_cm);
}
function renderLocations() {
  const sites=filteredSites(), list=$('location-list');list.replaceChildren();
  $('search-status').textContent=sites.length+' / '+(state.forecast?.predictions.length||0)+' địa điểm · Kịch bản '+state.rain+' mm/h';
  if(!sites.length)list.innerHTML=empty('Không tìm thấy địa điểm','Thử tên ngắn hơn, không dấu hoặc chọn tất cả mức nguy cơ.');
  sites.forEach(site=>{
    const item=document.createElement('button');item.className='location-item';item.dataset.id=site.id;item.classList.toggle('selected',site.id===state.selected);
    item.innerHTML='<span class="location-symbol">⌖</span><span class="location-info"><b>'+esc(site.name)+'</b><small>'+(site.depth_icon ? site.depth_icon + ' ' : '')+esc(site.depth_label || site.depth_range_text)+' · '+esc(site.ward||site.street||'Hà Đông')+'</small></span><span class="risk-tag risk-'+site.risk_level+'">'+esc(site.risk_label)+'</span>';
    item.addEventListener('click',()=>focusSite(site));list.append(item);
  });
  if(layers.sites){
    layers.sites.clearLayers();
    sites.forEach(site=>{
      const [lng,lat]=site.coordinates;
      const isDangerous = site.risk_level === 'very_high' || site.risk_level === 'high';
      L.circleMarker([lat,lng],{
        radius:site.risk_level==='very_high'?10:7,
        color:'#fff',
        weight:2,
        fillColor:RISK_COLORS[site.risk_level],
        fillOpacity:.95,
        className: isDangerous ? 'pulsing-beacon' : ''
      }).bindPopup(popup(site)).bindTooltip(markerLabel(site),{
        permanent: isDangerous,
        direction: 'top',
        offset: [0, -8],
        opacity: 0.96,
        className: isDangerous ? 'flood-warn-tooltip' : 'site-name-tooltip',
        sticky: !isDangerous
      }).on('click',()=>focusSite(site)).addTo(layers.sites);
      if(isDangerous) {
        L.circle([lat,lng],{
          radius: site.risk_level==='very_high'?180:100,
          color: RISK_COLORS[site.risk_level],
          weight: 1.5,
          dashArray: '3, 6',
          fillColor: RISK_COLORS[site.risk_level],
          fillOpacity: 0.14,
          interactive: false
        }).addTo(layers.sites);
      }
    });
  }
}
let baseTileLayer = null;
const baseTileConfigs = {
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' } },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opts: { maxZoom: 19, attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community' } },
  carto: { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', opts: { maxZoom: 19, subdomains: 'abcd', attribution: '&copy; <a href="https://carto.com/">CARTO</a>' } }
};
function switchBaseMap(type) {
  if (!map || !baseTileConfigs[type]) return;
  if (baseTileLayer) map.removeLayer(baseTileLayer);
  const cfg = baseTileConfigs[type];
  baseTileLayer = L.tileLayer(cfg.url, cfg.opts).addTo(map);
  baseTileLayer.bringToBack();
  baseTileLayer.on('tileerror', () => { $('map-status').textContent = 'Không tải được một số ô bản đồ nền. Kiểm tra kết nối mạng.'; });
}
function initMap(data) {
  if(!window.L){$('map').innerHTML=empty('Chưa tải được bản đồ','Kiểm tra mạng và tải lại trang. Các chức năng khác vẫn dùng được.');$('map-status').textContent='Bản đồ chưa khả dụng';return;}
  map=L.map('map',{center:[20.972,105.776],zoom:13,zoomControl:true});
  switchBaseMap('osm');
  for(const name of ['sites','water','roads','infrastructure','community','timeline','routing','rain'])layers[name]=L.layerGroup();
  for(const name of ['sites','water','community','timeline','routing','rain'])layers[name].addTo(map);
  data.layers.features.forEach(feature=>{
    const p=feature.properties, name=p.layer==='lakes'||p.layer==='rivers'?'water':p.layer==='roads'?'roads':p.layer==='drainage'?'infrastructure':null;
    if(!name)return;
    L.geoJSON(feature,{style:()=>({color:name==='water'?'#739faf':name==='roads'?'#b79b71':'#a790b1',weight:name==='roads'?3:2,fillOpacity:.15}),pointToLayer:(_,latlng)=>L.circleMarker(latlng,{radius:6,color:'#a790b1',fillOpacity:.8})}).bindTooltip(esc(p.name)+'<br><small>Lớp tham chiếu nghiên cứu</small>').addTo(layers[name]);
  });
  map.on('click',event=>{
    if(!state.picking)return;
    state.coords=[Number(event.latlng.lng.toFixed(6)),Number(event.latlng.lat.toFixed(6))];state.picking=false;
    if(reportMarker)map.removeLayer(reportMarker);
    reportMarker=L.marker(event.latlng).addTo(map);
    $('rep-coords').textContent='Đã chọn: '+state.coords[1]+'° N, '+state.coords[0]+'° E';
    $('map-status').textContent='Đã chọn vị trí cho báo cáo.';
    saveDraft(); $('report-dialog').showModal();
  });
  document.querySelectorAll('[data-layer]').forEach(input=>{const layer=layers[input.dataset.layer];if(layer){if(input.checked)layer.addTo(map);else map.removeLayer(layer);}});
  renderLocations();renderReportMarkers();renderRainLayer();updateMapAlertHud();updateEarlyWarnings();
  const fixSize = () => { try { map.invalidateSize(true); } catch {} };
  requestAnimationFrame(fixSize);
  setTimeout(fixSize, 150);
  setTimeout(fixSize, 600);
  window.addEventListener('resize', fixSize);
}
async function updateScenario() {
  const version=++scenarioVersion;
  $('scenario-rain-value').value=state.rain+' mm/h';$('kpi-scenario-note').textContent='Với mưa '+state.rain+' mm/h';
  $('scenario-label').textContent=state.rain+' mm/h · '+state.horizon;
  try {
    const forecast=await getAiForecast(state.horizon,state.rain);
    if(version!==scenarioVersion)return;
    state.forecast=forecast;
    const sites=forecast.predictions, high=sites.filter(p=>['high','very_high'].includes(p.risk_level)).length;
    $('kpi-sites').textContent=sites.length;$('map-count').textContent=sites.length+' điểm';
    $('kpi-risk').innerHTML=high+' <small>điểm</small>';
    $('scenario-top').textContent=state.rain===0?'Kịch bản không mưa':forecast.top_hotspot.name;
    $('scenario-depth').textContent=forecast.top_hotspot.depth_range_text;
    $('scenario-count').textContent=high+' / '+sites.length;
    $('risk-distribution').innerHTML=Object.entries(RISK_COLORS).map(([key,color])=>'<span style="--dot:'+color+';width:'+(sites.filter(s=>s.risk_level===key).length/sites.length*100)+'%"></span>').join('');
    $('risk-distribution-labels').innerHTML=Object.entries(RISK_COLORS).map(([key,color])=>'<span><i class="legend-dot" style="--dot:'+color+'"></i>'+RISK_LABELS[key]+': '+sites.filter(s=>s.risk_level===key).length+'</span>').join('');
    renderLocations();
    renderRainLayer();
    updateMapAlertHud();
    updateEarlyWarnings();
    renderSolutions();
    if(state.selected){const selected=sites.find(s=>s.id===state.selected);if(selected)focusSite(selected,false);}
  } catch(error){$('scenario-top').textContent='Không tải được kịch bản';$('location-list').innerHTML=empty('Không tải được địa điểm','Nhấn Cập nhật dữ liệu để thử lại.');throw error;}
}
function renderAutoMode() {
  const button=$('ai-auto-toggle');
  button.classList.toggle('active',state.aiAuto);
  button.setAttribute('aria-pressed',String(state.aiAuto));
  button.textContent=state.aiAuto?'↻ Mưa: Theo dự báo':'☂ Mưa: Thủ công';
  $('auto-mode-status').textContent=!state.aiAuto?'Đang dùng lượng mưa bạn chọn.'
    : state.weatherFailed?'Cập nhật thất bại; đang giữ kịch bản trước đó.'
    : !currentRows().length||currentRows()[0].rain===null?'Chờ dữ liệu mưa dự báo hợp lệ.'
    : 'Đồng bộ giờ dự báo gần nhất · Cập nhật mỗi 15 phút.';
}
async function applyAutomaticRain() {
  if(!state.aiAuto||state.weatherFailed)return false;
  const row=currentRows()[0];
  if(!row||row.rain===null||!Number.isFinite(row.rain))return false;
  state.rain=Math.min(100,Number(row.rain.toFixed(1)));
  $('scenario-rain').value=state.rain;
  persist();
  await updateScenario();
  return true;
}
function currentRows(){return state.weather?futureHours(state.weather).slice(0,state.hours):[];}
function hourlyMeta(time) {
  const h = state.weather?.hourly;
  if (!h?.time) return { temp: null, prob: null, code: null };
  const i = h.time.indexOf(time);
  if (i < 0) return { temp: null, prob: null, code: null };
  const num = (arr) => typeof arr?.[i] === 'number' && Number.isFinite(arr[i]) ? arr[i] : null;
  return { temp: num(h.temperature_2m), prob: num(h.precipitation_probability), code: num(h.weathercode) };
}
function renderWeatherNow() {
  const set = (id, text) => { if ($(id)) $(id).textContent = text; };
  if (!state.weather?.hourly?.time?.length) {
    set('wn-condition', '—'); set('wn-temp', '—'); set('wn-rain-now', '—'); set('wn-prob', '—'); set('wn-trend', '—');
    return;
  }
  const rows = futureHours(state.weather);
  const first = rows[0];
  const meta = first ? hourlyMeta(first.time) : { temp: null, prob: null, code: null };
  const cond = weatherCondition(meta.code);
  set('wn-condition', cond.icon + ' ' + cond.label);
  set('wn-temp', meta.temp === null ? '—' : meta.temp.toFixed(1) + ' °C');
  set('wn-rain-now', first?.rain === null || first?.rain === undefined ? '—' : String(first.rain));
  set('wn-prob', meta.prob === null ? '—' : meta.prob + '%');
  const next6 = rows.slice(0, 6);
  const rain6 = next6.reduce((s, r) => s + (typeof r.rain === 'number' ? r.rain : 0), 0);
  const rainyHours = next6.filter(r => typeof r.rain === 'number' && r.rain > 0).length;
  set('wn-trend', rainyHours === 0 ? '☀️ Ít mưa' : rain6 >= 10 ? '🌧️ Mưa nhiều' : '🌦️ Có mưa');
  set('wn-trend-note', rain6.toFixed(1) + ' mm / 6 giờ tới');
}
function renderWeather() {
  const rows=currentRows(), summary=summarizeRain(rows), all=state.weather?futureHours(state.weather):[], next24=all.slice(0,24), total24=summarizeRain(next24);
  $('export-csv').disabled=!rows.length;$('export-json').disabled=!rows.length;$('use-weather-btn').disabled=!summary.peak||state.weatherFailed;
  $('kpi-rain').innerHTML=(next24.length===24&&total24.complete?total24.total.toFixed(1):'—')+' <small>mm</small>';
  $('kpi-rain-note').textContent=state.weatherFailed?(all.length?'Bản dự báo cũ · Cập nhật thất bại':'Chưa kết nối được dữ liệu'):next24.length===24&&total24.complete?'Dự báo Open-Meteo · 24 giờ tới':'Thiếu dữ liệu cho đủ 24 giờ';
  renderWeatherNow();
  if(!rows.length){
    $('rain-chart').innerHTML=empty('Chưa có dữ liệu dự báo',state.weather?'Bản dự báo không còn giờ tương lai. Hãy cập nhật lại.':'Kiểm tra kết nối rồi chọn Thử lại.');
    $('rain-total').innerHTML='— <small>mm tích lũy</small>';$('rain-peak').textContent='Không thay dữ liệu thiếu bằng lượng mưa bằng 0.';$('rain-table-body').replaceChildren();$('rain-chart').setAttribute('aria-label','Chưa có dữ liệu lượng mưa');return;
  }
  const complete=rows.length===state.hours&&summary.complete;
  $('rain-total').innerHTML=(complete?summary.total.toFixed(1):'—')+' <small>mm / '+state.hours+' giờ</small>';
  $('rain-peak').textContent=summary.peak?'Đỉnh trong dữ liệu hiện có: '+summary.peak.rain+' mm · '+summary.peak.time.slice(11,16)+(complete?'':' · Thiếu một số giờ'):'Chưa có giá trị mưa hợp lệ';
  const max=Math.max(1,summary.peak?.rain||0), chart=$('rain-chart');chart.replaceChildren();
  chart.setAttribute('aria-label','Dự báo '+rows.length+' giờ. '+$('rain-peak').textContent);
  rows.forEach((row,index)=>{
    const col=document.createElement('div');col.className='chart-col'+(row.rain===null?' missing':'');col.tabIndex=0;
    const label=row.time.replace('T',' ')+' · '+(row.rain===null?'Thiếu dữ liệu':row.rain+' mm');
    col.title=label;col.setAttribute('aria-label',label);
    col.innerHTML='<span class="chart-value">'+(row.rain===null?'—':row.rain>0?row.rain:'')+'</span><div class="chart-bar '+(row===summary.peak?'peak':'')+'" style="height:'+(row.rain===null?12:Math.max(2,row.rain/max*138))+'px"></div><span class="chart-time">'+(state.hours<=12||index%3===0?esc(row.time.slice(11,16)):'')+'</span>';
    chart.append(col);
  });
  $('rain-table-body').innerHTML=rows.map(row=>{
    const meta = hourlyMeta(row.time);
    const cond = weatherCondition(meta.code);
    return '<tr><td>'+esc(row.time.replace('T',' '))+'</td><td>'+cond.icon+' '+esc(cond.label)+'</td><td>'+(meta.temp===null?'—':meta.temp.toFixed(1)+' °C')+'</td><td>'+(row.rain===null?'Thiếu dữ liệu':row.rain)+'</td><td>'+(meta.prob===null?'—':meta.prob+'%')+'</td></tr>';
  }).join('');
  renderAi24hRain();
}
function renderAi24hRain() {
  const card = $('ai-24h-rain-card');
  if (!card) return;
  const analysis = getAiRain24hAnalysis(state.weather);
  const tag = $('ai-rain-tag');
  if (tag) {
    tag.textContent = analysis.intensity_label;
    tag.className = 'ai-status-pill ' + (analysis.will_rain ? 'rain' : 'dry');
  }
  const title = $('ai-rain-title');
  if (title) title.textContent = analysis.status_title;
  const desc = $('ai-rain-desc');
  if (desc) desc.textContent = analysis.ai_summary;
  
  if ($('ai-rain-total')) $('ai-rain-total').textContent = analysis.total_rain_mm + ' mm';
  if ($('ai-rain-prob')) $('ai-rain-prob').textContent = analysis.max_prob_pct + '%';
  if ($('ai-rain-peak')) $('ai-rain-peak').textContent = analysis.peak_window;
  if ($('ai-rain-risk')) {
    $('ai-rain-risk').textContent = analysis.flood_risk_level === 'critical' ? '🔴 Cực kỳ cao' : analysis.flood_risk_level === 'high' ? '🟠 Cao' : analysis.flood_risk_level === 'moderate' ? '🟡 Trung bình' : '🟢 Thấp / An toàn';
  }
  
  const periodsContainer = $('ai-periods-container');
  if (periodsContainer) {
    periodsContainer.innerHTML = analysis.periods.map(p => `
      <div class="ai-period-card ${p.rain_mm > 0 ? 'has-rain' : ''}">
        <div class="period-header">
          <span class="period-name">${esc(p.name)}</span>
          <span class="period-icon">${p.icon}</span>
        </div>
        <div class="period-stats">
          <span>${p.rain_mm} mm</span>
          <small>Xác suất ${p.prob_pct}%</small>
        </div>
        <p class="period-desc">${esc(p.desc)}</p>
      </div>
    `).join('');
  }
  
  if ($('ai-traffic-text')) {
    $('ai-traffic-text').textContent = analysis.traffic_advisory;
  }
}
function renderSolutions() {
  const grid = $('solutions-grid');
  if (!grid) return;
  const solutions = getActionableSolutions(state.rain);
  grid.innerHTML = solutions.map(s => `
    <article class="solution-card audience-${esc(s.audience || 'general')}">
      <div class="solution-header">
        <div class="solution-title-group">
          <span class="solution-icon">${s.icon}</span>
          <h3 class="solution-category">${esc(s.category)}</h3>
        </div>
        <span class="solution-priority-pill" style="background:${s.color}">${esc(s.priority)}</span>
      </div>
      ${s.summary ? `<p class="solution-summary">${esc(s.summary)}</p>` : ''}
      <ul class="solution-actions-list">
        ${s.actions.map(a => `<li>${esc(a)}</li>`).join('')}
      </ul>
    </article>
  `).join('');
}
function renderAvoidanceRouting(presetKey = 'route_1') {
  const routes = getAvoidanceRoutes(presetKey);
  const container = $('ai-route-comparison');
  if (!container) return;
  
  container.innerHTML = `
    <div class="route-card regular">
      <div class="route-card-header">
        <span class="route-type-badge warning">⚠ Tuyến truyền thống</span>
        <span class="small-text muted">${routes.regular_route.distance_km} km</span>
      </div>
      <h4 class="route-title">${esc(routes.regular_route.name)}</h4>
      <div class="route-stats-row">
        <span class="route-stat-item">Thời gian: <b>${routes.regular_route.duration_min} phút</b></span>
        <span class="route-stat-item">Trạng thái: <b style="color:#dc2626">Ngập sâu</b></span>
      </div>
      <p class="route-notice" style="color:#b91c1c"><b>${esc(routes.regular_route.warning_msg)}</b></p>
      <div class="small-text" style="color:#7f1d1d;font-weight:600;margin-top:6px">Điểm ngập trên tuyến:</div>
      <div class="route-spots-list">
        ${(routes.regular_route.flood_spots || []).map(sp => `<span class="route-spot-pill">📍 ${esc(sp.name)} (${esc(sp.depth)})</span>`).join('')}
      </div>
    </div>

    <div class="route-card safe">
      <div class="route-card-header">
        <span class="route-type-badge safe">✔ Tuyến tránh ngập AI</span>
        <span class="small-text muted">${routes.safe_route.distance_km} km</span>
      </div>
      <h4 class="route-title">${esc(routes.safe_route.name)}</h4>
      <div class="route-stats-row">
        <span class="route-stat-item">Thời gian: <b>${routes.safe_route.duration_min} phút</b></span>
        <span class="route-stat-item">Trạng thái: <b style="color:#16a34a">Khô ráo / An toàn</b></span>
      </div>
      <p class="route-notice" style="color:#15803d"><b>${esc(routes.safe_route.recommendation)}</b></p>
      <div class="small-text" style="color:#166534;margin-top:6px">${esc(routes.safe_route.elevation_status)}</div>
    </div>
  `;
}
function drawAvoidanceRoutesOnMap(presetKey = 'route_1') {
  if (!map || !layers.routing) return;
  const routes = getAvoidanceRoutes(presetKey);
  layers.routing.clearLayers();
  const points = [];
  
  const regCoords = routes.regular_route.path.map(c => [c[1], c[0]]);
  points.push(...regCoords);
  L.polyline(regCoords, {
    color: '#dc2626',
    weight: 5,
    dashArray: '8 6',
    opacity: 0.85
  }).bindTooltip('<b>Tuyến truyền thống (Ngập úng)</b><br>' + esc(routes.regular_route.name)).addTo(layers.routing);
  
  (routes.regular_route.flood_spots || []).forEach(sp => {
    const midIdx = Math.floor(regCoords.length / 2);
    const spotCoord = regCoords[midIdx] || regCoords[0];
    L.circleMarker(spotCoord, {
      radius: 8,
      color: '#fff',
      weight: 2,
      fillColor: '#dc2626',
      fillOpacity: 1
    }).bindPopup('<b>⚠️ Điểm ngập: ' + esc(sp.name) + '</b><br>Độ sâu: ' + esc(sp.depth) + '<br>Rủi ro: ' + esc(sp.risk)).addTo(layers.routing);
  });
  
  const safeCoords = routes.safe_route.path.map(c => [c[1], c[0]]);
  points.push(...safeCoords);
  L.polyline(safeCoords, {
    color: '#10b981',
    weight: 5,
    opacity: 0.95
  }).bindTooltip('<b>Tuyến tránh ngập an toàn (AI Đề xuất)</b><br>' + esc(routes.safe_route.name)).addTo(layers.routing);
  
  if (safeCoords.length >= 2) {
    const startPt = safeCoords[0];
    const endPt = safeCoords[safeCoords.length - 1];
    L.circleMarker(startPt, {
      radius: 8,
      color: '#fff',
      weight: 2,
      fillColor: '#2563eb',
      fillOpacity: 1
    }).bindPopup('<b>Điểm xuất phát</b><br>' + esc(routes.origin)).addTo(layers.routing);
    
    L.circleMarker(endPt, {
      radius: 8,
      color: '#fff',
      weight: 2,
      fillColor: '#059669',
      fillOpacity: 1
    }).bindPopup('<b>Điểm đến</b><br>' + esc(routes.destination)).addTo(layers.routing);
  }
  
  scrollMap();
  map.fitBounds(points, { padding: [35, 35] });
  $('map-status').textContent = 'Lộ trình tránh ngập AI: ' + routes.origin + ' → ' + routes.destination;
  notify('Đã vẽ lộ trình tránh ngập AI trên bản đồ.');
}
async function loadWeather(force=false) {
  $('weather-status').textContent='Đang cập nhật dự báo Open-Meteo…';$('retry-weather').hidden=true;
  try{
    state.weather=await fetchWeatherDirect(force);state.weatherFailed=false;
    $('weather-status').textContent='Cập nhật '+new Date(state.weather.retrieved_at).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok',hour:'2-digit',minute:'2-digit',day:'2-digit',month:'2-digit'})+' · UTC+7 · Dự báo theo giờ';

  }catch(error){
    state.weatherFailed=true;$('retry-weather').hidden=false;
    $('weather-status').textContent=state.weather?'Cập nhật thất bại. Đang giữ bản dự báo lấy lúc '+new Date(state.weather.retrieved_at).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok'})+'.':'Không kết nối được Open-Meteo. Chưa có dữ liệu dự báo.';
  }
  renderWeather();
  renderAutoMode();
  try{await applyAutomaticRain();}catch{notify('Không cập nhật được mô phỏng theo dự báo.',true);}
}
function download(name,text,type){
  const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function reportText(rep) {
  const dl = getDepthLabel(rep.depth_cm || 0);
  return '<b>'+esc(rep.location_name)+'</b><br>'+esc(rep.reporter_name)+'<br>Mức ngập: '+(dl.icon||'🌊')+' '+esc(dl.label)+' ('+esc(rep.depth_cm)+' cm)<br><small>Chưa xác minh · '+esc(new Date(rep.reported_at).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok'}))+'</small>';
}
function renderReportMarkers(){
  if(!layers.community)return;
  layers.community.clearLayers();
  state.reports.forEach(rep=>{
    const c=rep.coordinates;
    if(!Array.isArray(c)||c.length!==2||!c.every(Number.isFinite)||Math.abs(c[0])>180||Math.abs(c[1])>90)return;
    L.circleMarker([c[1],c[0]],{radius:7,color:'#fff',weight:2,fillColor:'#987ba8',fillOpacity:1}).bindPopup(reportText(rep)).addTo(layers.community);
  });
}
function renderReports(){
  const feed=$('community-feed'),q=normalizeSearch($('report-search').value);
  const reports=state.reports.filter(rep=>normalizeSearch([rep.location_name,rep.description,rep.reporter_name].join(' ')).includes(q));
  $('kpi-reports').textContent=state.reports.length;$('export-reports').disabled=!state.reports.length;
  feed.replaceChildren();
  if(!reports.length)feed.innerHTML=empty(q?'Không có báo cáo phù hợp':'Chưa có ghi nhận nào',q?'Thử tên địa điểm hoặc từ khóa khác.':'Tạo báo cáo đầu tiên để lưu lại tình trạng tại khu vực của bạn.');
  reports.forEach(rep=>{
    const card=document.createElement('article');card.className='report-card';
    const photo=safePhoto(rep.photo_url);
    const dl=getDepthLabel(rep.depth_cm || 0);
    card.innerHTML=(photo?'<img class="report-photo" src="'+photo+'" alt="Ảnh hiện trường tự báo cáo" loading="lazy">':'')+
      '<div class="report-content"><div class="report-meta">'+esc(rep.reporter_name)+' · '+esc(new Date(rep.reported_at).toLocaleString('vi-VN',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}))+'</div>'+
      '<h3>'+esc(rep.location_name)+'</h3><p>'+esc(rep.description)+'</p>'+
      '<div class="report-bottom"><span class="mini-tag">Chưa xác minh</span><span class="depth-badge severity-'+(dl.severity||'low')+'">'+(dl.icon||'🌊')+' '+esc(dl.label)+'</span></div></div>';
    const c=rep.coordinates;
    if(Array.isArray(c)&&c.length===2&&c.every(Number.isFinite)&&Math.abs(c[0])<=180&&Math.abs(c[1])<=90){
      const btn=document.createElement('button');btn.className='text-button';btn.textContent='Xem vị trí ↗';btn.onclick=()=>{if(!map){notify('Bản đồ chưa khả dụng.',true);return;}scrollMap();map.flyTo([c[1],c[0]],16);L.popup().setLatLng([c[1],c[0]]).setContent(reportText(rep)).openOn(map);};card.querySelector('.report-bottom').append(btn);
    }
    feed.append(card);
  });
  renderReportMarkers();
}
async function loadCommunity(){
  try{state.reports=await loadReports();renderReports();}
  catch(error){$('community-feed').innerHTML=empty('Không đọc được báo cáo',error.message);$('kpi-reports').textContent='—';}
}
function saveDraft(){
  try {
    const draft={name:$('rep-name').value,location:$('rep-location').value,description:$('rep-description').value,depth:$('rep-depth').value,coords:state.coords};
    sessionStorage.setItem('hadong-report-draft',JSON.stringify(draft));
    $('draft-status').textContent='Đã lưu nháp trong tab này · Ảnh cần chọn lại sau khi tải trang.';
  } catch { $('draft-status').textContent='Chưa lưu được nháp. Giữ tab mở để tránh mất nội dung.'; }
}
function restoreDraft(){
  try{
    const draft=JSON.parse(sessionStorage.getItem('hadong-report-draft')||'null');
    if(!draft)return;
    for(const [id,key,max] of [['rep-name','name',80],['rep-location','location',160],['rep-description','description',1500]])if(typeof draft[key]==='string')$(id).value=draft[key].slice(0,max);
    if(['very_low','low','medium','high','very_high','critical'].includes(draft.depth)){
      $('rep-depth').value=draft.depth;
      const r=document.querySelector('input[name="rep-depth-radio"][value="'+draft.depth+'"]');
      if(r)r.checked=true;
      $('depth-visual-selector')?.querySelectorAll('.depth-opt').forEach(opt=>opt.classList.toggle('selected',opt.dataset.value===draft.depth));
    }
    if(Array.isArray(draft.coords)&&draft.coords.length===2&&draft.coords.every(Number.isFinite)&&Math.abs(draft.coords[0])<=180&&Math.abs(draft.coords[1])<=90){state.coords=draft.coords;$('rep-coords').textContent='Tọa độ nháp: '+draft.coords[1]+'° N, '+draft.coords[0]+'° E';}
    $('draft-status').textContent='Đã khôi phục nháp trong tab này. Ảnh cần chọn lại nếu có.';
  }catch{}
}
function resetReport(){
  try{sessionStorage.removeItem('hadong-report-draft');}catch{}
  $('draft-status').textContent='';
  photoVersion++;state.coords=null;state.photo='';state.picking=false;$('report-form').reset();$('photo-preview').hidden=true;$('photo-preview').removeAttribute('src');$('rep-coords').textContent='Chưa chọn tọa độ (không bắt buộc).';$('report-error').textContent='';
  const defRadio=document.querySelector('input[name="rep-depth-radio"][value="medium"]');
  if(defRadio)defRadio.checked=true;
  $('depth-visual-selector')?.querySelectorAll('.depth-opt').forEach(opt=>opt.classList.toggle('selected',opt.dataset.value==='medium'));
  if($('rep-depth'))$('rep-depth').value='medium';
  $('submit-report').disabled=false;
  if(reportMarker&&map){map.removeLayer(reportMarker);reportMarker=null;}
}
function setupReport(){
  const dialog=$('report-dialog');
  restoreDraft();
  ['rep-name','rep-location','rep-description','rep-depth'].forEach(id=>$(id).addEventListener('input',saveDraft));
  $('clear-draft').onclick=()=>{resetReport();$('rep-name').focus();};
  $('open-report').onclick=()=>{state.picking=false;dialog.showModal();};
  $('close-report').onclick=$('cancel-report').onclick=()=>dialog.close();
  dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
  $('pick-location').onclick=()=>{
    if(!map){$('report-error').textContent='Bản đồ chưa khả dụng. Có thể lưu báo cáo bằng tên địa điểm.';return;}
    dialog.close();state.picking=true;scrollMap();$('map-status').textContent='Nhấp lên bản đồ để chọn vị trí · Esc để hủy';
    notify('Chọn vị trí trên bản đồ. Nhấn Esc để quay lại biểu mẫu.');
  };
  $('rep-photo').onchange=async e=>{
    const version=++photoVersion,file=e.target.files[0];state.photo='';$('photo-preview').hidden=true;$('report-error').textContent='';
    if(!file){$('submit-report').disabled=false;return;}
    if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>1024*1024){$('report-error').textContent='Chọn ảnh JPEG, PNG hoặc WebP không quá 1 MB.';e.target.value='';$('submit-report').disabled=false;return;}
    $('submit-report').disabled=true;
    try{
      const photo=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Không đọc được ảnh.'));reader.readAsDataURL(file);});
      if(version!==photoVersion)return;
      state.photo=photo;$('photo-preview').src=photo;$('photo-preview').hidden=false;
    }catch(error){$('report-error').textContent=error.message;}finally{if(version===photoVersion)$('submit-report').disabled=false;}
  };
  $('report-form').onsubmit=async e=>{
    e.preventDefault();$('submit-report').disabled=true;$('report-error').textContent='';
    const level=$('rep-depth').value;
    const depthMap={very_low:6,low:12,medium:25,high:35,very_high:42,critical:55};
    try{
      saveReport({reporter_name:$('rep-name').value,location_name:$('rep-location').value,description:$('rep-description').value,coordinates:state.coords,depth_level:level,depth_cm:depthMap[level]||25,photo_url:state.photo});
      dialog.close();resetReport();await loadCommunity();notify('Đã lưu báo cáo trên trình duyệt này. Trạng thái: chưa xác minh.');
    }catch(error){$('report-error').textContent=error.message;}finally{$('submit-report').disabled=false;}
  };
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.picking){state.picking=false;$('map-status').textContent='Đã hủy chọn vị trí.';dialog.showModal();}});
}
function stopTimeline(){clearInterval(timelineTimer);timelineTimer=null;$('timeline-play').textContent='▷ Chạy mô phỏng';$('timeline-play').setAttribute('aria-pressed','false');}
function updateTimeline(show=false){
  const step=state.timeline?.[Number($('timeline-range').value)];if(!step)return;
  $('timeline-description').textContent='Kịch bản '+step.hour+' · '+step.rain_rate_mm+' mm/h · Diện tích minh họa '+step.active_ha+' ha. '+step.status_desc;
  if(show&&layers.timeline){
    layers.timeline.clearLayers();
    step.sites.filter(s=>s.depth_cm>=10).forEach(site=>L.circle([site.coordinates[1],site.coordinates[0]],{radius:site.radius_meters,color:RISK_COLORS[site.risk_level],weight:1,fillOpacity:.17}).bindTooltip('Mô phỏng: '+esc(site.name)+' · '+site.depth_cm+' cm').addTo(layers.timeline));
    $('map-status').textContent='Vùng lan minh họa lúc '+step.hour+' · Kịch bản độc lập với thanh mưa';
  }
}
function setupTimeline(){
  $('timeline-range').oninput=()=>updateTimeline(true);
  $('timeline-play').onclick=()=>{
    if(timelineTimer){stopTimeline();return;}
    if(!state.timeline){notify('Chưa tải được dữ liệu mô phỏng.',true);return;}
    $('timeline-play').textContent='Ⅱ Tạm dừng';$('timeline-play').setAttribute('aria-pressed','true');
    updateTimeline(true);
    timelineTimer=setInterval(()=>{const next=Number($('timeline-range').value)+1;if(next>4){stopTimeline();return;}$('timeline-range').value=next;updateTimeline(true);},1800);
  };
  $('timeline-show').onclick=()=>{if(!map){notify('Bản đồ chưa khả dụng.',true);return;}updateTimeline(true);scrollMap();};
  $('timeline-clear').onclick=()=>{stopTimeline();layers.timeline?.clearLayers();$('map-status').textContent='Bản đồ tham chiếu · Chưa phải dữ liệu ngập hiện tại';};
  if ($('route-preset-select')) {
    $('route-preset-select').onchange = (e) => {
      renderAvoidanceRouting(e.target.value);
      if (layers.routing && layers.routing.getLayers().length > 0) {
        drawAvoidanceRoutesOnMap(e.target.value);
      }
    };
  }
  $('route-show').onclick=()=>{
    if(!map){notify('Bản đồ chưa khả dụng.',true);return;}
    const presetKey = $('route-preset-select')?.value || 'route_1';
    drawAvoidanceRoutesOnMap(presetKey);
  };
  $('route-clear').onclick=()=>{
    layers.routing?.clearLayers();
    $('map-status').textContent='Đã ẩn các tuyến mẫu.';
    notify('Đã ẩn các tuyến trên bản đồ.');
  };
}
async function refresh(force=false){
  if(state.refresh)return state.refresh;
  $('refresh-btn').disabled=true;$('refresh-btn').querySelector('span').textContent='Đang cập nhật…';
  state.refresh=(async()=>{
    const gisTask = loadGisData().then(data=>{
      if(!map) initMap(data);
      return updateScenario();
    });
    const result=await Promise.allSettled([
      gisTask,
      loadCommunity(),
      getTimelineSimulation().then(data=>{state.timeline=data.timeline;updateTimeline();}),
      loadWeather(force)
    ]);
    if(result.some(r=>r.status==='rejected'))notify('Một số dữ liệu chưa tải được. Bạn có thể nhấn cập nhật để thử lại.',true);
  })().finally(()=>{$('refresh-btn').disabled=false;$('refresh-btn').querySelector('span').textContent='Cập nhật dữ liệu';state.refresh=null;});
  return state.refresh;
}
function setupNavigation(){
  const sidebar=$('sidebar'),mobile=matchMedia('(max-width:760px)');
  const close=()=>{sidebar.classList.remove('open');$('nav-scrim').hidden=true;$('menu-btn').setAttribute('aria-expanded','false');sidebar.inert=mobile.matches;};
  mobile.addEventListener('change',close);close();
  $('menu-btn').onclick=()=>{const open=!sidebar.classList.contains('open');sidebar.classList.toggle('open',open);sidebar.inert=!open&&mobile.matches;$('nav-scrim').hidden=!open;$('menu-btn').setAttribute('aria-expanded',open);if(open)sidebar.querySelector('nav a').focus();};
  $('nav-scrim').onclick=close;
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&sidebar.classList.contains('open')){close();$('menu-btn').focus();}});
  document.querySelectorAll('.sidebar a').forEach(a=>a.addEventListener('click',()=>{close();if(mobile.matches)$('menu-btn').focus();}));
  const links=[...document.querySelectorAll('.sidebar nav a')];
  const observer=new IntersectionObserver(entries=>{
    const visible=entries.filter(e=>e.isIntersecting).sort((a,b)=>a.boundingClientRect.top-b.boundingClientRect.top)[0];if(!visible)return;
    links.forEach(a=>{const active=a.hash==='#'+visible.target.id;a.classList.toggle('active',active);if(active){a.setAttribute('aria-current','location');$('page-label').textContent=a.textContent.replace(/[▦◎☂◴♧▤↗]/g,'').trim();}else a.removeAttribute('aria-current');});
  },{rootMargin:'-10% 0px -65% 0px'});
  links.forEach(a=>{const section=document.querySelector(a.hash);if(section)observer.observe(section);});
}
function setupEvents(){
  $('refresh-btn').onclick=()=>refresh(true);$('retry-weather').onclick=()=>refresh(true);
  $('location-search').oninput=e=>{state.query=e.target.value;renderLocations();persist();};
  document.querySelectorAll('[data-risk]').forEach(btn=>btn.onclick=()=>{state.risk=btn.dataset.risk;setPressed('[data-risk]',state.risk,'risk');renderLocations();persist();});
  document.querySelectorAll('[data-hours]').forEach(btn=>btn.onclick=()=>{state.hours=Number(btn.dataset.hours);setPressed('[data-hours]',state.hours,'hours');renderWeather();persist();});
  document.querySelectorAll('[data-layer]').forEach(input=>input.onchange=()=>{const layer=layers[input.dataset.layer];if(!map||!layer)return;if(input.checked)layer.addTo(map);else map.removeLayer(layer);});
  if($('basemap-select'))$('basemap-select').onchange=e=>switchBaseMap(e.target.value);
  $('scenario-rain').oninput=e=>{
    state.rain=Number(e.target.value);
    state.aiAuto=false;
    renderAutoMode();
    persist();
    updateScenario().catch(()=>notify('Không cập nhật được mô phỏng.',true));
  };
  $('scenario-horizon').onchange=e=>{state.horizon=e.target.value;persist();updateScenario().catch(()=>notify('Không cập nhật được mô phỏng.',true));};
  $('ai-auto-toggle').onclick=async()=>{
    state.aiAuto=!state.aiAuto;renderAutoMode();persist();
    if(!state.aiAuto){notify('Đã chuyển sang kịch bản mưa thủ công.');return;}
    try{
      if(await applyAutomaticRain())notify('Đã đồng bộ kịch bản với giờ mưa dự báo gần nhất.');
      else {notify('Đang lấy dữ liệu dự báo để đồng bộ kịch bản.');await refresh(true);}
    }catch{notify('Không cập nhật được mô phỏng theo dự báo.',true);}
  };
  const toggleSound=()=>{
    state.soundEnabled=!state.soundEnabled;
    $('alert-sound-toggle')?.classList.toggle('active',state.soundEnabled);
    $('hud-sound-btn')?.classList.toggle('active',state.soundEnabled);
    for(const id of ['alert-sound-toggle','hud-sound-btn'])$(id).setAttribute('aria-pressed',String(state.soundEnabled));
    if($('alert-sound-toggle'))$('alert-sound-toggle').textContent=state.soundEnabled?'🔔 Tắt âm':'🔔 Bật âm';
    if(state.soundEnabled){playAlertChime();notify('Đã bật âm cảnh báo nguy cơ ngập.');}
    else{notify('Đã tắt âm cảnh báo.');}
  };
  if($('alert-sound-toggle'))$('alert-sound-toggle').onclick=toggleSound;
  if($('hud-sound-btn'))$('hud-sound-btn').onclick=toggleSound;
  $('use-weather-btn').onclick=()=>{
    const peak=summarizeRain(currentRows()).peak;if(!peak||state.weatherFailed)return;state.aiAuto=false;renderAutoMode();state.rain=Math.min(100,peak.rain);$('scenario-rain').value=state.rain;persist();updateScenario().catch(()=>notify('Không cập nhật được mô phỏng.',true));
    notify('Đã dùng '+state.rain+' mm/h từ giờ '+peak.time.slice(11,16)+(peak.rain>100?' (giới hạn kịch bản 100 mm/h).':'.'));
  };
  $('reset-map-btn').onclick=()=>{if(map){map.setView([20.972,105.776],13);map.closePopup();}else notify('Bản đồ chưa khả dụng.',true);};
  $('locate-btn').onclick=()=>{
    if(!map||!navigator.geolocation){notify('Bản đồ hoặc định vị chưa khả dụng.',true);return;}
    $('locate-btn').disabled=true;
    navigator.geolocation.getCurrentPosition(pos=>{if(userMarker)map.removeLayer(userMarker);userMarker=L.marker([pos.coords.latitude,pos.coords.longitude]).bindPopup('Vị trí thiết bị · Sai số khoảng '+Math.round(pos.coords.accuracy)+' m').addTo(map);map.flyTo(userMarker.getLatLng(),15);userMarker.openPopup();$('locate-btn').disabled=false;},()=>{$('locate-btn').disabled=false;notify('Không lấy được vị trí. Kiểm tra quyền định vị của trình duyệt.',true);},{timeout:10000,maximumAge:60000});
  };
  $('export-csv').onclick=()=>{const rows=currentRows();download('ha-dong-mua-'+state.hours+'h.csv','\uFEFFthoi_gian_UTC7,luong_mua_mm\r\n'+rows.map(r=>r.time+','+(r.rain??'')).join('\r\n'),'text/csv;charset=utf-8');};
  $('export-json').onclick=()=>download('ha-dong-mua-'+state.hours+'h.json',JSON.stringify({source:state.weather.source,retrieved_at:state.weather.retrieved_at,timezone:'Asia/Bangkok',hours_requested:state.hours,stale:state.weatherFailed,rows:currentRows()},null,2),'application/json');
  $('print-btn').onclick=()=>window.print();
  $('report-search').oninput=renderReports;
  $('import-reports').onclick=()=>$('import-reports-file').click();
  if($('sample-reports-btn')){
    $('sample-reports-btn').onclick=async()=>{
      $('sample-reports-btn').disabled=true;
      try{
        const res=await fetch(new URL('./data/community-reports.json',import.meta.url));
        if(!res.ok)throw new Error('Không tải được tệp dữ liệu mẫu.');
        const sampleReports=await res.json();
        const count=await importReports({reports:sampleReports});
        await loadCommunity();
        notify(count?'Đã nạp '+count+' báo cáo khảo sát thực tế tại Hà Đông.':'Tất cả báo cáo mẫu đã có trong hệ thống.');
      }catch(err){notify(err.message,true);}finally{$('sample-reports-btn').disabled=false;}
    };
  }
  $('import-reports-file').onchange=async e=>{
    const file=e.target.files[0];if(!file)return;
    $('import-reports').disabled=true;
    try{
      if(file.size>8*1024*1024)throw new Error('Chọn bản sao lưu JSON không quá 8 MB.');
      let payload;try{payload=JSON.parse(await file.text());}catch{throw new Error('Tệp không phải JSON hợp lệ.');}
      const count=await importReports(payload);await loadCommunity();
      notify(count?'Đã nhập '+count+' báo cáo. Các báo cáo trùng được bỏ qua.':'Bản sao lưu không có báo cáo mới.');
    }catch(error){notify(error.message,true);}finally{e.target.value='';$('import-reports').disabled=false;}
  };
  $('share-view').onclick=async()=>{
    persist();
    try{await navigator.clipboard.writeText(location.href.split('#')[0]+'#gis-map-section');notify('Đã sao chép liên kết với bộ lọc và kịch bản hiện tại.');}
    catch{notify('Liên kết đã cập nhật trên thanh địa chỉ. Bạn có thể sao chép từ đó.');}
  };
  $('export-reports').onclick=()=>download('ha-dong-bao-cao.json',JSON.stringify({exported_at:new Date().toISOString(),storage:'local-browser',reports:state.reports},null,2),'application/json');
  window.addEventListener('storage',e=>{if(e.key==='hadong-community-reports')loadCommunity();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopTimeline();else if(!state.weather||Date.now()-Date.parse(state.weather.retrieved_at)>WEATHER_REFRESH_MS)refresh();});
  const connection=()=>{$('connection-status').classList.toggle('offline',!navigator.onLine);$('connection-status').innerHTML='<i></i>'+(!navigator.onLine?'Đang ngoại tuyến':'Có kết nối mạng');};
  window.addEventListener('offline',connection);window.addEventListener('online',()=>{connection();refresh();});connection();
  const clock=()=>{$('clock').textContent=new Date().toLocaleDateString('vi-VN',{timeZone:'Asia/Bangkok',weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'});};clock();setInterval(clock,60000);
  setInterval(()=>{if(!document.hidden&&navigator.onLine)refresh();},WEATHER_REFRESH_MS);
}
function setupRouteFinder() {
  const rfFrom = $('rf-from'), rfTo = $('rf-to'), rfBtn = $('rf-search-btn');
  const rfResult = $('rf-result'), rfMapActions = $('rf-map-actions');
  if (!rfFrom || !rfTo || !rfBtn) return;
  // Populate datalists with site names
  async function populateDatalist() {
    try {
      const gis = await loadGisData();
      const names = gis.sites.features.map(f => f.properties.name);
      ['rf-from-list','rf-to-list'].forEach(id => {
        const dl = $(id); if (!dl) return;
        dl.innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
      });
    } catch {}
  }
  populateDatalist();
  function doSearch() {
    const fromVal = rfFrom.value.trim(), toVal = rfTo.value.trim();
    if (!fromVal || !toVal) { notify('Vui lòng nhập cả điểm xuất phát và điểm đến.', true); return; }
    if (!state.forecast) { notify('Đang tải dữ liệu dự báo, vui lòng thử lại sau.', true); return; }
    // Find flooded sites near the route (name/street match)
    const qFrom = fromVal.toLowerCase(), qTo = toVal.toLowerCase();
    const allPredictions = state.forecast.predictions || [];
    const floodedOnRoute = allPredictions.filter(p => {
      const text = (p.name + ' ' + p.street + ' ' + p.ward + ' ' + p.district).toLowerCase();
      return (text.includes(qFrom) || text.includes(qTo) || qFrom.split(' ').some(w => w.length > 2 && text.includes(w)) || qTo.split(' ').some(w => w.length > 2 && text.includes(w))) && ['high','very_high'].includes(p.risk_level);
    });
    // Try to get a preset route
    const combined = (fromVal + ' ' + toVal).toLowerCase();
    let preset = null;
    if (ROUTE_PRESETS) {
      for (const key of Object.keys(ROUTE_PRESETS)) {
        const r = ROUTE_PRESETS[key];
        const rText = (r.origin + ' ' + r.destination).toLowerCase();
        if (combined.split(' ').filter(w => w.length > 2).some(w => rText.includes(w))) { preset = r; break; }
      }
      if (!preset) preset = ROUTE_PRESETS.route_1;
    }
    rfResult.hidden = false;
    if (preset) {
      const reg = preset.regular_route, safe = preset.safe_route;
      const floodSpots = floodedOnRoute.length > 0 ? floodedOnRoute : (reg.flood_spots || []);
      rfResult.innerHTML = `
        <div class="rf-found-floods" ${floodSpots.length === 0 ? 'hidden' : ''}>
          <strong>⚠️ Phát hiện ${floodSpots.length} điểm ngập trên lộ trình từ "${esc(fromVal)}" đến "${esc(toVal)}":</strong>
          <ul class="rf-found-flood-list">
            ${floodSpots.slice(0,4).map(s => `<li>🚨 <b>${esc(s.name||s.street||'')}</b> — ${esc(s.depth_label || (s.depth ? s.depth + ' – ' + (s.risk||'') : ''))}</li>`).join('')}
          </ul>
        </div>
        <div class="rf-route-grid">
          <div class="rf-route-card flooded">
            <div class="rf-route-header"><span class="rf-route-tag">🚫 TUYẾN BỊ NGẬP</span></div>
            <div class="rf-route-name">${esc(reg.name)}</div>
            <div class="rf-route-stats"><span>📏 ${reg.distance_km} km</span><span>⏱ ${reg.duration_min} phút</span></div>
            <ul class="rf-flood-spots">${(floodSpots.slice(0,3)||[]).map(s=>`<li>🌊 <b>${esc(s.name||s.street||'')}</b> ${esc(s.depth_label||s.depth||'')}</li>`).join('')}</ul>
            <div class="rf-warning-msg">${esc(reg.warning_msg||'Cảnh báo: Tuyến này có điểm ngập sâu.')}</div>
          </div>
          <div class="rf-route-card safe">
            <div class="rf-route-header"><span class="rf-route-tag">✅ TUYẾN AN TOÀN</span></div>
            <div class="rf-route-name">${esc(safe.name)}</div>
            <div class="rf-route-stats"><span>📏 ${safe.distance_km} km</span><span>⏱ ${safe.duration_min} phút</span></div>
            <div class="rf-safe-note">🛣️ ${esc(safe.elevation_status||'Tuyến đường cao ráo, không ngập.')}</div>
            <div class="rf-safe-note">💡 ${esc(safe.recommendation||'Đề xuất sử dụng tuyến này.')}</div>
          </div>
        </div>`;
      rfMapActions.hidden = false;
      const showBtn = $('rf-show-map');
      if (showBtn) {
        showBtn.onclick = () => {
          drawAvoidanceRoutesOnMap(preset.id || 'route_1');
        };
      }
      const clearBtn = $('rf-clear-map');
      if (clearBtn) {
        clearBtn.onclick = () => {
          if (layers.routing) layers.routing.clearLayers();
          rfMapActions.hidden = true;
          notify('Đã xóa tuyến trên bản đồ.');
        };
      }
    } else {
      rfResult.innerHTML = `<div class="rf-no-result">⌁ Chưa có dữ liệu tuyến đường cho hành trình này. Thử các tuyến gợi ý bên dưới.</div>`;
      rfMapActions.hidden = true;
    }
  }
  rfBtn.onclick = doSearch;
  rfFrom.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  rfTo.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  document.querySelectorAll('.rf-quick-btn').forEach(btn => {
    btn.onclick = () => {
      rfFrom.value = btn.dataset.from || ''; rfTo.value = btn.dataset.to || '';
      doSearch();
    };
  });
}
function setupDepthVisualSelector() {
  const selector = $('depth-visual-selector'), hiddenInput = $('rep-depth');
  if (!selector || !hiddenInput) return;
  selector.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        hiddenInput.value = radio.value;
        selector.querySelectorAll('.depth-opt').forEach(opt => {
          opt.classList.toggle('selected', opt.dataset.value === radio.value);
        });
      }
    });
  });
}
restore();setupNavigation();setupEvents();setupReport();setupTimeline();renderAvoidanceRouting('route_1');renderSolutions();setupRouteFinder();setupDepthVisualSelector();refresh();
