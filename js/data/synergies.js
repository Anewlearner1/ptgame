// Synergy zones (restaurant). Computed by sim/synergy.js; see docs/ARCHITECTURE.md §3.1.
// effects are ADDITIVE DELTAS on defaultMods() keys (js/core/state.js):
//   nhiTurnover base 1 → +0.2 means 1.2; researchGain base 1 → +0.25 means 1.25; stacking zones add.
//   dotted keys: 'typeSpawn.<t>' (base 1), 'typeSat.<t>' / 'typeCure.<t>' (base 0), t = elder|office|student|family.
//
// Zone fields:
//   id, name, icon, desc, effects                    (as before)
//   needs: [defId,...]        every id must appear (>= 1 copy) in ONE connected cluster of touching objects
//   needsCount: {defId: n}    optional: that id must appear >= n times in the cluster (default 1)
//   needsFloors: {floorId: n} optional: >= n floor tiles of that type that touch a member object or form one
//                             contiguous (8-neighbour) strip of that type touching it (see sim/synergy.js)
//   tier: 'basic'|'advanced'|'master'   rough "when can I afford it" label for the dictionary
//   group: 'kitchen'|'waiting'|'staff'|'kids'|'special'|'student'|'elder'    dictionary filter
//   unlock: research node id  the dictionary shows the zone as 🔒 until it is done (the needed buildables'
//                             own `requires` nodes are merged in automatically by sim/synergy.js: zoneLocks)
//   hint: one-line 「怎麼擺」 tip for the dictionary

export const ZONE_GROUPS = {
  kitchen: '廚房', waiting: '候位', staff: '員工', kids: '親子', special: '特色料理', student: '學生', elder: '長者',
};
export const ZONE_TIERS = { basic: '基礎', advanced: '進階', master: '大師' };

export const SYNERGIES = [
  {
    id: 'golden3',
    name: '黃金爐火區',
    icon: '🔥',
    needs: ['noodle_stove', 'braise_pot', 'fryer'],
    effects: { nhiTurnover: 0.2, elderSat: 8 },
    desc: '煮麵台、滷肉鍋與油炸鍋相鄰成一區，基本餐點翻桌率 +20%，長輩滿意度 +8。',
    tier: 'basic', group: 'kitchen',
    hint: '把三個爐具緊貼擺放，斜角也算相鄰。',
  },
  {
    id: 'premium',
    name: '高端餐飲區',
    icon: '💎',
    needs: ['chef_table', 'dessert_bar', 'coffee'],
    effects: { selfPayConv: 0.15, selfPayPrice: 0.1 },
    desc: '主廚餐檯、甜點吧與咖啡機相鄰，加點轉換率 +15%，特色料理單價 +10%。',
    tier: 'advanced', group: 'special', unlock: 'rs_steak',
    hint: '主廚餐檯旁緊貼甜點吧，再把咖啡機放在它們旁邊。',
  },
  {
    id: 'kidpark',
    name: '親子放電樂園',
    icon: '🧸',
    needs: ['play_area', 'kids_mat', 'bookshelf'],
    effects: { researchGain: 0.25 },
    desc: '兒童遊戲區、軟墊與繪本架相鄰，研發點數獲得 ×1.25。',
    tier: 'advanced', group: 'kids', unlock: 'rs_kids',
    hint: '遊戲區、軟墊（可踩）與繪本架圍成一小塊，邊角相碰就算。',
  },
  // Extra mini zones (optional flavour; same rules).
  {
    id: 'waitRoom',
    name: '候位舒適區',
    icon: '🪑',
    needs: ['bench', 'water', 'plant', 'tv'],
    effects: { patience: 0.1, elderSat: 2 },
    desc: '長椅、冰水機、綠植與電視牆相鄰，客人耐心 +10%，長輩滿意度 +2。',
    tier: 'basic', group: 'waiting',
    hint: '候位區的四樣家具緊貼成一排，離點餐櫃檯近一點最方便。',
  },
  {
    id: 'restStation',
    name: '員工喘息站',
    icon: '☕',
    needs: ['rest_room', 'water'],
    effects: { staffStamina: -0.1 },
    desc: '休息室旁設冰水機，員工體力消耗降低 10%。',
    tier: 'basic', group: 'staff',
    hint: '冰水機緊貼休息室的任一邊。',
  },

  // ---- v2 zones (dictionary expansion): existing buildables only ----
  {
    id: 'sportsRehab',
    name: '學生社群據點',
    icon: '🎒',
    needs: ['fryer', 'drink_bar', 'ice_shop'],
    effects: { 'typeSpawn.student': 0.1, 'typeCure.student': 0.06, selfPayConv: 0.02 },
    desc: '油炸鍋、飲料吧與冰品檯連成一區，學生客來客 +10%、熟客化 +6%、加點轉換率 +2%。',
    tier: 'advanced', group: 'student', unlock: 'rs_ice',
    hint: '炸物、手搖飲、冰品三件事擺在一起，學生一站買齊。',
  },
  {
    id: 'elderPath',
    name: '長者友善動線',
    icon: '♿',
    needs: ['sign', 'bench'],
    needsFloors: { ramp: 3 },
    effects: { elderSat: 6, slipRisk: -0.15, walkSpeed: 0.02 },
    desc: '至少 3 格坡道緊鄰指示招牌與長椅，長輩滿意度 +6、滑倒風險 −15%、步行速度 +2%。',
    tier: 'basic', group: 'elder',
    hint: '招牌與長椅相鄰，再鋪 3 格坡道連成一條、其中一格貼著它們。',
  },
  {
    id: 'orthoStation',
    name: '主廚出餐線',
    icon: '🍳',
    needs: ['chef_range', 'teppan', 'noodle_stove'],
    effects: { cureGain: 0.04, researchGain: 0.06 },
    desc: '主廚爐台、鐵板檯與煮麵台相鄰，熟客化效率 +4%、研發點數 +6%。',
    tier: 'advanced', group: 'kitchen', unlock: 'rs_teppan',
    hint: '主廚爐台與鐵板檯並排，煮麵台貼在任一側。',
  },
  {
    id: 'hotCold',
    name: '冷熱湯飲區',
    icon: '🥤',
    needs: ['soup_pot', 'drink_bar', 'cold_case'],
    effects: { patience: 0.03, nhiTurnover: 0.03, 'typeSat.office': 3 },
    desc: '例湯鍋、飲料吧與冷盤檯相鄰，客人耐心 +3%、基本餐點翻桌率 +3%、上班族滿意度 +3。',
    tier: 'basic', group: 'kitchen',
    hint: '湯鍋、飲料吧貼著冷盤檯擺成一小塊。',
  },
  {
    id: 'kidLearn',
    name: '家庭宴席區',
    icon: '🫕',
    needs: ['hotpot_table', 'table4', 'play_area'],
    effects: { 'typeSpawn.family': 0.1, 'typeCure.family': 0.08, researchGain: 0.08 },
    desc: '火鍋桌、四人桌與兒童遊戲區連成一區，家庭客來客 +10%、熟客化 +8%、研發點數 +8%。',
    tier: 'master', group: 'kids', unlock: 'rs_hotpot',
    hint: '火鍋桌（2×2）旁貼四人桌，遊戲區嵌在兩者的邊角。',
  },
  {
    id: 'kidCorner',
    name: '親子遊戲角',
    icon: '🎈',
    needs: ['table4', 'bookshelf', 'kids_mat'],
    effects: { 'typeSat.family': 6, satGain: 1 },
    desc: '四人桌、繪本架與軟墊相鄰，家庭客滿意度 +6、所有客人滿意度 +1。',
    tier: 'advanced', group: 'kids', unlock: 'rs_kids',
    hint: '三件小物緊貼在候位區旁，家長看著孩子玩最安心。',
  },
  {
    id: 'flagship',
    name: '宵夜熱炒廊',
    icon: '🍻',
    needs: ['wok_range', 'bar_counter', 'bbq_grill'],
    effects: { selfPayConv: 0.035, selfPayPrice: 0.03 },
    desc: '熱炒爐、吧台與炭火爐並排成一條廊，加點轉換率 +3.5%、特色料理單價 +3%。',
    tier: 'advanced', group: 'special', unlock: 'rs_bbq',
    hint: '三個特色料理設備排成一列（或 L 形），邊緣緊貼。',
  },
  {
    id: 'staffBack',
    name: '員工友善後勤',
    icon: '🍵',
    needs: ['rest_room', 'coffee', 'water', 'plant'],
    effects: { staffStamina: -0.12, repGrowth: 0.05 },
    desc: '休息室、咖啡機、冰水機與綠植連成後勤角，員工體力消耗 −12%、聲譽每週 +0.05。',
    tier: 'advanced', group: 'staff',
    hint: '休息室外圍一圈放咖啡機、冰水機與綠植。',
  },
  {
    id: 'cafeNook',
    name: '候位咖啡角',
    icon: '🫖',
    needs: ['bench', 'coffee', 'tv', 'plant'],
    effects: { patience: 0.05, selfPayConv: 0.015, 'typeSat.office': 4 },
    desc: '長椅、咖啡機、電視牆與綠植相鄰，客人耐心 +5%、加點轉換率 +1.5%、上班族滿意度 +4。',
    tier: 'basic', group: 'waiting',
    hint: '在候位長椅旁加一台咖啡機與綠植，電視牆貼著擺。',
  },
  {
    id: 'regDesk',
    name: '點餐便民區',
    icon: '📋',
    needs: ['reception', 'sign', 'bench', 'water'],
    effects: { patience: 0.04, walkSpeed: 0.01 },
    desc: '點餐櫃檯旁備好招牌、長椅與冰水機，客人耐心 +4%、步行速度 +1%。',
    tier: 'basic', group: 'waiting',
    hint: '點餐櫃檯旁貼著招牌、長椅與冰水機，一進門就能點完。',
  },
];

export const ADJACENCY_NOTE =
  '相鄰規則：兩個「物件」的佔地若只差一格以內（含斜角）即視為相鄰，連成一片的物件群組若包含某專區所需的全部設施，該專區即啟動。' +
  '地板（防滑磁磚、木紋地板、坡道）不是物件，不計入相鄰；但少數專區（如長者友善動線）另外要求「貼著設施的地板格數」（坡道 ≥ 3 格）。' +
  '同一設施可重複擺放；效果為加總疊加。';
