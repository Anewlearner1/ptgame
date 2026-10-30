// Extended events, part A: 食安與營運 A01–A14 and 客人與溝通 B01–B16 (30 events).
// Spec: docs/EVENTS_EXT.md (schema, effects, cond); the restaurant versions follow docs/RESTAURANT_DESIGN.md.
//
// Conventions used here:
// - `chance.p` = probability of the `win` branch. `win` is always the favourable or neutral branch,
//   so a line like "30%：被追查" is written as p: 0.7 (win = 沒事) and lose = 被追查.
// - Choices with `chance` repeat the non-random effects in both branches (chance and effects are exclusive).
// - Money is plain NT$ (-50000 = NT$ -50,000).
// - Flags: `injury` (set by the fryer-burn / allergy negative choices, consumed by dispute_mediation), `oil_log` (fryer_burn),
//   `allergen_chart` (allergy_alert), `vegan_menu` (vegan_ask), `groupon_paused` (groupon_dispute).
// - followUp: fryer_burn and allergy_alert negative choices -> `dispute_mediation` after 2 weeks.
// - cat 'safety' events weigh x2 while 食安風險 (state.safety.risk) > 60.

export const EVENTS_EXT_A = [
  // ---------- A. 食安與營運 ----------
  {
    id: 'ratio_review', cat: 'safety', title: '衛生局抽驗：食材標示對不上', big: true, weight: 3, cooldownWeeks: 12,
    text: '衛生局來函說：「貴店菜單標示與抽驗結果不一致。」老闆看著菜單，菜單也看著老闆。',
    cond: { minYear: 1, riskAtLeast: 25 },
    choices: [
      {
        label: '補齊進貨單與食材標示，全力備查',
        effects: { money: -50000, reputation: 2, risk: -10 },
        result: '同仁熬夜把每一包食材的進貨單補得整整齊齊，稽查員看完點點頭：「這樣就清楚了。」',
      },
      {
        label: '申覆，賭一把',
        result: '送出申覆，等待回音。',
        chance: {
          p: 0.5,
          win: { effects: { money: 100000, reputation: 3 }, result: '申覆成功，罰款退了回來，老闆把那張退款通知裱框掛在櫃檯後面。' },
          lose: { effects: { money: -80000, reputation: -3, risk: 6 }, result: '申覆沒過，罰款照繳，老闆說：「賭輸就是輸，下次不賭了。」' },
        },
      },
      {
        label: '認賠，並調整菜單標示',
        effects: { money: -30000, risk: -15 },
        result: '菜單標示重新校對過，過敏原也列清楚，帳上少了一筆錢，多了一本教訓。',
      },
    ],
  },
  {
    id: 'delivery_commission', cat: 'safety', title: '外送平台調漲抽成', big: true, weight: 3, cooldownWeeks: 24,
    text: '外送平台通知：「為提供更優質服務，下月起抽成調整為 35%。」同仁私下說：「我們賣越多，他賺越多。」',
    cond: { minYear: 2 },
    choices: [
      {
        label: '提高外送菜單價格，轉嫁給客人',
        effects: { sat: -3, reputation: -1, buff: { weeks: 6, label: '外送調價', mods: { selfPayPrice: 0.05 } } },
        result: '外送價比內用貴了兩成，有客人在評論裡寫：「內用比較划算。」你也覺得。',
      },
      {
        label: '推自家 LINE 訂餐，搶回客人',
        effects: { money: -60000, reputation: 2, buff: { weeks: 6, label: '自家訂餐', mods: { spawnMult: 0.04 } } },
        result: '櫃檯貼出 QR Code，第一週有阿姨掃了三次，說：「這個我會用，比較不用等外送。」',
      },
      {
        label: '吞下去，繼續接單',
        result: '決定先忍耐，看看這個月的帳單。',
        chance: {
          p: 0.5,
          win: { effects: { money: -40000 }, result: '單量沒掉，毛利薄了一圈，會計把報表轉了九十度才看出差別。' },
          lose: { effects: { money: -160000, morale: { delta: -4 } }, result: '單量下滑、毛利又薄，月底一看帳，大家都沒說話。' },
        },
      },
    ],
  },
  {
    id: 'fridge_log_missing', cat: 'safety', title: '冷藏溫度紀錄漏登', big: false, weight: 6, cooldownWeeks: 24,
    text: '月底對帳發現三十幾天的冷藏溫度表是空白的，店員的筆在抽屜裡集體失蹤。',
    cond: {},
    choices: [
      {
        label: '全員補登週（週末加班）',
        effects: { stamina: { delta: -15 }, morale: { delta: -5 } },
        result: '週末的店裡只剩影印機的聲音，大家一張一張補登，簽到手都快抽筋。',
      },
      {
        label: '導入電子溫度記錄器',
        effects: { money: -60000, risk: -9 },
        result: '感應器掛在冰箱裡，手機會自己收溫度。第一天就有人問：「這個要按哪裡？」不過之後再也沒漏過。',
      },
      {
        label: '這些先不補',
        effects: { risk: 8, money: -20000 },
        result: '那幾張表被收進另一個抽屜，抽屜倒是變乾淨了，風險分數卻悄悄往上爬。',
      },
    ],
  },
  {
    id: 'regular_credit', cat: 'safety', title: '常客想賒帳', big: false, weight: 6, cooldownWeeks: 24,
    text: '老王天天來吃，今天掏了半天口袋：「老闆，我下禮拜一起付啦！」',
    cond: {},
    choices: [
      {
        label: '好，記帳，老客人信得過',
        effects: { sat: 5, money: -3000, reputation: 1 },
        result: '老王感動到說下次帶朋友來，只是記帳本上那一行，後來你找了兩個禮拜才找到。',
      },
      {
        label: '客氣地說店裡不賒帳',
        effects: { sat: -3, reputation: 1 },
        result: '老王尷尬地去提款機領錢，回來點了兩份，說：「好啦，我懂規矩。」',
      },
      {
        label: '請他先吃，下次補付並登記',
        effects: { money: 0, sat: 3, risk: 0 },
        result: '老王下禮拜一準時付清，還多給了兩罐飲料。這種信任，是無價的。',
      },
    ],
  },
  {
    id: 'cook_cap', cat: 'safety', title: '廚師今天出餐爆表', big: false, weight: 6, cooldownWeeks: 24,
    text: '計數器顯示小林廚師今天已經炒了第 46 份，他的手也在抗議。',
    cond: { hasStaff: { cook: 1 } },
    choices: [
      {
        label: '加聘臨時工幫忙備料',
        effects: { money: -90000, stamina: { role: 'cook', delta: 5 } },
        result: '臨時工第一天上班，把備料單多看了三遍，總算鬆了一口氣。',
      },
      {
        label: '限量供應，賣完為止',
        effects: { money: -60000, sat: -6, reputation: -3 },
        result: '賣完的菜在黑板上畫了大叉叉，排隊的阿伯有點不高興，說老闆是不是要改成抽籤。',
      },
      {
        label: '照做，超過的當招待',
        effects: { money: -40000, stamina: { role: 'cook', delta: -12 }, morale: { role: 'cook', delta: -4 } },
        result: '超量的那幾桌都招待完，廚師的手臂抗議到第二天才停。',
      },
    ],
  },
  {
    id: 'label_mismatch', cat: 'safety', title: '菜單標示和實際食材對不上', big: true, weight: 3, cooldownWeeks: 24,
    text: '行政發現菜單寫的「手工」，和實際用的半成品對不上，主廚與廚師都說：「我以為你會改。」',
    cond: { hasStaff: { chef: 1, cook: 1 } },
    choices: [
      {
        label: '立刻內部稽核，更正菜單',
        effects: { money: -40000, reputation: 2, risk: -10 },
        result: '稽核人員連夜翻出三個月的進貨單，更正菜單一張張重印，整間店像開了一場小型會議。',
      },
      {
        label: '補聘主廚專責研發，廚師專做出餐',
        effects: { money: -100000, points: { culinary: 5 } },
        result: '新來的主廚專心做招牌，廚師也能專注出餐，客人說這陣子菜的味道穩了。',
      },
      {
        label: '名稱而已啦',
        result: '維持現狀，賭它不會被查。',
        chance: {
          p: 0.7,
          win: { effects: {}, result: '這次沒被查到，大家鬆了一口氣，只是名字的小差異還在那裡等著。' },
          lose: { effects: { money: -300000, reputation: -10 }, result: '有人來查，發現標示對不上，罰單寄到門口，老闆還在說：「只是名稱而已啦。」' },
        },
      },
    ],
  },
  {
    id: 'neighbor_scandal', cat: 'safety', title: '同業爆出食安事件', big: false, weight: 6, cooldownWeeks: 24,
    text: '新聞說隔壁街的餐廳被查到用過期食材，客人們到處問：「你們有沒有這樣？」',
    cond: { minRep: 40 },
    choices: [
      {
        label: '貼公告：食材來源公開、每日進貨登記',
        effects: { money: -10000, reputation: 4 },
        result: '公告貼在點餐櫃檯旁，阿嬤看了點頭：「這樣我就放心了。」',
      },
      {
        label: '只回答「我們合法啦」',
        effects: { reputation: 1 },
        result: '阿嬤回去跟鄰居說老闆說他們合法，鄰居問：「那有沒有被罰？」阿嬤說：「沒問。」',
      },
      {
        label: '趁機接收對方流失的客人',
        effects: { buff: { weeks: 4, label: '同業流失客人', mods: { spawnMult: 0.1 } }, stamina: { delta: -8 } },
        result: '有幾位客人被新聞嚇到，轉來這裡，同仁忙到腳都站麻了。',
      },
    ],
  },
  {
    id: 'egg_price', cat: 'safety', title: '食材行情大漲', big: false, weight: 6, cooldownWeeks: 36,
    text: '進貨單寄到：蛋價又漲了。會計小姐說：「我們賣得越多，每份越不賺錢。」',
    cond: { months: [3, 6, 9, 12] },
    choices: [
      {
        label: '菜單微調價格，說明食材成本',
        effects: { money: -10000, sat: -2, buff: { weeks: 6, label: '菜單調價', mods: { selfPayPrice: 0.05 } } },
        result: '菜單上每道菜漲了五塊十塊，有位阿姨說：「雞蛋貴我知道啦，沒關係。」',
      },
      {
        label: '換便宜的供應商，控制成本',
        effects: { buff: { weeks: 4, label: '換供應商', mods: { foodCost: -0.04 } }, reputation: -1 },
        result: '新供應商的蛋略小一點，客人沒吃出差別，只有主廚覺得蛋黃少了一點味道。',
      },
      {
        label: '先吞下去',
        effects: { morale: { delta: -5 }, buff: { weeks: 4, label: '食材漲價', mods: { foodCost: 0.05 } } },
        result: '大家都沒說話，只是把計算機又按了一次，數字還是一樣。',
      },
    ],
  },
  {
    id: 'supplier_clawback', cat: 'safety', title: '供應商對帳差額追討', big: true, weight: 3, cooldownWeeks: 36,
    text: '供應商寄來「貨款對帳差額」通知，老闆看了三遍，數字沒有變。',
    cond: { months: [3, 6, 9, 12] },
    choices: [
      {
        label: '早就提列準備金',
        effects: { money: -100000 },
        result: '準備金早就在帳上等著，追討金額來的時候，會計只淡淡地說：「有準備就不慌。」',
      },
      {
        label: '照樣花，扣到再說',
        effects: { money: -200000 },
        result: '帳戶餘額像退潮一樣往下掉，老闆開始每天早上先看銀行，才敢喝咖啡。',
      },
      {
        label: '申請分期',
        effects: { money: -40000 },
        result: '分期的利息不便宜，但現金流總算能喘口氣，只是每個月都要記得還。',
      },
    ],
  },
  {
    id: 'survey_call', cat: 'safety', title: '衛生局電話抽訪客人', big: false, weight: 6, cooldownWeeks: 16,
    text: '阿伯接到電話被問：「你上禮拜有去那家店吃飯嗎？衛生狀況怎麼樣？」他回頭問櫃檯：「我有去嗎？」',
    cond: { minYear: 1 },
    choices: [
      {
        label: '告訴客人：據實回答就好',
        effects: { reputation: 3 },
        result: '客人開始照實回答，電話那頭的訪員也說：「原來是這樣喔，謝謝你。」',
      },
      {
        label: '請同仁整理進貨與清潔紀錄，備查',
        effects: { money: -10000, risk: -5 },
        result: '資料夾排得很整齊，每一通電話都能對得上日期。',
      },
      {
        label: '提醒大家「怎麼回答比較好」',
        result: '把提醒寫進交代單，然後靜待結果。',
        chance: {
          p: 0.5,
          win: { effects: {}, result: '這次沒被發現，同仁互相看了一眼，誰也不敢再提這句話。' },
          lose: { effects: { money: -50000, reputation: -8, risk: 8 }, result: '被發現了，訪問紀錄寫得清清楚楚，被開了罰單。' },
        },
      },
    ],
  },
  {
    id: 'regular_guest', cat: 'safety', title: '每週三必來的老客人', big: false, weight: 6, cooldownWeeks: 24,
    text: '阿伯每週三準時報到，一碗湯、聊天、順便評論店裡的椅子，已經變成里的新聞台。',
    cond: {},
    choices: [
      {
        label: '推薦他嘗試新菜單，換換口味',
        effects: { sat: -2, reputation: 3, points: { culinary: 5 } },
        result: '阿伯被推薦了三道新菜，抱怨了三天，第四天就開始點新菜了。',
      },
      {
        label: '請他幫忙介紹鄰居來吃',
        effects: { reputation: 5, sat: 2 },
        result: '阿伯介紹了一整個社區的老人，下禮拜三店裡多了五位新朋友。',
      },
      {
        label: '照單全收，免費續湯',
        effects: { money: -4000, sat: 5, reputation: 1 },
        result: '阿伯續了四次湯，笑得很開心，今天的湯鍋比往常早見底。',
      },
    ],
  },
  {
    id: 'diet_news', cat: 'safety', title: '新聞說油炸食品不健康', big: false, weight: 6, cooldownWeeks: 24,
    text: '店裡電視在播「油炸食品吃多了傷身」，所有人同時看向炸物區的廚師。',
    cond: { minRep: 30 },
    choices: [
      {
        label: '推出「少油氣炸」新品項',
        effects: { money: -40000, points: { culinary: 8 }, reputation: 4 },
        result: '菜單多了一頁氣炸系列，排隊的阿伯問：「這個沒有炸那麼油喔？」廚師說：「對，一樣酥。」',
      },
      {
        label: '貼出用油更換日誌，公開透明',
        effects: { money: -5000, reputation: 2, risk: -3 },
        result: '用油日誌貼在牆上，阿姨們看了說：「原來你們每天都換，這樣我就放心了。」',
      },
      {
        label: '不理會',
        effects: { sat: -3 },
        result: '電視還在播，客人一臉懷疑，接下來幾天的滿意度也跟著往下掉。',
      },
    ],
  },
  {
    id: 'supplier_upgrade', cat: 'safety', title: '供應商的「優化」建議', big: true, weight: 3, cooldownWeeks: 24,
    text: '供應商業務笑著說：「把和牛換成進口肉，標示寫一樣，沒人吃得出來啦。」',
    cond: {},
    choices: [
      {
        label: '婉拒',
        effects: { reputation: 2 },
        result: '業務聳聳肩，把名片留在桌上，老闆把名片收進抽屜，說：「以後再說。」',
      },
      {
        label: '只做有實際成分相符的合理調整',
        effects: { money: 60000, risk: 3 },
        result: '調整只限成分真的符合的品項，帳面雖然沒那麼好看，但老闆睡得比較安穩。',
      },
      {
        label: '大幅「優化」，標示照舊',
        result: '照業務的方式大幅調整食材內容。',
        chance: {
          p: 0.3,
          win: { effects: { money: 200000 }, result: '這次沒被發現，帳上多了一大筆數字，業務得意地說：「我就說沒人吃得出來吧。」' },
          lose: { effects: { money: -200000, reputation: -12, risk: 12 }, result: '後來被抽驗，標示不實被開罰，補件補到天昏地暗，這筆錢回頭又吐了出去。' },
        },
      },
    ],
  },
  {
    id: 'gmp_update', cat: 'safety', title: '食品良好衛生規範改版', big: false, weight: 6, cooldownWeeks: 24,
    text: '新規範共 37 頁，其中 3 頁真的重要，但沒人知道是哪 3 頁。',
    cond: { minYear: 2 },
    choices: [
      {
        label: '辦內部讀書會，一人認養一章',
        effects: { money: -30000, risk: -6, stamina: { delta: -4 } },
        result: '讀書會開了三次，最後大家一致認為第 12 頁最重要，因為大家都在第 12 頁睡著了。',
      },
      {
        label: '交給行政自己看',
        result: '把厚厚的規範交給行政，自己先去忙別的。',
        chance: {
          p: 0.6,
          win: { effects: {}, result: '行政看完說：「應該沒差。」運氣好，這次沒有後果。' },
          lose: { effects: { money: -40000, risk: 6 }, result: '行政漏看了一條規定，稽查時被點出來，罰了一筆小錢。' },
        },
      },
      {
        label: '加入餐飲公會與同業社群討論',
        effects: { money: -10000, risk: -3 },
        result: '社群裡有人分享整理好的重點表，大家邊看邊罵，但至少罵得有方向。',
      },
    ],
  },

  // ---------- B. 客人與溝通 ----------
  {
    id: 'invoice_pad', cat: 'patient', title: '客人想開「寫多一點」的發票', big: true, weight: 3, cooldownWeeks: 12,
    text: '大哥說：「老闆，發票金額幫我寫多一點，公司才會報帳。」',
    cond: {},
    choices: [
      {
        label: '依實際消費如實開立',
        effects: { sat: -6, reputation: 3 },
        result: '客人嘆了口氣，收下發票說：「好吧，那我再去跟公司講。」',
      },
      {
        label: '如實開立，並附明細可供核對',
        effects: { money: -5000, reputation: 2 },
        result: '發票附上明細表，客人似懂非懂地點頭，說明細表看起來比較專業。',
      },
      {
        label: '稍微寫多一點',
        result: '把發票金額稍微加了一點，然後靜待結果。',
        chance: {
          p: 0.7,
          win: { effects: { sat: 8, money: 30000 }, result: '客人笑得很開心，報帳似乎很順利，沒有人來追查。' },
          lose: { effects: { sat: 8, money: -220000, reputation: -12 }, result: '後來有人來查帳，那張發票被圈了起來，罰款加上律師費，老闆有點想哭。' },
        },
      },
    ],
  },
  {
    id: 'injury_claim', cat: 'patient', title: '店內燙傷想請款', big: true, weight: 3, cooldownWeeks: 12,
    text: '客人拿著一疊醫療單據：「老闆說要找保險，保險說要找店家。」',
    cond: {},
    choices: [
      {
        label: '協助釐清流程，一起填保險申請',
        effects: { money: -10000, sat: 8, reputation: 4 },
        result: '櫃檯幫忙畫出流程圖，客人拿到理賠通知時，感動得差點把流程圖也一起裱框。',
      },
      {
        label: '只出醫療費補貼',
        effects: { money: -20000, sat: -2 },
        result: '補貼金額確認了，但流程還是客人自己跑，他一路念念有詞地走出店。',
      },
      {
        label: '請他自行向保險公司申請',
        effects: { sat: -5, reputation: 1 },
        result: '客人被轉到保險公司，多了一條路，只是少了一點被照顧的感覺。',
      },
    ],
  },
  {
    id: 'banquet_mismatch', cat: 'patient', title: '宴席訂位名單和菜單對不上', big: true, weight: 3, cooldownWeeks: 8,
    text: '訂位客人傳來訊息：「我們是十二位，不是十位。」那一個差距是兩個空位。',
    cond: {},
    choices: [
      {
        label: '逐一核對、加位、重新排單',
        effects: { money: -5000, sat: 5 },
        result: '逐一核對完，多出的兩份餐點加上了，客人說：「原來差兩位這麼麻煩，謝謝你。」',
      },
      {
        label: '請客人自己再聯絡確認',
        effects: { sat: -5 },
        result: '客人打了三通電話，最後還是回來問：「老闆，你可以再排一次嗎？」',
      },
      {
        label: '開店內制式訂位確認單',
        effects: { money: -10000 },
        result: '確認單印了一百張，之後遇到訂位的客人都能拿到一張，效率變高了。',
      },
    ],
  },
  {
    id: 'stomach_ache', cat: 'patient', title: '客人說吃完肚子痛', big: false, weight: 6, cooldownWeeks: 12,
    text: '一位客人隔天回來，手摸著肚子：「老闆，我昨天吃完那份滷味，一直不舒服。」',
    cond: {},
    choices: [
      {
        label: '立刻道歉，並檢查昨天的食材',
        effects: { money: -15000, sat: 6, reputation: 3, risk: -4 },
        result: '食材批次一筆筆核對，其實是客人前一晚吃了別的。他說：「原來不是你們的問題，謝謝你查得這麼仔細。」',
      },
      {
        label: '送一份飲品，請客人多休息',
        effects: { money: -2000, sat: 2 },
        result: '客人喝完熱茶說比較舒服了，嘴上說「下次再來」，眼神有點遲疑。',
      },
      {
        label: '否認，說我們的食材很新鮮',
        effects: { sat: -8, reputation: -6 },
        result: '客人氣得轉身離開，不久後網路上多了一則寫得很長的評論。',
      },
    ],
  },
  {
    id: 'discount_beg', cat: 'patient', title: '「老闆，幫我算便宜一點啦」', big: false, weight: 6, cooldownWeeks: 12,
    text: '阿姨手上拿著折價券，笑嘻嘻地說：「這個過期兩天了，老闆你幫我算一下嘛～」',
    cond: {},
    choices: [
      {
        label: '好啦，破例這次',
        effects: { money: -2000, sat: 6, reputation: 1 },
        result: '阿姨開心地多點了一道菜，說：「老闆你人最好！」',
      },
      {
        label: '婉拒，但送一份小菜',
        effects: { money: -1000, sat: 3 },
        result: '阿姨笑著說：「好啦好啦，有送就好。」下次她還是會拿過期的券來。',
      },
      {
        label: '按規定婉拒',
        effects: { sat: -4, reputation: 1 },
        result: '阿姨嘟著嘴說：「好吧好吧，你們真嚴。」',
      },
    ],
  },
  {
    id: 'vegan_ask', cat: 'patient', title: '「有素食嗎？有英文菜單嗎？」', big: false, weight: 6, cooldownWeeks: 24,
    text: '一組外國遊客和一位素食客人同時問：「你們有素食嗎？有英文菜單嗎？」',
    cond: { hasStaff: { chef: 1 } },
    choices: [
      {
        label: '研發一組素食套餐與英文菜單',
        effects: { money: -50000, reputation: 4, points: { culinary: 6 }, setFlag: 'vegan_menu' },
        result: '菜單多了一頁素食與英文，外國客人拍了一張照發到社群，隔週店裡多了兩組國際客人。',
      },
      {
        label: '口頭說明，請客人自行調整',
        effects: { sat: -2 },
        result: '客人看了看菜單，點了白飯加青菜，說：「好吧，這樣也可以。」',
      },
      {
        label: '婉拒，說我們主打傳統口味',
        effects: { reputation: -1 },
        result: '客人點點頭離開了，說：「那下次再來。」你不確定有沒有下次。',
      },
    ],
  },
  {
    id: 'steak_price', cat: 'patient', title: '特餐比隔壁貴', big: false, weight: 6, cooldownWeeks: 24,
    text: '客人在櫃檯比較：「隔壁牛排才四百，你們要六百八，差在哪？」',
    cond: { hasObject: ['chef_table'] },
    choices: [
      {
        label: '耐心介紹肉品來源與熟成方式',
        effects: { sat: 2, reputation: 3, points: { service: 3 } },
        result: '客人聽完熟成櫃的故事，說：「原來是這樣，那我點一份試試。」',
      },
      {
        label: '推出限量體驗價',
        effects: { money: -20000, buff: { weeks: 3, label: '特餐體驗價', mods: { selfPayConv: 0.04 } } },
        result: '體驗價推出的第一週，主廚餐檯前排滿了人，主廚額頭冒汗但笑得很開心。',
      },
      {
        label: '不二價，愛吃不吃',
        effects: { sat: -3, reputation: -1 },
        result: '客人悻悻然走了，過了幾週又回來，說：「我還是想試試看你們的。」',
      },
    ],
  },
  {
    id: 'groupon_dispute', cat: 'patient', title: '團購券被拒用', big: false, weight: 6, cooldownWeeks: 24,
    text: '客人拿出團購券：「上面寫平日通用，為什麼你說不能用？」旁邊還有三位客人在看。',
    cond: {},
    choices: [
      {
        label: '照團購券規定接受',
        effects: { money: -3000, sat: 4, reputation: 2 },
        result: '客人點頭微笑，說：「這樣就對了。」旁邊的客人也默默把團購券收回口袋。',
      },
      {
        label: '婉拒並暫停團購合作',
        result: '決定暫停合作，看看結果。',
        chance: {
          p: 0.5,
          win: { effects: { reputation: 1, setFlag: 'groupon_paused' }, result: '停掉團購後，單價回到正軌，客人少了一點，但來的都是真愛。' },
          lose: { effects: { reputation: -4, setFlag: 'groupon_paused', sat: -5 }, result: '客人在平台寫了一篇「這家很難搞」，三顆星的評論一下子冒出來。' },
        },
      },
      {
        label: '各退一步，當日補差價',
        effects: { money: -1500, sat: 2 },
        result: '客人補了差價，雙方都不太開心，但誰也沒再說話。',
      },
    ],
  },
  {
    id: 'bbq_hype', cat: 'patient', title: '設備廠商文宣：溫度差一倍', big: false, weight: 6, cooldownWeeks: 24,
    text: '炭火爐廠商文宣寫著「高溫鎖汁，肉汁多一倍」，客人看了廣告，問：「你們的有這麼厲害嗎？」',
    cond: { hasObject: ['bbq_grill'] },
    choices: [
      {
        label: '誠實說明：看火候也看肉質',
        effects: { sat: 1, reputation: 2 },
        result: '客人點點頭：「原來不是只靠機器啊。」老闆覺得被理解了，笑容多了一點。',
      },
      {
        label: '順勢推「高溫炭烤套餐」',
        result: '把文宣當成賣點，看客人反應。',
        chance: {
          p: 0.6,
          win: { effects: { money: 60000, reputation: 2 }, result: '套餐賣得不錯，客人說肉汁確實多，老闆偷偷把文宣貼在牆上。' },
          lose: { effects: { sat: -4, reputation: -4 }, result: '有人說「跟廣告差很多」，評論區多了幾則酸文。' },
        },
      },
      {
        label: '不理會',
        effects: {},
        result: '你把文宣收進抽屜，客人也沒再問，這次平安過去。',
      },
    ],
  },
  {
    id: 'fryer_burn', cat: 'patient', title: '油炸鍋燙傷客人', big: false, weight: 6, cooldownWeeks: 24,
    text: '小朋友太好奇，手一伸碰到油炸鍋邊，立刻尖叫。家長衝過來大聲說：「你們這樣很危險！」',
    cond: { hasObject: ['fryer'] },
    choices: [
      {
        label: '立刻冰敷、送醫，並全額負責',
        effects: { money: -40000, sat: 6, reputation: 3, setFlag: 'oil_log', risk: -3 },
        result: '小朋友冰敷後沒大礙，家長紅著眼眶說：「還好你們有處理。」你把炸鍋周圍加了安全圍欄。',
      },
      {
        label: '協助送醫，但說明是客人自己碰到',
        result: '你說明了狀況，看看家長的反應。',
        chance: {
          p: 0.5,
          win: { effects: { money: -15000, sat: -3, reputation: -1 }, result: '家長不太開心，但也沒有再追究，只是離開前瞪了你一眼。' },
          lose: { effects: { money: -15000, sat: -8, reputation: -6, setFlag: 'injury', followUp: { id: 'dispute_mediation', afterWeeks: 2 } }, result: '家長不接受，說要找消保官，兩週後調解通知會寄來。' },
        },
      },
      {
        label: '請家長自行處理醫療費',
        effects: { sat: -10, reputation: -8, setFlag: 'injury', followUp: { id: 'dispute_mediation', afterWeeks: 2 } },
        result: '家長氣得拍桌，臨走前說：「你等著瞧。」兩週後，你收到調解通知。',
      },
    ],
  },
  {
    id: 'allergy_alert', cat: 'patient', title: '過敏客人誤食花生', big: false, weight: 6, cooldownWeeks: 24,
    text: '客人點了「不要花生」的菜，卻誤送到有花生粉的那一盤。他嚼了一口，臉色立刻變了。',
    cond: {},
    choices: [
      {
        label: '立刻叫救護車，並全程陪同',
        effects: { money: -30000, sat: 5, reputation: 2, setFlag: 'allergen_chart', risk: -4 },
        result: '客人送醫後沒大礙，家屬說：「謝謝你們反應快。」你立刻把過敏原標示表貼在廚房牆上。',
      },
      {
        label: '請客人自行就醫，補償餐費',
        result: '你補償了餐費，看看客人的反應。',
        chance: {
          p: 0.5,
          win: { effects: { money: -8000, sat: -2 }, result: '客人沒大礙，只收下餐費補償，說：「下次小心點。」' },
          lose: { effects: { money: -8000, sat: -9, reputation: -8, setFlag: 'injury', followUp: { id: 'dispute_mediation', afterWeeks: 2 } }, result: '客人後來住院了，家屬表示要走法律程序，調解通知兩週後寄到。' },
        },
      },
      {
        label: '說明菜單有標示，是客人自己沒看清楚',
        effects: { sat: -10, reputation: -8, setFlag: 'injury', followUp: { id: 'dispute_mediation', afterWeeks: 2 } },
        result: '客人氣得說要告你，菜單標示字太小也成了問題，調解通知兩週後送達。',
      },
    ],
  },
  {
    id: 'queue_cutting', cat: 'patient', title: '插隊的客人', big: false, weight: 6, cooldownWeeks: 24,
    text: '兩位客人同時衝到櫃檯，都說自己先到。後面排隊的人開始交頭接耳。',
    cond: {},
    choices: [
      {
        label: '請服務生出面引導，依號碼牌排序',
        effects: { sat: -1, reputation: 2, buff: { weeks: 2, label: '秩序良好', mods: { patience: 0.03 } } },
        result: '服務生微笑引導，後面排隊的客人都默默點頭，這個秩序大家都滿意。',
      },
      {
        label: '兩邊都送一杯飲料，息事寧人',
        effects: { money: -3000, sat: 2 },
        result: '兩位客人拿著飲料，嘴上不說，臉上都軟下來了。',
      },
      {
        label: '假裝沒看到',
        effects: { sat: -5, reputation: -3 },
        result: '兩位客人吵起來，後面排隊的人一臉不耐，有人乾脆轉頭離開。',
      },
    ],
  },
  {
    id: 'dispute_mediation', cat: 'patient', title: '消費爭議調解通知', big: true, weight: 3, cooldownWeeks: 8,
    text: '一封公文寄到：消保官通知你出席調解。上面寫著客人的名字，和一道你記得很清楚的菜。',
    cond: { flag: 'injury' },
    choices: [
      {
        label: '備齊資料，出席並誠意協商',
        effects: { money: -80000, reputation: 2, clearFlag: 'injury', risk: -6 },
        result: '調解室裡你說明了經過，補償金談定，客人握了你的手說：「謝謝你願意面對。」',
      },
      {
        label: '委任律師代為處理',
        effects: { money: -150000, reputation: 0, clearFlag: 'injury' },
        result: '律師處理得很專業，只是帳上的數字讓你心疼了一陣子。',
      },
      {
        label: '不出席，賭客人放棄',
        result: '決定不出席，看看會怎麼樣。',
        chance: {
          p: 0.3,
          win: { effects: { clearFlag: 'injury' }, result: '客人沒再追究，這件事就這樣淡掉了，你鬆了一口氣。' },
          lose: { effects: { money: -300000, reputation: -15, clearFlag: 'injury', risk: 10 }, result: '缺席被判賠償，還上了當地新聞，這次賭輸得很慘。' },
        },
      },
    ],
  },
  {
    id: 'flu_season', cat: 'patient', title: '流感季員工口罩規定', big: false, weight: 6, cooldownWeeks: 24,
    text: '流感大流行，客人在門口問：「你們員工有沒有戴口罩？」',
    cond: { months: [12, 1, 2] },
    choices: [
      {
        label: '全員戴口罩，備好消毒用品',
        effects: { money: -15000, sat: 3, reputation: 2, stamina: { delta: -3 } },
        result: '口罩加上酒精消毒，客人看到都點頭，只是戴著口罩煮麵的廚師說有點悶。',
      },
      {
        label: '只要求外場戴口罩',
        effects: { money: -5000, sat: 1 },
        result: '服務生戴上口罩，廚房還是一樣悶熱，客人也沒多問。',
      },
      {
        label: '讓大家自行決定',
        effects: { sat: -3, reputation: -2 },
        result: '有人戴有人沒戴，客人在門口看了一眼，轉身去隔壁了。',
      },
    ],
  },
  {
    id: 'elder_discount', cat: 'patient', title: '長輩敬老優待', big: false, weight: 6, cooldownWeeks: 24,
    text: '里長來電：「你們早上客人很多都是長輩，能不能辦個敬老優待？」',
    cond: { policy: 'community' },
    choices: [
      {
        label: '推出敬老餐，九折優待',
        effects: { money: -20000, reputation: 5, sat: 3, buff: { weeks: 6, label: '敬老優待', mods: { elderSat: 3 } } },
        result: '敬老餐一推出，早上店裡多了一整排長輩，里長站在門口笑得很開心。',
      },
      {
        label: '提供免費熱茶就好',
        effects: { money: -3000, reputation: 2 },
        result: '熱茶溫了長輩的手，阿嬤說：「老闆你人真好。」',
      },
      {
        label: '婉拒，說不能開先例',
        effects: { reputation: -2 },
        result: '里長說：「好吧，那就不勉強。」下次他介紹客人時，語氣比較淡。',
      },
    ],
  },
  {
    id: 'order_mixup', cat: 'patient', title: '代點餐回家變不同版本', big: false, weight: 6, cooldownWeeks: 24,
    text: '外籍看護替老先生點餐，回家後老先生說「我沒點這個」。看護委屈地回來說：「我明明照著寫的。」',
    cond: {},
    choices: [
      {
        label: '補做一份，並貼上圖片菜單',
        effects: { money: -3000, sat: 4, reputation: 2, buff: { weeks: 3, label: '圖片菜單', mods: { patience: 0.03 } } },
        result: '圖片菜單貼在牆上，之後看護只要指著圖就能點，大家都鬆了一口氣。',
      },
      {
        label: '送一份小菜表達歉意',
        effects: { money: -1000, sat: 2 },
        result: '老先生吃了小菜，笑著說：「沒關係啦，下次再點。」',
      },
      {
        label: '說明是點餐單沒寫清楚',
        effects: { sat: -4, reputation: -1 },
        result: '看護低著頭離開，老先生也沒說話，下次再也沒有他們的身影。',
      },
    ],
  },
];
