// Extended events, part A: 健保營運 A01–A14 and 病人與溝通 B01–B16 (30 events).
// Spec: docs/EVENTS_EXT.md (schema, effects, cond). Source: docs/EVENT_RESEARCH.md §3.
//
// Conventions used here:
// - `chance.p` = probability of the `win` branch. `win` is always the favourable or neutral branch,
//   so a doc line like "30%：被追查" is written as p: 0.7 (win = 沒事) and lose = 被追查.
// - Choices with `chance` repeat the non-random effects in both branches (chance and effects are exclusive).
// - Money is plain NT$ (-50000 = NT$ -50,000).
// - Flags: `injury` (set by B10/B11 negative choices, consumed by B13), `ir_sop` (B10), `tens_screen` (B11),
//   `prp_paused` (B08), `acupuncture_trained` (B06), `settled` (B13).
// - followUp: B10 and B11 negative choices -> `dispute_mediation` (B13) after 2 weeks.

export const EVENTS_EXT_A = [
  // ---------- A. 健保營運 ----------
  {
    id: 'nhi_ratio_review', cat: 'nhi', title: '專業審查：等級比例怪怪的', big: true, weight: 3, cooldownWeeks: 12,
    text: '審查來函說：「貴所複雜治療占比，和鄰近同儕不太一樣。」主任看著報表，報表也看著主任。',
    cond: { minYear: 1, monthPointsOverCapPct: 90 },
    choices: [
      {
        label: '補齊治療紀錄與時間表，全力備審',
        effects: { money: -50000, reputation: 2, risk: -10 },
        result: '同仁熬夜把每一筆治療的時間表補得整整齊齊，審查員看完點點頭：「這樣就清楚了。」',
      },
      {
        label: '申覆，賭一把',
        result: '送出申覆，等待回音。',
        chance: {
          p: 0.5,
          win: { effects: { money: 100000, reputation: 3 }, result: '申覆成功，核減的金額退了回來，主任把那張退款通知裱框掛在櫃檯後面。' },
          lose: { effects: { nhiPenalty: 400, money: -30000, reputation: -3 }, result: '申覆沒過，健保點數被扣了四百點，主任說：「賭輸就是輸，下次不賭了。」' },
        },
      },
      {
        label: '認賠，並調整排程',
        effects: { nhiPenalty: 600, risk: -15 },
        result: '排程重新排過，複雜治療攤平到每一週，帳上少了一筆錢，多了一本教訓。',
      },
    ],
  },
  {
    id: 'nhi_growth_flag', cat: 'nhi', title: '申報成長太快被點名', big: true, weight: 3, cooldownWeeks: 24,
    text: '公文寫「近期申報成長幅度較高」，同仁私下說：「我們只是太認真。」',
    cond: { minYear: 2 },
    choices: [
      {
        label: '外聘申報顧問做體檢',
        effects: { money: -150000, risk: -20, reputation: 2 },
        result: '顧問翻了三天帳本，指出兩處寫錯的代碼，還說你們的病歷比他前一個客戶好看。',
      },
      {
        label: '自己備齊資料',
        effects: { money: -60000, reputation: 1, risk: -8 },
        result: '行政和護理師熬夜整理資料夾，厚得像一本小說，但每一頁都有簽名。',
      },
      {
        label: '不理會，生意好是我家的事',
        result: '決定不理會，接下來就看後續怎麼走。',
        chance: {
          p: 0.5,
          win: { effects: {}, result: '這次沒有後續，信件石沉大海，大家鬆了一口氣，只是沒人再敢說生意好。' },
          lose: { effects: { nhiPenalty: 500, reputation: -6 }, result: '後來還是被抽到，健保點數扣了五百點，主任的生意好論調暫時收了起來。' },
        },
      },
    ],
  },
  {
    id: 'nhi_missing_record', cat: 'nhi', title: '治療紀錄漏簽', big: false, weight: 6, cooldownWeeks: 24,
    text: '月底對帳發現三十幾張治療單沒簽名，護理師的筆在抽屜裡集體失蹤。',
    cond: {},
    choices: [
      {
        label: '全員補單週（週末加班）',
        effects: { stamina: { delta: -15 }, morale: { delta: -5 } },
        result: '週末的診所只剩影印機的聲音，大家一張一張補簽，簽到手都快抽筋。',
      },
      {
        label: '導入電子簽核表單',
        effects: { money: -60000, risk: -9 },
        result: '電子表單上線第一天就有人問：「這個按鈕是要按哪裡？」不過之後單子就很少漏了。',
      },
      {
        label: '這些先不報',
        effects: { nhiPenalty: 300 },
        result: '那幾張單子被收進另一個抽屜，健保點數少了三百點，抽屜倒是變乾淨了。',
      },
    ],
  },
  {
    id: 'nhi_sixth_visit', cat: 'nhi', title: '第七次還想只躺不看', big: false, weight: 6, cooldownWeeks: 24,
    text: '阿嬤第七次報到：「醫生上週才看過啦，我直接躺就好！」',
    cond: {},
    choices: [
      {
        label: '請她掛號，醫師重新評估',
        effects: { sat: -3, reputation: 2 },
        result: '阿嬤嘟嘴去掛號，醫師看了三十秒，說：「你還是要躺，但我要看一下你。」',
      },
      {
        label: '用簡訊提前預約下次回診',
        effects: { money: -5000, sat: 3, reputation: 1 },
        result: '簡訊準時送到，阿嬤回了一個貼圖，說：「好啦，知道你們很認真。」',
      },
      {
        label: '幫她續處方，反正熟',
        effects: { sat: 5, nhiPenalty: 200, risk: 5 },
        result: '阿嬤笑開了花，印章也蓋得很開心，只是健保的眼睛沒有休假。',
      },
    ],
  },
  {
    id: 'nhi_pt_cap', cat: 'nhi', title: '治療師今天人次爆表', big: false, weight: 6, cooldownWeeks: 24,
    text: '計數器顯示小林治療師今天已經做到第 46 個人，他的手也在抗議。',
    cond: { hasStaff: { pt: 1 } },
    choices: [
      {
        label: '加聘兼職治療師',
        effects: { money: -90000, stamina: { role: 'pt', delta: 5 } },
        result: '兼職治療師第一天上班，把排程表多看了三遍，總算鬆了一口氣。',
      },
      {
        label: '限號，超額請改天',
        effects: { money: -60000, sat: -6, reputation: -3 },
        result: '超過的病人改天再來，排隊的阿伯有點不高興，說診所是不是要改成抽籤。',
      },
      {
        label: '照做，超過的當義診',
        effects: { money: -40000, stamina: { role: 'pt', delta: -12 }, morale: { role: 'pt', delta: -4 } },
        result: '超量的那幾位病人都免費做完，治療師的手臂抗議到第二天才停。',
      },
    ],
  },
  {
    id: 'nhi_role_mismatch', cat: 'nhi', title: '誰做的治療就報誰', big: true, weight: 3, cooldownWeeks: 24,
    text: '行政發現早療的申報代碼，和實際執行的人對不上，兩邊都說：「我以為你會改。」',
    cond: { hasStaff: { ot: 1, pt: 1 } },
    choices: [
      {
        label: '立刻內部稽核，更正歷史申報',
        effects: { money: -40000, reputation: 2, risk: -10 },
        result: '稽核人員連夜翻出三個月的紀錄，更正單一張張蓋章，整間診所像開了一場小型會議。',
      },
      {
        label: '補聘 PT 專責，OT 專做職能',
        effects: { money: -100000, points: { service: 5 } },
        result: '新來的治療師負責早療的大動作，職能治療師也能專心做精細動作，小朋友笑得很開心。',
      },
      {
        label: '名稱而已啦',
        result: '維持現狀，賭它不會被查。',
        chance: {
          p: 0.7,
          win: { effects: {}, result: '這次沒被查到，大家鬆了一口氣，只是名字的小差異還在那裡等著。' },
          lose: { effects: { money: -300000, reputation: -10 }, result: '有人來查，發現代碼跟人對不上，罰單寄到門口，主任還在說：「只是名稱而已啦。」' },
        },
      },
    ],
  },
  {
    id: 'nhi_neighbor_fraud', cat: 'nhi', title: '同業被終止特約的新聞', big: false, weight: 6, cooldownWeeks: 24,
    text: '新聞說某區有診所「補卡刷兩次」被停約，阿嬤們到處問：「你們有沒有這樣？」',
    cond: { minRep: 40 },
    choices: [
      {
        label: '貼公告：一律先診察、不重複刷卡',
        effects: { money: -10000, reputation: 4 },
        result: '公告貼在掛號櫃檯旁，阿嬤看了點頭：「這樣我就放心了。」',
      },
      {
        label: '只回答「我們合法啦」',
        effects: { reputation: 1 },
        result: '阿嬤回去跟鄰居說醫生說他們合法，鄰居問：「那有沒有被罰？」阿嬤說：「沒問。」',
      },
      {
        label: '趁機接收對方流失的病人',
        effects: { buff: { weeks: 4, label: '同業流失病人', mods: { spawnMult: 0.1 } }, stamina: { delta: -8 } },
        result: '有幾位病人被新聞嚇到，轉來這裡，同仁忙到腳都站麻了。',
      },
    ],
  },
  {
    id: 'nhi_pv_drop', cat: 'nhi', title: '季點值下滑', big: false, weight: 6, cooldownWeeks: 36,
    text: '季結算單寄到：點值又掉了。會計小姐說：「我們賣得越多，每點越不值錢。」',
    cond: { pvBelow: 0.9, months: [3, 6, 9, 12] },
    choices: [
      {
        label: '看板加強自費說明，推有用的自費項目',
        effects: { money: -30000, buff: { weeks: 6, label: '自費說明看板', mods: { selfPayConv: 0.04 } } },
        result: '看板上的自費項目排得整整齊齊，有位阿姨說：「原來這個有用喔？」',
      },
      {
        label: '控制健保量，減少電熱療排程',
        effects: { buff: { weeks: 4, label: '控制健保量', mods: { spawnMult: -0.1 } } },
        result: '電熱療的排程變少了，候診室安靜不少，點值沒有立刻變好，心情倒是變好了。',
      },
      {
        label: '先吞下去',
        effects: { morale: { delta: -5 } },
        result: '大家都沒說話，只是把計算機又按了一次，數字還是一樣。',
      },
    ],
  },
  {
    id: 'nhi_clawback', cat: 'nhi', title: '暫付金額被追回', big: true, weight: 3, cooldownWeeks: 36,
    text: '公文寫「暫付與結算差額」，老闆看了三遍，數字沒有變。',
    cond: { months: [3, 6, 9, 12] },
    choices: [
      {
        label: '早就提列準備金',
        effects: { money: -100000 },
        result: '準備金早就在帳上等著，追回的金額來的時候，會計只淡淡地說：「有準備就不慌。」',
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
    id: 'nhi_survey_call', cat: 'nhi', title: '健保來電訪問病人', big: false, weight: 6, cooldownWeeks: 16,
    text: '阿伯接到電話被問：「你上禮拜有去復健嗎？」他回頭問櫃檯：「我有去嗎？」',
    cond: { minYear: 1 },
    choices: [
      {
        label: '告訴病人：據實回答就好',
        effects: { reputation: 3 },
        result: '病人開始照實回答，電話那頭的訪員也說：「原來是這樣喔，謝謝你。」',
      },
      {
        label: '請同仁整理到診紀錄，備查',
        effects: { money: -10000, risk: -5 },
        result: '病歷室的資料夾排得很整齊，每一通電話都能對得上日期。',
      },
      {
        label: '提醒大家「怎麼回答比較好」',
        result: '把提醒寫進交代單，然後靜待結果。',
        chance: {
          p: 0.5,
          win: { effects: {}, result: '這次沒被發現，同仁互相看了一眼，誰也不敢再提這句話。' },
          lose: { effects: { nhiPenalty: 400, reputation: -8 }, result: '被發現了，訪問紀錄寫得清清楚楚，健保點數扣了四百點。' },
        },
      },
    ],
  },
  {
    id: 'nhi_regular_guest', cat: 'nhi', title: '回診拿熱敷的常客', big: false, weight: 6, cooldownWeeks: 24,
    text: '阿伯每週三準時報到，熱敷、聊天、順便評論診所椅子，已經變成里的新聞台。',
    cond: {},
    choices: [
      {
        label: '評估後改運動處方，教居家運動',
        effects: { sat: -4, reputation: 4, points: { medical: 5 } },
        result: '阿伯被教了五套居家運動，抱怨了三天，第四天就開始自己做了。',
      },
      {
        label: '轉介社區活動據點',
        effects: { reputation: 5, sat: -2 },
        result: '阿伯去了社區據點，跟一群阿伯阿嬤下棋，回診少了，話題多了。',
      },
      {
        label: '照單全收',
        effects: { money: 40000, risk: 6, reputation: -2 },
        result: '熱敷的鐘聲一響，阿伯又來了，報表上多了一排數字，風評則悄悄少了一點。',
      },
    ],
  },
  {
    id: 'nhi_evidence_news', cat: 'nhi', title: '新聞說電熱療效果有限', big: false, weight: 6, cooldownWeeks: 24,
    text: '候診室電視在播「電療熱療只能暫時舒緩」，所有人同時看向護理師。',
    cond: { minRep: 30 },
    choices: [
      {
        label: '改版療程：被動治療搭配運動治療',
        effects: { money: -40000, points: { medical: 8 }, reputation: 4 },
        result: '療程表多了運動課，候診的阿伯問：「原來要動才會好喔？」護理師說：「對，還是要動。」',
      },
      {
        label: '衛教說明被動治療的角色',
        effects: { money: -5000, reputation: 2 },
        result: '衛教單寫得很清楚：被動治療是輔助，不是主角，阿姨們說這樣就放心了。',
      },
      {
        label: '不理會',
        effects: { sat: -3 },
        result: '電視還在播，候診的病人一臉懷疑，接下來幾天的滿意度也跟著往下掉。',
      },
    ],
  },
  {
    id: 'nhi_upcode_temptation', cat: 'nhi', title: '顧問的「優化」建議', big: true, weight: 3, cooldownWeeks: 24,
    text: '廠商顧問笑著說：「簡單改成中度，多加一項而已，沒人看啦。」',
    cond: {},
    choices: [
      {
        label: '婉拒',
        effects: { reputation: 2 },
        result: '顧問聳聳肩，把名片留在桌上，主任把名片收進抽屜，說：「以後再說。」',
      },
      {
        label: '只做有實際執行的合理調整',
        effects: { money: 60000, risk: 3 },
        result: '調整只限真的做過的項目，帳面雖然沒那麼好看，但主任睡得比較安穩。',
      },
      {
        label: '大幅優化',
        result: '照顧問的方式大幅調整申報內容。',
        chance: {
          p: 0.3,
          win: { effects: { money: 200000 }, result: '這次沒被發現，帳上多了一大筆數字，顧問得意地說：「我就說沒人看吧。」' },
          lose: { effects: { money: -200000, nhiPenalty: 600, reputation: -12 }, result: '後來被審查，補件補到天昏地暗，罰單和退費一起寄來，這筆錢回頭又吐了出去。' },
        },
      },
    ],
  },
  {
    id: 'nhi_rule_update', cat: 'nhi', title: '審查注意事項改版', big: false, weight: 6, cooldownWeeks: 24,
    text: '新規定共 37 頁，其中 3 頁真的重要，但沒人知道是哪 3 頁。',
    cond: { minYear: 2 },
    choices: [
      {
        label: '辦內部讀書會，一人認養一章',
        effects: { money: -30000, risk: -6, stamina: { delta: -4 } },
        result: '讀書會開了三次，最後大家一致認為第 12 頁最重要，因為大家都在第 12 頁睡著了。',
      },
      {
        label: '交給行政自己看',
        result: '把厚厚的規定交給行政，自己先去忙別的。',
        chance: {
          p: 0.6,
          win: { effects: {}, result: '行政看完說：「應該沒差。」運氣好，這次沒有後果。' },
          lose: { effects: { nhiPenalty: 300 }, result: '行政漏看了一條規定，審查時被點出來，健保點數扣了三百點。' },
        },
      },
      {
        label: '加入公會與同業社群討論',
        effects: { money: -10000, risk: -3 },
        result: '社群裡有人分享整理好的重點表，大家邊看邊罵，但至少罵得有方向。',
      },
    ],
  },

  // ---------- B. 病人與溝通 ----------
  {
    id: 'cert_traffic', cat: 'patient', title: '車禍診斷證明想寫「更嚴重」', big: true, weight: 3, cooldownWeeks: 12,
    text: '車禍的先生說：「醫生，證明寫嚴重一點，對方保險才會賠。」',
    cond: {},
    choices: [
      {
        label: '依病歷如實開立',
        effects: { sat: -6, reputation: 3 },
        result: '病人嘆了口氣，收下診斷書說：「好吧，那我再去跟對方講。」',
      },
      {
        label: '如實開立，附說明可日後補驗傷',
        effects: { money: -5000, reputation: 2 },
        result: '診斷書附上補充說明，後續補驗傷的流程也寫清楚了，病人似懂非懂地點頭。',
      },
      {
        label: '稍微寫重一點',
        result: '把診斷書的用字稍微加重，然後靜待結果。',
        chance: {
          p: 0.7,
          win: { effects: { sat: 8, money: 30000 }, result: '病人笑得很開心，理賠似乎很順利，沒有人來追查。' },
          lose: { effects: { sat: 8, money: -220000, reputation: -12 }, result: '後來有人來追查病歷，寫重的那一行被圈了起來，罰款加上律師費，診所有點想哭。' },
        },
      },
    ],
  },
  {
    id: 'cert_labor_injury', cat: 'patient', title: '職災傷病給付的蓋章接力', big: true, weight: 3, cooldownWeeks: 12,
    text: '病人拿著一疊申請書：「老闆說要找醫生蓋，醫生說要找老闆蓋。」',
    cond: {},
    choices: [
      {
        label: '協助釐清流程，開診斷書並附說明',
        effects: { money: -10000, sat: 8, reputation: 4 },
        result: '櫃檯幫忙畫出流程圖，病人拿到蓋好的文件，感動得差點把流程圖也一起裱框。',
      },
      {
        label: '只開診斷書',
        effects: { sat: -2 },
        result: '診斷書開好了，但流程還是病人自己跑，他一路念念有詞地走出診所。',
      },
      {
        label: '建議轉職業醫學專科',
        effects: { sat: -5, reputation: 1 },
        result: '病人被轉介到專科，多了一條路，只是少了一點被照顧的感覺。',
      },
    ],
  },
  {
    id: 'cert_diag_wording', cat: 'patient', title: '保險公司說病名不一樣', big: true, weight: 3, cooldownWeeks: 8,
    text: '保險業務傳來訊息：「診斷書上的病名跟保單差一個字。」那一個字是病人的整個週末。',
    cond: {},
    choices: [
      {
        label: '逐字對照、加註、重新開立',
        effects: { money: -5000, sat: 5 },
        result: '逐字比對完，病名旁邊多了一行小字說明，病人說：「原來差一個字這麼麻煩。」',
      },
      {
        label: '請病人自己跟保險公司說明',
        effects: { sat: -5 },
        result: '病人打了三通電話，最後還是回來問：「醫生，你可以再寫一次嗎？」',
      },
      {
        label: '開診所制式說明單',
        effects: { money: -10000 },
        result: '制式說明單印了一百張，之後遇到類似情況的病人都能拿到一張，效率變高了。',
      },
    ],
  },
  {
    id: 'folk_regret', cat: 'patient', title: '推拿後手麻來求診', big: false, weight: 6, cooldownWeeks: 12,
    text: '病人說：「師傅說喬一下就好，結果現在手麻到連手機都拿不穩。」',
    cond: {},
    choices: [
      {
        label: '完整評估，必要時轉骨科',
        effects: { reputation: 5, sat: 6, points: { medical: 3 } },
        result: '評估後發現是頸部的問題，病人鬆了一口氣，醫師也開了一張轉診單。',
      },
      {
        label: '順勢宣導「民俗調理不是醫療」',
        effects: { reputation: -3 },
        result: '宣導內容沒有錯，但語氣有點像在罵人，病人默默把手機收進口袋。',
      },
      {
        label: '簡單處理後收診',
        effects: {},
        result: '簡單處理完病人離開，手還是麻的，但至少收費單是乾淨的。',
      },
    ],
  },
  {
    id: 'chiro_request', cat: 'patient', title: '「幫我喬一下就好」', big: false, weight: 6, cooldownWeeks: 8,
    text: '病人躺上治療床，手比著脖子：「醫生，直接給我來一下『喀』就好。」',
    cond: {},
    choices: [
      {
        label: '評估後只做安全的徒手與鬆動',
        effects: { sat: 3, reputation: 2 },
        result: '徒手鬆動做完，病人說：「沒有喀一聲，但好像比較舒服。」',
      },
      {
        label: '婉拒並說明禁忌與風險',
        effects: { sat: -5, reputation: 1 },
        result: '病人嘟囔著要去找別人喀，診所的衛教卡卻被他帶走了一張。',
      },
      {
        label: '介紹合法管道，附衛教卡',
        effects: { money: -3000, reputation: 1 },
        result: '衛教卡寫得很清楚，病人收下後說：「好啦，我先來做復健。」',
      },
    ],
  },
  {
    id: 'acupuncture_confuse', cat: 'patient', title: '「復健科有針灸嗎？健保付嗎？」', big: false, weight: 6, cooldownWeeks: 12,
    text: '阿嬤問：「你們有針灸嗎？我鄰居說健保有給付。」鄰居永遠是消息來源。',
    cond: { hasStaff: { doctor: 1 } },
    choices: [
      {
        label: '清楚說明自費，或轉介中醫',
        effects: { sat: 2, reputation: 2 },
        result: '阿嬤聽完點點頭：「原來要自費喔，那我先去問問看中醫。」',
      },
      {
        label: '提供自費針灸（醫師已受訓）',
        effects: { money: 50000, sat: 3, setFlag: 'acupuncture_trained' },
        result: '醫師翻出受訓證書，阿嬤說：「那我就試一次看看。」',
      },
      {
        label: '說「看看再說」',
        effects: { sat: -4 },
        result: '阿嬤說：「那我再想想。」想完就去隔壁找答案了。',
      },
    ],
  },
  {
    id: 'shockwave_price', cat: 'patient', title: '震波比隔壁貴', big: false, weight: 6, cooldownWeeks: 12,
    text: '病人拿出手機：「隔壁便宜五百，你們為什麼比較貴？」',
    cond: { hasObject: ['shockwave', 'shockwave_room'] },
    choices: [
      {
        label: '公開價目與適應症說明',
        effects: { money: -10000, sat: 4, reputation: 3 },
        result: '價目表貼在牆上，適應症寫得清清楚楚，病人說：「原來是差在設備和時間。」',
      },
      {
        label: '打折留客',
        effects: { money: -40000, sat: 6 },
        result: '優惠價讓病人很開心，只是櫃檯算帳的時候，有人小聲嘆了一口氣。',
      },
      {
        label: '推十堂套餐',
        effects: { money: 150000, reputation: -6 },
        result: '套餐賣得很好，病人做完三堂就開始問：「還有效嗎？」',
      },
    ],
  },
  {
    id: 'prp_claim_denied', cat: 'patient', title: 'PRP 實支險被拒賠', big: false, weight: 6, cooldownWeeks: 16,
    text: '病人說：「打了好幾針，保險說不賠，是你們的診斷書沒寫對嗎？」',
    cond: {},
    choices: [
      {
        label: '如實開立，並提醒事前確認保單',
        effects: { sat: -4, reputation: 2 },
        result: '診斷書照實寫，病人聽完說：「早知道就先問保險了。」',
      },
      {
        label: '幫忙修辭',
        result: '請櫃檯幫忙修辭診斷書，等理賠結果。',
        chance: {
          p: 0.7,
          win: { effects: { sat: 6 }, result: '修辭得很漂亮，病人很滿意，理賠也順利，只有櫃檯知道那段文字有多勉強。' },
          lose: { effects: { sat: 6, money: -150000, reputation: -10 }, result: '審查時修辭被點出，理賠遭拒，還要退回一筆款項，名聲也跟著打了折扣。' },
        },
      },
      {
        label: '暫停推廣 PRP，改教運動',
        effects: { money: -80000, reputation: 3, setFlag: 'prp_paused' },
        result: 'PRP 的宣傳海報下架，改貼上居家運動示範，少賺一點，但晚上睡得安穩。',
      },
    ],
  },
  {
    id: 'laser_hype', cat: 'patient', title: '廠商文宣：功率差一千倍', big: false, weight: 6, cooldownWeeks: 16,
    text: '業務送來看板：「功率差一千倍！」看板很閃，法規有點暗。',
    cond: { hasObject: ['laser_room'] },
    choices: [
      {
        label: '原文貼出',
        result: '照文宣原文貼出看板，等結果。',
        chance: {
          p: 0.8,
          win: { effects: { money: 100000 }, result: '看板亮了一週，來的人很多，大家都在討論「一千倍」到底是什麼意思。' },
          lose: { effects: { money: 50000, reputation: -5 }, result: '有人檢舉廣告內容，罰了一點錢，看板也被拆下來，業務說：「下次我改成兩千倍。」' },
        },
      },
      {
        label: '自己改成保守說明',
        effects: { money: 30000, reputation: 2 },
        result: '看板改寫成保守的字句，來的人少了一些，但沒人來找麻煩。',
      },
      {
        label: '不貼',
        effects: {},
        result: '看板被收進倉庫，業務嘆了口氣：「你們很難搞。」',
      },
    ],
  },
  {
    id: 'ir_lamp_burn', cat: 'patient', title: '紅外線燈燙傷', big: false, weight: 6, cooldownWeeks: 12,
    text: '阿嬤睡著了，燈沒睡，背上多了一塊紅紅的圓。',
    cond: { hasObject: ['ir_lamp'] },
    choices: [
      {
        label: '冷敷、評估、全額負責',
        effects: { money: -60000, reputation: 4, sat: 3 },
        result: '冷敷、上藥、回診追蹤，阿嬤醒來時說：「你們很會照顧人。」',
      },
      {
        label: '道歉並重訂燈距與計時 SOP',
        effects: { money: -30000, setFlag: 'ir_sop' },
        result: '燈距貼上了標記，每十五分鐘就有人來看一次，阿嬤說：「下次我睡前先跟你們講。」',
      },
      {
        label: '說是病人自己動了',
        result: '照這個說法回覆家屬，等結果。',
        chance: {
          p: 0.7,
          win: { effects: { reputation: -12, setFlag: 'injury', followUp: { id: 'dispute_mediation', afterWeeks: 2 } }, result: '家屬沒有追究，事情就這樣壓了下來，但診所心裡多了一根刺。' },
          lose: { effects: { reputation: -12, money: -200000, setFlag: 'injury', followUp: { id: 'dispute_mediation', afterWeeks: 2 } }, result: '家屬很生氣，找了律師，事情鬧上檯面，賠償金額比想像中高。' },
        },
      },
    ],
  },
  {
    id: 'tens_contraindication', cat: 'patient', title: '電療貼片與心律調節器', big: false, weight: 6, cooldownWeeks: 16,
    text: '護理師正要貼片，阿伯無意間說：「我胸口裡有個鐵盒子。」全場安靜。',
    cond: { hasObject: ['tens'] },
    choices: [
      {
        label: '立刻停止，轉診評估',
        effects: { money: -40000, reputation: 3 },
        result: '貼片被輕輕拿下，家屬接到電話趕來，三天後拿回了一張評估報告。',
      },
      {
        label: '補強問診單與勾選欄',
        effects: { money: -10000, setFlag: 'tens_screen' },
        result: '問診單多了一排勾選欄，心律調節器、癲癇、懷孕都有格子，護理師說：「以後不會漏了。」',
      },
      {
        label: '淡化處理',
        result: '輕描淡寫地處理，然後靜待結果。',
        chance: {
          p: 0.8,
          win: { effects: { reputation: -10, setFlag: 'injury', followUp: { id: 'dispute_mediation', afterWeeks: 2 } }, result: '阿伯說沒事，貼片也貼完了，只是那天的心跳聲大得連自己都聽得見。' },
          lose: { effects: { reputation: -10, money: -300000, setFlag: 'injury', followUp: { id: 'dispute_mediation', afterWeeks: 2 } }, result: '阿伯事後不舒服，家屬找上門，賠償和道歉信一起送來。' },
        },
      },
    ],
  },
  {
    id: 'queue_cutting', cat: 'patient', title: '插隊的病人', big: false, weight: 6, cooldownWeeks: 24,
    text: '有位先生說「我只做五分鐘」，結果整個下午都在做。',
    cond: {},
    choices: [
      {
        label: '護理師出面溫和勸導',
        effects: { sat: -3, reputation: 2 },
        result: '先生被請到候診區，有點不服氣，但坐回去時還是跟大家點頭致意。',
      },
      {
        label: '睜一隻眼閉一隻眼',
        effects: { reputation: -3 },
        result: '先生做完又做了一次，等候的阿姨開始小聲嘀咕，診所的氣氛也黏糊糊的。',
      },
      {
        label: '導入叫號系統',
        effects: { money: -20000, buff: { weeks: 104, label: '叫號系統', mods: { patience: 0.05 } } },
        result: '叫號機裝好了，大家抽號碼的樣子很認真，等候的時間也變得比較好過。',
      },
    ],
  },
  {
    id: 'dispute_mediation', cat: 'patient', title: '醫療爭議調解通知', big: true, weight: 3, cooldownWeeks: 24,
    text: '調解會來函，信封比醫師的聽診器還重。',
    cond: { flag: 'injury' },
    choices: [
      {
        label: '依規定做關懷、說明、出席調解',
        effects: { money: -60000, reputation: 3, clearFlag: 'injury' },
        result: '關懷訪視、書面說明一樣不缺，調解會上大家坐下來講了很久，最後握手收場。',
      },
      {
        label: '聘律師強硬應對',
        effects: { money: -150000, reputation: -4, clearFlag: 'injury' },
        result: '律師把文件堆滿會議桌，對方也請了律師，兩邊的信封越來越厚。',
      },
      {
        label: '私下和解',
        effects: { money: -100000, setFlag: 'settled', clearFlag: 'injury' },
        result: '私下談好的金額不算少，但至少不用再上調解會，主任的胃總算不痛了。',
      },
    ],
  },
  {
    id: 'flu_mask_policy', cat: 'patient', title: '流感季口罩規定', big: false, weight: 6, cooldownWeeks: 40,
    text: '外面咳嗽聲此起彼落，候診室像交響樂團暖身。',
    cond: { months: [12, 1, 2] },
    choices: [
      {
        label: '嚴格要求戴口罩，並發放口罩',
        effects: { money: -20000, sat: -3 },
        result: '口罩一人一片，櫃檯的紙盒很快就空了，阿伯問：「這個要錢嗎？」',
      },
      {
        label: '張貼告示、勸導',
        effects: { money: -5000 },
        result: '告示貼在門口，大家看了都點頭，咳嗽聲倒是沒有少。',
      },
      {
        label: '不處理',
        effects: { stamina: { delta: -10 }, reputation: -3 },
        result: '沒人戴口罩，同仁陸續請病假，排班表變成一張拼圖。',
      },
    ],
  },
  {
    id: 'ltc_aid_inquiry', cat: 'patient', title: '長照輔具怎麼申請', big: false, weight: 6, cooldownWeeks: 12,
    text: '家屬拿著一疊文件：「聽說可以補助浴室扶手，你們知道怎麼申請嗎？」',
    cond: { policy: 'ltc' },
    choices: [
      {
        label: '設立諮詢窗口，印簡單流程卡',
        effects: { money: -20000, sat: 6, reputation: 4 },
        result: '家屬拿著流程卡回去，三天後帶著申請書回來，說：「這次一次就搞定了。」',
      },
      {
        label: '發傳單，轉介長照專線',
        effects: { reputation: 1 },
        result: '傳單上印著專線號碼，家屬點點頭，但還是有點不確定要打哪一個。',
      },
      {
        label: '說這不是我們的事',
        effects: { reputation: -2 },
        result: '家屬說：「那你們是做什麼的？」這句話在候診室裡迴盪了很久。',
      },
    ],
  },
  {
    id: 'caregiver_translation', cat: 'patient', title: '看護代聽，回家變不同版本', big: false, weight: 6, cooldownWeeks: 12,
    text: '阿嬤說「醫生說要做運動」，看護聽成「醫生說要睡覺」，阿嬤很滿意。',
    cond: {},
    choices: [
      {
        label: '製作圖卡與簡單的多語影片',
        effects: { money: -15000, buff: { weeks: 104, label: '圖卡與多語影片', mods: { elderSat: 1 } } },
        result: '圖卡上畫著小人在做動作，看護看懂了，阿嬤也終於知道醫生的意思。',
      },
      {
        label: '請家屬一起來聽',
        effects: { sat: -4, reputation: 1 },
        result: '家屬來了，聽得很認真，只是阿嬤覺得自己被當成小孩，臉色有點難看。',
      },
      {
        label: '找志工翻譯',
        effects: { money: -5000, sat: 2 },
        result: '志工陪著翻譯，阿嬤聽完說：「原來是要動一動啊。」',
      },
    ],
  },
];

export const EVENT_EXT_META = {
  A: { count: 14 },
  B: { count: 16 },
};
