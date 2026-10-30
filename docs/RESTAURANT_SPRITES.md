# 餐廳圖片素材（RESTAURANT_SPRITES）

來源：`assets/ref/restaurant_sheet.png`（1536×1024 台灣小吃概念圖集）。
裁切腳本：`python3 tools/cut_restaurant_sheet.py`（只需 Pillow + numpy，可重現）→ 輸出 `assets/rest/<group>/<name>.png` 與 `assets/rest/manifest.json`（每張圖的檔案與尺寸；service worker 依它預先快取）。
去背：從裁切框邊緣洪水填色移除面板底色（輪廓內的白色保留），再修邊、去雜點、裁到不透明範圍。`comp/*` 是由多張裁圖組合（櫃檯＋收銀機、桌＋圓凳）；`staff/*` 是老闆圖把藍色圍裙轉色（廚師原色、廚師帽→綠、吧台→紫、服務→紅褐、收銀→青）。

## 程式
- `js/render/rest_sprites.js`：背景載入；任何失敗（manifest／單張圖／設定為「原像素風」）都回 `null`，遊戲退回程式繪圖。載入完成發 `rest:art`，renderer 與 artdom 重建物件與縮圖。
- 既有檔案只做小幅接線：`sprites.js`（`getObjectSprite`／`getPersonSprite`／`getIconSprite` 開頭先問圖片）、`renderer.js`（載入、`drawSpr` 以 dw×dh 繪人、上菜中顯示餐點小圖）、`ui/artdom.js`（縮圖）、`sw.js`（快取，版本 v2）。

## 建造物 → 圖塊對照（`OBJ` 表在 rest_sprites.js；[高度上限, 寬度占比] 可調）
| buildable | 圖塊 | 把握 |
|---|---|---|
| bench | furniture/bench_red | 高 |
| water | furniture/sink（有水龍頭） | 中 |
| plant | furniture/plant_pot | 高 |
| sign | furniture/chalk_stand（A 字黑板） | 高 |
| reception | comp/reception_set（料理台＋收銀機） | 高 |
| table2 / table4 | comp/table2_set / table4_set（桌＋紅圓凳） | 高 |
| chef_range、griddle、wok_range | kitchen/gas_stove（瓦斯爐） | 中（三者共用） |
| noodle_stove、soup_pot | kitchen/big_pot（大鍋） | 中 |
| braise_pot | kitchen/steamer（蒸籠） | 低 |
| fryer | furniture/kitchen_unit | 低 |
| teppan | furniture/prep_table | 中 |
| cold_case | kitchen/fridge（冷藏櫃） | 高 |
| drink_bar | furniture/display_stand | 低 |
| ice_shop | furniture/ice_tub | 中 |
| chef_table、dessert_bar、bar_counter | furniture/counter（料理台） | 中 |
| hotpot_table | furniture/table | 中 |
| bbq_grill | furniture/food_stall（有烤台的攤車） | 中 |
| coffee | kitchen/tableware（白色機台） | 低 |
| bookshelf | furniture/wall_shelf | 中 |
| 無對應（維持程式繪製） | tv、rest_room、play_area、kids_mat、floor_*、ramp | — |

人物：客人 elder→cust_elder；office→cust_boy／cust_green；student→cust_cap／cust_bag；family→cust_girl／cust_dress（圖集只有正面，左向用水平翻轉，背向也用正面）。員工 5 職類用 `staff/<role>_front|_back`（取自老闆的 3/4 前後視角）。坐姿裁掉下 26%。
狀態圖示：money→coin、question→speech。餐點小圖（上菜中顯示在進度條上方）：見 `FOOD` 表。
已裁切但尚未使用：燈籠、招牌（sign_taiwan／sign_vertical）、大菜單黑板、遮陽棚、屋頂、茶杯、門、醬料／食材／紙箱等（`deco/`、`kitchen/`、`furniture/` 內）。建築外觀 6 款未裁，之後可補。
