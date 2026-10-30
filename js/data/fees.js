// Dish prices and ingredient-cost rates (restaurant). The ONE place to correct a real-world number.
//
// Prices are plain NT$ per diner (一位客人), roughly 2026 Taiwan street-food / casual-dining menu prices (小吃店、簡餐店、熱炒店、
// 火鍋店、咖啡甜點店 typical). They are ABSTRACTED game numbers, not a survey: confidence 'medium' (common price band) or 'low'.
// foodCost = ingredient cost as a share of the price (台灣餐飲食材成本率 ~28-45%). The sim books it in ledger.expense.food.
//
// Game abstraction lives elsewhere: PATIENT_WEIGHT in sim/economy.js (each simulated guest stands for N real diners and multiplies
// ALL guest-generated revenue and ingredient cost the same way), `selfPay` willingness in data/patients.js (= 加點意願), per-dish
// `uptake` in data/treatments.js.
//
// kind 'menu'    : standard dishes, always sold at `price` (the player cannot reprice them).
// kind 'special' : 特色料理 / 加點; sold at `price` x the player's slider (policy.priceMult, 0.5..2.0) x mods.selfPayPrice.

export const FEES_AS_OF = '2026-10';

export const DISH_FEES = {
  main:     { kind: 'menu', price: 200, foodCost: 0.38, unit: '每份', confidence: 'medium', note: '招牌牛肉麵／排骨飯一份 160-220 元。' },
  noodle:   { kind: 'menu', price: 130, foodCost: 0.35, unit: '每碗', confidence: 'medium', note: '陽春麵、切仔麵、乾麵 80-150 元。' },
  rice:     { kind: 'menu', price: 70,  foodCost: 0.32, unit: '每碗', confidence: 'medium', note: '滷肉飯 40-80 元，配滷蛋滷豆腐。' },
  dumpling: { kind: 'menu', price: 90,  foodCost: 0.32, unit: '每份(10顆)', confidence: 'medium', note: '煎餃、鍋貼一份 70-100 元。' },
  fried:    { kind: 'menu', price: 110, foodCost: 0.35, unit: '每袋', confidence: 'medium', note: '鹽酥雞一份 80-130 元。' },
  teppan:   { kind: 'menu', price: 240, foodCost: 0.40, unit: '每份', confidence: 'medium', note: '平價鐵板燒套餐 180-280 元。' },
  side:     { kind: 'menu', price: 50,  foodCost: 0.30, unit: '每份', confidence: 'medium', note: '涼拌小菜、燙青菜 30-60 元。' },
  soup:     { kind: 'menu', price: 40,  foodCost: 0.25, unit: '每碗', confidence: 'medium', note: '貢丸湯、蛤蜊湯、玉米濃湯 25-50 元。' },
  drink:    { kind: 'menu', price: 60,  foodCost: 0.22, unit: '每杯', confidence: 'medium', note: '手搖飲 45-75 元。' },
  ice:      { kind: 'menu', price: 75,  foodCost: 0.28, unit: '每碗', confidence: 'medium', note: '剉冰、豆花、燒仙草 50-90 元。' },
  dine:     { kind: 'menu', price: 0,   foodCost: 0,    unit: '每桌', confidence: 'medium', note: '內用不另收服務費；餐桌與服務生決定翻桌率。' },

  steak:    { kind: 'special', price: 720, foodCost: 0.42, unit: '每份', confidence: 'medium', note: '厚切牛排／主廚特餐 500-900 元。' },
  seafood:  { kind: 'special', price: 480, foodCost: 0.45, unit: '每份', confidence: 'medium', note: '熱炒活海鮮一道 300-600 元。' },
  hotpot:   { kind: 'special', price: 560, foodCost: 0.40, unit: '每位', confidence: 'medium', note: '精緻火鍋吃到飽或單人鍋 400-700 元。' },
  bbq:      { kind: 'special', price: 400, foodCost: 0.38, unit: '每人', confidence: 'medium', note: '炭火串燒一個人 300-500 元。' },
  dessert:  { kind: 'special', price: 170, foodCost: 0.30, unit: '每份', confidence: 'medium', note: '手作蛋糕、布丁、千層 120-200 元。' },
  beer:     { kind: 'special', price: 300, foodCost: 0.32, unit: '每杯／壺', confidence: 'medium', note: '精釀啤酒、茶酒 200-350 元。' },
};

// kept as an alias so older call sites that import TREATMENT_FEES keep working
export const TREATMENT_FEES = DISH_FEES;
