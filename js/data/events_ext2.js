// 擴充事件 B 組（EVENTS_EXT_B）：餐廳營運 C01–C16、季節與在地 D01–D12，共 28 件。
// 規格：docs/EVENTS_EXT.md（資料契約）；餐廳版對照見 docs/RESTAURANT_DESIGN.md。
// 文案為虛構情境，不貼真實機構、公司或人名。
//
// 欄位約定（見 EVENTS_EXT.md §1–§2）：
// - cat: C 類為 'ops'，D 類為 'season'。season 權重 10、冷卻 40–48 週（每年回來一次）。
// - big: 大事件（每月最多一個）：cook_resign、rent_hike、hygiene_audit、fire_safety_check，權重 3。
// - chance: { p = 成功（win）機率, win, lose }；每側都有 effects 與 result。
// - followUp 目標 fryer_burn、allergy_alert 在 events_ext.js（A 組）中定義。
// - 設備故障事件以 cond.wearAtLeast.defId 綁定（sim/events.js breakdownEventFor）：fryer、braise_pot、noodle_stove。

export const EVENTS_EXT_B = [
  // ───────── C 類：餐廳營運（ops） ─────────
  {
    id: 'fryer_oil', cat: 'ops', title: '炸油劣化，炸物顏色怪怪的',
    text: '油炸鍋的油越炸越黑，冒出的煙像小型火山。廚師：「這鍋油今天心情不好。」',
    weight: 6, cooldownWeeks: 24, big: false,
    cond: { wearAtLeast: { defId: 'fryer', n: 70 } },
    choices: [
      {
        label: '整鍋換新油並請師傅清槽', requires: { money: 40000 },
        effects: { money: -40000, wear: { target: 'fryer', delta: -100 } },
        result: '師傅拆開鍋蓋刮了半天油垢，說這台已經很久沒休息了，修好後乖得像新的。',
      },
      {
        label: '自己過濾換油',
        chance: {
          p: 0.7,
          win: { effects: { money: -5000, wear: { target: 'fryer', delta: -100 } }, result: '濾網換新，炸油清亮了好一陣子。' },
          lose: { effects: { money: -5000, wear: { target: 'fryer', delta: -100 }, breakdown: 'fryer' }, result: '才用了兩天，油又黑了，這次連加熱管都罷工。' },
        },
        result: '廚師說「我來試試看」，油換了、網也洗了，就看它的心情。',
      },
      {
        label: '繼續用，還能炸就好',
        effects: { sat: -6, risk: 6, followUp: { id: 'fryer_burn', afterWeeks: 1, p: 0.1 } },
        result: '阿伯抱怨了兩句，炸物嚐起來有點苦，他說這叫「有焦香」。',
      },
    ],
  },
  {
    id: 'scale_calibration', cat: 'ops', title: '電子秤與溫度計年度校正',
    text: '衛生局提醒：「去年校正的秤重與溫度計，今年要確認一下喔。」',
    weight: 6, cooldownWeeks: 52, big: false,
    cond: { hasObject: ['chef_range'] },
    choices: [
      {
        label: '送去校正', requires: { money: 50000 },
        effects: { money: -50000, wear: { target: 'chef_range', delta: -100 }, setFlag: 'scale_calibrated', risk: -5 },
        result: '校正單上蓋滿了章，秤重跟說明書一樣準，連稽查員都點頭。',
      },
      {
        label: '延後，先用著',
        effects: { wear: { target: 'chef_range', delta: 10 }, setFlag: 'scale_calib_overdue', risk: 4 },
        result: '校正單放進抽屜，抽屜裡已經有三張了。',
      },
      {
        label: '乾脆換新的整套設備', requires: { money: 480000 },
        effects: { money: -480000, points: { device: 20 }, wear: { target: 'chef_range', delta: -100 } },
        result: '舊設備被搬走，新設備的螢幕亮得像在炫耀。',
      },
    ],
  },
  {
    id: 'braise_leak', cat: 'ops', title: '滷肉鍋保溫失靈',
    text: '滷肉鍋溫度忽高忽低，湯汁沸得像在開派對。廚師用手背試了一下，立刻縮手。',
    weight: 6, cooldownWeeks: 24, big: false,
    cond: { wearAtLeast: { defId: 'braise_pot', n: 60 } },
    choices: [
      {
        label: '立刻停用，換溫控器', requires: { money: 30000 },
        effects: { money: -30000, wear: { target: 'braise_pot', delta: -100 } },
        result: '新溫控器一裝，滷肉鍋又變回溫吞的好脾氣。',
      },
      {
        label: '調低設定值先用',
        effects: { followUp: { id: 'fryer_burn', afterWeeks: 1, p: 0.2 }, risk: 3 },
        result: '溫度是降下來了，只是沒人保證客人的舌頭跟廚師的手背一樣耐燙。',
      },
      {
        label: '放著不管',
        effects: { reputation: -3 },
        result: '滷肉鍋繼續發燙，客人的意見也繼續發燙。',
      },
    ],
  },
  {
    id: 'noodle_stove_noise', cat: 'ops', title: '煮麵台火力異常',
    text: '煮麵台每點一次火就「砰——」一聲，客人說：「這聲音我也想叫。」',
    weight: 6, cooldownWeeks: 24, big: false,
    cond: { wearAtLeast: { defId: 'noodle_stove', n: 60 } },
    choices: [
      {
        label: '簽年度保養合約', requires: { money: 30000 },
        effects: { money: -30000, maintenance: 52 },
        result: '業務留下合約與一張保養表，爐頭的聲音慢慢變成安靜的嗡嗡。',
      },
      {
        label: '臨時叫修', requires: { money: 20000 },
        effects: { money: -20000, wear: { target: 'noodle_stove', delta: -100 } },
        result: '師傅來了，清了積碳，砰聲就像被關進小房間。',
      },
      {
        label: '不理會',
        chance: {
          p: 0.6,
          win: { effects: { sat: -4 }, result: '砰聲持續，客人也持續忍耐，還好爐子撐得住。' },
          lose: { effects: { sat: -4, breakdown: 'noodle_stove' }, result: '最後一次點火，砰——然後整台靜止，客人終於也不想叫了。' },
        },
        result: '煮麵台還在砰砰作響，客人嘴上說沒關係，身體很誠實。',
      },
    ],
  },
  {
    id: 'pos_down', cat: 'ops', title: 'POS 與行動支付當機',
    text: '掃 QR Code 的時候螢幕轉圈圈，阿伯的血壓跟著轉圈圈。',
    weight: 6, cooldownWeeks: 12, big: false,
    cond: {},
    choices: [
      {
        label: '先出餐，事後補登',
        effects: { sat: 5, stamina: { role: 'cashier', delta: -8 } },
        result: '客人先被照顧好，櫃檯晚上加班補登，臉上寫著「我沒事」。',
      },
      {
        label: '請客人先付現，事後退差額', requires: { money: 10000 },
        effects: { money: -10000, sat: -2 },
        result: '大家掏出現金找零，櫃檯的抽屜有點亂，但也順利過了關。',
      },
      {
        label: '暫時只收現金，掛牌說明',
        effects: { sat: -6, reputation: -1 },
        result: '客人看到「只收現金」的牌子，有一半默默走回了隔壁。',
      },
    ],
  },
  {
    id: 'cook_resign', cat: 'ops', title: '廚師遞出辭呈', big: true, weight: 3, cooldownWeeks: 36,
    text: '廚師把辭呈放在你的桌上：「我想去開自己的店，謝謝這段時間的照顧。」他的眼神很堅定。',
    cond: { hasStaff: { cook: 1 }, moraleBelow: 40 },
    choices: [
      {
        label: '加薪並調整排班，慰留', requires: { money: 60000 },
        effects: { money: -60000, morale: { role: 'cook', delta: 12 } },
        result: '談了一個下午，加薪與排班調整都有了，辭呈被收進抽屜。',
      },
      {
        label: '祝福他，並請他推薦接班人',
        effects: { resign: { role: 'cook', p: 1 }, reputation: 1 },
        result: '廚師離開前把自己的獨門醬料配方留了一頁，說：「這是我送給店的。」',
      },
      {
        label: '不挽留，公開徵才',
        effects: { resign: { role: 'cook', p: 1 }, reputation: -2, morale: { delta: -5 } },
        result: '辭呈照批，招聘名單裡多了一位新的應徵者，同事們在茶水間小聲議論。',
      },
    ],
  },
  {
    id: 'license_renew', cat: 'ops', title: '食品業者登錄與衛生講習', big: false, weight: 6, cooldownWeeks: 48,
    text: '年底前要完成食品業者登錄更新與每年八小時衛生講習，同仁的假日又要被拿去上課。',
    cond: { months: [11, 12] },
    choices: [
      {
        label: '全員報名，輪流去上課', requires: { money: 24000 },
        effects: { money: -24000, morale: { delta: -2 }, setFlag: 'hygiene_trained', risk: -8 },
        result: '大家輪班坐在教室裡打瞌睡，但結業證書領到的時候，每個人都笑得很開心。',
      },
      {
        label: '只派主廚去上課',
        effects: { money: -6000, risk: -3 },
        result: '主廚回來後把講義影印了十份，貼在廚房，沒人看，但貼著就覺得安心。',
      },
      {
        label: '拖到下個月再說',
        effects: { setFlag: 'hygiene_late', risk: 5 },
        result: '講習通知單被埋在桌上的一疊單據下，期限一天天逼近。',
      },
    ],
  },
  {
    id: 'overtime_crunch', cat: 'ops', title: '連假前後人力不足', big: false, weight: 6, cooldownWeeks: 24,
    text: '連假前後三位同仁請特休，櫃檯白板上只剩兩個名字。',
    cond: {},
    choices: [
      {
        label: '加聘臨時工支援', requires: { money: 50000 },
        effects: { money: -50000, stamina: { delta: 5 }, buff: { weeks: 2, label: '臨時人力到位', mods: { patience: 0.03 } } },
        result: '臨時工穿著圍裙站在出餐口，雖然還在學菜單，但總算撐過了尖峰。',
      },
      {
        label: '請現有員工加班，給加班費',
        effects: { money: -40000, stamina: { delta: -12 }, morale: { delta: -4 } },
        result: '大家加班到九點，手上多了一點加班費，臉上寫著「下次不要這樣」。',
      },
      {
        label: '縮短營業時間',
        effects: { sat: -5, reputation: -3 },
        result: '門口貼出「提前打烊」的牌子，路過的客人看了看，轉身進了隔壁。',
      },
    ],
  },
  {
    id: 'rent_hike', cat: 'ops', title: '房東通知續約調漲', big: true, weight: 3, cooldownWeeks: 48,
    text: '房東傳來訊息：「這間店租金明年要調整，市場行情就是這樣。」',
    cond: { minYear: 1 },
    choices: [
      {
        label: '協商分段調漲',
        effects: { money: -50000, buff: { weeks: 12, label: '租金協議', mods: { rentMult: 0.04 } } },
        result: '來回協商三輪，最後同意分三年漲完，房東笑著說：「你們生意好，我也放心。」',
      },
      {
        label: '直接簽約，不多說',
        effects: { buff: { weeks: 24, label: '租金上調', mods: { rentMult: 0.1 } } },
        result: '合約簽了，月租多了一個零頭，會計把這個數字貼在白板上提醒大家。',
      },
      {
        label: '貼出「準備搬家」，向房東施壓',
        result: '你放出了風聲，看看房東的反應。',
        chance: {
          p: 0.4,
          win: { effects: { reputation: 1 }, result: '房東緊張了，主動說可以維持原價一年，你笑了，但笑得有點勉強。' },
          lose: { effects: { buff: { weeks: 24, label: '租金上調', mods: { rentMult: 0.15 } }, reputation: -2 }, result: '房東不吃這一套，調得更高，客人還以為你們要搬走，流失了一些。' },
        },
      },
    ],
  },
  {
    id: 'hygiene_audit', cat: 'ops', title: '衛生局無預警稽查', big: true, weight: 3, cooldownWeeks: 36,
    text: '穿著制服的稽查員站在門口：「今天我們要看廚房、冷藏、員工洗手與工作服。」',
    cond: { minYear: 1 },
    choices: [
      {
        label: '全面配合，馬上展示衛生紀錄',
        effects: { money: -20000, risk: -10, reputation: 2, setFlag: 'audit_ok' },
        result: '稽查員翻著清潔表、溫度表、洗手紀錄，一頁頁蓋章，臨走前說：「這間店有在做。」',
      },
      {
        label: '請稽查員稍等，趕緊整理',
        result: '你拖了十分鐘去收拾廚房，看看稽查員的耐心。',
        chance: {
          p: 0.6,
          win: { effects: { money: -10000, risk: -4 }, result: '稽查員微笑說：「沒關係，我們可以等。」最後只開了一張小小的改善通知。' },
          lose: { effects: { money: -80000, reputation: -6, risk: 8 }, result: '稽查員看到後廚雜亂，記了五項缺失，罰單隔天就寄到。' },
        },
      },
      {
        label: '說今天不方便，請改天',
        effects: { money: -60000, reputation: -5, risk: 6 },
        result: '稽查員語氣平靜：「沒關係，我們下次再來。」下一次，他們帶了兩個人。',
      },
    ],
  },
  {
    id: 'fire_safety_check', cat: 'ops', title: '消防安檢', big: true, weight: 3, cooldownWeeks: 48,
    text: '消防局通知年度安檢：滅火器、逃生口、爐火自動斷火裝置都要看。',
    cond: { minLot: 2 },
    choices: [
      {
        label: '提前自行檢查並補齊設備', requires: { money: 100000 },
        effects: { money: -100000, reputation: 3, setFlag: 'fire_ok', risk: -6 },
        result: '補了兩支滅火器、換掉過期的逃生指示燈，安檢員巡完後留下「合格」兩個字。',
      },
      {
        label: '照例檢查，缺什麼補什麼',
        effects: { money: -40000, reputation: 1 },
        result: '缺失補齊了，雖然多花了點錢，但至少能安心過這一年。',
      },
      {
        label: '賭運氣，說上次就過了',
        result: '你跟同仁說「應該沒事」，等安檢員上門。',
        chance: {
          p: 0.5,
          win: { effects: {}, result: '安檢員檢查得不細，這次僥倖過關，你鬆了一口氣。' },
          lose: { effects: { money: -180000, reputation: -8, risk: 8 }, result: '安檢員發現滅火器過期、逃生口被堆貨，開罰單並限期改善。' },
        },
      },
    ],
  },
  {
    id: 'receipt_request', cat: 'ops', title: '客人要補開發票', big: false, weight: 6, cooldownWeeks: 12,
    text: '客人拿著一張兩個月前的收據：「老闆，公司要報帳，可以幫我補開發票嗎？」',
    cond: {},
    choices: [
      {
        label: '依規定補開，並登記',
        effects: { sat: 4, stamina: { role: 'cashier', delta: -3 } },
        result: '櫃檯翻了半小時的紀錄，總算找到對應的單子，客人很感動，還請大家喝了一杯飲料。',
      },
      {
        label: '說超過期限，不能補',
        result: '你依照規定婉拒了，看客人的反應。',
        chance: {
          p: 0.5,
          win: { effects: { sat: -2 }, result: '客人嘆了口氣，說：「好吧，那我再想想辦法。」' },
          lose: { effects: { sat: -6, reputation: -3 }, result: '客人氣得把收據塞回口袋，隔天在評論裡寫了「態度不佳」。' },
        },
      },
      {
        label: '請會計師協助處理', requires: { money: 5000 },
        effects: { money: -5000, sat: 2 },
        result: '會計師處理得很專業，客人收到發票時說了聲謝謝，你也鬆了一口氣。',
      },
    ],
  },
  {
    id: 'google_review_war', cat: 'ops', title: '一顆星的評論', big: false, weight: 6, cooldownWeeks: 16,
    text: '網路上冒出一則一顆星的評論：「等了四十分鐘，湯還是涼的。」下面有二十個人按了「有幫助」。',
    cond: { minRep: 20 },
    choices: [
      {
        label: '誠懇留言道歉，邀請再來，附贈招待券',
        effects: { money: -3000, reviewScore: 0.1, reputation: 1 },
        result: '評論者回覆：「看到你們的回應，我會再去一次。」按讚數一路往上爬。',
      },
      {
        label: '冷靜回覆事實與營業狀況',
        result: '你回覆了當天的出餐紀錄，看看反應。',
        chance: {
          p: 0.5,
          win: { effects: { reviewScore: 0.1, reputation: 2 }, result: '其他客人留言：「老闆很有誠意，下次我也要去。」' },
          lose: { effects: { reviewScore: -0.2, reputation: -4 }, result: '評論者回：「你們在狡辯。」這一回合，輸得很難看。' },
        },
      },
      {
        label: '不理會，專心出菜',
        effects: { reviewScore: -0.1 },
        result: '那則評論沒有人回，慢慢沉到下方，但也沒人記得你們有多認真。',
      },
    ],
  },
  {
    id: 'blogger_visit', cat: 'ops', title: '美食部落客來訪', big: false, weight: 6, cooldownWeeks: 24,
    text: '一位粉絲十萬的美食部落客走進店裡，舉著手機拍了一圈，問：「老闆，可以拍菜嗎？」',
    cond: { minRep: 60 },
    choices: [
      {
        label: '熱情招待，附上招牌菜',
        effects: { money: -8000, reputation: 10, reviewScore: 0.15, buff: { weeks: 4, label: '網紅加持', mods: { spawnMult: 0.08 } } },
        result: '影片上線第三天，店門口多了一條長長的人龍，老闆站在門口看了一眼，臉上全是笑。',
      },
      {
        label: '照常出菜，不特別招待',
        effects: { reputation: 3 },
        result: '部落客吃得滿意，影片雖然不長，但留言區有人說：「老闆很低調。」',
      },
      {
        label: '婉拒拍攝，說不想被打擾',
        effects: { reputation: -1 },
        result: '部落客點點頭收起手機，沒有再說什麼，只是離開前多看了招牌一眼。',
      },
    ],
  },
  {
    id: 'catering_order', cat: 'ops', title: '公司團膳訂單', big: false, weight: 6, cooldownWeeks: 24,
    text: '一家科技公司的總務來電：「我們想長期訂員工餐盒，每天一百份，你們能做嗎？」',
    cond: { minRep: 60 },
    choices: [
      {
        label: '承接，擴編備料人力', requires: { money: 80000 },
        effects: { money: -80000, reputation: 4, setFlag: 'catering_partner', buff: { weeks: 8, label: '團膳訂單', mods: { spawnMult: 0.06 } } },
        result: '團膳訂單穩定進來，同事們每天早上多了一道備料流程，帳上卻多了很穩的一筆現金流。',
      },
      {
        label: '只接部分，量力而為',
        effects: { money: -20000, reputation: 2, stamina: { delta: -5 } },
        result: '一百份縮成五十份，雙方都能接受，只是後廚的燈比平常多亮了兩個小時。',
      },
      {
        label: '婉拒，專心做內用',
        effects: { reputation: 0 },
        result: '總務客氣地說：「沒關係，下次有需要再聯絡。」',
      },
    ],
  },
  {
    id: 'farm_partner', cat: 'ops', title: '在地農場合作', big: false, weight: 6, cooldownWeeks: 24,
    text: '附近農場的老闆帶著一籃剛採的高麗菜上門：「老闆，我們直送，比批發市場新鮮，要不要簽長約？」',
    cond: { minYear: 1 },
    choices: [
      {
        label: '簽合作，標示「在地食材」',
        effects: { money: -15000, reputation: 4, buff: { weeks: 8, label: '在地食材', mods: { foodCost: -0.03 } }, risk: -3 },
        result: '菜單多了一行「在地小農直送」，客人說：「吃起來就是不一樣。」食材成本還降了一些。',
      },
      {
        label: '先小量試用',
        effects: { money: -3000, reputation: 1 },
        result: '試用了兩週，菜質確實不錯，但量不穩，主廚說：「先觀察看看。」',
      },
      {
        label: '婉拒，維持既有供應商',
        effects: {},
        result: '農場老闆留下名片和一小把青蔥，說：「想通了再找我。」你把名片放進了抽屜。',
      },
    ],
  },

  // ───────── D 類：季節與在地（season） ─────────
  {
    id: 'cold_soup_demand', cat: 'season', title: '寒流來襲，熱湯賣翻', big: false, weight: 10, cooldownWeeks: 40,
    text: '氣溫掉到十度，客人一進門第一句話：「老闆，有沒有熱湯？」湯鍋前排起了人龍。',
    cond: { weather: ['cold'] },
    choices: [
      {
        label: '加開湯鍋，多備一倍湯底', requires: { money: 30000 },
        effects: { money: -30000, buff: { weeks: 2, label: '熱湯加碼', mods: { spawnMult: 0.1, nhiTurnover: 0.05 } }, stamina: { delta: -6 } },
        result: '兩口大鍋同時冒著白煙，客人說「這種天氣喝這個最幸福」，湯鍋比往常早見底。',
      },
      {
        label: '照常供應，賣完為止',
        effects: { sat: 2 },
        result: '湯賣完之前一切順利，最後幾位客人只好改點別的，看起來有點失落。',
      },
      {
        label: '推出寒流限定薑母鴨',
        result: '你臨時推出一道限定菜，看看客人的反應。',
        chance: {
          p: 0.6,
          win: { effects: { money: 70000, reputation: 4 }, result: '限定薑母鴨賣到凌晨，主廚站在爐前汗流浹背，但笑得合不攏嘴。' },
          lose: { effects: { money: -20000 }, result: '備料太多沒賣完，晚上大家只好吃薑母鴨當員工餐，吃到想哭。' },
        },
      },
    ],
  },
  {
    id: 'cold_elder_breakfast', cat: 'season', title: '寒流長輩早餐客暴增', big: false, weight: 10, cooldownWeeks: 40,
    text: '寒流來襲，早上六點阿公阿嬤就在門口等，個個裹著厚外套，說：「老闆，快給我一碗熱的。」',
    cond: { weather: ['cold'] },
    choices: [
      {
        label: '提早開門，免費供應熱茶', requires: { money: 10000 },
        effects: { money: -10000, sat: 4, reputation: 3, stamina: { delta: -5 }, buff: { weeks: 2, label: '長輩熱茶', mods: { elderSat: 3 } } },
        result: '熱茶一杯杯遞出去，長輩們說：「老闆你人真好。」這個冬天，你贏得了一整個社區。',
      },
      {
        label: '照常營業，增加座位',
        effects: { buff: { weeks: 2, label: '長輩早餐潮', mods: { spawnMult: 0.08 } }, stamina: { delta: -6 } },
        result: '座位不夠，大家擠在一起，反而更熱鬧，一位阿嬤說：「這樣才像一家人。」',
      },
      {
        label: '限量供應，早點賣完早點休息',
        effects: { sat: -4, reputation: -2 },
        result: '賣完的牌子一掛，後面的長輩有點失落，默默走回家。',
      },
    ],
  },
  {
    id: 'plum_rain_floor', cat: 'season', title: '梅雨季地板濕滑', big: false, weight: 10, cooldownWeeks: 40,
    text: '梅雨連下兩週，門口的地磚濕得像溜冰場，服務生端著湯小心翼翼。',
    cond: { weatherId: 'plumrain' },
    choices: [
      {
        label: '鋪防滑墊並放黃色警示牌', requires: { money: 20000 },
        effects: { money: -20000, buff: { weeks: 4, label: '防滑墊', mods: { slipRisk: -0.25 } }, stamina: { delta: -2 } },
        result: '防滑墊鋪滿入口，服務生走路穩了，客人說：「這家店很細心。」',
      },
      {
        label: '請服務生隨時拖地',
        effects: { stamina: { delta: -8 }, buff: { weeks: 3, label: '勤拖地', mods: { slipRisk: -0.1 } } },
        result: '拖把一天不離手，服務生說：「我這輩子沒拖過這麼多地。」',
      },
      {
        label: '不特別處理',
        effects: { buff: { weeks: 3, label: '地板濕滑', mods: { slipRisk: 0.3 } } },
        result: '地板越來越滑，下午有兩位客人差點摔倒，大家看到心都漏跳一拍。',
      },
    ],
  },
  {
    id: 'typhoon_aftermath', cat: 'season', title: '颱風假隔天補餐潮', big: false, weight: 10, cooldownWeeks: 40,
    text: '颱風過後隔天天氣放晴，大家被關在家兩天，一起湧向餐廳：「老闆，我們餓了！」',
    cond: { months: [7, 8, 9, 10], weather: ['sunny', 'cloudy', 'rain'] },
    choices: [
      {
        label: '全員備戰，延長營業時間', requires: { money: 20000 },
        effects: { money: -20000, buff: { weeks: 2, label: '颱風補餐潮', mods: { spawnMult: 0.15 } }, stamina: { delta: -10 } },
        result: '連續兩天的人潮把店擠得水洩不通，大家累翻了，但帳上的數字很漂亮。',
      },
      {
        label: '照常營業，限量供應',
        effects: { buff: { weeks: 2, label: '颱風補餐潮', mods: { spawnMult: 0.08 } }, stamina: { delta: -5 } },
        result: '賣到一半就沒料了，客人轉頭去隔壁，只留下一聲嘆息。',
      },
      {
        label: '休息兩天，讓同仁補眠',
        effects: { morale: { delta: 5 }, sat: -3 },
        result: '大家睡得飽飽的，但門口貼著「今日休息」的公告，餓肚子的客人有點哀怨。',
      },
    ],
  },
  {
    id: 'cny_reunion', cat: 'season', title: '年夜飯預訂爆滿', big: false, weight: 10, cooldownWeeks: 48,
    text: '農曆年前，電話響個不停：「老闆，除夕夜還有位子嗎？我們一桌十二個人！」',
    cond: { months: [1, 2] },
    choices: [
      {
        label: '推出年菜套餐，預約制', requires: { money: 40000 },
        effects: { money: -40000, buff: { weeks: 3, label: '年菜預約', mods: { spawnMult: 0.1, selfPayConv: 0.05 } }, stamina: { delta: -8 } },
        result: '年菜預約單堆了半面牆，主廚一邊切一邊算，除夕當天煮出了十二桌團圓飯。',
      },
      {
        label: '照常營業，歡迎現場排隊',
        effects: { buff: { weeks: 2, label: '年前人潮', mods: { spawnMult: 0.06 } } },
        result: '現場排隊的人很多，有人等了一個小時還笑著說：「這是過年的氣氛啦。」',
      },
      {
        label: '提前休息，回家過年',
        effects: { morale: { delta: 6 }, reputation: -2 },
        result: '大家開開心心地回家，只是有幾位老客人撲了個空，在門口嘆了口氣。',
      },
    ],
  },
  {
    id: 'cny_closing', cat: 'season', title: '春節休業前後', big: false, weight: 10, cooldownWeeks: 48,
    text: '春節假期前後，大家都想請假，客人也搞不清楚哪天有開。',
    cond: { months: [1, 2] },
    choices: [
      {
        label: '貼出營業時間表，給全員紅包', requires: { money: 20000 },
        effects: { money: -20000, morale: { delta: 8 }, reputation: 2, stamina: { delta: 5 } },
        result: '紅包袋上印著「新年快樂」，同仁拿到後笑得合不攏嘴，下半年的士氣都跟著高漲。',
      },
      {
        label: '輪流休假，維持基本營業',
        effects: { buff: { weeks: 2, label: '輪休營業', mods: { spawnMult: -0.05 } }, morale: { delta: 3 } },
        result: '店裡雖然人少，但客人也少，大家悠閒地過了這個年。',
      },
      {
        label: '全部營業，加班補貼',
        effects: { money: -40000, stamina: { delta: -12 }, morale: { delta: -5 }, buff: { weeks: 2, label: '春節不打烊', mods: { spawnMult: 0.08 } } },
        result: '春節還在營業的店不多，客人感激，同仁累癱。',
      },
    ],
  },
  {
    id: 'school_lunch', cat: 'season', title: '開學季學生午餐團購', big: false, weight: 10, cooldownWeeks: 40,
    text: '開學後附近高中的學生會長來問：「老闆，我們班想團購，你能給個折扣嗎？」',
    cond: { months: [9, 2, 3] },
    choices: [
      {
        label: '推出學生團購套餐，九折', requires: { money: 15000 },
        effects: { money: -15000, reputation: 3, buff: { weeks: 6, label: '學生團購', spawn: { student: 0.3 } } },
        result: '學生團購一推出，下課鐘聲一響，店裡擠滿了穿制服的孩子，吵吵鬧鬧的。',
      },
      {
        label: '只提供集點卡',
        effects: { money: -3000, buff: { weeks: 4, label: '集點卡', spawn: { student: 0.15 } } },
        result: '集點卡發出去一百張，學生說：「集滿十點可以換一杯飲料欸！」',
      },
      {
        label: '婉拒，不打折',
        effects: { reputation: -1 },
        result: '學生會長聳聳肩說：「那我們去隔壁看看。」',
      },
    ],
  },
  {
    id: 'summer_ice', cat: 'season', title: '暑假冰品旺季', big: false, weight: 10, cooldownWeeks: 48,
    text: '暑假一到，冰品檯前每天排隊，店員說：「這個夏天我們賣的冰比飯還多。」',
    cond: { months: [7, 8] },
    choices: [
      {
        label: '推出夏季限定冰品', requires: { money: 20000 },
        effects: { money: -20000, buff: { weeks: 4, label: '夏季冰品', mods: { selfPayConv: 0.05, spawnMult: 0.06 } }, stamina: { delta: -6 } },
        result: '芒果冰、楊桃冰、仙草冰輪番登場，客人在冷氣房裡吃冰，滿足得不想離開。',
      },
      {
        label: '增加冷氣與座位',
        effects: { money: -30000, buff: { weeks: 4, label: '冷氣加強', mods: { patience: 0.05 } } },
        result: '冷氣開強一點，客人說「這家最涼快」，坐得比較久，翻桌率稍降一點。',
      },
      {
        label: '照常營業',
        effects: {},
        result: '夏天來了又走，你只覺得汗流不停，生意不好不壞。',
      },
    ],
  },
  {
    id: 'night_market_fest', cat: 'season', title: '在地夜市嘉年華', big: false, weight: 10, cooldownWeeks: 40,
    text: '市公所舉辦夜市嘉年華，店門口的街道會封起來擺攤：「老闆，要不要一起參加？」',
    cond: { months: [10, 11, 12, 3] },
    choices: [
      {
        label: '設攤位，推出小吃套餐', requires: { money: 50000 },
        effects: { money: -50000, reputation: 6, buff: { weeks: 3, label: '夜市嘉年華', mods: { spawnMult: 0.12 } }, stamina: { delta: -10 } },
        result: '攤位前人擠人，同仁忙到汗濕背心，但看到客人拿著餐點笑，大家都覺得值得。',
      },
      {
        label: '只提供優惠券',
        effects: { money: -8000, reputation: 2, buff: { weeks: 2, label: '嘉年華優惠券', mods: { spawnMult: 0.04 } } },
        result: '優惠券發了五百張，有一半的人說：「下次一定去。」',
      },
      {
        label: '不參加，專心經營店面',
        effects: {},
        result: '夜市嘉年華熱熱鬧鬧地舉辦了，你站在店門口看著人潮，覺得有點羨慕。',
      },
    ],
  },
  {
    id: 'temple_procession', cat: 'season', title: '遶境進香', big: false, weight: 10, cooldownWeeks: 48,
    text: '媽祖遶境經過店門口，信眾排成長龍，鑼鼓聲震得鍋蓋都在跳舞。',
    cond: { months: [3, 4] },
    choices: [
      {
        label: '設攤供應免費熱茶與點心', requires: { money: 25000 },
        effects: { money: -25000, reputation: 8, buff: { weeks: 2, label: '遶境結緣', mods: { spawnMult: 0.1, elderSat: 3 } }, stamina: { delta: -8 } },
        result: '信眾們拿著熱茶點頭致意，有人說：「老闆人真好，我下次一定來吃。」',
      },
      {
        label: '照常營業，順便賣便當',
        effects: { buff: { weeks: 2, label: '遶境人潮', mods: { spawnMult: 0.08 } }, stamina: { delta: -6 } },
        result: '便當賣了四百個，主廚的手腕痠痛到晚上，但帳上漂亮。',
      },
      {
        label: '關門避開人潮',
        effects: { morale: { delta: 3 }, reputation: -2 },
        result: '門口貼著「遶境暫停營業」，信眾們紛紛轉往別家。',
      },
    ],
  },
  {
    id: 'parents_day', cat: 'season', title: '母親節與重陽敬老餐', big: false, weight: 10, cooldownWeeks: 48,
    text: '母親節與重陽節快到了，訂位電話響不停：「老闆，我想請媽媽吃頓好的。」',
    cond: { months: [5, 10] },
    choices: [
      {
        label: '推出節日套餐，附贈小禮', requires: { money: 30000 },
        effects: { money: -30000, reputation: 5, buff: { weeks: 3, label: '節日套餐', mods: { selfPayConv: 0.06, elderSat: 3 } } },
        result: '節日套餐附上一朵康乃馨與手寫卡片，許多阿嬤眼眶泛紅地說：「謝謝你們的心意。」',
      },
      {
        label: '提供免費甜湯',
        effects: { money: -5000, sat: 3, reputation: 2 },
        result: '甜湯一碗碗送出去，長輩們說：「這個甜度剛剛好。」',
      },
      {
        label: '照常營業',
        effects: {},
        result: '節日還是一般的節日，客人來了、吃了、結帳了。',
      },
    ],
  },
  {
    id: 'yearend_bento', cat: 'season', title: '尾牙春酒加班便當', big: false, weight: 10, cooldownWeeks: 48,
    text: '年底各公司忙著加班與尾牙，訂便當、訂桌的電話一通接一通：「老闆，我們公司要訂五十份。」',
    cond: { months: [11, 12] },
    choices: [
      {
        label: '接團體訂單，專人外送', requires: { money: 40000 },
        effects: { money: -40000, reputation: 4, buff: { weeks: 4, label: '年終團膳', spawn: { office: 0.3 } }, stamina: { delta: -10 } },
        result: '五十份便當準時送到，總務笑著說：「你們家果然靠譜。」下個月他們又訂了一次。',
      },
      {
        label: '只接內用團體訂位',
        effects: { money: -5000, buff: { weeks: 3, label: '尾牙訂位', spawn: { office: 0.15 } } },
        result: '一桌桌尾牙宴席排滿整週，大家熱熱鬧鬧乾杯，店裡充滿笑聲。',
      },
      {
        label: '婉拒，人手不夠',
        effects: { reputation: -1 },
        result: '總務客氣地說：「沒關係，下次有需要再聯絡。」',
      },
    ],
  },
];
