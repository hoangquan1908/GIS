import { randomUUID } from 'node:crypto';
import { matchLocation, validateReport } from './public/app-utils.js';
/**
 * Flood Intelligence Engine for Hà Đông Flood Lab
 * Provides AI prediction, risk assessment, early warning thresholds,
 * timeline simulations, safe routing, and automated response recommendations.
 */

import { readFileSync, writeFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sitesPath = path.join(__dirname, 'data', 'sites.geojson');
const layersPath = path.join(__dirname, 'data', 'gis-layers.geojson');
const reportsPath = path.join(__dirname, 'data', 'community-reports.json');

export function loadGisData() {
  const sites = JSON.parse(readFileSync(sitesPath, 'utf8'));
  const layers = JSON.parse(readFileSync(layersPath, 'utf8'));
  return { sites, layers };
}

export function loadReports(file = reportsPath) {
  try {
    const reports=JSON.parse(readFileSync(file,'utf8'));
    if(!Array.isArray(reports))throw new Error('Invalid report storage.');
    return reports;
  } catch(error) {
    if(error.code==='ENOENT')return [];
    const failure=new Error('Không đọc được dữ liệu báo cáo hiện tại; tệp được giữ nguyên.');
    failure.code='INVALID_REPORT_STORAGE';
    throw failure;
  }
}

export function saveReport(report, file = reportsPath) {
  const validated=validateReport(report);
  const reports=loadReports(file);
  const newReport={...validated,id:'rep-'+randomUUID(),reported_at:new Date().toISOString(),status:'unverified',votes:0};
  reports.unshift(newReport);
  const temporary=file+'.'+randomUUID()+'.tmp';
  try {
    writeFileSync(temporary,JSON.stringify(reports,null,2),'utf8');
    renameSync(temporary,file);
  } finally {
    if(existsSync(temporary))unlinkSync(temporary);
  }
  return newReport;
}

/**
 * Predict flood depth, start time, and risk level based on horizon and rain.
 * Horizon: '+30m', '+1h', '+2h', '+3h'
 */
export function getAiForecast(horizon = '+1h', currentRainRate = 35) {
  const { sites } = loadGisData();
  const hKey = horizon.replace(/\s+/g, '').toLowerCase();

  const horizonMultiplier = {
    '+30m': { rainFactor: 0.85, conf: 91, timeOffset: 30, depthFactor: 0.9 },
    '+1h': { rainFactor: 1.0, conf: 86, timeOffset: 60, depthFactor: 1.1 },
    '+2h': { rainFactor: 1.25, conf: 82, timeOffset: 120, depthFactor: 1.35 },
    '+3h': { rainFactor: 1.15, conf: 78, timeOffset: 180, depthFactor: 1.2 }
  }[hKey] || { rainFactor: 1.0, conf: 82, timeOffset: 60, depthFactor: 1.0 };

  const now = new Date();
  const targetTime = new Date(now.getTime() + horizonMultiplier.timeOffset * 60000);
  const targetTimeStr = `${String(targetTime.getHours()).padStart(2, '0')}:${String(targetTime.getMinutes()).padStart(2, '0')}`;

  const predictions = sites.features.map(feature => {
    const p = feature.properties;
    const baseDepth = p.base_depth_cm || 20;
    const historicalMax = p.historical_max_depth_cm || 45;
    
    // Physical runoff model: lower elevation = higher runoff collection
    const elevationPenalty = Math.max(0, (6.2 - p.elevation_m) * 4.5);
    const rainImpact = (currentRainRate / 30) * horizonMultiplier.rainFactor;

    let predictedDepth = Math.round((baseDepth * horizonMultiplier.depthFactor + elevationPenalty) * rainImpact);
    predictedDepth = Math.min(predictedDepth, Math.round(historicalMax * 1.05));
    predictedDepth = Math.max(0, predictedDepth);

    const minDepth = Math.max(0, predictedDepth - Math.round(predictedDepth * 0.15));
    const maxDepth = predictedDepth + Math.round(predictedDepth * 0.15);

    let riskLevel = 'low';
    let riskLabel = 'Thấp';
    if (predictedDepth >= 40) {
      riskLevel = 'very_high';
      riskLabel = 'Rất cao';
    } else if (predictedDepth >= 25) {
      riskLevel = 'high';
      riskLabel = 'Cao';
    } else if (predictedDepth >= 15) {
      riskLevel = 'medium';
      riskLabel = 'Trung bình';
    }

    // Expected flood start time
    const startMins = p.start_offset_min || 30;
    const startTime = new Date(now.getTime() + startMins * 60000);
    const startTimeStr = `${String(startTime.getHours()).padStart(2, '0')}:${String(startTime.getMinutes()).padStart(2, '0')}`;

    return {
      id: p.id,
      name: p.name,
      street: p.street,
      ward: p.ward,
      coordinates: feature.geometry.coordinates,
      risk_level: riskLevel,
      risk_label: riskLabel,
      depth_min_cm: minDepth,
      depth_max_cm: maxDepth,
      depth_range_text: `${minDepth}–${maxDepth} cm`,
      start_time: startTimeStr,
      confidence_pct: Math.min(95, Math.max(65, horizonMultiplier.conf + (p.elevation_m < 5.0 ? 3 : -2))),
      note: p.note,
      solution: p.solution
    };
  });

  // Hotspot with highest predicted depth
  const topHotspot = [...predictions].sort((a, b) => b.depth_max_cm - a.depth_max_cm)[0];

  return {
    horizon: hKey,
    target_time: targetTimeStr,
    average_confidence_pct: horizonMultiplier.conf,
    top_hotspot: {
      name: topHotspot.name,
      risk_label: topHotspot.risk_label,
      depth_range_text: topHotspot.depth_range_text,
      start_time: topHotspot.start_time,
      confidence_pct: topHotspot.confidence_pct
    },
    predictions
  };
}

/**
 * Early warning level determination
 * Returns: { level: 'normal'|'advisory'|'warning'|'danger', label, message, affected_count }
 */
export function getEarlyAlerts(rainRate = 38) {
  const { sites } = loadGisData();
  const forecast = getAiForecast('+1h', rainRate);
  
  const highRisk = forecast.predictions.filter(p => p.risk_level === 'high' || p.risk_level === 'very_high');
  const veryHighRisk = forecast.predictions.filter(p => p.risk_level === 'very_high');

  let level = 'normal';
  let label = 'Bình thường';
  let color = '#166451';
  let banner = 'Hệ thống thoát nước hoạt động ổn định. Không ghi nhận điểm ngập nguy hiểm.';

  if (veryHighRisk.length >= 2 || highRisk.length >= 6 || rainRate >= 50) {
    level = 'danger';
    label = 'Nguy hiểm (Báo động cấp 3)';
    color = '#dc2626';
    banner = `BÁO ĐỘNG ĐỎ: Đang có ${veryHighRisk.length} điểm ngập rất sâu (>40cm). Nguy cơ tê liệt trục Nguyễn Trãi - Ba La và Lê Trọng Tấn!`;
  } else if (highRisk.length >= 3 || rainRate >= 30) {
    level = 'warning';
    label = 'Cảnh báo (Báo động cấp 2)';
    color = '#ea580c';
    banner = `CẢNH BÁO: Mưa lớn dồn dập, ${highRisk.length} khu vực có nguy cơ ngập sâu 25–40cm. Cân nhắc đổi lộ trình.`;
  } else if (highRisk.length >= 1 || rainRate >= 15) {
    level = 'advisory';
    label = 'Chú ý (Báo động cấp 1)';
    color = '#d97706';
    banner = 'CHÚ Ý: Xuất hiện ngập cục bộ tại một số tuyến đường trũng thấp ven hồ và chân dốc.';
  }

  return {
    level,
    label,
    color,
    banner,
    affected_count: highRisk.length,
    critical_spots: veryHighRisk.map(v => v.name),
    river_status: {
      river_name: 'Sông Nhuệ (Trạm Cầu Đơ - Hà Đông)',
      water_level_m: 4.85,
      alert_stage: 'Báo động II (4.85m / 5.00m)',
      trend: 'Đang dâng chậm (+3cm/h)'
    },
    pumping_stations: {
      yen_nghia: 'Trạm bơm Yên Nghĩa: Vận hành 7/10 tổ máy (120 m³/s xả Sông Đáy)',
      cau_do: 'Trạm bơm Cầu Đơ: 4/4 tổ máy đang chạy hết công suất'
    }
  };
}

/**
 * Management Dashboard KPI metrics and historical time-series trends
 */
export function getDashboardData(rainRate = 35) {
  const { sites } = loadGisData();
  const forecast = getAiForecast('+1h', rainRate);

  const currentlyFlooded = forecast.predictions.filter(p => p.depth_max_cm >= 20).length;
  const highRiskCount = forecast.predictions.filter(p => p.risk_level === 'high' || p.risk_level === 'very_high').length;
  const totalFloodedAreaHa = Number((currentlyFlooded * 1.15 + (rainRate / 20) * 2.8).toFixed(1));

  // Time trends for 1h, 3h, 6h, 24h
  const trends = {
    '1h': [
      { time: '14:00', rain_mm: 12, water_level_m: 4.60, flooded_count: 3 },
      { time: '14:15', rain_mm: 22, water_level_m: 4.68, flooded_count: 5 },
      { time: '14:30', rain_mm: 36, water_level_m: 4.75, flooded_count: 8 },
      { time: '14:45', rain_mm: 42, water_level_m: 4.82, flooded_count: 10 },
      { time: '15:00', rain_mm: 35, water_level_m: 4.85, flooded_count: 9 }
    ],
    '3h': [
      { time: '12:00', rain_mm: 4, water_level_m: 4.45, flooded_count: 0 },
      { time: '13:00', rain_mm: 15, water_level_m: 4.55, flooded_count: 3 },
      { time: '14:00', rain_mm: 38, water_level_m: 4.72, flooded_count: 7 },
      { time: '15:00', rain_mm: 35, water_level_m: 4.85, flooded_count: 9 }
    ],
    '6h': [
      { time: '09:00', rain_mm: 0, water_level_m: 4.30, flooded_count: 0 },
      { time: '11:00', rain_mm: 8, water_level_m: 4.40, flooded_count: 1 },
      { time: '13:00', rain_mm: 25, water_level_m: 4.60, flooded_count: 4 },
      { time: '15:00', rain_mm: 35, water_level_m: 4.85, flooded_count: 9 }
    ],
    '24h': [
      { time: '16:00 (hqua)', rain_mm: 2, water_level_m: 4.25, flooded_count: 0 },
      { time: '22:00', rain_mm: 0, water_level_m: 4.20, flooded_count: 0 },
      { time: '04:00', rain_mm: 5, water_level_m: 4.30, flooded_count: 0 },
      { time: '10:00', rain_mm: 12, water_level_m: 4.45, flooded_count: 2 },
      { time: '15:00 (nay)', rain_mm: 35, water_level_m: 4.85, flooded_count: 9 }
    ]
  };

  return {
    metrics: {
      currently_flooded_points: currentlyFlooded,
      high_risk_points: highRiskCount,
      current_rain_mm_h: rainRate,
      rain_24h_total_mm: 78.5,
      river_water_level_m: 4.85,
      river_threshold_alert2_m: 5.0,
      risk_area_ha: totalFloodedAreaHa
    },
    trends
  };
}

/**
 * Timeline simulation for 14:00 → 15:00 → 16:00 → 17:00 → 18:00
 * Demonstrates flood spreading and receding dynamics.
 */
export function getTimelineSimulation() {
  const { sites } = loadGisData();

  const timelineSteps = [
    {
      hour: '14:00',
      label: '14:00 - Mưa rào bắt đầu',
      rain_rate_mm: 18,
      status_desc: 'Mưa dồn dập tại lưu vực phía Bắc Hà Đông, nước bắt đầu tích tụ ở các phễu thu.',
      spread_multiplier: 0.6,
      depth_multiplier: 0.5,
      active_ha: 4.2
    },
    {
      hour: '15:00',
      label: '15:00 - Mưa lớn dồn dập',
      rain_rate_mm: 45,
      status_desc: 'Lượng mưa đạt đỉnh, xuất hiện ngập sâu tại Hầm chui Nguyễn Trãi, Ba La, Văn Quán.',
      spread_multiplier: 1.0,
      depth_multiplier: 1.0,
      active_ha: 14.5
    },
    {
      hour: '16:00',
      label: '16:00 - Đỉnh triều & ngập cực đại',
      rain_rate_mm: 32,
      status_desc: 'Mực nước Sông Nhuệ dâng cao, vùng ngập lan rộng sang các ngõ xóm và trục đường gom.',
      spread_multiplier: 1.3,
      depth_multiplier: 1.15,
      active_ha: 18.2
    },
    {
      hour: '17:00',
      label: '17:00 - Mưa giảm, trạm bơm Yên Nghĩa hút nước',
      rain_rate_mm: 12,
      status_desc: 'Trạm bơm Yên Nghĩa chạy hết công suất 10 tổ máy, nước rút dần 10–15 cm tại trục chính.',
      spread_multiplier: 0.85,
      depth_multiplier: 0.75,
      active_ha: 10.4
    },
    {
      hour: '18:00',
      label: '18:00 - Nước cơ bản rút hết',
      rain_rate_mm: 2,
      status_desc: 'Giao thông trục Quang Trung và Nguyễn Trãi hồi phục, chỉ còn đọng nước cục bộ ở ngõ trũng.',
      spread_multiplier: 0.35,
      depth_multiplier: 0.3,
      active_ha: 2.8
    }
  ];

  const steps = timelineSteps.map(step => {
    const stepSites = sites.features.map(f => {
      const p = f.properties;
      const calcDepth = Math.round(p.base_depth_cm * step.depth_multiplier);
      const radiusM = Math.round((calcDepth > 10 ? calcDepth * 6 : 40) * step.spread_multiplier);
      
      let level = 'low';
      if (calcDepth >= 40) level = 'very_high';
      else if (calcDepth >= 25) level = 'high';
      else if (calcDepth >= 15) level = 'medium';

      return {
        id: p.id,
        name: p.name,
        coordinates: f.geometry.coordinates,
        depth_cm: calcDepth,
        radius_meters: radiusM,
        risk_level: level
      };
    });

    return {
      hour: step.hour,
      label: step.label,
      rain_rate_mm: step.rain_rate_mm,
      status_desc: step.status_desc,
      active_ha: step.active_ha,
      sites: stepSites
    };
  });

  return { timeline: steps };
}

/**
 * Address / Location lookup
 * Matches queries like "Nguyễn Trãi, Hà Đông", "Trần Phú", "Văn Quán", "Ba La", etc.
 */
export function searchLocationRisk(queryStr, rainRate = 35, horizon = '+1h') {
  if (!queryStr || typeof queryStr !== 'string') return null;
  const forecast = getAiForecast(horizon, rainRate);
  const matchedSite = matchLocation(forecast.predictions, queryStr);
  if (!matchedSite) return null;
  return {
    query: queryStr,
    matched_location: matchedSite.name,
    street: matchedSite.street,
    ward: matchedSite.ward,
    coordinates: matchedSite.coordinates,
    risk_level: matchedSite.risk_level,
    risk_label: matchedSite.risk_label,
    depth_range_text: matchedSite.depth_range_text,
    expected_start_time: matchedSite.start_time,
    confidence_pct: matchedSite.confidence_pct,
    safety_advisory: matchedSite.risk_level === 'very_high'
      ? 'Đoạn đường nguy cơ ngập sâu >40cm, không di chuyển qua bằng xe máy hoặc ô tô gầm thấp!'
      : matchedSite.risk_level === 'high'
      ? 'Nguy cơ ngập 25–35cm, đi chậm làn tim đường hoặc chọn tuyến tránh an toàn.'
      : 'Khu vực tương đối an toàn, lưu ý mặt đường trơn ướt và giảm tốc độ.'
  };
}

export const ROUTE_PRESETS = {
  route_1: {
    id: 'route_1',
    name: 'Tuyến 1: Bệnh viện 103 (Phùng Hưng) ⇄ KĐT Văn Phú',
    origin: 'Bệnh viện 103 (Phùng Hưng)',
    destination: 'KĐT Văn Phú (Hà Đông)',
    regular_route: {
      name: 'Tuyến ngắn nhất (Đường Phùng Hưng - Cầu Bươu - Xa La)',
      distance_km: 4.8,
      duration_min: 28,
      is_flooded: true,
      flood_spots: [
        { name: 'Đoạn cổng Bệnh viện 103', depth: '28 cm', risk: 'Cao' },
        { name: 'Cổng KĐT Xa La', depth: '35 cm', risk: 'Rất cao' }
      ],
      warning_msg: 'CẢNH BÁO: Đoạn qua Xa La và Viện 103 đang ngập sâu tới 35cm, nguy cơ chết máy cao.',
      path: [
        [105.7905, 20.9635],
        [105.7930, 20.9610],
        [105.7968, 20.9582],
        [105.7850, 20.9550],
        [105.7720, 20.9540],
        [105.7665, 20.9548]
      ]
    },
    safe_route: {
      name: 'Tuyến tránh ngập an toàn (Phùng Hưng → Cầu Trắng → Tô Hiệu → KĐT Văn Phú)',
      distance_km: 5.4,
      duration_min: 16,
      is_flooded: false,
      elevation_status: 'Cốt nền cao, hệ thống thoát nước thông thoáng, không ngập',
      recommendation: 'Lộ trình khuyến nghị: Dù dài hơn 600m nhưng đi qua trục Tô Hiệu không ngập nước, tiết kiệm 12 phút tránh kẹt xe.',
      path: [
        [105.7905, 20.9635],
        [105.7845, 20.9710],
        [105.7802, 20.9780],
        [105.7742, 20.9632],
        [105.7680, 20.9590],
        [105.7665, 20.9548]
      ]
    }
  },
  route_2: {
    id: 'route_2',
    name: 'Tuyến 2: Ngã tư Sở / Nguyễn Trãi ⇄ Bến xe Yên Nghĩa',
    origin: 'Ngã tư Sở (Nguyễn Trãi)',
    destination: 'Bến xe Yên Nghĩa (Quang Trung)',
    regular_route: {
      name: 'Tuyến ngắn nhất (Nguyễn Trãi - Trần Phú - Quang Trung)',
      distance_km: 9.2,
      duration_min: 45,
      is_flooded: true,
      flood_spots: [
        { name: 'Hầm chui Nguyễn Trãi - Khuất Duy Tiến', depth: '45 cm', risk: 'Rất cao' },
        { name: 'Ngã ba Ba La', depth: '35 cm', risk: 'Rất cao' }
      ],
      warning_msg: 'CẢNH BÁO: Hầm chui Nguyễn Trãi và Ngã ba Ba La ngập 35–45cm, nguy cơ ngập lụt nghiêm trọng.',
      path: [
        [105.8150, 20.9980],
        [105.8030, 20.9890],
        [105.7840, 20.9740],
        [105.7680, 20.9630],
        [105.7520, 20.9540],
        [105.7430, 20.9510]
      ]
    },
    safe_route: {
      name: 'Tuyến tránh ngập an toàn (Nguyễn Trãi → Tố Hữu → Lê Trọng Tấn → BX Yên Nghĩa)',
      distance_km: 10.5,
      duration_min: 22,
      is_flooded: false,
      elevation_status: 'Trục Tố Hữu - Lê Trọng Tấn thoát nước tốt, cốt nền cao, không ngập',
      recommendation: 'Lộ trình khuyến nghị: Tránh hoàn toàn 2 điểm nghẽn Hầm chui và Ba La, tiết kiệm 23 phút di chuyển.',
      path: [
        [105.8150, 20.9980],
        [105.8080, 21.0060],
        [105.7850, 20.9850],
        [105.7650, 20.9720],
        [105.7480, 20.9580],
        [105.7430, 20.9510]
      ]
    }
  },
  route_3: {
    id: 'route_3',
    name: 'Tuyến 3: KĐT Dương Nội ⇄ Cầu Trắng (Trung tâm Hà Đông)',
    origin: 'KĐT Dương Nội (Tố Hữu)',
    destination: 'Cầu Trắng (Hà Đông)',
    regular_route: {
      name: 'Tuyến truyền thống (Lê Trọng Tấn → Quang Trung → Cầu Trắng)',
      distance_km: 5.1,
      duration_min: 32,
      is_flooded: true,
      flood_spots: [
        { name: 'Cầu La Khê & Nút giao Lê Trọng Tấn', depth: '30 cm', risk: 'Cao' }
      ],
      warning_msg: 'CẢNH BÁO: Điểm trũng Cầu La Khê dâng nước 30cm, giao thông ùn ứ.',
      path: [
        [105.7470, 20.9750],
        [105.7550, 20.9660],
        [105.7680, 20.9630],
        [105.7780, 20.9720],
        [105.7802, 20.9780]
      ]
    },
    safe_route: {
      name: 'Tuyến tránh ngập an toàn (Tố Hữu → Vạn Phúc → Phố Lụa → Cầu Trắng)',
      distance_km: 4.9,
      duration_min: 15,
      is_flooded: false,
      elevation_status: 'Tuyến Làng Lụa Vạn Phúc gò đồi cao ráo, hệ thống thoát nước tự nhiên tốt',
      recommendation: 'Lộ trình khuyến nghị: Đi qua trục Vạn Phúc - Phố Lụa vừa ngắn hơn 200m vừa không ngập, tiết kiệm 17 phút di chuyển.',
      path: [
        [105.7470, 20.9750],
        [105.7620, 20.9810],
        [105.7730, 20.9820],
        [105.7802, 20.9780]
      ]
    }
  },
  route_4: {
    id: 'route_4',
    name: 'Tuyến 4: KĐT Mộ Lao ⇄ Ngã ba Ba La',
    origin: 'KĐT Mộ Lao',
    destination: 'Ngã ba Ba La',
    regular_route: {
      name: 'Tuyến trực diện (Trần Phú → Quang Trung → Ba La)',
      distance_km: 6.2,
      duration_min: 35,
      is_flooded: true,
      flood_spots: [
        { name: 'Ngã ba Ba La', depth: '35 cm', risk: 'Rất cao' }
      ],
      warning_msg: 'CẢNH BÁO: Khu vực ngã ba Ba La ngập 35cm, phương tiện cơ giới khó di chuyển.',
      path: [
        [105.7860, 20.9810],
        [105.7780, 20.9720],
        [105.7680, 20.9630],
        [105.7520, 20.9540]
      ]
    },
    safe_route: {
      name: 'Tuyến tránh ngập an toàn (Mộ Lao → Tố Hữu → Lê Trọng Tấn kéo dài → Ba La)',
      distance_km: 6.8,
      duration_min: 18,
      is_flooded: false,
      elevation_status: 'Đường vành đai Tố Hữu - Lê Trọng Tấn phân lưu nhanh, nền đường cao',
      recommendation: 'Lộ trình khuyến nghị: Tránh hoàn toàn nút ngập Ba La, di chuyển an toàn hơn.',
      path: [
        [105.7860, 20.9810],
        [105.7750, 20.9860],
        [105.7600, 20.9750],
        [105.7480, 20.9580],
        [105.7520, 20.9540]
      ]
    }
  }
};

/**
 * Smart Avoidance Routing:
 * Calculates standard route (passing flooded spots) vs safe alternative route
 */
export function getAvoidanceRoutes(originName = 'Bệnh viện 103 (Phùng Hưng)', destName = 'KĐT Văn Phú (Hà Đông)') {
  let presetKey = 'route_1';
  if (originName && ROUTE_PRESETS[originName]) {
    presetKey = originName;
  } else if (originName || destName) {
    const combined = `${originName || ''} ${destName || ''}`.toLowerCase();
    if (combined.includes('yên nghĩa') || combined.includes('yen nghia') || combined.includes('ngã tư sở') || combined.includes('nga tu so')) {
      presetKey = 'route_2';
    } else if (combined.includes('dương nội') || combined.includes('duong noi')) {
      presetKey = 'route_3';
    } else if (combined.includes('mộ lao') || combined.includes('mo lao') || combined.includes('ba la')) {
      presetKey = 'route_4';
    } else {
      presetKey = 'route_1';
    }
  }
  const preset = ROUTE_PRESETS[presetKey];
  return {
    id: preset.id,
    origin: (originName && !ROUTE_PRESETS[originName]) ? originName : preset.origin,
    destination: destName || preset.destination,
    regular_route: { ...preset.regular_route },
    safe_route: { ...preset.safe_route }
  };
}

/**
 * AI 24-Hour Rain Analysis & Traffic Forecast
 */
export function getAiRain24hAnalysis(weatherData, now = Date.now()) {
  if (!weatherData?.hourly?.time || !Array.isArray(weatherData.hourly.time)) {
    return {
      available: false,
      will_rain: false,
      total_rain_mm: 0,
      max_prob_pct: 0,
      intensity_label: 'Chưa có dữ liệu',
      status_title: 'Đang kết nối dữ liệu dự báo...',
      ai_summary: 'Chưa có dữ liệu thời tiết để phân tích dự báo 24 giờ tới.',
      periods: [],
      peak_window: '—',
      traffic_advisory: 'Kiểm tra lại kết nối mạng để tải dữ liệu dự báo thời tiết.',
      flood_risk_level: 'low'
    };
  }

  const { time, precipitation, precipitation_probability } = weatherData.hourly;
  const upcomingHours = [];
  
  for (let i = 0; i < time.length; i++) {
    const t = time[i];
    const itemEpoch = (t.endsWith('Z') || t.includes('+')) ? new Date(t).getTime() : new Date(t + '+07:00').getTime();
    if (itemEpoch >= now) {
      const rainVal = (typeof precipitation[i] === 'number' && Number.isFinite(precipitation[i]) && precipitation[i] >= 0) ? precipitation[i] : null;
      const probVal = (Array.isArray(precipitation_probability) && typeof precipitation_probability[i] === 'number' && Number.isFinite(precipitation_probability[i])) ? precipitation_probability[i] : 0;
      upcomingHours.push({
        time: t,
        hour_str: t.slice(11, 16),
        rain: rainVal,
        prob: probVal
      });
      if (upcomingHours.length === 24) break;
    }
  }

  if (upcomingHours.length === 0) {
    return {
      available: false,
      will_rain: false,
      total_rain_mm: 0,
      max_prob_pct: 0,
      intensity_label: 'Thiếu dữ liệu',
      status_title: 'Dữ liệu dự báo ngoài khung giờ',
      ai_summary: 'Không có bản tin dự báo tương thích trong 24 giờ tới.',
      periods: [],
      peak_window: '—',
      traffic_advisory: 'Vui lòng nhấn Cập nhật dữ liệu để làm mới bản tin thời tiết.',
      flood_risk_level: 'low'
    };
  }

  let totalRain = 0;
  let maxRain = 0;
  let maxRainHour = null;
  let maxProb = 0;

  upcomingHours.forEach(h => {
    if (h.rain !== null) {
      totalRain += h.rain;
      if (h.rain > maxRain) {
        maxRain = h.rain;
        maxRainHour = h;
      }
    }
    if (h.prob > maxProb) {
      maxProb = h.prob;
    }
  });

  totalRain = Number(totalRain.toFixed(1));
  const willRain = Boolean(totalRain >= 0.5 || maxProb >= 40 || (maxRainHour && maxRainHour.rain >= 0.5));

  let intensityLabel = 'Không mưa';
  let floodRiskLevel = 'safe';
  if (totalRain >= 50 || maxRain >= 30) {
    intensityLabel = 'Mưa rất to · Nguy cơ ngập diện rộng';
    floodRiskLevel = 'critical';
  } else if (totalRain >= 25 || maxRain >= 15) {
    intensityLabel = 'Mưa to dồn dập · Nguy cơ ngập cục bộ cao';
    floodRiskLevel = 'high';
  } else if (totalRain >= 8 || maxRain >= 5) {
    intensityLabel = 'Mưa vừa · Xuất hiện điểm ứ đọng nước';
    floodRiskLevel = 'moderate';
  } else if (willRain) {
    intensityLabel = 'Mưa nhỏ rải rác · Đường trơn ướt';
    floodRiskLevel = 'low';
  }

  let statusTitle = '';
  if (!willRain) {
    statusTitle = 'Dự báo: 24h tới KHÔNG MƯA hoặc mưa không đáng kể';
  } else if (totalRain >= 30) {
    statusTitle = `CẢNH BÁO: 24h tới CÓ MƯA LỚN (${totalRain} mm, xác suất ${maxProb}%)`;
  } else {
    statusTitle = `Dự báo: 24h tới CÓ MƯA (${totalRain} mm, xác suất mưa ${maxProb}%)`;
  }

  let peakWindow = 'Không có đỉnh mưa đáng kể';
  if (maxRainHour && maxRainHour.rain >= 1.0) {
    peakWindow = `${maxRainHour.hour_str} (đạt ${maxRainHour.rain} mm/h)`;
  }

  const periodBuckets = {
    morning: { rain: 0, maxProb: 0, count: 0 },
    afternoon: { rain: 0, maxProb: 0, count: 0 },
    night: { rain: 0, maxProb: 0, count: 0 }
  };

  upcomingHours.forEach(h => {
    const hourNum = parseInt(h.hour_str.split(':')[0], 10);
    let key = 'night';
    if (hourNum >= 6 && hourNum < 12) key = 'morning';
    else if (hourNum >= 12 && hourNum < 18) key = 'afternoon';

    if (h.rain !== null) periodBuckets[key].rain += h.rain;
    if (h.prob > periodBuckets[key].maxProb) periodBuckets[key].maxProb = h.prob;
    periodBuckets[key].count++;
  });

  const periods = [
    {
      slot: 'morning',
      name: 'Buổi sáng (06h - 12h)',
      icon: periodBuckets.morning.rain >= 5 ? '🌧️' : periodBuckets.morning.rain > 0 ? '🌦️' : '⛅',
      rain_mm: Number(periodBuckets.morning.rain.toFixed(1)),
      prob_pct: periodBuckets.morning.maxProb,
      desc: periodBuckets.morning.rain >= 10 ? 'Nguy cơ ngập giờ cao điểm đi làm' : periodBuckets.morning.rain > 0 ? 'Mưa rải rác, đường ướt' : 'Tạnh ráo, thuận lợi'
    },
    {
      slot: 'afternoon',
      name: 'Buổi chiều (12h - 18h)',
      icon: periodBuckets.afternoon.rain >= 5 ? '🌧️' : periodBuckets.afternoon.rain > 0 ? '🌦️' : '⛅',
      rain_mm: Number(periodBuckets.afternoon.rain.toFixed(1)),
      prob_pct: periodBuckets.afternoon.maxProb,
      desc: periodBuckets.afternoon.rain >= 10 ? 'Nguy cơ ngập giờ tan tầm cao' : periodBuckets.afternoon.rain > 0 ? 'Có mưa rào cục bộ' : 'Tạnh ráo, thuận lợi'
    },
    {
      slot: 'night',
      name: 'Tối & Đêm (18h - 06h)',
      icon: periodBuckets.night.rain >= 5 ? '🌧️' : periodBuckets.night.rain > 0 ? '🌦️' : '🌙',
      rain_mm: Number(periodBuckets.night.rain.toFixed(1)),
      prob_pct: periodBuckets.night.maxProb,
      desc: periodBuckets.night.rain >= 10 ? 'Mưa đêm kéo dài, cần chú ý hầm xe' : periodBuckets.night.rain > 0 ? 'Mưa nhỏ rải rác' : 'Thời tiết khô ráo'
    }
  ];

  let aiSummary = '';
  let trafficAdvisory = '';

  if (!willRain) {
    aiSummary = `Hệ thống AI phân tích trong 24 giờ tới tại Hà Đông thời tiết duy trì trạng thái khô ráo, xác suất có mưa cao nhất chỉ ${maxProb}%, tổng lượng mưa ước tính 0.0 mm. Nguy cơ ngập úng mặt đường bằng 0%.`;
    trafficAdvisory = 'Giao thông toàn quận Hà Đông thông suốt. Các phương tiện di chuyển bình thường trên mọi trục đường chính và các hầm chui.';
  } else if (totalRain >= 25 || maxRain >= 15) {
    aiSummary = `Hệ thống AI cảnh báo trong 24 giờ tới Hà Đông sẽ có mưa lớn dồn dập với tổng lượng mưa đạt khoảng ${totalRain} mm (xác suất mưa lên tới ${maxProb}%). Đỉnh mưa dự kiến xuất hiện vào khung giờ ${peakWindow}. Lượng mưa này vượt ngưỡng thoát nước tự nhiên của đô thị Hà Đông.`;
    trafficAdvisory = 'CẢNH BÁO GIAO THÔNG: Nguy cơ ngập sâu 20–45cm tại các điểm đen (Hầm chui Nguyễn Trãi, Ba La, Xa La, cổng Viện 103). Khuyến nghị người dân sử dụng tuyến tránh an toàn, không cố vượt qua vùng ngập sâu bằng xe máy hay ô tô gầm thấp.';
  } else {
    aiSummary = `Hệ thống AI nhận định trong 24 giờ tới khu vực Hà Đông có mưa với tổng lượng tích lũy khoảng ${totalRain} mm, xác suất mưa đạt ${maxProb}%. Mưa rải rác với cường độ vừa phải, chưa đủ gây tê liệt diện rộng nhưng có thể ứ đọng tại một số điểm trũng.`;
    trafficAdvisory = 'LƯU Ý LƯU THÔNG: Mặt đường trơn ướt và tầm nhìn hạn chế trong các đợt mưa rào. Hãy giảm tốc độ, giữ khoảng cách an toàn và chủ động mang áo mưa khi tham gia giao thông.';
  }

  return {
    available: true,
    will_rain: willRain,
    total_rain_mm: totalRain,
    max_prob_pct: maxProb,
    intensity_label: intensityLabel,
    status_title: statusTitle,
    ai_summary: aiSummary,
    peak_window: peakWindow,
    periods,
    traffic_advisory: trafficAdvisory,
    flood_risk_level: floodRiskLevel
  };
}

/**
 * Automated actionable recommendations based on situation
 */
export function getActionableSolutions(rainRate = 35) {
  return [
    {
      category: 'Cảnh báo nhân dân & Người tham gia giao thông',
      priority: 'Khẩn cấp',
      icon: '🚗',
      color: '#dc2626',
      actions: [
        'Hạn chế phương tiện đi vào Hầm chui Nguyễn Trãi - Khuất Duy Tiến, ngã ba Ba La, và cổng KĐT Xa La khi mưa lớn (>30 mm/h).',
        'Cư dân các chung cư tại KĐT Văn Quán, Xa La, Mộ Lao chủ động di chuyển ô tô ra khỏi tầng hầm thấp lên khu vực bãi nổi an toàn.',
        'Sử dụng các tuyến tránh cao ráo theo AI khuyến nghị: Tuyến Cầu Trắng - Tô Hiệu, đường đôi 24m KĐT Văn Phú, trục Tố Hữu.',
        'Theo dõi ứng dụng Hà Đông Flood Lab để cập nhật thời gian thực các điểm ngập trước khi xuất phát.'
      ]
    },
    {
      category: 'Vận hành hạ tầng & Tiêu thoát nước',
      priority: 'Ưu tiên 1',
      icon: '🛟',
      color: '#ea580c',
      actions: [
        'Kích hoạt tối đa 10/10 tổ máy Trạm bơm Yên Nghĩa (công suất 120 m³/s) để hạ thấp tối đa mực nước Kênh La Khê xả ra Sông Đáy.',
        'Trạm bơm Cầu Đơ và Đa Sỹ vận hành liên tục 4 tổ máy tiêu nước nội thị vùng lõi Hà Đông ra sông Nhuệ.',
        'Công nhân Xí nghiệp thoát nước số 8 túc trực tại 16 điểm ngập trọng yếu, mở nắp cống thu có rào chắn bảo vệ và vớt rác rào chắn.',
        'Hạ cống điều tiết các hồ điều hòa (Hồ Văn Quán, Hồ Đầm Khê, Hồ Mộ Lao) về mực nước chết trước 2–3 giờ để sẵn sàng trữ lũ.'
      ]
    },
    {
      category: 'Điều phối giao thông & Cứu hộ cứu nạn',
      priority: 'Chủ động',
      icon: '👮',
      color: '#2563eb',
      actions: [
        'Đội CSGT số 7 và số 10 cắm chốt từ xa tại ngã tư Lê Trọng Tấn - Quang Trung, Vạn Phúc và Trần Phú để phân luồng xe máy và xe gầm thấp.',
        'Bố trí xe cứu hộ cẩu kéo chuyên dụng túc trực 24/7 tại chân cầu vượt Ba La, Hầm chui Nguyễn Trãi sẵn sàng kéo xe chết máy.',
        'Phát thanh bản tin cảnh báo ngập qua hệ thống loa truyền thanh thông minh các phường Phúc La, Mộ Lao, Dương Nội, Yên Nghĩa.',
        'Lực lượng dân quân tự vệ và cứu hộ phường chuẩn bị xuồng cứu hộ và xe gầm cao hỗ trợ người già, học sinh qua các điểm ngập sâu.'
      ]
    },
    {
      category: 'Giải pháp công trình & Quy hoạch đô thị bền vững',
      priority: 'Dài hạn',
      icon: '🏗️',
      color: '#059669',
      actions: [
        'Đẩy nhanh giải phóng mặt bằng cứng hóa đoạn kênh dẫn La Khê để phát huy tối đa 100% công suất Trạm bơm Yên Nghĩa.',
        'Xây dựng bể ngầm điều tiết thông minh (Smart Underground Detention) tại công viên và bãi đỗ xe công cộng khu vực Ba La và Xa La.',
        'Tăng diện tích bề mặt thấm nước: Thay thế vỉa hè bê tông đặc bằng gạch tự chèn thấm nước và phát triển vườn mưa (Rain Gardens) tại các KĐT mới.',
        'Số hóa mạng lưới cống ngầm Hà Đông bằng cảm biến mực nước IoT truyền dữ liệu trực tiếp về trung tâm điều hành Smart City.'
      ]
    }
  ];
}

