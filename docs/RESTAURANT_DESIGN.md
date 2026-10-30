# 餐廳物語 — 診所→餐廳 移植對照（RESTAURANT_DESIGN）

分支 `claude/restaurant-game`，從 `claude/rehab-clinic-game`（復健科診所物語）分出。**引擎不變**（等距 Canvas、病患狀態機、員工資格、研發、專區、事件、職涯、存檔），只換主題、資料、經濟模型與繪圖。
診所版保留在原分支，不受影響。

## 0. 原則
- 保留引擎裡的**結構性內部名稱**（`state.patients`、`TREATMENTS`、`PATIENT_TYPES`、`treatment:done`、`selfPayConv` 等 mods 鍵、`reception`、`rest_room`…），在文件註明語意；**使用者看得到的字串、資料 id、角色、設備、事件、成就、目標一律改成餐廳版**。
- 玩家看到的詞：病患→**客人**，治療→**餐點**，看診→**用餐**，健保→（移除，改直接營收），自費→**加點／特色料理**。
- 存檔鍵 `ptgame.save.` → `restgame.save.`（避免與診所版在同一網域互相覆蓋）。SAVE_VERSION 重置為 1。

## 1. 內部語意對照
| 診所概念 | 餐廳概念 | 內部名稱 |
|---|---|---|
| 病患 | 客人（一個模擬客人＝一桌／一組客） | `state.patients`、`patientWeight`（一個模擬客人代表 N 組真實客人） |
| 掛號 | 點餐結帳 | `reception`（點餐結帳櫃檯），員工 `cashier` |
| 治療步驟 | 餐點步驟（出餐口取餐、內用） | `TREATMENTS[id]`、`treatment:done` |
| 健保（nhi）給付 | **基本菜單**：上菜即收現金 | `kind:'menu'`（舊 `'nhi'`），`price` |
| 自費 | **特色料理／加點**（有價格滑桿、轉換率） | `kind:'special'`（舊 `'self'`），`selfPaySteps` |
| 健保點值稀釋、上限、單一申報、診察費階梯、部分負擔 | 移除 | — |
| 食材 | 每道餐點有 `foodCost`（成本率），上菜時記入 ledger `food` | `mods.foodCost` |
| 健保審查風險 | **食安風險**（0–100，影響稽查與事件） | `state.safety.risk`（舊 `state.nhi.risk`） |
| 治癒 | **變成熟客**（累積好感達標） | `cured`、`hp`、`cureNeeded`、`visitsToCure` |
| 部分負擔 | （移除） | — |
| 網路評價 | 網路評價（Google／iPeen） | `state.reviewScore` |
| 衛生局＋健保署督導 | 衛生局稽查（食安、消防、無障礙） | `inspection.js` |
| 醫術／儀器／服務 點 | 廚藝／設備／服務 點 | 鍵 `culinary` / `device` / `service` |

## 2. 角色（ROLES，順序固定）
| id | 名稱 | 取代 | 負責 |
|---|---|---|---|
| `chef` | 主廚 | doctor | 招牌主餐、主廚特餐、鐵板；薪資最高 |
| `cook` | 廚師 | pt | 煮麵、炸物、煎檯、熱炒、燒烤、滷鍋 |
| `barista` | 吧台師 | ot | 飲料、冰品、甜點、吧台 |
| `server` | 外場服務生 | st | 內用上菜、小菜、湯品、火鍋桌 |
| `cashier` | 櫃檯收銀 | nurse | 點餐結帳；可兼看冷盤檯、湯鍋、飲料機（開機型） |

## 3. 客人類型與經營方針
| id | 名稱 | 取代 | 時段 | 特色 |
|---|---|---|---|---|
| `elder` | 晨間長輩客 | elder | 早餐 08–11 | 慢、要坡道、愛聊天、不太加點 |
| `office` | 上班族午餐客 | office | 午餐 11:30–13:30、晚餐 17:30– | 沒耐性、愛加點飲料甜點 |
| `student` | 放學學生族 | sports | 下午茶 14–18 | 預算少、聲量大（口碑加成） |
| `family` | 親子家庭客 | kid | 晚餐 17–19:30 | 要兒童遊戲區、多道菜、服務點數高 |

經營方針（`FOCUS` 鍵）：`business` 商業午餐店（原 ortho）、`community` 社區早餐店（原 ltc）、`kids` 親子餐廳（原 peds）。

## 4. 餐點（TREATMENTS）— 17 道
**基本菜單（menu，11）**：`main` 招牌主餐｜`noodle` 湯麵｜`rice` 滷肉飯｜`dumpling` 煎餃鍋貼｜`fried` 鹽酥雞炸物｜`teppan` 鐵板燒｜`side` 小菜｜`soup` 例湯｜`drink` 手搖飲｜`ice` 冰品豆花｜`dine` 內用用餐（餐桌，服務生開桌後客人自行用餐，收服務費）。
**特色料理（special，6）**：`steak` 主廚特餐牛排｜`seafood` 活海鮮熱炒｜`hotpot` 精緻火鍋｜`bbq` 炭火串燒｜`dessert` 手作甜點｜`beer` 精釀啤酒與茶酒。

`attend:'setup'`（開機型：滷鍋、煎檯、冷盤、湯鍋、飲料機、餐桌）只需員工開頭數分鐘在場；`attend:'full'` 全程綁員工。

## 5. 建造物（BUILDABLES）— 32 個
- 地板：`floor_tile` 防滑磁磚、`floor_wood` 木紋地板、`ramp` 無障礙坡道
- 候位與景觀：`bench` 候位長椅（座位）、`water` 冰水機、`tv` 電視牆、`plant` 綠植、`sign` 指示招牌
- 入座與櫃檯：`reception` 點餐結帳櫃檯、`table2` 雙人桌、`table4` 四人桌、`rest_room` 員工休息室
- 熱廚：`chef_range` 主廚爐台、`noodle_stove` 煮麵台、`braise_pot` 滷肉鍋、`griddle` 煎檯、`fryer` 油炸鍋、`teppan` 鐵板檯
- 吧台冷食：`cold_case` 冷盤檯、`soup_pot` 湯鍋、`drink_bar` 飲料吧、`ice_shop` 冰品檯
- 特色料理：`chef_table` 主廚餐檯、`wok_range` 熱炒爐、`hotpot_table` 火鍋桌、`bbq_grill` 炭火爐、`dessert_bar` 甜點吧、`bar_counter` 吧台
- 特殊：`coffee` 咖啡機、`play_area` 兒童遊戲區、`kids_mat` 兒童軟墊、`bookshelf` 繪本書架、`espresso`（保留位）

## 6. 經濟
- 基本餐點：上菜時 `earn(price × patientWeight, 'menu')`，同時 `food` 成本 = price × foodCost × mods.foodCost × weight。
- 特色料理：價格 = `price × priceMult 滑桿 × mods.selfPayPrice`，記 `special`。
- 月底：薪資、租金、維護；不再有「健保結算」，但仍發 `nhi:settled`（事件名保留，內容為月結報表）。
- 破產線、年度巡查、職涯審查維持。
- 平衡目標沿用診所版：起始第 1 個月約損益兩平；好佈局 +25…40%；專家路線年末月淨利 30–50 萬。

## 7. 進度（接手者請更新）
見 `docs/RESTAURANT_PROGRESS.md`。
