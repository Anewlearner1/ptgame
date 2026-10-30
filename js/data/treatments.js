// Dish definitions (static data; the engine still calls them "treatments"). See docs/RESTAURANT_DESIGN.md §4.
// kind 'menu'    = standard dish, sold at `price` (NT$ per diner, from data/fees.js)
// kind 'special' = 特色料理 / 加點, sold at `price` x the player's slider x mods.selfPayPrice, offered as an upsell
// price / foodCost come from data/fees.js; uptake (special only, default 1) = relative share of willing guests who actually order it:
// an ABSTRACTION knob, not real data (a NT$ 680 steak converts less often than a NT$ 160 dessert).
// objects: the guest stands next to one of these (ANY-of). staffRole: ANY-of roles.
// QUALIFICATION RULES (sim/qualify.js): a station only works while a staff member of one of `staffRole` is on the payroll.
//   attend 'full'  = that staff member is bound to the guest for the whole session (cooking at the pass);
//   attend 'setup' = machine / pot / table: the staff member is needed only for the first `setupMin` game-minutes (taking the order,
//                    starting the pot, laying the table), is then released and the dish finishes unattended.
// intake: true marks the first, order-defining dish (the chef's signature): follow-up visits may skip it, and upsells are offered after it.
import { DISH_FEES } from './fees.js';
const price = (id) => DISH_FEES[id].price;
const cost = (id) => DISH_FEES[id].foodCost;

export const TREATMENTS = {
  main: {
    id: 'main', name: '招牌主餐', kind: 'menu', intake: true,
    objects: ['chef_range'], staffRole: ['chef'], attend: 'full',
    duration: 40, price: price('main'), foodCost: cost('main'),
    points: { culinary: 2, device: 0, service: 1 },
    staminaCost: 4, requires: null, cure: 0.1,
    intro: '主廚現做的招牌，客人點了就知道這家店有沒有料。',
  },
  noodle: {
    id: 'noodle', name: '湯麵', kind: 'menu',
    objects: ['noodle_stove'], staffRole: ['cook'], attend: 'full',
    duration: 30, price: price('noodle'), foodCost: cost('noodle'),
    points: { culinary: 1, device: 0, service: 0 },
    staminaCost: 6, requires: null, cure: 0.12,
    intro: '燙麵、加料、淋湯頭，一碗熱騰騰的湯麵出餐快、回頭客多。',
  },
  rice: {
    id: 'rice', name: '滷肉飯', kind: 'menu',
    objects: ['braise_pot'], staffRole: ['cook', 'cashier'], attend: 'setup', setupMin: 5,
    duration: 25, price: price('rice'), foodCost: cost('rice'),
    points: { culinary: 0, device: 1, service: 0 },
    staminaCost: 2, requires: null, cure: 0.1,
    intro: '滷肉鍋一開，廚師或櫃檯盛好飯，客人自己端走就能開吃。',
  },
  dumpling: {
    id: 'dumpling', name: '煎餃鍋貼', kind: 'menu',
    objects: ['griddle'], staffRole: ['cook', 'server'], attend: 'setup', setupMin: 6,
    duration: 35, price: price('dumpling'), foodCost: cost('dumpling'),
    points: { culinary: 0, device: 1, service: 0 },
    staminaCost: 3, requires: null, cure: 0.1,
    intro: '倒水、蓋鍋蓋，等水收乾底部金黃就好，不用一直顧著。',
  },
  fried: {
    id: 'fried', name: '鹽酥雞炸物', kind: 'menu',
    objects: ['fryer'], staffRole: ['cook'], attend: 'full',
    duration: 25, price: price('fried'), foodCost: cost('fried'),
    points: { culinary: 1, device: 0, service: 1 },
    staminaCost: 6, requires: null, cure: 0.12,
    intro: '下鍋、撈起、撒椒鹽，火候差一點就是兩種味道。',
  },
  teppan: {
    id: 'teppan', name: '鐵板燒', kind: 'menu',
    objects: ['teppan'], staffRole: ['chef', 'cook'], attend: 'full',
    duration: 40, price: price('teppan'), foodCost: cost('teppan'),
    points: { culinary: 2, device: 1, service: 1 },
    staminaCost: 8, requires: 'rs_teppan', cure: 0.15,
    intro: '滋滋作響的鐵板，師傅翻鏟的手勢本身就是表演。',
  },
  side: {
    id: 'side', name: '小菜', kind: 'menu',
    objects: ['cold_case'], staffRole: ['server', 'cashier'], attend: 'setup', setupMin: 3,
    duration: 20, price: price('side'), foodCost: cost('side'),
    points: { culinary: 0, device: 0, service: 1 },
    staminaCost: 1, requires: null, cure: 0.05,
    intro: '涼拌小黃瓜、燙青菜、滷蛋豆干，隨手一盤，客單價就上去了。',
  },
  soup: {
    id: 'soup', name: '例湯', kind: 'menu',
    objects: ['soup_pot'], staffRole: ['server', 'cashier'], attend: 'setup', setupMin: 5,
    duration: 30, price: price('soup'), foodCost: cost('soup'),
    points: { culinary: 0, device: 1, service: 0 },
    staminaCost: 1, requires: null, cure: 0.08,
    intro: '大鍋湯舀一碗，暖胃又暖心，長輩最愛。',
  },
  drink: {
    id: 'drink', name: '手搖飲', kind: 'menu',
    objects: ['drink_bar'], staffRole: ['barista', 'cashier'], attend: 'setup', setupMin: 5,
    duration: 25, price: price('drink'), foodCost: cost('drink'),
    points: { culinary: 0, device: 1, service: 1 },
    staminaCost: 2, requires: null, cure: 0.08,
    intro: '微糖少冰去冰，吧台師開機封杯，上班族下午三點必點。',
  },
  ice: {
    id: 'ice', name: '冰品豆花', kind: 'menu',
    objects: ['ice_shop'], staffRole: ['barista'], attend: 'full',
    duration: 30, price: price('ice'), foodCost: cost('ice'),
    points: { culinary: 1, device: 0, service: 1 },
    staminaCost: 3, requires: 'rs_ice', cure: 0.1,
    intro: '剉冰淋糖水、鋪滿配料，夏天排隊排到轉角。',
  },
  dine: {
    id: 'dine', name: '內用用餐', kind: 'menu',
    objects: ['table2', 'table4'], staffRole: ['server'], attend: 'setup', setupMin: 3,
    duration: 40, price: price('dine'), foodCost: cost('dine'),
    points: { culinary: 0, device: 0, service: 2 },
    staminaCost: 1, requires: null, cure: 0.12,
    intro: '服務生帶位、倒水、收盤，客人坐下來好好吃一頓飯。',
  },

  steak: {
    id: 'steak', name: '主廚特餐牛排', kind: 'special',
    objects: ['chef_table'], staffRole: ['chef'], attend: 'full',
    duration: 60, price: price('steak'), foodCost: cost('steak'),
    points: { culinary: 3, device: 0, service: 1 },
    staminaCost: 6, requires: 'rs_steak', cure: 0.3,
    uptake: 0.5,
    intro: '厚切牛排煎到三分熟，主廚站在客人面前現做。',
  },
  seafood: {
    id: 'seafood', name: '活海鮮熱炒', kind: 'special',
    objects: ['wok_range'], staffRole: ['cook', 'chef'], attend: 'full',
    duration: 50, price: price('seafood'), foodCost: cost('seafood'),
    points: { culinary: 2, device: 2, service: 0 },
    staminaCost: 8, requires: 'rs_wok', cure: 0.25,
    uptake: 0.8,
    intro: '大火快炒的鍋氣，配啤酒最對味。',
  },
  hotpot: {
    id: 'hotpot', name: '精緻火鍋', kind: 'special',
    objects: ['hotpot_table'], staffRole: ['server', 'cook'], attend: 'full',
    duration: 60, price: price('hotpot'), foodCost: cost('hotpot'),
    points: { culinary: 1, device: 1, service: 2 },
    staminaCost: 5, requires: 'rs_hotpot', cure: 0.28,
    uptake: 0.6,
    intro: '桌邊一鍋熱湯、一盤盤肉片，圍爐的氣氛最適合家人聚餐。',
  },
  bbq: {
    id: 'bbq', name: '炭火串燒', kind: 'special',
    objects: ['bbq_grill'], staffRole: ['cook'], attend: 'full',
    duration: 40, price: price('bbq'), foodCost: cost('bbq'),
    points: { culinary: 1, device: 2, service: 0 },
    staminaCost: 7, requires: 'rs_bbq', cure: 0.25,
    uptake: 0.8,
    intro: '炭火烤得滋滋冒油，一串一串刷醬，香氣把路人都勾進來。',
  },
  dessert: {
    id: 'dessert', name: '手作甜點', kind: 'special',
    objects: ['dessert_bar'], staffRole: ['barista'], attend: 'full',
    duration: 35, price: price('dessert'), foodCost: cost('dessert'),
    points: { culinary: 2, device: 0, service: 2 },
    staminaCost: 4, requires: 'rs_dessert', cure: 0.2,
    uptake: 0.9,
    intro: '布丁、蛋糕、千層，飯後來一份，學生族與親子客最愛。',
  },
  beer: {
    id: 'beer', name: '精釀啤酒與茶酒', kind: 'special',
    objects: ['bar_counter'], staffRole: ['barista', 'server'], attend: 'setup', setupMin: 5,
    duration: 40, price: price('beer'), foodCost: cost('beer'),
    points: { culinary: 1, device: 1, service: 1 },
    staminaCost: 3, requires: 'rs_bar', cure: 0.22,
    uptake: 0.7,
    intro: '一杯冰涼的精釀，配炸物剛好，上班族下班後最需要。',
  },
};
