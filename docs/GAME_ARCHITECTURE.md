# 餐廳物語 — 遊戲架構總覽

> 這份文件描述「目前程式碼實際的結構」（餐廳版，由《復健科診所物語》移植），給接手的人快速讀懂整個遊戲。以程式碼為準；與程式不符時請以程式為準並回頭修文件。
> 移植對照與內部名稱的語意見 `docs/RESTAURANT_DESIGN.md`，進度見 `docs/RESTAURANT_PROGRESS.md`。細部契約與資料格式見 `docs/ARCHITECTURE.md`；其他專題文件（`EVENTS_EXT`、`ACHIEVEMENTS`、`GOALS_AND_ENDING`、`ART_STYLE`）檔頭都有「診所版遺留」註記，閱讀時請留意。

---

## 1. 一句話概述

台灣小吃店／餐廳的 2.5D 等距像素風經營模擬（Kairosoft 風格）。瀏覽器單頁應用，純 HTML5 Canvas + 原生 ES Modules，**沒有建置步驟、沒有 npm 執行期相依、沒有外部 CDN**。

- 介面語言：繁體中文（台灣用語）。
- 版面：橫向與直向都支援，手機直向為主要版型之一。
- 遊戲時間：**1 個遊戲週 = 1 個營業日**（08:00–20:00），4 週 = 1 個月，12 個月 = 1 年。
- 生涯：10 年（含年度目標與結局）；達成後可進入「無盡」模式。
- 開局：資金約 NT$ 1,200,000 扣掉起始設備的一部分；一間 12×10 的「巷弄小吃店」，4 位員工（主廚、廚師、櫃檯收銀、外場服務生）與一排爐具、點餐結帳櫃檯、候位長椅（`build.js` 的 `seedStarterShop`）。

> **內部名稱**：引擎沿用診所版的結構性名稱，玩家看不到。`state.patients`＝客人（一個模擬客人代表 N 組真實客人）、`TREATMENTS`＝餐點、`treatment:done`＝上菜、`cured`＝變成熟客、`selfPay*`＝特色料理／加點、`reception`＝點餐結帳櫃檯、`ui.panel === 'clinic'`＝「餐廳」面板。完整對照見 `RESTAURANT_DESIGN.md` §1。

---

## 2. 目錄結構

```
index.html              頁面骨架：#topbar、#stage（canvas#game、#sidebar、#panel、#speedbar、#toast-layer、#tooltip）、#modal-root
manifest.webmanifest    PWA 清單（可安裝成 App，theme 色為暖紅）
sw.js                   Service Worker（離線快取殼層、network-first 的 version.json）
css/style.css           基礎樣式
css/ui.css              介面樣式（概念圖風格以 html.style-concept 限定）
css/mobile.css          手機版型與覆寫
icons/                  PWA 圖示（麵碗）
js/
  main.js               啟動流程與主迴圈（唯一入口）
  core/                 與遊戲無關的基礎：常數、狀態、事件匯流排、格子、效能統計
  data/                 純資料（不含邏輯）：建造物、餐點、客人、員工、研發、事件、成就、目標、費用…
  sim/                  模擬邏輯（無 DOM）：時間、經濟、客人、員工、建造、事件、存檔、職涯…
  render/               Canvas 繪製：等距投影、相機、輸入、場景與精靈
  ui/                   DOM 介面：側欄、頂部列、彈窗、提示、封面、支持作者…
  ui/panels/            面板：build、operate、clinic（餐廳）、overview、map、system（+ upgrades）
tools/                  自動化測試與平衡模擬（Playwright 與 Node 腳本，見 §12）
docs/                   設計與契約文件
.github/workflows/      pages.yml：部署到 GitHub Pages（本分支不在自動部署清單內，見 §13）
```

> 餐廳版**沒有** `assets/art/`（圖集已移除），所有美術都以程式繪製。

---

## 3. 啟動流程（`js/main.js`）

1. `boot()` 取得 `#game` canvas，依序初始化：渲染器 → 相機 → 輸入 → 經濟 → 事件 → 研發 → 稽查（`initInspection`）→ 成就 → 職涯。
2. 註冊全域監聽（`mods:dirty`、`map:changed`、`week:end` → `closeUp`、`month:start` → `refreshPool`、`state:loaded`、`speed:set`）。
3. 若有自動存檔就 `loadGame(state,'auto')`，否則 `seedStarterShop(state)` 建立開局小店並補人員池（`refreshPool`）。
4. `refreshDerived()`：重建佔用格、計算專區、重算修飾值（`mods`）。
5. `initUI`、`initQuality`（畫質與幀率上限）、`initPerfHud`、`initVersion`。
6. 若未在自動化環境且沒有 `?nocover`，顯示**封面**（`ui/cover.js`）：封面期間 `ui.coverOn = true`，模擬暫停；按「開始／繼續」才進入遊戲。
7. 暴露 `window.__game = {state, ui, bus, refreshDerived}` 供測試與除錯使用。

---

## 4. 主迴圈（`requestAnimationFrame`）

每一幀依序做：

1. **幀率上限**：`perfCfg.fpsCap === 30` 時跳過部分幀（時間仍以真實秒數前進）。
2. **dt 計算**：`dt = min(真實秒, 0.1)`，避免分頁切換後一次跳太多。
3. **佔用格重建**：若 `ui.dirtyOcc`（地圖有改動）→ `refreshDerived()`。
4. **是否凍結**：有待決定的兩難（`state.events.pendingDilemma`）或封面中 → 速度視為 0。
5. **模擬子步進**：`remain = dt × speed × MIN_PER_REAL_SEC`，以 ≤ 1 遊戲分鐘為單位反覆呼叫：
   `advanceClock` → `updateStaff` → `updatePatients`（每步若地圖改動再重建）。
6. **繪製**：`render(state, ui, now)`（canvas）。
7. **介面**：`updateUI(state, ui)`（DOM，約 5 Hz 節流）。
8. 記錄效能樣本（`pushFrame`）。

> 原則：**模擬與繪製分離**。`sim/` 只改 `state`，不碰 DOM 或 canvas；`render/` 與 `ui/` 只讀 `state`、寫 `ui`。

---

## 5. 狀態模型（`js/core/state.js`）

全遊戲唯一的資料來源是 `state`（**可 JSON 序列化的純資料**，不放 class 實例、函式、Map、Set）。`ui` 是純檢視狀態（相機、目前面板、工具），**不存檔**。

| 欄位 | 內容 |
|---|---|
| `time` | `{year, month, week, clock, speed, paused}`；`clock` 為當日分鐘數 |
| `money`、`points`、`reputation`、`shopName` | 資金、三種點數（`culinary` 廚藝／`device` 設備／`service` 服務）、聲譽（0–1000）、店名 |
| `weather` | `{kind, temp}`，`kind`：sunny／cloudy／rain／cold／hot／typhoon |
| `lotLevel`、`lot`、`door` | 店面等級（0–3）、可建範圍、客人出入口 |
| `map.floor`、`map.occ`（快取，不存） | 地板格（`floor_tile`／`floor_wood`／`ramp`）；佔用格由 `grid.rebuildOccupancy` 重建 |
| `objects[]` | 已放置的設備與家具（含 `wear`、`broken`、`maintainedUntil`） |
| `staff[]`、`hirePool[]` | 在職員工與可招募人選 |
| `patients[]`、`queue[]` | 客人實體（狀態機）與點餐結帳排隊 |
| `policy` | `focus`（`business`／`community`／`kids`）、`priceMult`（特色料理價格滑桿，0.5–2.0）、`boards`（菜單看板） |
| `research` | `{done[], current, progress, levels{}}`（研發樹與持續精進） |
| `zones[]` | 專區（計算結果，由 `synergy.js` 產生） |
| `mods` | 修飾值彙總（由 `modifiers.js` 計算） |
| `safety` | `{risk}`：**食安風險** 0–100（取代診所版的 `state.nhi`） |
| `reviewScore` | 網路評價 1.0–5.0（預設 4.0，惰性建立；每 0.1 影響新客率 ±1%） |
| `ledger`、`history[]` | 本月收支（收入 `menu／special／other`；支出 `salary／rent／build／maintain／food／other`）、每月快照 |
| `stats` | 今日／本月／累計客人、熟客數（`cured`）、生氣數、滿意度累計 |
| `events` | 生效中的事件效果（buff）、紀錄、待決定兩難、冷卻（另有 `flags`、`pendingFollowUps`） |
| `inspections` | `{lastYearResult}` |
| `flags`、`achv`、`career` | 新手導覽與一次性旗標、成就、職涯（目標、年度審查、結局） |
| `version` | 存檔版本（目前 `SAVE_VERSION = 1`） |

`createInitialState()` 產生新局；`defaultMods()` 定義所有修飾值的預設（加法型或乘數型）。餐廳版的修飾值鍵沿用診所版名稱（`nhiTurnover`＝翻桌率、`selfPayConv`＝加點轉換率、`selfPayPrice`＝特色料理售價倍率…），另新增 `foodCost`（食材成本倍率，越低越好）。

---

## 6. 模組分層與相依規則

```
core ◀── data ◀── sim ◀── render
  ▲                 ▲        ▲
  └──────── ui ─────┴────────┘  （ui 讀 sim/data/render 的 API，寫 ui 與 bus）
```

即 `core ← data ← sim ← render / ui`：

- `core/`：`constants.js`（所有時間與尺寸常數，唯一定義處）、`state.js`、`bus.js`（同步事件匯流排）、`grid.js`（格子工具）、`perfstats.js`。
- `data/`：只有資料與少量純函式（例如 `upgrades.js` 的成本公式）。**不得 import sim 或 ui**。
- `sim/`：遊戲規則。模組之間不直接互相 import 形成循環，跨模組通知一律用 `bus`（例如 `events.js` 以 `setBoardUpkeepResolver` 注入看板維護費，避免與 `economy.js` 互相 import）。
- `render/`：`iso.js`（等距投影）、`camera.js`、`input.js`、`renderer.js`（主繪製）、`sprites.js`（classic 程式繪製精靈）、`art.js`／`artdraw.js`（人物與方向幀；圖集旗標 `ATLAS_AVAILABLE = false`，因此一律走程式繪製）、`concept_*.js`（概念圖風格的場景與物件）、`touchui.js`（畫布上的觸控建造列）。
- `ui/`：`ui.js`（總協調，`initUI`／`updateUI`）、`sidebar.js`、`topbar.js`、`selection.js`（選取卡）、`tooltip.js`、`modal.js`／`modals.js`（彈窗佇列）、`toast.js`、`speedbar.js`、`career.js`（職涯 UI）、`cover.js`、`installbox.js`、`support.js`、`moods.js`（客人與員工表情）、`roles.js`（人員資格小標）、`quality.js`／`perfhud.js`／`perfinfo.js`／`version.js`（效能與版本）、`theme.js`／`icons.js`／`artdom.js`（概念風格外框與圖示）。

---

## 7. 模擬核心

### 7.1 時間（`sim/calendar.js`）
`advanceClock(state, dtMin)` 推進時鐘；跨過 20:00 → 週結束（`week:end`，`patients.closeUp` 清場），四週 → 月結算（`month:end` → `economy.settleMonth`），十二月 → 年度（`year:start`／`year:end`，觸發稽查與職涯審查）。

### 7.2 客人（`sim/patients.js`，最大的模組）
每位客人是一個狀態機，階段（`stage`）依序為：
`arriving → to_reception → registering → waiting → to_station → treating → waiting … → leaving`（另有 `talk`、`timeout`、`go`、`gone` 等收尾階段）。

- **到達**：`arrivalsPerWeek ≈ (12 + reputation × 0.16) × mods.spawnMult × reviewFactor × 方針與類型權重`，其中 `reviewFactor = 1 + (reviewScore − 4) × 0.1`；受店面上限（`lots.js` 的 `maxPatientsPerWeek`＝每營業日上限 40／70／110／150；同時在場 `TUNE.MAX_PATIENTS` 60，L3 為 100）限制。回頭客（熟客累積中）會預約下一次來訪。
- **客人類型**（`data/patients.js`）：`elder` 晨間長輩客、`office` 上班族午餐客、`student` 放學學生族、`family` 親子家庭客。各有出沒時段、耐性、加點意願（`selfPay`）、滑倒風險、套餐組合（`plans`，由餐點步驟組成，最後多半是 `dine` 內用）。
- **餐點步驟**：每個步驟佔用一個站點（設備）與所需員工（見 §7.3）；完成後 `treatment:done`，累積好感（`hp` → 熟客）、滿意度與研發點數。
- **加點／特色料理**：符合條件（已解鎖且已建造）的特色料理以 `selfPaySteps` 形式向客人推銷，轉換率受 `selfPayConv`、客人 `selfPay` 與員工魅力影響；價格受滑桿 `priceMult` 與 `mods.selfPayPrice` 影響。
- **離開**：用餐完畢、耐性耗盡（生氣）或等太久（逾時）都會離開，寫入統計與成就計數；好感達標者成為**熟客**（`cured`），並可能預約再訪。

### 7.3 員工與設施資格（`sim/staff.js`、`sim/qualify.js`）
- **五種職類**（`ROLES`，順序固定）：`chef` 主廚、`cook` 廚師、`barista` 吧台師、`server` 外場服務生、`cashier` 櫃檯收銀。
- 每人有體力、士氣（`morale`）、特質（10 種）、薪資；員工休息室（`rest_room`）可恢復體力；離職事件與士氣影響去留。
- **設施資格**（`qualify.js`，唯一判斷來源）：每道餐點指定可操作的職類（`staffRole`，任一即可）。`attend: 'setup'`（滷鍋、煎檯、冷盤檯、湯鍋、飲料機、餐桌…）只需員工在開頭 `setupMin` 分鐘在場，之後設備自行跑完；`attend: 'full'` 全程綁員工。沒有合格人員時該步驟**立即跳過**並扣滿意度，設施上顯示 ⚠ 標示。櫃檯收銀可兼看冷盤檯、湯鍋、飲料機（`TUNE.CASHIER_SETUP`，需附近且沒人排隊）。
- 走路與閒晃由 `sim/staff.js` 處理；行進路徑由 `sim/pathfinding.js` 的 A\*（四方向）提供，客人與員工都限制在店內範圍（加上門口一格）。

### 7.4 建造與專區（`sim/build.js`、`sim/synergy.js`）
- `buildables.js` 定義 **32** 種建造物（分三大類：環境〔地板與通道、候位與景觀〕、設施〔櫃檯與餐桌、熱廚、吧台冷食、特色料理〕、特殊），含尺寸、價格、研發前置、站點種類（`stationFor`）與基礎效果。
- `build.js`：放置驗證、拖曳繪製地板、拆除（退 50%）、搬移（收搬遷費）、開局小店（`seedStarterShop`）。
- **專區**（`synergy.js` + `data/synergies.js`，共 15 個，分組：廚房、候位、員工、親子、特色料理、學生、長者；等級：基礎／進階／大師）：相鄰（格子距離 ≤ 1）的設備連通分量若包含某專區要求的全部設備，即啟動並加上修飾值（例如「黃金爐火區」`golden3`）。`recomputeZones` 在地圖改動後重算。

### 7.5 修飾值（`sim/modifiers.js`）
所有來源彙總到 `state.mods`，固定順序：
**專區 → 研發 → 天氣 → 事件與社區活動 → 菜單看板 → 經營方針 → 環境（舒適度、地板防滑）**。
修飾值分兩類：乘數型（預設 1，如 `treatTime`、`wearRate`、`foodCost`）與加法型（預設 0，如 `satGain`、`repGrowth`）；`typeSat`、`typeCure` 為每種客人一筆。每個修飾值都有上下限（`MOD_BOUNDS`，例如 `foodCost` 0.5–1.6），避免多重疊加失衡。

### 7.6 研發與持續精進（`sim/research.js`、`data/research.js`、`data/upgrades.js`）
- 研發樹 27 個節點、3 條軌道（廚藝／設備／服務，各對應一種點數）；研發點由上菜產生，以週為單位推進。
- 研發完成後進入**持續精進**（6 條線：手藝精進、口味掌握〔廚藝〕、設備精進、流程最佳化〔設備〕、客戶關係、品牌聲望〔服務〕）：可重複購買，每級有上限、價格隨等級成長，效果同樣經 `mods` 上下限約束。

### 7.7 經濟（`sim/economy.js`）
- **上菜即收現金**：`treatment:done` 時 `earn(price × patientWeight, 'menu'|'special')`，同時以 `price × 該餐點 foodCost × mods.foodCost × patientWeight` 記入 `food` 支出。基本菜單（`kind: 'menu'`）價格固定；特色料理（`kind: 'special'`）價格 = `price × priceMult 滑桿 × mods.selfPayPrice`。已移除診所版的健保點值稀釋、診察費階梯、部分負擔。
- **客人權重**：`PATIENT_WEIGHT = 28`，L3 為 38（`lots.js` 的 `patientWeight`），只套用在客人產生的收入與食材成本，**不**套用在薪資、租金、建造、事件與稽查。
- **月結**（`settleMonth`）：扣薪資、租金（`lotDef.rent × mods.rentMult`）、維護費（物件 `upkeep` + 菜單看板），產生月結紀錄（營收、食材成本、毛利率、食安風險、網路評價…）、推入 `history`、重置 `ledger`，發出 `month:settled`（事件名沿用，內容是月結報表）。毛利率 ≥ 0.62（`GOOD_MARGIN`）算「毛利達標月」，供職涯指標使用。
- **食安風險**（`state.safety.risk`，0–100）：每月依設備平均耗損（超過 30%）、疲勞員工比例、滿意度偏低、無員工休息室而增加（單月上限 +15），每週自然 −1；高於 60 時 `safety` 類事件權重 ×2；高於 20 時年度稽查的「食安」項目扣分。
- **網路評價**（`state.reviewScore`）：每月依平均滿意度漂移（> 70 ↑ 0.05、< 45 ↓ 0.1），影響新客率。
- **破產**：月底資金 < −300,000 → `game:over`。
- 每道餐點的 `price`／`foodCost` 在 `data/treatments.js`；`data/fees.js`（`DISH_FEES`，`FEES_AS_OF = '2026-10'`）是各餐點的參考價與成本率對照（含可信度標記），UI（選取卡、運作面板）讀它。模擬內不硬寫價格。

### 7.8 事件（`sim/events.js` + `data/events*.js`）
- 天氣（7 種）、隨機事件（15）、擴充事件（58，`events_ext.js` 30 個與 `events_ext2.js` 28 個）、社區活動（7）、菜單看板（7）、兩難（12，會**凍結模擬**並彈出決策視窗；觸發類型 `freebie`／`skip_main`／`overpush`／`complain`）。
- 事件類別含 `safety`（食安）、`patient`（客人）、`ops`、`season` 等；事件效果可包含金錢、聲譽、滿意度、食安風險（`risk`）、網路評價（`reviewScore`）、設備耗損與故障、員工士氣與離職、持續 buff（以 `mods` 加法改值）、旗標與連鎖事件。格式見 `docs/EVENTS_EXT.md`（檔頭有診所版殘留註記）。
- 設備耗損與故障在 `equipment.js`，員工士氣與離職在 `staff.js`，食安風險與網路評價在 `economy.js`。

### 7.9 稽查（`sim/inspection.js`）
每年一次**衛生局稽查**：依規則（無障礙坡道、候位座位、防滑覆蓋率、持證人員〔缺主廚或廚師＝直接不合格〕、全年滿意度、食安風險）計分，及格 70、優良 88（發獎勵金 NT$ 200,000），不及格罰款並扣聲譽。另含擴建店面（`canExpand`／`expand`，發出 `lot:expanded`）：每級店面有聲譽、年資、員工數、滿意度、坡道、座位與研發條件。

### 7.10 成就（`sim/achievements.js`、`data/achievements.js`）
58 個成就（3 類：經營里程碑、台灣在地特色、挑戰與隱藏；3 階），以計數器與事件監聽解鎖；每個成就有獎勵（資金、點數、聲譽，徽章與稱號），`achievement:unlocked` 通知 UI。

### 7.11 職涯（`sim/career.js`、`data/goals.js`）
- 新手任務 10 項 → 每年 1 個核心目標 + 2 個加分目標（核心 10 個、加分 30 個）。
- 年度審查（評等 S／A／B／C／D）→ 10 年結局（9 種，含 `bankrupt`）→ 結局後可進入無盡模式。
- 指標（38 個 `GOAL_METRICS`）從 `state` 直接計算，不另存副本。部分金額與人次門檻仍是診所版數字（見 `RESTAURANT_PROGRESS.md` 待辦）。

### 7.12 存檔（`sim/save.js`）
- 三個手動槽位加一個自動存檔（`localStorage` 鍵 `restgame.save.<slot>`）；每個月結束自動存檔。
- 存檔內容是 `state` 的 JSON（不含 `map.occ`），載入時逐欄位 sanitize（補預設值、夾住範圍）。
- 也支援匯出／匯入 JSON 字串與檔案。
- 存檔版本由 `SAVE_VERSION` 控制，餐廳版重置為 1（`MIGRATIONS` 目前只有 0→1 的空遷移）。

---

## 8. 渲染（`js/render/`）

- **座標系**：世界座標 = 像素（縮放 1 時）；`iso.js` 的 `gridToScreen` 把格子映到等距菱形（64×32）。螢幕座標 = 世界 × zoom + 相機偏移。
- **相機**（`camera.js`）：右鍵／中鍵拖曳平移、滾輪以游標為中心縮放（0.5–2.5）、觸控雙指。`ui.cam` 只存在 `ui`。
- **輸入**（`input.js`）：左鍵 = 工具（放置、繪地板、拆除、選取）；鍵盤快捷鍵（B/O/C/V/P/Y 切面板，R 旋轉，M 移動，1/2/3 速度，空白鍵暫停，G 格線，Esc 取消）。
- **繪製順序**：靜態層（地面、地板、牆、景物，快取）→ 依深度排序的物件與人（使用物件池，避免每幀配置）→ 疊加層（氣泡、進度條、專區光圈、天氣粒子、⚠ 標示）。
- **美術**：沒有圖集（`art.js` 的 `ATLAS_AVAILABLE = false`），一律程式繪製。偏好存 `localStorage 'restgame.art'`：`new`（預設，概念圖風格：`concept_objects.js`、`concept_scene.js`，UI 以 `html.style-concept` 限定）或 `classic`（`sprites.js` 的原像素風）。美術規範見 `docs/ART_STYLE.md`（檔頭有註記：色票仍是診所版的醫療藍）。
- **畫質**：自動／高／中／低。依裝置與幀率調整解析度上限、地面陰影與車輛粒子等。

---

## 9. 介面（`js/ui/`）

- **版型**：`layout.js` 判斷 desktop／compact／portrait，決定側欄、面板位置（桌機並排、手機為底部抽屜）與 `layout.mobile`。
- **頂部列**（`topbar.js`）：店名、日期與時鐘、天氣；資金、三種點數（廚藝／設備／服務）、聲譽、**食安**（取代診所版的健保點值）。
- **側欄**（`sidebar.js`）：六個面板按鈕（建造 B、運作 O、**餐廳 C**〔面板 id `clinic`〕、一覽 V、地圖 P、系統 Y）。
- **面板**（`ui/panels/`）：
  - **建造**（`build.js`）：設施與地板的目錄，含研發前置、人員資格小標。
  - **運作**（`operate.js`）：目前的客人流程、特色料理定價滑桿、菜單看板、經營方針、持續精進（`upgrades.js`）入口。
  - **餐廳**（`clinic.js`）：目標（預設分頁，職涯）、員工清單與士氣、招募、設備維護表（維修、保養、缺人標示）。
  - **一覽**（`overview.js`）：營運數據、專區辭典（15 個專區，可在地圖上定位）、成就、事件紀錄。
  - **地圖**（`map.js`）：熱度圖與格子資訊。
  - **系統**（`system.js`）：存檔、匯出匯入、營運圖表、設定（美術、畫質、幀率上限、效能診斷、安裝與全螢幕）、支持作者（有網址時才出現）。
- **選取卡**（`selection.js`）：點選客人、員工或設備時顯示詳情與操作。
- **彈窗**（`modal.js` + `modals.js`）：統一的 backdrop／modal 結構與佇列（月結報表、年度審查、結局、事件、兩難、稽查結果、新手導覽、操作說明等依優先序排隊）。彈窗開啟時自動暫停模擬，關閉後還原速度。
- **提示**：`toast.js`、`tooltip.js`、`ctxmenu.js`（右鍵選單）。
- **封面**（`cover.js`）、**支持作者**（`support.js` + `data/support.js`，網址留空即全部隱藏）、**安裝與全螢幕**（`installbox.js`、`pwa.js`）、**版本**（`version.js`，讀部署時寫入的 `version.json`）。

### 事件匯流排

`core/bus.js` 是同步的發布／訂閱（`bus.on(evt, fn)` 回傳取消函式，`bus.emit(evt, payload)`）。以下為程式碼中實際發出的事件：

| 類別 | 事件 |
|---|---|
| 時間 | `week:start`、`week:end`、`month:start`、`month:end`、`year:start`、`year:end`、`speed:set` |
| 經濟 | `month:settled`（月結報表）、`treatment:done`（上菜，payload `{patient, treatmentId, kind, price, staffId}`）、`game:over` |
| 客人與員工 | `patient:spawn`、`patient:left`（`{patient, satisfaction, cured, reason}`）、`patient:slip`、`patient:chat`、`staff:changed`（`hire`／`leave`）、`staff:resigned` |
| 建造與地圖 | `map:changed`、`mods:dirty`、`object:move`、`object:moved`、`object:context`、`lot:expanded` |
| 事件與兩難 | `event:show`、`dilemma:request`、`dilemma:show`、`dilemma:resolved`、`community:started`、`equipment:broken`、`equipment:fixed` |
| 研發與稽查 | `research:done`、`research:upgrade`、`inspection:result` |
| 職涯與成就 | `career:changed`、`career:onboarding-done`、`career:goal-done`、`career:year-review`、`career:ending`、`career:ui-data`、`achievement:unlocked`、`achv:changed` |
| 介面 | `toast`、`select:changed`、`tool:changed`、`layout:changed`、`ui:escape`、`ui:bmode`、`quality:changed`、`perfhud:changed`、`pwa:changed`、`cover:closed`、`art:changed`、`version:loaded`、`version:update` |
| 存檔 | `state:loaded` |

> 規則：`sim/` 發出的事件只帶資料，不帶 DOM；`ui/` 監聽並決定怎麼呈現。

---

## 10. 資料層（`js/data/`）

| 檔案 | 內容 |
|---|---|
| `buildables.js` | 32 種建造物與分類（`BUILD_CATEGORIES`） |
| `treatments.js` | 17 道餐點（基本菜單 `menu` 11、特色料理 `special` 6）：時長、所需職類、站點、價格、食材成本率、解鎖研發 |
| `patients.js` | 4 種客人（`PATIENT_TYPES`）與 3 種經營方針（`FOCUS`：商業午餐店、社區早餐店、親子餐廳） |
| `staffdefs.js` | 5 個職類（`STAFF_ROLES`）、特質（10）、人名 |
| `research.js` | 研發樹 27 節點、3 軌道 |
| `upgrades.js` | 持續精進 6 條線與成本公式 |
| `synergies.js` | 專區 15 個與分組、等級、解鎖提示 |
| `lots.js` | 店面 4 級（巷弄小吃店、社區餐館、地區人氣餐廳、全台旗艦餐廳）：尺寸、租金、每日上限、員工上限、擴建條件；稽查規則 `INSPECTION_RULES` |
| `fees.js` | 各餐點參考價與食材成本率（`DISH_FEES`，由診所版的健保費用表改寫；與 `FEE_RESEARCH.md` 無關） |
| `events.js` / `events_ext.js` / `events_ext2.js` | 天氣、隨機事件、擴充事件（共 73）、社區、看板、兩難 |
| `achievements.js` | 58 個成就 |
| `goals.js` | 新手任務、核心與加分目標、指標、結局、審查文字 |
| `texts.js` | 導覽、提示、說明文字 |
| `support.js` | 支持作者頁面設定（網址留空即隱藏） |

資料檔一律具名匯出（named exports），不使用 default export。

---

## 11. 平衡與數值

- 目前實測（`tools/bal.mjs`）：起始店月淨利約 ±0～+70k（毛利率 ~67%）；專家路線 Y2 月營運淨利約 +80～+140k；**尚未達到**沿用自診所版的「年末月淨利 30–50 萬」目標，仍需調整（見 `RESTAURANT_PROGRESS.md`）。
- 主要旋鈕：`PATIENT_WEIGHT`（28／L3 38）、`patients.js` 的 `TUNE`（到達常數）、`staff.TUNE`、`treatments.js` 的價格／食材成本率／時長／`uptake`、`lots.js` 的容量。
- 修飾值的上下限集中在 `modifiers.js` 的 `MOD_BOUNDS`。

---

## 12. 測試與驗證（`tools/`）

Node 腳本；UI 類使用 Playwright（Chromium），各自啟動 `python3 -m http.server <port>`。

| 工具 | 用途 | 狀態 |
|---|---|---|
| `audit.mjs`（`--quick` / 完整 / `--only <區段>`） | 純邏輯稽核（經濟、事件、設施資格、升級、專區、職涯、存檔…，`--quick` 1720 項） | 綠 |
| `smoke.mjs`、`uitest.mjs`、`coverui.mjs` | 冒煙、介面互動、封面 | 綠 |
| `bal.mjs` | 無瀏覽器平衡模擬（`policy=expert months=48` 等參數） | 可用 |
| `play.mjs`、`mobileui.mjs`、`perftest.mjs`、`stylecss.mjs`、`touch.mjs`、`touchtest.mjs`、`careerui.mjs`、`stress.mjs`、`stress-page.js` | 遊玩流程、手機版型、效能、樣式、觸控、職涯、壓力 | 已改為餐廳版，尚未逐一重跑 |
| `qualifyui.mjs`、`upgradesui.mjs`、`zonesui.mjs` | 資格、升級、專區的介面測試 | **仍有診所版斷言**（物理治療師、`bed`、醫術點數、專區數量） |
| `zonecombo.mjs`、`zonelayouts.mjs`、`lib.mjs`、`genicons.mjs` | 專區組合／佈局輔助、共用函式、圖示產生 | — |

自動化測試環境會被偵測為 `navigator.webdriver`，因此預設不顯示封面（`?cover=1` 可強制顯示）。

---

## 13. 部署與版本

- **分支**：餐廳版開發於 `claude/restaurant-game`；診所版在 `claude/rehab-clinic-game`，不要動它。`pages.yml` 目前只在 `main` 與 `claude/rehab-clinic-game` push 時自動部署，餐廳版**不在清單內**（避免覆蓋診所版的 Pages）；要上線請手動 `workflow_dispatch`，或把本分支加進 `on.push.branches`。
- **部署內容**：`index.html`、`manifest.webmanifest`、`sw.js`、`css/`、`js/`、`icons/`，另寫入 `version.json`（commit SHA 與建置時間）。
- **Service Worker**：快取殼層（`SHELL` 清單）；`version.json` 採 network-first，讓「有新版本」提示在線上時準確。
- **版本號**：遊戲內「系統 → 設定」顯示建置版本；本機開發顯示 `dev`。

---

## 14. 擴充指南（給接手者）

- **新增建造物**：在 `data/buildables.js` 加定義（`stationFor` 指定可承載的餐點）；若屬於專區，在 `data/synergies.js` 加入需求。繪製由 `concept_objects.js` 處理。
- **新增餐點**：`data/treatments.js` 加項目（`kind` 為 `menu`／`special`，並設 `objects`、`staffRole`、`attend`、`price`、`foodCost`），並在 `sim/qualify.js` 確認職類規則；不要在模擬中寫死價格。
- **新增事件**：`data/events_ext*.js` 加一筆，遵守 `docs/EVENTS_EXT.md` 的格式；`node tools/audit.mjs --only events` 會強制觸發每個事件的每個選項。
- **新增修飾值**：在 `defaultMods()` 加預設、在 `modifiers.js` 加上下限、在 `efftext.js` 加中文標籤。
- **新增成就或目標**：分別在 `data/achievements.js`、`data/goals.js` 定義；計數或指標在 `sim/achievements.js`、`sim/career.js` 計算，不要在 UI 重算。
- **存檔欄位變更**：增加欄位時，在 `save.js` 的 sanitize 補上預設值；欄位語意改變時提升 `SAVE_VERSION`。
- **不要做的事**：`sim/` 內不碰 DOM 與 canvas；`data/` 不 import `sim/` 或 `ui/`；不在 `state` 放函式或 class 實例；不用循環 import，跨模組通知用 `bus`；不要改用 `ptgame.*` 儲存鍵（餐廳版一律 `restgame.*`）。

---

## 15. 已知限制與待辦

- **平衡**：專家路線月淨利仍低於沿用的診所版目標；`goals.js` 的金額與人次門檻是診所版數字。
- **測試**：`qualifyui`／`upgradesui`／`zonesui` 仍有診所版斷言；其餘已改的工具未逐一重跑。
- **美術**：全部程式繪製，可再精修；`ART_STYLE.md` 色票仍是診所版的醫療藍。
- **手機**：Android 上的雙指縮放與高 DPR 縮放尚未實機測試。
- **其他文件**：`README.md` 部分敘述仍待更新；診所專用研究文件已標註不適用（見 `RESTAURANT_PROGRESS.md`）。
