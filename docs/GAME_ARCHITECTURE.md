# 復健科診所物語 — 遊戲架構總覽

> 這份文件描述「目前程式碼實際的結構」，給接手的人快速讀懂整個遊戲。
> 細部契約與數值依據請看：`docs/ARCHITECTURE.md`（資料格式與契約）、`docs/ART_STYLE.md`（美術）、`docs/GOALS_AND_ENDING.md`（目標與結局）、`docs/ACHIEVEMENTS.md`（成就）、`docs/EVENTS_EXT.md`（擴充事件）、`docs/FEE_RESEARCH.md`（費用依據）。

---

## 1. 一句話概述

台灣復健科診所的 2.5D 等距像素風經營模擬（Kairosoft 風格）。瀏覽器單頁應用，純 HTML5 Canvas + 原生 ES Modules，**沒有建置步驟、沒有 npm 執行期相依、沒有外部 CDN**。部署到 GitHub Pages（`https://anewlearner1.github.io/ptgame/`）。

- 介面語言：繁體中文（台灣用語）。
- 版面：橫向與直向都支援，手機直向為主要版型之一。
- 遊戲時間：**1 個遊戲週 = 1 個營業日**（08:00–20:00），4 週 = 1 個月，12 個月 = 1 年。
- 生涯：10 年（含年度目標與結局）；生涯達成後可進入「無盡」模式。

---

## 2. 目錄結構

```
index.html              頁面骨架：#topbar、#stage（canvas#game、#sidebar、#panel、#speedbar、#toast-layer、#tooltip）、#modal-root
manifest.webmanifest    PWA 清單（可安裝成 App）
sw.js                   Service Worker（離線快取、network-first 的 version.json）
css/style.css           舊版（像素風）基礎樣式
css/ui.css              介面樣式（概念圖風格以 html.style-concept 限定）
css/mobile.css          手機版型與覆寫
icons/                  PWA 圖示
assets/art/atlas.png    概念圖拆出的精靈圖集（1024×2048，113 個精靈）
assets/art/atlas.json   圖集座標表
js/
  main.js               啟動流程與主迴圈（唯一入口）
  core/                 與遊戲無關的基礎：常數、狀態、事件匯流排、格子、效能統計
  data/                 純資料（不含邏輯）：建築、治療、病患、員工、研發、事件、成就、目標、費用…
  sim/                  模擬邏輯（無 DOM）：時間、經濟、病患、員工、建造、事件、存檔、職涯…
  render/               Canvas 繪製：等距投影、相機、輸入、場景與精靈、圖集
  ui/                   DOM 介面：側欄、頂部列、面板、彈窗、提示、封面、支持作者…
  ui/panels/            六大面板：建造、運作、診所、一覽、地圖、系統（+ 升級面板）
tools/                  自動化測試與平衡模擬（Playwright 與 Node 腳本）
docs/                   設計與契約文件、事件與成就清單（md / xlsx）
.github/workflows/      pages.yml：push 到指定分支即部署到 Pages，並寫入 version.json
```

---

## 3. 啟動流程（`js/main.js`）

1. `boot()` 取得 `#game` canvas，依序初始化：渲染器 → 相機 → 輸入 → 經濟 → 事件 → 研發 → 巡查 → 成就 → 職涯。
2. 註冊全域監聽（`mods:dirty`、`map:changed`、`week:end`、`month:start`、`state:loaded`、`speed:set`）。
3. 若有自動存檔就 `loadGame(state,'auto')`，否則 `seedStarterClinic(state)` 建立開局診所並補人員池。
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
| `money`、`points`、`reputation` | 資金、三種點數（醫術／儀器／服務）、聲譽（0–1000） |
| `lotLevel`、`lot`、`door` | 店面等級（0–3）、可建範圍、病患出入口 |
| `map.floor`、`map.occ`（快取，不存） | 地板格；佔用格由 `grid.rebuildOccupancy` 重建 |
| `objects[]` | 已放置的設備與家具 |
| `staff[]`、`hirePool[]` | 在職員工與可招募人選 |
| `patients[]`、`queue[]` | 病患實體（狀態機）與掛號排隊 |
| `policy` | 客群焦點（ortho／ltc／peds）、自費價格倍率、衛教看板 |
| `research` | `{done[], current, progress, levels{}}`（研發樹與持續精進） |
| `zones[]` | 專區（計算結果，由 `synergy.js` 產生） |
| `mods` | 修飾值彙總（由 `modifiers.js` 計算） |
| `nhi` | 健保點數：本週／本月累計、點值、結算紀錄、審查風險 |
| `ledger`、`history[]` | 本月收支、每月快照 |
| `stats` | 今日／本月／累計病患、治癒、滿意度 |
| `events` | 生效中的事件效果（buff）、紀錄、待決定兩難、冷卻 |
| `flags`、`achv`、`career` | 新手導覽、成就、職涯（目標、年度審查、結局） |
| `version` | 存檔版本（目前 `SAVE_VERSION = 3`） |

`createInitialState()` 產生新局；`defaultMods()` 定義所有修飾值的預設（加法型或乘數型，見 §8）。

---

## 6. 模組分層與相依規則

```
core ◀── data ◀── sim ◀── render
  ▲                 ▲        ▲
  └──────── ui ─────┴────────┘  （ui 讀 sim/data/render 的 API，寫 ui 與 bus）
```

- `core/`：`constants.js`（所有時間與尺寸常數，唯一定義處）、`state.js`、`bus.js`（同步事件匯流排）、`grid.js`（格子工具）、`perfstats.js`。
- `data/`：只有資料與少量純函式（例如 `fees.js`、`upgrades.js` 的成本公式）。**不得 import sim 或 ui**。
- `sim/`：遊戲規則。模組之間不直接互相 import 形成循環，跨模組通知一律用 `bus`。
- `render/`：`iso.js`（等距投影）、`camera.js`、`input.js`、`renderer.js`（主繪製）、`sprites.js`（程式繪製精靈）、`art.js`／`artdraw.js`（圖集精靈）、`concept_*.js`（概念圖風格的場景與物件）、`touchui.js`（畫布上的觸控建造列）。
- `ui/`：`ui.js`（總協調，`initUI`／`updateUI`）、`sidebar.js`、`topbar.js`、`selection.js`（選取卡）、`tooltip.js`、`modal.js`／`modals.js`（彈窗佇列）、`toast.js`、`speedbar.js`、`career.js`（職涯 UI）、`cover.js`、`installbox.js`、`support.js`、`moods.js`（病患與員工表情）、`roles.js`（人員資格小標）、`quality.js`／`perfhud.js`／`perfinfo.js`／`version.js`（效能與版本）。

---

## 7. 模擬核心

### 7.1 時間（`sim/calendar.js`）
`advanceClock(state, dtMin)` 推進時鐘；跨過 20:00 → 週結束（`week:end`），四週 → 月結算（`month:end` → `economy`），十二月 → 年度（`year:start`／`year:end`，觸發巡查與職涯審查）。

### 7.2 病患（`sim/patients.js`，最大的模組）
每位病患是一個狀態機，階段依序為：
`arriving → to_reception → registering → waiting → to_station → treating → waiting … → leaving`。

- **到達**：`arrivalsPerWeek ≈ (12 + reputation × 0.16) × mods.spawnMult × 焦點與類型權重`，受店面上限（`lots.js` 的 `maxPatientsPerWeek`、同時在場 `maxPatients`）限制。
- **病患類型**（`data/patients.js`）：晨間長輩團、肩頸上班族、運動傷害、早療兒童。各有偏好治療、耐性、自費意願、滑倒風險。
- **治療**：每個步驟佔用一個站點（設備）與所需員工；療程完成累積治癒（`cure`）、滿意度與研發點數。
- **健保與自費**：每次治療經 `economy.nhiClaim`（單一請款規則，同組只計最高點數）與自費定價結算。
- **離開**：完成療程、耐性耗盡（生氣）或等太久（睡著）都會離開，並寫入統計與成就計數。

### 7.3 員工（`sim/staff.js`、`sim/qualify.js`）
- 五種職類：醫師、物理治療師（PT）、職能治療師（OT）、語言治療師（ST）、櫃檯護理師。
- 每人有體力、士氣、特質（10 種）、薪資；休息室可恢復體力；離職事件與士氣會影響去留。
- **設施人員資格**（`qualify.js`）：每種治療指定可操作的職類（任一即可）。機器類（熱敷、紅外線、電療、牽引）只需開機時人員在場（5–8 分鐘），之後機器自行跑完；人工與房間類全程需要人員。沒有合格人員時該步驟**立即跳過**並扣滿意度，設施上顯示 ⚠ 標示。
- 走路與閒晃由 `sim/staff.js` 處理；行進路徑由 `sim/pathfinding.js` 的 A\*（四方向）提供，病患與員工都限制在診所範圍內（加上門口一格）。

### 7.4 建造與專區（`sim/build.js`、`sim/synergy.js`）
- `buildables.js` 定義 29 種可建造物（環境 8、設施 16、特殊 5），含尺寸、價格、研發前置、站點種類與基礎效果。
- `build.js`：放置驗證、拖曳繪製地板、拆除、開局診所（`seedStarterClinic`）。移動設備（M）保留既有設施與病患的指派。
- **專區**（`synergy.js` + `data/synergies.js`，共 15 個）：相鄰（格子距離 ≤ 1）的設備連通分量，若包含某專區要求的全部設備，即啟動該專區並加上修飾值（例如黃金三寶區、長者友善動線）。`recomputeZones` 在地圖改動後重算。

### 7.5 修飾值（`sim/modifiers.js`）
所有來源彙總到 `state.mods`，固定順序：
**專區 → 研發 → 天氣 → 事件與社區活動 → 衛教看板 → 客群焦點 → 環境（舒適度、地板防滑）**。
修飾值分兩類：乘數型（預設 1，如 `treatTime`、`wearRate`）與加法型（預設 0，如 `satGain`、`repGrowth`）；`typeSat`、`typeCure` 為每種病患一筆。每個修飾值都有上下限（`clamp`），避免多重疊加失衡。

### 7.6 研發與持續精進（`sim/research.js`、`data/research.js`、`data/upgrades.js`）
- 研發樹 26 個節點、3 條軌道；研發點由治療產生，以週為單位推進。
- 研發完成後進入**持續精進**（6 條線，醫術／儀器／服務各 2 條）：可無限次購買，每級有上限、價格隨等級成長，效果同樣經 `mods` 上下限約束。

### 7.7 經濟（`sim/economy.js`）
- **健保點數**：每個病患治療的點數累加到週、月；月底依上限稀釋點值（`pv = clamp(cap / monthPoints, 0.6, 0.95)`）。上限依店面等級（`lots.js`）。
- **病患權重**：每位模擬病患代表 `PATIENT_WEIGHT`（一般 15，L3 為 20）位真實病患，**只套用在病患產生的收入**，不套用在薪資、租金、建造、事件與巡查。
- **收支**：薪資（週期扣）、租金、維護費、建造費；`ledger` 逐筆記帳。
- **破產**：月底資金 < −300,000 → `game:over`。
- 所有真實數字（點值、各項給付、自費參考價）集中在 `data/fees.js`，模擬內不硬寫費用。

### 7.8 事件（`sim/events.js` + `data/events*.js`）
- 天氣（7 種，影響到店人數與設施狀況）、隨機事件（15）、擴充事件（58，`events_ext.js` 與 `events_ext2.js`）、社區活動（7）、衛教看板（7）、醫病溝通兩難（12，會**凍結模擬**並彈出決策視窗）。
- 事件效果（`Effects`）可包含金錢、聲譽、滿意度、健保審查風險、設備耗損與故障、員工士氣與離職、持續 buff（以 `mods` 加法改值）、旗標與連鎖事件。
- 設備耗損與故障、員工士氣與離職、健保審查風險、網路評價各自在 `equipment.js`、`staff.js`、`economy.js` 實作。

### 7.9 巡查（`sim/inspection.js`）
每年一次：衛生局督導與健保署抽查，依健保審查風險、設備狀況、評分計算結果；另含擴建店面（`lot:expanded`）。

### 7.10 成就（`sim/achievements.js`，`data/achievements.js`）
58 個成就（3 類、3 階），以計數器與事件監聽解鎖；每個成就有獎勵（聲譽、徽章等），`achievement:unlocked` 通知 UI。

### 7.11 職涯（`sim/career.js`，`data/goals.js`）
- 新手任務 10 項（onboarding）→ 每年 1 個核心目標 + 2 個加分目標（共 30 個加分、10 個核心）。
- 年度審查（評等 5 級）→ 10 年結局（9 種，含破產）→ 結局後可進入無盡模式。
- 指標（38 個 `GOAL_METRICS`）從 `state` 直接計算，不另外存副本。

### 7.12 存檔（`sim/save.js`）
- 三個手動槽位加一個自動存檔（`localStorage` 鍵 `ptgame.save.<slot>`）；每個月結束自動存檔。
- 存檔內容是 `state` 的 JSON（不含 `map.occ`），載入時逐欄位 **sanitize**（補預設值、夾住範圍），舊版存檔可讀取。
- 也支援匯出／匯入 JSON 字串與檔案。
- 存檔版本由 `SAVE_VERSION` 控制（目前 3）。

---

## 8. 渲染（`js/render/`）

- **座標系**：世界座標 = 像素（縮放 1 時）；`iso.js` 的 `gridToScreen` 把格子映到等距菱形（64×32）。螢幕座標 = 世界 × zoom + 相機偏移。
- **相機**（`camera.js`）：右鍵／中鍵拖曳平移、滾輪以游標為中心縮放（0.5–2.5）、觸控雙指。`ui.cam` 只存在 `ui`。
- **輸入**（`input.js`）：左鍵 = 工具（放置、繪地板、拆除、選取）；鍵盤快捷鍵（B/O/C/V/P/Y 切面板，R 旋轉，M 移動，1/2/3 速度，空白鍵暫停，G 格線，Esc 取消）。
- **繪製順序**：靜態層（地面、地板、牆、景物，快取）→ 依深度排序的物件與人（使用物件池，避免每幀配置）→ 疊加層（氣泡、進度條、專區光圈、天氣粒子、⚠ 標示）。
- **兩套美術**（可在系統設定切換，偏好存 `localStorage`）：
  - **新美術（概念圖）**：預設。精靈來自 `assets/art/atlas.png` 圖集（`art.js` 載入、`artdraw.js` 繪製人與部分設備），其餘由 `concept_objects.js`、`concept_scene.js` 依 `docs/ART_STYLE.md` 程式重繪。UI 樣式以 `html.style-concept` 限定。
  - **原像素風**：`sprites.js` 程式繪製的舊版精靈，保留為 classic，行為必須與改版前一致。
- **畫質**：自動／高／中／低。依裝置與幀率調整解析度上限、地面陰影與車輛粒子等。

---

## 9. 介面（`js/ui/`）

- **版型**：`layout.js` 判斷 desktop／compact／portrait，決定側欄、面板位置（桌機並排、手機為底部抽屜）與是否為手機版型（`layout.mobile`）。
- **頂部列**（`topbar.js`）：診所名稱、日期與時鐘、天氣；資金、三種點數、聲譽、健保點值。
- **側欄**（`sidebar.js`）：六個面板按鈕（建造 B、運作 O、診所 C、一覽 V、地圖 P、系統 Y）。
- **面板**（`ui/panels/`）：
  - **建造**：設施與地板的目錄，含研發前置、人員資格小標。
  - **運作**：目前的病患流程、自費定價、衛教看板、客群焦點、持續精進（升級）入口。
  - **診所**：目標（預設分頁，職涯）、員工清單與士氣、招募、設備維護表（維修、保養、缺人標示）。
  - **一覽**：營運數據、專區辭典（15 個專區，可在地圖上定位）、成就、事件紀錄。
  - **地圖**：熱度圖與格子資訊。
  - **系統**：存檔、匯出匯入、營運圖表、設定（美術、畫質、幀率上限、效能診斷、安裝與全螢幕）、支持作者（有網址時才出現）。
- **選取卡**（`selection.js`）：點選病患、員工或設備時顯示詳情與操作。
- **彈窗**（`modal.js` + `modals.js`）：統一的 backdrop／modal 結構與佇列（年度審查、結局、事件、兩難、巡查結果、新手導覽、操作說明等依優先序排隊）。彈窗開啟時自動暫停模擬，關閉後還原速度。
- **提示**：`toast.js`（短訊息）、`tooltip.js`（懸停說明）、`ctxmenu.js`（右鍵選單）。
- **封面**（`cover.js`）：開始／繼續、支持作者按鈕（有網址時）、安裝與全螢幕。封面期間模擬暫停；封面關閉後才顯示新手導覽。
- **支持作者**（`support.js` + `data/support.js`）：純外連，不處理金流；網址留空時相關入口全部隱藏。
- **安裝與全螢幕**（`installbox.js`，封面與設定共用）、**PWA**（`pwa.js`：Service Worker 註冊、安裝提示、全螢幕切換）。
- **版本**（`version.js`）：讀取部署時寫入的 `version.json`，有新版時提示重新整理。

### 事件匯流排

`core/bus.js` 是同步的發布／訂閱（`bus.on(evt, fn)` 回傳取消函式，`bus.emit(evt, payload)`）。主要事件：

| 類別 | 事件（部分） |
|---|---|
| 時間 | `week:start`、`week:end`、`month:start`、`month:end`、`year:start`、`year:end`、`speed:set` |
| 經濟 | `nhi:settled`、`treatment:done`、`game:over` |
| 病患與員工 | `patient:spawn`、`patient:left`、`patient:slip`、`patient:chat`、`staff:changed`、`staff:resigned` |
| 建造與地圖 | `map:changed`、`mods:dirty`、`object:move`、`object:moved`、`object:context`、`lot:expanded` |
| 事件與兩難 | `event:show`、`dilemma:request`、`dilemma:show`、`dilemma:resolved`、`community:started`、`equipment:broken`、`equipment:fixed` |
| 研發與巡查 | `research:done`、`research:upgrade`、`inspection:result` |
| 職涯與成就 | `career:*`（onboarding、goal-done、year-review、ending、ui-data）、`achievement:unlocked`、`achv:changed` |
| 介面 | `toast`、`select:changed`、`tool:changed`、`layout:changed`、`ui:escape`、`ui:bmode`、`quality:changed`、`perfhud:changed`、`pwa:changed`、`cover:closed`、`art:changed`、`version:loaded`、`version:update` |
| 存檔 | `state:loaded` |

> 規則：`sim/` 發出的事件只帶資料，不帶 DOM；`ui/` 監聽並決定怎麼呈現。

---

## 10. 資料層（`js/data/`）

| 檔案 | 內容 |
|---|---|
| `constants`（在 core） | 時間、地圖尺寸、點數鍵與標籤、職類、存檔版本 |
| `buildables.js` | 29 種可建造物與分類 |
| `treatments.js` | 17 種治療（健保 11、自費 6）：時長、所需職類、點數、站點、設備 |
| `patients.js` | 4 種病患與 3 種焦點 |
| `staffdefs.js` | 職類、特質（10）、人名 |
| `research.js` | 研發樹 26 節點、3 軌道 |
| `upgrades.js` | 持續精進 6 條線與成本公式 |
| `synergies.js` | 專區 15 個與分組、解鎖提示 |
| `lots.js` | 店面 4 級：尺寸、租金、上限、同時在場人數、巡查規則 |
| `fees.js` | 健保點數、費用區間、自費參考價（含可信度標記） |
| `events.js` / `events_ext.js` / `events_ext2.js` | 天氣、隨機事件、擴充事件（73）、社區、看板、兩難 |
| `achievements.js` | 58 個成就 |
| `goals.js` | 新手任務、核心與加分目標、指標、結局、審查文字 |
| `texts.js` | 導覽、提示、說明文字 |
| `support.js` | 支持作者頁面設定（網址留空即隱藏） |

資料檔一律具名匯出（named exports），不使用 default export。

---

## 11. 平衡與數值

- 所有平衡目標寫在 `docs/ARCHITECTURE.md` §2 與 `docs/GOALS_AND_ENDING.md`，並由 `tools/` 的平衡模擬驗證：開局第一個月約損益兩平、好的佈局有正毛利、壞的佈局為負、專家路線年度後期月淨利 30–50 萬、L2／L3 的收入區間。
- 主要旋鈕：`PATIENT_WEIGHT`、`patients.js` 的到達常數與 `TUNE`、`staff.TUNE`（移動與速度）、`treatments.js` 的時長與 `uptake`、`fees.js`。
- 修飾值的上下限在 `modifiers.js` 集中定義，避免多重疊加超出可玩範圍。

---

## 12. 測試與驗證（`tools/`）

所有測試都是 Node + Playwright（Chromium）腳本，各自啟動 `python3 -m http.server <port>`，不互相依賴。

| 工具 | 用途 |
|---|---|
| `audit.mjs`（`--quick` / 完整 / `--only <區段>`） | 純邏輯稽核：經濟、事件、設施資格、升級、專區、職涯、存檔等（約 1,500 項） |
| `smoke.mjs`、`play.mjs`、`uitest.mjs` | 冒煙、完整遊玩流程、介面互動 |
| `mobileui.mjs`（`ONLY=390x844` 等） | 手機版型：無橫向溢出、觸控目標大小、字級 |
| `touchtest.mjs`、`stylecss.mjs` | 觸控建造、樣式與覆寫檢查 |
| `arttest.mjs`、`artui.mjs` | 兩套美術的渲染與介面 |
| `perftest.mjs` | 效能診斷、畫質、幀率上限、版本提示 |
| `careerui.mjs`、`zonesui.mjs`、`qualifyui.mjs`、`upgradesui.mjs`、`coverui.mjs` | 各功能的介面測試 |
| `bal_events.mjs`、`stress.mjs` | 事件平衡與壓力測試 |
| `build_atlas.py`、`genicons.mjs` | 產生圖集與圖示 |

自動化測試環境會被偵測為 `navigator.webdriver`，因此預設不顯示封面（`?cover=1` 可強制顯示）。

---

## 13. 部署與版本

- **分支**：開發分支 `claude/rehab-clinic-game`；push 即觸發 `pages.yml`。
- **部署內容**：`index.html`、`manifest.webmanifest`、`sw.js`、`css/`、`js/`、`icons/`、圖集（`assets/art/atlas.*`），另寫入 `version.json`（commit SHA 與建置時間）。
- **Service Worker**：快取殼層（`SHELL` 清單）；`version.json` 採 network-first，讓應用內的「有新版本」提示在線上時準確。內容更新不需要改快取名稱；只有快取策略本身改變時才提升 `CACHE` 版本。
- **版本號**：遊戲內「系統 → 設定」顯示建置版本；本機開發顯示 `dev`。

---

## 14. 擴充指南（給接手者）

- **新增建造物**：在 `data/buildables.js` 加定義；若需要治療站，在 `data/treatments.js` 設定 `stationFor` 與所需職類（`staffRole`）；若屬於專區，在 `data/synergies.js` 加入需求。繪製由 `concept_objects.js` 處理（無圖集精靈時）。
- **新增治療**：`data/treatments.js` 加項目，並在 `sim/qualify.js` 確認職類規則；若有費用，改 `data/fees.js`，不要在模擬中寫死數字。
- **新增事件**：`data/events_ext*.js` 加一筆，遵守 `docs/EVENTS_EXT.md` 的格式；`tools/audit.mjs --only events` 會強制觸發每個事件的每個選項。
- **新增修飾值**：在 `defaultMods()` 加預設、在 `modifiers.js` 加上下限、在 `efftext.js` 加中文標籤。
- **新增成就或目標**：分別在 `data/achievements.js`、`data/goals.js` 定義；計數或指標在 `sim/achievements.js`、`sim/career.js` 計算，不要在 UI 重算。
- **存檔欄位變更**：增加欄位時，在 `save.js` 的 sanitize 補上預設值；欄位語意改變時提升 `SAVE_VERSION`。
- **不要做的事**：`sim/` 內不碰 DOM 與 canvas；`data/` 不 import `sim/` 或 `ui/`；不在 `state` 放函式或 class 實例；不用循環 import，跨模組通知用 `bus`。

---

## 15. 已知限制與待辦

- **費用數字**：部分數值（PT 較高階、OT／ST、徒手、貼紮、懸吊、鞋墊）可信度較低，待對照健保署支付標準。
- **平衡**：被動（不保養）的診所十年內會衰退甚至破產；兒童病患治癒率偏低。
- **「3 項以上中等項目 → 中複雜 330 點」規則**尚未實作。
- **手機**：Android 上的雙指縮放與 DPR 3 的 2.5 倍縮放尚未實機測試。
- **平衡與數值**：以模擬與測試驗證，尚未經過真人大量遊玩。
