// Staff role templates, name pool and traits (static data). Shape: ARCHITECTURE §3.1.
import { ROLE_LABELS } from '../core/constants.js';

// baseSalary / hireCost in NT$ (monthly salary; hireCost ~ one month).
export const STAFF_ROLES = {
  doctor: {
    name: ROLE_LABELS.doctor, baseSalary: 150000, hireCost: 150000,
    color: '#f4f7fa', skillRange: [3, 8], staminaMax: 100,
    desc: '負責看診、開處方，也是超音波與高階自費療程的主力。',
  },
  pt: {
    name: ROLE_LABELS.pt, baseSalary: 62000, hireCost: 62000,
    color: '#3a7bd5', skillRange: [3, 8], staminaMax: 100,
    desc: '負責徒手、貼紮、懸吊與震波等療程，是診所的體力核心。',
  },
  ot: {
    name: ROLE_LABELS.ot, baseSalary: 62000, hireCost: 62000,
    color: '#3fa66b', skillRange: [3, 8], staminaMax: 100,
    desc: '負責感覺統合與精細動作訓練，兒童早療必備。',
  },
  st: {
    name: ROLE_LABELS.st, baseSalary: 62000, hireCost: 62000,
    color: '#8e5bc4', skillRange: [3, 8], staminaMax: 100,
    desc: '負責語言與吞嚥相關治療，兒童與術後患者都會用到。',
  },
  nurse: {
    name: ROLE_LABELS.nurse, baseSalary: 38000, hireCost: 38000,
    color: '#e87fae', skillRange: [3, 8], staminaMax: 100,
    desc: '負責掛號、報到與櫃檯行政，讓患者少等一點。',
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
  { id: 'kind', name: '親切', desc: '病人都覺得被溫柔對待，魅力提升。', mods: { charm: 2 } },
  { id: 'careful', name: '細心', desc: '動作一絲不苟，技術穩定提升。', mods: { skill: 1 } },
  { id: 'strong', name: '體力好', desc: '連續上班也不太喊累。', mods: { staminaMax: 20 } },
  { id: 'scholar', name: '研究魂', desc: '愛看論文、手法精進，但比較耗神。', mods: { skill: 2, staminaMax: -10 } },
  { id: 'talker', name: '話匣子', desc: '聊天很有梗，病人容易放鬆，體力略差。', mods: { charm: 2, staminaMax: -10 } },
  { id: 'rookie', name: '新手上路', desc: '剛出社會，技術還在磨合，但很有親和力。', mods: { skill: -1, charm: 1 } },
  { id: 'veteran', name: '老江湖', desc: '見多識廣，手感老練，耐操。', mods: { skill: 1, staminaMax: 10 } },
  { id: 'warm', name: '熱心助人', desc: '願意多花時間，大家都喜歡。', mods: { charm: 1, staminaMax: 10 } },
  { id: 'humor', name: '幽默風趣', desc: '一句笑話就能化解等候的不耐煩。', mods: { charm: 3 } },
  { id: 'backache', name: '腰痠背痛', desc: '自己也有職業病，體力打折扣。', mods: { staminaMax: -15 } },
];
