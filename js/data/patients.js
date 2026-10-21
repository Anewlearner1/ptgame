// Patient archetypes and clinic focus policies (static data). Shape: ARCHITECTURE §3.1.
// Spawn windows are minutes since midnight (480 = 08:00, 1200 = 20:00).
// plan.steps run in order; selfPaySteps are upsell steps (only if unlocked and built).
// cureNeeded is reached over one or more visits (see visitsToCure).

export const PATIENT_TYPES = {
  elder: {
    id: 'elder', name: '晨間長輩團',
    desc: '住附近的長輩，早上結伴來做熱敷與電療，順便找治療師聊天。',
    weight: 1.2,
    spawn: [
      { from: 480, to: 600, w: 1.2 },
      { from: 600, to: 720, w: 1.0 },
    ],
    speed: 0.6,
    patience: 70,
    needsRamp: true,
    slipProne: 1.6,
    selfPay: 0.07,
    chatty: 0.7,
    plans: [
      { w: 3, steps: ['exam', 'heat', 'tens'], selfPaySteps: ['insole', 'manual_self', 'shockwave'] },
      { w: 2, steps: ['heat', 'traction', 'tens'], selfPaySteps: ['insole', 'manual_self'] },
      { w: 2, steps: ['exam', 'traction', 'heat'], selfPaySteps: ['insole', 'prp', 'shockwave'] },
      { w: 1, steps: ['exam', 'ir', 'heat'], selfPaySteps: ['insole', 'manual_self'] },
    ],
    cureNeeded: 0.6,
    visitsToCure: [3, 6],
    palette: { skin: '#f1c9a5', hair: '#c9c9c9', shirt: '#b7d7c4', pants: '#4b5d6b' },
    reputationGain: 3,
    pointBias: { medical: 1.0, device: 1.2, service: 1.2 },
    needsDoctorSkip: 0.5,
  },

  office: {
    id: 'office', name: '肩頸僵硬上班族',
    desc: '午休或下班後來的上班族，肩頸痠痛、沒什麼耐心，最愛順便加購自費療程。',
    weight: 1.0,
    spawn: [
      { from: 720, to: 840, w: 1.0 },
      { from: 1050, to: 1200, w: 1.4 },
    ],
    speed: 1.0,
    patience: 40,
    needsRamp: false,
    slipProne: 0.8,
    selfPay: 0.18,
    chatty: 0.3,
    plans: [
      { w: 3, steps: ['exam', 'tens', 'heat'], selfPaySteps: ['manual_self', 'shockwave', 'laser'] },
      { w: 2, steps: ['exam', 'taping', 'tens'], selfPaySteps: ['shockwave', 'laser', 'prp'] },
      { w: 2, steps: ['exam', 'traction', 'heat'], selfPaySteps: ['shockwave', 'manual_self', 'insole'] },
      { w: 1, steps: ['us', 'tens'], selfPaySteps: ['laser', 'shockwave', 'prp'] },
    ],
    cureNeeded: 0.7,
    visitsToCure: [2, 4],
    palette: { skin: '#f6d2b0', hair: '#2b2b33', shirt: '#f2f2f2', pants: '#3c3f58' },
    reputationGain: 4,
    pointBias: { medical: 1.0, device: 1.1, service: 0.9 },
    needsDoctorSkip: 0.15,
  },

  sports: {
    id: 'sports', name: '運動傷害病患',
    desc: '下班後的跑者與球友，傷勢急、目標明確，治好了會替診所帶來好口碑。',
    weight: 0.7,
    spawn: [
      { from: 840, to: 1080, w: 1.0 },
      { from: 1080, to: 1200, w: 1.3 },
    ],
    speed: 1.1,
    patience: 55,
    needsRamp: false,
    slipProne: 0.6,
    selfPay: 0.16,
    chatty: 0.4,
    plans: [
      { w: 3, steps: ['exam', 'taping', 'manual_nhi'], selfPaySteps: ['redcord', 'laser', 'insole'] },
      { w: 2, steps: ['exam', 'taping'], selfPaySteps: ['redcord', 'shockwave', 'laser'] },
      { w: 2, steps: ['exam', 'manual_nhi', 'tens'], selfPaySteps: ['shockwave', 'redcord', 'prp'] },
      { w: 1, steps: ['exam', 'shockwave', 'redcord'], selfPaySteps: ['laser', 'manual_self'] },
    ],
    cureNeeded: 0.9,
    visitsToCure: [2, 5],
    palette: { skin: '#e0b48a', hair: '#3a2a1e', shirt: '#ff7a3d', pants: '#222831' },
    reputationGain: 8,
    pointBias: { medical: 1.1, device: 1.3, service: 0.8 },
    needsDoctorSkip: 0.1,
  },

  kid: {
    id: 'kid', name: '早療兒童與家長',
    desc: '放學後由家長帶來的孩子，需要職能、語言與感統訓練，家長很重視服務品質。',
    weight: 0.5,
    spawn: [
      { from: 840, to: 960, w: 1.0 },
      { from: 960, to: 1080, w: 1.3 },
    ],
    speed: 1.2,
    patience: 55,
    needsRamp: false,
    slipProne: 1.0,
    selfPay: 0.07,
    chatty: 0.4,
    plans: [
      { w: 3, steps: ['exam', 'si', 'speech'] },
      { w: 2, steps: ['exam', 'fine', 'speech'] },
      { w: 2, steps: ['exam', 'si', 'fine'], selfPaySteps: ['insole'] },
      { w: 1, steps: ['exam', 'speech', 'fine'] },
    ],
    cureNeeded: 0.8,
    visitsToCure: [8, 16],
    palette: { skin: '#f3c7a1', hair: '#5a3825', shirt: '#ffd166', pants: '#118ab2' },
    reputationGain: 4,
    pointBias: { medical: 1.4, device: 0.6, service: 1.4 },
    needsDoctorSkip: 0.05,
  },
};

// Clinic focus policies. spawnMult scales each patient type's arrival weight.
export const FOCUS = {
  ortho: {
    name: '骨科導向',
    desc: '主打運動與肌肉骨骼傷害，吸引上班族與運動族群，長輩比較少。',
    spawnMult: { elder: 0.9, office: 1.3, sports: 1.4, kid: 0.7 },
  },
  ltc: {
    name: '長照導向',
    desc: '專攻社區長輩，熱敷、電療、牽引的客源滾滾而來，但上班族與運動族變少。',
    spawnMult: { elder: 1.6, office: 0.8, sports: 0.7, kid: 0.8 },
  },
  peds: {
    name: '早療導向',
    desc: '深耕兒童早期療育，家長與孩子大量湧入，職能與語言治療需求大增。',
    spawnMult: { elder: 0.8, office: 0.8, sports: 0.8, kid: 1.8 },
  },
};
