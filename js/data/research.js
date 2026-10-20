// Research tree. A node's cost is paid from its track's point type (state.points[track.pointKey]).
// Effect types (applied by sim/research.js + sim/modifiers.js):
//   unlockBuild / unlockTreatment: { ids: [...] }
//   mod:      { key, op: 'add' | 'mul', value }  key is a defaultMods() key, or 'typeSpawn.<patientId>'
//             'add' = additive delta on the base value (multipliers have base 1, so +0.1 -> 1.1)
//             'mul' = multiply the current value (used for typeSpawn.*, whose base is 1 when absent)
//   maxStaff: { n }  extra staff slots on top of the lot's maxStaff
//   rep:      { value }  one-off reputation gain when the node completes

// Balance note: nodes with base cost >= 90 were scaled x1.5 (cheap 30-60 starter nodes unchanged) so that, together with
// patients.TUNE.POINT_SCALE, the first node is affordable after ~1 game month and the whole tree takes ~2-3 game years.
export const RESEARCH_TRACKS = [
  { id: 'medical', name: '醫術', pointKey: 'medical', desc: '看病的真本事：評估、徒手、職能與語言治療。' },
  { id: 'device', name: '儀器', pointKey: 'device', desc: '機器與器材：熱敷、震波、雷射、懸吊與鞋墊。' },
  { id: 'service', name: '服務', pointKey: 'service', desc: '掛號、衛教、行政與口碑，讓病人少等一點、多信一點。' },
];

const NODES = [
  // ---------- 醫術 medical ----------
  {
    id: 'rs_ultrasound', name: '超音波入門', track: 'medical', cost: 30, weeks: 1, requires: [],
    desc: '買一台超音波，順便學會看懂肌腱長什麼樣子。',
    effects: [
      { type: 'unlockBuild', ids: ['us_room'] },
      { type: 'unlockTreatment', ids: ['us'] },
    ],
  },
  {
    id: 'rs_evidence', name: '實證醫學讀書會', track: 'medical', cost: 40, weeks: 1, requires: [],
    desc: '每週讀一篇論文，論文看不懂就先看圖。病人聽了會覺得你很專業。',
    effects: [
      { type: 'rep', value: 3 },
      { type: 'mod', key: 'elderSat', op: 'add', value: 2 },
    ],
  },
  {
    id: 'rs_prp', name: 'PRP 增生療法', track: 'medical', cost: 180, weeks: 3, requires: ['rs_ultrasound'],
    desc: '抽自己的血打回去，聽起來很玄，但自費病人很買單。',
    effects: [{ type: 'unlockTreatment', ids: ['prp'] }],
  },
  {
    id: 'rs_manual', name: '徒手治療進階', track: 'medical', cost: 135, weeks: 2, requires: ['rs_evidence'],
    desc: '手法再細一點，捏、推、拉都有章法。治療師的手腕會感謝你。',
    effects: [
      { type: 'unlockBuild', ids: ['manual_room'] },
      { type: 'unlockTreatment', ids: ['manual_self'] },
    ],
  },
  {
    id: 'rs_ot', name: '職能治療入門', track: 'medical', cost: 135, weeks: 2, requires: ['rs_evidence'],
    desc: '球池、平衡木、繪本架一次到位，小朋友玩到不想回家。',
    effects: [
      { type: 'unlockBuild', ids: ['si_room', 'fine_table', 'ball_pit', 'soft_mat', 'bookshelf'] },
      { type: 'unlockTreatment', ids: ['si', 'fine'] },
    ],
  },
  {
    id: 'rs_geriatric', name: '長者肌少照護', track: 'medical', cost: 165, weeks: 2, requires: ['rs_evidence'],
    desc: '阿公阿嬤的肌肉會流失，但「多動動」真的有用。長輩口碑直線上升。',
    effects: [
      { type: 'mod', key: 'elderSat', op: 'add', value: 4 },
      { type: 'mod', key: 'typeSpawn.elder', op: 'mul', value: 1.15 },
    ],
  },
  {
    id: 'rs_st', name: '語言治療入門', track: 'medical', cost: 180, weeks: 2, requires: ['rs_ot'],
    desc: '中風後的失語、小孩的構音，都要靠它。言語治療師終於有地方坐了。',
    effects: [
      { type: 'unlockBuild', ids: ['speech_room'] },
      { type: 'unlockTreatment', ids: ['speech'] },
    ],
  },
  {
    id: 'rs_pediatric', name: '兒童發展評估', track: 'medical', cost: 270, weeks: 3, requires: ['rs_ot'],
    desc: '「我家小孩到底是慢還是不一樣？」先評估，家長比較安心。',
    effects: [
      { type: 'mod', key: 'typeSpawn.kid', op: 'mul', value: 1.2 },
      { type: 'rep', value: 5 },
    ],
  },
  {
    id: 'rs_sports_med', name: '運動傷害評估', track: 'medical', cost: 330, weeks: 3, requires: ['rs_manual', 'rs_ultrasound'],
    desc: '半月板、跟腱、肩旋轉袖，週末運動員的傷你都看得出來。',
    effects: [
      { type: 'mod', key: 'typeSpawn.sports', op: 'mul', value: 1.2 },
      { type: 'rep', value: 6 },
    ],
  },
  {
    id: 'rs_chronic', name: '慢性疼痛多模式照護', track: 'medical', cost: 600, weeks: 4, requires: ['rs_prp', 'rs_geriatric'],
    desc: '藥、運動、心理、徒手一起來。病人說你「會聽人講話」，這句話最值錢。',
    effects: [
      { type: 'mod', key: 'patience', op: 'add', value: 0.1 },
      { type: 'rep', value: 10 },
    ],
  },

  // ---------- 儀器 device ----------
  {
    id: 'rs_heat', name: '熱敷效率研究', track: 'device', cost: 35, weeks: 1, requires: [],
    desc: '熱敷包怎麼排、溫度怎麼設，研究完發現一次可以多排一個人。',
    effects: [{ type: 'mod', key: 'nhiTurnover', op: 'add', value: 0.05 }],
  },
  {
    id: 'rs_maint', name: '儀器保養手冊', track: 'device', cost: 40, weeks: 1, requires: [],
    desc: '機器定期保養，搬運器材不再傷腰。同事說：終於不用跟機器打架了。',
    effects: [{ type: 'mod', key: 'staffStamina', op: 'add', value: -0.05 }],
  },
  {
    id: 'rs_shockwave', name: '體外震波技術', track: 'device', cost: 195, weeks: 2, requires: ['rs_heat'],
    desc: '咚咚咚的震波打在足底筋膜上，痛到病人叫媽媽，然後說「好像有差」。',
    effects: [
      { type: 'unlockBuild', ids: ['shockwave', 'shockwave_room'] },
      { type: 'unlockTreatment', ids: ['shockwave'] },
    ],
  },
  {
    id: 'rs_redcord', name: '懸吊運動系統', track: 'device', cost: 270, weeks: 3, requires: ['rs_maint'],
    desc: '吊著做運動，聽起來像在玩遊樂園，其實是很正經的核心訓練。',
    effects: [
      { type: 'unlockBuild', ids: ['redcord'] },
      { type: 'unlockTreatment', ids: ['redcord'] },
    ],
  },
  {
    id: 'rs_insole', name: '足弓評估與客製鞋墊', track: 'device', cost: 240, weeks: 2, requires: ['rs_maint'],
    desc: '掃描腳型、訂做鞋墊。扁平足的朋友說：原來我的膝蓋痛是腳的問題。',
    effects: [{ type: 'unlockTreatment', ids: ['insole'] }],
  },
  {
    id: 'rs_laser', name: '高能量雷射', track: 'device', cost: 390, weeks: 3, requires: ['rs_shockwave'],
    desc: '雷射室一開，眼鏡要戴好。深層組織加熱，自費病人很愛這一味。',
    effects: [
      { type: 'unlockBuild', ids: ['laser_room'] },
      { type: 'unlockTreatment', ids: ['laser'] },
    ],
  },
  {
    id: 'rs_gait', name: '步態分析系統', track: 'device', cost: 480, weeks: 4, requires: ['rs_insole', 'rs_laser'],
    desc: '走路的時候重心歪哪裡一目瞭然。跌倒風險降低，走路也好看了。',
    effects: [
      { type: 'mod', key: 'slipRisk', op: 'add', value: -0.2 },
      { type: 'mod', key: 'walkSpeed', op: 'add', value: 0.05 },
    ],
  },

  // ---------- 服務 service ----------
  {
    id: 'rs_queue', name: '掛號系統數位化', track: 'service', cost: 35, weeks: 1, requires: [],
    desc: '線上掛號、叫號螢幕。候診的人終於不用一直問「還要等多久」。',
    effects: [{ type: 'mod', key: 'patience', op: 'add', value: 0.1 }],
  },
  {
    id: 'rs_admin', name: '行政流程改善', track: 'service', cost: 40, weeks: 1, requires: [],
    desc: '健保卡、病歷、藥單，動線重新排過，櫃檯阿姨的笑容回來了。',
    effects: [{ type: 'mod', key: 'walkSpeed', op: 'add', value: 0.05 }],
  },
  {
    id: 'rs_edu', name: '衛教話術訓練', track: 'service', cost: 50, weeks: 1, requires: [],
    desc: '「這個療程能幫你什麼」要講得清楚，病人才聽得懂、願意自費。',
    effects: [{ type: 'mod', key: 'selfPayConv', op: 'add', value: 0.05 }],
  },
  {
    id: 'rs_rep', name: '社區口碑經營', track: 'service', cost: 60, weeks: 2, requires: ['rs_edu'],
    desc: '里長、廟口、菜市場阿姨都知道你們家了。口耳相傳比廣告有用。',
    effects: [{ type: 'rep', value: 15 }],
  },
  {
    id: 'rs_insurance', name: '健保申報優化', track: 'service', cost: 225, weeks: 2, requires: ['rs_admin'],
    desc: '申報流程順了，翻桌率跟著上來。健保署的人不一定喜歡，但病人會喜歡。',
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
    id: 'rs_selfpay', name: '自費方案包裝', track: 'service', cost: 210, weeks: 2, requires: ['rs_edu', 'rs_queue'],
    desc: '套裝療程、回診優惠卡，把單次自費變成「我下個月還要來」。',
    effects: [{ type: 'mod', key: 'selfPayConv', op: 'add', value: 0.08 }],
  },
  {
    id: 'rs_expand', name: '擴建規劃', track: 'service', cost: 375, weeks: 3, requires: ['rs_staffing', 'rs_rep'],
    desc: '先把藍圖畫好，等銀行經理點頭。擴建資格的前置作業，順便多一個治療師位子。',
    effects: [
      { type: 'rep', value: 8 },
      { type: 'maxStaff', n: 1 },
    ],
  },
  {
    id: 'rs_brand', name: '院長品牌經營', track: 'service', cost: 750, weeks: 5, requires: ['rs_expand', 'rs_selfpay'],
    desc: '出書、上節目、臉書粉專每天一則貼文。院長的名字終於比藥名還好記。',
    effects: [
      { type: 'rep', value: 30 },
      { type: 'mod', key: 'spawnMult', op: 'add', value: 0.05 },
    ],
  },
];

export const RESEARCH = Object.fromEntries(NODES.map((n) => [n.id, n]));
