// Clinic lots (H1). Nested rectangles sharing the same bottom edge; door at (15, y0+h).
// rent / nhiCap / maxPatientsPerWeek / maxStaff are per-level capacities.
// expandCost = NT$ paid to move INTO this level (L0 is the starting lot, so 0).
// requires = conditions checked by sim/inspection.js canExpand(); `label` is the 繁中 summary for the UI checklist.

export const LOTS = [
  {
    name: '巷弄小診所',
    lot: { x0: 10, y0: 10, w: 12, h: 10 },
    door: { x: 15, y: 20 },
    rent: 60000,
    nhiCap: 28000,
    maxPatientsPerWeek: 22,
    maxStaff: 6,
    expandCost: 0,
    requires: {
      minReputation: 0, minYear: 1, minStaff: 0, minAvgSat: 0, needRamp: false, minSeats: 0,
      label: '起始診所，無需條件',
    },
  },
  {
    name: '社區診所',
    lot: { x0: 9, y0: 8, w: 14, h: 12 },
    door: { x: 15, y: 20 },
    rent: 110000,
    nhiCap: 38000,
    maxPatientsPerWeek: 38,
    maxStaff: 10,
    expandCost: 800000,
    requires: {
      minReputation: 60, minYear: 1, minStaff: 4, minAvgSat: 55, needRamp: true, minSeats: 2,
      label: '聲譽 ≥ 60、員工 ≥ 4、平均滿意度 ≥ 55、有無障礙坡道、候診座位 ≥ 2',
    },
  },
  {
    name: '地區復健中心',
    lot: { x0: 8, y0: 6, w: 16, h: 14 },
    door: { x: 15, y: 20 },
    rent: 130000,
    nhiCap: 56000,
    maxPatientsPerWeek: 68,
    maxStaff: 15,
    expandCost: 2500000,
    requires: {
      minReputation: 150, minYear: 2, minStaff: 7, minAvgSat: 65, needRamp: true, minSeats: 4, research: 'rs_expand',
      label: '聲譽 ≥ 150、第 2 年起、員工 ≥ 7、平均滿意度 ≥ 65、有無障礙坡道、候診座位 ≥ 4、完成研發「擴建規劃」（服務點數）',
    },
  },
  {
    name: '全台頂尖復健中心',
    lot: { x0: 6, y0: 4, w: 20, h: 16 },
    door: { x: 15, y: 20 },
    rent: 180000,
    nhiCap: 82000,
    maxPatientsPerWeek: 100,
    maxStaff: 22,
    expandCost: 6000000,
    requires: {
      minReputation: 320, minYear: 3, minStaff: 11, minAvgSat: 72, needRamp: true, minSeats: 6, research: 'rs_expand',
      label: '聲譽 ≥ 320、第 3 年起、員工 ≥ 11、平均滿意度 ≥ 72、有無障礙坡道、候診座位 ≥ 6、完成研發「擴建規劃」（服務點數）',
    },
  },
];

// Things the 衛生局 (hygiene bureau) and 健保署 (NHI) check at each year end (sim/inspection.js).
// weight = relative importance in the inspection score.
export const INSPECTION_RULES = [
  {
    id: 'ramp',
    name: '無障礙通行（衛生局）',
    desc: '診所內需有無障礙坡道，輪椅與助行器可直達治療區。未設置者直接扣分。',
    weight: 10,
  },
  {
    id: 'seats',
    name: '候診座位（衛生局）',
    desc: '候診座位數需達到該院所等級的下限（L0 免、L1 ≥ 2、L2 ≥ 4、L3 ≥ 6）。',
    weight: 8,
  },
  {
    id: 'antislip',
    name: '防滑地面覆蓋（衛生局）',
    desc: '治療區動線上防滑地墊或無障礙坡道的覆蓋率需達 40% 以上，否則跌倒風險計入評分。',
    weight: 9,
  },
  {
    id: 'staff_license',
    name: '執照人員配置（衛生局）',
    desc: '至少一位復健科醫師與一位物理治療師持照上班；職能、語言治療師若有開設相關治療，也需持照。',
    weight: 10,
  },
  {
    id: 'satisfaction',
    name: '病患滿意度（衛生局）',
    desc: '全年平均病患滿意度需達 50 以上，低於此值會收到申訴與罰鍰。',
    weight: 8,
  },
  {
    id: 'nhi_abuse',
    name: '健保點數申報（健保署）',
    desc: '健保點數若超出院所等級的月上限，健保署視為濫用申報，點值會被壓低並可能扣款。',
    weight: 12,
  },
];
