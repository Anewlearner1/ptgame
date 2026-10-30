# 餐廳物語 — 移植進度（RESTAURANT_PROGRESS）

分支 `claude/restaurant-game`。設計對照見 `docs/RESTAURANT_DESIGN.md`。**接手者請先讀這份，再讀設計對照。**
診所版仍在 `claude/rehab-clinic-game`，不要動它。本分支沒有加入 `pages.yml` 的自動部署清單（避免覆蓋診所版的 Pages）；要上線請手動 `workflow_dispatch`，或把本分支加進 `on.push.branches`。

## 已完成
- 資料層：`buildables`（32）、`treatments`（17 道）、`patients`（4 類客人＋3 種方針）、`staffdefs`（5 職類）、`lots`、`research`（27 節點）、`synergies`（15 專區）、`upgrades`、`events*`（73 事件、7 社區、12 兩難、7 看板）、`achievements`、`goals`、`texts`、`fees`（改成菜單價與食材成本率）。
- 模擬：`economy.js` 改寫（上菜即收現金＋食材成本、食安風險、毛利）、`patients.js`（kind menu/special、intake、freebie/skip_main/overpush 兩難）、`staff/qualify/equipment/inspection/build/career/achievements/events/save/efftext/modifiers` 對應修改。起始店 `seedStarterShop`。
- 介面：頂部列（食安取代點值）、月結報表、運作／餐廳／一覽／選取卡文字與經濟、封面與說明、`restgame.*` 儲存鍵。
- 美術：移除診所概念圖集（atlas），一律程式繪製；`art.js` 的 `ATLAS_AVAILABLE=false`。
- 工具：`tools/bal.mjs`（無瀏覽器平衡模擬）。

## 平衡（目前）
- 調整方式：只動 `lots.js` 各店面的 `patientWeight`（一個模擬客人代表幾位真實客人）：L0 28（`economy.PATIENT_WEIGHT`，不變）、L1 40、L2 50、L3 76。**起始店與 good 路線完全不受影響**，加成只出現在擴店之後，所以 idle 仍會破產、starter 仍存活。
- 結果（`tools/bal.mjs`，seed 1–5）：starter 月淨利約 +40～+80k（毛利率 ~66%）；expert 48 個月，Y4 末月淨利約 +300～+465k，Y4 後 6 個月均值約 +240～+410k（毛利率 ~66%，單月仍有活動／維修造成的波動）；Y2 仍約 +90k（還在 L0–L2）。符合診所版「年末月淨利 30–50 萬」。
- idle：3 年模擬在第 3 年 M9 破產（`audit.mjs --years 3 --policies idle`）；`--quick` 的 2 年長跑結果受亂數影響，不一定在 2 年內破產，斷言只檢查不崩潰。
- 目標／成就門檻改成餐廳規模：`netMonthlyAvgYear` 依店面 4／10／20／35 萬；`patientsYear`（模擬客人數）1,200／1,600／2,300／3,000；`curedYear` 30／40／50／65（熟客率低，expert 約 45 人／年）；結局條件長輩熟客 ≥ 60、家庭熟客 ≥ 80；成就 `m_pat_*`（id 不變）改為 300／2,000／8,000 人次。
- audit 斷言更新：權重斷言 L3 38→76；`m_pat_5000` 測試的 `patientsTotal` 6000→9000（門檻改 8,000）。
- L0 每日來客上限 40、L1 70、L2 110、L3 150。
- `tools/bal.mjs` 結尾多印累計熟客數與來客數。

## 待辦（依優先序）
1. ~~UI 測試工具~~（已完成）：`qualifyui`、`upgradesui`、`zonesui`、`mobileui`、`perftest`、`play`、`stylecss`、`stress`（load／chaos，含 `stress-page.js`）已改成餐廳版斷言並全綠；`audit.mjs --quick`（1720 項）仍全過。
   - 起始店會自動啟動「黃金爐火區」（golden3），所以 zonesui 的基準是「已啟動 1 / 共 15」；`zonelayouts.mjs` 的 L0 combo 不含「宵夜熱炒廊」（flagship），故 combo 狀態為 14 / 15。
   - 順手修的遊戲問題：觸控版面專區辭典的篩選 chip 高度 28px（`.touch .u-fchip` 補 min-height 40px）；概念風格的任務 ✔ 綠底對比不足 AA（`#3aa56a` → `#2a7f50`）。
   - 內部 id 沿用診所版（如專區 `sportsRehab`、升級 `up_clinical`、mods `nhiTurnover`），測試依 id 斷言、依顯示文字（餐廳版）驗證。
2. **文件**：`docs/GAME_ARCHITECTURE.md`、`docs/ARCHITECTURE.md`、`README.md` 仍是診所版敘述；診所專用文件（EVENT_RESEARCH、FEE_RESEARCH、ASSETS_LIST…）需加註或刪除。
3. 平衡：已完成；後續可再檢視 Y2 前後（L1/L2）的曲線與 `goals.js` 其餘獎勵金額。
4. 美術：物件用程式繪製（無圖集），可再精修；手機版面再檢查。

已完成：圖示改為麵碗、manifest/theme 色改暖紅、移除多餘的 `undefined/` 目錄。
