// Research tree (restaurant). A node's cost is paid from its track's point type (state.points[track.pointKey]).
// Effect types (applied by sim/research.js + sim/modifiers.js):
//   unlockBuild / unlockTreatment: { ids: [...] }
//   mod:      { key, op: 'add' | 'mul', value }  key is a defaultMods() key, or 'typeSpawn.<guestId>'
//             'add' = additive delta on the base value (multipliers have base 1, so +0.1 -> 1.1)
//             'mul' = multiply the current value (used for typeSpawn.*, whose base is 1 when absent)
//   maxStaff: { n }  extra staff slots on top of the lot's maxStaff
//   rep:      { value }  one-off reputation gain when the node completes

// Balance note: nodes with base cost >= 90 were scaled x1.5 (cheap 30-60 starter nodes unchanged) so that, together with
// patients.TUNE.POINT_SCALE, the first node is affordable after ~1 game month and the whole tree takes ~2-3 game years.
export const RESEARCH_TRACKS = [
  { id: 'culinary', name: '廚藝', pointKey: 'culinary', desc: '手藝的真本事：鐵板、牛排、熱炒、甜點與火鍋湯底。' },
  { id: 'device', name: '設備', pointKey: 'device', desc: '爐具與器材：煮麵台、冰品檯、炭火爐、吧台與冷鏈。' },
  { id: 'service', name: '服務', pointKey: 'service', desc: '叫號、點餐、外場流程與口碑，讓客人少等一點、多吃一點。' },
];

const NODES = [
  // ---------- 廚藝 culinary ----------
  {
    id: 'rs_teppan', name: '鐵板燒技術', track: 'culinary', cost: 30, weeks: 1, requires: [],
    desc: '練好翻鏟與火候，鐵板上的牛小排滋滋作響，客人都伸長脖子看。',
    effects: [
      { type: 'unlockBuild', ids: ['teppan'] },
      { type: 'unlockTreatment', ids: ['teppan'] },
    ],
  },
  {
    id: 'rs_recipe', name: '招牌食譜研發', track: 'culinary', cost: 40, weeks: 1, requires: [],
    desc: '每週試做一道新菜，失敗的員工吃掉，成功的放上菜單。客人說你們家的味道很「有記憶點」。',
    effects: [
      { type: 'rep', value: 3 },
      { type: 'mod', key: 'elderSat', op: 'add', value: 2 },
    ],
  },
  {
    id: 'rs_steak', name: '熟成牛排', track: 'culinary', cost: 180, weeks: 3, requires: ['rs_teppan'],
    desc: '買一台熟成櫃，等牛肉慢慢變出風味。單價高，但值得。',
    effects: [
      { type: 'unlockBuild', ids: ['chef_table'] },
      { type: 'unlockTreatment', ids: ['steak'] },
    ],
  },
  {
    id: 'rs_wok', name: '熱炒鍋氣', track: 'culinary', cost: 135, weeks: 2, requires: ['rs_recipe'],
    desc: '大火快炒、鍋鏟翻飛，鍋氣一出來啤酒就賣得比菜快。',
    effects: [
      { type: 'unlockBuild', ids: ['wok_range'] },
      { type: 'unlockTreatment', ids: ['seafood'] },
    ],
  },
  {
    id: 'rs_dessert', name: '手作甜點', track: 'culinary', cost: 135, weeks: 2, requires: ['rs_recipe'],
    desc: '布丁、蛋糕、千層，吧台後面多一位愛烘焙的師傅，玻璃櫃變成活招牌。',
    effects: [
      { type: 'unlockBuild', ids: ['dessert_bar'] },
      { type: 'unlockTreatment', ids: ['dessert'] },
    ],
  },
  {
    id: 'rs_geriatric', name: '長者軟爛餐', track: 'culinary', cost: 165, weeks: 2, requires: ['rs_recipe'],
    desc: '阿公阿嬤牙口不好，燉得夠爛、鹽放得剛好，長輩口碑直線上升。',
    effects: [
      { type: 'mod', key: 'elderSat', op: 'add', value: 4 },
      { type: 'mod', key: 'typeSpawn.elder', op: 'mul', value: 1.15 },
    ],
  },
  {
    id: 'rs_hotpot', name: '火鍋湯底', track: 'culinary', cost: 180, weeks: 2, requires: ['rs_dessert'],
    desc: '熬三天的大骨湯、麻辣與菌菇雙拼，桌邊一鍋就是一個家庭聚會。',
    effects: [
      { type: 'unlockBuild', ids: ['hotpot_table'] },
      { type: 'unlockTreatment', ids: ['hotpot'] },
    ],
  },
  {
    id: 'rs_kids_menu', name: '兒童餐設計', track: 'culinary', cost: 270, weeks: 3, requires: ['rs_dessert'],
    desc: '小份量、不辣、擺成小熊的飯糰。家長說：終於可以安心吃一頓飯。',
    effects: [
      { type: 'mod', key: 'typeSpawn.family', op: 'mul', value: 1.2 },
      { type: 'rep', value: 5 },
    ],
  },
  {
    id: 'rs_student', name: '學生平價套餐', track: 'culinary', cost: 330, weeks: 3, requires: ['rs_wok', 'rs_dessert'],
    desc: '一百塊吃飽、加十塊升級飲料。學生在群組裡一傳十、十傳百。',
    effects: [
      { type: 'mod', key: 'typeSpawn.student', op: 'mul', value: 1.2 },
      { type: 'rep', value: 6 },
    ],
  },
  {
    id: 'rs_signature', name: '老字號傳承', track: 'culinary', cost: 600, weeks: 4, requires: ['rs_steak', 'rs_geriatric'],
    desc: '把招牌的故事寫在菜單上，客人邊吃邊聽老闆講三十年前的夜市。「會講故事的店」最值錢。',
    effects: [
      { type: 'mod', key: 'patience', op: 'add', value: 0.1 },
      { type: 'rep', value: 10 },
    ],
  },

  // ---------- 設備 device ----------
  {
    id: 'rs_stove', name: '煮麵台效率研究', track: 'device', cost: 35, weeks: 1, requires: [],
    desc: '爐火大小、撈麵籠、湯頭保溫，研究完發現一次可以多出幾碗。',
    effects: [{ type: 'mod', key: 'nhiTurnover', op: 'add', value: 0.05 }],
  },
  {
    id: 'rs_maint', name: '設備保養手冊', track: 'device', cost: 40, weeks: 1, requires: [],
    desc: '爐具、冰箱與抽油煙機定期保養，搬貨與清油垢不再傷腰。同事說：終於不用跟鍋子打架了。',
    effects: [{ type: 'mod', key: 'staffStamina', op: 'add', value: -0.05 }],
  },
  {
    id: 'rs_ice', name: '冰品設備', track: 'device', cost: 90, weeks: 1, requires: ['rs_stove'],
    desc: '刨冰機一轉，冰沙雪花飛，夏天排隊排到轉角。',
    effects: [
      { type: 'unlockBuild', ids: ['ice_shop'] },
      { type: 'unlockTreatment', ids: ['ice'] },
    ],
  },
  {
    id: 'rs_bbq', name: '炭火燒烤設備', track: 'device', cost: 195, weeks: 2, requires: ['rs_maint'],
    desc: '備長炭一點燃，煙往抽風機走，串燒的香味卻把路人拉進來。',
    effects: [
      { type: 'unlockBuild', ids: ['bbq_grill'] },
      { type: 'unlockTreatment', ids: ['bbq'] },
    ],
  },
  {
    id: 'rs_bar', name: '吧台與啤酒設備', track: 'device', cost: 270, weeks: 3, requires: ['rs_stove'],
    desc: '啤酒機、冰杯櫃與吧台燈光，宵夜時段多一個選擇。',
    effects: [
      { type: 'unlockBuild', ids: ['bar_counter'] },
      { type: 'unlockTreatment', ids: ['beer'] },
    ],
  },
  {
    id: 'rs_kids', name: '兒童友善設施', track: 'device', cost: 135, weeks: 2, requires: ['rs_maint'],
    desc: '球池、軟墊與繪本架一次到位，小朋友玩到不想回家，家長總算能好好吃飯。',
    effects: [{ type: 'unlockBuild', ids: ['play_area', 'kids_mat', 'bookshelf'] }],
  },
  {
    id: 'rs_fridge', name: '冷鏈與食材管理', track: 'device', cost: 240, weeks: 2, requires: ['rs_maint'],
    desc: '冷藏溫度紀錄、先進先出標籤，食材損耗少了，食安也更有把握。',
    effects: [{ type: 'mod', key: 'foodCost', op: 'add', value: -0.06 }],
  },
  {
    id: 'rs_vent', name: '排油煙與防滑改善', track: 'device', cost: 480, weeks: 4, requires: ['rs_fridge', 'rs_bar'],
    desc: '加裝靜電機與地面排水溝，油煙少了、地也不滑了，員工走路都有風。',
    effects: [
      { type: 'mod', key: 'slipRisk', op: 'add', value: -0.2 },
      { type: 'mod', key: 'walkSpeed', op: 'add', value: 0.05 },
    ],
  },

  // ---------- 服務 service ----------
  {
    id: 'rs_queue', name: '叫號系統數位化', track: 'service', cost: 35, weeks: 1, requires: [],
    desc: '線上候位、叫號螢幕。排隊的人終於不用一直問「還要等多久」。',
    effects: [{ type: 'mod', key: 'patience', op: 'add', value: 0.1 }],
  },
  {
    id: 'rs_admin', name: '外場流程改善', track: 'service', cost: 40, weeks: 1, requires: [],
    desc: '帶位、倒水、收盤動線重新排過，服務生的笑容回來了。',
    effects: [{ type: 'mod', key: 'walkSpeed', op: 'add', value: 0.05 }],
  },
  {
    id: 'rs_edu', name: '點餐話術訓練', track: 'service', cost: 50, weeks: 1, requires: [],
    desc: '「要不要加一杯冬瓜茶？」問得自然，客人就點得開心。',
    effects: [{ type: 'mod', key: 'selfPayConv', op: 'add', value: 0.05 }],
  },
  {
    id: 'rs_rep', name: '社區口碑經營', track: 'service', cost: 60, weeks: 2, requires: ['rs_edu'],
    desc: '里長、廟口、菜市場阿姨都知道你們家了。口耳相傳比廣告有用。',
    effects: [{ type: 'rep', value: 15 }],
  },
  {
    id: 'rs_pos', name: '行動點餐與 POS', track: 'service', cost: 225, weeks: 2, requires: ['rs_admin'],
    desc: '平板點餐、行動支付與自動出單，結帳快了，翻桌率跟著上來。',
    effects: [{ type: 'mod', key: 'nhiTurnover', op: 'add', value: 0.08 }],
  },
  {
    id: 'rs_staffing', name: '人力排班制度', track: 'service', cost: 135, weeks: 2, requires: ['rs_admin'],
    desc: '排班表不再靠一張白板和三通 LINE。多一個位子，也省一點薪水。',
    effects: [
      { type: 'maxStaff', n: 1 },
      { type: 'mod', key: 'wageMult', op: 'add', value: -0.05 },
    ],
  },
  {
    id: 'rs_combo', name: '套餐與會員方案', track: 'service', cost: 210, weeks: 2, requires: ['rs_edu', 'rs_queue'],
    desc: '主餐加飲料甜點的套餐、集點卡與生日優惠，把單次加點變成「我下個月還要來」。',
    effects: [{ type: 'mod', key: 'selfPayConv', op: 'add', value: 0.08 }],
  },
  {
    id: 'rs_expand', name: '展店規劃', track: 'service', cost: 375, weeks: 3, requires: ['rs_staffing', 'rs_rep'],
    desc: '先把藍圖畫好，等銀行經理點頭。擴大店面資格的前置作業，順便多一個員工位子。',
    effects: [
      { type: 'rep', value: 8 },
      { type: 'maxStaff', n: 1 },
    ],
  },
  {
    id: 'rs_brand', name: '老闆品牌經營', track: 'service', cost: 750, weeks: 5, requires: ['rs_expand', 'rs_combo'],
    desc: '上節目、出食譜書、粉專每天一則貼文。老闆的名字終於比菜名還好記。',
    effects: [
      { type: 'rep', value: 30 },
      { type: 'mod', key: 'spawnMult', op: 'add', value: 0.05 },
    ],
  },
];

export const RESEARCH = Object.fromEntries(NODES.map((n) => [n.id, n]));
