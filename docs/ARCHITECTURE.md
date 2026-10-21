# 復健科診所物語 — 架構與契約 (ARCHITECTURE)

Producer-owned contract. **All agents must follow the names, shapes and signatures below exactly** so modules written in parallel plug together. If you believe the contract must change, do NOT change it silently — implement against it and list the proposed change in your final report.

PRD summary: 2.5D isometric pixel-art management sim (Kairosoft style) of a Taiwanese rehab clinic. Landscape web game, left-click to build, right-drag pan, wheel zoom. UI language: **繁體中文 (台灣用語)**.

## 0. Ground rules

1. Pure static site: HTML5 Canvas + vanilla JS **ES modules**, no build step, no npm runtime deps, no external assets/CDN/fonts. Must run from any static server (`python3 -m http.server`) and GitHub Pages (relative paths only).
2. All art is drawn in code (Canvas 2D, pixel-art look: `imageSmoothingEnabled=false`, draw small then scale up, chunky outlines). Emoji / CJK glyphs allowed inside sprites.
3. **Never run git commands.** The producer commits. Only create/edit files you own (§1). Read anything.
4. Do not edit `js/core/*`, `index.html`, `js/main.js`, `docs/*` (producer-owned). Report needed changes instead.
5. Every module must `import` only from: `js/core/*`, `js/data/*`, and the module APIs listed in §4. No circular imports between sim modules except via `bus` events.
6. Code style: 2-space indent, `const`/`let`, named exports only (no default exports), short comments where intent isn't obvious. All user-visible strings in 繁體中文.
7. Game state is plain JSON-serialisable data (no class instances, no functions, no Map/Set in `state`). Runtime caches live outside `state` or are named `*Cache`/`map.occ` and stripped on save.
8. Verify your own work: `node --check` for syntax, and if you own something runnable, load it in headless Chromium via Playwright (installed globally: `/opt/node22/lib/node_modules/playwright`, browsers at `/opt/pw-browsers`; use `executablePath: '/opt/pw-browsers/chromium'`-style launch if needed; serve with `python3 -m http.server <port>` from repo root, in background). Use the scratchpad dir for temp files.

## 1. File ownership

| Owner | Files |
|---|---|
| Producer | `index.html`, `js/main.js`, `js/core/*` (constants, bus, state, grid), `docs/*` |
| **H1** (data A) | `js/data/buildables.js`, `js/data/synergies.js`, `js/data/lots.js` |
| **H2** (data B) | `js/data/treatments.js`, `js/data/patients.js`, `js/data/staffdefs.js` |
| **H3** (data C) | `js/data/research.js`, `js/data/events.js`, `js/data/texts.js` |
| **H4** (css) | `css/style.css`, `README.md` (player-facing: how to play, run, deploy) |
| **S-A** (agents sim) | `js/sim/pathfinding.js`, `js/sim/patients.js`, `js/sim/staff.js` |
| **S-B** (systems sim) | `js/sim/calendar.js`, `js/sim/economy.js`, `js/sim/build.js`, `js/sim/synergy.js`, `js/sim/modifiers.js`, `js/sim/research.js`, `js/sim/events.js`, `js/sim/inspection.js`, `js/sim/save.js` |
| **S-C** (render) | `js/render/iso.js`, `js/render/camera.js`, `js/render/sprites.js`, `js/render/renderer.js`, `js/render/input.js` |
| **S-D** (ui) | `js/ui/*.js` (topbar, sidebar, panels/*, modal, toast, tooltip, ui.js), `css/ui.css` |
| QA (later) | `tools/*`, bug fixes anywhere after the first integration |

## 2. Time, economy & tuning targets

* `state.time = {year, month, week, clock, speed, paused}`. **One in-game week = one operating day**: `clock` runs `OPEN_MIN (08:00)` → `CLOSE_MIN (20:00)`; that takes `WEEK_REAL_SEC = 45` real sec at speed ×1 (`MIN_PER_REAL_SEC = 16` game-min per real sec). 4 weeks = 1 month, 12 months = 1 year. Speeds 0/1/2/3. `main.js` calls everything with `dtMin` (game minutes, ≤ 1.0 per call; it sub-steps).
* Start: NT$ 1,200,000, small lot (12×10), 3 starter staff (1 doctor, 1 nurse, 1 PT) pre-hired, a reception + exam_room + 2 heatboxes + 1 sofa pre-placed so the player sees activity immediately (S-B `build.js` exports `seedStarterClinic(state)`).
* Walking speed: `WALK_TILES_PER_MIN` tiles per game-minute × per-agent multiplier.
* **NHI (健保) and real fee data.** Every real-world number (point value 0.95, exam-fee tiers, PT tiers, NHI points per treatment, self-pay quotes, copay) lives in ONE module, `js/data/fees.js` (`FEES_AS_OF = '2026-10'`; each entry carries a confidence marker and sources, see `docs/FEE_RESEARCH.md` / `docs/fee_data.json`; low-confidence values await verification against the official 健保署 支付標準). `data/treatments.js` imports `nhiPoints` / `price` from it. The sim never hard-codes a fee.
  * **Claims (per patient per visit).** `economy.nhiClaim(state, claims, treatmentId)` implements the *single-claim rule*: NHI treatments belong to a claim group (`exam | pt | ot | st | us`); within a group only the HIGHEST listed value is paid (a later, higher item pays the difference). `pt` = ir 95, taping ≈150 (estimate), heat / tens / traction / manual_nhi 200; OT = si / fine 320; ST = speech 320; us 500. All treatments still run, cure and give research points; only the points are zeroed. The `treatment:done` payload carries `nhiPoints` (paid), `nhiListed`, `nhiGroup`, `singleClaim`, `selfPay` (real NT$), `copay` (real NT$). The visit's claim state is `patient.claims` (created lazily; old saves need no migration).
  * **Exam fee tiers.** The exam is paid by the doctor's patients that day, `examFeePoints(state.stats.patientsToday + 1)`: 1–35 → 364, 36–45 → 250, 46–65 → 200 (estimate), 66+ → 160. One in-game week IS one operating day, so this is "patients per day".
  * **Copay.** NT$ 50 on every RETURNING visit (`patient.visit >= 1`), collected with the first treatment of the visit, ledger key `copay`.
  * **PATIENT_WEIGHT** (`economy.js`, currently 15): each simulated patient stands for that many real patients. It multiplies ALL patient-generated revenue consistently — NHI income = `monthPoints × pointValue × PATIENT_WEIGHT` (at settlement), self-pay = `selfPayPrice × PATIENT_WEIGHT` (at treatment time), copay = `50 × PATIENT_WEIGHT` — and never salaries, rent, build costs, event money or inspection rewards (plain NT$). `selfPayPrice(state, id)` is the REAL per-session price (`fees typical × priceMult 0.5–2.0 × mods.selfPayPrice`). The UI explains the weight once in the 自費定價 tab and in the month-report footnote.
  * **Settlement** (`economy.settleMonth`): `pointValue` = `PV_BASE (0.95)` when `monthPoints ≤ cap`; above the cap it dilutes: `pv = clamp(cap / monthPoints, PV_MIN 0.6, PV_BASE)`, applied to ALL points (so spamming cheap 電熱療 stops paying — self-pay research is the escape). `cap = lotDef.nhiCap × (1 + mods.nhiCapBonus?)` (points per month; L0 28,000 / L1 38,000 / L2 56,000 / L3 82,000). The `nhi:settled` record has `nhiIncome, selfIncome, copayIncome, otherIncome, patientWeight, basePointValue, pointValue, diluted`.
  * **Balance knobs (abstraction, not real data):** `PATIENT_WEIGHT`, `data/patients.js selfPay` (willingness: elder 0.07, office 0.18, sports 0.16, kid 0.07; scaled relatively by `mods.selfPayConv` and staff charm), per-treatment `uptake` in `data/treatments.js` (prp 0.25, insole 0.5, redcord 0.8), plan `selfPaySteps`, `nhiCap` in `data/lots.js`, `patients.TUNE` arrival constants and `SKIP_STEP_PENALTY` (8: with the single-claim rule a missing modality no longer costs revenue, so it costs satisfaction).
* Month end also: pay salaries (`Σ staff.salary × mods.wageMult`), rent (`lotDef.rent × mods.rentMult`), maintenance (small per object), push `state.history`, reset `ledger`/`nhi.monthPoints`, autosave. Bankruptcy: `money < -300000` at a month end → `bus.emit('game:over', {reason})`.
* **Balance target** (verified with the headless sim, `tools/bal_events.mjs` and the QA balance harness): starter clinic month 1 ≈ break-even (−100k…+50k), months 3–4 margin +5…15%; a good layout (seats, near reception, 1 PT) +25…40%; a bad layout (no waiting seats, far reception) clearly negative (−15…−30%); an expert path (research + self-pay rooms + expansion) nets NT$ 300–500k/month in year-1 months 10–12; a crowded L2 clinic ≈ 0.6–1.2M/month; events stay within ±10% of income. A good mid-game clinic (after ~1 game year) should net NT$ 300k–900k/month. Year-1 reputation should reach ~100–250 with competent play.
* Reputation `state.reputation` 0..1000: scales patient arrival: `arrivalsPerWeek ≈ (12 + reputation × 0.12) × mods.spawnMult × focus/type weights`, capped by lot size (`lotDef.maxPatientsPerWeek`).

## 3. Data shapes

### 3.1 Static data (`js/data/*.js`, all named exports, plain objects, frozen not required)

**`buildables.js`** → `export const BUILDABLES = { [id]: Def }`, `export const BUILD_CATEGORIES = [...]`
```js
Def = {
  id, name,                       // 繁中 name
  cat: 'env' | 'facility' | 'special',
  sub: string,                    // sub-tab label inside the category (e.g. '地板與通道','候診與景觀','基礎門診','物理治療區','運動與自費','職能與早療','員工','特殊')
  layer: 'floor' | 'object',      // floors paint into state.map.floor (1x1, drag-paint); objects are placed in state.objects
  w, h,                           // footprint (rot 0). rot 1 swaps.
  blocks: boolean,                // default true for objects; false for flat items (sign, soft_mat) -> walkable
  cost, upkeep,                   // NT$ build cost, NT$/month maintenance (floors: cost per tile, upkeep 0)
  requires: null | researchNodeId,// locked until that research node is done; null = available at start
  color: '#rrggbb', top: '#rrggbb', height: number, glyph: 'emoji or 1-2 chars', // used by default box sprite (height in px at zoom 1)
  desc: '一句話說明',
  // optional gameplay fields:
  seats?: number,                 // waiting seats provided (sofa)
  comfort?: number,               // 0..10, adds to satisfaction of patients who see/wait near it (radius 4 tiles)
  anxietyRelief?: number,         // reduces waiting impatience (tv, sign, water)
  grip?: number,                  // floors only: 0..1 slip safety (mat 0.95, wood 0.6, bare null=0.45, ramp 0.8)
  walkMult?: number,              // floors only: ramp 1.25 for elders/wheelchair etc., default 1
  stationFor?: [treatmentId],     // treatments this object can host
  restRecovery?: number,          // rest_room: stamina/min restored
}
```
Required ids (exactly these; H1 may add extras but must include all):
`floor_mat 防滑地墊, floor_wood 木紋地板, ramp 無障礙坡道` (layer floor, cat env, sub 地板與通道);
`sofa 候診沙發(2x1,seats 2), water 飲水機, tv 電視牆(2x1), plant 綠植, sign 誘導標示(blocks:false)` (env, sub 候診與景觀);
`reception 掛號櫃檯(2x1), exam_room 看診室(2x2), us_room 超音波檢查室(2x2), rest_room 休息室(2x2)` (facility, 基礎門診);
`heatbox 熱敷箱, tens 電療儀(干擾波/TENS), traction 頸腰椎牽引機(1x2), ir_lamp 紅外線燈, bed 治療床(1x2)` (facility, 物理治療區);
`redcord 懸吊系統(2x2), shockwave_room 震波治療室(2x2), laser_room 高能量雷射室(2x2), manual_room 徒手治療獨立診間(2x2)` (facility, 運動與自費治療區);
`si_room 感覺統合教室(3x3, 含球池平衡木), fine_table 精細動作訓練桌(2x1), speech_room 語言治療室(2x2)` (facility, 職能與小兒早療區);
`shockwave 震波儀, coffee 咖啡機, ball_pit 感統球池(2x2), soft_mat 防撞軟墊(2x1, blocks:false), bookshelf 兒童繪本架` (special, sub 特殊).
Starting-available (requires:null): floors, sofa, water, tv, plant, sign, reception, exam_room, rest_room, heatbox, tens, traction, ir_lamp, bed, coffee. Everything else is unlocked by research (H3 research nodes must cover every `requires` value used here; coordinate through ids listed in §3.1 research below).

**`treatments.js`** → `export const TREATMENTS = { [id]: T }`
```js
T = {
  id, name,
  kind: 'nhi' | 'self',
  objects: [buildableId],         // ANY-of: patient must stand on a walkable tile adjacent to one of these (free) objects
  staffRole: null | [role],       // ANY-of staff roles needed to be adjacent too; null = self-service
  duration,                       // game minutes (30..90; visible on screen ~2-6 real sec)
  nhiPoints,                      // for kind 'nhi': LISTED NHI points per claim (from data/fees.js; what is paid follows the single-claim rule + exam tiers), 95..500
  price,                          // for kind 'self': REAL NT$ per session (fees.js typical; policy.priceMult scales it 0.5..2.0; x PATIENT_WEIGHT when banked), 1700..17000
  points: { medical, device, service },   // base points produced per session
  staminaCost,                    // staff stamina per session (manual therapy high)
  requires: null | researchNodeId,
  cure: number,                   // 0..1 contribution to patient recovery when completed
  intro: '一句話'
}
```
Required ids: `exam 門診看診(exam_room; doctor; nhi)`, `us 超音波(us_room; doctor; nhi)`, `heat 熱敷(heatbox; null; nhi)`, `tens 電療(tens; null; nhi)`, `traction 牽引(traction; null; nhi)`, `ir 紅外線(ir_lamp; null; nhi)`, `taping 貼紮(bed; pt; nhi)`, `manual_nhi 健保徒手(bed; pt; nhi; high stamina)`, `redcord 懸吊運動治療(redcord; pt; self)`, `shockwave 體外震波(shockwave|shockwave_room; doctor|pt; self)`, `laser 高能量雷射(laser_room; pt|doctor; self)`, `manual_self 自費徒手(manual_room; pt; self)`, `prp PRP增生療法(exam_room; doctor; self; requires research)`, `insole 客製化鞋墊(bed; pt; self; requires research)`, `si 感覺統合(si_room; ot; nhi)`, `fine 精細動作訓練(fine_table; ot; nhi)`, `speech 語言治療(speech_room; st; nhi)`.

**`patients.js`** → `export const PATIENT_TYPES = { [id]: P }`, `export const FOCUS = { ortho, ltc, peds }`
```js
P = {
  id: 'elder'|'office'|'sports'|'kid', name,
  weight,                          // base share of arrivals
  spawn: [{ from, to, w }],        // clock windows in minutes since midnight with relative weight (elder: morning; office: lunch 12:00-14:00 & 17:30-20:00; sports: afternoon/evening; kid: afternoon after school)
  speed,                           // walk multiplier (elder 0.6, kid 1.2 ...)
  patience,                        // base patience 0..100 (drops while waiting)
  needsRamp: boolean,              // elders/wheelchair: walkMult & slip risk matters
  slipProne: number,               // multiplier on slip risk on bad floors/rain
  selfPay: number,                 // 0..1 base willingness to accept self-pay upgrade
  chatty: number,                  // 0..1 likelihood to seek a chat with an idle therapist (affinity boosts satisfaction)
  plans: [{ w, steps: [treatmentId], selfPaySteps?: [treatmentId] }],
  // steps run in order; selfPaySteps are optional upsell steps offered after 'exam' (or first step) if player has them unlocked & built
  cureNeeded: number,              // total `cure` to recover (then counts as 治癒)
  visitsToCure: [min,max],         // typical number of visits (patients can return later: optional)
  palette: { skin, hair, shirt, pants },  // for sprite
  reputationGain: number,          // reputation bonus when satisfied & cured (sports: high)
  pointBias: { medical, device, service }, // multipliers on points they generate (kid: high medical+service)
  needsDoctorSkip: number          // 0..1 chance of 「只想做電療不想看醫生」 dilemma (elder high)
}
FOCUS = { ortho: {name, spawnMult:{elder,office,sports,kid}}, ltc:{...}, peds:{...} }
```

**`staffdefs.js`** → `export const STAFF_ROLES = { [role]: {name, baseSalary, hireCost, color, skillRange:[a,b], staminaMax, desc} }`, `export const STAFF_NAMES = { surnames:[...], given:[...] }` (台灣常見姓名), `export const TRAITS = [{id,name,desc,mods:{skill?,charm?,staminaMax?}}]` (e.g. 親切、細心、體力好、研究魂…).

**`synergies.js`** → `export const SYNERGIES = [{ id, name, icon, needs:[defId,...], effects:{...mods patch}, desc }]`
Adjacency rule (implemented by S-B `synergy.js`): two objects are *adjacent* if the Chebyshev distance between their footprints is ≤ 1 (touching, diagonal ok). A zone is active when a connected component of adjacent objects contains every defId in `needs` (multiple copies fine). Three required zones:
* `golden3` 黃金三寶區: heatbox+tens+traction → `{nhiTurnover:+0.2, elderSat:+8}` (健保翻桌率 +20%, 長輩滿意度)
* `premium` 高階自費專區: manual_room+shockwave+coffee → `{selfPayConv:+0.15, selfPayPrice:+0.1}`
* `kidpark` 早療放電樂園: ball_pit+soft_mat+bookshelf → `{researchGain:+0.25}` (applies as multiplier 1.25 to points)
Effects use additive deltas on `defaultMods()` keys (`nhiTurnover` is a multiplier base 1 so +0.2 → 1.2; stacking zones add).

**`lots.js`** → `export const LOTS = [ {name, lot:{x0,y0,w,h}, door:{x,y}, rent, nhiCap, maxPatientsPerWeek, maxStaff, expandCost, requires:{minReputation, minYear, minStaff, minAvgSat, needRamp?, minSeats?, ...}} ]`
Nested lots, same bottom edge, door.y = lot.y0+lot.h, door.x = 15 for all:
L0 `巷弄小診所` {x0:10,y0:10,w:12,h:10}; L1 `社區診所` {x0:9,y0:8,w:14,h:12}; L2 `地區復健中心` {x0:8,y0:6,w:16,h:14}; L3 `全台頂尖復健中心` {x0:6,y0:4,w:20,h:16}.

**`research.js`** → `export const RESEARCH = { [id]: Node }`, `export const RESEARCH_TRACKS`
```js
Node = { id, name, track:'medical'|'device'|'service', cost, weeks, requires:[nodeId], desc,
         effects:[ {type:'unlockBuild', ids:[...]}, {type:'unlockTreatment', ids:[...]},
                   {type:'mod', key:'selfPayConv', op:'add'|'mul', value:n}, {type:'maxStaff', n}, {type:'rep', value:n} ] }
```
~18-24 nodes. Must unlock every locked buildable/treatment: PRP, insole, shockwave(+room+device), laser_room, manual_room, redcord, us_room, si_room, fine_table, speech_room, ball_pit, soft_mat, bookshelf, ramp-related admin, 行政效率 (wageMult/rentMult? no: `walkSpeed`, `patience`, queue), 聲譽 (`rep`), expansion unlock helpers. Costs in the single point type of the track (30–600).

**`events.js`** → exports:
* `WEATHER = [{ kind, name, icon, months:[1..12], weight, tempRange:[a,b], mods:{...patch}, typeBoost:{elder:1.4,...}, slip:number, news:'一句話' }]` — 寒流 (cold: months 12,1,2, elder +60% arthritis surge), 雨天 (rain: slip risk up), 梅雨, 颱風 (typhoon: spawnMult 0.4), 炎熱 etc.
* `RANDOM_EVENTS = [{ id, title, text, weight, cond:{minYear?, minRep?}, choices:[{label, effects:{money?, reputation?, points?:{}, sat?}, result}] }]` — 台灣在地: 里長邀約、健保署抽審、媒體採訪、員工離職挖角、廠商促銷、颱風淹水…
* `COMMUNITY = [{ id, name, desc, cost, durationWeeks, effects:{spawn:{elder:+..}, reputation, points}, cooldownWeeks }]` — 宮廟/活動中心肌少症篩檢、社區衛教講座、里民健走、校園脊椎側彎篩檢…
* `DILEMMAS = [{ id, trigger:'painkiller'|'skip_doctor'|'overtreat'|'complain'..., title, text, choices:[{label, effects:{sat?, reputation?, money?, points?:{}, nhiPenalty?}, result}] }]` — 「直接開止痛藥」「只想做電療不想看醫生」…
* `BOARDS = [{ id, name, cost, upkeep, effects:{...mods patch}, desc }]` 衛教看板.
* `POLICY_TEXT` short labels for 長照/骨科/早療 focus.

**`texts.js`** → `export const LINES = { [patientTypeId]: { arrive:[], wait:[], angry:[], happy:[], treat:[], chat:[], slip:[], pay:[] } , staff: { work:[], tired:[], chat:[] } }`, `export const TIPS = [...]`, `export const TITLES = [{minRep,title}]` (院長稱號), `export const INTRO_STEPS = [...]` (new-game hints), 台灣口吻 (「欸醫生我這個肩膀…」「今天好冷喔」)。 ≥ 8 lines per key.

### 3.2 Runtime entity shapes (all in `state`)

```js
Object  = { id, defId, x, y, rot:0|1, busy:false, usedBy:null|patientId, staffId:null|staffId, wear:0 }
Staff   = { id, role, name, skill:1..10, charm:1..10, stamina, staminaMax, salary, trait:traitId|null, level:1,
            x, y, path:[{x,y}], state:'idle'|'walking'|'working'|'resting'|'chatting', task:null|{patientId, objId, treatmentId, remaining}, wait:0 }
Patient = { id, type, name, x, y, path:[], stage, plan:[treatmentId], planIdx:0, upsold:false,
            patience, satisfaction, hp:0, cured:false, bubble:null|{text, ttl}, targetObj:null, staffId:null,
            seat:null|{x,y}, enteredAt, waitedMin:0, paid:{nhi:0, self:0}, flags:{ slipped:false, skipDoc:false } }
// stage: 'arriving'(entering from door) -> 'to_reception' -> 'registering' -> 'waiting'(seated or standing) ->
//        'to_station' -> 'treating' -> (next step: 'waiting') ... -> 'leaving' -> removed
// x,y are FLOAT tile coordinates (tile centre = integer + 0.5? NO: x,y integer = tile top corner; agents sit at x+0.5,y+0.5 when rendered).
```
Float coordinate convention: agent `x,y` are floats in *tile units where tile (i,j) covers [i,i+1)×[j,j+1)*; an agent standing centered on tile (i,j) has x=i+0.5, y=j+0.5. Pathfinding returns integer tiles; agents walk toward `tile+0.5`.

## 4. Module APIs (exact signatures)

All `state`-taking functions mutate the passed `state` object. `dtMin` = game minutes.

### sim/pathfinding.js (S-A)
`findPath(state, sx, sy, tx, ty) -> [{x,y}] | null` (4-neighbour A*, integer tiles, excludes start, uses `grid.isWalkable`; floors with `walkMult` are NOT in the cost).
`findPathToAdjacent(state, sx, sy, obj) -> {path:[{x,y}], stand:{x,y}} | null` (nearest free adjacent tile of obj).
`invalidatePathCache()`; paths stored on agents are re-validated when `ui.dirtyOcc` changes occupancy (agents recompute).

### sim/patients.js (S-A)
`updatePatients(state, dtMin)` — spawn arrivals per §2, run the state machine, movement, queueing, waiting-seat assignment (sofa seats, else stand), treatment assignment (needs free station object AND free qualified staff adjacent), satisfaction/patience, slip, chat, bubbles (`say(p, key)` using `LINES`), leaving. Must never deadlock (e.g. if no nurse exists patients self-register slowly; if a needed station/staff type doesn't exist the step is skipped/replaced and the patient gets a complaint bubble). Max ~60 simultaneous patients.
`closeUp(state)` — on week end: everyone not done → `leaving`.
`spawnPatient(state, typeId) -> patient`
Emits (see §6): `patient:spawn`, `treatment:done`, `patient:left`, `patient:slip`, `dilemma:request`.
Awards points on each completed treatment: `state.points[k] += T.points[k] × P.pointBias[k] × staffSkillFactor × mods.researchGain`.
Reputation/stat updates on leaving: `state.reputation += ...`, `state.stats.*`.

### sim/staff.js (S-A)
`updateStaff(state, dtMin)` — idle wandering near workstation, stamina drain/regen, going to `rest_room` when stamina ≤ 15% (and returning at ≥ 80%; with no rest_room: slow regen while idle), chatting.
`refreshPool(state)` — fill `state.hirePool` with 3-5 candidates `{cid, role, name, skill, charm, salary, hireCost, trait}` (called on game start and each month).
`hire(state, cid) -> staff|null` (checks money, `lotDef.maxStaff`, spawns at door), `fire(state, staffId) -> bool`, `train(state, staffId) -> bool` (costs NT$ + service points, +skill),
`salaryOf(staff) -> number`, `staffCount(state, role) -> number`.

### sim/calendar.js (S-B)
`advanceClock(state, dtMin)` — advances `time.clock`; on `CLOSE_MIN` emits `week:end` then rolls week/month/year and emits `week:start` (+`month:end`/`month:start`/`year:end`/`year:start` as applicable) and resets clock to `OPEN_MIN`. `main.js` just calls it each step. `formatDate(state) -> '第1年 3月 第2週'`, `formatClock(state) -> '09:30'`.

### sim/economy.js (S-B)
`initEconomy()` (bus subscriptions: `treatment:done`, `week:end`, `month:end`), `spend(state, amount, category) -> bool` (refuses if money < amount; category in ledger.expense keys), `earn(state, amount, category)`, `settleMonth(state)` (see §2; returns the settlement record, emits `nhi:settled`), `getPointValue(state) -> number` (projected current month), `monthlyCosts(state) -> {salary, rent, maintain}`.
Economy also handles `treatment:done`: NHI → `state.nhi.weekPoints/monthPoints += nhiPoints` (points actually paid); self-pay → `earn(selfPay × PATIENT_WEIGHT, 'self')`; copay → `earn(copay × PATIENT_WEIGHT, 'copay')`.

### sim/build.js (S-B)
`isUnlocked(state, defId) -> bool` · `canPlace(state, defId, x, y, rot) -> {ok, reason}` (inside lot, free cells, not the entry tile, unlocked, affordable; floors: just inside lot & affordable) · `placeObject(state, defId, x, y, rot) -> obj|null` · `paintFloor(state, floorId, x, y) -> bool` · `removeAt(state, x, y) -> bool` (object topmost first, else floor; refund 50%; also frees any agent using it) · `moveObject?` not required · `seedStarterClinic(state)` · `placementCost(defId)`.
Every successful change sets `ui.dirtyOcc = true` and emits `map:changed`.

`relocationCost(defId)` (= max(500, 10% of build cost), category 'build') · `canMove(state, objId, x, y, rot) -> {ok, reason, fee}` · `moveObject(state, objId, x, y, rot) -> bool` (keeps id/wear, releases users, recomputes zones/mods, emits `map:changed` + `object:moved {id}`) · `rotateObject(state, objId) -> bool` (free). UI: 「移動」tool (`ui.tool.mode='move'`, key **M**; 地圖 panel hotkey is **P**), touch long-press menu → 移動/旋轉.

### sim/synergy.js · sim/modifiers.js (S-B)
`recomputeZones(state)` → fills `state.zones` (see §3.1 synergies) · `recomputeMods(state)` → `state.mods = defaultMods()` then applies, in order: active synergy zones, completed research `mod` effects, current weather mods, active events/community effects, enabled health boards, policy focus, environment comfort. Also exposes `comfortScoreAt(state, x, y) -> number` and `floorGripAt(state, x, y) -> number` used by patients.js (safe to import from `sim/modifiers.js`).

### sim/research.js (S-B)
`isDone(state, id)`, `canStart(state, id) -> {ok, reason}`, `start(state, id) -> bool` (pays points immediately; takes `weeks` weeks; one at a time), `progressInfo(state)`, `list(state) -> [{node, status:'locked'|'available'|'current'|'done'}]`; listens `week:end` to progress; on done applies unlocks (computed on demand from `state.research.done`, not stored), emits `research:done`.
Also `isTreatmentUnlocked(state, treatmentId) -> bool` (used by patients.js). Also export `initResearch()` (registers bus listeners; called once by main.js).

### sim/events.js (S-B)
`initEvents()`; at `week:start` roll weather (`state.weather`), maybe a random event (modal via `dilemma:show`/`event:show`); `startCommunity(state, id) -> {ok, reason}`; `communityList(state)`; `setBoard(state, id, on) -> bool`; `setFocus(state, focus)`; `setPriceMult(state, treatmentId, mult)`; `resolveDilemma(state, choiceIndex)`; listens `dilemma:request` (from patients) and `patient:slip`. Maintains `state.events.active` entries `{id, kind, weeksLeft, mods}`; calls `recomputeMods` when they change.

### sim/inspection.js (S-B)
On `year:end`: 衛生局督導 + 健保署抽查 → score from layout/staff/satisfaction (hasRamp, seats, staff counts, avg satisfaction, point-value abuse) → `state.inspections.lastYearResult`, reputation bonus/penalty/fine, emits `inspection:result`. `canExpand(state) -> {ok, missing:[string]}`, `expand(state) -> bool` (pays `expandCost`, sets `lotLevel`, `lot`, `door`, emits `map:changed` + `lot:expanded`). Expansion needs the `requires` conditions in `LOTS`.

`initInspection()` is also exported (registers the `year:end` listener; called once by main.js).

### sim/save.js (S-B)
`saveGame(state, slot='auto') -> bool` (localStorage key `SAVE_KEY_PREFIX+slot`, strips `map.occ`), `loadGame(state, slot='auto') -> bool` (uses `replaceState`, sets `ui.dirtyOcc=true`, emits `state:loaded`), `listSaves() -> [{slot, label, savedAt}]`, `deleteSave(slot)`, `exportSave(state) -> string`, `importSave(state, str) -> bool`, `newGame(state)` (replace with `createInitialState()`, seed starter clinic, refresh pool, emit `state:loaded`). Wrap storage access in try/catch.

### render/* (S-C)
* `iso.js`: `gridToScreen(gx, gy) -> {x,y}` (diamond top corner of tile at zoom 1, world space), `screenToGrid(sx, sy, cam) -> {x:float, y:float}`, `tileAt(sx, sy, cam) -> {x,y}`; constants from `core/constants.js`.
* `camera.js`: `initCamera(canvas)`, `centerOnLot(state, canvas)`, `clampCam(...)`, zoom 0.5..2.5 about cursor, pan with right-drag (also middle drag / space+drag), **never** consume left clicks.
* `sprites.js`: `getObjectSprite(defId, rot) -> HTMLCanvasElement` (cached; iso box with top/left/right shading from def.color/top/height/glyph; special-case nicer drawings for sofa, heatbox, tens, traction, bed, reception, plant, tv, coffee, ball_pit, rooms with partition walls), `getFloorSprite(floorId)`, `getGroundSprite(kind)` (street/lot ground/grass/wall), `getPersonSprite(kind, dir, frame, opts) -> canvas` where kind is a patient type id or staff role (doctor white coat, pt blue, ot green, st purple, nurse pink), 4 directions × 2-3 walk frames + sit/work poses, `getIconSprite(name)` for status icons (💢 💤 ❤ 💰 ⚠).
* `renderer.js`: `initRenderer(canvas)`, `render(state, ui, nowMs)` draws: street + lot ground + building walls/door, floor tiles, grid overlay (ui.showGrid), objects and people depth-sorted by (x+y), selection highlight, placement ghost (green/red) from `ui.tool` + `ui.hover`, speech bubbles from `patient.bubble`, progress bars over treating pairs, weather overlay (rain, cold tint, typhoon), day/evening tint by clock, zone glow outlines for active `state.zones`. Must stay 60fps with 60 agents (cache sprites, avoid per-frame allocation).
* `input.js`: `initInput(canvas, state, ui)`: updates `ui.hover` (tile + `valid` from `build.canPlace`); left click per `ui.tool.mode`: `place` → `placeObject` (repeat placing allowed; hold Shift keeps tool), `paint` → drag-paints floors, `demolish` → `removeAt`, `none` → select topmost patient/staff/object under cursor into `ui.selected` and emit `select:changed`; `R` or mouse wheel+Alt rotates (`ui.tool.rot ^= 1`), `Esc` cancels tool/closes panel via `bus.emit('ui:escape')`, `G` toggles grid, space = pause toggle, `1/2/3` speeds. Touch/mouse parity is nice-to-have.

### ui/* (S-D)
`ui/ui.js`: `initUI(state, ui)`, `updateUI(state, ui)` (called each frame; DOM updates throttled to ~5 Hz or on events; don't rebuild DOM that hasn't changed). `ui/modal.js`: `showModal({title, body:string|Node, buttons:[{label, primary?, onClick}], dismissable?})`, `closeModal()`. `ui/toast.js`: listens `toast` bus event `{text, kind:'info'|'good'|'bad'}`. `ui/tooltip.js`: hover tooltips for sidebar items & build items (name, cost, upkeep, desc, requires).
DOM mount points (already in `index.html`): `#topbar #stage #game #sidebar #panel #speedbar #toast-layer #tooltip #modal-root`.
* **Topbar**: left `第 X 年 X 月 X 週` + clock + weather icon/name/temp (+ clinic name); right `NT$` money, 醫術/儀器/服務 points (with icons), reputation, current NHI point value. Money changes flash green/red.
* **Sidebar** (vertical icon buttons on the left or right edge of `#stage`, pixel style): 建造 運作 診所 一覽 地圖 系統 → toggles `ui.panel`.
* **建造 panel**: category tabs 環境/設施/特殊 → sub tabs → grid of item cards (name, price, glyph, locked state with requirement text); clicking an item sets `ui.tool={mode:'place'|'paint', defId, rot:0}`; plus a 「拆除」 toggle and rotate button; shows `Shift 連續放置`.
* **運作 panel** tabs: 研發 (3 tracks tree-list; start research; progress), 自費定價 (sliders per self-pay treatment with live estimated income & conversion hint), 社區衛教 (community actions, board cooldowns/costs).
* **診所 panel**: 經營方針 (長照/骨科/早療 radio with effects text), 衛教看板管理 (toggle boards), 擴建 (requirements checklist + 擴建 button via `inspection.canExpand/expand`), 院長稱號.
* **一覽 panel** tabs: 病患病歷 (list of current patients: type, stage, satisfaction, plan progress; click to select/track), 員工清單 (+ 招聘 hire pool, 解僱, 訓練, stamina/skill/charm bars), 設備維護表 (objects list with wear/upkeep, sellable), 專區組合辭典 (all synergies, required buildables, whether currently active, how-to hints).
* **地圖 panel**: minimap of the lot (canvas) with flow heat (where patients wait/linger, traced per tile in `state`-independent cache) + 周邊客群熱點 (static colored district hints: 住宅區老人、辦公大樓、學校球場、托兒所 with arrival share bars driven by `FOCUS`/community).
* **系統 panel**: 存檔/讀檔 (3 slots + 自動存檔), 匯出/匯入 JSON, 設定 (grid, sound toggle placeholder, speed default), 營運數據圖表 (canvas line/bar chart of `state.history`: 收入/支出/資金/病患數/滿意度/聲譽), 新遊戲.
* Modals: month settlement report (on `nhi:settled`), inspection result (`inspection:result`), random event & dilemma (`dilemma:show` / `event:show`, call `events.resolveDilemma`), game over, intro tutorial (first launch).
* `#speedbar` (bottom-right of stage): ⏸ ×1 ×2 ×3 and an 「⏩ 跳過本週」 optional.
* CSS: base look in `css/style.css` (H4) — use its classes (`.btn .btn.primary .btn.danger .panel-title .tabs .tab .tab.active .card .card.locked .grid .row .stat .badge .bar > i .modal .modal-body .modal-actions .toast.good/.bad/.info .tag .muted .good .bad .sidebar-btn .sidebar-btn.active`). Put anything extra in `css/ui.css` (S-D owns).

## 5. Visual spec (S-C)
Tile diamond 64×32 (`TILE_W`,`TILE_H`); object `height` px extruded upward; world origin so lot is centred initially. Palette: warm clinic whites/teal/wood, outdoor street grey with crosswalk + street trees; lot has building outer walls on top/left edges drawn at height 40 with door gap at `state.door.x`; interior floor default light tile if no floor painted. Weather tints. Pixel style: `image-rendering: pixelated` on canvas, sprites pre-rendered at 1× and drawn scaled by camera zoom with smoothing off.

## 6. Bus events (name → payload)

| event | payload | emitted by |
|---|---|---|
| `toast` | `{text, kind}` | anyone |
| `week:start` / `week:end` | `{year,month,week}` | calendar |
| `month:start` / `month:end` | `{year,month}` | calendar |
| `year:start` / `year:end` | `{year}` | calendar |
| `map:changed` | `{}` | build, inspection |
| `mods:dirty` | `{}` | research, events, policy changes → main recomputes mods |
| `patient:spawn` | `{patient}` | patients |
| `treatment:done` | `{patient, treatmentId, nhiPoints (paid), nhiListed, nhiGroup, singleClaim, selfPay (real NT$), copay (real NT$), staffId}` | patients |
| `patient:left` | `{patient, satisfaction, cured, reason}` | patients |
| `patient:slip` | `{patient}` | patients |
| `dilemma:request` | `{patientId, trigger}` | patients (trigger: `painkiller`/`skip_doctor`/`overtreat`/`complain`) |
| `dilemma:show` / `event:show` | `{dilemma|event}` (state.events.pendingDilemma) | events |
| `nhi:settled` | `{points, pointValue, basePointValue, patientWeight, income, expense, net, nhiIncome, selfIncome, copayIncome, otherIncome, diluted, …}` | economy |
| `research:done` | `{id}` | research |
| `inspection:result` | `{pass, score, notes[], rewardOrFine}` | inspection |
| `lot:expanded` | `{level}` | inspection |
| `state:loaded` | `{}` | save |
| `game:over` | `{reason}` | economy |
| `select:changed` | `{selected}` | input |
| `ui:escape` | `{}` | input |
| `speed:set` | `{speed}` | ui / input → main |

## 7. Definition of done
* `python3 -m http.server` → open `index.html` → starter clinic visible, patients walk in, register, wait, get treated, pay, leave; week/month rolls; month report modal; build/demolish works; save/load works; no console errors for 10 minutes at ×3 speed; 60 fps-ish with ~40 agents.
* Every PRD feature in the vertical slice is reachable from the UI. Everything in this doc is implemented or explicitly listed as deferred in the agent's report.

## 美術包（概念圖圖集）
- 素材：`assets/art/atlas.png` + `atlas.json`（79 個去背素材，由 `tools/build_atlas.py` 從使用者提供的概念圖切出；原圖在 `assets/art/source/`，不隨網站部署）。命名見 `assets/art/README.md`。
- `js/render/art.js`：`loadArt() / artReady() / artRect(name) / artCanvas(name) / artUrl() / artEnabled() / setArtEnabled(on)`；事件 `art:changed {enabled, ready}`。設定存 `localStorage 'ptgame.art'`（預設新美術；可切回「原像素風」）。圖集載入失敗時全部退回程式繪製。
- 地圖：人物（醫師/護理師/PT/OT；ST 用 `staff.pharmacist`；四類病患）與設備（bed、traction、tens、soft_mat、shockwave）使用圖集。介面：`js/ui/artdom.js`（`artEl`、`artBanner`）。測試：`tools/arttest.mjs`、`tools/artui.mjs`（各用自己的 http.server 連接埠，見檔頭）。

### 概念風格（整體統一，見 docs/ART_STYLE.md）
- 啟用條件 = `artEnabled()`（設定「美術風格」＝新美術；預設）。切回「原像素風」＝改版前的畫面與介面，逐像素一致（已用 64 張畫布與 152 張介面截圖雜湊驗證）。
- 世界：`js/render/concept_objects.js`（24 種道具、3 種地板、`conceptThumb`）、`concept_scene.js`（地面、牆窗、招牌、建築、樹、車、疊加層、狀態圖示）；人物與 5 件設備來自圖集；語言治療師為合成精靈 `staff.st`（`artStaffCanvas/artStaffUrl`）。
- 介面：所有規則都在 `html.style-concept` 底下（style/ui/mobile.css 末段）；`js/ui/theme.js`（同步 class 與 theme-color）、`js/ui/icons.js`（SVG 圖示）。測試：`tools/stylecss.mjs`（連接埠 8212）。
