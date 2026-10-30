> ⚠️ **本檔原為診所版規格，已就餐廳版修正過時處。** 引擎行為與欄位以 `js/sim/events.js`、`js/sim/equipment.js`、`js/sim/staff.js`、`js/sim/economy.js` 與 `js/data/events_ext*.js` 為準；下文的「來源 `docs/EVENT_RESEARCH.md`」是診所版調查（已標註不適用），餐廳版事件文案由 `RESTAURANT_DESIGN.md` 的對照改寫而來。

# 擴充事件系統規格（EVENTS_EXT）

來源：診所版 `docs/EVENT_RESEARCH.md`（58 個候選事件、M1–M10 機制；餐廳版沿用機制、重寫內容）。本文件是**資料與引擎共同遵守的契約**。
注意：法規與數字僅作遊戲靈感，不代表現行規定；遊戲內文案一律中性、不影射真實機構。

## 1. 資料格式（`js/data/events_ext.js` 與 `js/data/events_ext2.js`，具名匯出）

```js
export const EVENTS_EXT_A = [ /* 30 個：食安與營運 A01–A14、客人與溝通 B01–B16 */ ];
export const EVENTS_EXT_B = [ /* 28 個：營運 C01–C16、季節與在地 D01–D12 */ ];   // 分別在兩個檔案
// 事件
{ id, cat: 'safety'|'patient'|'ops'|'season', title, text,    // safety＝食安（舊 nhi）；patient＝客人與溝通
  weight,                  // 抽選權重，預設 6（季節事件 10，大事件 3）
  cooldownWeeks,           // 同一事件再出現的最短週數，預設 24
  big: boolean,            // 大事件（稽查處分／糾紛），每月最多一個
  cond: { ... },           // §2，全部條件 AND；缺省 = 無限制
  choices: [ Choice, Choice, (Choice) ] }
// 選項
Choice = { label, result,                       // result = 選後顯示的一兩句話
           effects?: Effects,                   // 與 chance 二擇一
           chance?: { p: 0..1, win: { effects, result }, lose: { effects, result } },
           requires?: { money?: number } }      // 錢不夠時選項反灰
```

### Effects（既有欄位＋新欄位，全部可選）
| 欄位 | 意義 |
|---|---|
| `money`、`reputation`、`sat`（客人滿意度）、`points:{culinary,device,service}` | 既有（診所版的 `nhiPenalty` 已移除，改用 `risk`） |
| `buff: { weeks, label, mods?:{key:delta}, spawn?:{typeId:delta} }` | M5/M6：持續 N 週。`mods` 為 defaultMods 鍵的加法增量（`spawnMult:+0.15`、`elderSat:+2`、`patience:+0.1`、`slipRisk:+0.3`…）；`spawn` 為 typeSpawn 加法（`elder:+0.3` → ×1.3）。週結束倒數，到期還原 |
| `setFlag: 'name'`、`clearFlag: 'name'` | M10 旗標（存 `state.events.flags`） |
| `followUp: { id, afterWeeks, p? }` | M10 連鎖：N 週後（機率 p，預設 1）強制排入該事件 |
| `risk: delta` | M3 **食安風險**（0..100，`state.safety.risk`），每週自然 −1；> 60 時 `safety` 類事件權重 ×2，> 20 時年度衛生局稽查的食安項目扣分 |
| `wear: { target: 'all'\|'random'\|defId, delta }` | M2 設備耗損（obj.wear 0..100） |
| `breakdown: 'random'\|defId` | M2 讓一台設備立即故障（obj.broken = true，停用直到修復） |
| `repair: 'all'\|'broken'` | M2 立即維修／保養（wear→0，broken→false） |
| `stamina: { role?, delta }` | 員工體力 ±（role 省略 = 全員） |
| `morale: { role?, delta }` | M4 員工士氣 ±（0..100，預設 70） |
| `resign: { role, p }` | M4 該職類有 p 機率一人離職（至少保留 1 人時才會，否則改為士氣 −15） |
| `reviewScore: delta` | M7 網路評價（1.0..5.0，`state.reviewScore`，預設 4.0）；每 0.1 影響新客率 ±1% |
| `maintenance: weeks` | M2 簽保養合約：N 週內設備耗損速度減半 |

## 2. 條件 `cond`（M1）
`months:[1..12]`、`weather:['cold'|'rain'|'typhoon'|'hot'|…]`（比對 `state.weather.kind`，梅雨用 `weatherId:'plumrain'`）、`minYear`、`maxYear`、`minRep`、`maxRep`、`minLot`（lotLevel）、`hasObject:[defId,…]`（任一）、`needObjects:[defId,…]`（全部）、`hasStaff:{role:n}`、`policy:'business'|'community'|'kids'`（經營方針）、`riskAtLeast:n`／`riskAtMost:n`（食安風險）、`wearAtLeast:{defId?,n}`、`moraleBelow:n`、`reviewBelow:n`、`minPatientsTotal:n`（診所版的 `pvBelow` 點值條件已移除）、`flag:'x'`、`notFlag:'x'`、`riskAtLeast:n`、`riskAtMost:n`、`wearAtLeast:{defId?:string,n:number}`（任一設備/指定設備耗損 ≥ n）、`moraleBelow:n`（任一員工士氣 < n）、`reviewBelow:n`、`monthPointsOverCapPct:n`（本月健保點數超過上限的百分比，如 90）、`minPatientsTotal`。

## 3. 引擎規則（`js/sim/events.js`）
- 抽選池 = 既有 `RANDOM_EVENTS` ∪ `EVENTS_EXT_A` ∪ `EVENTS_EXT_B`，先過濾 `cond`；季節（`cat:'season'`）權重 ×1.5。
- 沿用既有節奏常數（`EVENT_CHANCE_PER_WEEK`、全域間隔、寬限期）；同月最多一個 `big`；同一事件受 `cooldownWeeks`；`followUp` 排程優先於隨機抽選且不受全域間隔限制（但同週最多一個事件）。
- `chance` 選項擲骰後只顯示結果那一邊。
- 決策彈窗、凍結模擬、存檔後恢復等既有行為不變。新欄位全部存進 `state.events`（`flags`、`pendingFollowUps`、`buffs`）、`state.safety.risk`、`state.reviewScore`、`obj.wear/broken/maintainedUntil`、`staff.morale`，並由 `save.js` 的 sanitize 補預設。

## 4. 設備耗損與故障（M2）
- 每個設備物件有 `wear`（0..100）。每上一道菜使用 +0.4（慢煮／冷藏類 +0.2），每週基礎 +0.3；保養合約期間耗損速度 ×0.5。≥ 70 顯示「老舊」，≥ 90 每週有 25% 機率自動故障（`broken`），出現故障事件（C01–C05）。
- `broken` 設備不能被客人使用（patients.js 排除；若用到一半，該步驟中止、客人繼續等待或換站）；設備維護表（餐廳面板）有「維修」與「保養」按鈕，費用為建造價的固定比例（`equipment.repairCost`／`serviceCost`，另有 13／26／52 週的保養合約 `contractCost`）；也可由事件選項修復。
- 受影響種類（`equipment.WEAR_DEFS`）：油炸鍋 `fryer`、煮麵台 `noodle_stove`、滷肉鍋 `braise_pot`、煎檯 `griddle`、鐵板檯 `teppan`、主廚爐台 `chef_range`、飲料吧 `drink_bar`、冰品檯 `ice_shop`、湯鍋 `soup_pot`、主廚餐檯 `chef_table`、熱炒爐 `wok_range`、炭火爐 `bbq_grill`；湯鍋、滷肉鍋、冰品檯為慢煮／冷藏類，每次使用只加一半耗損。

## 5. 員工士氣與離職（M4）
- `staff.morale` 0..100。每週：基礎回復 +1；過勞（體力 < 30% 的週數）−3；超時/事件加減；有休息室 +1；達成薪資調整事件 +。
- `morale < 25` 且職類為主廚／廚師／吧台師／外場服務生：每週 8% 機率觸發離職事件（`cook_resign`）。離職＝該員工被移除並提示；招聘池補人。該職類只剩一人時改為士氣 −15。
- 餐廳面板的員工清單顯示士氣條。

## 6. 食安風險（M3）與網路評價（M7）
- `state.safety.risk`：每月結算時依「設備平均耗損、疲勞員工比例、滿意度偏低、無員工休息室」+ 事件調整（`economy.RISK_TUNE`，單月上限 +15）；> 60 時 `cat:'safety'` 事件權重 ×2；年度衛生局稽查的食安項目扣分。
- `state.reviewScore`：初始 4.0；每月依平均滿意度（>70 ↑ 0.05、<45 ↓ 0.1）與事件調整；影響 `arrivalsPerWeek` ×(1 + (score−4)×0.1)。顯示在餐廳面板與頂部食安提示（不另開新面板）。

## 7. 事件數量與分工
目標 58 個事件全部上線；不需新機制的 16 個、M1 即可的 10 個、M5/M10 的 8 個、M3/M2/M4 等其餘依本規格實作。每個事件必須在 headless 測試中被強制觸發、四種情境（各選項、`chance` 的 win/lose）都能套用且不拋錯。

## 8. 實作狀態（已上線）
- 事件池 = 既有 15 隨機事件 + EXT_A 30 + EXT_B 28（共 73）；另有 12 個客人溝通兩難（`freebie`／`skip_main`／`overpush`／`complain`，另走 dilemma 流程）、7 個社區活動、7 個菜單看板。引擎在 `js/sim/events.js`，設備耗損在 `js/sim/equipment.js`，士氣/離職在 `js/sim/staff.js`，食安風險／網路評價在 `js/sim/economy.js`。
- 與本規格的差異：`wear <= -100` 同時清除 `broken`；全店 `sat` 另轉成 1 週 `satShift` buff；員工體力打擊延到下一個營業日（`staminaCarry`）；`chance` 在決策視窗開啟時預擲（存檔重載不會重擲）。
- 測試：`node tools/audit.mjs --only events`（強制觸發 73 事件 × 全部選項 × win/lose）；平衡：`tools/bal_events.mjs`。
