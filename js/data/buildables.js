// Buildable catalogue (H1). Keys = def ids used across sim/render/ui. See docs/ARCHITECTURE.md §3.1.
// requires: research node id that unlocks the item (null = available from the start).
// color = side/front colour, top = lighter top face. height in px at zoom 1.

export const BUILDABLES = {
  // ───── 環境：地板與通道（layer floor → state.map.floor, 1×1）─────
  floor_mat: {
    id: 'floor_mat', name: '防滑地墊', cat: 'env', sub: '地板與通道', layer: 'floor',
    w: 1, h: 1, blocks: false, cost: 250, upkeep: 0, requires: null,
    color: '#2f7f73', top: '#5fb3a3', height: 2, glyph: '▩',
    grip: 0.95, desc: '橡膠防滑地墊，長輩與濕滑天氣下最安心。',
  },
  floor_wood: {
    id: 'floor_wood', name: '木紋地板', cat: 'env', sub: '地板與通道', layer: 'floor',
    w: 1, h: 1, blocks: false, cost: 350, upkeep: 0, requires: null,
    color: '#8b5a2b', top: '#c08a52', height: 2, glyph: '▤',
    grip: 0.6, desc: '溫潤木紋，好看但雨天容易滑。',
  },
  ramp: {
    id: 'ramp', name: '無障礙坡道', cat: 'env', sub: '地板與通道', layer: 'floor',
    w: 1, h: 1, blocks: false, cost: 500, upkeep: 0, requires: null,
    color: '#9aa3ad', top: '#c9d0d8', height: 3, glyph: '♿',
    grip: 0.8, walkMult: 1.25, desc: '輪椅與助行器可通行，衛生局檢查必備。',
  },

  // ───── 環境：候診與景觀 ─────
  sofa: {
    id: 'sofa', name: '候診沙發', cat: 'env', sub: '候診與景觀', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 8000, upkeep: 80, requires: null,
    color: '#c2475a', top: '#e0768a', height: 6, glyph: '🛋',
    seats: 2, comfort: 3, desc: '提供 2 個候診座位，候診時間也能舒服一點。',
  },
  water: {
    id: 'water', name: '飲水機', cat: 'env', sub: '候診與景觀', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 5000, upkeep: 50, requires: null,
    color: '#3b7fd1', top: '#7fb6ef', height: 16, glyph: '🚰',
    comfort: 2, anxietyRelief: 1, desc: '免費飲水，減少病患等候時的焦躁。',
  },
  tv: {
    id: 'tv', name: '電視牆', cat: 'env', sub: '候診與景觀', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 25000, upkeep: 250, requires: null,
    color: '#2b2f3a', top: '#4a5063', height: 18, glyph: '📺',
    comfort: 3, anxietyRelief: 3, desc: '播放衛教與綜藝節目，等候時間過得快。',
  },
  plant: {
    id: 'plant', name: '綠植', cat: 'env', sub: '候診與景觀', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 2000, upkeep: 20, requires: null,
    color: '#2e7d32', top: '#66bb6a', height: 14, glyph: '🪴',
    comfort: 4, desc: '綠色植栽讓診所看起來清新舒適。',
  },
  sign: {
    id: 'sign', name: '誘導標示', cat: 'env', sub: '候診與景觀', layer: 'object',
    w: 1, h: 1, blocks: false, cost: 1000, upkeep: 8, requires: null,
    color: '#f2b705', top: '#ffd966', height: 4, glyph: '🪧',
    anxietyRelief: 2, desc: '清楚的樓層與科別指引，減少病患迷路與焦慮。',
  },

  // ───── 設施：基礎門診 ─────
  reception: {
    id: 'reception', name: '掛號櫃檯', cat: 'facility', sub: '基礎門診', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 30000, upkeep: 300, requires: null,
    color: '#d9c7a5', top: '#f3e6cc', height: 12, glyph: '🛎',
    desc: '掛號與批價櫃檯，所有病患都從這裡開始。',
  },
  exam_room: {
    id: 'exam_room', name: '看診室', cat: 'facility', sub: '基礎門診', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 120000, upkeep: 1200, requires: null,
    color: '#8fd3c7', top: '#c9efe8', height: 40, glyph: '🩺',
    stationFor: ['exam', 'prp'], desc: '醫師門診與 PRP 增生療法的場所。',
  },
  us_room: {
    id: 'us_room', name: '超音波檢查室', cat: 'facility', sub: '基礎門診', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 250000, upkeep: 2500, requires: 'rs_ultrasound',
    color: '#7aa7d9', top: '#b3d1ef', height: 40, glyph: '📡',
    stationFor: ['us'], desc: '超音波評估與引導，醫師可直接在診間判讀。',
  },
  rest_room: {
    id: 'rest_room', name: '休息室', cat: 'facility', sub: '基礎門診', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 60000, upkeep: 600, requires: null,
    color: '#d9a7c7', top: '#f0cfe3', height: 40, glyph: '🛌',
    restRecovery: 0.8, desc: '員工與病患的休息空間，員工體力回復更快。',
  },

  // ───── 設施：物理治療區 ─────
  heatbox: {
    id: 'heatbox', name: '熱敷箱', cat: 'facility', sub: '物理治療區', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 25000, upkeep: 250, requires: null,
    color: '#d2452f', top: '#f0826a', height: 16, glyph: '♨',
    stationFor: ['heat'], desc: '健保常見的熱敷治療，操作簡單、翻桌快。',
  },
  tens: {
    id: 'tens', name: '電療儀', cat: 'facility', sub: '物理治療區', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 40000, upkeep: 400, requires: null,
    color: '#5b4bb8', top: '#8c80e0', height: 18, glyph: '⚡',
    stationFor: ['tens'], desc: '干擾波／TENS 電療，黃金三寶之一。',
  },
  traction: {
    id: 'traction', name: '頸腰椎牽引機', cat: 'facility', sub: '物理治療區', layer: 'object',
    w: 1, h: 2, blocks: true, cost: 80000, upkeep: 800, requires: null,
    color: '#6d4c2f', top: '#a57c52', height: 22, glyph: '🦴',
    stationFor: ['traction'], desc: '頸椎與腰椎牽引，黃金三寶中的長輩最愛。',
  },
  ir_lamp: {
    id: 'ir_lamp', name: '紅外線燈', cat: 'facility', sub: '物理治療區', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 20000, upkeep: 200, requires: null,
    color: '#c77d12', top: '#f4b04a', height: 20, glyph: '🌡',
    stationFor: ['ir'], desc: '紅外線照射，舒緩肌肉痠痛。',
  },
  bed: {
    id: 'bed', name: '治療床', cat: 'facility', sub: '物理治療區', layer: 'object',
    w: 1, h: 2, blocks: true, cost: 30000, upkeep: 300, requires: null,
    color: '#9fb6c9', top: '#d6e2ec', height: 8, glyph: '🛏',
    stationFor: ['taping', 'manual_nhi', 'insole'], desc: '貼紮、健保徒手與客製鞋墊共用的治療床。',
  },

  // ───── 設施：運動與自費治療區 ─────
  redcord: {
    id: 'redcord', name: '懸吊系統', cat: 'facility', sub: '運動與自費', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 150000, upkeep: 1500, requires: 'rs_redcord',
    color: '#2e5e8c', top: '#5b8fc2', height: 18, glyph: '➰',
    stationFor: ['redcord'], desc: '懸吊運動治療（自費），運動員與上班族的熱門項目。',
  },
  shockwave_room: {
    id: 'shockwave_room', name: '震波治療室', cat: 'facility', sub: '運動與自費', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 350000, upkeep: 3500, requires: 'rs_shockwave',
    color: '#3d4f5c', top: '#6d8496', height: 40, glyph: '💥',
    stationFor: ['shockwave'], desc: '獨立的體外震波治療間，隱私與舒適兼顧。',
  },
  laser_room: {
    id: 'laser_room', name: '高能量雷射室', cat: 'facility', sub: '運動與自費', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 450000, upkeep: 4500, requires: 'rs_laser',
    color: '#b1243a', top: '#e0566d', height: 40, glyph: '🔦',
    stationFor: ['laser'], desc: '高能量雷射治療（自費），高單價高投資。',
  },
  manual_room: {
    id: 'manual_room', name: '徒手治療獨立診間', cat: 'facility', sub: '運動與自費', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 200000, upkeep: 2000, requires: 'rs_manual',
    color: '#5e8c4a', top: '#8fc27a', height: 40, glyph: '🤲',
    stationFor: ['manual_self'], desc: '自費徒手治療專用診間，需要治療師親自到場。',
  },

  // ───── 設施：職能與早療 ─────
  si_room: {
    id: 'si_room', name: '感覺統合教室', cat: 'facility', sub: '職能與早療', layer: 'object',
    w: 3, h: 3, blocks: true, cost: 400000, upkeep: 4000, requires: 'rs_ot',
    color: '#ff8f3d', top: '#ffb87a', height: 40, glyph: '🧸',
    stationFor: ['si'], desc: '感覺統合訓練教室（含平衡木），早療的核心空間。',
  },
  fine_table: {
    id: 'fine_table', name: '精細動作訓練桌', cat: 'facility', sub: '職能與早療', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 40000, upkeep: 400, requires: 'rs_ot',
    color: '#c9a227', top: '#e8cb6a', height: 8, glyph: '✏',
    stationFor: ['fine'], desc: '串珠、夾取與寫字的精細動作訓練桌。',
  },
  speech_room: {
    id: 'speech_room', name: '語言治療室', cat: 'facility', sub: '職能與早療', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 180000, upkeep: 1800, requires: 'rs_st',
    color: '#8e5ea8', top: '#c09ad8', height: 40, glyph: '💬',
    stationFor: ['speech'], desc: '語言與吞嚥治療室，安靜的小空間。',
  },

  // ───── 特殊 ─────
  shockwave: {
    id: 'shockwave', name: '震波儀', cat: 'special', sub: '特殊', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 280000, upkeep: 2800, requires: 'rs_shockwave',
    color: '#37474f', top: '#607d8b', height: 22, glyph: '🌊',
    stationFor: ['shockwave'], desc: '體外震波儀本體，需搭配治療室或獨立放置。',
  },
  coffee: {
    id: 'coffee', name: '咖啡機', cat: 'special', sub: '特殊', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 30000, upkeep: 300, requires: null,
    color: '#4e342e', top: '#8d6e63', height: 18, glyph: '☕',
    comfort: 3, desc: '現煮咖啡，提升候診與自費客群的滿意度。',
  },
  ball_pit: {
    id: 'ball_pit', name: '感統球池', cat: 'special', sub: '特殊', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 90000, upkeep: 900, requires: 'rs_ot',
    color: '#00acc1', top: '#80deea', height: 8, glyph: '🔵',
    comfort: 2, desc: '彩色球池，小朋友最愛，早療放電樂園的必備。',
  },
  soft_mat: {
    id: 'soft_mat', name: '防撞軟墊', cat: 'special', sub: '特殊', layer: 'object',
    w: 2, h: 1, blocks: false, cost: 12000, upkeep: 120, requires: 'rs_ot',
    color: '#ef9a9a', top: '#ffcdd2', height: 3, glyph: '🟪',
    desc: '地面軟墊，可走可躺，降低幼兒跌撞風險。',
  },
  bookshelf: {
    id: 'bookshelf', name: '兒童繪本架', cat: 'special', sub: '特殊', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 8000, upkeep: 80, requires: 'rs_ot',
    color: '#a1887f', top: '#d7ccc8', height: 22, glyph: '📚',
    comfort: 2, desc: '擺滿繪本的書架，候診小朋友有事做。',
  },
};

// Sidebar category tree. sub strings must match each Def.sub exactly.
export const BUILD_CATEGORIES = [
  { id: 'env', name: '環境', subs: ['地板與通道', '候診與景觀'] },
  { id: 'facility', name: '設施', subs: ['基礎門診', '物理治療區', '運動與自費', '職能與早療'] },
  { id: 'special', name: '特殊', subs: ['特殊'] },
];
