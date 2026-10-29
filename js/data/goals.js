// 院長生涯目標與結局資料（docs/GOALS_AND_ENDING.md §2–§6）。All 繁體中文（台灣口吻）。
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
  treatmentsDone: { label: '完成治療人次', unit: '次', higherIsBetter: true, desc: '累計完成的治療次數（treatment:done）。' },
  seatingSet: { label: '候診座位齊備', unit: '0/1', higherIsBetter: true, desc: '場上至少 1 張沙發，且有飲水機或綠植（1 = 成立）。' },
  antislipTiles: { label: '防滑地墊格數', unit: '格', higherIsBetter: true, desc: '場上防滑地墊的格數。' },
  zoneActive_golden3: { label: '黃金三寶區啟動', unit: '0/1', higherIsBetter: true, desc: '「黃金三寶區」專區已啟動（1 = 成立）。' },
  monthsSettled: { label: '月結算次數', unit: '次', higherIsBetter: true, desc: '累計完成的月底健保結算（nhi:settled）。' },
  researchStartedOrDone: { label: '研發開始或完成數', unit: '項', higherIsBetter: true, desc: '進行中或已完成的研發節點數量。' },
  ptCount: { label: '物理治療師人數', unit: '人', higherIsBetter: true, desc: '目前聘用的物理治療師人數。' },
  priceChanged: { label: '自費價格已調整', unit: '0/1', higherIsBetter: true, desc: '任一項自費價格倍率 ≠ 1（1 = 成立）。' },
  communityStarted: { label: '社區活動累計次數', unit: '次', higherIsBetter: true, desc: '累計舉辦的社區活動次數（community:started）。' },
  expandTabOpened: { label: '已看過擴建分頁', unit: '0/1', higherIsBetter: true, desc: '曾開啟診所面板的「擴建」分頁（1 = 成立）。' },

  // ---- 財務與店面 ----
  reputation: { label: '聲譽', unit: '點', higherIsBetter: true, desc: '目前聲譽（0–1000）。' },
  money: { label: '資金', unit: 'NT$', higherIsBetter: true, desc: '目前資金（NT$）。' },
  moneyGrowthPct: { label: '資金成長', unit: '%', higherIsBetter: true, desc: '目前資金相對本年年初的增減百分比。' },
  lotLevel: { label: '店面等級', unit: '級', higherIsBetter: true, desc: '0 = 巷弄小診所、1 = 社區診所、2 = 地區復健中心、3 = 全台頂尖復健中心。' },
  netMonthlyAvgYear: { label: '本年月淨利均值', unit: 'NT$/月', higherIsBetter: true, desc: '本年各月淨利的平均值（NT$）。' },
  netPositiveMonthsYear: { label: '本年淨利為正月數', unit: '月', higherIsBetter: true, desc: '本年淨利為正的月數（0–12）。' },
  selfPayShare3: { label: '自費占比（近 3 個月）', unit: '比例 0–1', higherIsBetter: true, desc: '近 3 個月自費收入占總收入的比例（0–1）。' },
  pvGoodMonthsYear: { label: '點值達標月數', unit: '月', higherIsBetter: true, desc: '本年健保點值 ≥ 0.90 的月數。' },

  // ---- 病患與照護 ----
  patientsYear: { label: '本年病患數', unit: '人次', higherIsBetter: true, desc: '本年服務的病患人次。' },
  curedYear: { label: '本年治癒人數', unit: '人', higherIsBetter: true, desc: '本年治癒的病患人數。' },
  avgSat6: { label: '近 6 個月平均滿意度', unit: '分（0–100）', higherIsBetter: true, desc: '近 6 個月病患滿意度的平均（0–100）。' },
  avgSatYear: { label: '本年平均滿意度', unit: '分（0–100）', higherIsBetter: true, desc: '本年病患滿意度的平均（0–100）。' },
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

  // ---- 在地與評鑑 ----
  communityYear: { label: '本年社區活動次數', unit: '次', higherIsBetter: true, desc: '本年舉辦的社區活動次數。' },
  inspectionPassedYear: { label: '本年通過評鑑', unit: '0/1', higherIsBetter: true, desc: '本年年度評鑑（衛生局／健保署）是否通過（1 = 通過）。' },
  dilemmasYear: { label: '本年醫病溝通處理次數', unit: '次', higherIsBetter: true, desc: '本年處理的醫病溝通情境次數。' },
  riskNow: { label: '目前風險值', unit: '分（0–100）', higherIsBetter: false, desc: '診所目前的整體風險值（越低越安全）。' },

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
    name: '讓第一位病患治療完畢',
    desc: '治療流程跑通，才知道診所真的會動起來。',
    hint: '在營運面板點選病患，安排一次治療，等它結束。',
    reward: { money: 10000 },
    metric: { key: 'treatmentsDone', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_seating',
    name: '擺一組候診座位',
    desc: '候診區舒服，長輩就不會一直抱怨腰痠腿痛。',
    hint: '在建造面板放一張沙發，再加一台飲水機或一盆綠植。',
    reward: { points: { service: 5 } },
    metric: { key: 'seatingSet', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_antislip',
    name: '鋪防滑地墊',
    desc: '地板濕滑是診所最常見的意外，先鋪好地墊保護大家。',
    hint: '在建造面板選防滑地墊，至少鋪滿 6 格。',
    reward: { money: 15000 },
    metric: { key: 'antislipTiles', target: 6, cmp: 'gte' },
  },
  {
    id: 'ob_golden3',
    name: '湊成「黃金三寶區」',
    desc: '專區搭配到位會有額外加成，是診所賺錢的第一個小秘訣。',
    hint: '在專區面板放齊黃金三寶需要的設備，讓專區啟動。',
    reward: { points: { device: 8 } },
    metric: { key: 'zoneActive_golden3', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_first_settle',
    name: '完成第一次月結算',
    desc: '健保點值與申報是診所的命脈，第一次結算要親眼看一下。',
    hint: '等月底到來，在月結算視窗看看健保收入與點值。',
    reward: { money: 20000 },
    metric: { key: 'monthsSettled', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_research',
    name: '開始一項研發',
    desc: '研發點數會慢慢變成新技術，越早起步越划算。',
    hint: '打開研發面板，挑一個便宜的節點開始研究。',
    reward: { points: { medical: 5 } },
    metric: { key: 'researchStartedOrDone', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_second_pt',
    name: '僱用第二位物理治療師',
    desc: '人手一多，翻桌速度就上去了，病患等得也比較少。',
    hint: '到人員面板的招募頁，再聘一位物理治療師。',
    reward: { money: 25000 },
    metric: { key: 'ptCount', target: 2, cmp: 'gte' },
  },
  {
    id: 'ob_price',
    name: '調整一項自費價格',
    desc: '自費價格是轉型的第一步，價格要跟服務品質對得上。',
    hint: '到營運面板的價格區，調整任一項自費價格。',
    reward: { points: { service: 6 } },
    metric: { key: 'priceChanged', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_community',
    name: '辦一次社區活動',
    desc: '街坊認得你，病患才會帶朋友來，口碑就是這樣來的。',
    hint: '到營運面板的社區活動區，選一個活動開辦。',
    reward: { money: 12000 },
    metric: { key: 'communityStarted', target: 1, cmp: 'gte' },
  },
  {
    id: 'ob_expand_tab',
    name: '查看年度評鑑條件',
    desc: '先知道衛生局與健保署會看什麼，擴建與評鑑才不會措手不及。',
    hint: '打開診所面板，切到「擴建」分頁看一看。',
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
    desc: '擴建到「社區診所」，門口終於有像樣的招牌了。',
    conds: [
      { key: 'lotLevel', target: 1, cmp: 'gte' },
    ],
    reward: { money: 60000, reputation: 3, points: { service: 10 } },
    rewardScale: true,
  },
  {
    year: 3,
    id: 'core_y3_audit',
    name: '通過督導',
    desc: '通過年度評鑑，且全年平均滿意度達 68。',
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
    name: '自費轉型',
    desc: '自費收入占比連續 3 個月達 25%，不再只靠健保吃飯。',
    conds: [
      { key: 'selfPayShare3', target: 0.25, cmp: 'gte' },
    ],
    reward: { money: 60000, reputation: 3, points: { service: 10 } },
    rewardScale: true,
  },
  {
    year: 5,
    id: 'core_y5_expand_l2',
    name: '地區據點',
    desc: '擴建到「地區復健中心」，成為鄰近幾個里都認得的復健據點。',
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
    desc: '全年月淨利均值達本店基準（巷弄與社區為 15 萬／40 萬，據點與頂尖為 90 萬／180 萬），聲譽達 480。',
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
        name: '穩定獲利（據點版）',
        desc: '月淨利均值達本店基準（據點 90 萬、頂尖 180 萬），聲譽達 560，且全年至少 10 個月淨利為正。',
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
    desc: '全年病患達本店人次基準，且平均滿意度達 72。',
    conds: [
      { key: 'patientsYear', target: 400, targetByLot: [400, 800, 1500, 2500], cmp: 'gte' },
      { key: 'avgSatYear', target: 72, cmp: 'gte' },
    ],
    variants: [
      {
        lots: [0, 1],
        name: '口碑人氣（小店版）',
        desc: '全年病患達本店人次基準（巷弄 400、社區 800），平均滿意度達 72。',
        conds: [
          { key: 'patientsYear', target: 400, targetByLot: [400, 800, 1500, 2500], cmp: 'gte' },
          { key: 'avgSatYear', target: 72, cmp: 'gte' },
        ],
      },
      {
        lots: [2, 3],
        name: '口碑人氣（據點版）',
        desc: '全年治癒達本店基準（據點 450、頂尖 750），平均滿意度達 75。',
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
        name: '穩定營運（據點版）',
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
    desc: '本年社區活動達標，同時在研發或評鑑上交出成績。',
    conds: [
      { key: 'communityYear', target: 3, cmp: 'gte' },
      { key: 'inspectionPassedYear', target: 1, cmp: 'gte' },
    ],
    variants: [
      {
        lots: [0, 1],
        name: '在地深耕（小店版）',
        desc: '本年舉辦 3 次以上社區活動，並通過年度評鑑。',
        conds: [
          { key: 'communityYear', target: 3, cmp: 'gte' },
          { key: 'inspectionPassedYear', target: 1, cmp: 'gte' },
        ],
      },
      {
        lots: [2, 3],
        name: '在地深耕（據點版）',
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
    desc: '聲譽達 600，或擴建到「全台頂尖復健中心」（兩者擇一即可）。',
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
    id: 'b_biz_pv_stable',
    group: 'biz',
    name: '點值守得住',
    desc: '健保點值維持在 0.90 以上達 6 個月，申報不踩紅線。',
    conds: [{ key: 'pvGoodMonthsYear', target: 6, cmp: 'gte' }],
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
    name: '自費有一套',
    desc: '近 3 個月自費收入占比達 25%（需先研發「體外震波技術」）。',
    conds: [{ key: 'selfPayShare3', target: 0.25, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: { minYear: 2, needResearch: 'rs_shockwave' },
  },
  {
    id: 'b_biz_selfpay_35',
    group: 'biz',
    name: '自費有面子',
    desc: '近 3 個月自費收入占比達 35%（需先研發「PRP 增生療法」）。',
    conds: [{ key: 'selfPayShare3', target: 0.35, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 10 } },
    weight: 4,
    cond: { minYear: 3, needResearch: 'rs_prp' },
  },
  {
    id: 'b_pat_l0',
    group: 'biz',
    name: '巷弄人氣王',
    desc: '本年病患達 400 人次（巷弄小診所限定）。',
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
    desc: '本年病患達 800 人次（社區診所限定）。',
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
    desc: '本年病患達 1,500 人次（地區復健中心限定）。',
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
    desc: '本年病患達 2,500 人次（頂尖復健中心限定）。',
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
    desc: '近 6 個月平均滿意度達 72 以上。',
    conds: [{ key: 'avgSat6', target: 72, cmp: 'gte' }],
    window: 'last6m',
    reward: { money: 20000, points: { medical: 8 } },
    weight: 5,
    cond: {},
  },
  {
    id: 'b_care_zero_slip',
    group: 'care',
    name: '全年不跌倒',
    desc: '本年沒有任何病患或員工滑倒。',
    conds: [{ key: 'slipYear', target: 0, cmp: 'lte' }],
    window: 'year',
    reward: { money: 20000, points: { medical: 8 } },
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
    reward: { money: 20000, points: { medical: 8 } },
    weight: 5,
    cond: {},
  },
  {
    id: 'b_cure_l0',
    group: 'care',
    name: '巷弄妙手',
    desc: '本年治癒 120 人以上（巷弄小診所限定）。',
    conds: [{ key: 'curedYear', target: 120, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { medical: 10 } },
    weight: 5,
    cond: { minLot: 0, maxLot: 0 },
  },
  {
    id: 'b_cure_l1',
    group: 'care',
    name: '社區妙手',
    desc: '本年治癒 240 人以上（社區診所限定）。',
    conds: [{ key: 'curedYear', target: 240, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { medical: 10 } },
    weight: 5,
    cond: { minLot: 1, maxLot: 1 },
  },
  {
    id: 'b_cure_l2',
    group: 'care',
    name: '地區妙手',
    desc: '本年治癒 450 人以上（地區復健中心限定）。',
    conds: [{ key: 'curedYear', target: 450, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { medical: 10 } },
    weight: 5,
    cond: { minLot: 2, maxLot: 2 },
  },
  {
    id: 'b_cure_l3',
    group: 'care',
    name: '全台妙手',
    desc: '本年治癒 750 人以上（頂尖復健中心限定）。',
    conds: [{ key: 'curedYear', target: 750, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { medical: 10 } },
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
    name: '機器很聽話',
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
    desc: '與保養廠商簽約，設備壞了有人第一時間來修。',
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
    name: '評鑑過關',
    desc: '本年通過衛生局與健保署的年度評鑑。',
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
    desc: '本年處理 4 次以上醫病溝通情境。',
    conds: [{ key: 'dilemmasYear', target: 4, cmp: 'gte' }],
    window: 'year',
    reward: { money: 20000, points: { service: 8 } },
    weight: 5,
    cond: {},
  },
  {
    id: 'b_loc_risk',
    group: 'local',
    name: '風險降到安全線',
    desc: '診所目前的風險值低於 40。',
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
    reward: { money: 20000, points: { medical: 10 } },
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
    cond: { minYear: 4, needResearch: 'rs_chronic' },
  },
];

// ---------------------------------------------------------------------------
// 年度等級（§4）
// ---------------------------------------------------------------------------

export const GRADES = [
  { min: 90, grade: 'S', label: '國手級經營', badgeColor: '#d4a017' },
  { min: 75, grade: 'A', label: '優秀名醫', badgeColor: '#2e8b57' },
  { min: 60, grade: 'B', label: '穩健診所', badgeColor: '#3b6ea8' },
  { min: 40, grade: 'C', label: '努力中的小店', badgeColor: '#c77d2a' },
  { min: 0, grade: 'D', label: '還在摸索', badgeColor: '#7a7a7a' },
];

export const DIM_LABELS = {
  fin: '💰 財務',
  rep: '📣 聲譽',
  care: '❤️ 照護',
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
      '月月有盈餘、資金穩穩長，院長的薪水終於不用跟月底搏鬥了。',
    ],
    rep: [
      '街坊都說「那間復健中心是真的有效」，口碑早就跑在廣告前面。',
      '病患把你推薦給親戚朋友，聲譽曲線整年都在往上爬。',
    ],
    care: [
      '長輩走出來時腳步都輕快了，滿意度與療效雙雙在線上。',
      '沒有人在診所裡滑倒，照護細節做到連阿嬤都挑不出毛病。',
    ],
    team: [
      '同仁幹勁十足，士氣高到連午休都想加班，這就是團隊的力量。',
      '員工把診所當成第二個家，這一年沒有人在鬧離職。',
    ],
    local: [
      '社區活動辦到里長都主動來借場地，在地連結比招牌還亮。',
      '評鑑與在地服務雙雙亮眼，說你是區域標竿一點也不誇張。',
    ],
  },
  A: {
    fin: [
      '財務表現相當亮眼，自費與健保配得剛剛好，錢包跟著變厚。',
      '營收穩定、淨利可觀，離「國手級」只差一點點財務火候。',
    ],
    rep: [
      '聲譽成長得很紮實，回診的熟面孔越來越多，口碑穩穩發酵。',
      '病患會主動推薦朋友來，這就是最好的免費廣告。',
    ],
    care: [
      '照護品質相當穩定，大部分病患都滿意地回家，偶爾的小抱怨不影響大局。',
      '療效與舒適度兼顧，長輩的膝蓋與笑容都有好好照顧。',
    ],
    team: [
      '團隊默契不錯，排班和士氣都在水準之上，大家還願意跟你走下去。',
      '同仁大致穩定，偶爾累了也能互相扶持，這份凝聚力很值錢。',
    ],
    local: [
      '在地活動辦得有聲有色，里民說起診所都是笑著的。',
      '評鑑與社區關係都在線上，你已經是街坊口中的好鄰居。',
    ],
  },
  B: {
    fin: [
      '財務大致平穩，沒有大賺也沒有大虧，穩健經營的味道十足。',
      '錢有進有出，整體還算健康，再找一兩項收入來源就更好了。',
    ],
    rep: [
      '聲譽還在慢慢累積，口碑像煲湯一樣，需要時間才會入味。',
      '街坊對你的印象不差，多一些成功案例就能再推一把。',
    ],
    care: [
      '照護大致及格，病患多半能安心回家，但滿意度還有空間。',
      '療效與等候時間都在中間值，多花一點心思在細節就能加分。',
    ],
    team: [
      '團隊運作還算順，偶爾有人喊累，記得適時給大家喘口氣。',
      '人員狀況尚可，若能多做訓練，團隊會更有底氣。',
    ],
    local: [
      '在地連結有一些，但還不夠深，多辦幾場社區活動會更有感。',
      '評鑑與社區活動都有基本成績，再加把勁就能成為里民的熟面孔。',
    ],
  },
  C: {
    fin: [
      '這一年錢包有點吃緊，別灰心，先把收支節奏抓穩，下一年會更好。',
      '財務上有點挑戰，但你已經摸到門路了，慢慢調整就能翻身。',
    ],
    rep: [
      '口碑還在起步階段，每一位滿意的病患都是新的開始，加油！',
      '聲譽比預期慢一些，但你的努力大家都看在眼裡。',
    ],
    care: [
      '照護還有不少可以改進的空間，從滿意度開始一步步來，長輩會感受到的。',
      '療效與舒適度有起有落，先抓住最常見的抱怨，就是進步。',
    ],
    team: [
      '團隊還在磨合，有點累、有點亂，但彼此都還在，這就是重新出發的本錢。',
      '同仁的狀況有起伏，多聽聽他們的聲音，會發現很多解方。',
    ],
    local: [
      '在地關係還在建立中，社區活動辦起來，街坊就會慢慢認得你。',
      '評鑑與在地服務還有空間，別怕慢，穩穩來就好。',
    ],
  },
  D: {
    fin: [
      '這一年過得很辛苦，帳上的數字讓人睡不好，連宮廟的平安符都求過了，但還是撐下來了。',
      '財務吃緊是真的，不過每個院長都是從這裡一步步爬上來的，別忘了這點。',
    ],
    rep: [
      '口碑還沒有起飛，但每一次好好服務都是種子，慢慢會發芽的。',
      '街坊還不太認識診所，從一場社區小活動開始就很好。',
    ],
    care: [
      '照護還有很大的進步空間，先從防滑、候診座位這些基本功做起吧。',
      '病患的感受最直接，多聽他們說一句，就知道該從哪裡改。',
    ],
    team: [
      '團隊狀況不太好，人心散了不要緊，把溝通與排班理順，一切都能重來。',
      '同仁疲累是警訊，先讓大家喘口氣，才有力氣往前走。',
    ],
    local: [
      '在地連結還很淺，但街坊也在看你，從一句問候開始就是開始。',
      '評鑑與社區關係都需要重新經營，先把基本功做好，路就會慢慢打開。',
    ],
  },
};

// 最弱面向的改進建議（每個面向 2 句）。
export const WEAKEST_LINES = {
  fin: [
    '財務是這一年的弱項，先看看哪個月的成本特別高，把房租與人事排一排，再考慮擴大自費方案。',
    '淨利一直站不穩，可以試著調整自費價格，或研發「自費方案包裝」，讓收入多一條腿。',
  ],
  rep: [
    '聲譽拉不起來，多辦社區活動、把服務做到位，讓病患願意主動推薦，口碑會一點一滴累積。',
    '回診與口碑是關鍵，可以考慮研發「社區口碑經營」，讓街坊多聽到好評。',
  ],
  care: [
    '照護分數偏低，先看看滿意度與跌倒紀錄，防滑地墊與候診座位是最快見效的投資。',
    '病患最在意療效與等候時間，把排班理順、衛教說清楚，感受會差很多。',
  ],
  team: [
    '團隊是弱項，員工士氣與流失率要留意，多安排訓練、輪班休息，讓大家覺得自己被看見。',
    '設備常故障也會拖累士氣，記得簽保養合約，同仁用起來順手，工作也會更有幹勁。',
  ],
  local: [
    '在地連結偏弱，每季排一場社區活動，讓里民認識你，評鑑與醫病溝通也會跟著變好。',
    '風險值與醫病溝通次數是在地的隱形分數，多處理溝通情境，別讓小問題變成大投訴。',
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
    '剛開業的那幾個月，我每天都是第一個到、最後一個走。診所不大，燈管還會閃，但第一位病患走出門口時，我心裡想：這條路，我真的要走下去了。那種又累又開心的感覺，到現在都還記得。',
    '招牌才剛掛上去，街坊還半信半疑。我把每一位病患的名字寫在小本子上，想著下次見面時，要記得他的膝蓋哪裡痠。十年的路，就從這一本本子開始。',
  ],
  3: [
    '三年過去，診所不再是那個冷清的小店了。同仁們熟悉彼此的習慣，病患也會自己找到候診區的好位子。我開始明白，經營最難的不是賺錢，而是讓每個人都願意留下來。',
    '剛開始的慌亂已經慢慢沉澱。我常常在下班後坐在候診區，聽長輩聊菜市場的八卦，也聽年輕人抱怨加班的肩頸。這些瑣碎的對話，讓我知道診所真正的樣子。',
  ],
  5: [
    '來到第五年，我終於能抬頭看見更遠的地方。店面擴大了，帶來的不只是更多床位，還有更多需要被照顧的人。我告訴自己，責任也要跟著長大。',
    '有一天我站在新的治療室門口，突然想起剛開業時那間窄小的房間。那時候只想著怎麼活下去，如今卻開始想著怎麼做得更好。這就是十年裡最踏實的一種成長。',
  ],
  7: [
    '過了第七年，我發現自己開始會替同仁著想，也會在意每一位病人走路時的步伐。診所的節奏已經不是我一個人在敲，而是整個團隊一起打的鼓。我很感謝那些陪我走到這裡的人。',
    '不少老病患成了朋友，他們會帶自家種的青菜來分享，也會在我忙到忘記吃飯時提醒我。這樣的日子讓我慢慢相信，這間診所真的是在地的一部分了。有時候被抱怨，我反而會笑出來，因為那代表他們還把我們當成自己人。',
  ],
  10: [
    '十年過去，回頭看那個剛開張時緊張得手心冒汗的自己，我只想說一句：辛苦了，也謝謝你沒有放棄。這間診所能走到今天，靠的是每一個願意相信我的人。我想把這句話，好好寫進最後的日誌裡。',
    '第十年，我站在診所門口，看著來來去去的病患與同仁。這裡不只是一間復健中心，而是一段段人生被修補、被陪伴的地方。接下來是誰來接手呢？我想，那一定會是個很棒的人。',
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
    id: 'legend_center',
    order: 1,
    title: '國手級復健中心',
    emoji: '🏆',
    desc: '擴建到全台頂尖復健中心，聲譽與總分都站上最高點，名字在全國都叫得出來。',
    conditionText: '店面為「全台頂尖復健中心」，生涯總分 ≥ 85，聲譽 ≥ 600。',
    thanks: [
      '十年下來，我們從巷弄裡的小診所，走到全台頂尖的位置。這不是靠一個人的本事，而是每一位同仁、每一位病患一起寫下的故事。謝謝大家，讓這個名字在別人心裡有了分量。',
      '我常說自己只是個修身體的人，但這十年證明了，認真做好每一件小事，也能走得很遠。站在最頂端回頭看，風景最美的還是那些一起努力的日子。每次想到這裡，我都會想起第一天的燈管，還有大家一起加班的晚上。',
    ],
    params: { minLot: 3, minScore: 85, minRep: 600 },
    achievementId: 'e_legend_center',
    statsOrder: ENDING_STATS,
  },
  {
    id: 'ltc_guardian',
    order: 2,
    title: '長照守護者',
    emoji: '🧓',
    desc: '長期專攻長照，把門打開給最多的長輩，滿意度與治癒數都站得住腳。',
    conditionText: '經營方針「長照」累計 ≥ 5 年，長輩治癒 ≥ 500 人，近期滿意度 ≥ 72。',
    thanks: [
      '這十年，我們把門打開給了最多的長輩。他們的膝蓋不再那麼痠，走路不再那麼怕，臉上的笑容也多了起來。我想，這就是我們最想守護的東西。',
      '有個阿伯每次來都會說「醫生，你手很輕」，這句話我聽了很多年，每次都讓我覺得很值得。長照這條路不好走，但有你們在，我們就走得下去。謝謝每一位默默陪伴的同仁，也謝謝每一位願意再來的長輩。',
    ],
    params: { focus: 'ltc', focusYears: 5, minSat: 72, minElderCured: 500 },
    achievementId: 'e_ltc_guardian',
    statsOrder: ENDING_STATS,
  },
  {
    id: 'sports_doctor',
    order: 3,
    title: '運動醫學名醫',
    emoji: '🏃',
    desc: '以骨科與運動傷害起家，球場與跑道上的人都認得這間診所，自費也做得有聲有色。',
    conditionText: '經營方針「骨科」累計 ≥ 5 年，近 12 個月自費占比 ≥ 30%，運動類病患服務 ≥ 1,500 人次。',
    thanks: [
      '這十年，球場與跑道上的人成了我們最常見的病患。他們要的不只是快點好，而是能再站上場。看著他們重新出發，就是我最大的成就感。',
      '我們的診間裡常有汗水與喘息聲，也有很多想要更好的眼神。謝謝那些相信我們的運動員，你們讓我們學會把「回到場上」當成最重要的目標。每次看到他們在場上奔跑，我都覺得這份工作真的值得。',
    ],
    params: { focus: 'ortho', focusYears: 5, minSelfPayShare: 0.3, minSportsServed: 1500 },
    achievementId: 'e_sports_doctor',
    statsOrder: ENDING_STATS,
  },
  {
    id: 'peds_pioneer',
    order: 4,
    title: '早療推手',
    emoji: '🧸',
    desc: '深耕兒童早期療育，感統室與語言治療室都建好了，家長口中的好地方。',
    conditionText: '經營方針「早療」累計 ≥ 4 年，兒童療程（治癒，或每 8 次就診折 1 個療程）≥ 200，並已建置感統室與語言治療室。',
    thanks: [
      '這十年，我們陪伴了許多小朋友走過最需要被看見的階段。一句清楚的話、一次穩穩的站立，都是家長眼裡最珍貴的進步。我很驕傲，我們做了一件值得的事。',
      '放電樂園的笑聲，是我聽過最動人的聲音。感謝家長們的信任與耐心，也謝謝同仁們陪著每一個孩子慢慢長大。早療之路很長，但我們會一直走下去。',
    ],
    params: { focus: 'peds', focusYears: 4, minKidCured: 200, needObjects: ['si_room', 'speech_room'] },
    achievementId: 'e_peds_pioneer',
    statsOrder: ENDING_STATS,
  },
  {
    id: 'selfpay_brand',
    order: 5,
    title: '自費專科品牌',
    emoji: '💎',
    desc: '自費占比長期維持在高檔，PRP 與震波的招牌讓病患願意為品質多付一點。',
    conditionText: '自費占比 ≥ 40% 連續 24 個月，且已研發「PRP 增生療法」與「體外震波技術」。',
    thanks: [
      '這十年，我們學會讓服務的價值被看見，也讓病患願意為了品質多付一點心。自費不是為了賺錢而賺錢，而是讓好的治療能被更多人需要。我們只是希望，好的治療不要因為門檻而被錯過。',
      '剛開始面對自費的時候很忐忑，怕病患會不高興。後來才發現，只要把道理講清楚、把效果做出來，大家是願意跟你走的。謝謝這一路上相信我們的人。',
    ],
    params: { minShare: 0.4, months: 24, needResearch: ['rs_prp', 'rs_shockwave'] },
    achievementId: 'e_selfpay_brand',
    statsOrder: ENDING_STATS,
  },
  {
    id: 'steady_clinic',
    order: 6,
    title: '穩健的社區診所',
    emoji: '🏥',
    desc: '不是最耀眼的那一間，但每天都有街坊記得你的名字，穩穩地撐到了最後。',
    conditionText: '生涯總分 ≥ 60。',
    thanks: [
      '這十年，我們沒有走最耀眼的路，而是一步一腳印地陪在街坊身邊。診所不算大，但每天都有人記得我們的名字，這就很夠了。街坊一句「醫生早」，就是我們最大的鼓勵。',
      '有起有落的日子我們都經歷過，能穩穩地撐到現在，靠的是同仁的堅持與病患的信任。謝謝你們陪我們把這間社區診所好好地經營下去。這份情分，我們會一直記在心上。',
    ],
    params: { minScore: 60 },
    achievementId: 'e_steady_clinic',
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
      '這十年不容易，有些月份錢包空空，也有些時候差點撐不下去。但我們還是把門打開了，這本身就是一種勇氣。謝謝每一位陪我撐下來的人。',
      '老店的日子雖然辛苦，但每一位走進來的病患，都讓我們知道還有人需要我們。下一段路怎麼走，我們還會慢慢想，但請相信，只要不放棄，就還有路。我們會把這份陪伴，一直傳下去。',
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
    desc: '撐滿十年，把診所交給下一位院長。沒有特別耀眼，但也沒有遺憾。',
    conditionText: '以上條件皆不符，但仍營業到第 10 年（功成身退，轉手他人）。',
    thanks: [
      '十年過去，我把診所交給了下一位院長。這裡的每一面牆、每一張椅子都有我們的回憶。我相信，這間診所會在你們手上繼續發光。',
      '謝謝這十年陪著我的每一個人。當我把鑰匙交出去的那一刻，心裡有點捨不得，但更多的是安心。希望這裡的溫度，能繼續陪著每位來到這裡的人。',
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
    desc: '資金見底，診所只能先拉下鐵門。這一段路沒有走完，但故事還沒有結束。',
    conditionText: '任何時候資金歸零（破產），提早收攤。',
    thanks: [
      '資金見底的那天，我坐在空蕩蕩的候診區很久。這一段路沒有走完，是我心裡最過不去的坎。但我想，每一次跌倒都是下一次站起來的理由。',
      '收攤的日子很安靜，同仁們的道別我到現在還記得。謝謝大家陪我走了這一段，雖然沒能到終點，但我們曾經認真地照顧過很多人。那些日子的笑聲，我一直記得。',
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
  onboardingDoneAll: '新手任務全部完成，你已經是能獨當一面的院長了！',
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
  pointNames: { medical: '醫術', device: '儀器', service: '服務' },
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
    quote: '院長感言',
    continue: '繼續經營',
    restart: '重新開始',
    copyCard: '複製生涯卡',
    shareCard: '分享生涯卡',
    copied: '已複製到剪貼簿',
    copyFailed: '複製失敗，請手動選取文字。',
    statsTitle: '十年統計',
    finalScore: '生涯總分',
    endlessNote: '無盡模式：年度計畫照常循環（題庫隨機、獎勵照發），不會再出現結局；生涯卡可隨時從診所面板重新開始。',
    scoreHint: '生涯總分 = 十年年度分數平均（後 5 年 ×1.5）＋ 店面加成。',
  },
  earlyClose: {
    title: '提早收攤',
    subtitle: '資金見底，診所只能先拉下鐵門。',
    continue: '重新開始',
    copyCard: '複製生涯卡',
  },
  estimateEnding: '估算生涯結局：{ending}（僅供參考）',
  milestoneJournal: '📖 院長日誌',
  noTreatment: '（還沒有常用療法）',
  closeBtn: '關閉',
  cardTemplate: {
    header: '🏥 院長生涯卡',
    ending: '結局：{ending}',
    lot: '店面：{lot}',
    score: '生涯總分：{score}',
    income: '十年營收：NT$ {income}',
    patients: '服務病患：{patients} 人次',
    cured: '治癒：{cured} 人',
    events: '處理事件：{events} 件',
    achievements: '達成成就：{achievements} 個',
    peakRep: '最高聲譽：{rep}',
    topTreatment: '最常用療法：{treatment}',
    footer: '—— 復健診所院長的十年',
  },
  statLabels: {
    totalIncome: '十年營收',
    totalPatients: '病患數',
    totalCured: '治癒數',
    eventsHandled: '事件處理數',
    achievementsDone: '達成成就',
    peakReputation: '最高聲譽',
    finalLot: '最終店面',
    topTreatment: '最常用療法',
  },
};
