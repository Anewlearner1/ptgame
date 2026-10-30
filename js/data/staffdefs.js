// Staff role templates, name pool and traits (static data). See docs/RESTAURANT_DESIGN.md §2.
import { ROLE_LABELS } from '../core/constants.js';

// baseSalary / hireCost in NT$ (monthly salary; hireCost ~ one month).
export const STAFF_ROLES = {
  chef: {
    name: ROLE_LABELS.chef, baseSalary: 65000, hireCost: 65000,
    color: '#f4f7fa', skillRange: [3, 8], staminaMax: 100,
    desc: '負責招牌主餐、鐵板與主廚特餐，是店裡口味與高單價料理的靈魂。',
  },
  cook: {
    name: ROLE_LABELS.cook, baseSalary: 42000, hireCost: 42000,
    color: '#e87a3a', skillRange: [3, 8], staminaMax: 100,
    desc: '負責煮麵、炸物、熱炒與燒烤，是廚房的體力核心。',
  },
  barista: {
    name: ROLE_LABELS.barista, baseSalary: 38000, hireCost: 38000,
    color: '#3fa66b', skillRange: [3, 8], staminaMax: 100,
    desc: '負責飲料、冰品、甜點與吧台，下午茶與宵夜時段不可或缺。',
  },
  server: {
    name: ROLE_LABELS.server, baseSalary: 32000, hireCost: 32000,
    color: '#8e5bc4', skillRange: [3, 8], staminaMax: 100,
    desc: '負責帶位、上菜、小菜與湯品，餐桌翻得快不快就看外場。',
  },
  cashier: {
    name: ROLE_LABELS.cashier, baseSalary: 30000, hireCost: 30000,
    color: '#e87fae', skillRange: [3, 8], staminaMax: 100,
    desc: '負責點餐結帳，也能順手開滷肉鍋、湯鍋與飲料機，讓客人少等一點。',
  },
};

export const STAFF_NAMES = {
  surnames: [
    '陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊',
    '許', '鄭', '謝', '郭', '洪', '曾', '邱', '廖', '賴', '徐',
    '周', '葉', '蘇', '莊', '呂',
  ],
  given: [
    '冠宇', '家豪', '志明', '怡君', '雅婷', '承翰', '宗翰', '淑芬', '美玲', '建宏',
    '佳穎', '仲瑋', '欣怡', '柏翰', '郁婷', '庭瑋', '威廷', '芷晴', '子瑜', '俊傑',
    '思妤', '哲維', '雅涵', '宜蓁', '奕辰', '佩珊', '彥廷', '慧君', '柏宇', '詩涵',
    '志豪', '怡萱', '冠廷', '宜庭', '語彤', '國華', '惠珍', '品妤', '承恩', '芸瑄',
    '凱翔', '昱廷', '靜宜', '佑安', '宇安', '品璇', '天佑', '子晴', '姿穎', '雨辰',
  ],
};

// Traits: mods are added to the staff's base skill / charm / staminaMax.
export const TRAITS = [
  { id: 'kind', name: '親切', desc: '客人都覺得被溫柔對待，魅力提升。', mods: { charm: 2 } },
  { id: 'careful', name: '細心', desc: '擺盤與火候一絲不苟，技術穩定提升。', mods: { skill: 1 } },
  { id: 'strong', name: '體力好', desc: '連續站一整天也不太喊累。', mods: { staminaMax: 20 } },
  { id: 'scholar', name: '研究魂', desc: '愛研究食譜與新菜色，但比較耗神。', mods: { skill: 2, staminaMax: -10 } },
  { id: 'talker', name: '話匣子', desc: '跟熟客聊天很有梗，客人容易放鬆，體力略差。', mods: { charm: 2, staminaMax: -10 } },
  { id: 'rookie', name: '新手上路', desc: '剛入行，手藝還在磨合，但很有親和力。', mods: { skill: -1, charm: 1 } },
  { id: 'veteran', name: '老江湖', desc: '做過夜市也開過店，手感老練，耐操。', mods: { skill: 1, staminaMax: 10 } },
  { id: 'warm', name: '熱心助人', desc: '願意多幫一把，大家都喜歡。', mods: { charm: 1, staminaMax: 10 } },
  { id: 'humor', name: '幽默風趣', desc: '一句笑話就能化解等位的不耐煩。', mods: { charm: 3 } },
  { id: 'backache', name: '腰痠背痛', desc: '站久了職業病，體力打折扣。', mods: { staminaMax: -15 } },
];
