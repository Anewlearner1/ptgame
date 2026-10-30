// Weather, random events, community programmes, dilemmas, menu boards, policy text (restaurant).
//
// Conventions (read by sim/events.js + sim/modifiers.js):
// - `mods` patches are ADDITIVE deltas on defaultMods() base values (multipliers have base 1: -0.6 -> 0.4).
// - `typeBoost` multiplies a guest type's arrival weight while the weather is active.
// - `slip` multiplies slip-and-fall probability while the weather is active (on top of mods.slipRisk).
// - Event/dilemma `effects`: money (NT$, + gain / - cost), reputation, points {culinary,device,service},
//   sat (satisfaction delta for the involved guest), risk (食安風險 delta, state.safety.risk).
// NOTE (balance): money / cost / upkeep values below were scaled x4 (events, dilemmas) and x3 (community, boards) when
// income was rescaled (now economy.PATIENT_WEIGHT; event money stays plain NT$, never weighted), so events still sting relative to monthly revenue.
// - Community `effects.spawn` is an additive delta on that guest type's spawn multiplier (0.3 -> x1.3).

// `kind` must be one of state.weather.kind: sunny|cloudy|rain|cold|hot|typhoon.
// `id` is unique; 梅雨 shares kind 'rain' but has its own id.
export const WEATHER = [
  {
    id: 'sunny', kind: 'sunny', name: '晴朗好天氣', icon: '☀️', months: [3, 4, 5, 6, 7, 8, 9, 10, 11],
    weight: 30, tempRange: [24, 33], mods: {}, typeBoost: { student: 1.3, elder: 1.05 }, slip: 0.9,
    news: '陽光超猛，大家都出來走走，順便找個地方吃飯。',
  },
  {
    id: 'cloudy', kind: 'cloudy', name: '陰天', icon: '☁️', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    weight: 25, tempRange: [20, 28], mods: {}, typeBoost: { office: 1.1 }, slip: 1.0,
    news: '陰陰的，不晴不雨，上班族的午餐便當都不想吃冷的。',
  },
  {
    id: 'rain', kind: 'rain', name: '午後陣雨', icon: '🌦️', months: [3, 4, 5, 9, 10, 11],
    weight: 18, tempRange: [21, 28], mods: {}, typeBoost: { elder: 1.2 }, slip: 1.5,
    news: '午後一陣雨，地板濕濕的，走路要看路喔。',
  },
  {
    id: 'plumrain', kind: 'rain', name: '梅雨季', icon: '🌧️', months: [5, 6],
    weight: 40, tempRange: [21, 28], mods: { staffStamina: 0.1 }, typeBoost: { elder: 1.25, office: 0.9 }, slip: 1.6,
    news: '梅雨下不停，衣服半乾不溼，鍋子也冒著濕氣。同仁說身體像泡過水。',
  },
  {
    id: 'cold', kind: 'cold', name: '寒流來襲', icon: '🥶', months: [12, 1, 2],
    weight: 30, tempRange: [8, 16], mods: {}, typeBoost: { elder: 1.6, office: 0.95 }, slip: 1.3,
    news: '寒流來了！阿伯阿嬤一早就來找熱湯，鍋子蓋一打開全是白煙。',
  },
  {
    id: 'hot', kind: 'hot', name: '炎夏高溫', icon: '🥵', months: [7, 8],
    weight: 25, tempRange: [31, 38], mods: { staffStamina: 0.2, spawnMult: -0.1 }, typeBoost: { student: 0.8, family: 0.7, elder: 0.9 }, slip: 1.0,
    news: '熱到柏油路會軟，大家都躲在冷氣房裡，只有冰品檯前還有人排隊。',
  },
  {
    id: 'typhoon', kind: 'typhoon', name: '颱風警報', icon: '🌀', months: [7, 8, 9, 10],
    weight: 6, tempRange: [24, 30], mods: { spawnMult: -0.6 }, typeBoost: {}, slip: 1.2,
    news: '颱風天停班停課，客人都待在家，店裡冷冷清清，只剩風在唱歌。',
  },
];

export const RANDOM_EVENTS = [
  {
    id: 'li_chief', title: '里長邀約', weight: 10, cond: {},
    text: '里長打電話來：「老闆啊，里民活動中心下禮拜要辦聯歡會，你們來擺個攤？」',
    choices: [
      {
        label: '好啊，免費請大家吃點心', effects: { money: -120000, reputation: 8, points: { service: 10 } },
        result: '里民排成一排拿餐盒，里長笑到合不攏嘴，說要幫你們寫進里刊。',
      },
      {
        label: '婉拒，我們店忙不過來', effects: { reputation: -2 },
        result: '里長嘆氣說：「好啦，那下次再說喔。」下次就不知道是哪一次了。',
      },
    ],
  },
  {
    id: 'health_audit', cat: 'safety', big: true, title: '衛生局年度抽查', weight: 8, cond: { minYear: 1 },
    text: '衛生局來函，要抽查廚房清潔、冷藏溫度與進貨紀錄。信封很厚，老闆的表情很薄。',
    choices: [
      {
        label: '配合稽查，全力準備', effects: { money: -80000, reputation: 3, risk: -12 },
        result: '紀錄寫得清清楚楚，稽查員翻了三小時，最後蓋了個章說「還可以」。',
      },
      {
        label: '交給行政處理，自己繼續出菜', effects: { money: -240000, reputation: -8, risk: 6 },
        result: '行政阿姨硬著頭皮補件，還是少了兩張簽名，罰單寄到了家裡。',
      },
    ],
  },
  {
    id: 'media_interview', title: '地方電視台採訪', weight: 6, cond: { minRep: 80 },
    text: '地方電視台的記者說想拍「巷口老店」專題，問你要不要上鏡頭。',
    choices: [
      {
        label: '上節目分享招牌菜', effects: { reputation: 12, money: -20000 },
        result: '你講得很清楚，還順便教觀眾怎麼煮出彈牙的麵條。播出後訂位電話快被打爆。',
      },
      {
        label: '婉拒，專心出菜', effects: { reputation: 1 },
        result: '記者說：「沒關係，我們找隔壁的店。」你默默看著電視裡的別人。',
      },
    ],
  },
  {
    id: 'poach', cat: 'ops', title: '員工被挖角', weight: 7, cond: { minYear: 1 },
    text: '隔壁連鎖餐廳的人資私訊你的員工，說薪水可以多兩成，還附員工餐與獎金。',
    choices: [
      {
        label: '加薪留人', effects: { money: -200000, reputation: 1 },
        result: '員工說「我再想想」，然後留下來了。你的薪資表多了一個零的感覺。',
      },
      {
        label: '祝他前程似錦', effects: { reputation: -3, points: { service: -5 } },
        result: '員工走了，同事們在茶水間哀嚎：「誰來幫我排班啊！」',
      },
    ],
  },
  {
    id: 'vendor_promo', title: '設備廠商促銷', weight: 8, cond: {},
    text: '設備業務帶著笑容來：「老闆，這台新爐具限時八折，現在下單還送保固！」',
    choices: [
      {
        label: '買！新爐具看起來很厲害', requires: { money: 480000 }, effects: { money: -480000, points: { device: 20 } },
        result: '爐具開箱那天，全店都來拍照。說明書有三百頁，但火力很漂亮。',
      },
      {
        label: '不買，先把舊的顧好', effects: { money: 0 },
        result: '業務留下名片：「老闆想通了隨時找我喔！」名片你放進抽屜，抽屜很滿。',
      },
    ],
  },
  {
    id: 'flood', cat: 'season', title: '颱風淹水', weight: 5, cond: { weather: ['typhoon'] },
    text: '颱風過後，馬路變成小河。店裡的地板泡在水裡，長椅還在飄。',
    choices: [
      {
        label: '全體動員清理，搶救設備', requires: { money: 360000 }, effects: { money: -360000, reputation: 4 },
        result: '同仁穿雨鞋、拿拖把，忙到半夜。客人隔天來看到，都說「你們很拚」。',
      },
      {
        label: '停業兩週慢慢修', effects: { money: -160000, reputation: -10 },
        result: '招牌上貼著「因故暫停營業」，客人的小本本上多了一個叉叉。',
      },
    ],
  },
  {
    id: 'brand_rep', title: '品牌業務來訪', weight: 6, cond: {},
    text: '飲料品牌業務說想請老闆當「合作店家」，每月固定進貨並掛招牌，條件看起來還不錯，但要統一標示。',
    choices: [
      {
        label: '接受，掛上合作招牌', effects: { money: 240000, reputation: -4 },
        result: '招牌一換，進貨價便宜了，錢也入袋。只是有位客人在下面小聲問：「老闆，你們是不是被收編了？」',
      },
      {
        label: '婉拒，我們保持獨立', effects: { reputation: 3 },
        result: '業務臉色有點難看，但客人們私下說你很有骨氣。',
      },
    ],
  },
  {
    id: 'fall_lobby', title: '大廳有人跌倒', weight: 6, cond: {},
    text: '一位阿伯在大廳地板滑了一跤，家屬衝進來大聲問：「你們的地板是怎麼回事？」',
    choices: [
      {
        label: '立刻送醫，全程陪同', effects: { money: -120000, reputation: 6, points: { service: 5 } },
        result: '阿伯只是擦傷加扭到腳，家屬紅著眼眶說：「還好你們有處理。」',
      },
      {
        label: '請家屬簽切結書就好', effects: { reputation: -12 },
        result: '切結書寫得密密麻麻，家屬簽了，但店的口碑被寫在大家的 LINE 群組裡。',
      },
    ],
  },
  {
    id: 'staff_birthday', title: '櫃檯小姐生日', weight: 5, cond: {},
    text: '櫃檯收銀員生日，同事們想辦個小派對，問老闆能不能出點經費。',
    choices: [
      {
        label: '全額買蛋糕，犒賞辛苦', effects: { money: -80000, points: { service: 5 } },
        result: '一顆六吋蛋糕被分成二十塊，大家吃到嘴角都是奶油，士氣回升。',
      },
      {
        label: '大家自己湊錢吧', effects: { reputation: -1 },
        result: '最後湊出一杯珍奶和一句「生日快樂」。收銀員說：「謝謝老闆的心意。」',
      },
    ],
  },
  {
    id: 'viral_video', title: '客人影片爆紅', weight: 4, cond: { minRep: 60 },
    text: '有客人偷偷拍了主廚翻鐵板的影片，上傳後居然爆紅，留言一堆「我也要吃這家」。',
    choices: [
      {
        label: '順勢拍幕後短片，好好經營', effects: { money: -80000, reputation: 15, points: { service: 10 } },
        result: '短片教大家「麵要這樣拉才彈牙」，粉絲破萬，你的店名開始有人念對了。',
      },
      {
        label: '請客人把影片刪掉', effects: { reputation: -5 },
        result: '客人很委屈地刪了，但網友已經截圖了一萬次。',
      },
    ],
  },
  {
    id: 'equip_recall', title: '設備召回通知', weight: 4, cond: { minYear: 1, hasObject: ['fryer'] },
    text: '廠商發通知，你家那台油炸鍋有安全疑慮要召回，換新機要自費，還附一張道歉信。',
    choices: [
      {
        label: '立刻換新，安全第一', requires: { money: 600000 }, effects: { money: -600000, reputation: 3, points: { device: 5 } },
        result: '新炸鍋亮亮的，客人說「這台看起來比較可靠」，你心裡鬆了一口氣。',
      },
      {
        label: '先用舊的，觀察看看', effects: { reputation: -4, risk: 6 },
        result: '客人在候位區問：「那台是不是有問題的那台？」你只能笑笑說還好啦。',
      },
    ],
  },
  {
    id: 'insurance_sales', title: '保險業務上門', weight: 5, cond: {},
    text: '保險業務說可以幫員工辦團體意外險，保費算你們便宜，但要先簽一堆資料。',
    choices: [
      {
        label: '幫員工加保', effects: { money: -160000, reputation: 2 },
        result: '員工收到保單很開心，說「老闆你人真好」。你只好把它當作福利。',
      },
      {
        label: '婉拒，我自己的保險都看不懂', effects: {},
        result: '業務說：「沒關係，下次再聊！」下次他又來了，你又說不。',
      },
    ],
  },
  {
    id: 'govt_subsidy', title: '市府補助公告', weight: 5, cond: { minYear: 1 },
    text: '市府公告餐飲業振興補助，申請表有十七頁，光是附件就要三個月。',
    choices: [
      {
        label: '申請，準備一整箱資料', effects: { money: 320000, reputation: 2 },
        result: '行政阿姨熬夜影印，終於把補助拿下來。她說：「這輩子再也不想看到影印機。」',
      },
      {
        label: '不想搞這麼多文書', effects: {},
        result: '你把公告貼在茶水間，偶爾看一眼，覺得好像錯過了什麼。',
      },
    ],
  },
  {
    id: 'school_talk', title: '國小邀請食農教育', weight: 5, cond: {},
    text: '附近國小的老師來電：「老闆，我們想請你來教小朋友做一道簡單的菜，他們超有興趣的！」',
    choices: [
      {
        label: '去教，順便宣傳店名', effects: { reputation: 6, points: { service: 8 } },
        result: '小朋友人手一張食譜貼紙，還有一個小朋友問你：「老闆，你的店有溜滑梯嗎？」',
      },
      {
        label: '婉拒，週末要休息', effects: { reputation: -1 },
        result: '老師說沒關係，但班級群組裡有家長默默問：「那家店是不是很忙？」',
      },
    ],
  },
  {
    id: 'parking_fine', title: '門口被開罰單', weight: 6, cond: {},
    text: '路邊臨停的外送機車被拖吊，里民抱怨說是餐廳門口讓車子亂停。',
    choices: [
      {
        label: '請行政去跟交通局溝通', effects: { money: -80000 },
        result: '行政阿姨跑了三趟區公所，罰單打折了一半，她說以後她要買機車。',
      },
      {
        label: '在門口貼公告，請大家勿停', effects: { reputation: -2 },
        result: '公告貼得很漂亮，但車還是停在那裡，大家把公告當成廣告。',
      },
    ],
  },
];

export const COMMUNITY = [
  {
    id: 'temple_meal', name: '宮廟免費供餐', desc: '廟埕擺攤供應免費熱湯與菜飯，阿嬤們排隊排到拜拜的香爐旁。',
    cost: 75000, durationWeeks: 2,
    effects: { spawn: { elder: 0.3 }, reputation: 5, points: { service: 10 } }, cooldownWeeks: 6,
  },
  {
    id: 'tasting', name: '社區試吃推廣', desc: '社區活動中心的小型試吃會，介紹新菜色與食材來源。',
    cost: 30000, durationWeeks: 2,
    effects: { spawn: { office: 0.1, elder: 0.1 }, reputation: 3, points: { service: 8 } }, cooldownWeeks: 4,
  },
  {
    id: 'kids_camp', name: '親子廚藝體驗營', desc: '假日邀請小朋友與家長一起包水餃、做甜點，家長聽到「來玩一下」都笑著說好。',
    cost: 120000, durationWeeks: 3,
    effects: { spawn: { family: 0.4 }, reputation: 6, points: { culinary: 10, service: 5 } }, cooldownWeeks: 8,
  },
  {
    id: 'company_lunch', name: '公司午餐推廣', desc: '到科技公司的會議室宣傳商業午餐，同仁一邊聽一邊偷偷看菜單。',
    cost: 105000, durationWeeks: 2,
    effects: { spawn: { office: 0.35 }, reputation: 4, points: { service: 8 } }, cooldownWeeks: 6,
  },
  {
    id: 'village_walk', name: '里民健走早餐會', desc: '每天早上繞里內走一圈，結束後免費供應早餐，阿伯阿嬤帶著保溫杯，學生也跟著跑。',
    cost: 45000, durationWeeks: 4,
    effects: { spawn: { elder: 0.2, student: 0.2 }, reputation: 3, points: { service: 6 } }, cooldownWeeks: 4,
  },
  {
    id: 'ltc_partner', name: '長照據點合作午餐', desc: '和社區長照據點簽約，每週定期供應營養午餐，阿嬤們說比去大樓下棋還好玩。',
    cost: 240000, durationWeeks: 6,
    effects: { spawn: { elder: 0.5 }, reputation: 12, points: { service: 20, culinary: 5 } }, cooldownWeeks: 10,
  },
  {
    id: 'night_run', name: '夜市快閃攤位', desc: '在夜市出口設快閃攤位，發小冰棒、賣炸物，順便宣傳店面。',
    cost: 90000, durationWeeks: 2,
    effects: { spawn: { student: 0.4 }, reputation: 6, points: { culinary: 5 } }, cooldownWeeks: 6,
  },
];

export const DILEMMAS = [
  {
    id: 'freebie_elder', trigger: 'freebie', title: '「老闆，多送我一點啦」',
    text: '阿伯揉著肚子說：「老闆啊，你多送我一點小菜啦，我常來的。」',
    choices: [
      {
        label: '好，多送一份小菜', effects: { sat: 8, reputation: -2, money: -5000 },
        result: '阿伯笑瞇瞇拿著小菜走，三天後又回來說「還要」。你心裡有點酸酸的。',
      },
      {
        label: '婉拒，但送一杯熱茶', effects: { sat: -3, reputation: 3 },
        result: '阿伯不太開心地嘟嚷：「我只是要多一點。」但他還是乖乖喝完了茶。',
      },
    ],
  },
  {
    id: 'freebie_office', trigger: 'freebie', title: '「老闆，這個套餐送我飲料啦」',
    text: '上班族一臉疲憊：「老闆，我今天加班，你就送我一杯飲料，拜託。」',
    choices: [
      {
        label: '送，但請他下次帶同事來', effects: { sat: 5, reputation: -1, money: -3000 },
        result: '他很感激你的飲料，下次還真的帶了兩個同事來。',
      },
      {
        label: '婉拒，說菜單有規定', effects: { sat: -4, reputation: 3 },
        result: '他嘆了口氣說：「好吧，那我自己買。」你覺得自己做對了，但胃有點痛。',
      },
    ],
  },
  {
    id: 'freebie_student', trigger: 'freebie', title: '「老闆，我只有九十塊，可以賣我套餐嗎？」',
    text: '學生的眼神很堅定：「老闆，套餐一百，我只有九十，你就賣我嘛，我不怕吃不飽。」',
    choices: [
      {
        label: '不行，菜單價就是菜單價', effects: { sat: -4, reputation: 5, points: { service: 3 } },
        result: '學生很不爽地走了，但隔週他回來說：「還好你沒讓價，我隔天領到零用錢了。」',
      },
      {
        label: '好啦，算你九十', effects: { sat: 10, reputation: -4, money: -10000, risk: 0 },
        result: '學生笑得好開心，同學們也說：「這家老闆人最好！」傳言也因此開始走樣。',
      },
    ],
  },
  {
    id: 'skip_main_elder', trigger: 'skip_main', title: '「我只要喝湯，不要點主餐」',
    text: '阿嬤一進門就說：「我只要喝碗湯，主餐就不用點啦，很貴耶。」',
    choices: [
      {
        label: '依菜單，建議搭配小份主餐', effects: { sat: -5, reputation: 3 },
        result: '阿嬤碎碎唸了半小時，最後還是點了一碗小飯，她說：「好啦，老闆你很煩。」',
      },
      {
        label: '同意，只收湯錢', effects: { sat: 4, reputation: -2, risk: 0 },
        result: '阿嬤很開心地喝著湯，你的帳本卻少了一筆。但她下次帶了朋友來。',
      },
    ],
  },
  {
    id: 'skip_main_office', trigger: 'skip_main', title: '「只想喝飲料，時間很趕」',
    text: '上班族看了看手錶：「老闆，我不想吃了，我直接喝杯飲料就好，我只有半小時。」',
    choices: [
      {
        label: '飲料可以，但請他先填問卷', effects: { sat: 2, reputation: 2 },
        result: '他說「好吧，那就快一點」，問卷花了五分鐘，喝完飲料他說：「還真好喝！」',
      },
      {
        label: '直接賣飲料，不多問', effects: { sat: 3, money: 8000, reputation: -4 },
        result: '收據很漂亮，但同事小聲說：「我們好像把流程跳過了。」',
      },
    ],
  },
  {
    id: 'overpush_elder', trigger: 'overpush', title: '「老闆，我想每天都吃同一種」',
    text: '阿伯很認真地問：「每天都吃滷肉飯，會不會比較健康？我可以每天都來吧？」',
    choices: [
      {
        label: '建議搭配不同菜色，營養均衡', effects: { sat: -3, reputation: 4 },
        result: '阿伯有點失望，但也慢慢接受：「原來不是越多越好喔。」',
      },
      {
        label: '好，每天都可以，收費照算', effects: { money: 12000, reputation: -4, risk: 2 },
        result: '帳單很漂亮，營養師看到的時候，眉毛挑得很高。',
      },
    ],
  },
  {
    id: 'overpush_office', trigger: 'overpush', title: '「我想一次點十份特餐」',
    text: '老闆一拍桌：「老闆，我想一次點十份特餐，有沒有折扣？我全部都要！」',
    choices: [
      {
        label: '依人數建議六份就夠', effects: { sat: 0, reputation: 3 },
        result: '客人說：「老闆你很誠實耶，我下次介紹朋友來。」',
      },
      {
        label: '給他十份，收錢收到手軟', effects: { money: 32000, reputation: -6 },
        result: '帳戶多了一大筆錢，但客人吃到第六份就說吃不完，之後再也沒來過。',
      },
    ],
  },
  {
    id: 'overpush_family', trigger: 'overpush', title: '「我家小孩每天都要來玩遊戲區」',
    text: '家長很堅持：「我家小孩每天都要來玩球池，他很愛，你可以排滿一點吧？」',
    choices: [
      {
        label: '依座位狀況，一週兩到三次', effects: { sat: -2, reputation: 3, points: { service: 3 } },
        result: '家長嘆氣說：「好吧，那週末可以多來一次嗎？」你說週末我們也很多人。',
      },
      {
        label: '每天都可以，點餐照算', effects: { money: 16000, reputation: -3 },
        result: '小朋友玩得超開心，但家長在群組裡問：「為什麼遊戲區一定要點餐才能玩？」',
      },
    ],
  },
  {
    id: 'complain_wait', trigger: 'complain', title: '「等了一個半小時，你們怎麼排的！」',
    text: '阿姨拍著點餐櫃檯大喊：「我一個半小時了耶！你們到底是怎麼排班的啦！」',
    choices: [
      {
        label: '真誠道歉，免費加送一道小菜', effects: { sat: 10, reputation: 2, money: -8000 },
        result: '阿姨嘴上說「下次不要這樣」，但嚐到小菜時已經笑瞇瞇了。',
      },
      {
        label: '解釋今天很忙，請她耐心等', effects: { sat: -15, reputation: -6 },
        result: '阿姨說：「我下次去別家！」背影有種不回頭的堅定。',
      },
    ],
  },
  {
    id: 'complain_price', trigger: 'complain', title: '「為什麼特餐這麼貴？」',
    text: '阿伯看著帳單，眉頭皺成一團：「老闆，特餐為什麼要這麼貴？一般菜色不能做嗎？」',
    choices: [
      {
        label: '說明食材與工法，附上菜單說明', effects: { sat: 4, reputation: 2 },
        result: '阿伯看完說：「原來是這樣，我還以為你們是在騙錢。」你默默把說明書多印了五十張。',
      },
      {
        label: '直接說就是這個價錢', effects: { sat: -6, reputation: -3 },
        result: '阿伯不滿地走了，但他家的小孫子在候位區偷偷把這句話錄起來。',
      },
      {
        label: '這次先打個折，給個人情', effects: { sat: 8, money: -6000 },
        result: '阿伯很感動，回去跟鄰居說你們「很有人情味」，但你的帳本少了一筆。',
      },
    ],
  },
  {
    id: 'complain_noisy', trigger: 'complain', title: '「抽油煙機嗡嗡叫，我頭很痛」',
    text: '阿嬤坐在桌邊皺眉：「老闆，這台機器一直嗡嗡叫，我頭好痛，是不是壞了？」',
    choices: [
      {
        label: '換一台新的，給她看', effects: { money: -24000, sat: 6, reputation: 2 },
        result: '阿嬤摸著新機器說：「這台比較安靜，好很多。」你偷偷把舊機器的螺絲拆下來留著。',
      },
      {
        label: '請她忍耐一下，餐點很快就好', effects: { sat: -8, reputation: -2 },
        result: '阿嬤嘆氣：「忍耐、忍耐，我都忍一輩子了。」你覺得這句話好重。',
      },
    ],
  },
  {
    id: 'complain_staff', trigger: 'complain', title: '「你們服務生態度很差！」',
    text: '一位客人投訴服務生講話太大聲，還說「你們是在趕人嗎？」',
    choices: [
      {
        label: '調查後處理，當面道歉', effects: { sat: 5, reputation: 4, money: -2000 },
        result: '服務生紅著眼眶說：「我以後會注意語氣。」客人說：「有道歉就好。」',
      },
      {
        label: '服務生沒有錯，請客人多包涵', effects: { sat: -8, reputation: -4 },
        result: '客人在網路上寫了一篇長文，標題是「這家店，我不推」。',
      },
    ],
  },
];

export const BOARDS = [
  {
    id: 'today_special', name: '今日特餐看板', cost: 24000, upkeep: 1500,
    effects: { patience: 0.05 },
    desc: '看板寫著今日特餐與供應時間，排隊的人看著看著就忘了等待的煩躁。',
  },
  {
    id: 'drink_guide', name: '飲料甜度冰塊說明', cost: 18000, upkeep: 900,
    effects: { selfPayConv: 0.02 },
    desc: '微糖少冰去冰，看板講得很白話，大家都說「原來還可以這樣點」。',
  },
  {
    id: 'kids_menu', name: '兒童餐推薦', cost: 45000, upkeep: 1200,
    effects: { patience: 0.05, researchGain: 0.02 },
    desc: '小份量、不辣、有營養的推薦，家長對照著看，焦慮少了，來問問題的也變多了。',
  },
  {
    id: 'elder_meal', name: '長者養生餐', cost: 36000, upkeep: 1200,
    effects: { slipRisk: -0.1, elderSat: 2 },
    desc: '清淡少鹽、軟爛好咬、附防滑小提醒。阿嬤拍照存進 LINE 群組。',
  },
  {
    id: 'special_explain', name: '特色料理說明', cost: 30000, upkeep: 900,
    effects: { selfPayConv: 0.04 },
    desc: '特色料理用什麼食材、怎麼做、值不值得，寫清楚講明白，「為什麼這麼貴」少被問一次。',
  },
  {
    id: 'elder_protein', name: '長輩蛋白質補給', cost: 60000, upkeep: 1500,
    effects: { elderSat: 3 },
    desc: '吃足蛋白質、多曬太陽、動一動。阿公說：「原來不是老了才會沒力。」',
  },
  {
    id: 'office_light', name: '上班族輕食套餐', cost: 27000, upkeep: 900,
    effects: { patience: 0.03, selfPayConv: 0.01 },
    desc: '午休一個小時，吃完還能睡十分鐘。看板上的小人偶跟你一起打哈欠。',
  },
];

export const POLICY_TEXT = {
  business: { label: '商業午餐', hint: '上班族為主、翻桌快，靠午餐與下班小酌吃飯。' },
  community: { label: '社區早餐', hint: '阿公阿嬤多、防滑很重要，長輩滿意度與坡道是重點。' },
  kids: { label: '親子餐廳', hint: '兒童餐、遊戲區與多道菜，小朋友要玩得開心，家長要吃得安心。' },
};
