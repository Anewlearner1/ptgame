// Treatment definitions (static data). Shape: ARCHITECTURE §3.1.
// nhiPoints is 0 for self-pay treatments and price is 0 for NHI treatments.
// ALL fee numbers come from data/fees.js (real Taiwan data, see its REAL DATA header): nhiPoints = listed NHI points per claim
// (what is actually paid also depends on the single-claim rule and the daily exam-fee tiers, economy.nhiClaim);
// uptake (self-pay only, default 1) = relative share of willing patients who actually take the item at its typical price: an ABSTRACTION knob, not real data
// (big-ticket items such as PRP convert far less often than a NT$2,000 shockwave).
// price = real NT$ per self-pay session (typical market quote), BEFORE the player's slider and the PATIENT_WEIGHT multiplier.
import { TREATMENT_FEES } from './fees.js';
const nhi = (id) => (TREATMENT_FEES[id].kind === 'nhi' ? TREATMENT_FEES[id].nhiPoints : 0);
const price = (id) => (TREATMENT_FEES[id].kind === 'self' ? TREATMENT_FEES[id].selfPrice.typical : 0);
// objects: patient must stand next to one of these (ANY-of). staffRole: ANY-of roles, null = self-service.

export const TREATMENTS = {
  exam: {
    id: 'exam', name: '門診看診', kind: 'nhi',
    objects: ['exam_room'], staffRole: ['doctor'],
    duration: 40, nhiPoints: nhi('exam'), price: price('exam'),
    points: { medical: 2, device: 0, service: 1 },
    staminaCost: 4, requires: null, cure: 0.1,
    intro: '醫師評估病況、開立復健處方的第一步。',
  },
  us: {
    id: 'us', name: '超音波檢查', kind: 'nhi',
    objects: ['us_room'], staffRole: ['doctor'],
    duration: 30, nhiPoints: nhi('us'), price: price('us'),
    points: { medical: 1, device: 2, service: 0 },
    staminaCost: 4, requires: 'rs_ultrasound', cure: 0.15,
    intro: '用超音波看清肌腱與軟組織，診斷更有把握。',
  },
  heat: {
    id: 'heat', name: '熱敷', kind: 'nhi',
    objects: ['heatbox'], staffRole: null,
    duration: 45, nhiPoints: nhi('heat'), price: price('heat'),
    points: { medical: 0, device: 1, service: 0 },
    staminaCost: 0, requires: null, cure: 0.1,
    intro: '溫熱敷紓解肌肉緊繃，長輩最愛的基本款。',
  },
  tens: {
    id: 'tens', name: '電療（干擾波/TENS）', kind: 'nhi',
    objects: ['tens'], staffRole: null,
    duration: 45, nhiPoints: nhi('tens'), price: price('tens'),
    points: { medical: 0, device: 1, service: 0 },
    staminaCost: 0, requires: null, cure: 0.12,
    intro: '微電流刺激深層組織，自助式操作、不佔人力。',
  },
  traction: {
    id: 'traction', name: '頸腰椎牽引', kind: 'nhi',
    objects: ['traction'], staffRole: null,
    duration: 50, nhiPoints: nhi('traction'), price: price('traction'),
    points: { medical: 0, device: 1, service: 0 },
    staminaCost: 0, requires: null, cure: 0.15,
    intro: '機器拉開椎間壓力，緩解頸腰痠痛。',
  },
  ir: {
    id: 'ir', name: '紅外線照射', kind: 'nhi',
    objects: ['ir_lamp'], staffRole: null,
    duration: 35, nhiPoints: nhi('ir'), price: price('ir'),
    points: { medical: 0, device: 1, service: 0 },
    staminaCost: 0, requires: null, cure: 0.1,
    intro: '紅外線燈照射局部，讓血液循環變好一點。',
  },
  taping: {
    id: 'taping', name: '肌內效貼紮', kind: 'nhi',
    objects: ['bed'], staffRole: ['pt'],
    duration: 30, nhiPoints: nhi('taping'), price: price('taping'),
    points: { medical: 1, device: 0, service: 1 },
    staminaCost: 3, requires: null, cure: 0.2,
    intro: '治療師沿肌肉走向貼上彈性貼布，支撐又不妨礙活動。',
  },
  manual_nhi: {
    id: 'manual_nhi', name: '健保徒手治療', kind: 'nhi',
    objects: ['bed'], staffRole: ['pt'],
    duration: 45, nhiPoints: nhi('manual_nhi'), price: price('manual_nhi'),
    points: { medical: 2, device: 0, service: 1 },
    staminaCost: 12, requires: null, cure: 0.3,
    intro: '治療師用雙手鬆解關節與軟組織，體力消耗大。',
  },
  redcord: {
    id: 'redcord', name: '懸吊運動治療', kind: 'self',
    objects: ['redcord'], staffRole: ['pt'],
    duration: 60, nhiPoints: nhi('redcord'), price: price('redcord'),
    points: { medical: 1, device: 1, service: 1 },
    staminaCost: 5, requires: 'rs_redcord', cure: 0.25,
    uptake: 0.8,
    intro: '繩索懸吊做全身性動作訓練，運動員與上班族都愛。',
  },
  shockwave: {
    id: 'shockwave', name: '體外震波', kind: 'self',
    objects: ['shockwave', 'shockwave_room'], staffRole: ['doctor', 'pt'],
    duration: 45, nhiPoints: nhi('shockwave'), price: price('shockwave'),
    points: { medical: 1, device: 3, service: 0 },
    staminaCost: 4, requires: 'rs_shockwave', cure: 0.3,
    intro: '高能量聲波打在痠痛的肌腱上，效果看得見。',
  },
  laser: {
    id: 'laser', name: '高能量雷射', kind: 'self',
    objects: ['laser_room'], staffRole: ['pt', 'doctor'],
    duration: 40, nhiPoints: nhi('laser'), price: price('laser'),
    points: { medical: 1, device: 3, service: 0 },
    staminaCost: 4, requires: 'rs_laser', cure: 0.28,
    intro: '光能深入組織促進修復，療程短、價格高。',
  },
  manual_self: {
    id: 'manual_self', name: '自費徒手治療', kind: 'self',
    objects: ['manual_room'], staffRole: ['pt'],
    duration: 60, nhiPoints: nhi('manual_self'), price: price('manual_self'),
    points: { medical: 2, device: 0, service: 1 },
    staminaCost: 14, requires: 'rs_manual', cure: 0.3,
    intro: '獨立診間裡一對一的徒手療程，時間充裕、手勁到位。',
  },
  prp: {
    id: 'prp', name: 'PRP 增生療法', kind: 'self',
    objects: ['exam_room'], staffRole: ['doctor'],
    duration: 60, nhiPoints: nhi('prp'), price: price('prp'),
    points: { medical: 3, device: 0, service: 1 },
    staminaCost: 6, requires: 'rs_prp', cure: 0.35,
    uptake: 0.25,
    intro: '抽取自體血小板濃縮液注射，適合慢性肌腱病變。',
  },
  insole: {
    id: 'insole', name: '客製化鞋墊', kind: 'self',
    objects: ['bed'], staffRole: ['pt'],
    duration: 45, nhiPoints: nhi('insole'), price: price('insole'),
    points: { medical: 1, device: 2, service: 1 },
    staminaCost: 5, requires: 'rs_insole', cure: 0.2,
    uptake: 0.5,
    intro: '步態掃描後量身製作鞋墊，從腳底改善膝腰負擔。',
  },
  si: {
    id: 'si', name: '感覺統合訓練', kind: 'nhi',
    objects: ['si_room'], staffRole: ['ot'],
    duration: 90, nhiPoints: nhi('si'), price: price('si'),
    points: { medical: 3, device: 0, service: 2 },
    staminaCost: 12, requires: 'rs_ot', cure: 0.35,
    intro: '球池、平衡木與滑板，陪孩子把身體感覺慢慢整合起來。',
  },
  fine: {
    id: 'fine', name: '精細動作訓練', kind: 'nhi',
    objects: ['fine_table'], staffRole: ['ot'],
    duration: 60, nhiPoints: nhi('fine'), price: price('fine'),
    points: { medical: 3, device: 0, service: 2 },
    staminaCost: 6, requires: 'rs_ot', cure: 0.3,
    intro: '串珠、夾取與寫字前練習，把手指的小肌肉練起來。',
  },
  speech: {
    id: 'speech', name: '語言治療', kind: 'nhi',
    objects: ['speech_room'], staffRole: ['st'],
    duration: 60, nhiPoints: nhi('speech'), price: price('speech'),
    points: { medical: 3, device: 0, service: 2 },
    staminaCost: 5, requires: 'rs_st', cure: 0.3,
    intro: '發音、口語與溝通練習，陪孩子開口說話。',
  },
};
