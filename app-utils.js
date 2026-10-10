export function normalizeSearch(value = '') {
  return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
}
export function matchLocation(predictions, query) {
  const full = normalizeSearch(query);
  const q = full.replace(/\bha dong\b/g, '').trim() || full;
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
  return typeof value === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && value.length <= 1500000 ? value : '';
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
  if (!['low','medium','high','very_high'].includes(report.depth_level)) throw new Error('Chọn mức độ ngập.');
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
}
