// Buildable catalogue (restaurant). Keys = def ids used across sim/render/ui. See docs/RESTAURANT_DESIGN.md §5.
// requires: research node id that unlocks the item (null = available from the start).
// color = side/front colour, top = lighter top face. height in px at zoom 1.

export const BUILDABLES = {
  // ───── 環境：地板與通道（layer floor → state.map.floor, 1×1）─────
  floor_tile: {
    id: 'floor_tile', name: '防滑磁磚', cat: 'env', sub: '地板與通道', layer: 'floor',
    w: 1, h: 1, blocks: false, cost: 250, upkeep: 0, requires: null,
    color: '#2f7f73', top: '#5fb3a3', height: 2, glyph: '▩',
    grip: 0.95, desc: '粗面防滑磁磚，油煙與濕滑天氣下最安心，長輩客人尤其需要。',
  },
  floor_wood: {
    id: 'floor_wood', name: '木紋地板', cat: 'env', sub: '地板與通道', layer: 'floor',
    w: 1, h: 1, blocks: false, cost: 350, upkeep: 0, requires: null,
    color: '#8b5a2b', top: '#c08a52', height: 2, glyph: '▤',
    grip: 0.6, desc: '溫潤木紋，氣氛好，但油漬與雨天容易滑。',
  },
  ramp: {
    id: 'ramp', name: '無障礙坡道', cat: 'env', sub: '地板與通道', layer: 'floor',
    w: 1, h: 1, blocks: false, cost: 500, upkeep: 0, requires: null,
    color: '#9aa3ad', top: '#c9d0d8', height: 3, glyph: '♿',
    grip: 0.8, walkMult: 1.25, desc: '輪椅、嬰兒車與助行器可通行，衛生局稽查必備。',
  },

  // ───── 環境：候位與景觀 ─────
  bench: {
    id: 'bench', name: '候位長椅', cat: 'env', sub: '候位與景觀', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 8000, upkeep: 80, requires: null,
    color: '#c2475a', top: '#e0768a', height: 6, glyph: '🪑',
    seats: 2, comfort: 3, desc: '提供 2 個候位座位，客人排隊等位時能坐著等。',
  },
  water: {
    id: 'water', name: '冰水機', cat: 'env', sub: '候位與景觀', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 5000, upkeep: 50, requires: null,
    color: '#3b7fd1', top: '#7fb6ef', height: 16, glyph: '🚰',
    comfort: 2, anxietyRelief: 1, desc: '免費冰水與熱茶，減少客人等位時的焦躁。',
  },
  tv: {
    id: 'tv', name: '電視牆', cat: 'env', sub: '候位與景觀', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 25000, upkeep: 250, requires: null,
    color: '#2b2f3a', top: '#4a5063', height: 18, glyph: '📺',
    comfort: 3, anxietyRelief: 3, desc: '播放棒球與綜藝節目，等位與用餐時間都過得快。',
  },
  plant: {
    id: 'plant', name: '綠植', cat: 'env', sub: '候位與景觀', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 2000, upkeep: 20, requires: null,
    color: '#2e7d32', top: '#66bb6a', height: 14, glyph: '🪴',
    comfort: 4, desc: '綠色植栽讓店裡看起來清爽舒服。',
  },
  sign: {
    id: 'sign', name: '指示招牌', cat: 'env', sub: '候位與景觀', layer: 'object',
    w: 1, h: 1, blocks: false, cost: 1000, upkeep: 8, requires: null,
    color: '#f2b705', top: '#ffd966', height: 4, glyph: '🪧',
    anxietyRelief: 2, desc: '清楚的點餐、取餐與洗手間指引，減少客人迷路與焦慮。',
  },

  // ───── 設施：櫃檯與餐桌 ─────
  reception: {
    id: 'reception', name: '點餐結帳櫃檯', cat: 'facility', sub: '櫃檯與餐桌', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 30000, upkeep: 300, requires: null,
    color: '#d9c7a5', top: '#f3e6cc', height: 12, glyph: '🧾',
    desc: '點餐、叫號與結帳櫃檯，所有客人都從這裡開始。',
  },
  table2: {
    id: 'table2', name: '雙人桌', cat: 'facility', sub: '櫃檯與餐桌', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 6000, upkeep: 60, requires: null,
    color: '#a8743f', top: '#d9a566', height: 12, glyph: '🍽',
    stationFor: ['dine'], desc: '兩個人剛好的小圓桌，翻桌快。',
  },
  table4: {
    id: 'table4', name: '四人桌', cat: 'facility', sub: '櫃檯與餐桌', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 12000, upkeep: 120, requires: null,
    color: '#8c5a2b', top: '#c28a50', height: 12, glyph: '🍽',
    stationFor: ['dine'], desc: '家庭與朋友聚餐的標準桌，能容納一整組客人。',
  },
  rest_room: {
    id: 'rest_room', name: '員工休息室', cat: 'facility', sub: '櫃檯與餐桌', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 60000, upkeep: 600, requires: null,
    color: '#d9a7c7', top: '#f0cfe3', height: 40, glyph: '🛌',
    restRecovery: 0.8, desc: '員工喘口氣、吃員工餐的地方，體力回復更快。',
  },

  // ───── 設施：熱廚 ─────
  chef_range: {
    id: 'chef_range', name: '主廚爐台', cat: 'facility', sub: '熱廚', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 120000, upkeep: 1200, requires: null,
    color: '#b8bcc4', top: '#e6e9ee', height: 22, glyph: '🍳',
    stationFor: ['main'], desc: '主廚現做招牌主餐的爐台，餐廳的靈魂。',
  },
  noodle_stove: {
    id: 'noodle_stove', name: '煮麵台', cat: 'facility', sub: '熱廚', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 40000, upkeep: 400, requires: null,
    color: '#c9a227', top: '#f0d36a', height: 20, glyph: '🍜',
    stationFor: ['noodle'], desc: '燙麵、淋湯頭的煮麵台，湯麵出餐快。',
  },
  braise_pot: {
    id: 'braise_pot', name: '滷肉鍋', cat: 'facility', sub: '熱廚', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 25000, upkeep: 250, requires: null,
    color: '#6d3b1f', top: '#a86a3c', height: 18, glyph: '🍚',
    stationFor: ['rice'], desc: '咕嘟咕嘟燉一整天的滷肉鍋，開著就能一碗一碗盛。',
  },
  griddle: {
    id: 'griddle', name: '煎檯', cat: 'facility', sub: '熱廚', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 35000, upkeep: 350, requires: null,
    color: '#8d99a6', top: '#c4ccd4', height: 14, glyph: '🥟',
    stationFor: ['dumpling'], desc: '煎餃、鍋貼與蔥油餅，鍋蓋一蓋就不用顧。',
  },
  fryer: {
    id: 'fryer', name: '油炸鍋', cat: 'facility', sub: '熱廚', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 30000, upkeep: 300, requires: null,
    color: '#d2452f', top: '#f0826a', height: 16, glyph: '🍗',
    stationFor: ['fried'], desc: '鹽酥雞、薯條與炸物，必須有人顧著火候。',
  },
  teppan: {
    id: 'teppan', name: '鐵板檯', cat: 'facility', sub: '熱廚', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 90000, upkeep: 900, requires: 'rs_teppan',
    color: '#3d4750', top: '#6b7782', height: 16, glyph: '🥩',
    stationFor: ['teppan'], desc: '滋滋作響的鐵板燒，客人愛看師傅翻鏟。',
  },

  // ───── 設施：吧台冷食 ─────
  cold_case: {
    id: 'cold_case', name: '冷盤檯', cat: 'facility', sub: '吧台冷食', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 25000, upkeep: 250, requires: null,
    color: '#7fb6c9', top: '#bfe0ea', height: 16, glyph: '🥗',
    stationFor: ['side'], desc: '冰涼的小菜與涼拌櫃，夾了就走，翻桌快。',
  },
  soup_pot: {
    id: 'soup_pot', name: '例湯鍋', cat: 'facility', sub: '吧台冷食', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 15000, upkeep: 150, requires: null,
    color: '#c77d12', top: '#f4b04a', height: 18, glyph: '🍲',
    stationFor: ['soup'], desc: '香濃的例湯，餐點附贈或單點都行。',
  },
  drink_bar: {
    id: 'drink_bar', name: '飲料吧', cat: 'facility', sub: '吧台冷食', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 45000, upkeep: 450, requires: null,
    color: '#3fa6b8', top: '#8fd6e3', height: 22, glyph: '🧋',
    stationFor: ['drink'], desc: '手搖飲與紅茶，搖一搖機器自己封杯。',
  },
  ice_shop: {
    id: 'ice_shop', name: '冰品檯', cat: 'facility', sub: '吧台冷食', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 60000, upkeep: 600, requires: 'rs_ice',
    color: '#9fd3e6', top: '#d4f0f8', height: 18, glyph: '🍧',
    stationFor: ['ice'], desc: '剉冰、豆花與愛玉，夏天排隊必備。',
  },

  // ───── 設施：特色料理 ─────
  chef_table: {
    id: 'chef_table', name: '主廚餐檯', cat: 'facility', sub: '特色料理', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 350000, upkeep: 3500, requires: 'rs_steak',
    color: '#5a3a2a', top: '#8c6347', height: 24, glyph: '🥩',
    stationFor: ['steak'], desc: '主廚現做厚切牛排的獨立餐檯，單價高、客人愛拍照。',
  },
  wok_range: {
    id: 'wok_range', name: '熱炒爐', cat: 'facility', sub: '特色料理', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 250000, upkeep: 2500, requires: 'rs_wok',
    color: '#9b2d20', top: '#d4604f', height: 24, glyph: '🦐',
    stationFor: ['seafood'], desc: '大火快炒的活海鮮熱炒，鍋氣十足。',
  },
  hotpot_table: {
    id: 'hotpot_table', name: '火鍋桌', cat: 'facility', sub: '特色料理', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 180000, upkeep: 1800, requires: 'rs_hotpot',
    color: '#b1243a', top: '#e0566d', height: 18, glyph: '🫕',
    stationFor: ['hotpot'], desc: '桌邊爐具的精緻火鍋，客人圍著鍋聊得久。',
  },
  bbq_grill: {
    id: 'bbq_grill', name: '炭火爐', cat: 'facility', sub: '特色料理', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 120000, upkeep: 1200, requires: 'rs_bbq',
    color: '#3d3d3d', top: '#6a6a6a', height: 18, glyph: '🍢',
    stationFor: ['bbq'], desc: '炭火串燒的香氣，隔著兩條街都聞得到。',
  },
  dessert_bar: {
    id: 'dessert_bar', name: '甜點吧', cat: 'facility', sub: '特色料理', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 150000, upkeep: 1500, requires: 'rs_dessert',
    color: '#e58fb0', top: '#f7c6d9', height: 20, glyph: '🍰',
    stationFor: ['dessert'], desc: '手作蛋糕與布丁，擺進玻璃櫃就是活招牌。',
  },
  bar_counter: {
    id: 'bar_counter', name: '吧台', cat: 'facility', sub: '特色料理', layer: 'object',
    w: 3, h: 1, blocks: true, cost: 200000, upkeep: 2000, requires: 'rs_bar',
    color: '#4a3a5a', top: '#7a6a8c', height: 22, glyph: '🍺',
    stationFor: ['beer'], desc: '精釀啤酒與茶酒吧台，宵夜客與下班族的最愛。',
  },

  // ───── 特殊 ─────
  coffee: {
    id: 'coffee', name: '咖啡機', cat: 'special', sub: '特殊', layer: 'object',
    w: 1, h: 1, blocks: true, cost: 30000, upkeep: 300, requires: null,
    color: '#4e342e', top: '#8d6e63', height: 18, glyph: '☕',
    comfort: 3, desc: '現煮咖啡，提升等位與上班族客人的滿意度。',
  },
  play_area: {
    id: 'play_area', name: '兒童遊戲區', cat: 'special', sub: '特殊', layer: 'object',
    w: 2, h: 2, blocks: true, cost: 90000, upkeep: 900, requires: 'rs_kids',
    color: '#00acc1', top: '#80deea', height: 8, glyph: '🔵',
    comfort: 2, desc: '球池與溜滑梯，小朋友玩得開心，家長才能好好吃飯。',
  },
  kids_mat: {
    id: 'kids_mat', name: '兒童軟墊', cat: 'special', sub: '特殊', layer: 'object',
    w: 2, h: 1, blocks: false, cost: 12000, upkeep: 120, requires: 'rs_kids',
    color: '#ef9a9a', top: '#ffcdd2', height: 3, glyph: '🟪',
    desc: '地面軟墊，可走可坐，降低幼兒跌撞風險。',
  },
  bookshelf: {
    id: 'bookshelf', name: '兒童繪本架', cat: 'special', sub: '特殊', layer: 'object',
    w: 2, h: 1, blocks: true, cost: 8000, upkeep: 80, requires: 'rs_kids',
    color: '#a1887f', top: '#d7ccc8', height: 22, glyph: '📚',
    comfort: 2, desc: '擺滿繪本的書架，等餐的小朋友有事做。',
  },
};

// Sidebar category tree. sub strings must match each Def.sub exactly.
export const BUILD_CATEGORIES = [
  { id: 'env', name: '環境', subs: ['地板與通道', '候位與景觀'] },
  { id: 'facility', name: '設施', subs: ['櫃檯與餐桌', '熱廚', '吧台冷食', '特色料理'] },
  { id: 'special', name: '特殊', subs: ['特殊'] },
];
