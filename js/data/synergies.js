// Synergy zones (H1). Computed by sim/synergy.js; see docs/ARCHITECTURE.md §3.1.
// effects are ADDITIVE DELTAS on defaultMods() keys (js/core/state.js):
//   nhiTurnover base 1 → +0.2 means 1.2; researchGain base 1 → +0.25 means 1.25; stacking zones add.
//   dotted keys: 'typeSpawn.<t>' (base 1), 'typeSat.<t>' / 'typeCure.<t>' (base 0), t = elder|office|sports|kid.
//
// Zone fields:
//   id, name, icon, desc, effects                    (as before)
//   needs: [defId,...]        every id must appear (>= 1 copy) in ONE connected cluster of touching objects
//   needsCount: {defId: n}    optional: that id must appear >= n times in the cluster (default 1)
//   needsFloors: {floorId: n} optional: >= n floor tiles of that type that touch a member object or form one
//                             contiguous (8-neighbour) strip of that type touching it (see sim/synergy.js)
//   tier: 'basic'|'advanced'|'master'   rough "when can I afford it" label for the dictionary
//   group: 'treatment'|'waiting'|'staff'|'kids'|'selfpay'|'sports'|'elder'    dictionary filter
//   unlock: research node id  the dictionary shows the zone as 🔒 until it is done (the needed buildables'
//                             own `requires` nodes are merged in automatically by sim/synergy.js: zoneLocks)
//   hint: one-line 「怎麼擺」 tip for the dictionary

export const ZONE_GROUPS = {
  treatment: '治療', waiting: '候診', staff: '員工', kids: '兒童', selfpay: '自費', sports: '運動', elder: '長者',
};
export const ZONE_TIERS = { basic: '基礎', advanced: '進階', master: '大師' };

export const SYNERGIES = [
  {
    id: 'golden3',
    name: '黃金三寶區',
    icon: '🥇',
    needs: ['heatbox', 'tens', 'traction'],
    effects: { nhiTurnover: 0.2, elderSat: 8 },
    desc: '熱敷、電療、牽引相鄰成一區，健保翻桌率 +20%，長輩滿意度 +8。',
    tier: 'basic', group: 'treatment',
    hint: '把三台機器緊貼擺放，斜角也算相鄰。',
  },
  {
    id: 'premium',
    name: '高階自費專區',
    icon: '💎',
    needs: ['manual_room', 'shockwave', 'coffee'],
    effects: { selfPayConv: 0.15, selfPayPrice: 0.1 },
    desc: '徒手診間、震波儀與咖啡機相鄰，自費轉換率 +15%，自費單價 +10%。',
    tier: 'advanced', group: 'selfpay', unlock: 'rs_shockwave',
    hint: '徒手診間旁緊貼震波儀，再把咖啡機放在它們旁邊。',
  },
  {
    id: 'kidpark',
    name: '早療放電樂園',
    icon: '🧸',
    needs: ['ball_pit', 'soft_mat', 'bookshelf'],
    effects: { researchGain: 0.25 },
    desc: '球池、防撞軟墊與繪本架相鄰，研發點數獲得 ×1.25。',
    tier: 'advanced', group: 'kids', unlock: 'rs_ot',
    hint: '球池、軟墊（可踩）與繪本架圍成一小塊，邊角相碰就算。',
  },
  // Extra mini zones (optional flavour; same rules).
  {
    id: 'waitRoom',
    name: '候診舒適區',
    icon: '🪑',
    needs: ['sofa', 'water', 'plant', 'tv'],
    effects: { patience: 0.1, elderSat: 2 },
    desc: '沙發、飲水機、綠植與電視牆相鄰，病患耐心 +10%，長輩滿意度 +2。',
    tier: 'basic', group: 'waiting',
    hint: '候診區的四樣家具緊貼成一排，離掛號櫃檯近一點最方便。',
  },
  {
    id: 'restStation',
    name: '員工喘息站',
    icon: '☕',
    needs: ['rest_room', 'water'],
    effects: { staffStamina: -0.1 },
    desc: '休息室旁設飲水機，員工體力消耗降低 10%。',
    tier: 'basic', group: 'staff',
    hint: '飲水機緊貼休息室的任一邊。',
  },

  // ---- v2 zones (dictionary expansion): existing buildables only ----
  {
    id: 'sportsRehab',
    name: '運動復健專區',
    icon: '🏃',
    needs: ['redcord', 'bed', 'soft_mat'],
    effects: { 'typeSpawn.sports': 0.1, 'typeCure.sports': 0.06, selfPayConv: 0.02 },
    desc: '懸吊系統、治療床與防撞軟墊連成一區，運動傷害病患來客 +10%、療效 +6%、自費轉換率 +2%。',
    tier: 'advanced', group: 'sports', unlock: 'rs_redcord',
    hint: '懸吊架旁邊貼上治療床，軟墊鋪在架子下方（可踩）。',
  },
  {
    id: 'elderPath',
    name: '長者友善動線',
    icon: '♿',
    needs: ['sign', 'sofa'],
    needsFloors: { ramp: 3 },
    effects: { elderSat: 6, slipRisk: -0.15, walkSpeed: 0.02 },
    desc: '至少 3 格坡道緊鄰標示與沙發，長輩滿意度 +6、滑倒風險 −15%、步行速度 +2%。',
    tier: 'basic', group: 'elder',
    hint: '標示與沙發相鄰，再鋪 3 格坡道連成一條、其中一格貼著它們。',
  },
  {
    id: 'orthoStation',
    name: '骨科評估站',
    icon: '🦴',
    needs: ['exam_room', 'us_room', 'bed'],
    effects: { cureGain: 0.04, researchGain: 0.06 },
    desc: '看診室、超音波檢查室與治療床相鄰，治癒效率 +4%、研發點數 +6%。',
    tier: 'advanced', group: 'treatment', unlock: 'rs_ultrasound',
    hint: '看診室與超音波室並排，治療床貼在任一側。',
  },
  {
    id: 'hotCold',
    name: '冷熱雙療區',
    icon: '🔥',
    needs: ['ir_lamp', 'heatbox', 'bed'],
    effects: { patience: 0.03, nhiTurnover: 0.03, 'typeSat.office': 3 },
    desc: '紅外線燈、熱敷機與治療床相鄰，病患耐心 +3%、健保翻桌率 +3%、上班族滿意度 +3。',
    tier: 'basic', group: 'treatment',
    hint: '紅外線燈、熱敷機貼著治療床擺成一小塊。',
  },
  {
    id: 'kidLearn',
    name: '共學早療室',
    icon: '🧩',
    needs: ['speech_room', 'si_room', 'fine_table'],
    effects: { 'typeSpawn.kid': 0.1, 'typeCure.kid': 0.08, researchGain: 0.08 },
    desc: '語言治療室、感統室與精細動作桌連成一區，早療兒童來客 +10%、療效 +8%、研發點數 +8%。',
    tier: 'master', group: 'kids', unlock: 'rs_st',
    hint: '感統室（3×3）旁貼語言室，精細動作桌嵌在兩者的邊角。',
  },
  {
    id: 'kidCorner',
    name: '親子遊戲角',
    icon: '🎈',
    needs: ['fine_table', 'bookshelf', 'soft_mat'],
    effects: { 'typeSat.kid': 6, satGain: 1 },
    desc: '精細動作桌、繪本架與軟墊相鄰，早療兒童滿意度 +6、所有病患滿意度 +1。',
    tier: 'advanced', group: 'kids', unlock: 'rs_ot',
    hint: '三件小物緊貼在候診區旁，家長陪著孩子玩最安心。',
  },
  {
    id: 'flagship',
    name: '自費旗艦廊',
    icon: '👑',
    needs: ['laser_room', 'shockwave_room', 'manual_room'],
    effects: { selfPayConv: 0.035, selfPayPrice: 0.03 },
    desc: '高能量雷射室、震波室與徒手診間並排成一條廊，自費轉換率 +3.5%、自費單價 +3%。',
    tier: 'advanced', group: 'selfpay', unlock: 'rs_laser',
    hint: '三間 2×2 診間排成一列（或 L 形），邊緣緊貼。',
  },
  {
    id: 'staffBack',
    name: '員工友善後勤',
    icon: '🍵',
    needs: ['rest_room', 'coffee', 'water', 'plant'],
    effects: { staffStamina: -0.12, repGrowth: 0.05 },
    desc: '休息室、咖啡機、飲水機與綠植連成後勤角，員工體力消耗 −12%、聲譽每週 +0.05。',
    tier: 'advanced', group: 'staff',
    hint: '休息室外圍一圈放咖啡機、飲水機與綠植。',
  },
  {
    id: 'cafeNook',
    name: '候診咖啡角',
    icon: '🫖',
    needs: ['sofa', 'coffee', 'tv', 'plant'],
    effects: { patience: 0.05, selfPayConv: 0.015, 'typeSat.office': 4 },
    desc: '沙發、咖啡機、電視牆與綠植相鄰，病患耐心 +5%、自費轉換率 +1.5%、上班族滿意度 +4。',
    tier: 'basic', group: 'waiting',
    hint: '在候診沙發旁加一台咖啡機與綠植，電視牆貼著擺。',
  },
  {
    id: 'regDesk',
    name: '掛號便民區',
    icon: '📋',
    needs: ['reception', 'sign', 'sofa', 'water'],
    effects: { patience: 0.04, walkSpeed: 0.01 },
    desc: '掛號櫃檯旁備好標示、沙發與飲水機，病患耐心 +4%、步行速度 +1%。',
    tier: 'basic', group: 'waiting',
    hint: '掛號櫃檯旁貼著標示、沙發與飲水機，一進門就能辦完。',
  },
];

export const ADJACENCY_NOTE =
  '相鄰規則：兩個「物件」的佔地若只差一格以內（含斜角）即視為相鄰，連成一片的物件群組若包含某專區所需的全部設施，該專區即啟動。' +
  '地板（防滑地墊、木紋地板、坡道）不是物件，不計入相鄰；但少數專區（如長者友善動線）另外要求「貼著設施的地板格數」（坡道 ≥ 3 格）。' +
  '同一設施可重複擺放；效果為加總疊加。';
