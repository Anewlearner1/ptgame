// Weather, random events, community programmes, dilemmas, health-education boards, policy text.
//
// Conventions (read by sim/events.js + sim/modifiers.js):
// - `mods` patches are ADDITIVE deltas on defaultMods() base values (multipliers have base 1: -0.6 -> 0.4).
// - `typeBoost` multiplies a patient type's arrival weight while the weather is active.
// - `slip` multiplies slip-and-fall probability while the weather is active (on top of mods.slipRisk).
// - Event/dilemma `effects`: money (NT$, + gain / - cost), reputation, points {medical,device,service},
// NOTE (balance): money / cost / upkeep values below were scaled x4 (events, dilemmas) and x3 (community, boards) when
// income was rescaled (now economy.PATIENT_WEIGHT; event money stays plain NT$, never weighted), so events still sting relative to monthly revenue.
// Verified after the real-fee rework: net event money stays within +-10% of yearly income (tools/bal_events.mjs).
//   sat (satisfaction delta for the involved patient), nhiPenalty (NHI points removed from state.nhi.monthPoints).
// - Community `effects.spawn` is an additive delta on that patient type's spawn multiplier (0.3 -> x1.3).

// `kind` must be one of state.weather.kind: sunny|cloudy|rain|cold|hot|typhoon.
// `id` is unique; 梅雨 shares kind 'rain' but has its own id.
export const WEATHER = [
  {
    id: 'sunny', kind: 'sunny', name: '晴朗好天氣', icon: '☀️', months: [3, 4, 5, 6, 7, 8, 9, 10, 11],
    weight: 30, tempRange: [24, 33], mods: {}, typeBoost: { sports: 1.3, elder: 1.05 }, slip: 0.9,
    news: '陽光超猛，運動員都出來跑步了，膝蓋也跟著出門。',
  },
  {
    id: 'cloudy', kind: 'cloudy', name: '陰天', icon: '☁️', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    weight: 25, tempRange: [20, 28], mods: {}, typeBoost: { office: 1.1 }, slip: 1.0,
    news: '陰陰的，不晴不雨，上班族的肩頸先陰了。',
  },
  {
    id: 'rain', kind: 'rain', name: '午後陣雨', icon: '🌦️', months: [3, 4, 5, 9, 10, 11],
    weight: 18, tempRange: [21, 28], mods: {}, typeBoost: { elder: 1.2 }, slip: 1.5,
    news: '午後一陣雨，地板濕濕的，走路要看路喔。',
  },
  {
    id: 'plumrain', kind: 'rain', name: '梅雨季', icon: '🌧️', months: [5, 6],
    weight: 40, tempRange: [21, 28], mods: { staffStamina: 0.1 }, typeBoost: { elder: 1.25, office: 0.9 }, slip: 1.6,
    news: '梅雨下不停，衣服半乾不溼，關節也是。同仁說身體像泡過水。',
  },
  {
    id: 'cold', kind: 'cold', name: '寒流來襲', icon: '🥶', months: [12, 1, 2],
    weight: 30, tempRange: [8, 16], mods: {}, typeBoost: { elder: 1.6, office: 0.95 }, slip: 1.3,
    news: '寒流來了！阿伯阿嬤的膝蓋和肩膀準時報到。',
  },
  {
    id: 'hot', kind: 'hot', name: '炎夏高溫', icon: '🥵', months: [7, 8],
    weight: 25, tempRange: [31, 38], mods: { staffStamina: 0.2, spawnMult: -0.1 }, typeBoost: { sports: 0.8, kid: 0.7, elder: 0.9 }, slip: 1.0,
    news: '熱到柏油路會軟，大家都躲在冷氣房裡，運動的人也少了。',
  },
  {
    id: 'typhoon', kind: 'typhoon', name: '颱風警報', icon: '🌀', months: [7, 8, 9, 10],
    weight: 6, tempRange: [24, 30], mods: { spawnMult: -0.6 }, typeBoost: {}, slip: 1.2,
    news: '颱風天停班停課，病人都待在家，診所冷冷清清，只剩風在唱歌。',
  },
];

export const RANDOM_EVENTS = [
  {
    id: 'li_chief', title: '里長邀約', weight: 10, cond: {},
    text: '里長打電話來：「醫生啊，里民活動中心下禮拜要辦健康日，你們來擺個攤？」',
    choices: [
      {
        label: '好啊，免費幫大家篩檢', effects: { money: -120000, reputation: 8, points: { service: 10 } },
        result: '里民排成一排量血壓，里長笑到合不攏嘴，說要幫你們寫進里刊。',
      },
      {
        label: '婉拒，我們診所忙不過來', effects: { reputation: -2 },
        result: '里長嘆氣說：「好啦，那下次再說喔。」下次就不知道是哪一次了。',
      },
    ],
  },
  {
    id: 'nhi_audit', cat: 'nhi', big: true, title: '健保署抽審', weight: 8, cond: { minYear: 1 },
    text: '健保署來函，要抽調上個月的病歷和申報資料。信封很厚，主任的表情很薄。',
    choices: [
      {
        label: '配合調閱，全力準備', effects: { money: -80000, reputation: 3, risk: -12 },
        result: '病歷寫得清清楚楚，審查員翻了三小時，最後蓋了個章說「還可以」。',
      },
      {
        label: '交給行政處理，自己繼續看診', effects: { money: -240000, reputation: -8, risk: 6 },
        result: '行政阿姨硬著頭皮補件，還是少了兩張簽名，罰單寄到了家裡。',
      },
    ],
  },
  {
    id: 'media_interview', title: '地方電視台採訪', weight: 6, cond: { minRep: 80 },
    text: '地方電視台的記者說想拍「阿伯的膝蓋」專題，問你要不要上鏡頭。',
    choices: [
      {
        label: '上節目分享復健觀念', effects: { reputation: 12, money: -20000 },
        result: '你講得很清楚，還順便教觀眾怎麼做毛巾拉伸。播出後掛號電話快被打爆。',
      },
      {
        label: '婉拒，專心看病', effects: { reputation: 1 },
        result: '記者說：「沒關係，我們找隔壁的診所。」你默默看著電視裡的別人。',
      },
    ],
  },
  {
    id: 'poach', cat: 'ops', title: '員工被挖角', weight: 7, cond: { minYear: 1 },
    text: '隔壁大醫院的人資私訊你的員工，說薪水可以多兩成，還附停車位。',
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
    id: 'vendor_promo', title: '儀器廠商促銷', weight: 8, cond: {},
    text: '儀器業務帶著笑容來：「醫生，這台新機器限時八折，現在下單還送保固！」',
    choices: [
      {
        label: '買！機器看起來很厲害', requires: { money: 480000 }, effects: { money: -480000, points: { device: 20 } },
        result: '機器開箱那天，全診所都來拍照。說明書有三百頁，但螢幕很漂亮。',
      },
      {
        label: '不買，先把舊的顧好', effects: { money: 0 },
        result: '業務留下名片：「醫生想通了隨時找我喔！」名片你放進抽屜，抽屜很滿。',
      },
    ],
  },
  {
    id: 'flood', cat: 'season', title: '颱風淹水', weight: 5, cond: { weather: ['typhoon'] },
    text: '颱風過後，馬路變成小河。診所一樓的地板泡在水裡，沙發還在飄。',
    choices: [
      {
        label: '全體動員清理，搶救設備', requires: { money: 360000 }, effects: { money: -360000, reputation: 4 },
        result: '同仁穿雨鞋、拿拖把，忙到半夜。病人隔天來看到，都說「你們很拚」。',
      },
      {
        label: '停診兩週慢慢修', effects: { money: -160000, reputation: -10 },
        result: '招牌上貼著「因故暫停營業」，病人的小本本上多了一個叉叉。',
      },
    ],
  },
  {
    id: 'pharma_rep', title: '藥廠業務來訪', weight: 6, cond: {},
    text: '藥廠業務說想請醫生當「學術講者」，一場講座講師費很可觀，但要唸他們的投影片。',
    choices: [
      {
        label: '接受，去講一場', effects: { money: 240000, reputation: -4 },
        result: '講座很順，錢也入袋。只是有位病人在下面小聲問：「醫生，你是在幫哪一家講話？」',
      },
      {
        label: '婉拒，我們不跟藥廠合作', effects: { reputation: 3 },
        result: '業務臉色有點難看，但病人們私下說你很正直。',
      },
    ],
  },
  {
    id: 'fall_lobby', title: '大廳有人跌倒', weight: 6, cond: {},
    text: '一位阿伯在大廳地板滑了一跤，家屬衝進來大聲問：「你們的地板是怎麼回事？」',
    choices: [
      {
        label: '立刻送急診，全程陪同', effects: { money: -120000, reputation: 6, points: { service: 5 } },
        result: '阿伯只是擦傷加扭到腳，家屬紅著眼眶說：「還好你們有處理。」',
      },
      {
        label: '請家屬簽切結書就好', effects: { reputation: -12 },
        result: '切結書寫得密密麻麻，家屬簽了，但診所的口碑被寫在大家的 LINE 群組裡。',
      },
    ],
  },
  {
    id: 'staff_birthday', title: '護理師生日', weight: 5, cond: {},
    text: '櫃檯護理師生日，同事們想辦個小派對，問醫生能不能出點經費。',
    choices: [
      {
        label: '全額買蛋糕，犒賞辛苦', effects: { money: -80000, points: { service: 5 } },
        result: '一顆六吋蛋糕被分成二十塊，大家吃到嘴角都是奶油，士氣回升。',
      },
      {
        label: '大家自己湊錢吧', effects: { reputation: -1 },
        result: '最後湊出一杯珍奶和一句「生日快樂」。護理師說：「謝謝醫生的心意。」',
      },
    ],
  },
  {
    id: 'viral_video', title: '病人影片爆紅', weight: 4, cond: { minRep: 60 },
    text: '有病人偷偷拍了你幫他做徒手治療的影片，上傳後居然爆紅，留言一堆「我也要看這醫生」。',
    choices: [
      {
        label: '順勢拍衛教短片，好好經營', effects: { money: -80000, reputation: 15, points: { service: 10 } },
        result: '短片教大家「坐久了記得起來動一動」，粉絲破萬，你的名字開始有人念對了。',
      },
      {
        label: '請病人把影片刪掉', effects: { reputation: -5 },
        result: '病人很委屈地刪了，但網友已經截圖了一萬次。',
      },
    ],
  },
  {
    id: 'equip_recall', title: '儀器召回通知', weight: 4, cond: { minYear: 1, hasObject: ['tens'] },
    text: '廠商發通知，你家那台電療儀有安全疑慮要召回，換新機要自費，還附一張道歉信。',
    choices: [
      {
        label: '立刻換新，安全第一', requires: { money: 600000 }, effects: { money: -600000, reputation: 3, points: { device: 5 } },
        result: '新機器亮亮的，病人說「這台看起來比較可靠」，你心裡鬆了一口氣。',
      },
      {
        label: '先用舊的，觀察看看', effects: { reputation: -4 },
        result: '病人在候診區問：「那台是不是有問題的那台？」你只能笑笑說還好啦。',
      },
    ],
  },
  {
    id: 'insurance_sales', title: '保險業務上門', weight: 5, cond: {},
    text: '保險業務說可以幫員工辦團體醫療險，保費算你們便宜，但要先簽一堆資料。',
    choices: [
      {
        label: '幫員工加保', effects: { money: -160000, reputation: 2 },
        result: '員工收到保單很開心，說「醫生你人真好」。你只好把它當作福利。',
      },
      {
        label: '婉拒，我自己的保險都看不懂', effects: {},
        result: '業務說：「沒關係，下次再聊！」下次他又來了，你又說不。',
      },
    ],
  },
  {
    id: 'govt_subsidy', title: '衛生局補助公告', weight: 5, cond: { minYear: 1 },
    text: '衛生局公告長照整合補助，申請表有十七頁，光是附件就要三個月。',
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
    id: 'school_talk', title: '國小邀請講座', weight: 5, cond: {},
    text: '附近國小的老師來電：「醫生，我們想請你來講一堂『如何坐得好、背不痛』，小朋友超有興趣的！」',
    choices: [
      {
        label: '去講，順便做篩檢', effects: { reputation: 6, points: { service: 8 } },
        result: '小朋友人手一張坐姿貼紙，還有一個小朋友問你：「醫生，你會不會痛痛？」',
      },
      {
        label: '婉拒，週末要休息', effects: { reputation: -1 },
        result: '老師說沒關係，但班級群組裡有家長默默問：「診所是不是很忙？」',
      },
    ],
  },
  {
    id: 'parking_fine', title: '門口被開罰單', weight: 6, cond: {},
    text: '路邊臨停的救護車（不是我們的）被拖吊，里民抱怨說是診所門口讓車子亂停。',
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
    id: 'temple_sarcopenia', name: '宮廟肌少症篩檢', desc: '廟埕擺攤量握力、測步速，阿嬤們排隊排到拜拜的香爐旁。',
    cost: 75000, durationWeeks: 2,
    effects: { spawn: { elder: 0.3 }, reputation: 5, points: { service: 10 } }, cooldownWeeks: 6,
  },
  {
    id: 'health_talk', name: '社區衛教講座', desc: '社區活動中心的小講座，教大家正確的姿勢與熱敷觀念。',
    cost: 30000, durationWeeks: 2,
    effects: { spawn: { office: 0.1, elder: 0.1 }, reputation: 3, points: { service: 8 } }, cooldownWeeks: 4,
  },
  {
    id: 'school_scoliosis', name: '校園脊椎側彎篩檢', desc: '國小體檢後來一波側彎篩檢，家長聽到「要不要來看看」都緊張兮兮。',
    cost: 120000, durationWeeks: 3,
    effects: { spawn: { kid: 0.4 }, reputation: 6, points: { medical: 10, service: 5 } }, cooldownWeeks: 8,
  },
  {
    id: 'company_health', name: '公司健康促進講座', desc: '到科技公司的會議室講坐著工作的痠痛，同仁一邊聽一邊偷偷伸懶腰。',
    cost: 105000, durationWeeks: 2,
    effects: { spawn: { office: 0.35 }, reputation: 4, points: { service: 8 } }, cooldownWeeks: 6,
  },
  {
    id: 'village_walk', name: '里民健走活動', desc: '每天早上繞里內走一圈，阿伯阿嬤帶著保溫杯，運動員也跟著跑。',
    cost: 45000, durationWeeks: 4,
    effects: { spawn: { elder: 0.2, sports: 0.2 }, reputation: 3, points: { service: 6 } }, cooldownWeeks: 4,
  },
  {
    id: 'ltc_partner', name: '長照據點合作', desc: '和社區長照據點簽約，每週定期去帶動能運動，阿嬤們說比去大樓下棋還好玩。',
    cost: 240000, durationWeeks: 6,
    effects: { spawn: { elder: 0.5 }, reputation: 12, points: { service: 20, medical: 5 } }, cooldownWeeks: 10,
  },
  {
    id: 'night_run', name: '夜市路跑熱身站', desc: '在夜市出口設熱身站，發小冰棒、貼運動貼布，順便幫跑者看看膝蓋。',
    cost: 90000, durationWeeks: 2,
    effects: { spawn: { sports: 0.4 }, reputation: 6, points: { medical: 5 } }, cooldownWeeks: 6,
  },
];

export const DILEMMAS = [
  {
    id: 'painkiller_elder', trigger: 'painkiller', title: '「直接開止痛藥就好啦」',
    text: '阿伯揉著膝蓋說：「醫生啊，不要囉嗦那麼多，你直接開止痛藥給我就好啦。」',
    choices: [
      {
        label: '好，先開止痛藥給你', effects: { sat: 8, reputation: -4 },
        result: '阿伯笑瞇瞇拿藥走，三天後又回來說「還是痛」。你心裡有點酸酸的。',
      },
      {
        label: '先評估，再一起決定療程', effects: { sat: -6, reputation: 4 },
        result: '阿伯不太開心地嘟嚷：「我只是要藥。」但他還是乖乖躺上床做了評估。',
      },
    ],
  },
  {
    id: 'painkiller_office', trigger: 'painkiller', title: '「醫生，上班好忙，給我止痛藥啦」',
    text: '上班族一臉疲憊：「醫生，我今天還要開會，你就給我一顆止痛藥，拜託。」',
    choices: [
      {
        label: '開藥，但也排個熱敷', effects: { sat: 5, reputation: -2, money: 0 },
        result: '他很感激你的熱敷，但回家路上還是覺得你「有點囉嗦」。',
      },
      {
        label: '告訴他止痛藥不能亂吃', effects: { sat: -4, reputation: 3 },
        result: '他嘆了口氣說：「好吧，那我去買別家的。」你覺得自己做對了，但胃有點痛。',
      },
    ],
  },
  {
    id: 'painkiller_sports', trigger: 'painkiller', title: '「明天要比賽，打一針止痛針」',
    text: '業餘選手的眼神很堅定：「醫生，明天就是大賽，你給我打一針，我不怕痛。」',
    choices: [
      {
        label: '不行，先評估傷勢再說', effects: { sat: -4, reputation: 5, points: { medical: 3 } },
        result: '選手很不爽地走了，但隔週他回來說：「還好你擋我，那天我真的會受傷。」',
      },
      {
        label: '打！他說不怕就讓他打', effects: { sat: 10, reputation: -10, nhiPenalty: 200 },
        result: '比賽當天他拿了第三名，朋友們都說：「是你們診所的功勞！」傳言也因此開始走樣。',
      },
    ],
  },
  {
    id: 'skip_doctor_elder', trigger: 'skip_doctor', title: '「我只要電療，不要看醫生」',
    text: '阿嬤一進門就說：「我只要去躺電療，醫生就不用看啦，很麻煩耶。」',
    choices: [
      {
        label: '依規定，先看醫生再做電療', effects: { sat: -5, reputation: 3 },
        result: '阿嬤碎碎唸了半小時，最後還是乖乖去看醫生，她說：「好啦，醫生你很煩。」',
      },
      {
        label: '同意，但病歷上註記清楚', effects: { sat: 4, reputation: -2, nhiPenalty: 200 },
        result: '阿嬤很開心地躺上電療床，你的良心卻被健保署的表格默默記了一筆。',
      },
    ],
  },
  {
    id: 'skip_doctor_office', trigger: 'skip_doctor', title: '「只想做震波，時間很趕」',
    text: '上班族看了看手錶：「醫生，我不想看醫生了，我直接做震波就好，我只有半小時。」',
    choices: [
      {
        label: '震波可以做，但要先過一下評估', effects: { sat: 2, reputation: 2 },
        result: '他說「好吧，那就快一點」，評估花了五分鐘，震波打完他說：「還真有差！」',
      },
      {
        label: '收自費，直接排震波', effects: { sat: 3, money: 80000, reputation: -4 },
        result: '收據很漂亮，但同事小聲說：「我們好像把流程跳過了。」',
      },
    ],
  },
  {
    id: 'overtreat_elder', trigger: 'overtreat', title: '「醫生，我想每天來做八次熱敷」',
    text: '阿伯很認真地問：「每天做八次熱敷，會不會比較快好？我可以每天都來吧？」',
    choices: [
      {
        label: '依病情調整頻率，每週幾次就好', effects: { sat: -3, reputation: 4 },
        result: '阿伯有點失望，但也慢慢接受：「原來不是越多越好喔。」',
      },
      {
        label: '好，每天做，收費照算', effects: { money: 120000, reputation: -8, nhiPenalty: 300 },
        result: '帳單很漂亮，健保署的審查委員看到的時候，眉毛挑得很高。',
      },
    ],
  },
  {
    id: 'overtreat_self', trigger: 'overtreat', title: '「我想一次買十堂震波課程」',
    text: '老闆一拍桌：「醫生，我想一次買十堂震波，有沒有折扣？我全部都要！」',
    choices: [
      {
        label: '依病情建議三堂就夠', effects: { sat: 0, reputation: 3 },
        result: '老闆說：「醫生你很誠實耶，我下次介紹朋友來。」',
      },
      {
        label: '給他十堂，收錢收到手軟', effects: { money: 320000, reputation: -10 },
        result: '帳戶多了一大筆錢，但老闆做到第四堂就說不痛了，之後再也沒來過。',
      },
    ],
  },
  {
    id: 'overtreat_kid', trigger: 'overtreat', title: '「我家小孩每天都要來感統」',
    text: '家長很堅持：「我家小孩每天都要來做感統，他很愛玩球池，你可以排滿一點吧？」',
    choices: [
      {
        label: '依發展評估，一週兩到三次', effects: { sat: -2, reputation: 3, points: { service: 3 } },
        result: '家長嘆氣說：「好吧，那週末可以多來一次嗎？」你說週末我們也有門診。',
      },
      {
        label: '每天排滿，收費照算', effects: { money: 160000, reputation: -6 },
        result: '小朋友玩得超開心，但家長在群組裡問：「為什麼感統一定要每天來？」',
      },
    ],
  },
  {
    id: 'complain_wait', trigger: 'complain', title: '「等了一個半小時，你們怎麼排的！」',
    text: '阿姨拍著掛號櫃檯大喊：「我一個半小時了耶！你們到底是怎麼排班的啦！」',
    choices: [
      {
        label: '真誠道歉，免費加送一次熱敷', effects: { sat: 10, reputation: 2, money: -32000 },
        result: '阿姨嘴上說「下次不要這樣」，但熱敷時已經靠在枕頭上打呼了。',
      },
      {
        label: '解釋今天很忙，請她耐心等', effects: { sat: -15, reputation: -6 },
        result: '阿姨說：「我下次去大醫院！」背影有種不回頭的堅定。',
      },
    ],
  },
  {
    id: 'complain_price', trigger: 'complain', title: '「為什麼要自費？健保不能做嗎？」',
    text: '阿伯看著自費單，眉頭皺成一團：「醫生，健保不能做嗎？為什麼要我自己付錢？」',
    choices: [
      {
        label: '說明健保與自費差異，附上書面說明', effects: { sat: 4, reputation: 2 },
        result: '阿伯看完說：「原來是這樣，我還以為你們是在騙錢。」你默默把說明書多印了五十張。',
      },
      {
        label: '直接說健保沒有這項', effects: { sat: -6, reputation: -3 },
        result: '阿伯不滿地走了，但他家的小孫子在候診區偷偷把這句話錄起來。',
      },
      {
        label: '這次先不收費，給個人情', effects: { sat: 8, money: -60000 },
        result: '阿伯很感動，回去跟鄰居說你們「很有人情味」，但你的帳本少了一筆。',
      },
    ],
  },
  {
    id: 'complain_noisy', trigger: 'complain', title: '「電療機器嗡嗡叫，我頭很痛」',
    text: '阿嬤躺在電療床上皺眉：「醫生，這台機器一直嗡嗡叫，我頭好痛，是不是壞了？」',
    choices: [
      {
        label: '換一台新機器，給她看', effects: { money: -240000, sat: 6, reputation: 2 },
        result: '阿嬤摸著新機器說：「這台比較安靜，好很多。」你偷偷把舊機器的螺絲拆下來留著。',
      },
      {
        label: '請她忍耐一下，治療很快就好', effects: { sat: -8, reputation: -2 },
        result: '阿嬤嘆氣：「忍耐、忍耐，我都忍一輩子了。」你覺得這句話好重。',
      },
    ],
  },
  {
    id: 'complain_staff', trigger: 'complain', title: '「你們護理師態度很差！」',
    text: '一位病人投訴護理師講話太大聲，還說「你們是在趕人嗎？」',
    choices: [
      {
        label: '調查後處理，當面道歉', effects: { sat: 5, reputation: 4, money: -20000 },
        result: '護理師紅著眼眶說：「我以後會注意語氣。」病人說：「有道歉就好。」',
      },
      {
        label: '護理師沒有錯，請病人多包涵', effects: { sat: -8, reputation: -4 },
        result: '病人在網路上寫了一篇長文，標題是「這家診所，我不推」。',
      },
    ],
  },
];

export const BOARDS = [
  {
    id: 'back_knee', name: '護腰護膝篇', cost: 24000, upkeep: 1500,
    effects: { patience: 0.05 },
    desc: '看板教大家躺下、起身的正確姿勢，候診的人看著看著就忘了等待的煩躁。',
  },
  {
    id: 'hot_cold', name: '冷熱敷觀念', cost: 18000, upkeep: 900,
    effects: { selfPayConv: 0.02 },
    desc: '急性扭傷先冰、慢性痠痛才熱，看板講得很白話，大家都說「原來如此」。',
  },
  {
    id: 'kid_milestone', name: '兒童發展里程碑', cost: 45000, upkeep: 1200,
    effects: { patience: 0.05, researchGain: 0.02 },
    desc: '幾個月會翻身、幾歲會跑跳，家長對照著看，焦慮少了，來問問題的也變多了。',
  },
  {
    id: 'elder_fall', name: '長者防跌五招', cost: 36000, upkeep: 1200,
    effects: { slipRisk: -0.1, elderSat: 2 },
    desc: '起床先坐五秒、浴室加扶手、拖鞋要穿好。阿嬤拍照存進 LINE 群組。',
  },
  {
    id: 'selfpay_explain', name: '自費項目說明', cost: 30000, upkeep: 900,
    effects: { selfPayConv: 0.04 },
    desc: '健保與自費差在哪、值不值得，寫清楚講明白，「為什麼要自費」少被問一次。',
  },
  {
    id: 'elder_nutrition', name: '長輩營養與肌少症', cost: 60000, upkeep: 1500,
    effects: { elderSat: 3 },
    desc: '吃足蛋白質、多曬太陽、動一動。阿公說：「原來不是老了才會沒力。」',
  },
  {
    id: 'office_posture', name: '久坐族的頸肩操', cost: 27000, upkeep: 900,
    effects: { patience: 0.03, selfPayConv: 0.01 },
    desc: '每小時起來伸個懶腰，看板上的小人偶跟你一起抖肩。上班族笑著拍了照。',
  },
];

export const POLICY_TEXT = {
  ortho: { label: '骨科門診', hint: '門診量大、翻桌快，靠健保點數與徒手、電熱療吃飯。' },
  ltc: { label: '長照復健', hint: '阿公阿嬤多、防跌很重要，長輩滿意度與坡道是重點。' },
  peds: { label: '早療兒童', hint: '感統、語言與精細動作，小朋友要玩得開心，家長要看得安心。' },
};
