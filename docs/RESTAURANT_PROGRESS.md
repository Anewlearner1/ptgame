# 餐廳物語 — 移植進度（RESTAURANT_PROGRESS）

程式分支 `claude/restaurant-game`；文件整理在 `claude/restaurant-docs`（只改文件，未動 `js/`）。設計對照見 `docs/RESTAURANT_DESIGN.md`，架構總覽見 `docs/GAME_ARCHITECTURE.md`，契約見 `docs/ARCHITECTURE.md`。**接手者請先讀這份，再讀設計對照。**
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
1. **UI 測試工具**：`tools/qualifyui.mjs`（卡片文字仍斷言「物理治療師／醫師」、`bed` 等診所 id）、`upgradesui.mjs`（診所升級名稱與「醫術點數」）、`zonesui.mjs`（專區數量／標籤）仍有過時斷言；`mobileui/perftest/play/stylecss/stress-page` 已改但未逐一重跑。`audit.mjs --quick`（1720 項）、`smoke`、`uitest`、`coverui` 為綠。
2. **文件**：`README.md` 仍有部分診所版敘述（操作表中的「病患」等），待更新。其餘文件已整理，見下方「文件狀態」。
3. 平衡微調：專家路線仍低於診所版目標；`goals.js` 的金額與人次門檻是診所版數字。
4. 美術（分支 `claude/restaurant-art` 已精修一輪）：電視牆改菜單看板、收銀螢幕改點餐單、招牌與店招去除診所十字（改麵碗）、休息室/飲料吧/吧台/櫃檯改暖色、鋼材改暖灰、服務生加托盤；介面主題色（css、theme-color、圖示、氣泡、進度條）全改紅/木色。手機 360x740、390x844、844x390 無溢出、無小於 32px 的點擊區。

已完成：圖示改為麵碗、manifest/theme 色改暖紅、移除多餘的 `undefined/` 目錄。

## 文件狀態（`claude/restaurant-docs`）
- **已改寫為餐廳版**：`GAME_ARCHITECTURE.md`（總覽）、`ARCHITECTURE.md`（契約；分層 `core ← data ← sim ← render/ui`、五職類 `chef/cook/barista/server/cashier`、菜色 `menu/special`、食安 `state.safety.risk`、事件 `month:settled` 等，皆對照程式碼）。
- **已修正過時處並加註**：`EVENTS_EXT.md`（`cat`、`risk`、`cond`、設備清單、離職職類）、`ACHIEVEMENTS.md`（§4 清單改由 `achievements.js` 產生，58 個）、`GOALS_AND_ENDING.md`（新手任務、年度主要目標、結局表）、`ART_STYLE.md`（註明無圖集、色票是診所版配色待重訂）。
- **診所版遺留（檔頭已註明「不適用」，僅供參考）**：`EVENT_RESEARCH.md`、`FEE_RESEARCH.md`、`ASSETS_LIST.md`、`events_and_achievements.md`。
- **已刪除**（無法加註的診所專用檔）：`fee_data.json`、`game_assets_list.xlsx`、`events_and_achievements.xlsx`；需要時可從 `claude/rehab-clinic-game` 或 git 歷史取回。
- **文件中已知的程式現況落差**：專家路線月淨利未達目標；`goals.js` 第 6、7 年目標金額／人次與結局門檻為診所版數字；`dine` 的 `price` 為 0（只佔桌，不收費），`RESTAURANT_DESIGN.md` §4 已更正。
