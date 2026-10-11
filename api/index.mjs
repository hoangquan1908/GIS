import { createWeatherCache } from '../weather-cache.mjs';
import {
  loadGisData, loadReports, saveReport,
  getAiForecast, getEarlyAlerts, getDashboardData,
  getTimelineSimulation, searchLocationRisk,
  getAvoidanceRoutes, getActionableSolutions
} from '../flood-engine.mjs';

const getWeather = createWeatherCache();

const sendJson = (res, data, code = 200) => {
  res.status(code)
    .setHeader('Content-Type', 'application/json; charset=utf-8')
    .setHeader('X-Content-Type-Options', 'nosniff')
    .setHeader('Cache-Control', 'no-store')
    .json(data);
};

export default async function handler(req, res) {
  try {
    // Vercel passes the full path; strip /api prefix to get the sub-route
    const rawPath = req.url.split('?')[0];
    const pathname = rawPath.replace(/^\/api/, '') || '/';
    const params = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '');

    const isReport = pathname === '/community-reports';
    if (!['GET', 'HEAD'].includes(req.method) && !(isReport && req.method === 'POST')) {
      res.setHeader('Allow', isReport ? 'GET, HEAD, POST' : 'GET, HEAD');
      return sendJson(res, { error: 'Phương thức không được hỗ trợ.' }, 405);
    }

    const rainParam = params.get('rain');
    const rain = rainParam === null ? 35 : Number(rainParam);
    if (rainParam !== null && (!rainParam.trim() || !Number.isFinite(rain) || rain < 0 || rain > 200)) {
      return sendJson(res, { error: 'Lượng mưa phải nằm trong khoảng 0–200 mm/h.' }, 400);
    }

    const simulated = data => ({ ...data, data_mode: 'simulation', validated: false });

    switch (pathname) {
      case '/health':
        return sendJson(res, { app: 'hadong-flood-lab', version: 2 });

      case '/weather':
        return sendJson(res, await getWeather());

      case '/flood-data':
        return sendJson(res, { ...loadGisData(), data_mode: 'reference' });

      case '/ai-forecast': {
        const horizon = params.get('horizon') || '+1h';
        if (!['+30m', '+1h', '+2h', '+3h'].includes(horizon)) {
          return sendJson(res, { error: 'Khoảng mô phỏng không hợp lệ.' }, 400);
        }
        const forecast = getAiForecast(horizon, rain);
        forecast.average_confidence_pct = null;
        forecast.top_hotspot.confidence_pct = null;
        forecast.predictions.forEach(p => { p.confidence_pct = null; });
        return sendJson(res, simulated(forecast));
      }

      case '/dashboard':
        return sendJson(res, simulated(getDashboardData(rain)));

      case '/alerts':
        return sendJson(res, simulated(getEarlyAlerts(rain)));

      case '/timeline':
        return sendJson(res, simulated(getTimelineSimulation()));

      case '/search': {
        const q = (params.get('q') || '').trim();
        if (q.length < 2 || q.length > 160) {
          return sendJson(res, { error: 'Nhập tên địa điểm từ 2 đến 160 ký tự.' }, 400);
        }
        const horizon = params.get('horizon') || '+1h';
        if (!['+30m', '+1h', '+2h', '+3h'].includes(horizon)) {
          return sendJson(res, { error: 'Khoảng mô phỏng không hợp lệ.' }, 400);
        }
        const result = searchLocationRisk(q, rain, horizon);
        if (!result) return sendJson(res, { error: 'Không tìm thấy địa điểm.' }, 404);
        return sendJson(res, simulated({ ...result, confidence_pct: null }));
      }

      case '/routing': {
        const from = params.get('from') || 'Bệnh viện 103';
        const to = params.get('to') || 'KĐT Văn Phú';
        if (!/103/.test(from) || !/văn phú|van phu/i.test(to)) {
          return sendJson(res, { error: 'Chỉ có tuyến mẫu Bệnh viện 103 → KĐT Văn Phú.' }, 422);
        }
        return sendJson(res, simulated(getAvoidanceRoutes(from, to)));
      }

      case '/solutions':
        return sendJson(res, { items: getActionableSolutions(), data_mode: 'simulation', validated: false });

      case '/community-reports': {
        if (req.method !== 'POST') {
          return sendJson(res, loadReports().map(r => ({ ...r, status: 'unverified', votes: 0 })));
        }
        const ct = req.headers['content-type'] || '';
        if (!ct.startsWith('application/json')) {
          return sendJson(res, { error: 'Nội dung phải là JSON.' }, 415);
        }
        // Vercel auto-parses JSON body when Content-Type is application/json
        const report = req.body;
        if (!report || typeof report !== 'object') {
          return sendJson(res, { error: 'JSON không hợp lệ.' }, 400);
        }
        try {
          return sendJson(res, { success: true, report: saveReport(report) }, 201);
        } catch (error) {
          return sendJson(res, { error: error.code ? 'Không lưu được báo cáo.' : error.message }, error.code ? 500 : 400);
        }
      }

      default:
        return sendJson(res, { error: 'Không tìm thấy API.' }, 404);
    }
  } catch (error) {
    console.error('[API Error]', error);
    return sendJson(res, { error: 'Dịch vụ dữ liệu chưa phản hồi. Vui lòng thử lại.' }, 502);
  }
}
