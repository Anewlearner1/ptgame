# 餐廳物語 — 移植進度（RESTAURANT_PROGRESS）

分支 `claude/restaurant-game`。設計對照見 `docs/RESTAURANT_DESIGN.md`。**接手者請先讀這份，再讀設計對照。**
診所版仍在 `claude/rehab-clinic-game`，不要動它。本分支沒有加入 `pages.yml` 的自動部署清單（避免覆蓋診所版的 Pages）；要上線請手動 `workflow_dispatch`，或把本分支加進 `on.push.branches`。

## 已完成
- 資料層：`buildables`（32）、`treatments`（17 道）、`patients`（4 類客人＋3 種方針）、`staffdefs`（5 職類）、`lots`、`research`（27 節點）、`synergies`（15 專區）、`upgrades`、`events*`（73 事件、7 社區、12 兩難、7 看板）、`achievements`、`goals`、`texts`、`fees`（改成菜單價與食材成本率）。
- 模擬：`economy.js` 改寫（上菜即收現金＋食材成本、食安風險、毛利）、`patients.js`（kind menu/special、intake、freebie/skip_main/overpush 兩難）、`staff/qualify/equipment/inspection/build/career/achievements/events/save/efftext/modifiers` 對應修改。起始店 `seedStarterShop`。
- 介面：頂部列（食安取代點值）、月結報表、運作／餐廳／一覽／選取卡文字與經濟、封面與說明、`restgame.*` 儲存鍵。
- 美術：移除診所概念圖集（atlas），一律程式繪製；`art.js` 的 `ATLAS_AVAILABLE=false`。
- 工具：`tools/bal.mjs`（無瀏覽器平衡模擬）。

## 平衡（目前，PATIENT_WEIGHT=28，L3=38）
- 起始店（4 位員工）月淨利約 ±0～+70k（毛利率 ~67%）；專家路線 Y2 月營運淨利約 +80～+140k（含特色料理占 ~30%）。尚未調整到診所版的「年末月淨利 30–50 萬」目標，需要再跑 `tools/bal.mjs policy=expert months=48`。
- L0 每日來客上限 40、L1 70、L2 110、L3 150。

## 待辦（依優先序）
1. **繪圖**：`js/render/concept_objects.js`（DRAW 表）與 `sprites.js` 還沒有餐廳設備的專屬圖，目前用預設方塊＋emoji；人物 `sprites.js` 的 `PERSON_KINDS` 仍是 doctor/pt/…；`FLOORS.floor_mat` 要改成 `floor_tile`。
2. **測試**：`tools/*.mjs`（audit/smoke/uitest/mobileui/zonelayouts…）仍寫診所 id，要逐一改成餐廳版；`tools/audit.mjs --quick` 要全過。
3. **文件**：`docs/GAME_ARCHITECTURE.md`、`docs/ARCHITECTURE.md` 等仍是診所版敘述；README、manifest 說明、圖示（`icons/`）。
4. 平衡微調、事件金額、成就門檻、目標門檻（`goals.js` 的金額與人次門檻是診所版數字）。
5. 手機版面（`mobileui.mjs`）與封面再檢查一次。
