// Synergy zones (H1). Computed by sim/synergy.js; see docs/ARCHITECTURE.md §3.1.
// effects are ADDITIVE DELTAS on defaultMods() keys (js/core/state.js):
//   nhiTurnover base 1 → +0.2 means 1.2; researchGain base 1 → +0.25 means 1.25; stacking zones add.

export const SYNERGIES = [
  {
    id: 'golden3',
    name: '黃金三寶區',
    icon: '🥇',
    needs: ['heatbox', 'tens', 'traction'],
    effects: { nhiTurnover: 0.2, elderSat: 8 },
    desc: '熱敷、電療、牽引相鄰成一區，健保翻桌率 +20%，長輩滿意度 +8。',
  },
  {
    id: 'premium',
    name: '高階自費專區',
    icon: '💎',
    needs: ['manual_room', 'shockwave', 'coffee'],
    effects: { selfPayConv: 0.15, selfPayPrice: 0.1 },
    desc: '徒手診間、震波儀與咖啡機相鄰，自費轉換率 +15%，自費單價 +10%。',
  },
  {
    id: 'kidpark',
    name: '早療放電樂園',
    icon: '🧸',
    needs: ['ball_pit', 'soft_mat', 'bookshelf'],
    effects: { researchGain: 0.25 },
    desc: '球池、防撞軟墊與繪本架相鄰，研發點數獲得 ×1.25。',
  },
  // Extra mini zones (optional flavour; same rules).
  {
    id: 'waitRoom',
    name: '候診舒適區',
    icon: '🪑',
    needs: ['sofa', 'water', 'plant', 'tv'],
    effects: { patience: 0.1, elderSat: 2 },
    desc: '沙發、飲水機、綠植與電視牆相鄰，病患耐心 +10%，長輩滿意度 +2。',
  },
  {
    id: 'restStation',
    name: '員工喘息站',
    icon: '☕',
    needs: ['rest_room', 'water'],
    effects: { staffStamina: -0.1 },
    desc: '休息室旁設飲水機，員工體力消耗降低 10%。',
  },
];

export const ADJACENCY_NOTE =
  '相鄰規則：兩個「物件」的佔地若只差一格以內（含斜角）即視為相鄰，連成一片的物件群組若包含某專區所需的全部設施，該專區即啟動。' +
  '地板（防滑地墊、木紋地板、坡道）不是物件，不計入相鄰；同一設施可重複擺放；效果為加總疊加。';
