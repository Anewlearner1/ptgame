# 餐廳物語 — 架構與契約 (ARCHITECTURE)

這是模組之間的**契約**：名稱、資料形狀、事件。全貌與敘述請先讀 `docs/GAME_ARCHITECTURE.md`；診所→餐廳的概念對照見 `docs/RESTAURANT_DESIGN.md`；進度見 `docs/RESTAURANT_PROGRESS.md`。**以程式碼為準**，本文件與程式不符時請回頭修文件。

> 本文件原為《復健科診所物語》版（含多代理分工表、健保點數、單一申報、診察費階梯、圖集美術包等）。餐廳版已整份改寫，這些內容都已移除；診所版的原文在分支 `claude/rehab-clinic-game`。

PRD 摘要：台灣小吃店／餐廳的 2.5D 等距像素風經營模擬（Kairosoft 風格）。橫向網頁遊戲，左鍵建造、右鍵拖曳平移、滾輪縮放，手機觸控可玩。UI 語言：**繁體中文（台灣用語）**。

## 0. 基本規則

1. 純靜態網站：HTML5 Canvas + 原生 JS **ES modules**，無建置步驟、無 npm 執行期相依、無外部資產／CDN／字型。可由任何靜態伺服器（`python3 -m http.server`）與 GitHub Pages 提供（只用相對路徑）。
2. 所有美術都在程式裡繪製（Canvas 2D；`assets/art/` 圖集已移除，`art.js` 的 `ATLAS_AVAILABLE = false`）。精靈內可使用 emoji／CJK 字形。
3. 分層：**`core ← data ← sim ← render / ui`**。
   - `data/*` 只能 import `core/*`（及同層 `data/*`），不得 import `sim`／`render`／`ui`。
   - `sim/*` 只 import `core`、`data` 與其他 sim 模組的公開 API；**sim 模組之間不得形成循環 import**，需要時改用 `bus` 事件，或以注入函式解開（例：`economy.setBoardUpkeepResolver`）。
   - `render/*` 與 `ui/*` 讀 `state`、寫 `ui` 與 `bus`；**`sim/` 不碰 DOM 與 canvas**。
4. 程式風格：2 空白縮排、`const`／`let`、**只用具名匯出**（不用 default export）、必要處才寫簡短註解。所有玩家看得到的字串為繁體中文。
5. 遊戲狀態是純 JSON 資料（不放 class 實例、函式、Map／Set）。執行期快取放在 `state` 之外，或命名為 `*Cache`／`map.occ` 並在存檔時剔除。
6. 儲存鍵一律 `restgame.*`（`restgame.save.<slot>`、`restgame.art`、`restgame.quality`、`restgame.fpscap`、`restgame.perfhud`、`restgame.sound`、`restgame.tutorial`…），與診所版的 `ptgame.*` 分開。
7. 內部名稱沿用診所版（`patients`、`TREATMENTS`、`treatment:done`、`selfPay*`、`reception`、`cured`、面板 id `clinic`）；玩家看到的字串與資料 id 皆為餐廳版。語意對照見 `RESTAURANT_DESIGN.md` §1。
8. 驗證：`node --check` 語法檢查；邏輯用 `node tools/audit.mjs --quick`；UI 用 `tools/*.mjs`（Playwright，見 `GAME_ARCHITECTURE.md` §12）。

## 1. 檔案分層

| 層 | 檔案 |
|---|---|
| 入口 | `index.html`、`js/main.js`（啟動與主迴圈）、`sw.js`、`manifest.webmanifest` |
| `js/core/` | `constants.js`、`state.js`、`bus.js`、`grid.js`、`perfstats.js` |
| `js/data/` | `buildables`、`treatments`、`patients`（客人類型與經營方針）、`staffdefs`、`lots`、`research`、`upgrades`、`synergies`、`events`、`events_ext`、`events_ext2`、`achievements`、`goals`、`fees`、`texts`、`support` |
| `js/sim/` | `calendar`、`economy`、`patients`、`staff`、`qualify`、`equipment`、`build`、`pathfinding`、`synergy`、`modifiers`、`research`、`events`、`efftext`、`inspection`、`achievements`、`career`、`save` |
| `js/render/` | `iso`、`camera`、`input`、`renderer`、`sprites`（classic）、`art`、`artdraw`、`concept_objects`、`concept_scene`、`touchui` |
| `js/ui/` | `ui`、`topbar`、`sidebar`、`selection`、`modal`／`modals`、`toast`、`tooltip`、`ctxmenu`、`speedbar`、`career`、`cover`、`layout`、`moods`、`roles`、`theme`、`icons`、`artdom`、`installbox`、`pwa`、`support`、`quality`、`perfhud`、`perfinfo`、`version`、`fmt`、`dom`、`ctx`、`sheet`；`panels/`：`build`、`operate`、`clinic`、`overview`、`map`、`system`、`upgrades`、`common` |

## 2. 時間、經濟與數值

- `state.time = {year, month, week, clock, speed, paused}`。**一個遊戲週 = 一個營業日**：`clock` 從 `OPEN_MIN`（08:00）跑到 `CLOSE_MIN`（20:00），速度 ×1 時需 `WEEK_REAL_SEC = 45` 真實秒（`MIN_PER_REAL_SEC = 16`）。4 週 = 1 月，12 月 = 1 年。
- 開局：`START_MONEY = 1,200,000`，扣掉起始設備定價的 40%（`STARTER_CHARGE_FRAC`）；店面 L0「巷弄小吃店」（12×10）；起始員工 4 位（主廚、廚師、櫃檯收銀、外場服務生，技能 `STARTER_SKILL = 5`）；起始設備見 `build.js` 的 `STARTER_OBJECTS`（點餐結帳櫃檯、候位長椅、綠植、主廚爐台、冷盤檯、煮麵台、滷肉鍋、湯鍋、煎檯、油炸鍋、飲料吧…）。入口：`build.seedStarterShop(state)`。
- **上菜即收現金**（`economy.js`）：`treatment:done` → `earn(price × patientWeight, 'menu'|'special')`，同時記 `food` 支出 `price × 餐點 foodCost × mods.foodCost × patientWeight`。基本菜單（`kind:'menu'`）價格固定；特色料理（`kind:'special'`）價格 = `price × policy.priceMult[id] × mods.selfPayPrice`（滑桿 0.5–2.0，`events.setPriceMult`）。`dine`（內用用餐）的 `price` 為 0，只是佔桌的步驟。
- **PATIENT_WEIGHT**（`economy.js`，28；L3 以 `lots.js patientWeight` 覆寫為 38，經 `economy.patientWeight(state)`）：每位模擬客人代表這麼多組真實客人，只乘在**客人產生的營收與食材成本**，不乘薪資、租金、建造、事件與稽查。
- **月結**（`economy.settleMonth`）：扣薪資（`Σ staff.salary × mods.wageMult`）、租金（`lotDef.rent × mods.rentMult`）、維護費（物件 `upkeep` + 菜單看板維護費）；算毛利率 `(營收 − 食材)/營收`；更新食安風險與網路評價；寫入 `state.history`、重置 `ledger`；發出 `month:settled`；`save.js` 於月初自動存檔。破產：月底 `money < BANKRUPT_LIMIT (−300,000)` → `game:over`。
- **食安風險** `state.safety.risk`（0–100）：月增量來自設備平均耗損 > 30%、體力 < 30% 的員工比例、平均滿意度 < 45、4 人以上卻無員工休息室（單月上限 `MONTH_CAP = 15`）；每週自然 −1；> 60（`RISK_TUNE.HIGH`）時 `cat:'safety'` 事件權重 ×2；> 20 時年度稽查「食安」項目扣分。常數集中在 `economy.RISK_TUNE`。
- **網路評價** `state.reviewScore`（1.0–5.0，初始 4.0）：月平均滿意度 > 70 ↑ 0.05、< 45 ↓ 0.1；新客率 × `(1 + (score − 4) × 0.1)`（`economy.REVIEW_TUNE`）。
- **聲譽** `state.reputation`（0–1000）影響客人到達：`arrivalsPerWeek ≈ (12 + reputation × 0.16) × mods.spawnMult × reviewFactor × 方針與類型權重`（`patients.TUNE.BASE_ARRIVALS`、`REP_FACTOR`），受 `lotDef.maxPatientsPerWeek`（每營業日 40／70／110／150）與同時在場上限（60；L3 100）限制。
- **平衡目標與現況**：目標沿用診所版（起始店第 1 個月約損益兩平；好佈局 +25…40%；專家路線年末月淨利 30–50 萬）。**現況**：起始店月淨利約 ±0～+70k，專家路線 Y2 約 +80～+140k，尚未達標（見 `RESTAURANT_PROGRESS.md`）。旋鈕：`PATIENT_WEIGHT`、`patients.TUNE`、`staff.TUNE`、`treatments.js` 的價格／食材成本率／時長／`uptake`、`lots.js`。

## 3. 資料形狀

### 3.1 靜態資料（`js/data/*.js`，具名匯出的純物件）

```js
// treatments.js — TREATMENTS[id]（17 道）
{ id, name, kind: 'menu'|'special',
  objects: [defId],              // 承載此餐點的站點
  staffRole: [role],             // 可操作職類（任一）
  attend: 'full'|'setup', setupMin?,   // setup：員工只需在開頭 setupMin 分鐘在場
  duration,                      // 遊戲分鐘
  price, foodCost,               // 真實 NT$（每位客人）與食材成本率
  points: {culinary, device, service}, staminaCost,
  requires: researchId|null, cure, uptake?,   // uptake：特色料理的加點意願係數
  intake?: true, intro }         // intake：先決定整份點餐的主餐（回訪客可能跳過）

// buildables.js — BUILDABLES[defId]（32 個）
{ id, name, cat: 'env'|'facility'|'special', sub, layer: 'floor'|'object',
  w, h, blocks, cost, upkeep, requires: researchId|null,
  color, top, height, glyph, desc,
  stationFor?: [dishId], seats?, comfort?, anxietyRelief?, grip?, walkMult? }

// patients.js — PATIENT_TYPES[id]（elder|office|student|family）、FOCUS[id]（business|community|kids）
{ id, name, desc, weight, spawn: [{from,to,w}], speed, patience, needsRamp?, slipProne, selfPay, chatty,
  plans: [{w, steps:[dishId], selfPaySteps:[dishId]}], cureNeeded, visitsToCure:[min,max],
  palette, reputationGain, pointBias, skipMain }

// staffdefs.js — STAFF_ROLES[role]：{name, baseSalary, hireCost, color, skillRange, staminaMax, desc}；TRAITS（10）
// lots.js — LOTS[0..3]：{name, lot:{x0,y0,w,h}, door, rent, maxPatientsPerWeek, maxStaff, expandCost, requires:{minReputation,minYear,minStaff,minAvgSat,needRamp,minSeats,research?,label}, maxPatients?, patientWeight?}
//           INSPECTION_RULES：{id, name, weight, …}（ramp、seats、antislip、staff_license、satisfaction、food_safety）
// research.js — RESEARCH[id]：{id, name, track:'culinary'|'device'|'service', cost, weeks, requires:[id], desc, effects:[{type:'unlockBuild'|'unlockTreatment'|…}]}
// synergies.js — SYNERGIES[]：{id, name, icon, needs:[defId], effects:{modKey: delta}, desc, tier:'basic'|'advanced'|'master', group, hint}
// upgrades.js — UPGRADE_LINES[6]、upgradeCost(…)、upgradeCostTotal(…)
```

事件、成就、目標的格式：事件見 `docs/EVENTS_EXT.md`（診所版遺留標註；欄位以 `data/events_ext.js` 為準），成就見 `data/achievements.js`，目標見 `data/goals.js`。

### 3.2 執行期實體（皆在 `state` 內）

```js
Object = { id, defId, x, y, rot: 0|1, busy, usedBy: null|patientId, staffId: null|staffId, wear: 0,
           broken?, maintainedUntil? }
Staff  = { id, role, name, skill, charm, stamina, staminaMax, salary, trait, level, morale,
           x, y, path:[{x,y}], state: 'idle'|'walking'|'working'|'resting'|'chatting',
           task: null|{patientId, objId, treatmentId, remaining, total?}, wait, … }
Patient（客人）= { id, type, name, x, y, path, stage, plan:[dishId], planIdx, upsold,
           patience, patienceMax, satisfaction, hp(好感), cured(熟客), bubble, targetObj, staffId,
           seat, enteredAt, waitedMin, paid:{menu, special}, flags:{slipped, skipMain},
           selfPaySteps, course, visit, cureScale, … }
// stage：arriving → to_reception → registering → waiting（坐著或站著）→ to_station → treating →（下一步 waiting）… → leaving
```

座標慣例：主體 `x,y` 是浮點格座標，格 (i,j) 涵蓋 [i,i+1)×[j,j+1)；站在格中央時 `x=i+0.5, y=j+0.5`。路徑回傳整數格，主體朝 `tile+0.5` 走。

## 4. 模組 API（重點，簽名以程式為準）

- **`sim/calendar.js`**：`advanceClock(state, dtMin)`、`formatDate`、`formatClock`、`absoluteWeek`、`isOpen`。
- **`sim/economy.js`**：`initEconomy`、`earn`／`spend`、`dishPrice`、`selfPayPrice`、`dishFoodCost`、`patientWeight`、`riskOf`／`addRisk`、`reviewOf`／`addReview`、`reviewFactor`、`monthlyRiskDelta`、`monthlyCosts`、`settleMonth`；常數 `PATIENT_WEIGHT`、`BANKRUPT_LIMIT`、`RISK_TUNE`、`REVIEW_TUNE`、`GOOD_MARGIN`。
- **`sim/patients.js`**：`updatePatients(state, dtMin)`、`spawnPatient`、`closeUp`（週結束清場）、`expectedArrivalsPerWeek`、`releaseObjectUsers`、`TUNE`、`MOD_CLAMP`。
- **`sim/staff.js`**：`updateStaff`、`refreshPool`、`hire`／`fire`／`removeStaff`、`train`、`resignStaff`、`addMorale`／`addStamina`、`TUNE`、`MORALE`。
- **`sim/qualify.js`**：`requiredRolesFor(defId)`、`isUnstaffed(state,obj)`、`unstaffedIds`、`missingRoles`、`treatmentStaffed`、`roleChips`、`requirementText`、`attendOf`／`attendMinutes`、`invalidateQualify`。
- **`sim/equipment.js`**：耗損、故障、`repairObject`、`serviceObject`、`signMaintenance`；受影響設備 `WEAR_DEFS`（油炸鍋、煮麵台、滷肉鍋、煎檯、鐵板檯、主廚爐台、飲料吧、冰品檯…）。
- **`sim/build.js`**：`canPlace`、`placeObject`、`paintFloor`、`removeAt`、`moveObject`／`canMove`、`rotateObject`、`isUnlocked`、`seedStarterShop`。
- **`sim/synergy.js`**：`recomputeZones`、`isZoneActive`、`synergyProgress`。**`sim/modifiers.js`**：`recomputeMods`、`MOD_BOUNDS`、`comfortScoreAt`、`floorGripAt`。
- **`sim/research.js`**：`start`、`canStart`、`isDone`、`tickWeek`、`buyUpgrade`、`canUpgrade`、`maxStaffOf`。
- **`sim/events.js`**：`initEvents`、`triggerEvent`、`resolveDilemma`、`startCommunity`、`setBoard`、`setFocus`、`setPriceMult`、`applyEffects`。
- **`sim/inspection.js`**：`runInspection`、`evaluateRules`、`canExpand`、`expand`。**`sim/career.js`**、**`sim/achievements.js`**、**`sim/save.js`**（`saveGame`／`loadGame`／`listSaves`／`exportSave`／`importSave`／`newGame`）。
- **`render/renderer.js`**：`initRenderer`、`render(state, ui, now)`。**`ui/ui.js`**：`initUI`、`updateUI`。

## 5. 視覺規格

見 `docs/ART_STYLE.md`（檔頭有註記）。程式繪製、等距菱形 64×32 格、`concept_*` 為預設風格，`sprites.js` 為 classic。

## 6. 事件匯流排（名稱 → payload）

| 事件 | payload | 發出者 |
|---|---|---|
| `toast` | `{text, kind}` | 任何模組 |
| `week:start`／`week:end` | `{year, month, week}` | calendar |
| `month:start`／`month:end` | `{year, month}` | calendar |
| `year:start`／`year:end` | `{year}` | calendar |
| `map:changed` | `{}` | build、inspection |
| `mods:dirty` | `{}` | research、events、policy 變更 → main 重算 mods |
| `patient:spawn` | `{patient}` | patients |
| `treatment:done` | `{patient, treatmentId, kind, price（真實 NT$/位）, staffId}` | patients（上菜） |
| `patient:left` | `{patient, satisfaction, cured, reason}` | patients |
| `patient:slip`、`patient:chat` | `{patient}` 等 | patients |
| `dilemma:request` | `{patientId, trigger}`（`freebie`／`skip_main`／`overpush`／`complain`） | patients |
| `dilemma:show`／`event:show` | `{dilemma}`／`{event}`（`state.events.pendingDilemma`） | events |
| `month:settled` | 月結報表：`{income, expense, net, patientWeight, menuIncome, specialIncome, otherIncome, food, margin, salary, rent, maintain, build, otherExpense, year, month, money, risk, reviewScore}` | economy |
| `research:done`／`research:upgrade` | `{id}`／`{id, level, cost, total}` | research |
| `inspection:result` | `{year, pass, score, notes[], rewardOrFine, reputationDelta, rules[]}` | inspection |
| `lot:expanded` | `{level}` | inspection |
| `staff:changed` | `{action:'hire'|'leave', id, role}`（使 `qualify.js` 快取失效） | staff |
| `equipment:broken`／`equipment:fixed` | 設備資訊 | equipment |
| `game:over` | `{reason}` | economy |
| `state:loaded` | `{}` | save |
| `select:changed`、`tool:changed`、`speed:set`、`ui:escape` | 介面狀態 | input／ui |
| `career:*`、`achievement:unlocked`、`achv:changed` | 職涯、成就 | career／achievements |

完整事件清單見 `GAME_ARCHITECTURE.md` §9。

## 7. 完成定義

- `python3 -m http.server` → 開 `index.html` → 看得到起始小店，客人走進來點餐、候位、取餐、用餐、付錢、離開；週／月滾動、月結報表彈窗、建造／拆除、存讀檔皆正常；×3 速度跑 10 分鐘無 console 錯誤。
- `node tools/audit.mjs --quick` 全綠。

## 設施人員資格（qualification rules）

一個設施只有在**薪資名單上有符合資格的員工**時才能運作；`js/sim/qualify.js` 是唯一的判斷來源（`treatments.js` 的 `staffRole`／`attend`／`setupMin` + `buildables.js` 的 `stationFor`）。

| 餐點 | 站點 | 可操作職類（任一） | 到場方式 |
|---|---|---|---|
| `main` 招牌主餐 | 主廚爐台 | 主廚 | full |
| `noodle` 湯麵、`fried` 鹽酥雞炸物 | 煮麵台、油炸鍋 | 廚師 | full |
| `rice` 滷肉飯 | 滷肉鍋 | 廚師、櫃檯收銀 | setup 5 分 |
| `dumpling` 煎餃鍋貼 | 煎檯 | 廚師、外場服務生 | setup 6 分 |
| `teppan` 鐵板燒 | 鐵板檯 | 主廚、廚師 | full（需研發） |
| `side` 小菜 | 冷盤檯 | 外場服務生、櫃檯收銀 | setup 3 分 |
| `soup` 例湯 | 湯鍋 | 外場服務生、櫃檯收銀 | setup 5 分 |
| `drink` 手搖飲 | 飲料吧 | 吧台師、櫃檯收銀 | setup 5 分 |
| `ice` 冰品豆花 | 冰品檯 | 吧台師 | full（需研發） |
| `dine` 內用用餐 | 雙人桌／四人桌 | 外場服務生 | setup 3 分 |
| `steak` 主廚特餐牛排 | 主廚餐檯 | 主廚 | full |
| `seafood` 活海鮮熱炒 | 熱炒爐 | 廚師、主廚 | full |
| `hotpot` 精緻火鍋 | 火鍋桌 | 外場服務生、廚師 | full |
| `bbq` 炭火串燒 | 炭火爐 | 廚師 | full |
| `dessert` 手作甜點 | 甜點吧 | 吧台師 | full |
| `beer` 精釀啤酒與茶酒 | 吧台 | 吧台師、外場服務生 | setup 5 分 |
| `reception` 點餐結帳櫃檯（非餐點） | — | 櫃檯收銀（沒人時客人自助點餐，慢 2.5 倍） | 點餐時 |

* **setup**：員工以 `working` 狀態站在設備旁 `setupMin` 分鐘後離開，設備自行跑完整個餐點時長；體力消耗按 setup 時間比例（`qualify.attendStamina`）。**full**：員工全程綁在該餐點上。
* **缺人**：`isUnstaffed(state, obj)` ＝ 該建造物所載餐點**全部**都沒有符合職類的在職員工才算缺人，部分覆蓋沒問題。缺人的步驟客人會**立即跳過**（不排隊），扣較輕的 `SKIP_ROLE_PENALTY`；根本沒有該設施（或未解鎖）才是完整的 `SKIP_STEP_PENALTY`。設施上顯示 ⚠，放下缺人設施時 toast 提示（每職類一次）。
* **櫃檯收銀兼職**：`TUNE.CASHIER_SETUP` 讓收銀員在沒人排隊、站點在 `CASHIER_RANGE`（3 格）內時順手開冷盤檯、湯鍋、飲料機、滷肉鍋；`CASHIER_PREF` 使有空的收銀員優先於廚師（廚師是稀缺資源）。
* **稽查的「持證人員」規則**（`inspection.evaluateRules`）：缺主廚或缺廚師＝直接不合格；有吧台設備卻沒吧台師、有餐桌卻沒服務生只扣分。
* **UI**：建造卡片／托盤／提示顯示「需要：✔／⚠ 職類」（`ui/roles.js`）。

## 修飾值（`state.mods`）重點

- 乘數型（預設 1）：`nhiTurnover`（基本菜單出餐速度／翻桌率）、`selfPayPrice`、`foodCost`（越低越好，夾 0.5–1.6）、`treatTime`（所有餐點時長，夾 0.6–2）、`cureGain`（夾 0.2–1.6）、`wearRate`、`researchGain`、`spawnMult`、`patience`、`slipRisk`、`staffStamina`、`rentMult`、`wageMult`、`walkSpeed`。
- 加法型（預設 0）：`selfPayConv`（加點轉換率）、`elderSat`、`satGain`（夾 ±12）、`repGrowth`、`typeSat{type}`、`typeCure{type}`；`typeSpawn{type}` 為乘數。
- 計算順序見 `GAME_ARCHITECTURE.md` §7.5；中文標籤在 `sim/efftext.js`（`MOD_LABELS`，`foodCost` 等屬「越低越好」）。

## 效能診斷與最佳化（perf）

引擎層，與題材無關，沿用診所版並已在餐廳版驗證可用。

- **量測管線**：`core/perfstats.js` 固定長度環形緩衝（720 筆，無配置）；`main.js` 每個真正繪製的幀寫入 `frame`（幀間隔）、`sim`（模擬 + `refreshDerived`）、`render`（只計 JS 下指令的時間）、`ui` 時間。Canvas2D 光柵化在 GPU／合成執行緒，不含在 `render` ms 內；真實卡頓請看 fps 與 1% 低。
- **HUD／診斷**：`ui/perfhud.js`（`?perf=1`／`F3`／設定開關，`restgame.perfhud`；關閉時零成本）、`ui/perfinfo.js`（裝置資訊）、`ui/quality.js`（畫質）。
- **畫質**（`restgame.quality`）：自動／高／中／低，對應 level 0／2／3；level 越高越省（DPR 上限、無暗角、無地面陰影、無車輛／天氣粒子等）。自動模式只在觸控裝置自動調整。
- **幀率上限 30**（`restgame.fpscap`）：`main.js frame()` 以 `nextDue` 略過 rAF tick；`last` 只在有做事的幀更新，所以遊戲時間仍按真實秒數前進。
- **版本與更新**：`pages.yml` 寫入 `version.json = {sha, built}`；`ui/version.js` 開機讀一次，分頁回到前景（距上次 > 30 秒）與每 10 分鐘再讀，sha 不同就提示「有新版本」。
- **渲染最佳化**（概念風格為主）：視窗裁切（螢幕外的設備與地板不畫）、鋪設地板併入背景快取、人物縮放快取、行走傾斜不用 `save/restore`、`ensureSize()` 不每幀強制 layout。細節與量測數字見 git 歷史中診所版的 ARCHITECTURE。
- **工具**：`tools/perftest.mjs`（功能測試）。
- **已知限制**：手機 DPR 3、縮放 2.5 時大張精靈仍是最貴的繪製；縮放手勢跨過級距時會一次建立所有可見精靈的新層級，無頭軟體 GL 下有尖峰，真機未驗證。
