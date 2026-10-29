/* LaptopMate 静态网页版
 * 数据与逻辑均在浏览器本地运行，不依赖服务器。
 */

'use strict';

const DATA = Array.isArray(window.LAPTOPS) ? window.LAPTOPS : [];
const DATA_DATE = window.DATA_DATE || '2026-10-22';

const SCENARIOS = {
  office: {
    label: '日常办公与网页浏览', minRam: 8, targetRam: 16, minStorage: 256, targetStorage: 512,
    weights: { budget: .15, cpu: .10, gpu: .05, memory_storage: .20, portability: .20, battery: .20, screen: .05, preference: .05, thermal: 0 },
    screen: { resolution: .40, refresh: 0, brightness: .35, gamut: .25 },
    supportedOS: ['Windows', 'macOS'],
  },
  study: {
    label: '大学生学习', minRam: 8, targetRam: 16, minStorage: 256, targetStorage: 512,
    weights: { budget: .15, cpu: .10, gpu: .05, memory_storage: .25, portability: .15, battery: .20, screen: .05, preference: .05, thermal: 0 },
    screen: { resolution: .50, refresh: 0, brightness: .25, gamut: .25 },
    supportedOS: ['Windows', 'macOS'],
  },
  programming: {
    label: 'Python 编程与数据分析', minRam: 16, targetRam: 32, minStorage: 512, targetStorage: 1024,
    weights: { budget: .15, cpu: .30, gpu: .05, memory_storage: .25, portability: .10, battery: .05, screen: .05, preference: .05, thermal: 0 },
    screen: { resolution: .60, refresh: 0, brightness: .20, gamut: .20 },
    supportedOS: ['Windows', 'macOS'],
  },
  gaming: {
    label: '游戏娱乐', minRam: 16, targetRam: 32, minStorage: 512, targetStorage: 1024,
    weights: { budget: .10, cpu: .15, gpu: .25, memory_storage: .10, portability: .05, battery: .05, screen: .15, preference: .05, thermal: .10 },
    screen: { resolution: .30, refresh: .40, brightness: .15, gamut: .15 },
    supportedOS: ['Windows'],
  },
  video: {
    label: '视频剪辑与图像处理', minRam: 16, targetRam: 32, minStorage: 512, targetStorage: 1024,
    weights: { budget: .05, cpu: .25, gpu: .25, memory_storage: .20, portability: .05, battery: .05, screen: .10, preference: .05, thermal: 0 },
    screen: { resolution: .25, refresh: .05, brightness: .25, gamut: .45 },
    supportedOS: ['Windows', 'macOS'],
  },
};

const DIMENSIONS = ['budget', 'cpu', 'gpu', 'memory_storage', 'portability', 'battery', 'screen', 'preference', 'thermal'];
const DIM_LABELS = {
  budget: '预算匹配度', cpu: 'CPU 性能', gpu: 'GPU 性能',
  memory_storage: '内存与存储', portability: '便携性', battery: '续航',
  screen: '屏幕', preference: '用户偏好', thermal: '散热/性能释放',
};
const IMPORTANCE = { 1: .6, 2: .8, 3: 1, 4: 1.2, 5: 1.4 };
const CPU_BENCHMARK = 'Cinebench 2024 Multi';
const CPU_ANCHORS = [400, 2400];
const GPU_BENCHMARKS = {
  '3DMark Time Spy Graphics': [500, 22000],
  '3DMark Wild Life Extreme': [2000, 40000],
};
const PRICE_STALE_DAYS = 90;
const SPEC_STALE_DAYS = 180;
const BRIGHTNESS_LOW = 300;
const GAMUT_LOW_SRGB = 100;
const GAMUT_LOW_P3 = 70;
const WEIGHT_NEAR_LIMIT = .9;

const state = {
  profile: null,
  results: null,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function clamp(value, low = 0, high = 100) { return Math.max(low, Math.min(high, value)); }
function isMissing(value) {
  return value === null || value === undefined || value === '' ||
    (typeof value === 'number' && Number.isNaN(value));
}
function num(value) {
  if (isMissing(value)) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function fmt(value, digits = 0) {
  if (isMissing(value)) return '未知';
  const n = Number(value);
  if (!Number.isFinite(n)) return '未知';
  return digits > 0 ? n.toFixed(digits) : String(Math.round(n));
}
function money(value) {
  if (isMissing(value)) return '未知';
  return '¥' + Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}
function capacity(value) {
  if (isMissing(value)) return '未知';
  const n = Number(value);
  if (n >= 1024 && n % 1024 === 0) return (n / 1024).toFixed(0) + 'TB';
  return n.toFixed(0) + 'GB';
}
function pct(value) { return (value * 100).toFixed(1) + '%'; }
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}
function productLabel(p) { return `${p.brand || ''} ${p.model || ''}`.trim(); }
function useCases(p) { return Array.isArray(p.use_cases) ? p.use_cases : String(p.use_case || '').split(';').filter(Boolean); }
function todayDate() { return new Date(); }
function daysSince(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((todayDate() - d) / 86400000);
}
function confidenceText(value) {
  if (value >= .85) return '高';
  if (value >= .60) return '中';
  return '低';
}
function confidenceClass(value) {
  const label = confidenceText(value);
  return label === '高' ? 'conf-high' : label === '中' ? 'conf-mid' : 'conf-low';
}
function dedupe(items) { return [...new Set(items)]; }

/* ---------- scoring ---------- */

function computeWeights(profile) {
  const weights = { ...SCENARIOS[profile.scenario].weights };
  weights.cpu *= IMPORTANCE[profile.performance];
  weights.gpu *= IMPORTANCE[profile.performance];
  weights.battery *= IMPORTANCE[profile.battery];
  weights.portability *= IMPORTANCE[profile.portability];
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  DIMENSIONS.forEach(dim => { weights[dim] = weights[dim] / total; });
  return weights;
}

function normalize(value, anchors) {
  const [low, high] = anchors;
  if (high <= low) return 50;
  return clamp((Number(value) - low) / (high - low) * 100);
}

function scoreBudget(p, profile) {
  if (isMissing(p.price)) return [50, .3, '价格缺失，按中性 50 分计'];
  const price = Number(p.price);
  if (price > profile.budgetMax) return [0, 1, '超过最高预算'];
  if (profile.budgetMax <= profile.budgetMin) return [100, 1, `价格 ${money(price)}，在预算范围内`];
  const ratio = clamp((price - profile.budgetMin) / (profile.budgetMax - profile.budgetMin), 0, 1);
  return [100 - 20 * ratio, 1, `价格 ${money(price)}，预算余量分`];
}

function scoreCpu(p) {
  const raw = num(p.cpu_benchmark_score);
  if (raw === null || p.cpu_benchmark_name !== CPU_BENCHMARK) {
    return [50, .3, '缺少 Cinebench 2024 Multi 基准分，按中性 50 分计'];
  }
  const score = normalize(raw, CPU_ANCHORS);
  const conf = p.cpu_benchmark_scope === 'model' ? 1 : p.cpu_benchmark_scope === 'component' ? .6 : .3;
  return [score, conf, `CPU 基准 ${fmt(raw)}（${p.cpu_benchmark_name}，${p.cpu_benchmark_scope || '范围未知'}）`];
}

function scoreGpu(p) {
  const raw = num(p.gpu_benchmark_score);
  const anchors = GPU_BENCHMARKS[p.gpu_benchmark_name];
  if (raw === null || !anchors) return [50, .3, '缺少统一的 GPU 基准分，按中性 50 分计'];
  const score = normalize(raw, anchors);
  const conf = p.gpu_benchmark_scope === 'model' ? 1 : p.gpu_benchmark_scope === 'component' ? .6 : .3;
  return [score, conf, `GPU 基准 ${fmt(raw)}（${p.gpu_benchmark_name}，${p.gpu_benchmark_scope || '范围未知'}）`];
}

function capacityScore(value, minimum, target) {
  if (value >= target) return 100;
  if (value >= minimum) {
    if (target <= minimum) return 100;
    return 60 + 40 * (value - minimum) / (target - minimum);
  }
  return 0;
}

function scoreMemoryStorage(p, profile) {
  const s = SCENARIOS[profile.scenario];
  const ram = num(p.ram_gb), storage = num(p.storage_gb);
  const ramMissing = ram === null, storageMissing = storage === null;
  const ramScore = ramMissing ? 50 : capacityScore(ram, s.minRam, s.targetRam);
  const storageScore = storageMissing ? 50 : capacityScore(storage, s.minStorage, s.targetStorage);
  const score = .6 * ramScore + .4 * storageScore;
  const conf = ramMissing && storageMissing ? .3 : ramMissing || storageMissing ? .6 : 1;
  return [score, conf, `内存 ${ramMissing ? '未知' : capacity(ram)} / 存储 ${storageMissing ? '未知' : capacity(storage)}`];
}

function scorePortability(p) {
  const weight = num(p.weight_kg);
  if (weight === null) return [50, .3, '重量缺失，按中性 50 分计'];
  return [clamp(100 - 30 * (weight - 1), 20, 100), 1, `重量 ${fmt(weight, 2)}kg`];
}

function scoreBattery(p) {
  const hours = num(p.battery_life_hours);
  if (hours !== null) {
    const score = normalize(hours, [4, 14]);
    const hasTest = !isMissing(p.battery_test_name) && !isMissing(p.battery_test_source_url);
    const vendor = String(p.battery_test_name || '').includes('厂商标称');
    return [score, (!hasTest || vendor) ? .6 : 1, `实测续航 ${fmt(hours, 1)} 小时`];
  }
  if (!isMissing(p.battery_wh)) return [50, .3, `仅有电池容量 ${fmt(p.battery_wh, 1)}Wh，无法判断实际续航`];
  return [50, .3, '缺少电池容量和实测续航，按中性 50 分计'];
}

function parseResolution(value) {
  if (isMissing(value)) return null;
  const m = String(value).match(/^\s*(\d{3,5})\s*[xX×]\s*(\d{3,5})\s*$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

function resolutionScore(value) {
  const parsed = parseResolution(value);
  if (!parsed) return 50;
  const pixels = parsed[0] * parsed[1];
  if (pixels >= 3840 * 2160) return 100;
  if (pixels >= 2880 * 1800) return 92;
  if (pixels >= 2560 * 1600) return 85;
  if (pixels >= 2560 * 1440) return 80;
  if (pixels >= 1920 * 1200) return 65;
  if (pixels >= 1920 * 1080) return 55;
  return 30;
}

function linearPiecewise(value, points, below) {
  if (value < points[0][0]) return below;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[i + 1];
    if (value <= x2) return x2 === x1 ? y2 : y1 + (y2 - y1) * (value - x1) / (x2 - x1);
  }
  return points[points.length - 1][1];
}

function refreshScore(value) {
  if (isMissing(value)) return 50;
  return linearPiecewise(Number(value), [[60, 50], [90, 65], [120, 80], [144, 90], [165, 95], [240, 100]], 40);
}

function brightnessScore(value) {
  if (isMissing(value)) return 50;
  const nits = Number(value);
  if (nits < 250) return 30;
  return linearPiecewise(nits, [[250, 50], [300, 65], [400, 85], [500, 100]], 30);
}

function gamutScore(value, kind) {
  if (isMissing(value)) return 50;
  const v = Number(value);
  return kind === 'p3' ? clamp((v - 60) / 35 * 100) : clamp((v - 60) / 40 * 100);
}

function scoreScreen(p, profile) {
  const weights = SCENARIOS[profile.scenario].screen;
  const active = Object.entries(weights).filter(([, weight]) => weight > 0);
  const subs = {}, available = {};
  subs.resolution = resolutionScore(p.screen_resolution);
  available.resolution = !!parseResolution(p.screen_resolution);
  subs.refresh = refreshScore(p.screen_refresh_hz);
  available.refresh = !isMissing(p.screen_refresh_hz);
  subs.brightness = brightnessScore(p.screen_brightness_nits);
  available.brightness = !isMissing(p.screen_brightness_nits);
  const p3 = num(p.dci_p3_coverage_pct), srgb = num(p.srgb_coverage_pct);
  let gamutLabel = '色域未知';
  if (profile.scenario === 'video' && p3 !== null) {
    subs.gamut = gamutScore(p3, 'p3'); available.gamut = true; gamutLabel = `DCI-P3 ${fmt(p3)}%`;
  } else if (srgb !== null) {
    subs.gamut = gamutScore(srgb, 'srgb'); available.gamut = true; gamutLabel = `sRGB ${fmt(srgb)}%`;
  } else if (p3 !== null) {
    subs.gamut = gamutScore(p3, 'p3'); available.gamut = true; gamutLabel = `DCI-P3 ${fmt(p3)}%`;
  } else {
    subs.gamut = 50; available.gamut = false;
  }
  const totalWeight = active.reduce((sum, [, weight]) => sum + weight, 0);
  const score = active.reduce((sum, [key, weight]) => sum + weight * subs[key], 0) / totalWeight;
  const availableWeight = active.reduce((sum, [key, weight]) => sum + (available[key] ? weight : 0), 0);
  const ratio = availableWeight / totalWeight;
  const conf = ratio >= .999 ? 1 : ratio >= .5 ? .6 : .3;
  return [score, conf, `分辨率 ${fmt(subs.resolution)} / 刷新率 ${fmt(subs.refresh)} / 亮度 ${fmt(subs.brightness)} / 色域 ${fmt(subs.gamut)}（${gamutLabel}）`];
}

function screenSizeScore(size, preference) {
  if (preference === '13-14') {
    if (size >= 13 && size <= 14.5) return 100;
    if (size >= 12.5 && size <= 15) return 60;
    return 20;
  }
  if (preference === '15-16') {
    if (size >= 15 && size <= 16.5) return 100;
    if (size >= 14 && size <= 17) return 60;
    return 20;
  }
  if (preference === '16+') {
    if (size >= 16) return 100;
    if (size >= 15) return 60;
    return 20;
  }
  return 50;
}

function scorePreference(p, profile) {
  const parts = [], details = [];
  let missing = false;
  if (profile.brands.length) {
    if (!p.brand) { parts.push(50); details.push('品牌未知'); missing = true; }
    else if (profile.brands.includes(p.brand)) { parts.push(100); details.push(`品牌 ${p.brand} 在偏好中`); }
    else { parts.push(30); details.push(`品牌 ${p.brand} 不在偏好中`); }
  }
  if (profile.screenPref) {
    const size = num(p.screen_size);
    if (size === null) { parts.push(50); details.push('屏幕尺寸未知，无法核对偏好'); missing = true; }
    else {
      const s = screenSizeScore(size, profile.screenPref);
      parts.push(s); details.push(`屏幕 ${fmt(size, 1)} 英寸，偏好匹配分 ${fmt(s)}`);
    }
  }
  if (!parts.length) return [100, 1, '未填写软偏好'];
  return [parts.reduce((a, b) => a + b, 0) / parts.length, missing ? .3 : 1, details.join('；')];
}

function scoreThermal(p, profile) {
  if (profile.scenario !== 'gaming') return [0, 1, '非游戏场景不计权'];
  const tgp = num(p.gpu_tgp_w);
  if (tgp === null) return [50, .3, '缺少 GPU TGP，按中性 50 分计'];
  return [normalize(tgp, [50, 150]), .6, `GPU TGP ${fmt(tgp)}W（散热/性能释放代理指标）`];
}

function relevantMissing(p, profile) {
  const fields = [];
  const add = (field, label, condition = true) => { if (condition && isMissing(p[field])) fields.push(label); };
  add('price', '价格');
  add('ram_gb', '内存容量');
  add('storage_gb', '存储容量');
  add('weight_kg', '重量');
  add('cpu_benchmark_score', 'CPU 基准分');
  add('gpu_benchmark_score', 'GPU 基准分');
  add('battery_wh', '电池容量');
  add('battery_life_hours', '实测续航');
  add('screen_size', '屏幕尺寸');
  add('screen_resolution', '屏幕分辨率');
  add('screen_brightness_nits', '屏幕亮度');
  if (isMissing(p.srgb_coverage_pct) && isMissing(p.dci_p3_coverage_pct)) fields.push('屏幕色域');
  add('upgradeable_ram', '内存是否可升级');
  if (profile.scenario === 'gaming') {
    add('gpu_tgp_w', 'GPU TGP');
    add('thermal_notes', '散热备注');
    add('screen_refresh_hz', '屏幕刷新率');
  }
  return fields;
}

function scoreCandidate(p, profile, weights) {
  const results = {
    budget: scoreBudget(p, profile),
    cpu: scoreCpu(p),
    gpu: scoreGpu(p),
    memory_storage: scoreMemoryStorage(p, profile),
    portability: scorePortability(p),
    battery: scoreBattery(p),
    screen: scoreScreen(p, profile),
    preference: scorePreference(p, profile),
    thermal: scoreThermal(p, profile),
  };
  const scores = {}, confidences = {}, details = {};
  DIMENSIONS.forEach(dim => {
    scores[dim] = results[dim][0];
    confidences[dim] = results[dim][1];
    details[dim] = results[dim][2];
  });
  const total = DIMENSIONS.reduce((sum, dim) => sum + weights[dim] * scores[dim], 0);
  const conf = DIMENSIONS.reduce((sum, dim) => sum + weights[dim] * confidences[dim], 0);
  return {
    ...p,
    scores, confidences, details,
    totalScore: total,
    overallConfidence: conf,
    confidenceLabel: confidenceText(conf),
    missingFields: relevantMissing(p, profile),
  };
}

/* ---------- hard filters ---------- */

function applyHardFilters(data, profile) {
  const scenario = SCENARIOS[profile.scenario];
  return data.map(p => {
    const violations = [], unknowns = [], notes = [];
    const add = (list, message) => { if (message && !list.includes(message)) list.push(message); };
    const os = String(p.os || '');
    if (!os) add(unknowns, '操作系统缺失');
    else if (!scenario.supportedOS.includes(os)) add(violations, `第一版${scenario.label}场景仅支持 Windows 机型`);

    const price = num(p.price);
    if (price === null) add(unknowns, '价格缺失，无法核对预算');
    else if (price > profile.budgetMax) add(violations, `超过最高预算（${money(price)} > ${money(profile.budgetMax)}）`);
    else if (price < profile.budgetMin) add(notes, `低于预算下限（${money(price)}）`);

    const requiredRam = Math.max(profile.ramMin || 0, scenario.minRam);
    const ram = num(p.ram_gb);
    if (ram === null) add(unknowns, '内存容量缺失，无法核对内存要求');
    else if (ram < requiredRam) add(violations, `内存不足（${capacity(ram)} < ${requiredRam}GB）`);

    const storage = num(p.storage_gb);
    if (storage === null) add(unknowns, '存储容量缺失，无法核对场景最低要求');
    else if (storage < scenario.minStorage) add(violations, `存储低于场景最低要求（${capacity(storage)} < ${scenario.minStorage}GB）`);

    if (profile.weightLimit !== null) {
      const weight = num(p.weight_kg);
      if (weight === null) add(unknowns, '重量缺失，无法核对重量上限');
      else if (weight > profile.weightLimit) add(violations, `超过重量上限（${fmt(weight, 2)}kg > ${fmt(profile.weightLimit, 2)}kg）`);
    }

    const gpuType = String(p.gpu_type || '');
    if (profile.dgpuRequired === true) {
      if (!gpuType) add(unknowns, '显卡类型缺失，无法确认是否独显');
      else if (gpuType !== 'discrete') add(violations, '不是独立显卡');
    }

    if (['programming', 'video'].includes(profile.scenario) && isMissing(p.cpu_benchmark_score)) {
      add(unknowns, '缺少 CPU 基准分，无法评估该场景性能');
    }
    if (profile.scenario === 'gaming') {
      if (!gpuType) add(unknowns, '缺少显卡类型，无法评估游戏性能');
      if (isMissing(p.gpu_benchmark_score)) add(unknowns, '缺少 GPU 基准分，无法评估游戏性能');
      else if (gpuType === 'integrated') add(notes, '集成显卡，游戏性能可能有限');
    }

    const tags = useCases(p);
    if (!tags.includes(profile.scenario)) add(notes, '适用场景标签未覆盖当前场景，建议核实');

    const status = violations.length ? 'excluded' : unknowns.length ? 'insufficient_info' : 'eligible';
    return {
      ...p,
      filterStatus: status,
      filterReasons: [...violations, ...unknowns, ...notes],
      filterViolations: violations,
      filterUnknowns: unknowns,
      filterNotes: notes,
    };
  });
}

function recommend(data, profile) {
  const filtered = applyHardFilters(data, profile);
  const eligible = filtered.filter(p => p.filterStatus === 'eligible');
  const weights = computeWeights(profile);
  const scored = eligible.map(p => scoreCandidate(p, profile, weights));
  scored.sort((a, b) =>
    b.totalScore - a.totalScore ||
    b.overallConfidence - a.overallConfidence ||
    a.price - b.price ||
    String(a.product_id).localeCompare(String(b.product_id))
  );
  scored.forEach((p, index) => { p.rank = index + 1; });
  const recommendations = scored.slice(0, 5).map(p => ({
    ...p,
    explanation: explainCandidate(p, profile, weights, scored.length),
    risks: riskFlags(p, profile),
  }));
  return { profile, filtered, eligible, scored, recommendations, weights };
}

/* ---------- explanations ---------- */

function rawText(p, dim, profile) {
  if (dim === 'budget') return `价格 ${money(p.price)}`;
  if (dim === 'cpu') return isMissing(p.cpu_benchmark_score) ? '缺少 CPU 基准分' : `CPU 基准 ${fmt(p.cpu_benchmark_score)}（${p.cpu_benchmark_name || ''}）`;
  if (dim === 'gpu') return isMissing(p.gpu_benchmark_score) ? `GPU ${p.gpu || '未知'}，缺少统一基准分` : `GPU 基准 ${fmt(p.gpu_benchmark_score)}（${p.gpu_benchmark_name || ''}）`;
  if (dim === 'memory_storage') return `内存 ${capacity(p.ram_gb)} / 存储 ${capacity(p.storage_gb)}`;
  if (dim === 'portability') return isMissing(p.weight_kg) ? '重量未知' : `重量 ${fmt(p.weight_kg, 2)}kg`;
  if (dim === 'battery') {
    if (!isMissing(p.battery_life_hours)) return `实测续航 ${fmt(p.battery_life_hours, 1)} 小时`;
    if (!isMissing(p.battery_wh)) return `仅有电池容量 ${fmt(p.battery_wh, 1)}Wh`;
    return '缺少电池容量和实测续航';
  }
  if (dim === 'screen') {
    const res = isMissing(p.screen_resolution) ? '分辨率未知' : p.screen_resolution;
    const refresh = isMissing(p.screen_refresh_hz) ? '刷新率未知' : `${fmt(p.screen_refresh_hz)}Hz`;
    const bright = isMissing(p.screen_brightness_nits) ? '亮度未知' : `${fmt(p.screen_brightness_nits)}nits`;
    const gamut = !isMissing(p.srgb_coverage_pct) ? `sRGB ${fmt(p.srgb_coverage_pct)}%` :
      !isMissing(p.dci_p3_coverage_pct) ? `DCI-P3 ${fmt(p.dci_p3_coverage_pct)}%` : '色域未知';
    return `${res} / ${refresh} / ${bright} / ${gamut}`;
  }
  if (dim === 'preference') return `品牌 ${p.brand || '未知'} / 屏幕 ${fmt(p.screen_size, 1)} 英寸`;
  if (dim === 'thermal') return isMissing(p.gpu_tgp_w) ? '缺少 GPU TGP' : `GPU TGP ${fmt(p.gpu_tgp_w)}W（代理指标）`;
  return '';
}

function explainCandidate(p, profile, weights, count) {
  const contributions = DIMENSIONS.filter(dim => weights[dim] > 0)
    .map(dim => [dim, weights[dim] * p.scores[dim]])
    .sort((a, b) => b[1] - a[1]);
  const top = contributions.slice(0, 2);
  const topText = top.map(([dim]) =>
    `${DIM_LABELS[dim]}（得分 ${fmt(p.scores[dim])}/100，权重 ${pct(weights[dim])}）`
  ).join('；');
  const order = ['cpu', 'gpu', 'memory_storage', 'portability', 'battery', 'screen', 'budget', 'preference'];
  const weightText = order.map(dim => `${DIM_LABELS[dim]} ${pct(weights[dim])}`).join('、') +
    (profile.scenario === 'gaming' ? `、${DIM_LABELS.thermal} ${pct(weights.thermal)}` : '');
  const reason = `在“${SCENARIOS[profile.scenario].label}”场景下，本次实际权重为：${weightText}。` +
    `该机总分 ${p.totalScore.toFixed(1)}，在 ${count} 台合格机型中排第 ${p.rank}。` +
    `主要得分贡献来自 ${topText}。硬性条件均已满足。`;

  const pros = [];
  contributions.forEach(([dim]) => {
    if (pros.length >= 3) return;
    if (p.scores[dim] >= 75 && weights[dim] >= .05) {
      pros.push(`${DIM_LABELS[dim]}得分 ${fmt(p.scores[dim])}/100，权重 ${pct(weights[dim])}；${rawText(p, dim, profile)}。`);
    }
  });
  if (!pros.length) pros.push('各项较均衡，没有特别突出的单项；优势需要结合评分明细查看。');

  const cons = [];
  [...contributions].sort((a, b) => a[1] - b[1]).forEach(([dim]) => {
    if (cons.length >= 3) return;
    if (p.scores[dim] <= 50 && weights[dim] > 0) {
      cons.push(`${DIM_LABELS[dim]}得分 ${fmt(p.scores[dim])}/100；${rawText(p, dim, profile)}。`);
    }
  });
  if (!cons.length) cons.push('没有发现明显低分项；仍应查看数据缺失和价格时效提示。');

  const tags = useCases(p);
  const suitable = [tags.length ? '数据标注适用场景：' + tags.map(t => SCENARIOS[t]?.label || t).join('、') : '数据未标注适用场景。'];
  if (!tags.includes(profile.scenario)) suitable.push('当前场景不在适用场景标签中，建议进一步核实。');

  const mismatches = [];
  if (profile.brands.length && !profile.brands.includes(p.brand)) mismatches.push(`品牌 ${p.brand || '未知'} 不在偏好列表。`);
  if (profile.screenPref && !isMissing(p.screen_size) && screenSizeScore(Number(p.screen_size), profile.screenPref) < 100) {
    mismatches.push(`屏幕尺寸 ${fmt(p.screen_size, 1)} 英寸与偏好 ${profile.screenPref} 不完全匹配。`);
  }
  if (!isMissing(p.price) && Number(p.price) < profile.budgetMin) mismatches.push('价格低于预算下限；如果预算下限代表品质要求，请核实。');
  if (profile.weightLimit !== null && !isMissing(p.weight_kg) && Number(p.weight_kg) > profile.weightLimit * WEIGHT_NEAR_LIMIT) {
    mismatches.push(`重量 ${fmt(p.weight_kg, 2)}kg 接近你的 ${fmt(profile.weightLimit, 2)}kg 上限。`);
  }
  if (profile.scenario === 'gaming' && p.gpu_type === 'integrated') mismatches.push('该配置为集成显卡，游戏性能可能有限。');
  if (!tags.includes(profile.scenario)) mismatches.push('适用场景标签未覆盖当前场景。');
  if (!mismatches.length) mismatches.push('未发现明显的软偏好不匹配。');

  let gaps = p.missingFields.length ? [`缺少或未核验：${p.missingFields.join(', ')}。`, '购买前仍需核对具体配置版本、接口和售后信息。'] : ['关键评分字段较完整；仍建议购买前核对具体配置版本。'];

  return { reason, pros, cons, suitable, mismatches, dataGaps: gaps };
}

function shortPoint(text) {
  return text.split('；').slice(-1)[0].trim().replace(/1024GB/g, '1TB').replace(/2048GB/g, '2TB');
}

function cardCons(p, weights, explanation) {
  const messages = {
    battery: '缺少实测续航数据，无法判断实际续航。',
    cpu: 'CPU 性能得分偏低，适合轻中度任务。',
    gpu: 'GPU 性能得分偏低，游戏/渲染能力有限。',
    memory_storage: '内存或存储仅达到最低要求。',
    portability: '重量较大，便携性一般。',
    screen: '屏幕数据不足或表现一般，建议核实。',
    budget: '预算接近上限。',
    thermal: '功耗/散热信息有限，建议查看实测评测。',
  };
  const weak = DIMENSIONS.filter(dim => weights[dim] >= .10 && p.scores[dim] <= 50)
    .sort((a, b) => weights[b] - weights[a]);
  const items = weak.slice(0, 2).map(dim => messages[dim]).filter(Boolean);
  if (items.length < 2) {
    for (const gap of explanation.dataGaps) {
      if (!items.includes(gap)) items.push(gap);
      if (items.length >= 2) break;
    }
  }
  if (!items.length) items.push('没有明显短板，购买前仍需核对具体配置。');
  return items.slice(0, 2);
}

/* ---------- risks ---------- */

function riskFlags(p, profile) {
  const flags = [];
  const add = (severity, message) => { if (!flags.some(f => f.message === message)) flags.push({ severity, message }); };
  const scenario = SCENARIOS[profile.scenario];
  const price = num(p.price);
  if (price !== null) {
    if (price > profile.budgetMax) add('high', `价格 ${money(price)} 超过最高预算 ${money(profile.budgetMax)}。`);
    else if (price < profile.budgetMin) add('info', `价格 ${money(price)} 低于预算下限。`);
    if (p.price_type === 'reference') add('info', '该价格是第三方参考价，不是官方实时成交价，购买前需重新核价。');
    if (daysSince(p.price_verified_date) !== null && daysSince(p.price_verified_date) > PRICE_STALE_DAYS) {
      add('warning', `价格核验已过去 ${daysSince(p.price_verified_date)} 天，可能已变化。`);
    }
  }
  if (daysSince(p.last_verified) !== null && daysSince(p.last_verified) > SPEC_STALE_DAYS) {
    add('warning', `规格核验已过去 ${daysSince(p.last_verified)} 天，参数可能已更新。`);
  }
  const ram = num(p.ram_gb);
  if (ram !== null) {
    if (ram >= scenario.minRam && ram < scenario.targetRam) add('warning', `内存 ${capacity(ram)} 仅达到场景最低要求，推荐目标为 ${scenario.targetRam}GB。`);
    if (isMissing(p.upgradeable_ram) && ram <= 16) add('warning', '内存是否可升级未知，建议购买前确认。');
    if (p.upgradeable_ram === 'no' && ram < scenario.targetRam) add('warning', '内存不可升级，当前容量低于推荐目标。');
  }
  if (isMissing(p.screen_brightness_nits)) add('warning', '缺少屏幕亮度数据，建议确认。');
  else if (Number(p.screen_brightness_nits) < BRIGHTNESS_LOW) add('warning', `屏幕亮度 ${fmt(p.screen_brightness_nits)}nits 偏低，强光下可能不便。`);
  if (isMissing(p.srgb_coverage_pct) && isMissing(p.dci_p3_coverage_pct)) add('warning', '缺少屏幕色域数据，建议确认。');
  else if (profile.scenario === 'video') {
    if (!isMissing(p.srgb_coverage_pct) && Number(p.srgb_coverage_pct) < GAMUT_LOW_SRGB) add('warning', `sRGB 覆盖 ${fmt(p.srgb_coverage_pct)}%，可能不足以满足创作需求。`);
    if (!isMissing(p.dci_p3_coverage_pct) && Number(p.dci_p3_coverage_pct) < GAMUT_LOW_P3) add('warning', `DCI-P3 覆盖 ${fmt(p.dci_p3_coverage_pct)}%，可能不足以满足创作需求。`);
  }
  if (isMissing(p.ports)) add('info', '缺少接口配置，建议确认 USB-C/HDMI/读卡器等接口。');
  if (['programming', 'video'].includes(profile.scenario) && isMissing(p.cpu_benchmark_score)) add('high', '缺少 CPU 基准数据，无法可靠评估编程/创作性能。');
  if (profile.scenario === 'gaming' && isMissing(p.gpu_benchmark_score)) add('high', '缺少 GPU 基准数据，无法可靠评估游戏性能。');
  if (isMissing(p.battery_life_hours) && !isMissing(p.battery_wh)) add('info', `仅有电池容量 ${fmt(p.battery_wh, 1)}Wh，容量不等于续航。`);
  if (isMissing(p.weight_kg)) add('warning', '缺少重量数据，便携性无法准确判断。');
  else if (profile.weightLimit !== null && Number(p.weight_kg) > profile.weightLimit * WEIGHT_NEAR_LIMIT) add('info', '重量接近你设定的上限，携带时余量较小。');
  if (profile.dgpuRequired === true && isMissing(p.gpu_type)) add('high', '无法确认是否为独立显卡。');
  if (!useCases(p).includes(profile.scenario)) add('info', '适用场景标签未覆盖当前场景，建议核实。');
  if (Number(p.is_sample) === 1) add('high', '这是样例数据，不是真实商品信息。');
  if (profile.brands.length && !profile.brands.includes(p.brand)) add('info', '品牌不在你的偏好列表中。');
  if (profile.screenPref && !isMissing(p.screen_size) && screenSizeScore(Number(p.screen_size), profile.screenPref) < 100) add('info', '屏幕尺寸与你的偏好不完全匹配。');
  if (['gaming', 'video'].includes(profile.scenario) && isMissing(p.gpu_tgp_w) && isMissing(p.thermal_notes)) add('warning', '缺少功耗/散热信息，建议查看同型号评测。');
  if (profile.scenario === 'gaming' && !isMissing(p.gpu_tgp_w)) add('info', 'TGP 只是功耗上限，不能代表实际温度或持续性能。');
  const order = { high: 0, warning: 1, info: 2 };
  flags.sort((a, b) => order[a.severity] - order[b.severity]);
  return flags;
}

/* ---------- data completeness / formatting ---------- */

function dataCompleteness(p) {
  const fields = ['price', 'cpu_benchmark_score', 'gpu_benchmark_score', 'ram_gb', 'storage_gb', 'weight_kg', 'screen_size', 'screen_resolution', 'screen_refresh_hz', 'screen_brightness_nits', 'battery_wh', 'battery_life_hours', 'upgradeable_ram'];
  let present = fields.filter(field => !isMissing(p[field])).length;
  if (!isMissing(p.srgb_coverage_pct) || !isMissing(p.dci_p3_coverage_pct)) present += 1;
  return Math.round(present / (fields.length + 1) * 100);
}

function priceTypeLabel(value) {
  return { official: '官方价', retail: '授权零售价', reference: '第三方参考价' }[value] || '未知价格类型';
}
function gpuTypeLabel(value) {
  return { integrated: '集成显卡', discrete: '独立显卡' }[value] || '未知';
}
function useCaseLabels(p) {
  return useCases(p).map(t => SCENARIOS[t]?.label || t).join('、');
}

/* ---------- rendering ---------- */

function riskHtml(flags) {
  if (!flags.length) return '<p class="muted small">未触发额外风险提示。</p>';
  return '<ul class="risk-list">' + flags.map(f => {
    const dot = f.severity === 'high' ? '🔴' : f.severity === 'warning' ? '🟠' : '🔵';
    return `<li class="risk-${f.severity}">${dot} ${esc(f.message)}</li>`;
  }).join('') + '</ul>';
}

function sourceHtml(p) {
  const links = [];
  if (p.source_url) links.push(`<a href="${esc(p.source_url)}" target="_blank" rel="noopener">规格来源</a>`);
  if (p.price_source_url) links.push(`<a href="${esc(p.price_source_url)}" target="_blank" rel="noopener">价格来源</a>`);
  if (p.cpu_benchmark_source_url) links.push(`<a href="${esc(p.cpu_benchmark_source_url)}" target="_blank" rel="noopener">CPU 基准</a>`);
  if (p.gpu_benchmark_source_url) links.push(`<a href="${esc(p.gpu_benchmark_source_url)}" target="_blank" rel="noopener">GPU 基准</a>`);
  return `<div class="small">${links.join(' · ')}</div>
    <div class="muted small">价格类型：${esc(priceTypeLabel(p.price_type))}；价格核验：${esc(p.price_verified_date || '未知')}；规格核验：${esc(p.last_verified || '未知')}</div>`;
}

function scoreTableHtml(p, weights) {
  const rows = DIMENSIONS.filter(dim => weights[dim] > 0).map(dim => `
    <tr>
      <td>${esc(DIM_LABELS[dim])}</td>
      <td class="num">${fmt(p.scores[dim], 1)}</td>
      <td class="num">${pct(weights[dim])}</td>
      <td class="num">${(p.scores[dim] * weights[dim]).toFixed(1)}</td>
      <td>${esc(confidenceText(p.confidences[dim]))}</td>
      <td>${esc(p.details[dim])}</td>
    </tr>`).join('');
  return `<div class="table-wrap"><table class="score-table">
    <thead><tr><th>维度</th><th class="num">得分</th><th class="num">权重</th><th class="num">加权分</th><th>置信度</th><th>说明</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function cardHtml(p) {
  const exp = p.explanation;
  const pros = exp.pros.slice(0, 2).map(item => `<li>${esc(shortPoint(item))}</li>`).join('');
  const cons = cardCons(p, state.results.weights, exp).map(item => `<li>${esc(item)}</li>`).join('');
  const details = `
    <details>
      <summary>查看评分、推荐理由、风险和数据来源</summary>
      <div class="detail-body">
        <h4>推荐理由</h4><p>${esc(exp.reason)}</p>
        ${scoreTableHtml(p, state.results.weights)}
        <p class="muted small">总分为 0–100 的相对匹配分，不是性能绝对分或购买概率；分项得分和权重均来自当前需求。</p>
        <h4>适用场景</h4><ul>${exp.suitable.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <h4>与需求不匹配的地方</h4><ul>${exp.mismatches.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <h4>数据缺失 / 不确定项</h4><ul>${exp.dataGaps.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <h4>购买提示</h4>${riskHtml(p.risks)}
        <h4>数据来源</h4>${sourceHtml(p)}
      </div>
    </details>`;
  return `<article class="card">
    <div class="card-head">
      <h3>${p.rank}. ${esc(productLabel(p))}</h3>
      <div class="pills"><span class="pill price">${money(p.price)}</span><span class="pill score">匹配分 ${p.totalScore.toFixed(1)}</span></div>
    </div>
    <div class="spec-line">${esc(p.cpu)} · ${esc(p.gpu)} · ${capacity(p.ram_gb)} + ${capacity(p.storage_gb)} · ${fmt(p.weight_kg, 2)}kg · ${fmt(p.screen_size, 1)} 英寸 ${fmt(p.screen_refresh_hz)}Hz</div>
    <div class="two-col">
      <div><h4>匹配你的需求</h4><ul>${pros}</ul></div>
      <div><h4>需要注意</h4><ul>${cons}</ul></div>
    </div>
    ${details}
  </article>`;
}

function weightsHtml(weights) {
  const rows = DIMENSIONS.filter(dim => weights[dim] > 0).map(dim => {
    const value = weights[dim] * 100;
    return `<div class="weight-row"><span>${esc(DIM_LABELS[dim])}</span><span class="weight-track"><span class="weight-fill" style="width:${value}%"></span></span><span>${value.toFixed(1)}%</span></div>`;
  }).join('');
  return `<div class="weights">${rows}</div>`;
}

function renderNoMatch(results) {
  const excluded = results.filtered.filter(p => p.filterStatus === 'excluded');
  const insufficient = results.filtered.filter(p => p.filterStatus === 'insufficient_info');
  const allReasons = results.filtered.flatMap(p => p.filterReasons).join(' ');
  const suggestions = [];
  if (allReasons.includes('超过最高预算')) suggestions.push('提高最高预算，或降低对配置/屏幕的要求。');
  if (allReasons.includes('超过重量上限')) suggestions.push('放宽重量上限，或接受稍重但性能更高的机型。');
  if (allReasons.includes('内存不足')) suggestions.push('降低内存下限，或提高预算寻找更大内存版本。');
  if (allReasons.includes('不是独立显卡')) suggestions.push('取消“必须独显”，或把场景改为办公/学习/编程。');
  if (allReasons.includes('仅支持 Windows')) suggestions.push('游戏场景只推荐 Windows 机型；MacBook 可尝试办公、学习、编程或视频场景。');
  if (!suggestions.length) suggestions.push('检查预算范围、内存下限、重量上限和独显要求是否过严。');

  const excludedRows = excluded.map(p => `<tr><td>${esc(productLabel(p))}</td><td>${money(p.price)}</td><td>${esc(p.filterReasons.join('；'))}</td></tr>`).join('');
  const insufficientRows = insufficient.map(p => `<tr><td>${esc(productLabel(p))}</td><td>${money(p.price)}</td><td>${esc(p.filterReasons.join('；'))}</td></tr>`).join('');
  return `<div class="no-match"><strong>没有满足全部硬性条件的机型。</strong>系统没有为了给出推荐而放宽你的预算、内存、重量或独显要求。</div>
    <div class="summary-bar" style="margin-top:12px">合格 0 台 · 明确排除 ${excluded.length} 台 · 信息不足 ${insufficient.length} 台</div>
    <h3>可以尝试的调整</h3><ul class="suggestion-list">${suggestions.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
    <details><summary>查看被排除的机型及原因</summary><div class="table-wrap"><table class="compare-table"><thead><tr><th>机型</th><th>价格</th><th>原因</th></tr></thead><tbody>${excludedRows || '<tr><td colspan="3">没有明确排除项。</td></tr>'}</tbody></table></div></details>
    <details><summary>查看信息不足的机型</summary><div class="table-wrap"><table class="compare-table"><thead><tr><th>机型</th><th>价格</th><th>缺失/原因</th></tr></thead><tbody>${insufficientRows || '<tr><td colspan="3">没有信息不足项。</td></tr>'}</tbody></table></div></details>`;
}

function renderResults() {
  const welcome = $('#welcome');
  const content = $('#results-content');
  if (!state.results) {
    welcome.hidden = false;
    content.hidden = true;
    content.innerHTML = '';
    return;
  }
  welcome.hidden = true;
  content.hidden = false;
  const results = state.results;
  if (!results.recommendations.length) {
    content.innerHTML = renderNoMatch(results);
    return;
  }
  const top = results.recommendations.slice(0, 3);
  const more = results.recommendations.slice(3);
  const summary = `<div class="summary-bar">为你找到 <strong>${results.scored.length}</strong> 台符合硬性条件的机型，先看前 <strong>${Math.min(3, results.recommendations.length)}</strong> 台。 <span class="muted">匹配分是当前需求下的相对分数，不是绝对性能。</span></div>`;
  const cards = top.map(p => cardHtml(p)).join('');
  const moreHtml = more.length
    ? `<details><summary>查看第 4–5 名</summary>${more.map(p => cardHtml(p)).join('')}</details>` : '';
  const weights = `<details><summary>查看本次评分权重</summary><p class="muted small">场景默认权重 × 你对性能/续航/便携的重视程度，然后归一化。</p>${weightsHtml(results.weights)}</details>`;
  content.innerHTML = summary + cards + moreHtml + weights + `<p class="muted small">数据核验：${esc(DATA_DATE)} · ${DATA.length} 条真实配置。部分机型缺少实测续航或屏幕数据，已在推荐卡片中标注。</p>`;
}

/* ---------- detail ---------- */

function detailFields(p) {
  const fields = [
    ['品牌', p.brand], ['型号/配置', p.model], ['价格（元）', p.price],
    ['价格类型', priceTypeLabel(p.price_type)], ['价格核验日期', p.price_verified_date],
    ['CPU', p.cpu], ['CPU 基准分（Cinebench 2024）', p.cpu_benchmark_score],
    ['GPU', p.gpu], ['显卡类型', gpuTypeLabel(p.gpu_type)], ['GPU 基准分', p.gpu_benchmark_score],
    ['内存（GB）', p.ram_gb], ['存储（GB）', p.storage_gb],
    ['屏幕尺寸（英寸）', p.screen_size], ['分辨率', p.screen_resolution],
    ['刷新率（Hz）', p.screen_refresh_hz], ['亮度（nits）', p.screen_brightness_nits],
    ['sRGB 覆盖（%）', p.srgb_coverage_pct], ['DCI-P3 覆盖（%）', p.dci_p3_coverage_pct],
    ['重量（kg）', p.weight_kg], ['电池容量（Wh）', p.battery_wh], ['实测续航（小时）', p.battery_life_hours],
    ['适用场景标签', useCaseLabels(p)], ['内存可升级', p.upgradeable_ram === 'yes' ? '是' : p.upgradeable_ram === 'no' ? '否' : '未知'],
    ['操作系统', p.os], ['备注', p.notes],
  ];
  return fields.map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(isMissing(value) ? '未知' : value)}</td></tr>`).join('');
}

function statusForProduct(p) {
  if (!state.results) return '未评估';
  const found = state.results.filtered.find(x => x.product_id === p.product_id);
  return found ? found.filterStatus : '未评估';
}

function renderDetails() {
  const select = $('#detail-select');
  const p = DATA.find(x => x.product_id === select.value) || DATA[0];
  if (!p) return;
  const status = statusForProduct(p);
  let scoreHtml = '<p class="muted">在左侧填写需求后，这里会显示当前需求下的评分。</p>';
  let riskHtmlBlock = '';
  if (state.profile) {
    const weights = computeWeights(state.profile);
    const scored = scoreCandidate(p, state.profile, weights);
    const statusText = { eligible: '满足当前硬性条件', excluded: '不满足当前硬性条件', insufficient_info: '关键信息不足', '未评估': '未评估' }[status] || status;
    scoreHtml = `<div class="detail-grid">
      <div class="mini-card"><div class="label">当前需求匹配分</div><div class="value">${scored.totalScore.toFixed(1)} / 100</div></div>
      <div class="mini-card"><div class="label">置信度 / 硬性条件</div><div class="value">${esc(scored.confidenceLabel)} · ${esc(statusText)}</div></div>
    </div>
    <details><summary>查看评分明细</summary>${scoreTableHtml(scored, weights)}</details>`;
    const risks = riskFlags(p, state.profile);
    riskHtmlBlock = `<details><summary>查看购买提示（${risks.length} 条）</summary>${riskHtml(risks)}</details>`;
  }
  const batteryText = isMissing(p.battery_wh) ? '未知' : `${fmt(p.battery_wh, 1)}Wh`;
  const lifeText = isMissing(p.battery_life_hours) ? '未知' : `${fmt(p.battery_life_hours, 1)} 小时`;
  $('#detail-content').innerHTML = `
    <div class="detail-hero">
      <h3>${esc(productLabel(p))}</h3>
      <div><span class="pill price">${money(p.price)}</span> <span class="muted small">${esc(priceTypeLabel(p.price_type))}</span></div>
      <p class="detail-spec">${esc(p.cpu)} · ${esc(p.gpu)} · ${capacity(p.ram_gb)} + ${capacity(p.storage_gb)} · ${fmt(p.weight_kg, 2)}kg · ${fmt(p.screen_size, 1)} 英寸 ${fmt(p.screen_refresh_hz)}Hz</p>
      <p class="detail-spec">电池 ${batteryText} · 实测续航 ${lifeText} · 数据完整度 ${dataCompleteness(p)}%</p>
    </div>
    ${scoreHtml}
    ${riskHtmlBlock}
    <details><summary>查看完整字段与数据来源</summary>
      <div class="table-wrap"><table class="score-table"><tbody>${detailFields(p)}</tbody></table></div>
      ${sourceHtml(p)}
    </details>`;
}

/* ---------- compare ---------- */

const COMPARISON_METRICS = [
  ['price', '价格（元）', 'min', 0],
  ['weight_kg', '重量（kg）', 'min', 2],
  ['ram_gb', '内存（GB）', 'max', 0],
  ['storage_gb', '存储（GB）', 'max', 0],
  ['cpu_benchmark_score', 'CPU 基准（Cinebench 2024）', 'max', 0],
  ['gpu_benchmark_score', 'GPU 基准', 'max', 0],
  ['screen_size', '屏幕（英寸）', 'neutral', 1],
  ['screen_refresh_hz', '刷新率（Hz）', 'max', 0],
  ['screen_brightness_nits', '亮度（nits）', 'max', 0],
  ['battery_wh', '电池（Wh）', 'neutral', 1],
  ['battery_life_hours', '实测续航（小时）', 'max', 1],
];

function selectedProducts() {
  const select = $('#compare-select');
  let selectedOptions = Array.from(select.selectedOptions);
  if (selectedOptions.length > 10) {
    selectedOptions.slice(10).forEach(option => { option.selected = false; });
    selectedOptions = selectedOptions.slice(0, 10);
  }
  return selectedOptions
    .map(option => state.results?.filtered.find(p => p.product_id === option.value) || DATA.find(p => p.product_id === option.value))
    .filter(Boolean);
}

function compareTableHtml(products) {
  const gpuSame = new Set(products.map(p => p.gpu_benchmark_name)).size === 1;
  const head = products.map(p => `<th>${esc(productLabel(p))}</th>`).join('');
  const body = COMPARISON_METRICS.map(([field, label, direction, digits]) => {
    const values = products.map(p => num(p[field]));
    const valid = values.filter(v => v !== null);
    let best = null;
    if (valid.length && direction === 'min') best = Math.min(...valid);
    if (valid.length && direction === 'max') best = Math.max(...valid);
    const cells = products.map((p, i) => {
      const value = values[i];
      if (value === null) return '<td class="unknown">未知</td>';
      const isBest = direction !== 'neutral' && (field !== 'gpu_benchmark_score' || gpuSame);
      const cls = best !== null && isBest && Math.abs(value - best) < 1e-9 ? ' class="best"' : '';
      return `<td${cls}>${fmt(value, digits)}</td>`;
    }).join('');
    return `<tr><th>${esc(label)}</th>${cells}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="compare-table"><thead><tr><th>指标</th>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <p class="muted small">价格/重量越低越好；内存、存储、刷新率、亮度、实测续航越高越好。电池容量不直接代表续航，因此不高亮。CPU/GPU 原始分只作同基准参考，跨平台 GPU 原始分不可直接比较。</p>`;
}

function quickPoints(p) {
  if (!state.profile) {
    const pros = [`内存 ${capacity(p.ram_gb)} / 存储 ${capacity(p.storage_gb)}`, `重量 ${fmt(p.weight_kg, 2)}kg`, `屏幕 ${p.screen_resolution || '未知'} / ${fmt(p.screen_refresh_hz)}Hz`];
    const cons = [];
    if (isMissing(p.battery_life_hours)) cons.push('缺少实测续航');
    if (isMissing(p.screen_brightness_nits)) cons.push('缺少屏幕亮度');
    if (isMissing(p.upgradeable_ram)) cons.push('缺少内存可升级信息');
    return { pros, cons: cons.length ? cons : ['未发现明显的数据缺失'] };
  }
  const weights = computeWeights(state.profile);
  const scored = scoreCandidate(p, state.profile, weights);
  const contributions = DIMENSIONS.filter(dim => weights[dim] > 0).map(dim => [dim, weights[dim] * scored.scores[dim]]);
  const top = [...contributions].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const bottom = [...contributions].sort((a, b) => a[1] - b[1]).slice(0, 2);
  return {
    pros: top.map(([dim]) => `${DIM_LABELS[dim]} ${fmt(scored.scores[dim])}/100`),
    cons: bottom.map(([dim]) => `${DIM_LABELS[dim]} ${fmt(scored.scores[dim])}/100`),
  };
}

function conclusionHtml(products) {
  if (!state.profile || !state.results) return '<p class="muted">填写左侧需求后，系统会结合当前权重给出条件性比较结论。</p>';
  const scene = state.profile;
  const items = products.map(p => {
    const weights = computeWeights(scene);
    const scored = scoreCandidate(p, scene, weights);
    return { p, scored, status: statusForProduct(p) };
  });
  const eligible = items.filter(x => x.status === 'eligible').sort((a, b) => b.scored.totalScore - a.scored.totalScore);
  if (!eligible.length) return '<div class="no-match">所选机型均不满足当前硬性条件，以下只作参数对比，不构成推荐。</div>';
  const top = eligible[0], second = eligible[1];
  let html = `<p><strong>在当前需求下，${esc(productLabel(top.p))} 的匹配总分最高（${top.scored.totalScore.toFixed(1)}）。</strong>这不代表绝对性能最好，而是更贴合你的权重和硬性条件。</p>`;
  if (second) {
    const diffs = [];
    const topWeight = num(top.p.weight_kg), secondWeight = num(second.p.weight_kg);
    const topBattery = num(top.p.battery_life_hours), secondBattery = num(second.p.battery_life_hours);
    const topRefresh = num(top.p.screen_refresh_hz), secondRefresh = num(second.p.screen_refresh_hz);
    const topCpu = num(top.p.cpu_benchmark_score), secondCpu = num(second.p.cpu_benchmark_score);
    const topGpu = num(top.p.gpu_benchmark_score), secondGpu = num(second.p.gpu_benchmark_score);
    if (topWeight !== null && secondWeight !== null && topWeight < secondWeight) diffs.push('更轻');
    if (topBattery !== null && secondBattery !== null && topBattery > secondBattery) diffs.push('实测续航数据更长');
    if (topRefresh !== null && secondRefresh !== null && topRefresh > secondRefresh) diffs.push('屏幕刷新率更高');
    if (topCpu !== null && secondCpu !== null && topCpu > secondCpu) diffs.push('CPU 基准分更高');
    if (topGpu !== null && secondGpu !== null && topGpu > secondGpu) diffs.push('GPU 基准分更高');
    html += `<p>与 <strong>${esc(productLabel(second.p))}</strong> 相比，它的突出点是：${diffs.length ? esc(diffs.join('、')) : '主要差异见上表'}。具体取舍取决于你更看重哪一项。</p>`;
  }
  html += '<p class="muted small">跨平台 GPU 原始分不可直接比较；电池容量不等于实际续航。</p>';
  return html;
}

function renderCompare() {
  const products = selectedProducts();
  const box = $('#compare-content');
  if (products.length < 2) {
    box.innerHTML = '<p class="muted">请选择至少 2 台电脑。</p>';
    return;
  }
  const cards = [];
  for (let i = 0; i < products.length; i += 2) {
    const pair = products.slice(i, i + 2);
    cards.push(`<div class="two-col">${pair.map(p => {
      const { pros, cons } = quickPoints(p);
      const status = statusForProduct(p);
      const statusText = { eligible: '满足当前硬性条件', excluded: '不满足当前硬性条件，仅作参数对比', insufficient_info: '关键信息不足', '未评估': '未评估' }[status] || status;
      return `<div class="mini-card"><strong>${esc(productLabel(p))}</strong><div class="muted small">数据完整度 ${dataCompleteness(p)}%</div>
        <h4>优势 / 高分项</h4><ul>${pros.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <h4>注意 / 低分项</h4><ul>${cons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        <div class="muted small">${esc(statusText)}</div></div>`;
    }).join('')}</div>`);
  }
  const detailRows = [
    ['CPU', p => p.cpu], ['GPU', p => p.gpu],
    ['屏幕分辨率/刷新率', p => `${p.screen_resolution || '未知'} / ${fmt(p.screen_refresh_hz)}Hz`],
    ['电池容量/实测续航', p => `${fmt(p.battery_wh, 1)}Wh / ${fmt(p.battery_life_hours, 1)}h`],
    ['适用场景', p => useCaseLabels(p)],
    ['数据完整度', p => dataCompleteness(p) + '%'],
  ];
  const detailTable = `<div class="table-wrap"><table class="compare-table"><thead><tr><th>补充信息</th>${products.map(p => `<th>${esc(productLabel(p))}</th>`).join('')}</tr></thead><tbody>${detailRows.map(([label, getter]) => `<tr><th>${esc(label)}</th>${products.map(p => `<td>${esc(getter(p))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  box.innerHTML = `<h3>关键参数（绿色 = 该行当前最优）</h3>${compareTableHtml(products)}
    <details><summary>查看补充信息（CPU / GPU / 屏幕 / 电池 / 完整度）</summary>${detailTable}</details>
    <h3>每台电脑的简要判断</h3>${cards.join('')}
    <h3>条件性比较结论</h3>${conclusionHtml(products)}`;
}

/* ---------- UI setup ---------- */

function populateProductSelects() {
  const options = DATA.map(p => `<option value="${esc(p.product_id)}">${esc(productLabel(p))}</option>`).join('');
  $('#detail-select').innerHTML = options;
  $('#compare-select').innerHTML = options;
  if (DATA.length >= 2) {
    $('#compare-select').options[0].selected = true;
    $('#compare-select').options[1].selected = true;
  }
  $('#detail-select').selectedIndex = 0;
}

function populateWeightsTable() {
  const rows = Object.entries(SCENARIOS).map(([key, s]) => {
    const cells = DIMENSIONS.map(dim => `<td class="num">${(s.weights[dim] * 100).toFixed(0)}%</td>`).join('');
    return `<tr><th>${esc(s.label)}</th>${cells}</tr>`;
  }).join('');
  $('#weights-table').innerHTML = `<div class="table-wrap"><table class="score-table"><thead><tr><th>场景</th>${DIMENSIONS.map(d => `<th class="num">${esc(DIM_LABELS[d])}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function readProfile() {
  const budgetMin = Number($('#budget-min').value);
  const budgetMax = Number($('#budget-max').value);
  if (!Number.isFinite(budgetMin) || budgetMin < 0) throw new Error('预算下限必须是非负数字。');
  if (!Number.isFinite(budgetMax) || budgetMax <= 0) throw new Error('预算上限必须大于 0。');
  if (budgetMin > budgetMax) throw new Error('预算下限不能大于预算上限。');
  const weight = Number($('#weight-limit').value);
  const ramValue = $('#ram-min').value;
  const dgpuValue = $('#dgpu').value;
  return {
    budgetMin,
    budgetMax,
    scenario: $('#scenario').value,
    performance: Number($('#performance').value),
    battery: Number($('#battery').value),
    portability: Number($('#portability').value),
    weightLimit: Number.isFinite(weight) && weight > 0 ? weight : null,
    ramMin: ramValue ? Number(ramValue) : null,
    dgpuRequired: dgpuValue === 'required' ? true : null,
    screenPref: $('#screen-pref').value || null,
    brands: $$('input[name="brand"]:checked').map(x => x.value),
  };
}

function setDefaultCompareSelection() {
  const select = $('#compare-select');
  const ids = state.results?.recommendations.slice(0, 2).map(p => p.product_id) || DATA.slice(0, 2).map(p => p.product_id);
  Array.from(select.options).forEach(option => { option.selected = ids.includes(option.value); });
  renderCompare();
}

function setDefaultDetailSelection() {
  const select = $('#detail-select');
  const first = state.results?.recommendations[0]?.product_id || DATA[0]?.product_id;
  if (first) select.value = first;
  renderDetails();
}

function showError(message) {
  const box = $('#form-error');
  box.textContent = message;
  box.hidden = !message;
}

function activateTab(name) {
  $$('.tab').forEach(button => {
    const active = button.dataset.tab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('.tab-panel').forEach(panel => {
    const active = panel.id === 'tab-' + name;
    panel.classList.toggle('active', active);
    panel.hidden = !active;
  });
}

function init() {
  populateProductSelects();
  populateWeightsTable();
  $('#welcome-data-note').textContent = `当前数据：${DATA.length} 条真实配置 · 核验日期 ${DATA_DATE}。`;
  renderDetails();
  renderCompare();

  const form = $('#profile-form');
  form.addEventListener('submit', event => {
    event.preventDefault();
    showError('');
    try {
      const profile = readProfile();
      state.profile = profile;
      state.results = recommend(DATA, profile);
      renderResults();
      setDefaultCompareSelection();
      setDefaultDetailSelection();
      activateTab('results');
    } catch (error) {
      showError(error.message);
      state.profile = null;
      state.results = null;
      renderResults();
    }
  });

  $('#reset-button').addEventListener('click', () => {
    form.reset();
    state.profile = null;
    state.results = null;
    showError('');
    ['performance', 'battery', 'portability'].forEach(id => {
      const input = $('#' + id), output = $('#' + id + '-output');
      if (input && output) output.textContent = input.value;
    });
    renderResults();
    setDefaultCompareSelection();
    setDefaultDetailSelection();
  });

  ['performance', 'battery', 'portability'].forEach(id => {
    const input = $('#' + id), output = $('#' + id + '-output');
    input.addEventListener('input', () => { output.textContent = input.value; });
  });

  $('#detail-select').addEventListener('change', renderDetails);
  $('#compare-select').addEventListener('change', renderCompare);

  $$('.tab').forEach(button => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  });
}

document.addEventListener('DOMContentLoaded', init);
