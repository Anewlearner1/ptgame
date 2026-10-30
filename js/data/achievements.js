// Achievement definitions (docs/ACHIEVEMENTS.md §4 / §5.1; restaurant version, see docs/RESTAURANT_DESIGN.md). All 繁體中文 (台灣口吻).
//
// Fields:
//   id, name, desc (條件), cat: 'milestone'|'taiwan'|'challenge', tier: 1|2|3 (銅/銀/金)
//   hidden: 未解鎖時顯示「？？？」＋ hint；解鎖後才顯示全文
//   badge: 徽章 emoji
//   title: 解鎖後可配戴的特殊稱號（≤ 10 字）
//   reward: 只在覆寫階層預設時才寫。pointKey = 點數種類（culinary|device|service），
//           銅／銀預設 service，金一律 service。點數量見 ACHIEVEMENT_TIERS[tier].points。
//   goal / metric: 累計類成就的進度條目標與來源（無則只顯示已／未解鎖）。

import { RESEARCH } from './research.js';
import { ENDINGS } from './goals.js';

// 結局成就的階層（金＝國手級；專科結局銀；其餘銅）
const ENDING_TIERS = { legend_chain: 3, community_hero: 2, business_star: 2, family_pioneer: 2, special_brand: 2, steady_shop: 2, struggling_shop: 1, retire_handover: 1, bankrupt: 1 };

export const ACHIEVEMENTS = [
  // ---------- 經營里程碑 milestone ----------
  { id: 'm_first_month', name: '開張大吉', desc: '完成第一次月底結算。', cat: 'milestone', tier: 1, hidden: false, badge: '🎉' },
  { id: 'm_cash_2m', name: '第一桶金', desc: '資金累積到 NT$ 2,000,000 以上。', cat: 'milestone', tier: 1, hidden: false, badge: '💰', goal: 2000000, metric: 'money' },
  { id: 'm_cash_10m', name: '千萬老闆', desc: '資金累積到 NT$ 10,000,000 以上。', cat: 'milestone', tier: 3, hidden: false, badge: '💎', title: '千萬老闆', goal: 10000000, metric: 'money' },
  { id: 'm_pat_100', name: '百人次', desc: '累計服務 100 位客人。', cat: 'milestone', tier: 1, hidden: false, badge: '👥', goal: 100, metric: 'patientsTotal' },
  { id: 'm_pat_1000', name: '千人次', desc: '累計服務 1,000 位客人。', cat: 'milestone', tier: 2, hidden: false, badge: '👥', goal: 1000, metric: 'patientsTotal' },
  { id: 'm_pat_5000', name: '五千人次', desc: '累計服務 5,000 位客人。', cat: 'milestone', tier: 3, hidden: false, badge: '🌟', title: '在地萬人迷', goal: 5000, metric: 'patientsTotal' },
  { id: 'm_cured_100', name: '百位熟客', desc: '累計培養 100 位熟客。', cat: 'milestone', tier: 2, hidden: false, badge: '✋', title: '熟客製造機', reward: { pointKey: 'culinary' }, goal: 100, metric: 'cured' },
  { id: 'm_rep_100', name: '口碑起家', desc: '聲譽達到 100 以上。', cat: 'milestone', tier: 1, hidden: false, badge: '📣', goal: 100, metric: 'reputation' },
  { id: 'm_rep_250', name: '地方名店', desc: '聲譽達到 250 以上。', cat: 'milestone', tier: 2, hidden: false, badge: '📣', goal: 250, metric: 'reputation' },
  { id: 'm_rep_600', name: '全國有名', desc: '聲譽達到 600 以上。', cat: 'milestone', tier: 3, hidden: false, badge: '🎖️', title: '國民美食老闆', goal: 600, metric: 'reputation' },
  { id: 'm_lot1', name: '搬新家', desc: '擴建到「社區餐館」。', cat: 'milestone', tier: 1, hidden: false, badge: '🏠' },
  { id: 'm_lot2', name: '擴大營業', desc: '擴建到「地區人氣餐廳」。', cat: 'milestone', tier: 2, hidden: false, badge: '🏢' },
  { id: 'm_lot3', name: '旗艦餐廳', desc: '擴建到「全台旗艦餐廳」。', cat: 'milestone', tier: 3, hidden: false, badge: '🏙️', title: '連鎖餐飲創辦人' },
  { id: 'm_year3', name: '三週年', desc: '經營滿 3 年，順利進入第 4 年。', cat: 'milestone', tier: 2, hidden: false, badge: '🎂' },
  { id: 'm_five_roles', name: '五職齊備', desc: '同時聘有主廚、廚師、吧台師、外場服務生、櫃檯收銀。', cat: 'milestone', tier: 1, hidden: false, badge: '🧑‍🍳', reward: { pointKey: 'culinary' } },
  { id: 'm_research_all', name: '學無止境', desc: '完成全部研發節點。', cat: 'milestone', tier: 3, hidden: false, badge: '🔬', title: '研發怪咖老闆', goal: Object.keys(RESEARCH).length, metric: 'researchDone' },
  { id: 'm_upg_10', name: '精益求精', desc: '「持續精進」六條路線的等級總和達到 10 級。', cat: 'milestone', tier: 1, hidden: false, badge: '📈', goal: 10, metric: 'upgradeLevels' },
  { id: 'm_upg_40', name: '研究魂不滅', desc: '「持續精進」六條路線的等級總和達到 40 級。', cat: 'milestone', tier: 2, hidden: false, badge: '🔭', title: '終身學習老闆', goal: 40, metric: 'upgradeLevels' },
  { id: 'm_upg_cap', name: '登峰造極', desc: '任一條「持續精進」路線升到最高等級。', cat: 'milestone', tier: 3, hidden: false, badge: '🏔️', title: '登峰造極老闆' },

  // ---------- 台灣在地特色 taiwan ----------
  { id: 't_cold_week', name: '熱湯守護者', desc: '寒流週結束時，該週服務 15 位以上長輩客。', cat: 'taiwan', tier: 2, hidden: false, badge: '🧣', title: '熱湯守護者' },
  { id: 't_rain_safe', name: '風雨無阻', desc: '雨天週服務 12 位以上客人，且該週沒有人滑倒。', cat: 'taiwan', tier: 2, hidden: false, badge: '☔', reward: { pointKey: 'device' } },
  { id: 't_typhoon', name: '颱風天照常營業', desc: '颱風週服務 5 位以上客人。', cat: 'taiwan', tier: 1, hidden: false, badge: '🌀' },
  { id: 't_temple', name: '廟口好厝邊', desc: '完成一次「宮廟免費供餐」。', cat: 'taiwan', tier: 1, hidden: false, badge: '🛕', title: '廟口好厝邊', reward: { pointKey: 'culinary' } },
  { id: 't_community_all', name: '里民好厝邊', desc: '7 種社區活動各至少完成過 1 次。', cat: 'taiwan', tier: 2, hidden: false, badge: '🤝', goal: 7, metric: 'communityKinds' },
  { id: 't_audit', name: '稽查過關', desc: '首次通過衛生局年度稽查。', cat: 'taiwan', tier: 1, hidden: false, badge: '📋' },
  { id: 't_audit_excellent', name: '稽查優等', desc: '稽查分數達到「優等」等級。', cat: 'taiwan', tier: 2, hidden: false, badge: '⭐' },
  { id: 't_audit_3', name: '模範餐廳', desc: '連續 3 年通過稽查。', cat: 'taiwan', tier: 3, hidden: false, badge: '🏅', title: '稽查模範生' },
  { id: 't_dilemma_5', name: '溝通達人', desc: '處理過 5 次客人溝通情境。', cat: 'taiwan', tier: 1, hidden: false, badge: '💬', goal: 5, metric: 'dilemmasDone' },
  { id: 't_dilemma_all', name: '阿嬤說了算', desc: '四種客人溝通情境都處理過（要求加送、只點湯、過度推銷、客訴）。', cat: 'taiwan', tier: 2, hidden: false, badge: '👵', title: '溝通大師' },
  { id: 't_special_40', name: '特色轉型成功', desc: '單月特色料理收入佔餐點總收入 40% 以上。', cat: 'taiwan', tier: 2, hidden: false, badge: '💳' },
  { id: 't_board_3', name: '看板達人', desc: '同時啟用 3 個菜單看板。', cat: 'taiwan', tier: 1, hidden: false, badge: '🪧' },

  // ---------- 挑戰與隱藏 challenge ----------
  { id: 'c_zone_golden', name: '黃金爐火', desc: '啟動「黃金爐火區」。', cat: 'challenge', tier: 1, hidden: false, badge: '🥇', reward: { pointKey: 'device' } },
  { id: 'c_zone_premium', name: '高端餐飲', desc: '啟動「高端餐飲區」。', cat: 'challenge', tier: 1, hidden: false, badge: '☕' },
  { id: 'c_zone_kidpark', name: '放電樂園', desc: '啟動「親子放電樂園」。', cat: 'challenge', tier: 1, hidden: false, badge: '🎠', reward: { pointKey: 'culinary' } },
  { id: 'c_zone_all', name: '專區大滿貫', desc: '黃金爐火區、高端餐飲區、親子放電樂園同時啟動。', cat: 'challenge', tier: 2, hidden: false, badge: '🗺️', title: '專區規劃師' },
  { id: 'c_zone_collect', name: '專區收藏家', desc: '累計啟動過 6 種不同的專區（不必同時）。', cat: 'challenge', tier: 2, hidden: false, badge: '🗂️', reward: { pointKey: 'service' } },
  { id: 'c_zone_master', name: '專區大師', desc: '同時啟動 8 個以上的專區。', cat: 'challenge', tier: 3, hidden: false, badge: '🧭', title: '專區大師' },
  { id: 'c_zero_slip_year', name: '零滑倒一整年', desc: '一個完整年度（12 個月）內零人滑倒，且至少服務 200 位客人。', cat: 'challenge', tier: 3, hidden: false, badge: '🦶', title: '防滑達人' },
  { id: 'c_no_angry_month', name: '笑臉迎人', desc: '單月內沒有任何客人因滿意度低於 25 或等位超時而憤怒離開，且該月服務 20 人以上。', cat: 'challenge', tier: 2, hidden: false, badge: '😊' },
  { id: 'c_full_house', name: '門庭若市', desc: '擴建後，單週服務人數達到店面上限的 90% 以上。', cat: 'challenge', tier: 2, hidden: false, badge: '🈵' },
  { id: 'c_pure_menu', name: '純平價硬撐', desc: '第 1 年全程未賣出任何特色料理，且年底資金不低於起始資金。', cat: 'challenge', tier: 2, hidden: false, badge: '🧾', title: '平價硬漢' },
  { id: 'c_one_week_regular', name: '熟客大爆發', desc: '單週新增 10 位以上熟客。', cat: 'challenge', tier: 2, hidden: false, badge: '💊', reward: { pointKey: 'culinary' } },
  { id: 'h_coffee', name: '咖啡成癮', desc: '同時擁有 3 台咖啡機。', cat: 'challenge', tier: 1, hidden: true, hint: '店裡的咖啡香越來越濃了……', badge: '☕☕' },
  { id: 'h_chat', name: '聊天配飯吃', desc: '長輩與員工累計聊天 50 次。', cat: 'challenge', tier: 1, hidden: true, hint: '長輩的話匣子一開，就很難關起來。', badge: '🗣️', goal: 50, metric: 'chatCount' },
  { id: 'h_comeback', name: '絕處逢生', desc: '資金曾低於 NT$ 50,000，之後回升到 NT$ 1,000,000 以上。', cat: 'challenge', tier: 2, hidden: true, hint: '錢包見底不代表結束，看看有沒有翻身的機會。', badge: '🔥', title: '不死鳥院長' },
  { id: 'h_plants', name: '叢林餐廳', desc: '同時擺放 10 盆綠植。', cat: 'challenge', tier: 1, hidden: true, hint: '店裡的綠意越來越濃，快變成森林了？', badge: '🌿' },

  // ---------- 老闆生涯 career（docs/GOALS_AND_ENDING.md；3 個一般 + 每個結局 1 個隱藏，共 12）----------
  { id: 'm_decade', name: '十年老店', desc: '把餐廳經營滿 10 年（走到十年結局）。', cat: 'milestone', tier: 3, hidden: false, badge: '🏮', title: '十年老店老闆' },
  { id: 'c_grade_s', name: '年度 S', desc: '年度總結拿到 S 等級。', cat: 'challenge', tier: 3, hidden: false, badge: '🌟', title: '年度模範老闆' },
  { id: 'm_goals_20', name: '目標達人', desc: '累計達成 20 個年度目標。', cat: 'milestone', tier: 2, hidden: false, badge: '🎯', goal: 20, metric: 'goalsDone' },
  ...ENDINGS.map(e => ({
    id: e.achievementId || ('e_' + e.id), name: e.title, desc: `走到十年生涯的結局「${e.title}」。`, cat: 'challenge', tier: ENDING_TIERS[e.id] || 1, hidden: true,
    hint: '十年之後，這間店會留下什麼樣的故事？', badge: e.emoji,
  })),
];

// Per-tier defaults. Money scaled from the design's 15k/50k/200k to 10k/35k/150k after the 5-year balance check (S-E):
// total achievement money stays <= ~10% of cumulative net income across the bal.mjs policies.
// Per-tier defaults. Reward = money (NT$) + reputation + points (one point type, see reward.pointKey).
export const ACHIEVEMENT_TIERS = {
  1: { name: '銅', money: 10000, rep: 0, points: 8 },
  2: { name: '銀', money: 35000, rep: 3, points: 15 },
  3: { name: '金', money: 150000, rep: 10, points: 30 },
};

// Overall badge milestones shown on the shop sign (count = unlocked achievements).
export const BADGE_MILESTONES = [
  { count: 10, icon: '🥉', name: '銅牌餐廳' },
  { count: 20, icon: '🥈', name: '銀牌餐廳' },
  { count: 30, icon: '🥇', name: '金牌餐廳' },
  { count: 'all', icon: '🏆', name: '全成就餐廳' },
];

export const ACHIEVEMENT_CATS = [
  { id: 'milestone', name: '經營里程碑' },
  { id: 'taiwan', name: '台灣在地特色' },
  { id: 'challenge', name: '挑戰與隱藏' },
];

// Max achievement badges a player can mount on the shop sign.
export const MAX_BADGES = 3;
