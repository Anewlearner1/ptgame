// 老闆生涯目標與結局資料（docs/GOALS_AND_ENDING.md §2–§6；餐廳版對照見 docs/RESTAURANT_DESIGN.md）。All 繁體中文（台灣口吻）。
//
// 條件格式：{ key, target, cmp }，cmp = 'gte'（≥）或 'lte'（≤）。key 必須出現在 GOAL_METRICS。
// - 布林指標以 0/1 表示：target 填 1、cmp 'gte' 即「成立」。
// - 可選 targetByLot: [L0, L1, L2, L3]：依店面等級取目標值（存在時優先於 target）。
// - 可選 altConds：與 conds 擇一即可（任一組全部成立即達成）。目前只有第 10 年使用。
// - 核心目標第 6–9 年提供 variants（兩組）：依店面等級 lots 挑一組；conds 為預設（L0–L1 版）。
// - 加分目標 cond：{ minYear?, maxYear?, minLot?, maxLot?, needResearch?: id, needObjects?: [buildable id], notIfDone?: bool }
//   notIfDone = 只能在生涯中完成一次（已完成過就不再出現）。
//
// 金額與點數：核心目標 money 為基準（NT$ 60,000），由 sim 依店面倍數 ×1 / ×2 / ×4 / ×8 放大（rewardScale）。
// 加分目標 money 基準 NT$ 20,000（同樣放大）。新手任務金額不放大。

// ---------------------------------------------------------------------------
// 基本常數
// ---------------------------------------------------------------------------

export const CAREER_YEARS = 10;

// ---------------------------------------------------------------------------
// 指標說明（sim 端需實作的 key 一覽）
// ---------------------------------------------------------------------------

export const GOAL_METRICS = {
  // ---- 新手任務（第 1 年前幾個月）----
  treatmentsDone: { label: '完成上菜份數', unit: '份', higherIsBetter: true, desc: '累計完成的餐點份數（treatment:done）。' },
  seatingSet: { label: '候位座位齊備', unit: '0/1', higherIsBetter: true, desc: '場上至少 1 張候位長椅，且有冰水機或綠植（1 = 成立）。' },
  antislipTiles: { label: '防滑磁磚格數', unit: '格', higherIsBetter: true, desc: '場上防滑磁磚的格數。' },
  zoneActive_golden3: { label: '黃金爐火區啟動', unit: '0/1', higherIsBetter: true, desc: '「黃金爐火區」專區已啟動（1 = 成立）。' },
  monthsSettled: { label: '月結算次數', unit: '次', higherIsBetter: true, desc: '累計完成的月底結算（month:settled）。' },
  researchStartedOrDone: { label: '研發開始或完成數', unit: '項', higherIsBetter: true, desc: '進行中或已完成的研發節點數量。' },
  cookCount: { label: '廚師人數', unit: '人', higherIsBetter: true, desc: '目前聘用的廚師人數。' },
  priceChanged: { label: '特色料理價格已調整', unit: '0/1', higherIsBetter: true, desc: '任一項特色料理價格倍率 ≠ 1（1 = 成立）。' },
  communityStarted: { label: '社區活動累計次數', unit: '次', higherIsBetter: true, desc: '累計舉辦的社區活動次數（community:started）。' },
  expandTabOpened: { label: '已看過擴建分頁', unit: '0/1', higherIsBetter: true, desc: '曾開啟餐廳面板的「擴建」分頁（1 = 成立）。' },

  // ---- 財務與店面 ----
  reputation: { label: '聲譽', unit: '點', higherIsBetter: true, desc: '目前聲譽（0–1000）。' },
  money: { label: '資金', unit: 'NT$', higherIsBetter: true, desc: '目前資金（NT$）。' },
  moneyGrowthPct: { label: '資金成長', unit: '%', higherIsBetter: true, desc: '目前資金相對本年年初的增減百分比。' },
  lotLevel: { label: '店面等級', unit: '級', higherIsBetter: true, desc: '0 = 巷弄小吃店、1 = 社區餐館、2 = 地區人氣餐廳、3 = 全台旗艦餐廳。' },
  netMonthlyAvgYear: { label: '本年月淨利均值', unit: 'NT$/月', higherIsBetter: true, desc: '本年各月淨利的平均值（NT$）。' },
  netPositiveMonthsYear: { label: '本年淨利為正月數', unit: '月', higherIsBetter: true, desc: '本年淨利為正的月數（0–12）。' },
  selfPayShare3: { label: '特色料理占比（近 3 個月）', unit: '比例 0–1', higherIsBetter: true, desc: '近 3 個月特色料理收入占餐點總收入的比例（0–1）。' },
  marginGoodMonthsYear: { label: '毛利達標月數', unit: '月', higherIsBetter: true, desc: '本年月毛利（扣掉食材成本後）占營收 ≥ 62% 的月數。' },

  // ---- 客人與服務 ----
  patientsYear: { label: '本年來客數', unit: '人次', higherIsBetter: true, desc: '本年服務的客人人次。' },
  curedYear: { label: '本年新增熟客數', unit: '人', higherIsBetter: true, desc: '本年變成熟客的客人人數。' },
  avgSat6: { label: '近 6 個月平均滿意度', unit: '分（0–100）', higherIsBetter: true, desc: '近 6 個月客人滿意度的平均（0–100）。' },
  avgSatYear: { label: '本年平均滿意度', unit: '分（0–100）', higherIsBetter: true, desc: '本年客人滿意度的平均（0–100）。' },
  slipYear: { label: '本年滑倒人次', unit: '人', higherIsBetter: false, desc: '本年發生的滑倒人次（越少越好）。' },
  reviewScore: { label: '網路評價', unit: '星（1–5）', higherIsBetter: true, desc: '網路平均評價（1–5 星）。' },

  // ---- 團隊 ----
  resignYear: { label: '本年離職人數', unit: '人', higherIsBetter: false, desc: '本年員工離職人數（越少越好）。' },
  moraleAvg: { label: '員工平均士氣', unit: '分（0–100）', higherIsBetter: true, desc: '全體員工目前的平均士氣（0–100）。' },
  trainYear: { label: '本年受訓人次', unit: '人次', higherIsBetter: true, desc: '本年安排員工受訓的人次。' },

  // ---- 設備 ----
  breakdownYear: { label: '本年設備故障次數', unit: '次', higherIsBetter: false, desc: '本年設備故障次數（越少越好）。' },
  wearAvg: { label: '設備平均耗損', unit: '分（0–100）', higherIsBetter: false, desc: '全部設備的平均耗損（越低越好）。' },
  maintenanceActive: { label: '保養合約生效', unit: '0/1', higherIsBetter: true, desc: '已簽立且生效中的設備保養合約（1 = 成立）。' },

  // ---- 在地與稽查 ----
  communityYear: { label: '本年社區活動次數', unit: '次', higherIsBetter: true, desc: '本年舉辦的社區活動次數。' },
  inspectionPassedYear: { label: '本年通過稽查', unit: '0/1', higherIsBetter: true, desc: '本年年度衛生局稽查是否通過（1 = 通過）。' },
  dilemmasYear: { label: '本年客人溝通處理次數', unit: '次', higherIsBetter: true, desc: '本年處理的客人溝通情境次數。' },
  riskNow: { label: '目前食安風險', unit: '分（0–100）', higherIsBetter: false, desc: '店裡目前的食安風險值（越低越安全）。' },

  // ---- 研發 ----
  researchDone: { label: '累計完成研發', unit: '項', higherIsBetter: true, desc: '生涯中累計完成的研發節點數。' },
  researchYear: { label: '本年完成研發', unit: '項', higherIsBetter: true, desc: '本年完成的研發節點數。' },
  upgradeLevels: { label: '累計持續精進等級', unit: '級', higherIsBetter: true, desc: '六條「持續精進」路線的等級總和。' },
  upgradeYear: { label: '本年投入持續精進', unit: '級', higherIsBetter: true, desc: '本年新增的「持續精進」等級數。' },
};

// ---------------------------------------------------------------------------
// 新手任務（第 1 年，§2）
// ---------------------------------------------------------------------------

export const ONBOARDING = [
  {
    id: 'ob_first_treat',
    name: '讓第一位客人吃完餐點',
    desc: '點餐、出餐、入座整個流程跑通，才知道店真的會動起來。',
    hint: '在餐廳先放點餐櫃檯、爐台與餐桌，等第一位客人吃完。',
    reward: { money: 10000 },
    metric: { key: 'treatmentsDone', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_seating',
    name: '擺一組候位座位',
    desc: '等位的地方舒服，長輩就不會一直抱怨腰痠腿痛。',
    hint: '在建造面板放一張候位長椅，再加一台冰水機或一盆綠植。',
    reward: { points: { service: 5 } },
    metric: { key: 'seatingSet', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_antislip',
    name: '鋪防滑磁磚',
    desc: '地板油滑濕滑是餐廳最常見的意外，先鋪好磁磚保護大家。',
    hint: '在建造面板選防滑磁磚，至少鋪滿 6 格。',
    reward: { money: 15000 },
    metric: { key: 'antislipTiles', target: 6, cmp: 'gte' },
  },
  {
    id: 'ob_golden3',
    name: '湊成「黃金爐火區」',
    desc: '專區搭配到位會有額外加成，是餐廳賺錢的第一個小秘訣。',
    hint: '把煮麵台、滷肉鍋與油炸鍋緊貼擺放，讓專區啟動。',
    reward: { points: { device: 8 } },
    metric: { key: 'zoneActive_golden3', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_first_settle',
    name: '完成第一次月結算',
    desc: '營收、食材成本與毛利是店的命脈，第一次結算要親眼看一下。',
    hint: '等月底到來，在月結算視窗看看收入與食材成本。',
    reward: { money: 20000 },
    metric: { key: 'monthsSettled', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_research',
    name: '開始一項研發',
    desc: '研發點數會慢慢變成新菜色，越早起步越划算。',
    hint: '打開研發面板，挑一個便宜的節點開始研究。',
    reward: { points: { culinary: 5 } },
    metric: { key: 'researchStartedOrDone', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_second_cook',
    name: '僱用第二位廚師',
    desc: '人手一多，出餐速度就上去了，客人等得也比較少。',
    hint: '到人員面板的招募頁，再聘一位廚師。',
    reward: { money: 25000 },
    metric: { key: 'cookCount', target: 2, cmp: 'gte' },
  },
  {
    id: 'ob_price',
    name: '調整一項特色料理價格',
    desc: '特色料理的價格是賺錢的關鍵，要跟品質對得上。',
    hint: '到營運面板的價格區，調整任一項特色料理的價格。',
    reward: { points: { service: 6 } },
    metric: { key: 'priceChanged', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_community',
    name: '辦一次社區活動',
    desc: '街坊認得你，客人才會帶朋友來，口碑就是這樣來的。',
    hint: '到營運面板的社區活動區，選一個活動開辦。',
    reward: { money: 12000 },
    metric: { key: 'communityStarted', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_expand_tab',
    name: '查看年度稽查條件',
    desc: '先知道衛生局會看什麼，擴建與稽查才不會措手不及。',
    hint: '打開餐廳面板，切到「擴建」分頁看一看。',
    reward: { points: { service: 5 } },
    metric: { key: 'expandTabOpened', target: 1, cmp: 'gte' },
  },
];

// ---------------------------------------------------------------------------
// 主要目標（§3.2 路線）：每年 1 個，共 10 年
// ---------------------------------------------------------------------------

export const CORE_GOALS = [
  {
    year: 1,
    id: 'core_y1_stand',
    name: '站穩腳步',
    desc: '年底聲譽達 60，資金不低於開局資金（約 NT$ 110 萬）。',
    conds: [
      { key: 'reputation', target: 60, cmp: 'gte' },
      { key: 'money', target: 1100000, cmp: 'gte' },
    ],
    reward: { money: 60000, reputation: 3, points: { service: 10 } },
    rewardScale: true,
  },
  {
    year: 2,
    id: 'core_y2_expand_l1',
    name: '擴大門面',
    desc: '擴建到「社區餐館」，門口終於有像樣的招牌了。',
    conds: [
      { key: 'lotLevel', target: 1, cmp: 'gte' },
    ],
    reward: { money: 60000, reputation: 3, points: { service: 10 } },
    rewardScale: true,
  },
  {
    year: 3,
    id: 'core_y3_audit',
    name: '通過稽查',
    desc: '通過衛生局年度稽查，且全年平均滿意度達 68。',
    conds: [
      { key: 'inspectionPassedYear', target: 1, cmp: 'gte' },
      { key: 'avgSatYear', target: 68, cmp: 'gte' },
    ],
    reward: { money: 60000, reputation: 3, points: { service: 10 } },
    rewardScale: true,
  },
  {
    year: 4,
    id: 'core_y4_selfpay',
    name: '特色轉型',
    desc: '特色料理收入占比連續 3 個月達 25%，不再只靠平價主餐吃飯。',
    conds: [
      { key: 'selfPayShare3', target: 0.25, cmp: 'gte' },
    ],
    reward: { money: 60000, reputation: 3, points: { service: 10 } },
    rewardScale: true,
  },
  {
    year: 5,
    id: 'core_y5_expand_l2',
    name: '地區名店',
    desc: '擴建到「地區人氣餐廳」，成為鄰近幾個里都認得的人氣名店。',
    conds: [
      { key: 'lotLevel', target: 2, cmp: 'gte' },
    ],
    reward: { money: 60000, reputation: 3, points: { service: 10 } },
    rewardScale: true,
  },
  {
    year: 6,
    id: 'core_y6_steady_profit',
    name: '穩定獲利',
    desc: '全年月淨利均值達本店基準（巷弄與社區為 15 萬／40 萬，地區與旗艦為 90 萬／180 萬），聲譽達 480。',
    conds: [
      { key: 'netMonthlyAvgYear', target: 150000, targetByLot: [150000, 400000, 900000, 1800000], cmp: 'gte' },
      { key: 'reputation', target: 480, cmp: 'gte' },
    ],
    variants: [
      {
        lots: [0, 1],
        name: '穩定獲利（小店版）',
        desc: '月淨利均值達本店基準（巷弄 15 萬、社區 40 萬），聲譽達 480。',
        conds: [
          { key: 'netMonthlyAvgYear', target: 150000, targetByLot: [150000, 400000, 900000, 1800000], cmp: 'gte' },
          { key: 'reputation', target: 480, cmp: 'gte' },
        ],
      },
      {
        lots: [2, 3],
        name: '穩定獲利（大店版）',
        desc: '月淨利均值達本店基準（地區 90 萬、旗艦 180 萬），聲譽達 560，且全年至少 10 個月淨利為正。',
        conds: [
          { key: 'netMonthlyAvgYear', target: 900000, targetByLot: [150000, 400000, 900000, 1800000], cmp: 'gte' },
          { key: 'reputation', target: 560, cmp: 'gte' },
          { key: 'netPositiveMonthsYear', target: 10, cmp: 'gte' },
        ],
      },
    ],
    reward: { money: 60000, reputation: 3, points: { service: 10 } },
    rewardScale: true,
  },
  {
    year: 7,
    id: 'core_y7_word_of_mouth',
    name: '口碑人氣',
    desc: '全年來客達本店人次基準，且平均滿意度達 72。',
    conds: [
      { key: 'patientsYear', target: 400, targetByLot: [400, 800, 1500, 2500], cmp: 'gte' },
      { key: 'avgSatYear', target: 72, cmp: 'gte' },
    ],
    variants: [
      {
        lots: [0, 1],
        name: '口碑人氣（小店版）',
        desc: '全年來客達本店人次基準（巷弄 400、社區 800），平均滿意度達 72。',
        conds: [
          { key: 'patientsYear', target: 400, targetByLot: [400, 800, 1500, 2500], cmp: 'gte' },
          { key: 'avgSatYear', target: 72, cmp: 'gte' },
        ],
      },
      {
        lots: [2, 3],
        name: '口碑人氣（大店版）',
        desc: '全年新增熟客達本店基準（地區 450、旗艦 750），平均滿意度達 75。',
        conds: [
          { key: 'curedYear', target: 450, targetByLot: [120, 240, 450, 750], cmp: 'gte' },
          { key: 'avgSatYear', target: 75, cmp: 'gte' },
        ],
      },
    ],
    reward: { money: 60000, reputation: 3, points: { service: 10 } },
    rewardScale: true,
  },
  {
    year: 8,
    id: 'core_y8_steady_ops',
    name: '穩定營運',
    desc: '員工平均士氣達標，設備故障控制在可接受範圍。',
    conds: [
      { key: 'moraleAvg', target: 65, cmp: 'gte' },
      { key: 'breakdownYear', target: 1, cmp: 'lte' },
    ],
    variants: [
      {
        lots: [0, 1],
        name: '穩定營運（小店版）',
        desc: '員工平均士氣達 65，本年設備故障不超過 1 次。',
        conds: [
          { key: 'moraleAvg', target: 65, cmp: 'gte' },
          { key: 'breakdownYear', target: 1, cmp: 'lte' },
        ],
      },
      {
        lots: [2, 3],
        name: '穩定營運（大店版）',
        desc: '員工平均士氣達 70，本年零設備故障。',
        conds: [
          { key: 'moraleAvg', target: 70, cmp: 'gte' },
          { key: 'breakdownYear', target: 0, cmp: 'lte' },
        ],
      },
    ],
    reward: { money: 60000, reputation: 3, points: { service: 10 } },
    rewardScale: true,
  },
  {
    year: 9,
    id: 'core_y9_local_roots',
    name: '在地深耕',
    desc: '本年社區活動達標，同時在研發或稽查上交出成績。',
    conds: [
      { key: 'communityYear', target: 3, cmp: 'gte' },
      { key: 'inspectionPassedYear', target: 1, cmp: 'gte' },
    ],
    variants: [
      {
        lots: [0, 1],
        name: '在地深耕（小店版）',
        desc: '本年舉辦 3 次以上社區活動，並通過年度稽查。',
        conds: [
          { key: 'communityYear', target: 3, cmp: 'gte' },
          { key: 'inspectionPassedYear', target: 1, cmp: 'gte' },
        ],
      },
      {
        lots: [2, 3],
        name: '在地深耕（大店版）',
        desc: '本年舉辦 4 次以上社區活動，累計完成 12 項研發。',
        conds: [
          { key: 'communityYear', target: 4, cmp: 'gte' },
          { key: 'researchDone', target: 12, cmp: 'gte' },
        ],
      },
    ],
    reward: { money: 60000, reputation: 3, points: { service: 10 } },
    rewardScale: true,
  },
  {
    year: 10,
    id: 'core_y10_summit',
    name: '登峰造極',
    desc: '聲譽達 600，或擴建到「全台旗艦餐廳」（兩者擇一即可）。',
    conds: [
      { key: 'reputation', target: 600, cmp: 'gte' },
    ],
    altConds: [
      { key: 'lotLevel', target: 3, cmp: 'gte' },
    ],
    reward: { money: 60000, reputation: 3, points: { service: 10 } },
    rewardScale: true,
  },
];

// ---------------------------------------------------------------------------
// 加分目標（§3.2 題庫，約 29 題）
// window: 'year' = 本年；'last6m' = 近 6 個月。group: biz | care | team | equip | local | research
// ---------------------------------------------------------------------------

export const BONUS_GOALS = [
  // ---- 經營 biz ----
  {
    id: 'b_biz_profit_months',
    group: 'biz',
    name: '穩定賺錢月',
    desc: '本年有 9 個月以上淨利為正。',
    conds: [{ key: 'netPositiveMonthsYear', target: 9, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: {},
  },
  {
    id: 'b_biz_margin',
    group: 'biz',
    name: '毛利守得住',
    desc: '月毛利（扣食材成本後）占營收 62% 以上達 6 個月，成本不失控。',
    conds: [{ key: 'marginGoodMonthsYear', target: 6, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: {},
  },
  {
    id: 'b_biz_money_growth',
    group: 'biz',
    name: '資金穩穩長',
    desc: '年底資金比年初成長 25% 以上。',
    conds: [{ key: 'moneyGrowthPct', target: 25, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: { minYear: 2, notIfDone: true },
  },
  {
    id: 'b_biz_rep_200',
    group: 'biz',
    name: '街坊都知道',
    desc: '年底聲譽達 200 以上。',
    conds: [{ key: 'reputation', target: 200, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: { minYear: 2, notIfDone: true },
  },
  {
    id: 'b_biz_selfpay_25',
    group: 'biz',
    name: '特色有一套',
    desc: '近 3 個月特色料理收入占比達 25%（需先研發「熟成牛排」）。',
    conds: [{ key: 'selfPayShare3', target: 0.25, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: { minYear: 2, needResearch: 'rs_steak' },
  },
  {
    id: 'b_biz_selfpay_35',
    group: 'biz',
    name: '特色有面子',
    desc: '近 3 個月特色料理收入占比達 35%（需先研發「熱炒鍋氣」）。',
    conds: [{ key: 'selfPayShare3', target: 0.35, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 10 } },
    weight: 4,
    cond: { minYear: 3, needResearch: 'rs_wok' },
  },
  {
    id: 'b_pat_l0',
    group: 'biz',
    name: '巷弄人氣王',
    desc: '本年來客達 400 人次（巷弄小吃店限定）。',
    conds: [{ key: 'patientsYear', target: 400, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: { minLot: 0, maxLot: 0 },
  },
  {
    id: 'b_pat_l1',
    group: 'biz',
    name: '社區人氣王',
    desc: '本年來客達 800 人次（社區餐館限定）。',
    conds: [{ key: 'patientsYear', target: 800, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: { minLot: 1, maxLot: 1 },
  },
  {
    id: 'b_pat_l2',
    group: 'biz',
    name: '地區人氣王',
    desc: '本年來客達 1,500 人次（地區人氣餐廳限定）。',
    conds: [{ key: 'patientsYear', target: 1500, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: { minLot: 2, maxLot: 2 },
  },
  {
    id: 'b_pat_l3',
    group: 'biz',
    name: '全台人氣王',
    desc: '本年來客達 2,500 人次（全台旗艦餐廳限定）。',
    conds: [{ key: 'patientsYear', target: 2500, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: { minLot: 3, maxLot: 3 },
  },

  // ---- 照護 care ----
  {
    id: 'b_care_sat72',
    group: 'care',
    name: '滿意度破表',
    desc: '近 6 個月客人平均滿意度達 72 以上。',
    conds: [{ key: 'avgSat6', target: 72, cmp: 'gte' }],
    window: 'last6m',
    reward: { money: 20000, points: { culinary: 8 } },
    weight: 5,
    cond: {},
  },
  {
    id: 'b_care_zero_slip',
    group: 'care',
    name: '全年不跌倒',
    desc: '本年沒有任何客人或員工滑倒。',
    conds: [{ key: 'slipYear', target: 0, cmp: 'lte' }],
    window: 'year',
    reward: { money: 20000, points: { culinary: 8 } },
    weight: 5,
    cond: { minYear: 1 },
  },
  {
    id: 'b_care_review',
    group: 'care',
    name: '五星好評',
    desc: '網路評價達 4.3 星以上。',
    conds: [{ key: 'reviewScore', target: 4.3, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { culinary: 8 } },
    weight: 5,
    cond: {},
  },
  {
    id: 'b_cure_l0',
    group: 'care',
    name: '巷弄熟客王',
    desc: '本年新增熟客 120 人以上（巷弄小吃店限定）。',
    conds: [{ key: 'curedYear', target: 120, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { culinary: 10 } },
    weight: 5,
    cond: { minLot: 0, maxLot: 0 },
  },
  {
    id: 'b_cure_l1',
    group: 'care',
    name: '社區熟客王',
    desc: '本年新增熟客 240 人以上（社區餐館限定）。',
    conds: [{ key: 'curedYear', target: 240, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { culinary: 10 } },
    weight: 5,
    cond: { minLot: 1, maxLot: 1 },
  },
  {
    id: 'b_cure_l2',
    group: 'care',
    name: '地區熟客王',
    desc: '本年新增熟客 450 人以上（地區人氣餐廳限定）。',
    conds: [{ key: 'curedYear', target: 450, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { culinary: 10 } },
    weight: 5,
    cond: { minLot: 2, maxLot: 2 },
  },
  {
    id: 'b_cure_l3',
    group: 'care',
    name: '全台熟客王',
    desc: '本年新增熟客 750 人以上（全台旗艦餐廳限定）。',
    conds: [{ key: 'curedYear', target: 750, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { culinary: 10 } },
    weight: 5,
    cond: { minLot: 3, maxLot: 3 },
  },

  // ---- 團隊 team ----
  {
    id: 'b_team_no_resign',
    group: 'team',
    name: '大家都留下來',
    desc: '本年沒有任何員工離職。',
    conds: [{ key: 'resignYear', target: 0, cmp: 'lte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 6 } },
    weight: 5,
    cond: {},
  },
  {
    id: 'b_team_morale',
    group: 'team',
    name: '士氣滿滿',
    desc: '全體員工平均士氣達 70 以上。',
    conds: [{ key: 'moraleAvg', target: 70, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 6 } },
    weight: 5,
    cond: { minYear: 1 },
  },
  {
    id: 'b_team_train',
    group: 'team',
    name: '進修有成',
    desc: '本年安排 2 位以上員工受訓。',
    conds: [{ key: 'trainYear', target: 2, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 6 } },
    weight: 5,
    cond: {},
  },

  // ---- 設備 equip ----
  {
    id: 'b_eq_no_breakdown',
    group: 'equip',
    name: '爐子很聽話',
    desc: '本年設備零故障。',
    conds: [{ key: 'breakdownYear', target: 0, cmp: 'lte' }],
    window: 'year',
    reward: { money: 20000, points: { device: 10 } },
    weight: 5,
    cond: {},
  },
  {
    id: 'b_eq_wear',
    group: 'equip',
    name: '保養有方',
    desc: '設備平均耗損低於 60。',
    conds: [{ key: 'wearAvg', target: 59, cmp: 'lte' }],
    window: 'year',
    reward: { money: 20000, points: { device: 10 } },
    weight: 5,
    cond: {},
  },
  {
    id: 'b_eq_maintenance',
    group: 'equip',
    name: '簽下保養合約',
    desc: '與保養廠商簽約，爐具壞了有人第一時間來修。',
    conds: [{ key: 'maintenanceActive', target: 1, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { device: 8 } },
    weight: 4,
    cond: { minYear: 1, notIfDone: true },
  },

  // ---- 在地 local ----
  {
    id: 'b_loc_community',
    group: 'local',
    name: '里民好厝邊',
    desc: '本年舉辦 3 次以上社區活動。',
    conds: [{ key: 'communityYear', target: 3, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: {},
  },
  {
    id: 'b_loc_inspection',
    group: 'local',
    name: '稽查過關',
    desc: '本年通過衛生局的年度稽查。',
    conds: [{ key: 'inspectionPassedYear', target: 1, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: { minYear: 1 },
  },
  {
    id: 'b_loc_dilemma',
    group: 'local',
    name: '溝通有一套',
    desc: '本年處理 4 次以上客人溝通情境。',
    conds: [{ key: 'dilemmasYear', target: 4, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: {},
  },
  {
    id: 'b_loc_risk',
    group: 'local',
    name: '食安降到安全線',
    desc: '店裡目前的食安風險值低於 40。',
    conds: [{ key: 'riskNow', target: 39, cmp: 'lte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: {},
  },

  // ---- 研發 research ----
  {
    id: 'b_rd_year2',
    group: 'research',
    name: '研發活躍',
    desc: '本年完成 2 項以上研發。',
    conds: [{ key: 'researchYear', target: 2, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { device: 8 } },
    weight: 5,
    cond: {},
  },
  {
    id: 'b_rd_total8',
    group: 'research',
    name: '研發大師',
    desc: '生涯累計完成 8 項以上研發。',
    conds: [{ key: 'researchDone', target: 8, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { culinary: 10 } },
    weight: 4,
    cond: { minYear: 2, notIfDone: true },
  },
  {
    id: 'b_rd_upgrade3',
    group: 'research',
    name: '精進不懈',
    desc: '本年投入 3 級「持續精進」（運作 → 研發）。',
    conds: [{ key: 'upgradeYear', target: 3, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 10 } },
    weight: 3,
    cond: { minYear: 4, needResearch: 'rs_signature' },
  },
];

// ---------------------------------------------------------------------------
// 年度等級（§4）
// ---------------------------------------------------------------------------

export const GRADES = [
  { min: 90, grade: 'S', label: '國宴級經營', badgeColor: '#d4a017' },
  { min: 75, grade: 'A', label: '人氣名店', badgeColor: '#2e8b57' },
  { min: 60, grade: 'B', label: '穩健小吃店', badgeColor: '#3b6ea8' },
  { min: 40, grade: 'C', label: '努力中的小店', badgeColor: '#c77d2a' },
  { min: 0, grade: 'D', label: '還在摸索', badgeColor: '#7a7a7a' },
];

export const DIM_LABELS = {
  fin: '💰 財務',
  rep: '📣 聲譽',
  care: '❤️ 服務',
  team: '👥 團隊',
  local: '🏘 在地',
};

export const DIM_EMOJI = {
  fin: '💰',
  rep: '📣',
  care: '❤️',
  team: '👥',
  local: '🏘',
};

// 每個等級 × 每個「最強面向」各 2 句評語（每個等級共 10 句）。C／D 以鼓勵為主。
export const GRADE_LINES = {
  S: {
    fin: [
      '帳本漂亮到會計師都想來面試，這一年的錢是真正「賺」回來的。',
      '月月有盈餘、資金穩穩長，老闆的薪水終於不用跟月底搏鬥了。',
    ],
    rep: [
      '街坊都說「那間店是真的好吃」，口碑早就跑在廣告前面。',
      '客人把你推薦給親戚朋友，聲譽曲線整年都在往上爬。',
    ],
    care: [
      '長輩吃完笑著離開，小孩吃到不想回家，服務細節做到連阿嬤都挑不出毛病。',
      '沒有人在店裡滑倒，座位與等位安排得妥妥當當，客人滿意度整年飆高。',
    ],
    team: [
      '同仁幹勁十足，士氣高到連打烊都想多煮一鍋，這就是團隊的力量。',
      '員工把店當成第二個家，這一年沒有人在鬧離職。',
    ],
    local: [
      '社區活動辦到里長都主動來借場地，在地連結比招牌還亮。',
      '稽查與在地服務雙雙亮眼，說你是區域標竿一點也不誇張。',
    ],
  },
  A: {
    fin: [
      '財務表現相當亮眼，平價主餐與特色料理配得剛剛好，錢包跟著變厚。',
      '營收穩定、淨利可觀，離「國宴級」只差一點點財務火候。',
    ],
    rep: [
      '聲譽成長得很紮實，回頭的熟面孔越來越多，口碑穩穩發酵。',
      '客人會主動推薦朋友來，這就是最好的免費廣告。',
    ],
    care: [
      '服務品質相當穩定，大部分客人都滿意地離開，偶爾的小抱怨不影響大局。',
      '出餐速度與舒適度兼顧，長輩的笑容與孩子的飯碗都有好好照顧。',
    ],
    team: [
      '團隊默契不錯，排班和士氣都在水準之上，大家還願意跟你走下去。',
      '同仁大致穩定，偶爾累了也能互相扶持，這份凝聚力很值錢。',
    ],
    local: [
      '在地活動辦得有聲有色，里民說起這家店都是笑著的。',
      '稽查與社區關係都在線上，你已經是街坊口中的好鄰居。',
    ],
  },
  B: {
    fin: [
      '財務大致平穩，沒有大賺也沒有大虧，穩健經營的味道十足。',
      '錢有進有出，整體還算健康，再找一兩個收入來源就更好了。',
    ],
    rep: [
      '聲譽穩穩地累積，雖然沒有爆紅，但街坊的碑一點一滴在長大。',
      '熟客有回流，新客人也有來，口碑慢慢走在正確的路上。',
    ],
    care: [
      '大多數客人吃得開心，偶爾等位的抱怨有點多，細節還有進步空間。',
      '服務表現中規中矩，再把動線與座位調一調，客人會笑得更開。',
    ],
    team: [
      '團隊運作順暢，偶爾的疲態也能自己調整，是個穩穩的班底。',
      '人員流動不算頻繁，排班與休息的安排還能再細一點。',
    ],
    local: [
      '社區活動有參與，稽查也順利過關，在地關係維持得不錯。',
      '跟街坊相處融洽，繼續保持，口碑會更厚。',
    ],
  },
  C: {
    fin: [
      '這一年財務有點吃緊，但店還開著就是本事，下一年把成本抓一抓就會好轉。',
      '收支勉強打平，別灰心，先把食材損耗與人事排好，慢慢就會有起色。',
    ],
    rep: [
      '聲譽還在起步階段，多辦幾場活動、把服務做好，街坊自然會知道你。',
      '口碑累積需要時間，每一位客人都是下一位客人的介紹人。',
    ],
    care: [
      '客人有些小抱怨，地板與座位是最快見效的投資，先從這裡改起。',
      '服務還有進步空間，把出餐動線理順，客人的笑容會變多。',
    ],
    team: [
      '團隊有些疲憊，記得給大家休息室與適度的排班，士氣是慢慢養出來的。',
      '人手有些吃緊，補一位服務生或廚師，整個店會順起來。',
    ],
    local: [
      '在地連結剛起步，多參加幾場社區活動，街坊會慢慢認得你。',
      '稽查有些小缺失，補上就好，這是學習的好機會。',
    ],
  },
  D: {
    fin: [
      '這一年不太順，帳面有些吃緊，別氣餒，先把最賺錢的幾道菜顧好。',
      '開店頭幾年都辛苦，把成本控制好，慢慢就會看到曙光。',
    ],
    rep: [
      '大家還不太認識這家店，多做幾次社區活動，口碑會慢慢長出來。',
      '好味道需要時間被發現，持續把每一份餐點做好，客人會回來的。',
    ],
    care: [
      '客人的體驗還有很大的進步空間，先鋪防滑磁磚、擺好候位座位，再逐步改善。',
      '先把基本功練好：點餐快、出餐準、地板乾淨，客人自然會變多。',
    ],
    team: [
      '團隊還在磨合，給大家一點時間與休息，慢慢就會有默契。',
      '人手與士氣都需要關心，先把休息室蓋起來，同仁會感受到你的用心。',
    ],
    local: [
      '在地經營才剛開始，先從一場小小的社區活動做起，一步一步來。',
      '稽查與社區關係是長期功課，先補齊缺失，慢慢累積信任。',
    ],
  },
};

// 最弱面向的改進建議（每個面向 2 句）。
export const WEAKEST_LINES = {
  fin: [
    '財務是這一年的弱項，先看看哪個月的成本特別高，把房租與人事排一排，再考慮推高毛利的特色料理。',
    '淨利一直站不穩，可以試著調整特色料理價格，或研發「套餐與會員方案」，讓收入多一條腿。',
  ],
  rep: [
    '聲譽拉不起來，多辦社區活動、把服務做到位，讓客人願意主動推薦，口碑會一點一滴累積。',
    '回頭客與口碑是關鍵，可以考慮研發「社區口碑經營」，讓街坊多聽到好評。',
  ],
  care: [
    '服務分數偏低，先看看滿意度與跌倒紀錄，防滑磁磚與候位座位是最快見效的投資。',
    '客人最在意好吃與等候時間，把排班理順、出餐動線排好，感受會差很多。',
  ],
  team: [
    '團隊是弱項，員工士氣與流失率要留意，多安排訓練、輪班休息，讓大家覺得自己被看見。',
    '設備常故障也會拖累士氣，記得簽保養合約，同仁用起來順手，工作也會更有幹勁。',
  ],
  local: [
    '在地連結偏弱，每季排一場社區活動，讓里民認識你，稽查與客人溝通也會跟著變好。',
    '食安風險值與客人溝通次數是在地的隱形分數，多處理溝通情境，別讓小問題變成大投訴。',
  ],
};

// 面向基準（§4、§6.2 用）。
export const DIM_BENCH = {
  monthlyNetByLot: [150000, 400000, 900000, 1800000],
  repCurve: { 1: 100, 2: 150, 3: 250, 4: 320, 5: 400, 6: 480, 7: 560, 8: 620, 9: 660, 10: 700 },
  satFull: 80,
};

// ---------------------------------------------------------------------------
// 院長日誌（里程碑年：第 1、3、5、7、10 年；每年 2 段）
// ---------------------------------------------------------------------------

export const JOURNAL = {
  1: [
    '剛開業的那幾個月，我每天都是第一個到、最後一個走。店不大，燈管還會閃，但第一位客人吃完走出門口時，我心裡想：這條路，我真的要走下去了。那種又累又開心的感覺，到現在都還記得。',
    '招牌才剛掛上去，街坊還半信半疑。我把每一位客人愛吃的口味寫在小本子上，想著下次見面時，要記得他不吃香菜。十年的路，就從這一本本子開始。',
  ],
  3: [
    '三年過去，店不再是那個冷清的小店了。同仁們熟悉彼此的習慣，客人也會自己找到最好的位子。我開始明白，經營最難的不是賺錢，而是讓每個人都願意留下來。',
    '剛開始的慌亂已經慢慢沉澱。我常常在打烊後坐在店裡，聽長輩聊菜市場的八卦，也聽年輕人抱怨加班的肩頸。這些瑣碎的對話，讓我知道這間店真正的樣子。',
  ],
  5: [
    '來到第五年，我終於能抬頭看見更遠的地方。店面擴大了，帶來的不只是更多座位，還有更多需要被照顧的胃。我告訴自己，責任也要跟著長大。',
    '有一天我站在新的廚房門口，突然想起剛開業時那個窄小的爐台。那時候只想著怎麼活下去，如今卻開始想著怎麼做得更好。這就是十年裡最踏實的一種成長。',
  ],
  7: [
    '過了第七年，我發現自己開始會替同仁著想，也會在意每一位客人吃飯時的表情。店的節奏已經不是我一個人在敲，而是整個團隊一起打的鼓。我很感謝那些陪我走到這裡的人。',
    '不少老客人成了朋友，他們會帶自家種的青菜來分享，也會在我忙到忘記吃飯時提醒我。這樣的日子讓我慢慢相信，這間店真的是在地的一部分了。有時候被抱怨，我反而會笑出來，因為那代表他們還把我們當成自己人。',
  ],
  10: [
    '十年過去，回頭看那個剛開張時緊張得手心冒汗的自己，我只想說一句：辛苦了，也謝謝你沒有放棄。這間店能走到今天，靠的是每一個願意相信我的人。我想把這句話，好好寫進最後的日誌裡。',
    '第十年，我站在店門口，看著來來去去的客人與同仁。這裡不只是一間餐廳，而是一碗碗熱湯、一段段日常被好好對待的地方。接下來是誰來接手呢？我想，那一定會是個很棒的人。',
  ],
};

// ---------------------------------------------------------------------------
// 十年結局（§6.2）。依序判定，取第一個成立者；bankrupt 隨時可觸發。
// ---------------------------------------------------------------------------

const ENDING_STATS = [
  'totalIncome',
  'totalPatients',
  'totalCured',
  'eventsHandled',
  'achievementsDone',
  'peakReputation',
  'finalLot',
  'topTreatment',
];

export const ENDINGS = [
  {
    id: 'legend_chain',
    order: 1,
    title: '全台連鎖傳奇',
    emoji: '🏆',
    desc: '擴建到全台旗艦餐廳，聲譽與總分都站上最高點，招牌的名字全國都叫得出來。',
    conditionText: '店面為「全台旗艦餐廳」，生涯總分 ≥ 85，聲譽 ≥ 600。',
    thanks: [
      '十年前，我只是巷口一間小吃店的老闆，怎麼也想不到有一天，連外縣市的人都會專程搭車來吃這一碗。謝謝每一位走進店裡的客人，也謝謝每一位站在爐台前的同仁，是你們把這間店推到了今天。',
      '這十年，我們把一份份便宜又好吃的餐點，變成了一個招牌。名聲不是我一個人的，它屬於每個排隊的客人、每個流汗的夥伴。接下來，我想繼續把這份味道，好好傳下去。',
    ],
    params: { minLot: 3, minScore: 85, minRep: 600 },
    achievementId: 'e_legend_chain',
    statsOrder: ENDING_STATS,
  },
  {
    id: 'community_hero',
    order: 2,
    title: '社區食堂守護者',
    emoji: '🧓',
    desc: '長期深耕社區早餐與簡餐，把門打開給最多的長輩，滿意度與熟客數都站得住腳。',
    conditionText: '經營方針「社區早餐」累計 ≥ 5 年，長輩熟客 ≥ 500 人，近期滿意度 ≥ 72。',
    thanks: [
      '這十年，我們把門打開給了最多的長輩。他們的早晨不再孤單，餐桌上有人聊天，臉上的笑容也多了起來。我想，這就是我們最想守護的東西。',
      '有個阿伯每次來都會說「老闆，你的湯最好喝」，這句話我聽了很多年，每次都讓我覺得很值得。社區食堂這條路不好走，但有你們在，我們就走得下去。謝謝每一位默默陪伴的同仁，也謝謝每一位願意再來的長輩。',
    ],
    params: { focus: 'community', focusYears: 5, minSat: 72, minElderCured: 500 },
    achievementId: 'e_community_hero',
    statsOrder: ENDING_STATS,
  },
  {
    id: 'business_star',
    order: 3,
    title: '商業午餐名店',
    emoji: '🍱',
    desc: '以商業午餐與學生套餐起家，辦公大樓與校園附近的人都認得這間店，特色料理也做得有聲有色。',
    conditionText: '經營方針「商業午餐」累計 ≥ 5 年，近 12 個月特色料理占比 ≥ 30%，學生客服務 ≥ 1,500 人次。',
    thanks: [
      '十年前，我只想做一間讓上班族吃得快、吃得飽的小店。十年後，附近的辦公大樓都有我們的外送，學生的書包裡也有我們的集點卡。謝謝每一位趕時間卻還是願意排隊的客人。',
      '商業午餐最怕的是翻桌慢、等太久。這十年，我們把動線一改再改，把味道一調再調。每一次尖峰時段都像一場小型戰役，而你們都是最棒的戰友。',
    ],
    params: { focus: 'business', focusYears: 5, minSelfPayShare: 0.3, minStudentServed: 1500 },
    achievementId: 'e_business_star',
    statsOrder: ENDING_STATS,
  },
  {
    id: 'family_pioneer',
    order: 4,
    title: '親子餐廳推手',
    emoji: '🧸',
    desc: '深耕親子友善餐廳，遊戲區與火鍋桌都建好了，家長口中的好地方。',
    conditionText: '經營方針「親子餐廳」累計 ≥ 4 年，家庭客熟客 ≥ 200 人，並已建置兒童遊戲區與火鍋桌。',
    thanks: [
      '這十年，我看著一個個小朋友從坐在兒童餐椅，長到自己點餐、自己收盤。他們的笑聲是這間店最好的背景音樂，謝謝每一位願意帶孩子來的家長。',
      '有個小朋友曾經跟我說：「老闆，我長大要開一間跟你一樣的店。」這句話讓我覺得，這十年的辛苦都有了答案。親子餐廳這條路，我們會繼續走下去。',
    ],
    params: { focus: 'kids', focusYears: 4, minFamilyCured: 200, needObjects: ['play_area', 'hotpot_table'] },
    achievementId: 'e_family_pioneer',
    statsOrder: ENDING_STATS,
  },
  {
    id: 'special_brand',
    order: 5,
    title: '特色料理名店',
    emoji: '💎',
    desc: '特色料理占比長期維持在高檔，牛排與熱炒的招牌讓客人願意為品質多付一點。',
    conditionText: '特色料理占比 ≥ 40% 連續 24 個月，且已研發「熟成牛排」與「熱炒鍋氣」。',
    thanks: [
      '十年前，我只是賣便宜小吃；十年後，客人願意為一塊熟成牛排、一盤現炒海鮮預約三週。這不是因為我們變貴了，而是因為我們把每一道菜都做到了值得。',
      '特色料理的路很難走，成本高、客人挑剔，但只要有人說一句「這道真好吃」，一切都值得。謝謝每一位願意相信我們、也願意多付一點的客人。',
    ],
    params: { minShare: 0.4, months: 24, needResearch: ['rs_steak', 'rs_wok'] },
    achievementId: 'e_special_brand',
    statsOrder: ENDING_STATS,
  },
  {
    id: 'steady_shop',
    order: 6,
    title: '穩健的社區小吃店',
    emoji: '🍜',
    desc: '不是最耀眼的那一間，但每天都有街坊記得你的名字，穩穩地撐到了最後。',
    conditionText: '生涯總分 ≥ 60。',
    thanks: [
      '這間店沒有上過電視，也沒有排隊人龍，但每天早上都有幾位老面孔推開門說：「老闆，老樣子。」這十年我學到，穩穩地把一碗麵煮好，就是最大的本事。',
      '謝謝一路上陪我的同仁與客人。沒有大風大浪，卻有每天的小確幸。這樣的日子，我很珍惜。',
    ],
    params: { minScore: 60 },
    achievementId: 'e_steady_shop',
    statsOrder: ENDING_STATS,
  },
  {
    id: 'struggling_shop',
    order: 7,
    title: '苦撐的老店',
    emoji: '🍵',
    desc: '一路上不輕鬆，錢包時常見底，但門始終沒有關上，這本身就是一種本事。',
    conditionText: '生涯總分 ≥ 40。',
    thanks: [
      '這十年不輕鬆，有好幾個月我連薪水都得向朋友周轉。但店門始終沒有關上，因為我知道，總有人需要這一碗熱湯。',
      '回頭看，每一個撐過去的月底都是勳章。謝謝你們沒有離開，這間老店還在，我也還在。',
    ],
    params: { minScore: 40 },
    achievementId: 'e_struggling_shop',
    statsOrder: ENDING_STATS,
  },
  {
    id: 'retire_handover',
    order: 8,
    title: '功成身退，轉手他人',
    emoji: '🚪',
    desc: '撐滿十年，把店交給下一位老闆。沒有特別耀眼，但也沒有遺憾。',
    conditionText: '以上條件皆不符，但仍營業到第 10 年（功成身退，轉手他人）。',
    thanks: [
      '十年到了，我決定把鍋鏟交給下一位。這間店沒有特別耀眼，但我每天都有認真做每一份餐點，問心無愧。',
      '希望新的老闆能把這間店照顧得更好，也希望客人們能繼續在這裡找到一碗熟悉的味道。謝謝大家。',
    ],
    params: {},
    achievementId: 'e_retire_handover',
    statsOrder: ENDING_STATS,
  },
  {
    id: 'bankrupt',
    order: 9,
    title: '提早收攤',
    emoji: '🪧',
    desc: '資金見底，店只能先拉下鐵門。這一段路沒有走完，但故事還沒有結束。',
    conditionText: '任何時候資金歸零（破產），提早收攤。',
    thanks: [
      '資金見底，這家店只好先暫停營業。雖然很遺憾，但這段時間我學到了很多，也認識了好多好客人。',
      '謝謝每一位曾經光顧的朋友。鐵門只是暫時拉下，說不定哪一天，你會在別的街角，看到同樣的招牌再度亮起。',
    ],
    params: {},
    achievementId: 'e_bankrupt',
    statsOrder: ENDING_STATS,
  },
];

// ---------------------------------------------------------------------------
// 介面文字
// ---------------------------------------------------------------------------

export const CAREER_TEXT = {
  tabTitle: '目標',
  sections: {
    onboarding: '新手任務',
    yearly: '年度計畫',
    career: '生涯進度',
    history: '歷年總結',
  },
  onboardingHeader: '新手任務',
  onboardingHint: '完成就有小獎勵，不急，慢慢來。',
  onboardingHidden: '新手任務已隱藏，可在這裡重新顯示。',
  onboardingDoneAll: '新手任務全部完成，你已經是能獨當一面的老闆了！',
  yearlyHeader: '本年度計畫',
  yearlyHint: '每年 1 個主要目標加 2 個加分目標。達成就領獎勵，沒達成也不罰錢。',
  coreLabel: '主要目標',
  bonusLabel: '加分目標',
  timeLeft: '剩餘 {months} 個月',
  progress: '進度 {current} / {target}',
  claimed: '已領取',
  notClaimed: '未達成',
  emptyYearly: '年度計畫還沒開始，等新的一年就會出現。',
  emptyBonus: '目前沒有合適的加分題，明年再來看看。',
  emptyHistory: '還沒有年度總結，先經營滿一年再來吧。',
  emptyCareer: '生涯還在第一頁，慢慢寫。',
  careerHeader: '生涯進度',
  careerYearLabel: '第 {year} 年 / 共 {total} 年',
  toastGoalDone: '🎯 目標達成：{name}　{reward}',
  toastOnboardingDone: '✅ 新手任務完成：{name}　{reward}',
  rewardMoney: 'NT$ {amount}',
  rewardPoints: '{point} +{amount}',
  rewardReputation: '聲譽 +{amount}',
  pointNames: { culinary: '廚藝', device: '設備', service: '服務' },
  yearReview: {
    title: '年度總結',
    highlights: '本年重點',
    compare: '與去年相比',
    plan: '年度計畫',
    next: '下一年',
    viewCareer: '看生涯進度',
    gradeLabel: '年度等級',
    strongest: '最強面向：{dim}',
    weakest: '待加強：{dim}',
    up: '↑',
    down: '↓',
    same: '→',
  },
  careerEnd: {
    title: '生涯結算',
    quote: '老闆感言',
    continue: '繼續經營',
    restart: '重新開始',
    copyCard: '複製生涯卡',
    shareCard: '分享生涯卡',
    copied: '已複製到剪貼簿',
    copyFailed: '複製失敗，請手動選取文字。',
    statsTitle: '十年統計',
    finalScore: '生涯總分',
    endlessNote: '無盡模式：年度計畫照常循環（題庫隨機、獎勵照發），不會再出現結局；生涯卡可隨時從餐廳面板重新開始。',
    scoreHint: '生涯總分 = 十年年度分數平均（後 5 年 ×1.5）＋ 店面加成。',
  },
  earlyClose: {
    title: '提早收攤',
    subtitle: '資金見底，店只能先拉下鐵門。',
    continue: '重新開始',
    copyCard: '複製生涯卡',
  },
  estimateEnding: '估算生涯結局：{ending}（僅供參考）',
  milestoneJournal: '📖 老闆日誌',
  noTreatment: '（還沒有招牌菜）',
  closeBtn: '關閉',
  cardTemplate: {
    header: '🍜 老闆生涯卡',
    ending: '結局：{ending}',
    lot: '店面：{lot}',
    score: '生涯總分：{score}',
    income: '十年營收：NT$ {income}',
    patients: '服務客人：{patients} 人次',
    cured: '熟客：{cured} 人',
    events: '處理事件：{events} 件',
    achievements: '達成成就：{achievements} 個',
    peakRep: '最高聲譽：{rep}',
    topTreatment: '最常點的餐點：{treatment}',
    footer: '—— 餐廳老闆的十年',
  },
  statLabels: {
    totalIncome: '十年營收',
    totalPatients: '來客數',
    totalCured: '熟客數',
    eventsHandled: '事件處理數',
    achievementsDone: '達成成就',
    peakReputation: '最高聲譽',
    finalLot: '最終店面',
    topTreatment: '最常點的餐點',
  },
};
