// REAL DATA: Taiwan rehab-clinic fees (NHI + self-pay). The ONE place to correct a real-world number.
//
// Sources: docs/FEE_RESEARCH.md (numbered sources in `sources`) and docs/fee_data.json. Survey date 2026-10.
// CAVEAT: the researcher could NOT open any web page (WebFetch blocked); every figure comes from WebSearch result snippets,
//   so they may carry paraphrase errors. Each entry carries a confidence marker ('high' | 'medium' | 'low') and an `estimate` flag
//   when no source exists at all. Do not treat this file as an official fee schedule.
// HIGH confidence : exam fee tiers 364 / 250 / 160 (sources 7, 8); NHI point value ~0.95 (13-15); copay NT$50 (2, 9);
//                   the single-claim rule (4); self-pay shockwave / HILT / manual / PRP quotes are MEDIUM (many clinic quotes).
// LOW confidence  : PT tiers above 'simple' (moderate 200, moderateComplex 330, complex 400 are scaled estimates),
//                   OT (si / fine 320), ST (speech 320), musculoskeletal ultrasound (500), taping (150, no source at all),
//                   Redcord (single clinic), custom insole (blend of two price groups).
// -> The low-confidence values await verification against the official 健保署 支付標準
//    (「全民健康保險醫療服務給付項目及支付標準」 第二部 第二章 第四節 復健治療 and the OT / ST sections).
//
// Game abstraction (NOT real data) lives elsewhere: PATIENT_WEIGHT in sim/economy.js, selfPay willingness in data/patients.js,
// nhiCap in data/lots.js. Change those to rebalance; change THIS file only when a real number turns out to be wrong.
//
// Units: *Points* are NHI points (x point value = NT$); *selfPrice* and COPAY_NTD are plain NT$ per session / visit.
// One in-game "week" is one operating day, so "patients per day" = state.stats.patientsToday.

export const FEES_AS_OF = '2026-10';

// ---- NHI point value (NT$ per point) ----
export const NHI_POINT_VALUE = {
  typical: 0.95,       // undiluted value the game pays (West-medicine primary-care average 0.9451 in 2025 Q1; 'all >= 0.95' per media) [13,14,15] high
  min: 0.6,            // GAME FLOOR for the monthly-cap dilution (not real data)
  realMin: 0.91,       // observed real range, lower bound (Taipei floating 0.9138 in 112Q1) [14]
  realMax: 1.0,        // official target / ceiling
  confidence: 'high',
};

// ---- doctor exam fee (診察費), tiered by the doctor's patients that day [7, 8] ----
// `upTo` is the highest daily patient ordinal the tier covers. 46-65 has no source (interpolated between 250 and 160) -> low.
export const EXAM_FEE_TIERS = [
  { upTo: 35,       points: 364, confidence: 'high', sources: [7, 8], note: '00109C/00110C, 1-35 patients per day' },
  { upTo: 45,       points: 250, confidence: 'high', sources: [7],    note: '00223C/00224C, 36-45' },
  { upTo: 65,       points: 200, confidence: 'low',  sources: [7], estimate: true, note: '46-65: NO SOURCE, interpolated between 250 and 160' },
  { upTo: 85,       points: 160, confidence: 'high', sources: [7],    note: '00113C, 66-85' },
  { upTo: Infinity, points: 160, confidence: 'low',  sources: [7], estimate: true, note: '86+: no data, kept at the last tier' },
];

// Exam fee for the nth patient of the day (n >= 1). Pure helper so tests and UI share one definition.
export function examFeePoints(n) {
  const k = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1;
  for (const t of EXAM_FEE_TIERS) if (k <= t.upTo) return t.points;
  return EXAM_FEE_TIERS[EXAM_FEE_TIERS.length - 1].points;
}

// ---- patient co-payment (部分負擔) ----
// Real: clinic copay NT$50 per visit; rehab copay NT$50 from the 2nd session of a course (<= 6 sessions in 30 days) [2, 9]. high.
// Game simplification: a flat NT$50 for every RETURNING visit (visit >= 1), 0 for a first visit. Deterministic.
export const COPAY_NTD = 50;
export const COPAY_CONFIDENCE = 'high';

// ---- physical-therapy claim tiers (42xxx) [3, 4, 5, 6] ----
// Single-claim rule (source 4, high): per patient per day only the HIGHEST PT tier is paid, once.
export const PT_TIERS = {
  simple:          95,    // 42003C; 160/140/95 by hospital level, 95 = primary care (suffix mapping inferred)  medium [6]
  moderate:        200,   // estimate: scaled from simple with the 320/160 ratio of the old medical-centre table  low [3,6]
  moderateComplex: 330,   // estimate: 42011B regional = 480 x (95/140)                                            low [3]
  complex:         400,   // estimate: old medical-centre 600 x 0.68                                               low [5]
};
export const PT_TIER_CONFIDENCE = { simple: 'medium', moderate: 'low', moderateComplex: 'low', complex: 'low' };

// ---- per-treatment fees ----
// kind 'nhi'  : nhiPoints = listed NHI points per claim; `claim` = the daily claim group ('exam' | 'pt' | 'ot' | 'st' | 'us');
//               within one group only the highest listed value is paid per patient per visit (economy.nhiClaim).
// kind 'self' : selfPrice {low, typical, high} NT$ per session; the game sells at `typical` x the player's slider (0.5-2.0).
// selfPrice on an 'nhi' entry is market reference only (the game never charges it).
export const TREATMENT_FEES = {
  exam: {
    kind: 'nhi', claim: 'exam', nhiPoints: EXAM_FEE_TIERS[0].points, selfPrice: null, unit: '每次就診(日)',
    confidence: 'high', sources: [7, 8],
    note: 'listed = first tier (364); the points actually paid follow EXAM_FEE_TIERS by patients that day.',
  },
  us: {
    kind: 'nhi', claim: 'us', nhiPoints: 500, selfPrice: { low: 400, typical: 600, high: 800 }, unit: '每次',
    confidence: 'low', estimate: true, sources: [19, 36],
    note: 'NHI points are an estimate (no source); 600 is a clinic that was ruled NOT allowed to charge it self-pay (36). Reference only.',
  },
  heat: {
    kind: 'nhi', claim: 'pt', tier: 'moderate', nhiPoints: PT_TIERS.moderate, selfPrice: null, unit: '每日(併入當日最高階)',
    confidence: 'low', estimate: true, sources: [3, 6],
    note: 'hot/cold pack is a 中度 item (3); alone it is really 47039C (points not found).',
  },
  tens: {
    kind: 'nhi', claim: 'pt', tier: 'moderate', nhiPoints: PT_TIERS.moderate, selfPrice: null, unit: '每日(併入當日最高階)',
    confidence: 'low', estimate: true, sources: [3, 4],
    note: 'interferential / TENS counts as a 中度 item (3).',
  },
  traction: {
    kind: 'nhi', claim: 'pt', tier: 'moderate', nhiPoints: PT_TIERS.moderate, selfPrice: null, unit: '每日(併入當日最高階)',
    confidence: 'low', estimate: true, sources: [3, 4],
    note: 'traction is a 中度 item (3).',
  },
  ir: {
    kind: 'nhi', claim: 'pt', tier: 'simple', nhiPoints: PT_TIERS.simple, selfPrice: { low: 100, typical: 150, high: 200 }, unit: '每次',
    confidence: 'medium', sources: [6, 27],
    note: 'infrared = 簡單 tier, 95 points (42003C); the self-pay figure (27, low) is reference only.',
  },
  taping: {
    kind: 'nhi', claim: 'pt', tier: 'estimate', nhiPoints: 150, selfPrice: { low: 50, typical: 150, high: 400 }, unit: '每次',
    confidence: 'low', estimate: true, sources: [],
    note: 'NO SOURCE. In reality kinesio tape is not NHI-paid (self-pay or bundled into manual therapy); the game keeps it as a ~150-point NHI line, between simple and moderate.',
  },
  manual_nhi: {
    kind: 'nhi', claim: 'pt', tier: 'moderate', nhiPoints: PT_TIERS.moderate, selfPrice: null, unit: '每日(中度階)',
    confidence: 'low', estimate: true, sources: [3, 5],
    note: 'mobilisation / passive ROM / stretching are 中度 items; alone -> moderate. (>=3 moderate items and >50 min would be moderateComplex 330, not modelled.)',
  },
  redcord: {
    kind: 'self', claim: null, nhiPoints: 0, selfPrice: { low: 1500, typical: 1700, high: 2500 }, unit: '每次(約50分鐘)',
    confidence: 'low', sources: [20],
    note: 'single clinic 1-on-1 1,700 (one-to-two 2,300); low / high are estimates.',
  },
  shockwave: {
    kind: 'self', claim: null, nhiPoints: 0, selfPrice: { low: 1500, typical: 2500, high: 4000 }, unit: '每次',
    confidence: 'medium', sources: [16, 17, 18, 19, 34],
    note: 'quotes 2,000 / 2,500 / 3,000 / 2,000-4,000; typical = median. Courses are 2-8 weekly sessions.',
  },
  laser: {
    kind: 'self', claim: null, nhiPoints: 0, selfPrice: { low: 1000, typical: 2000, high: 2500 }, unit: '每次(15-25分鐘)',
    confidence: 'medium', sources: [19, 20, 21, 39],
    note: 'high-power laser (>500 mW) is self-pay; high 2,500 is an estimate.',
  },
  manual_self: {
    kind: 'self', claim: null, nhiPoints: 0, selfPrice: { low: 800, typical: 2000, high: 3500 }, unit: '每60分鐘',
    confidence: 'medium', sources: [19, 22, 29],
    note: '60 min: 2,000-3,500 Taipei, 2,000 Hsinchu, 1,500-3,000 national; Taipei is 20-40% above central / south.',
  },
  prp: {
    kind: 'self', claim: null, nhiPoints: 0, selfPrice: { low: 8000, typical: 17000, high: 25000 }, unit: '每針/每次',
    confidence: 'medium', sources: [22, 24, 25, 26, 38],
    note: 'quotes 15,000 / 18,000 / 12,000-25,000; courses are usually 3 shots 2-4 weeks apart.',
  },
  insole: {
    kind: 'self', claim: null, nhiPoints: 0, selfPrice: { low: 3500, typical: 5000, high: 9000 }, unit: '每雙',
    confidence: 'low', sources: [28],
    note: 'hospital orthotics 3,500-4,000 (forum anecdote) vs commercial 3D-scan 5,600-8,900; typical 5,000 is a blend.',
  },
  si: {
    kind: 'nhi', claim: 'ot', tier: 'moderate', nhiPoints: 320, selfPrice: null, unit: '每次(職能治療)',
    confidence: 'low', estimate: true, sources: [32],
    note: 'OT shares the simple 240 / moderate 320 / moderate-complex 480 structure; primary-care points not found.',
  },
  fine: {
    kind: 'nhi', claim: 'ot', tier: 'moderate', nhiPoints: 320, selfPrice: null, unit: '每次(職能治療)',
    confidence: 'low', estimate: true, sources: [32],
    note: 'same OT claim as si (one OT claim per day).',
  },
  speech: {
    kind: 'nhi', claim: 'st', tier: 'moderate', nhiPoints: 320, selfPrice: null, unit: '每次(語言治療)',
    confidence: 'low', estimate: true, sources: [32],
    note: '44001A simple 240 / 44004A moderate 320 / 44013A 480 in one version; the game session is 60 min -> 320. Level / year unverified.',
  },
};

// Daily claim groups (single-claim rule, source 4 for 'pt'; 'exam', 'ot', 'st', 'us' are separate claims, source 1 for OT/ST once a day).
export const CLAIM_GROUPS = ['exam', 'pt', 'ot', 'st', 'us'];

// Where the displayed text for the rule lives (UI strings share one wording).
export const SINGLE_CLAIM_NOTE = '同日物理治療僅給付最高一項';
