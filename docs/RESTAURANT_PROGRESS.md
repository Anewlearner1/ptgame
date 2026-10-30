# 餐廳物語 — 移植進度（RESTAURANT_PROGRESS）

分支 `claude/restaurant-game`。設計對照見 `docs/RESTAURANT_DESIGN.md`。**接手者請先讀這份，再讀設計對照。**
診所版仍在 `claude/rehab-clinic-game`，不要動它。本分支沒有加入 `pages.yml` 的自動部署清單（避免覆蓋診所版的 Pages）；要上線請手動 `workflow_dispatch`，或把本分支加進 `on.push.branches`。

## 已完成
- 資料層：`buildables`（32）、`treatments`（17 道）、`patients`（4 類客人＋3 種方針）、`staffdefs`（5 職類）、`lots`、`research`（27 節點）、`synergies`（15 專區）、`upgrades`、`events*`（73 事件、7 社區、12 兩難、7 看板）、`achievements`、`goals`、`texts`、`fees`（改成菜單價與食材成本率）。
- 模擬：`economy.js` 改寫（上菜即收現金＋食材成本、食安風險、毛利）、`patients.js`（kind menu/special、intake、freebie/skip_main/overpush 兩難）、`staff/qualify/equipment/inspection/build/career/achievements/events/save/efftext/modifiers` 對應修改。起始店 `seedStarterShop`。
- 介面：頂部列（食安取代點值）、月結報表、運作／餐廳／一覽／選取卡文字與經濟、封面與說明、`restgame.*` 儲存鍵。
- 美術：移除診所概念圖集（atlas）；物件／人物／餐點圖示改用台灣小吃概念圖集裁切的圖片（`docs/RESTAURANT_SPRITES.md`，`js/render/rest_sprites.js`），無對應或載入失敗時退回程式繪製。`art.js` 的 `ATLAS_AVAILABLE=false`（舊診所圖集）。
- 工具：`tools/bal.mjs`（無瀏覽器平衡模擬）。

## 平衡（目前，PATIENT_WEIGHT=28，L3=38）
- 起始店（4 位員工）月淨利約 ±0～+70k（毛利率 ~67%）；專家路線 Y2 月營運淨利約 +80～+140k（含特色料理占 ~30%）。尚未調整到診所版的「年末月淨利 30–50 萬」目標，需要再跑 `tools/bal.mjs policy=expert months=48`。
- L0 每日來客上限 40、L1 70、L2 110、L3 150。

## 待辦（依優先序）
1. **UI 測試工具**：`tools/qualifyui.mjs`（卡片文字仍斷言「物理治療師／醫師」、`bed` 等診所 id）、`upgradesui.mjs`（診所升級名稱與「醫術點數」）、`zonesui.mjs`（專區數量／標籤）仍有過時斷言；`mobileui/perftest/play/stylecss/stress-page` 已改但未逐一重跑。`audit.mjs --quick`（1720 項）、`smoke`、`uitest`、`coverui` 為綠。
2. **文件**：`docs/GAME_ARCHITECTURE.md`、`docs/ARCHITECTURE.md`、`README.md` 仍是診所版敘述；診所專用文件（EVENT_RESEARCH、FEE_RESEARCH、ASSETS_LIST…）需加註或刪除。
3. 平衡微調：專家路線仍低於診所版目標；`goals.js` 的金額與人次門檻是診所版數字。
4. 美術：物件用程式繪製（無圖集），可再精修；手機版面再檢查。

已完成：圖示改為麵碗、manifest/theme 色改暖紅、移除多餘的 `undefined/` 目錄。
