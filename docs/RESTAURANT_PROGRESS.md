# 餐廳物語 — 移植進度（RESTAURANT_PROGRESS）

分支 `claude/restaurant-game`。設計對照見 `docs/RESTAURANT_DESIGN.md`。**接手者請先讀這份，再讀設計對照。**
診所版仍在 `claude/rehab-clinic-game`，不要動它。本分支沒有加入 `pages.yml` 的自動部署清單（避免覆蓋診所版的 Pages）；要上線請手動 `workflow_dispatch`，或把本分支加進 `on.push.branches`。

## 已完成
- 資料層：`buildables`（32）、`treatments`（17 道）、`patients`（4 類客人＋3 種方針）、`staffdefs`（5 職類）、`lots`、`research`（27 節點）、`synergies`（15 專區）、`upgrades`、`events*`（73 事件、7 社區、12 兩難、7 看板）、`achievements`、`goals`、`texts`、`fees`（改成菜單價與食材成本率）。
- 模擬：`economy.js` 改寫（上菜即收現金＋食材成本、食安風險、毛利）、`patients.js`（kind menu/special、intake、freebie/skip_main/overpush 兩難）、`staff/qualify/equipment/inspection/build/career/achievements/events/save/efftext/modifiers` 對應修改。起始店 `seedStarterShop`。
- 介面：頂部列（食安取代點值）、月結報表、運作／餐廳／一覽／選取卡文字與經濟、封面與說明、`restgame.*` 儲存鍵。
- 美術：移除診所概念圖集（atlas）；物件／人物／餐點圖示改用台灣小吃概念圖集裁切的圖片（`docs/RESTAURANT_SPRITES.md`，`js/render/rest_sprites.js`），無對應或載入失敗時退回程式繪製。`art.js` 的 `ATLAS_AVAILABLE=false`（舊診所圖集）。
- 工具：`tools/bal.mjs`（無瀏覽器平衡模擬）。

## 平衡（目前）
- 調整方式：只動 `lots.js` 各店面的 `patientWeight`（一個模擬客人代表幾位真實客人）：L0 28（`economy.PATIENT_WEIGHT`，不變）、L1 40、L2 50、L3 76。**起始店與 good 路線完全不受影響**，加成只出現在擴店之後，所以 idle 仍會破產、starter 仍存活。
- 結果（`tools/bal.mjs`，seed 1–5）：starter 月淨利約 +40～+80k（毛利率 ~66%）；expert 48 個月，Y4 末月淨利約 +300～+465k，Y4 後 6 個月均值約 +240～+410k（毛利率 ~66%，單月仍有活動／維修造成的波動）；Y2 仍約 +90k（還在 L0–L2）。符合診所版「年末月淨利 30–50 萬」。
- idle：3 年模擬在第 3 年 M9 破產（`audit.mjs --years 3 --policies idle`）；`--quick` 的 2 年長跑結果受亂數影響，不一定在 2 年內破產，斷言只檢查不崩潰。
- 目標／成就門檻改成餐廳規模：`netMonthlyAvgYear` 依店面 4／10／20／35 萬；`patientsYear`（模擬客人數）1,200／1,600／2,300／3,000；`curedYear` 30／40／50／65（熟客率低，expert 約 45 人／年）；結局條件長輩熟客 ≥ 60、家庭熟客 ≥ 80；成就 `m_pat_*`（id 不變）改為 300／2,000／8,000 人次。
- audit 斷言更新：權重斷言 L3 38→76；`m_pat_5000` 測試的 `patientsTotal` 6000→9000（門檻改 8,000）。
- L0 每日來客上限 40、L1 70、L2 110、L3 150。
- `tools/bal.mjs` 結尾多印累計熟客數與來客數。

## 整合狀態（2026-10-30）
五個子分支已全部併入 `claude/restaurant-game`：`restaurant-docs`（文件）、`restaurant-art`（美術精修＋暖色主題）、`restaurant-balance`（平衡）、`restaurant-uitests`（UI 測試工具）、`restaurant-sprites`（圖集素材）。

- **UI 測試工具**：`qualifyui`、`upgradesui`、`zonesui`、`mobileui`、`perftest`、`play`、`stylecss`、`stress`（含 `stress-page.js`）已改成餐廳版斷言。起始店自動啟動「黃金爐火區」（golden3），所以 zonesui 基準是「已啟動 1 / 共 15」。內部 id 沿用診所版（專區 `sportsRehab`、升級 `up_clinical`、mods `nhiTurnover` 等），測試依 id 斷言、依顯示文字驗證。
- **美術**：電視牆改菜單看板、收銀螢幕改點餐單、店招去十字改麵碗、服務生加托盤；介面全改紅/木色。物件、人物、餐點圖示優先使用圖集裁切圖（101 張，`assets/rest/`，`tools/cut_restaurant_sheet.py` 可重現），無對應時退回程式繪製。
- **文件狀態**：`GAME_ARCHITECTURE.md`、`ARCHITECTURE.md` 已改寫為餐廳版；`EVENTS_EXT`、`ACHIEVEMENTS`、`GOALS_AND_ENDING`、`ART_STYLE` 已加註修正；`EVENT_RESEARCH`、`FEE_RESEARCH`、`ASSETS_LIST`、`events_and_achievements.md` 標為診所遺留；`fee_data.json`、`*.xlsx` 已刪除（可從診所分支取回）。

## 待辦（之後可做）
1. 內部 id 仍沿用診所命名（不影響玩家，重新命名需要存檔遷移）。
2. 圖集只有一張概念圖，部分設備（鐵板、燒烤、火鍋桌等）仍為程式繪製；有新素材可再用 `tools/cut_restaurant_sheet.py` 補裁。
3. 部署：本分支未加入 `pages.yml` 自動部署。
