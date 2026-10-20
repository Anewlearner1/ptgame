// Achievement definitions (docs/ACHIEVEMENTS.md §4 / §5.1). All 繁體中文 (台灣口吻).
//
// Fields:
//   id, name, desc (條件), cat: 'milestone'|'taiwan'|'challenge', tier: 1|2|3 (銅/銀/金)
//   hidden: 未解鎖時顯示「？？？」＋ hint；解鎖後才顯示全文
//   badge: 徽章 emoji
//   title: 解鎖後可配戴的特殊稱號（≤ 10 字）
//   reward: 只在覆寫階層預設時才寫。pointKey = 點數種類（medical|device|service），
//           銅／銀預設 service，金一律 service。點數量見 ACHIEVEMENT_TIERS[tier].points。
//   goal / metric: 累計類成就的進度條目標與來源（無則只顯示已／未解鎖）。

import { RESEARCH } from './research.js';

export const ACHIEVEMENTS = [
  // ---------- 經營里程碑 milestone ----------
  { id: 'm_first_month', name: '開張大吉', desc: '完成第一次月底健保結算。', cat: 'milestone', tier: 1, hidden: false, badge: '🎉' },
  { id: 'm_cash_2m', name: '第一桶金', desc: '資金累積到 NT$ 2,000,000 以上。', cat: 'milestone', tier: 1, hidden: false, badge: '💰', goal: 2000000, metric: 'money' },
  { id: 'm_cash_10m', name: '千萬院長', desc: '資金累積到 NT$ 10,000,000 以上。', cat: 'milestone', tier: 3, hidden: false, badge: '💎', title: '千萬院長', goal: 10000000, metric: 'money' },
  { id: 'm_pat_100', name: '百人次', desc: '累計服務 100 位病患。', cat: 'milestone', tier: 1, hidden: false, badge: '👥', goal: 100, metric: 'patientsTotal' },
  { id: 'm_pat_1000', name: '千人次', desc: '累計服務 1,000 位病患。', cat: 'milestone', tier: 2, hidden: false, badge: '👥', goal: 1000, metric: 'patientsTotal' },
  { id: 'm_pat_5000', name: '五千人次', desc: '累計服務 5,000 位病患。', cat: 'milestone', tier: 3, hidden: false, badge: '🌟', title: '在地萬人迷', goal: 5000, metric: 'patientsTotal' },
  { id: 'm_cured_100', name: '妙手回春', desc: '累計治癒 100 位病患。', cat: 'milestone', tier: 2, hidden: false, badge: '✋', title: '妙手回春', reward: { pointKey: 'medical' }, goal: 100, metric: 'cured' },
  { id: 'm_rep_100', name: '口碑起家', desc: '聲譽達到 100 以上。', cat: 'milestone', tier: 1, hidden: false, badge: '📣', goal: 100, metric: 'reputation' },
  { id: 'm_rep_250', name: '地方名醫', desc: '聲譽達到 250 以上。', cat: 'milestone', tier: 2, hidden: false, badge: '📣', goal: 250, metric: 'reputation' },
  { id: 'm_rep_600', name: '全國有名', desc: '聲譽達到 600 以上。', cat: 'milestone', tier: 3, hidden: false, badge: '🎖️', title: '國民復健名醫', goal: 600, metric: 'reputation' },
  { id: 'm_lot1', name: '搬新家', desc: '擴建到「社區診所」。', cat: 'milestone', tier: 1, hidden: false, badge: '🏠' },
  { id: 'm_lot2', name: '擴大營業', desc: '擴建到「地區復健中心」。', cat: 'milestone', tier: 2, hidden: false, badge: '🏢' },
  { id: 'm_lot3', name: '頂尖中心', desc: '擴建到「全台頂尖復健中心」。', cat: 'milestone', tier: 3, hidden: false, badge: '🏙️', title: '復健中心創辦人' },
  { id: 'm_year3', name: '三週年', desc: '經營滿 3 年，順利進入第 4 年。', cat: 'milestone', tier: 2, hidden: false, badge: '🎂' },
  { id: 'm_five_roles', name: '五職齊備', desc: '同時聘有醫師、PT、OT、ST、護理師。', cat: 'milestone', tier: 1, hidden: false, badge: '🧑‍⚕️', reward: { pointKey: 'medical' } },
  { id: 'm_research_all', name: '學無止境', desc: '完成全部研發節點。', cat: 'milestone', tier: 3, hidden: false, badge: '🔬', title: '研發怪咖院長', goal: Object.keys(RESEARCH).length, metric: 'researchDone' },

  // ---------- 台灣在地特色 taiwan ----------
  { id: 't_cold_week', name: '寒流守護者', desc: '寒流週結束時，該週服務 15 位以上長輩。', cat: 'taiwan', tier: 2, hidden: false, badge: '🧣', title: '寒流守護者' },
  { id: 't_rain_safe', name: '風雨無阻', desc: '雨天週服務 12 位以上病患，且該週沒有人滑倒。', cat: 'taiwan', tier: 2, hidden: false, badge: '☔', reward: { pointKey: 'device' } },
  { id: 't_typhoon', name: '颱風天照常營業', desc: '颱風週服務 5 位以上病患。', cat: 'taiwan', tier: 1, hidden: false, badge: '🌀' },
  { id: 't_temple', name: '廟口肌少症剋星', desc: '完成一次「宮廟肌少症篩檢」。', cat: 'taiwan', tier: 1, hidden: false, badge: '🛕', title: '廟口肌少症剋星', reward: { pointKey: 'medical' } },
  { id: 't_community_all', name: '里民好厝邊', desc: '7 種社區活動各至少完成過 1 次。', cat: 'taiwan', tier: 2, hidden: false, badge: '🤝', goal: 7, metric: 'communityKinds' },
  { id: 't_audit', name: '督導過關', desc: '首次通過衛生局督導或健保署抽查。', cat: 'taiwan', tier: 1, hidden: false, badge: '📋' },
  { id: 't_audit_excellent', name: '督導優等', desc: '評鑑分數達到「優等」等級。', cat: 'taiwan', tier: 2, hidden: false, badge: '⭐' },
  { id: 't_audit_3', name: '模範診所', desc: '連續 3 年通過評鑑。', cat: 'taiwan', tier: 3, hidden: false, badge: '🏅', title: '評鑑模範生' },
  { id: 't_dilemma_5', name: '溝通達人', desc: '處理過 5 次醫病溝通情境。', cat: 'taiwan', tier: 1, hidden: false, badge: '💬', goal: 5, metric: 'dilemmasDone' },
  { id: 't_dilemma_all', name: '阿嬤說了算', desc: '四種醫病溝通情境都處理過（止痛藥、只做電療、過度治療、客訴）。', cat: 'taiwan', tier: 2, hidden: false, badge: '👵', title: '溝通大師' },
  { id: 't_selfpay_40', name: '自費轉型成功', desc: '單月自費收入佔總收入 40% 以上。', cat: 'taiwan', tier: 2, hidden: false, badge: '💳' },
  { id: 't_board_3', name: '衛教達人', desc: '同時啟用 3 個衛教看板。', cat: 'taiwan', tier: 1, hidden: false, badge: '🪧' },

  // ---------- 挑戰與隱藏 challenge ----------
  { id: 'c_zone_golden', name: '黃金三寶', desc: '啟動「黃金三寶區」。', cat: 'challenge', tier: 1, hidden: false, badge: '🥇', reward: { pointKey: 'device' } },
  { id: 'c_zone_premium', name: '高階自費', desc: '啟動「高階自費專區」。', cat: 'challenge', tier: 1, hidden: false, badge: '☕' },
  { id: 'c_zone_kidpark', name: '放電樂園', desc: '啟動「早療放電樂園」。', cat: 'challenge', tier: 1, hidden: false, badge: '🎠', reward: { pointKey: 'medical' } },
  { id: 'c_zone_all', name: '專區大滿貫', desc: '黃金三寶區、高階自費專區、早療放電樂園同時啟動。', cat: 'challenge', tier: 2, hidden: false, badge: '🗺️', title: '專區規劃師' },
  { id: 'c_zero_slip_year', name: '零滑倒一整年', desc: '一個完整年度（12 個月）內零人滑倒，且至少服務 200 位病患。', cat: 'challenge', tier: 3, hidden: false, badge: '🦶', title: '防滑達人' },
  { id: 'c_no_angry_month', name: '笑臉迎人', desc: '單月內沒有任何病患因滿意度低於 25 或候診超時而憤怒離開，且該月服務 20 人以上。', cat: 'challenge', tier: 2, hidden: false, badge: '😊' },
  { id: 'c_full_house', name: '門庭若市', desc: '擴建後，單週服務人數達到店面上限的 90% 以上。', cat: 'challenge', tier: 2, hidden: false, badge: '🈵' },
  { id: 'c_pure_nhi', name: '純健保硬撐', desc: '第 1 年全程未收取任何自費治療費，且年底資金不低於起始資金。', cat: 'challenge', tier: 2, hidden: false, badge: '🧾', title: '純健保硬漢' },
  { id: 'c_one_week_cure', name: '神醫降臨', desc: '單週治癒 10 位以上病患。', cat: 'challenge', tier: 2, hidden: false, badge: '💊', reward: { pointKey: 'medical' } },
  { id: 'h_coffee', name: '咖啡成癮', desc: '同時擁有 3 台咖啡機。', cat: 'challenge', tier: 1, hidden: true, hint: '診所裡的咖啡香越來越濃了……', badge: '☕☕' },
  { id: 'h_chat', name: '聊天治百病', desc: '長輩與治療師累計聊天 50 次。', cat: 'challenge', tier: 1, hidden: true, hint: '長輩的話匣子一開，就很難關起來。', badge: '🗣️', goal: 50, metric: 'chatCount' },
  { id: 'h_comeback', name: '絕處逢生', desc: '資金曾低於 NT$ 50,000，之後回升到 NT$ 1,000,000 以上。', cat: 'challenge', tier: 2, hidden: true, hint: '錢包見底不代表結束，看看有沒有翻身的機會。', badge: '🔥', title: '不死鳥院長' },
  { id: 'h_plants', name: '叢林診所', desc: '同時擺放 10 盆綠植。', cat: 'challenge', tier: 1, hidden: true, hint: '診所裡的綠意越來越濃，快變成森林了？', badge: '🌿' },
];

// Per-tier defaults. Money scaled from the design's 15k/50k/200k to 10k/35k/150k after the 5-year balance check (S-E):
// total achievement money stays <= ~10% of cumulative net income across the bal.mjs policies.
// Per-tier defaults. Reward = money (NT$) + reputation + points (one point type, see reward.pointKey).
export const ACHIEVEMENT_TIERS = {
  1: { name: '銅', money: 10000, rep: 0, points: 8 },
  2: { name: '銀', money: 35000, rep: 3, points: 15 },
  3: { name: '金', money: 150000, rep: 10, points: 30 },
};

// Overall badge milestones shown on the clinic sign (count = unlocked achievements).
export const BADGE_MILESTONES = [
  { count: 10, icon: '🥉', name: '銅牌診所' },
  { count: 20, icon: '🥈', name: '銀牌診所' },
  { count: 30, icon: '🥇', name: '金牌診所' },
  { count: 'all', icon: '🏆', name: '全成就診所' },
];

export const ACHIEVEMENT_CATS = [
  { id: 'milestone', name: '經營里程碑' },
  { id: 'taiwan', name: '台灣在地特色' },
  { id: 'challenge', name: '挑戰與隱藏' },
];

// Max achievement badges a player can mount on the clinic sign.
export const MAX_BADGES = 3;
