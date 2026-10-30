// Guest archetypes and shop focus policies (static data; the engine still calls guests "patients"). See docs/RESTAURANT_DESIGN.md §3.
// Spawn windows are minutes since midnight (480 = 08:00, 1200 = 20:00).
// plan.steps run in order (dishes, then 'dine' at a table); selfPaySteps are upsell steps (特色料理; only if unlocked and built).
// cureNeeded is reached over one or more visits (see visitsToCure): reaching it makes the guest a 熟客 ("cured").
// selfPay = base willingness to add a special dish (加點意願).

export const PATIENT_TYPES = {
  elder: {
    id: 'elder', name: '晨間長輩客',
    desc: '住附近的長輩，早上結伴來吃早餐，一碗湯、一份小菜，順便找老闆聊天。',
    weight: 1.2,
    spawn: [
      { from: 480, to: 600, w: 1.2 },
      { from: 600, to: 690, w: 0.8 },
    ],
    speed: 0.6,
    patience: 70,
    needsRamp: true,
    slipProne: 1.6,
    selfPay: 0.2,
    chatty: 0.7,
    plans: [
      { w: 3, steps: ['rice', 'soup', 'dine'], selfPaySteps: ['dessert', 'seafood'] },
      { w: 2, steps: ['noodle', 'side', 'dine'], selfPaySteps: ['dessert', 'seafood'] },
      { w: 2, steps: ['main', 'soup', 'dine'], selfPaySteps: ['dessert', 'hotpot'] },
      { w: 1, steps: ['dumpling', 'soup', 'dine'], selfPaySteps: ['dessert'] },
    ],
    cureNeeded: 0.6,
    visitsToCure: [3, 6],
    palette: { skin: '#f1c9a5', hair: '#c9c9c9', shirt: '#b7d7c4', pants: '#4b5d6b' },
    reputationGain: 3,
    pointBias: { culinary: 1.0, device: 1.2, service: 1.2 },
    skipMain: 0.5,
  },

  office: {
    id: 'office', name: '上班族午餐客',
    desc: '午休與下班後的上班族，只有一小時、沒什麼耐心，但最愛順手加點飲料甜點。',
    weight: 1.0,
    spawn: [
      { from: 690, to: 810, w: 1.4 },
      { from: 1050, to: 1200, w: 1.0 },
    ],
    speed: 1.0,
    patience: 40,
    needsRamp: false,
    slipProne: 0.8,
    selfPay: 0.45,
    chatty: 0.3,
    plans: [
      { w: 3, steps: ['main', 'drink', 'dine'], selfPaySteps: ['dessert', 'steak', 'beer'] },
      { w: 2, steps: ['noodle', 'side', 'dine'], selfPaySteps: ['dessert', 'beer', 'seafood'] },
      { w: 2, steps: ['teppan', 'soup', 'dine'], selfPaySteps: ['steak', 'beer', 'dessert'] },
      { w: 1, steps: ['rice', 'drink', 'dine'], selfPaySteps: ['dessert', 'beer', 'bbq'] },
    ],
    cureNeeded: 0.7,
    visitsToCure: [2, 4],
    palette: { skin: '#f6d2b0', hair: '#2b2b33', shirt: '#f2f2f2', pants: '#3c3f58' },
    reputationGain: 4,
    pointBias: { culinary: 1.0, device: 1.1, service: 0.9 },
    skipMain: 0.15,
  },

  student: {
    id: 'student', name: '放學學生族',
    desc: '下課後成群結隊的學生，預算有限、胃口很大，吃得開心就會在社群上幫你宣傳。',
    weight: 0.8,
    spawn: [
      { from: 840, to: 1020, w: 1.0 },
      { from: 1020, to: 1200, w: 1.2 },
    ],
    speed: 1.1,
    patience: 55,
    needsRamp: false,
    slipProne: 0.6,
    selfPay: 0.3,
    chatty: 0.5,
    plans: [
      { w: 3, steps: ['fried', 'drink', 'dine'], selfPaySteps: ['dessert', 'bbq'] },
      { w: 2, steps: ['dumpling', 'ice', 'dine'], selfPaySteps: ['dessert', 'bbq'] },
      { w: 2, steps: ['rice', 'drink', 'dine'], selfPaySteps: ['dessert', 'bbq'] },
      { w: 1, steps: ['fried', 'ice', 'dine'], selfPaySteps: ['dessert', 'seafood'] },
    ],
    cureNeeded: 0.8,
    visitsToCure: [2, 5],
    palette: { skin: '#e0b48a', hair: '#3a2a1e', shirt: '#ff7a3d', pants: '#222831' },
    reputationGain: 8,
    pointBias: { culinary: 1.0, device: 1.3, service: 0.8 },
    skipMain: 0.1,
  },

  family: {
    id: 'family', name: '親子家庭客',
    desc: '晚餐時段帶著孩子來的一家人，要有兒童遊戲區，多點幾道菜，家長很重視服務品質。',
    weight: 0.6,
    spawn: [
      { from: 1020, to: 1110, w: 1.0 },
      { from: 1110, to: 1200, w: 1.3 },
    ],
    speed: 1.2,
    patience: 55,
    needsRamp: false,
    slipProne: 1.0,
    selfPay: 0.5,
    chatty: 0.4,
    plans: [
      { w: 3, steps: ['main', 'side', 'dine'], selfPaySteps: ['hotpot', 'dessert', 'steak'] },
      { w: 2, steps: ['noodle', 'fried', 'dine'], selfPaySteps: ['dessert', 'hotpot'] },
      { w: 2, steps: ['teppan', 'soup', 'dine'], selfPaySteps: ['hotpot', 'dessert', 'bbq'] },
      { w: 1, steps: ['main', 'drink', 'dine'], selfPaySteps: ['dessert', 'hotpot'] },
    ],
    cureNeeded: 0.8,
    visitsToCure: [4, 8],
    palette: { skin: '#f3c7a1', hair: '#5a3825', shirt: '#ffd166', pants: '#118ab2' },
    reputationGain: 5,
    pointBias: { culinary: 1.1, device: 0.6, service: 1.4 },
    skipMain: 0.05,
  },
};

// Shop focus policies. spawnMult scales each guest type's arrival weight.
export const FOCUS = {
  business: {
    name: '商業午餐店',
    desc: '主打上班族的商業午餐與下班小酌，上班族與學生變多，長輩比較少。',
    spawnMult: { elder: 0.9, office: 1.4, student: 1.2, family: 0.7 },
  },
  community: {
    name: '社區早餐店',
    desc: '深耕社區的早餐與簡餐，晨間長輩客源滾滾而來，但上班族與學生變少。',
    spawnMult: { elder: 1.6, office: 0.8, student: 0.8, family: 0.8 },
  },
  kids: {
    name: '親子餐廳',
    desc: '主打親子友善，家庭客人大量湧入，兒童遊戲區與多道菜的需求大增。',
    spawnMult: { elder: 0.8, office: 0.8, student: 0.8, family: 1.8 },
  },
};
