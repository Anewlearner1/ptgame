// 擴充事件 B 組（EVENTS_EXT_B）：診所營運 C01–C16、季節與在地 D01–D12，共 28 件。
// 規格：docs/EVENTS_EXT.md（資料契約）；來源：docs/EVENT_RESEARCH.md §3。
// 文案為虛構情境，不貼真實機構、公司或人名。
//
// 欄位約定（見 EVENTS_EXT.md §1–§2）：
// - cat: C 類為 'ops'，D 類為 'season'。season 權重 10、冷卻 40–48 週（每年回來一次）。
// - big: 大事件（每月最多一個）：C06、C09、C10、C11，權重 3。
// - chance: { p = 成功（win）機率, win, lose }；每側都有 effects 與 result。
// - followUp 目標 ir_lamp_burn、tens_contraindication 在 events_ext.js（B 組）中定義。

export const EVENTS_EXT_B = [
  // ───────── C 類：診所營運（ops） ─────────
  {
    id: 'tens_flaky', cat: 'ops', title: '電療儀輸出忽大忽小',
    text: '電療儀「滴」了一聲，數字自己跳。護理師：「它今天心情不好。」',
    weight: 6, cooldownWeeks: 24, big: false,
    cond: { wearAtLeast: { defId: 'tens', n: 70 } },
    choices: [
      {
        label: '叫師傅來修', requires: { money: 40000 },
        effects: { money: -40000, wear: { target: 'tens', delta: -100 } },
        result: '師傅拆開外殼摸了摸，說這台已經很久沒休息了，修好後乖得像新的。',
      },
      {
        label: '自己換電極與線材',
        chance: {
          p: 0.7,
          win: { effects: { money: -5000, wear: { target: 'tens', delta: -100 } }, result: '電極換新，儀器安靜了好一陣子。' },
          lose: { effects: { money: -5000, wear: { target: 'tens', delta: -100 }, breakdown: 'tens' }, result: '才用了兩天，它又開始忽大忽小，這次直接罷工。' },
        },
        result: '護理師說「我來試試看」，電極換了，線也綁了，就看它的心情。',
      },
      {
        label: '繼續用，還能動就好',
        effects: { sat: -6, followUp: { id: 'tens_contraindication', afterWeeks: 1, p: 0.1 } },
        result: '阿伯抱怨了兩句，電流在他背上跳得很有節奏，他說這叫「有感」。',
      },
    ],
  },
  {
    id: 'us_calibration', cat: 'ops', title: '超音波治療儀年度校正',
    text: '廠商提醒：「去年校正的功率，今年要確認一下喔。」',
    weight: 6, cooldownWeeks: 52, big: false,
    cond: { hasObject: ['us_room'] },
    choices: [
      {
        label: '送去校正', requires: { money: 50000 },
        effects: { money: -50000, wear: { target: 'us_room', delta: -100 }, setFlag: 'us_calibrated' },
        result: '校正單上蓋滿了章，功率跟說明書一樣準，連檢查員都點頭。',
      },
      {
        label: '延後，先用著',
        effects: { wear: { target: 'us_room', delta: 10 }, setFlag: 'us_calib_overdue' },
        result: '校正單放進抽屜，抽屜裡已經有三張了。',
      },
      {
        label: '乾脆換新機', requires: { money: 480000 },
        effects: { money: -480000, points: { device: 20 }, wear: { target: 'us_room', delta: -100 } },
        result: '舊機器被搬走，新機器的螢幕亮得像在炫耀。',
      },
    ],
  },
  {
    id: 'heatbox_thermostat', cat: 'ops', title: '熱敷包恆溫器失靈',
    text: '熱敷箱溫度跑到「麻辣鍋」等級，護理師用手背試了一下，立刻縮手。',
    weight: 6, cooldownWeeks: 24, big: false,
    cond: { wearAtLeast: { defId: 'heatbox', n: 60 } },
    choices: [
      {
        label: '立刻停用，換恆溫器', requires: { money: 30000 },
        effects: { money: -30000, wear: { target: 'heatbox', delta: -100 } },
        result: '新恆溫器一裝，熱敷箱又變回溫吞的好脾氣。',
      },
      {
        label: '調低設定值先用',
        effects: { followUp: { id: 'ir_lamp_burn', afterWeeks: 1, p: 0.2 } },
        result: '溫度是降下來了，只是沒人保證病人的皮膚跟護理師的手背一樣耐燙。',
      },
      {
        label: '放著不管',
        effects: { reputation: -3 },
        result: '熱敷箱繼續發燙，病人的意見也繼續發燙。',
      },
    ],
  },
  {
    id: 'traction_noise', cat: 'ops', title: '牽引機馬達異音',
    text: '牽引機每拉一次就「嘎——」一聲，病人說：「這聲音我也想叫。」',
    weight: 6, cooldownWeeks: 24, big: false,
    cond: { wearAtLeast: { defId: 'traction', n: 60 } },
    choices: [
      {
        label: '簽年度保養合約', requires: { money: 30000 },
        effects: { money: -30000, maintenance: 52 },
        result: '業務留下合約與一張保養表，馬達的聲音慢慢變成安靜的嗡嗡。',
      },
      {
        label: '臨時叫修', requires: { money: 20000 },
        effects: { money: -20000, wear: { target: 'traction', delta: -100 } },
        result: '師傅來了，上了點油，嘎聲就像被關進小房間。',
      },
      {
        label: '不理會',
        chance: {
          p: 0.6,
          win: { effects: { sat: -4 }, result: '嘎聲持續，病人也持續忍耐，還好機器撐得住。' },
          lose: { effects: { sat: -4, breakdown: 'traction' }, result: '最後一拉，嘎——然後整台靜止，病人終於也不想叫了。' },
        },
        result: '牽引機還在吱吱喳喳，病人嘴上說沒關係，身體很誠實。',
      },
    ],
  },
  {
    id: 'card_reader_down', cat: 'ops', title: '讀卡機與雲端模組異常',
    text: '健保卡一插進去螢幕轉圈圈，阿伯的血壓跟著轉圈圈。',
    weight: 6, cooldownWeeks: 12, big: false,
    cond: {},
    choices: [
      {
        label: '先看診，事後補卡登錄',
        effects: { sat: 5, stamina: { role: 'nurse', delta: -8 } },
        result: '病人先被照顧好，櫃檯晚上加班補登，臉上寫著「我沒事」。',
      },
      {
        label: '先收自費，事後退費', requires: { money: 10000 },
        effects: { sat: -3, money: -10000 },
        result: '先收後退，來回跑了好幾趟銀行，行政阿姨的腳底板很有感想。',
      },
      {
        label: '請病人改天再來',
        effects: { sat: -8, reputation: -3 },
        result: '病人嘆了口氣，帶著血壓與怨氣一起回家。',
      },
    ],
  },
  {
    id: 'pt_resign', cat: 'ops', title: '治療師遞出辭呈',
    text: '小林治療師把辭呈放在排班表上：「我想去睡到自然醒。」',
    weight: 3, cooldownWeeks: 24, big: true,
    cond: { hasStaff: { pt: 1 }, moraleBelow: 40 },
    choices: [
      {
        label: '談加薪，順便調排班', requires: { money: 60000 },
        effects: { money: -60000, morale: { role: 'pt', delta: 10 } },
        result: '加薪與新班表都談妥，小林把辭呈收回去，說要再睡一個月。',
      },
      {
        label: '放行，公開徵才',
        effects: { resign: { role: 'pt', p: 1 }, reputation: -2 },
        result: '辭呈照批，職缺貼上了網站，同仁開始輪流幫忙排班。',
      },
      {
        label: '找派遣補位', requires: { money: 90000 },
        effects: { money: -90000 },
        result: '派遣治療師來報到，薪水比小林高，但沒人敢問他睡得好不好。',
      },
    ],
  },
  {
    id: 'license_renew', cat: 'ops', title: '執業登記與繼續教育積分',
    text: '護理師發現自己積分剩 3 點，整個晚上在找哪個線上課程不用簽到。',
    weight: 6, cooldownWeeks: 44, big: false,
    cond: { months: [11, 12] },
    choices: [
      {
        label: '補助上課與請假', requires: { money: 20000 },
        effects: { money: -20000, points: { medical: 5 }, morale: { delta: 5 } },
        result: '同仁各自找到課程，積分回來了，人也比較有精神。',
      },
      {
        label: '自己想辦法',
        effects: { morale: { delta: -5 } },
        result: '大家在下班後的走廊上，互相傳授哪一門課不用簽到。',
      },
      {
        label: '拖著，年底再說',
        effects: { setFlag: 'license_overdue' },
        result: '積分還差一點點，檢查名單上多了一個名字。',
      },
    ],
  },
  {
    id: 'overtime_crunch', cat: 'ops', title: '連假前後人力不足',
    text: '連假前一天，排班表有三個人的名字，現場需要五個人。',
    weight: 6, cooldownWeeks: 24, big: false,
    cond: {},
    choices: [
      {
        label: '發加班費', requires: { money: 60000 },
        effects: { money: -60000, stamina: { delta: -10 }, morale: { delta: 3 } },
        result: '加班費發下去，大家嘴上說辛苦，手上的紅包比較用力。',
      },
      {
        label: '補休，下週少開診',
        effects: { morale: { delta: 5 }, buff: { weeks: 1, label: '補休少開診', mods: { spawnMult: -0.15 } } },
        result: '下週掛號系統變得安靜，同仁終於能去吃一頓正常的午餐。',
      },
      {
        label: '硬撐',
        effects: { stamina: { delta: -20 }, morale: { delta: -8 } },
        result: '連假前的那一週大家撐到最後，只剩下眼神還在上班。',
      },
    ],
  },
  {
    id: 'rent_hike', cat: 'ops', title: '房東通知續約調漲',
    text: '房東說：「最近物價漲，我也沒辦法。」語氣像漲價的是天氣。',
    weight: 3, cooldownWeeks: 52, big: true,
    cond: { minYear: 1 },
    choices: [
      {
        label: '接受調漲',
        effects: { buff: { weeks: 520, label: '房租調漲', mods: { rentMult: 0.1 } } },
        result: '租金單上的數字又往上長了一截，大家都說習慣就好。',
      },
      {
        label: '談判，簽三年約', requires: { money: 120000 },
        effects: { money: -120000, buff: { weeks: 156, label: '三年租約', mods: { rentMult: 0.03 } } },
        result: '房東同意簽三年，調幅縮小了，但律師費也跟著一起來了。',
      },
      {
        label: '搬遷（大工程）', requires: { money: 300000 },
        effects: { money: -300000, reputation: -10 },
        result: '搬家公司把機器搬上車，新場地還在找，病人先去隔壁等。',
      },
    ],
  },
  {
    id: 'infection_control_audit', cat: 'ops', title: '衛生局無預警督導',
    text: '兩位穿制服的人突然出現：「請問你們的洗手液放哪裡？」櫃檯：「在……在那裡！」',
    weight: 3, cooldownWeeks: 24, big: true,
    cond: { minYear: 1 },
    choices: [
      {
        label: '立即整改，做自評表', requires: { money: 40000 },
        effects: { money: -40000, reputation: 2, setFlag: 'infection_control_good' },
        result: '洗手液找到了正式的位置，自評表也印得整整齊齊。',
      },
      {
        label: '依缺失限期改善', requires: { money: 20000 },
        effects: { money: -20000 },
        result: '缺失單上寫了七天，診所用六天半完成，剩下半天拿來喝水。',
      },
      {
        label: '辯解', requires: { money: 50000 },
        effects: { reputation: -6, money: -50000 },
        result: '辯解沒有用，罰鍰單寄到櫃檯，櫃檯小姐看著單子不說話。',
      },
    ],
  },
  {
    id: 'fire_safety_check', cat: 'ops', title: '消防安檢',
    text: '消防員指著走道上的輪椅與輔具：「這裡是逃生路線，請問為什麼有一隊輪椅？」',
    weight: 3, cooldownWeeks: 52, big: true,
    cond: { minLot: 2 },
    choices: [
      {
        label: '整理走道，補滅火器', requires: { money: 50000 },
        effects: { money: -50000, reputation: 2 },
        result: '輪椅排成整齊的一列，滅火器也有了固定的位置，消防員點點頭。',
      },
      {
        label: '只把輪椅移到角落', requires: { money: 10000 },
        effects: { money: -10000, setFlag: 'fire_route_hidden' },
        result: '輪椅搬到角落，走道看起來寬敞了，有些問題先安靜地待著。',
      },
      {
        label: '看看再說', requires: { money: 150000 },
        effects: { money: -150000 },
        result: '消防員看了三分鐘，留下一張罰單與一句「下次注意」。',
      },
    ],
  },
  {
    id: 'record_request', cat: 'ops', title: '家屬要複製病歷',
    text: '家屬一次要求過去三年的病歷，附帶一句：「我只是看看。」',
    weight: 6, cooldownWeeks: 12, big: false,
    cond: {},
    choices: [
      {
        label: '當日提供，依規定收工本費',
        effects: { sat: 4, reputation: 2 },
        result: '病歷一份份影印完成，家屬說：「原來你們效率這麼好。」',
      },
      {
        label: '核對身分與授權，需一兩天',
        effects: { sat: -3, reputation: 1 },
        result: '身分證與授權書都對上了，家屬等得有點不耐煩，但規矩是規矩。',
      },
      {
        label: '拒絕',
        chance: {
          p: 0.8,
          win: { effects: { reputation: -5 }, result: '家屬氣呼呼地走了，據說去隔壁問了一樣的問題。' },
          lose: { effects: { reputation: -5, money: -80000 }, result: '沒過幾天，檢舉信寄到了，罰款單上寫著「請說明」。' },
        },
        result: '病歷沒給，家屬轉身就走，留下一句「我會記住的」。',
      },
    ],
  },
  {
    id: 'google_review_war', cat: 'ops', title: '一顆星的評論',
    text: '有人留言：「治療三分鐘，等了兩小時。」下面已經有十七個人按讚。',
    weight: 6, cooldownWeeks: 24, big: false,
    cond: { minRep: 20 },
    choices: [
      {
        label: '禮貌回覆，不透露病情',
        effects: { reputation: 3, reviewScore: 0.1 },
        result: '回覆寫得客氣又不囉唆，按讚的人多了幾個，還有人補充：「醫生人很好。」',
      },
      {
        label: '針鋒相對',
        effects: { reputation: -8, reviewScore: -0.3 },
        result: '回覆一出，截圖比留言還快，大家開始討論診所的語氣。',
      },
      {
        label: '請朋友寫好評',
        chance: {
          p: 0.6,
          win: { effects: { reputation: 5, reviewScore: 0.2 }, result: '好評一則一則進來，看起來一切正常。' },
          lose: { effects: { reputation: -10, reviewScore: -0.2 }, result: '有人把好評的帳號截圖貼出來，留言寫著「好評也請人寫？」' },
        },
        result: '朋友們很熱心，好評陸續上架，只是有人記性很好。',
      },
    ],
  },
  {
    id: 'video_ad_flag', cat: 'ops', title: '衛教影片被檢舉為廣告',
    text: '留言區有人寫：「這是廣告吧？」另一個人回：「這是衛教。」他們吵了五十則。',
    weight: 6, cooldownWeeks: 24, big: false,
    cond: { minRep: 60 },
    choices: [
      {
        label: '改成純衛教，不放診所名稱與價格',
        effects: { reputation: 2 },
        result: '影片剪掉了診所名稱與價格，只留下肩頸的運動與一句「多動動」。',
      },
      {
        label: '繼續發', requires: { money: 50000 },
        effects: { money: -50000, reputation: -4 },
        result: '罰單寄來的那天，留言區又吵了一次，這次吵的是罰金。',
      },
      {
        label: '找行銷公司優化', requires: { money: 80000 },
        chance: {
          p: 0.8,
          win: { effects: { money: -80000 }, result: '行銷公司把影片修得很漂亮，檢查員看完說「沒問題」。' },
          lose: { effects: { money: -130000, reputation: -4 }, result: '影片修得很漂亮，但檢查員還是看出了廣告的味道，罰單照開。' },
        },
        result: '影片換了新封面，法規沒有換，還是有人來檢查。',
      },
    ],
  },
  {
    id: 'referral_hospital', cat: 'ops', title: '醫學中心術後轉回復健',
    text: '醫學中心社工來問：「術後病人想就近復健，你們可以接嗎？」',
    weight: 6, cooldownWeeks: 24, big: false,
    cond: { minRep: 60 },
    choices: [
      {
        label: '簽合作，指定窗口', requires: { money: 30000 },
        effects: {
          money: -30000, reputation: 6, setFlag: 'referral_partner',
          buff: { weeks: 12, label: '醫學中心轉介', mods: { spawnMult: 0.1 } },
        },
        result: '窗口有了名字與電話，術後病人陸續上門，社工說：「我們就知道你們可以。」',
      },
      {
        label: '個案接收',
        effects: { reputation: 2 },
        result: '一位術後的阿姨先來報到，她說這裡「很像家裡」，聽起來是好話。',
      },
      {
        label: '不接',
        effects: {},
        result: '社工說：「好，那我再問別家。」電話掛斷，沒有任何聲音。',
      },
    ],
  },
  {
    id: 'pharmacy_partner', cat: 'ops', title: '在地藥局合作',
    text: '藥局老闆說：「你們把藥單交給我，我幫你們提醒病人吃藥。」',
    weight: 6, cooldownWeeks: 24, big: false,
    cond: { minYear: 1 },
    choices: [
      {
        label: '簽簡單合作，各自合規', requires: { money: 10000 },
        effects: { money: -10000, reputation: 3, sat: 3 },
        result: '合作書只有一頁，各自的職責寫得清清楚楚，病人說藥局的人比較會叮嚀。',
      },
      {
        label: '拒絕，避免瓜田李下',
        effects: { reputation: 1 },
        result: '老闆點頭說：「也對，清清白白最好。」藥單繼續由病人自己帶回家。',
      },
      {
        label: '簽高比例回饋',
        effects: { money: 60000, reputation: -8 },
        result: '回饋款按月入帳，但街坊開始議論診所跟藥局的關係。',
      },
    ],
  },

  // ───────── D 類：季節與在地（season） ─────────
  {
    id: 'cold_stroke_signs', cat: 'season', title: '寒流中風警訊',
    text: '阿伯說：「我只是肩頸痠，有點頭暈。」血壓計顯示的是另一個故事。',
    weight: 10, cooldownWeeks: 44, big: false,
    cond: { weather: ['cold'] },
    choices: [
      {
        label: '量血壓，立刻轉診急診', requires: { money: 20000 },
        effects: { money: -20000, reputation: 8 },
        result: '轉診單寫得很快，急診收到人時，阿伯還在問自己是不是小題大作。',
      },
      {
        label: '照常熱敷觀察',
        chance: {
          p: 0.8,
          win: { effects: {}, result: '熱敷後阿伯的頭不暈了，隔天又來報到，還帶了一袋橘子。' },
          lose: { effects: { reputation: -15 }, result: '阿伯在家裡暈倒，消息傳開，大家都說診所沒發現。' },
        },
        result: '熱敷觀察，結果留待天知道。',
      },
      {
        label: '請他回家休息',
        effects: { sat: -5 },
        result: '阿伯回家休息，但他一路上都在想，診所是不是不太在乎他。',
      },
    ],
  },
  {
    id: 'cold_joint_surge', cat: 'season', title: '寒流關節痛爆量',
    text: '候診區滿座，熱敷箱不夠，阿嬤們開始互相讓位。',
    weight: 10, cooldownWeeks: 44, big: false,
    cond: { weather: ['cold'] },
    choices: [
      {
        label: '加開早診', requires: { money: 40000 },
        effects: { money: -40000, stamina: { delta: -10 }, buff: { weeks: 2, label: '加開早診', mods: { spawnMult: 0.2 } } },
        result: '早上七點就有人排隊，同仁們的眼皮跟著早起。',
      },
      {
        label: '發號碼牌限量',
        effects: { sat: -6 },
        result: '號碼牌發完了，阿嬤們在門口圍成一圈，講了一整個上午的病。',
      },
      {
        label: '租借熱敷設備', requires: { money: 30000 },
        effects: { money: -30000 },
        result: '租來的熱敷設備插上電，候診區暖起來了，阿嬤說：「這才像樣。」',
      },
    ],
  },
  {
    id: 'plum_rain_floor', cat: 'season', title: '梅雨季地板濕滑',
    text: '玄關像溜冰場，雨傘滴出一條小河。',
    weight: 10, cooldownWeeks: 44, big: false,
    cond: { weatherId: 'plumrain' },
    choices: [
      {
        label: '放防滑地墊與傘套機', requires: { money: 20000 },
        effects: { money: -20000, buff: { weeks: 4, label: '防滑地墊與傘套機', mods: { slipRisk: -0.3 } } },
        result: '地墊鋪好，傘套機咻咻地套，玄關終於看得出是地板。',
      },
      {
        label: '派人拖地',
        effects: { stamina: { role: 'nurse', delta: -5 } },
        result: '護理師拖了一次又一次，拖把跟雨傘一樣溼。',
      },
      {
        label: '不處理',
        effects: { buff: { weeks: 4, label: '玄關濕滑', mods: { slipRisk: 0.3 } } },
        result: '地板依然很滑，大家走路都改成小碎步，像在演默劇。',
      },
    ],
  },
  {
    id: 'typhoon_aftermath', cat: 'season', title: '颱風假隔天補診潮',
    text: '颱風假結束，大家同時想起自己的腰。',
    weight: 10, cooldownWeeks: 44, big: false,
    cond: { months: [7, 8, 9, 10], weather: ['sunny', 'cloudy', 'rain'] },
    choices: [
      {
        label: '全員到班，加開',
        effects: { stamina: { delta: -12 }, buff: { weeks: 2, label: '颱風補診潮', mods: { spawnMult: 0.3 } } },
        result: '颱風假後的第一天，候診區像開學日，大家笑著擠進來。',
      },
      {
        label: '照常開診',
        effects: { sat: -4 },
        result: '病人排了半天隊，一邊抱怨一邊把腰扭來扭去。',
      },
      {
        label: '限額預約',
        effects: { reputation: 1 },
        result: '限額預約表貼在門口，大家守規矩排隊，還有人說這樣清爽。',
      },
    ],
  },
  {
    id: 'cny_back_strain', cat: 'season', title: '年前大掃除閃到腰',
    text: '病人說：「我只是擦了一下窗戶。」那是整棟樓的窗戶。',
    weight: 10, cooldownWeeks: 44, big: false,
    cond: { months: [1, 2] },
    choices: [
      {
        label: '設「閃腰急診號」', requires: { money: 20000 },
        effects: { money: -20000, reputation: 4, buff: { weeks: 2, label: '閃腰急診號', mods: { spawnMult: 0.2 } } },
        result: '急診號碼一掛出，年前的閃腰病人排成一條彎彎的隊。',
      },
      {
        label: '一般排隊',
        effects: { sat: -3 },
        result: '病人在候診區揉著腰，等了很久，嘴裡念叨著「下次不擦了」。',
      },
      {
        label: '辦衛教攤位', requires: { money: 10000 },
        effects: { money: -10000, reputation: 3 },
        result: '衛教攤位教大家「彎腰要屈膝」，阿伯示範時，腰又閃了一下。',
      },
    ],
  },
  {
    id: 'cny_closing', cat: 'season', title: '春節休診前後',
    text: '全員都想休，病人也想在年前把痛處理掉。',
    weight: 10, cooldownWeeks: 44, big: false,
    cond: { months: [1, 2] },
    choices: [
      {
        label: '初二初三開半天',
        effects: { money: 80000, stamina: { delta: -12 } },
        result: '半天的門診擠得滿滿，同仁下班時像剛打完一場球。',
      },
      {
        label: '全休',
        effects: { buff: { weeks: 2, label: '年後補療潮', mods: { spawnMult: 0.15 } } },
        result: '診所關門過年，病人年後一起來，說要把之前忍的都補回來。',
      },
      {
        label: '輪班',
        effects: { money: 30000, morale: { delta: -3 } },
        result: '輪班表排好了，有人笑說今年的紅包是班表給的。',
      },
    ],
  },
  {
    id: 'scoliosis_followup', cat: 'season', title: '側彎篩檢陽性轉診',
    text: '家長拿著學校單子：「他們說可能有問題，可是他看起來很正常啊。」',
    weight: 10, cooldownWeeks: 44, big: false,
    cond: { months: [9, 10, 3] },
    choices: [
      {
        label: '設兒童脊椎專案', requires: { money: 60000 },
        effects: { money: -60000, reputation: 6, buff: { weeks: 4, label: '兒童脊椎專案', spawn: { kid: 0.3 } } },
        result: '專案表格印好了，孩子們陸續來量背，家長也開始拍照留紀錄。',
      },
      {
        label: '發衛教單',
        effects: { reputation: 2 },
        result: '衛教單上寫著「請複檢」，家長說：「好，我下週再來。」下週還沒來。',
      },
      {
        label: '不處理',
        effects: {},
        result: '單子留在家長的包包裡，直到洗衣服那天才被發現。',
      },
    ],
  },
  {
    id: 'summer_sports', cat: 'season', title: '暑假運動傷害',
    text: '暑假的孩子們用腳踝證明自己跳得很高。',
    weight: 10, cooldownWeeks: 44, big: false,
    cond: { months: [7, 8] },
    choices: [
      {
        label: '暑期運動傷害專案', requires: { money: 50000 },
        effects: {
          money: -50000, points: { medical: 3 },
          buff: { weeks: 3, label: '暑期運動傷害專案', spawn: { sports: 0.3, kid: 0.2 } },
        },
        result: '扭傷的腳踝排成一列，醫療團隊的紀錄本越寫越厚。',
      },
      {
        label: '與校隊簽約', requires: { money: 80000 },
        effects: { money: -80000, reputation: 6 },
        result: '校隊教練很開心，球隊的運動褲上多了一個小小的診所標誌。',
      },
      {
        label: '一般門診',
        effects: {},
        result: '扭傷的孩子們一個個來掛號，醫生說：「下次跳高前先熱身。」',
      },
    ],
  },
  {
    id: 'marathon_season', cat: 'season', title: '馬拉松季',
    text: '馬拉松前一週，診所擠滿來「臨時抱佛腳」的跑者。',
    weight: 10, cooldownWeeks: 44, big: false,
    cond: { months: [10, 11, 12, 3] },
    choices: [
      {
        label: '賽前貼紮攤位', requires: { money: 60000 },
        effects: { money: -60000, reputation: 7, buff: { weeks: 3, label: '賽前貼紮攤位', spawn: { sports: 0.3 } } },
        result: '貼紮攤位搭好了，跑者一邊貼膠布一邊說「這次一定破紀錄」。',
      },
      {
        label: '賽後恢復套餐（自費）',
        effects: { money: 100000, reputation: 2 },
        result: '跑者們自費買了恢復套餐，腿跑完了，錢包也跟著縮水。',
      },
      {
        label: '不參與',
        effects: {},
        result: '跑者們自己找了冰敷袋，腳底的筋膜繼續抗議。',
      },
    ],
  },
  {
    id: 'temple_procession', cat: 'season', title: '遶境進香',
    text: '阿嬤們說：「我們要去走一整個禮拜！」你擔心的是她們的膝蓋，她們擔心的是遲到。',
    weight: 10, cooldownWeeks: 44, big: false,
    cond: { months: [3, 4] },
    choices: [
      {
        label: '派人去醫療站支援', requires: { money: 50000 },
        effects: { money: -50000, reputation: 8, stamina: { role: 'nurse', delta: -8 } },
        result: '醫療站的帳篷撐起來了，水泡一個個被挑破，阿嬤們說比廟裡的香還靈。',
      },
      {
        label: '行前辦腳底與步態檢查', requires: { money: 20000 },
        effects: { money: -20000, reputation: 3 },
        result: '腳底檢查做完，鞋墊發了一堆，阿嬤們穿著新鞋出發，腳步輕快。',
      },
      {
        label: '事後回診接收',
        effects: { buff: { weeks: 4, label: '遶境後回診', spawn: { elder: 0.3 } } },
        result: '遶境回來的阿嬤們一個個來報到，都說「膝蓋在抗議，但我們贏了」。',
      },
    ],
  },
  {
    id: 'elder_day_gift', cat: 'season', title: '母親節與重陽敬老',
    text: '護理師提議：「來辦個敬老活動吧！」同時有人說：「不能亂送東西喔。」',
    weight: 10, cooldownWeeks: 44, big: false,
    cond: { months: [5, 10] },
    choices: [
      {
        label: '送熱敷小禮，附衛教卡', requires: { money: 30000 },
        effects: { money: -30000, buff: { weeks: 4, label: '敬老小禮', mods: { elderSat: 2 } } },
        result: '熱敷小禮分下去，阿嬤把衛教卡貼在冰箱上，說要照著做。',
      },
      {
        label: '辦免費測量活動', requires: { money: 20000 },
        effects: { money: -20000, reputation: 4 },
        result: '血壓、血糖一輪量完，阿伯們圍著桌子比較數字，像在比賽。',
      },
      {
        label: '不辦',
        effects: {},
        result: '今年沒有敬老活動，大家只好在群組裡傳一張花的圖。',
      },
    ],
  },
  {
    id: 'yearend_office_crunch', cat: 'season', title: '年終加班的肩頸',
    text: '上班族說：「年終前不能請假，我的脖子可以請假嗎？」',
    weight: 10, cooldownWeeks: 44, big: false,
    cond: { months: [11, 12] },
    choices: [
      {
        label: '辦企業到點衛教', requires: { money: 50000 },
        effects: { money: -50000, reputation: 4, buff: { weeks: 4, label: '企業到點衛教', spawn: { office: 0.3 } } },
        result: '衛教師到公司講解伸展，員工一起轉脖子，會議室像在做體操。',
      },
      {
        label: '午休線上衛教', requires: { money: 10000 },
        effects: { money: -10000, reputation: 2 },
        result: '午休影片一播，大家邊吃便當邊轉肩膀，脖子終於有空休息一下。',
      },
      {
        label: '不辦',
        effects: {},
        result: '年終前夕，大家繼續低頭打字，脖子跟著低頭。',
      },
    ],
  },
];

export const EVENT_EXT2_META = {
  C: { count: 16 },
  D: { count: 12 },
};
