import { mkdtempSync, rmSync, rmdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadGisData,
  getAiForecast,
  getEarlyAlerts,
  getDashboardData,
  getTimelineSimulation,
  searchLocationRisk,
  getAvoidanceRoutes,
  getAiRain24hAnalysis,
  getActionableSolutions,
  ROUTE_PRESETS,
  loadReports,
  saveReport
} from '../flood-engine.mjs';

test('loadGisData loads valid GeoJSON sites and layers', () => {
  const { sites, layers } = loadGisData();
  assert.equal(sites.type, 'FeatureCollection');
  assert.ok(sites.features.length >= 10, 'Must have at least 10 historical/vulnerable sites');
  assert.equal(layers.type, 'FeatureCollection');
  assert.ok(layers.features.some(f => f.properties.layer === 'roads'));
  assert.ok(layers.features.some(f => f.properties.layer === 'residential'));
  assert.ok(layers.features.some(f => f.properties.layer === 'lakes'));
  assert.ok(layers.features.some(f => f.properties.layer === 'rivers'));
  assert.ok(layers.features.some(f => f.properties.layer === 'drainage'));
});

test('getAiForecast calculates realistic predictions and confidence', () => {
  const horizons = ['+30m', '+1h', '+2h', '+3h'];
  for (const h of horizons) {
    const forecast = getAiForecast(h, 40);
    assert.ok(forecast.average_confidence_pct >= 70 && forecast.average_confidence_pct <= 95);
    assert.ok(forecast.predictions.length > 0);
    assert.ok(forecast.top_hotspot.name);
    assert.ok(forecast.top_hotspot.depth_range_text.includes('cm'));
  }
});

test('getEarlyAlerts escalates severity with rain and high risk counts', () => {
  const lowAlert = getEarlyAlerts(10);
  assert.ok(['normal', 'advisory'].includes(lowAlert.level));

  const severeAlert = getEarlyAlerts(65);
  assert.equal(severeAlert.level, 'danger');
  assert.ok(severeAlert.critical_spots.length > 0);
});

test('getDashboardData returns correct KPI structures and trends', () => {
  const dashboard = getDashboardData(35);
  assert.ok(dashboard.metrics.currently_flooded_points >= 0);
  assert.ok(dashboard.metrics.river_water_level_m > 0);
  assert.ok(dashboard.metrics.risk_area_ha > 0);
  assert.ok(dashboard.trends['1h'].length > 0);
  assert.ok(dashboard.trends['24h'].length > 0);
});

test('getTimelineSimulation returns 5 time steps from 14:00 to 18:00', () => {
  const { timeline } = getTimelineSimulation();
  assert.equal(timeline.length, 5);
  assert.equal(timeline[0].hour, '14:00');
  assert.equal(timeline[4].hour, '18:00');
  // Peak should have higher active area than end
  assert.ok(timeline[2].active_ha > timeline[4].active_ha);
});

test('searchLocationRisk correctly resolves known streets in Ha Dong', () => {
  const res1 = searchLocationRisk('Nguyễn Trãi, Hà Đông');
  assert.ok(res1.matched_location.includes('Nguyễn Trãi') || res1.street.includes('Nguyễn Trãi'));
  assert.ok(res1.depth_range_text.includes('cm'));

  const res2 = searchLocationRisk('Văn Quán');
  assert.ok(res2.matched_location.includes('Văn Quán'));
});

test('getAvoidanceRoutes provides regular and safe alternative routes', () => {
  const routes = getAvoidanceRoutes('Bệnh viện 103', 'KĐT Văn Phú');
  assert.ok(routes.regular_route.is_flooded);
  assert.ok(!routes.safe_route.is_flooded);
  assert.ok(routes.safe_route.recommendation);
  assert.ok(routes.safe_route.path.length >= 3);
});

test('reports persist as unverified without modifying project data', () => {
  const dir=mkdtempSync(path.join(tmpdir(),'flood-report-test-'));
  try {
    const file=path.join(dir,'reports.json');
    const saved=saveReport({reporter_name:'Test Citizen',location_name:'Đường Quang Trung',depth_cm:28,depth_level:'medium',description:'Ngập nhẹ lối vào ga'},file);
    assert.ok(saved.id.startsWith('rep-'));
    assert.equal(saved.status,'unverified');
    assert.equal(saved.votes,0);
    assert.equal(saved.coordinates,null);
    assert.equal(loadReports(file).length,1);
  } finally { rmSync(path.join(dir,'reports.json'),{force:true}); rmdirSync(dir); }
});
test('unknown locations do not fall back to an unrelated site', () => {
  assert.equal(searchLocationRisk('zzzz nonexistent road'),null);
  assert.equal(searchLocationRisk('     '),null);
});
test('zero rain produces zero depth in a scenario', () => {
  assert.ok(getAiForecast('+1h',0).predictions.every(p=>p.depth_max_cm===0));
});

test('damaged report storage is never overwritten by a new submission',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'flood-report-corrupt-')),file=path.join(dir,'reports.json');
 try{
  writeFileSync(file,'truncated JSON');
  assert.throws(()=>saveReport({reporter_name:'Test',location_name:'Văn Quán',depth_cm:25,depth_level:'medium'},file));
  assert.equal(readFileSync(file,'utf8'),'truncated JSON');
 }finally{rmSync(file,{force:true});rmdirSync(dir);}
});

test('getAvoidanceRoutes supports multiple presets across Ha Dong', () => {
  assert.ok(ROUTE_PRESETS.route_1 && ROUTE_PRESETS.route_2 && ROUTE_PRESETS.route_3 && ROUTE_PRESETS.route_4);
  const r2 = getAvoidanceRoutes('route_2');
  assert.equal(r2.id, 'route_2');
  assert.ok(r2.regular_route.is_flooded);
  assert.ok(!r2.safe_route.is_flooded);

  const r3 = getAvoidanceRoutes('KĐT Dương Nội', 'Cầu Trắng');
  assert.equal(r3.id, 'route_3');
  assert.ok(r3.safe_route.recommendation.includes('Vạn Phúc'));

  const r4 = getAvoidanceRoutes('KĐT Mộ Lao', 'Ngã ba Ba La');
  assert.equal(r4.id, 'route_4');
  assert.ok(r4.regular_route.flood_spots.some(s => s.name.includes('Ba La')));
});

test('getAiRain24hAnalysis assesses upcoming 24h precipitation and traffic impact', () => {
  const mockNow = new Date('2026-09-21T12:00:00+07:00').getTime();
  const times = [];
  const precip = [];
  const prob = [];
  for (let i = 0; i < 30; i++) {
    const d = new Date(mockNow + i * 3600000);
    times.push(d.toISOString());
    precip.push(i === 3 ? 32.5 : i === 4 ? 12.0 : 0);
    prob.push(i === 3 ? 85 : i === 4 ? 60 : 10);
  }
  const weather = { hourly: { time: times, precipitation: precip, precipitation_probability: prob } };
  const res = getAiRain24hAnalysis(weather, mockNow);
  assert.equal(res.available, true);
  assert.equal(res.will_rain, true);
  assert.ok(res.total_rain_mm >= 44.5);
  assert.equal(res.max_prob_pct, 85);
  assert.equal(res.flood_risk_level, 'critical');
  assert.ok(res.ai_summary.includes('AI cảnh báo'));
  assert.ok(res.traffic_advisory.includes('CẢNH BÁO GIAO THÔNG'));
  assert.equal(res.periods.length, 3);

  // Dry weather test
  const dryWeather = {
    hourly: {
      time: times,
      precipitation: times.map(() => 0),
      precipitation_probability: times.map(() => 5)
    }
  };
  const dryRes = getAiRain24hAnalysis(dryWeather, mockNow);
  assert.equal(dryRes.will_rain, false);
  assert.equal(dryRes.total_rain_mm, 0);
  assert.equal(dryRes.flood_risk_level, 'safe');
  assert.ok(dryRes.status_title.includes('KHÔNG MƯA'));

  // Fallback for null data
  const nullRes = getAiRain24hAnalysis(null);
  assert.equal(nullRes.available, false);
  assert.equal(nullRes.will_rain, false);
});

test('getActionableSolutions provides 4 comprehensive categories', () => {
  const solutions = getActionableSolutions(40);
  assert.equal(solutions.length, 4);
  assert.ok(solutions.some(s => s.category.includes('Cảnh báo nhân dân')));
  assert.ok(solutions.some(s => s.category.includes('Vận hành hạ tầng')));
  assert.ok(solutions.some(s => s.category.includes('Điều phối giao thông')));
  assert.ok(solutions.some(s => s.category.includes('Giải pháp công trình')));
  assert.ok(solutions.every(s => s.actions && s.actions.length >= 3));
});

