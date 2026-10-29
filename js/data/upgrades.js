// 持續精進 (repeatable upgrade lines). Once the research tree is exhausted the three point types (醫術/儀器/服務) keep
// flowing; these 6 lines (2 per domain) turn the surplus into small, capped, slowly-escalating bonuses.
//
// state.research.levels = { [lineId]: integer 0..cap }. Purchase is instant (sim/research.js buyUpgrade) and pays the
// domain's point type. Effects are applied by sim/modifiers.js as ADDITIVE deltas (level x perLevel; multiplier mods have
// base 1, so wearRate -0.03/level at level 10 -> 0.70) and clamped by the global caps there (modifiers.MOD_BOUNDS).
//
// Line schema:
//   id, name, domain: 'medical'|'device'|'service' (== RESEARCH_TRACKS id == point key), icon, desc, note (small flavour line)
//   effects: [{ key, perLevel, op:'add' }]   key = defaultMods() key or dotted 'typeCure.<patientType>' / 'typeSat.<patientType>'
//   cap: max level, baseCost / growth: cost of buying level L+1 = round(baseCost * growth^L)  (see upgradeCost)
//   unlock: { domainNodes: N }  line becomes available once N research-tree nodes of its domain are done
//
// Numbers are calibrated with the balance harness (docs/ARCHITECTURE.md "持續精進" -> Costs & calibration): total at cap = +40% cure gain,
// +18% per-type cure, -45% equipment wear, -14.4% treatment time, +9 satisfaction / +15% patience, +0.9 reputation per week.
import { PATIENT_TYPES } from './patients.js';

const TYPE_IDS = Object.keys(PATIENT_TYPES);

export const UPGRADE_LINES = [
  // ---------- 醫術 medical ----------
  {
    id: 'up_clinical', name: '臨床經驗', domain: 'medical', icon: '🩺',
    desc: '看過的病人越多，手感越準。每次治療帶來的療效提高。',
    note: '「這個症狀我上禮拜才看過。」',
    effects: [{ key: 'cureGain', perLevel: 0.025, op: 'add' }],
    cap: 16, baseCost: 85, growth: 1.23, unlock: { domainNodes: 3 },
  },
  {
    id: 'up_diagnosis', name: '專科診斷', domain: 'medical', icon: '🔍',
    desc: '長輩、上班族、運動員、小朋友各有各的毛病。針對四類病患精準下診斷，療效再加一層。',
    note: '診斷對了，治療就成功一半。',
    effects: TYPE_IDS.map(t => ({ key: 'typeCure.' + t, perLevel: 0.015, op: 'add' })),
    cap: 12, baseCost: 105, growth: 1.23, unlock: { domainNodes: 5 },
  },
  // ---------- 儀器 device ----------
  {
    id: 'up_equipment', name: '設備精進', domain: 'device', icon: '🛠',
    desc: '定期校正、換耗材、擦乾淨。機器磨損的速度變慢，維修單也變薄。',
    note: '保養做得好，機器不鬧脾氣。',
    effects: [{ key: 'wearRate', perLevel: -0.03, op: 'add' }],
    cap: 15, baseCost: 55, growth: 1.27, unlock: { domainNodes: 3 },
  },
  {
    id: 'up_workflow', name: '流程最佳化', domain: 'device', icon: '⏱',
    desc: '備品放順手、換床單有口訣、病人上機直接開始。每個療程都縮短一點點。',
    note: '省下來的幾十秒，一天就是一位病人。',
    effects: [{ key: 'treatTime', perLevel: -0.012, op: 'add' }],
    cap: 12, baseCost: 60, growth: 1.27, unlock: { domainNodes: 5 },
  },
  // ---------- 服務 service ----------
  {
    id: 'up_relations', name: '客戶關係', domain: 'service', icon: '🤝',
    desc: '記得病人的名字、問候家人、候診時遞杯茶。離開診所時的滿意度更高，也更有耐心等。',
    note: '「陳阿嬤，今天膝蓋有比較好嗎？」',
    effects: [{ key: 'satGain', perLevel: 0.6, op: 'add' }, { key: 'patience', perLevel: 0.01, op: 'add' }],
    cap: 15, baseCost: 65, growth: 1.22, unlock: { domainNodes: 3 },
  },
  {
    id: 'up_brand', name: '品牌聲望', domain: 'service', icon: '📣',
    desc: '粉專、社區講座、媒體專訪。聲望每週自然成長一點，不靠任何療程。',
    note: '好名聲，是會自己長大的。',
    effects: [{ key: 'repGrowth', perLevel: 0.06, op: 'add' }],
    cap: 15, baseCost: 75, growth: 1.22, unlock: { domainNodes: 5 },
  },
];

export const UPGRADE_BY_ID = Object.fromEntries(UPGRADE_LINES.map(l => [l.id, l]));
export const UPGRADE_DOMAIN_NAMES = { medical: '醫術', device: '儀器', service: '服務' };

// Cost of buying the NEXT level when the line is currently at `level` (0-based): round(baseCost * growth^level).
export function upgradeCost(line, level) {
  return Math.round(line.baseCost * Math.pow(line.growth, Math.max(0, level | 0)));
}

// Cumulative cost of levels 0 -> `levels`.
export function upgradeCostTotal(line, levels = line.cap) {
  let s = 0;
  for (let i = 0; i < levels; i++) s += upgradeCost(line, i);
  return s;
}
