# 成就系統設計文件（待審核）

狀態：**設計稿，尚未開發**。確認或修改後才會派子代理實作。
已確認的方向：輕量收藏＋小獎勵、約 40 個成就、類型為「經營里程碑 / 台灣在地特色 / 挑戰與隱藏」、呈現方式以「院長稱號＋診所招牌徽章」為主。

---

## 1. 設計原則

1. **不改動主線平衡**：獎勵是小額資金／點數／聲譽，全部成就領完的總資金獎勵 ≈ 第 3 年累計淨收入的 10% 以內（QA 驗證）。沒有永久數值加成。
2. **引導而非強迫**：成就的內容就是在鼓勵玩家嘗試各系統（特殊區、社區活動、評鑑、醫病溝通、自費轉型），並用台灣在地題材增加趣味。
3. **全部可離線結算**：成就由事件與每週檢查驅動，不需要額外輸入；舊存檔載入後會補算「可由當前狀態判定」的成就。
4. **隱藏成就**：未解鎖前只顯示「？？？」與一句提示。

## 2. 呈現方式（你選擇的重點）

| 項目 | 設計 |
|---|---|
| **院長稱號** | 現有稱號依聲譽自動升級（見習院長→國手級復健名醫）保持不變，當作「頭銜」。新增**特殊稱號**：部分成就會附贈一個稱號（例：寒流守護者），玩家可在診所面板選一個「配戴」，顯示在頂部狀態列與選取卡片中，格式：`〔寒流守護者〕地方復健名醫`。 |
| **診所招牌徽章** | 診所招牌（地圖上牆面看板，現有渲染）旁加掛最多 **4 枚**像素徽章：①自動的「總數徽章」（解鎖 10/20/30/全部 → 🥉/🥈/🥇/🏆）＋ ②玩家自選最多 3 枚「成就徽章」（每個成就有一個 emoji 徽章圖示）。 |

**我另外加了兩個最小必要的元素，若不要請告訴我刪掉：**
- 解鎖時用**現有的 toast 提示**（`🏆 成就解鎖：○○`），不另做橫幅元件。
- 稱號與徽章需要地方挑選，所以把**現有「診所」面板裡的「院長稱號」區塊**擴充成「稱號與徽章」：成就收藏格（已解鎖／未解鎖／進度條）＋配戴按鈕。不新增側邊欄按鈕。
（你沒有選「年度回顧彈窗」，所以不做。）

## 3. 獎勵階層

| 階層 | 數量 | 資金 | 其他 |
|---|---|---|---|
| 銅 🥉 | 約 17 | NT$ 10,000 | 少量點數（醫術／儀器／服務擇一，+8） |
| 銀 🥈 | 約 17 | NT$ 35,000 | 聲譽 +3，點數 +15 |
| 金 🥇 | 約 7 | NT$ 150,000 | 聲譽 +10，服務點數 +30，並附特殊稱號 |
資金獎勵直接用 `economy.earn(state, n, 'other')`；獎勵數值全部集中在資料檔，方便 QA 調整。部分銅／銀成就也可附稱號（見清單）。

## 4. 成就清單（共 41 個）

欄位：`id`｜名稱｜條件｜階層｜稱號/徽章。**進度基準**：單週來客上限 L0=22、L1=38、L2=68、L3=100；一般專家路線第 1 年末聲譽約 170–340、資金可達數百萬。

### 4.1 經營里程碑（16）
| id | 名稱 | 條件 | 階層 | 稱號 / 徽章 |
|---|---|---|---|---|
| m_first_month | 開張大吉 | 完成第 1 次月底健保結算 | 銅 | 🎉 |
| m_cash_2m | 第一桶金 | 資金 ≥ NT$ 2,000,000 | 銅 | 💰 |
| m_cash_10m | 千萬院長 | 資金 ≥ NT$ 10,000,000 | 金 | 稱號「千萬院長」/ 💎 |
| m_pat_100 | 百人次 | 累計服務 100 位病患 | 銅 | 👥 |
| m_pat_1000 | 千人次 | 累計服務 1,000 位病患 | 銀 | 👥 |
| m_pat_5000 | 五千人次 | 累計服務 5,000 位病患 | 金 | 稱號「在地萬人迷」 |
| m_cured_100 | 妙手回春 | 累計治癒 100 位病患 | 銀 | 稱號「妙手回春」/ ✋ |
| m_rep_100 | 口碑起家 | 聲譽 ≥ 100 | 銅 | 📣 |
| m_rep_250 | 地方名醫 | 聲譽 ≥ 250 | 銀 | 📣 |
| m_rep_600 | 全國有名 | 聲譽 ≥ 600 | 金 | 稱號「國民復健名醫」 |
| m_lot1 | 搬新家 | 擴建到「社區診所」 | 銅 | 🏠 |
| m_lot2 | 擴大營業 | 擴建到「地區復健中心」 | 銀 | 🏢 |
| m_lot3 | 頂尖中心 | 擴建到「全台頂尖復健中心」 | 金 | 稱號「復健中心創辦人」 |
| m_year3 | 三週年 | 存活到第 4 年開始（撐過 3 年） | 銀 | 🎂 |
| m_five_roles | 五職齊備 | 同時聘有醫師、PT、OT、ST、護理師 | 銅 | 🧑‍⚕️ |
| m_research_all | 學無止境 | 完成全部研發節點 | 金 | 稱號「研發怪咖院長」/ 🔬 |

### 4.2 台灣在地特色（12）
| id | 名稱 | 條件 | 階層 | 稱號 / 徽章 |
|---|---|---|---|---|
| t_cold_week | 寒流守護者 | 寒流週結束時，該週服務 ≥ 15 位長輩 | 銀 | 稱號「寒流守護者」/ 🧣 |
| t_rain_safe | 風雨無阻 | 雨天週（rain）服務 ≥ 12 位病患且 0 人滑倒 | 銀 | ☔ |
| t_typhoon | 颱風天照常營業 | 颱風週服務 ≥ 5 位病患 | 銅 | 🌀 |
| t_temple | 廟口肌少症剋星 | 完成「宮廟肌少症篩檢」 | 銅 | 稱號「廟口肌少症剋星」/ 🛕 |
| t_community_all | 里民好厝邊 | 7 種社區活動各完成過至少 1 次 | 銀 | 🤝 |
| t_audit | 督導過關 | 首次通過衛生局督導／健保署抽查 | 銅 | 📋 |
| t_audit_excellent | 督導優等 | 評鑑分數達優等（≥ `EXCELLENT_SCORE`） | 銀 | ⭐ |
| t_audit_3 | 模範診所 | 連續 3 年通過評鑑 | 金 | 稱號「評鑑模範生」 |
| t_dilemma_5 | 溝通達人 | 處理 5 次醫病溝通情境 | 銅 | 💬 |
| t_dilemma_all | 阿嬤說了算 | 四種情境都處理過（止痛藥／只做電療／過度治療／客訴） | 銀 | 稱號「溝通大師」 |
| t_selfpay_40 | 自費轉型成功 | 單月自費收入佔總收入 ≥ 40% | 銀 | 💳 |
| t_board_3 | 衛教達人 | 同時啟用 3 個衛教看板 | 銅 | 🪧 |

### 4.3 挑戰與隱藏（13，其中 ★ 為隱藏）
| id | 名稱 | 條件 | 階層 | 稱號 / 徽章 |
|---|---|---|---|---|
| c_zone_golden | 黃金三寶 | 啟動「黃金三寶區」 | 銅 | 🥇 |
| c_zone_premium | 高階自費 | 啟動「高階自費專區」 | 銅 | ☕ |
| c_zone_kidpark | 放電樂園 | 啟動「早療放電樂園」 | 銅 | 🎠 |
| c_zone_all | 專區大滿貫 | 三大專區同時啟動 | 銀 | 稱號「專區規劃師」 |
| c_zero_slip_year | 零滑倒一整年 | 一個完整年度（12 個月）內 0 人滑倒，且至少服務 200 位病患 | 金 | 稱號「防滑達人」/ 🦶 |
| c_no_angry_month | 笑臉迎人 | 單月 0 位憤怒離開（滿意度 < 25 或超時）且服務 ≥ 20 人 | 銀 | 😊 |
| c_full_house | 門庭若市 | 已擴建（店面等級 ≥ 1）且單週服務人數 ≥ 該店面上限的 90% | 銀 | 🈵 |
| c_pure_nhi | 純健保硬撐 | 第 1 年全程未收取任何自費治療費且年底資金 ≥ 起始資金 | 銀 | 稱號「純健保硬漢」 |
| c_one_week_cure | 神醫降臨 | 單週治癒 ≥ 10 位病患 | 銀 | 💊 |
| ★ h_coffee | 咖啡成癮 | 同時擁有 3 台咖啡機 | 銅 | ☕☕ |
| ★ h_chat | 聊天治百病 | 長輩與治療師累計聊天 50 次 | 銅 | 🗣️ |
| ★ h_comeback | 絕處逢生 | 資金曾低於 NT$ 50,000，之後回升到 NT$ 1,000,000 以上 | 銀 | 稱號「不死鳥院長」 |
| ★ h_plants | 叢林診所 | 同時擺放 10 盆綠植 | 銅 | 🌿 |

合計：16 + 12 + 13 = **41**。階層分佈約 銅 17／銀 17／金 7（以最終資料檔為準）。

## 5. 技術規格

### 5.1 資料（Haiku）`js/data/achievements.js`
```js
export const ACHIEVEMENTS = [
  { id, name, desc, hint /*隱藏成就未解鎖時顯示*/, cat: 'milestone'|'taiwan'|'challenge',
    tier: 1|2|3,                 // 銅/銀/金
    hidden: boolean,
    badge: '🏆',                 // 徽章 emoji
    title?: '稱號文字',          // 解鎖後可配戴
    reward: { money, points: {medical?,device?,service?}, rep },  // 依階層預設，可個別覆寫
    goal?: number,               // 供進度條用（累計類）
    metric?: 'patientsTotal'|'cured'|'money'|'reputation'|... }     // 進度條來源，無則只顯示已/未解鎖
  ...
];
export const ACHIEVEMENT_TIERS = { 1: {name:'銅', money:15000, rep:0, points:8}, 2: {...}, 3: {...} };
export const BADGE_MILESTONES = [ {count:10, icon:'🥉'}, {count:20, icon:'🥈'}, {count:30, icon:'🥇'}, {count:'all', icon:'🏆'} ];
```

### 5.2 狀態（生產者在 `core/state.js` 增加，並提升 `SAVE_VERSION` 到 2）
```js
state.achv = {
  unlocked: { [id]: { year, month, week } },
  counters: { totalSelfPayMonth, dilemmasDone:{painkiller:0,...}, communityDone:{id:n}, auditPassStreak, chatCount,
              slipThisYear, angryThisMonth, servedThisWeek, curedThisWeek, elderThisWeek, slipThisWeek,
              selfPayEver:false, lowestMoneySeen, ... },
  title: null,                   // 配戴的特殊稱號所屬成就 id
  badges: [],                    // 玩家挑選的最多 3 個成就 id
};
```
`save.js`：新增 migration v1→v2（補 `achv` 並用 `evaluateAll` 補算可判定項目）；`sanitize` 清掉未知 id、截斷 badges 長度為 3、title 必須已解鎖。

### 5.3 系統（Sonnet）`js/sim/achievements.js`
- `initAchievements()`：註冊 bus 監聽（由 main.js 呼叫一次）。
- `evaluate(state, trigger)`：依觸發事件只檢查相關成就；`evaluateAll(state)`：載入後補算。
- 解鎖流程：寫入 `state.achv.unlocked` → `economy.earn` 發獎勵、加點數與聲譽 → `bus.emit('toast', ...)` + `bus.emit('achievement:unlocked', {id})` → 必要時 `bus.emit('mods:dirty')`（目前無永久加成，僅預留）。
- `listAchievements(state) -> [{def, unlocked, at, progress, goal}]`（隱藏且未解鎖者將名稱與條件遮蔽）。
- `equipTitle(state, id|null) -> bool`、`setBadges(state, ids) -> bool`、`displayTitle(state) -> string`、`badgeIcons(state) -> string[]`（供 UI、渲染使用）。
- 觸發來源（已存在的事件）：`week:end`、`month:end`／`nhi:settled`、`year:end`、`inspection:result`、`lot:expanded`、`research:done`、`patient:left`、`patient:slip`、`treatment:done`、`dilemma:resolved`、`map:changed`（建造類）。
- **需要新增的少量事件（小改動）**：
  - `events.js`：開始社區活動時 `bus.emit('community:started', {id})`。
  - `patients.js`：長輩聊天完成時 `bus.emit('patient:chat', {patient})`（隱藏成就 h_chat）。
  - 天氣由 `state.weather` 在 `week:end` 讀取（寒流／雨天／颱風）。

### 5.4 UI（Sonnet）
- `js/ui/panels/clinic.js`：擴充「院長稱號」→「稱號與徽章」：已解鎖數／總數、分類頁籤（里程碑／在地／挑戰）、成就卡（徽章、名稱、條件、進度條、獎勵、解鎖日期）、「配戴稱號」與「掛上招牌」按鈕（最多 3 枚，超過時提示）。
- `js/ui/topbar.js`：稱號顯示 `〔特殊稱號〕聲譽稱號`。選取卡片沿用。
- `js/ui/fmt.js`／`toast.js`：解鎖 toast 用 `kind:'good'`。
- 隱藏成就以「？？？」＋ hint 顯示，已解鎖才顯示全文。

### 5.5 渲染（Sonnet）
- `js/render/renderer.js`：招牌（約第 147 行附近）在診所名稱右側繪製 `badgeIcons(state)`（最多 4 枚，像素化 emoji，縮放時不模糊）；招牌圖層快取鍵加入徽章清單，徽章改變才重建。
- 不新增動畫；解鎖當下可在招牌上做一次 1 秒的閃光（可選）。

### 5.6 測試與驗證（QA）
- `tools/audit.mjs` 新增 achievements 區段：逐一用 headless 腳本強制達成條件，檢查解鎖、獎勵數額、只發一次、存讀檔往返、舊存檔遷移、隱藏成就遮蔽。
- 平衡檢查：5 年模擬中成就資金獎勵總和占累計淨收入比例（目標 ≤ 10%），且不會讓起始診所提早破產／過度富裕。
- `tools/play.mjs` 新增：開診所面板、配戴稱號、掛徽章、重新整理後仍保留、招牌上看得到徽章（截圖比對尺寸／不報錯）。

## 6. 開發分工（確認後）
| 代理 | 內容 |
|---|---|
| Haiku ×1 | `js/data/achievements.js`（41 個成就文案、獎勵、徽章；含 hint、title） |
| Sonnet ×1 | `js/sim/achievements.js` ＋ `core/state.js`/`save.js` 遷移 ＋ `community:started`／`patient:chat` 兩個 emit ＋ `main.js` 註冊 |
| Sonnet ×1 | UI（診所面板、頂部稱號）＋ 渲染招牌徽章 |
| Sonnet ×1 | QA：audit/play 腳本、平衡驗證、跨檔整合修 bug |

## 7. 請你確認的事項
1. 成就清單（41 個）有沒有想刪／想加／想改條件的？
2. 獎勵強度（銅 1.5 萬／銀 5 萬／金 20 萬）可以嗎？
3. 我多加的兩個最小元素（解鎖 toast、診所面板內的收藏格與配戴）是否接受？
4. 招牌徽章 4 枚（1 枚自動＋3 枚自選）是否合適？
