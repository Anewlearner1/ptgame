// Concrete modals: month report, inspection, events & dilemmas, game over, tutorial, help.
import { bus } from '../core/bus.js';
import { ctx } from './ctx.js';
import { h } from './dom.js';
import { artEl, artBanner } from './artdom.js';
import { fmt, money, signed, effectChips } from './fmt.js';
import { showModal, closeModal } from './modal.js';
import { LOTS } from '../data/lots.js';
import { DILEMMAS, RANDOM_EVENTS } from '../data/events.js';
import { INTRO_STEPS } from '../data/texts.js';
import { monthlyCosts, PATIENT_WEIGHT, PV_BASE } from '../sim/economy.js';
import { SINGLE_CLAIM_NOTE, COPAY_NTD } from '../data/fees.js';
import { resolveDilemma, eventById, choiceAffordable } from '../sim/events.js';
import { newGame, loadGame, listSaves } from '../sim/save.js';

// ---- ledger snapshot: the ledger is reset inside settleMonth, so keep the last pre-reset copy ----
const snap = { income: {}, expense: {}, year: 1, month: 1 };
export function snapshotLedger(state) {
  const l = state.ledger;
  if (!l) return;
  snap.income = { ...l.income };
  snap.expense = { ...l.expense };
  snap.year = state.time.year; snap.month = state.time.month;
}

function chips(list) {
  return h('div', { class: 'u-chips' }, list.map(c => h('span', { class: 'tag u-chip ' + (c.good ? 'good' : 'bad') }, c.text)));
}
function kv(label, value, cls) {
  return h('div', { class: 'u-kvrow' }, h('span', null, label), h('b', { class: cls || '' }, value));
}

// ---------------------------------------------------------------- month settlement
export function showSettlement(p) {
  const state = ctx.state;
  const lot = LOTS[state.lotLevel || 0] || LOTS[0];
  const cap = Math.round(p.cap != null ? p.cap : lot.nhiCap * (1 + ((state.mods && state.mods.nhiCapBonus) || 0)));
  const pts = Math.round(p.points != null ? p.points : 0);
  const base = p.basePointValue != null ? p.basePointValue : PV_BASE;     // undiluted point value (real ~0.95)
  const weight = p.patientWeight != null ? p.patientWeight : PATIENT_WEIGHT;
  const pv = p.pointValue != null ? p.pointValue : base;
  const nhiIncome = p.nhiIncome != null ? p.nhiIncome : Math.round(pts * pv * weight);

  // Prefer the itemised record from economy.settleMonth; fall back to our pre-reset ledger snapshot.
  let costs = { salary: p.salary, rent: p.rent, maintain: p.maintain };
  if (costs.salary == null) { try { costs = monthlyCosts(state) || {}; } catch (e) { costs = {}; } }
  const self = p.selfIncome != null ? p.selfIncome : (snap.income.self || 0);
  const copay = p.copayIncome != null ? p.copayIncome : (snap.income.copay || 0);
  const other = p.otherIncome != null ? p.otherIncome : (snap.income.other || 0);
  const build = p.build != null ? p.build : (snap.expense.build || 0);
  const otherExp = p.otherExpense != null ? p.otherExpense : (snap.expense.other || 0);

  const inc = [['健保給付', nhiIncome], ['自費收入', self], ['部分負擔', copay]];
  if (other) inc.push(['其他收入（活動、事件）', other]);
  const exp = [['員工薪資', costs.salary || 0], ['診所房租', costs.rent || 0], ['設備與看板維護', costs.maintain || 0]];
  if (build) exp.push(['建設與購置', build]);
  if (otherExp) exp.push(['其他支出（訓練、招聘、活動）', otherExp]);

  const incTotal = typeof p.income === 'number' ? p.income : inc.reduce((a, r) => a + r[1], 0);
  const expTotal = typeof p.expense === 'number' ? p.expense : exp.reduce((a, r) => a + r[1], 0);
  const incSum = inc.reduce((a, r) => a + r[1], 0), expSum = exp.reduce((a, r) => a + r[1], 0);
  if (Math.abs(incTotal - incSum) >= 1) inc.push(['其他／未分類', incTotal - incSum]);
  if (Math.abs(expTotal - expSum) >= 1) exp.push(['其他／未分類', expTotal - expSum]);
  const net = typeof p.net === 'number' ? p.net : incTotal - expTotal;
  if (p.year) { snap.year = p.year; snap.month = p.month; }

  const diluted = p.diluted != null ? !!p.diluted : pv < base - 0.0005;
  const usage = cap > 0 ? pts / cap : 0;
  let explain;
  if (diluted) {
    const lost = Math.round(nhiIncome / pv * base - nhiIncome);
    explain = h('div', { class: 'u-note bad-note' },
      h('b', null, '⚠ 點值被稀釋了'),
      h('p', null, `本月健保申報 ${fmt(pts)} 點，超過${lot.name}的上限 ${fmt(cap)} 點（${Math.round(usage * 100)}%）。` +
        `超過上限後，點值 ＝ 上限 ÷ 申報點數 ＝ ${pv.toFixed(2)}（正常為 ${base.toFixed(2)}），而且這個折扣是套用在「全部」點數上。`),
      h('p', null, `${fmt(pts)} 點 × ${pv.toFixed(2)} × ${weight} ＝ ${money(nhiIncome)}，比點值 ${base.toFixed(2)} 時少收 ${money(lost)}。` +
        `多做的熱敷、電療不但不賺，還拖累原本的收入。`),
      h('p', { class: 'muted' }, '出路：發展自費項目（不受點值影響）、擴建提高上限，或調整接診結構。'));
  } else {
    explain = h('div', { class: 'u-note' },
      h('b', null, '點值正常'),
      h('p', null, `本月健保申報 ${fmt(pts)} 點，上限為 ${fmt(cap)} 點（使用率 ${Math.round(usage * 100)}%），點值維持 ${pv.toFixed(2)}。`),
      h('p', { class: 'muted' }, `申報超過上限時，點值會降到「上限 ÷ 申報點數」（最低 0.6），所有健保點數一起打折。${SINGLE_CLAIM_NOTE}，診察費也會隨當日看診人數遞減。`));
  }
  const footnote = h('p', { class: 'muted u-small' },
    `※ 每位模擬病患代表 ${weight} 位真實病患：上列健保給付、自費收入與部分負擔（每次回診 NT$ ${COPAY_NTD}）都已乘以 ${weight} 後入帳；薪資、房租與事件金額則為實際金額。`);

  const col = (title, rows, total, cls) => h('div', { class: 'u-col' },
    h('div', { class: 'u-sec' }, title),
    rows.map(r => kv(r[0], money(r[1]))),
    h('div', { class: 'u-kvrow u-total' }, h('span', null, '合計'), h('b', { class: cls }, money(total))));

  const body = h('div', { class: 'u-report' },
    h('div', { class: 'u-stats3' },
      h('div', { class: 'stat' }, h('span', null, '健保申報點數'), h('span', null, fmt(pts))),
      h('div', { class: 'stat' }, h('span', null, '本月點值'), h('span', { class: diluted ? 'bad' : 'good' }, pv.toFixed(2))),
      h('div', { class: 'stat' }, h('span', null, '本月淨利'), h('span', { class: net >= 0 ? 'good' : 'bad' }, signed(net)))),
    h('div', { class: 'u-two' }, col('收入', inc, incTotal, 'good'), col('支出', exp, expTotal, 'bad')),
    explain,
    h('div', { class: 'u-kvrow' }, h('span', null, '目前資金'), h('b', null, money(state.money))),
    footnote);

  showModal({
    title: h('span', null, artEl('role.record', { size: 28, fallback: '📊', cls: 'u-art-ico u-modal-ico', title: '營運報告' }), `${snap.year ? `第${snap.year}年 ${snap.month}月` : ''}營運報告`),
    body, cls: 'u-wide', tag: 'settle', buttons: [{ label: '繼續經營', primary: true }],
  });
}

// ---------------------------------------------------------------- inspection
export function showInspection(p) {
  const pass = !!p.pass;
  const rf = p.rewardOrFine;
  let rfNode = null;
  if (typeof rf === 'number' && rf !== 0) {
    rfNode = h('div', { class: 'u-kvrow' }, h('span', null, rf > 0 ? '獎勵' : '罰款'), h('b', { class: rf > 0 ? 'good' : 'bad' }, money(rf)));
  } else if (rf && typeof rf === 'object') {
    const c = effectChips(rf);
    if (c.length) rfNode = chips(c);
  }
  const body = h('div', null,
    h('div', { class: 'u-verdict ' + (pass ? 'good' : 'bad') }, pass ? '✅ 通過督導' : '❌ 未通過督導'),
    h('div', { class: 'u-kvrow' }, h('span', null, '評分'), h('b', null, `${Math.round(p.score || 0)} 分`)),
    rfNode,
    h('div', { class: 'u-sec' }, '督導意見'),
    h('ul', { class: 'u-list' }, (p.notes && p.notes.length ? p.notes : ['無特別意見']).map(n => h('li', null, String(n)))));
  showModal({ title: h('span', null, artEl('role.assess', { size: 28, fallback: '🏛', cls: 'u-art-ico u-modal-ico', title: '督導' }), '年度督導與健保署抽查'), body, tag: 'inspection', buttons: [{ label: '收到', primary: true }] });
}

// ---------------------------------------------------------------- events & dilemmas
let shownKey = null;
export function resetPendingKey() { shownKey = null; }

function resolveDef(d) {
  if (!d) return null;
  if (d.choices) return d;
  const def = eventById(d.id) || DILEMMAS.concat(RANDOM_EVENTS).find(x => x.id === d.id);
  return def ? { ...def, ...d } : d;
}

export function showPending(raw) {
  const state = ctx.state;
  const d = resolveDef(raw || state.events.pendingDilemma);
  if (!d || !d.choices) return;
  const key = (d.id || d.title) + '|' + (d.patientId || '');
  if (shownKey === key) return;
  shownKey = key;
  const isDilemma = !!d.trigger || DILEMMAS.some(x => x.id === d.id);
  const list = h('div', { class: 'u-choices' });
  d.choices.forEach((c, i) => {
    const poor = !choiceAffordable(state, c);
    const note = [];
    if (c.chance) note.push(h('span', { class: 'tag u-odds', tip: '擲骰決定結果：成功與失敗的後果不同' }, `成功率 ${Math.round((c.chance.p || 0) * 100)}%`));
    if (c.requires && c.requires.money) note.push(h('span', { class: 'tag u-costnote' + (poor ? ' lack' : '') }, `需 ${money(c.requires.money)}`));
    list.appendChild(h('button', {
      class: 'btn u-choice' + (c.chance ? ' u-chance' : '') + (poor ? ' u-poor' : ''), type: 'button', disabled: poor,
      onclick: () => choose(d, i),
    }, h('span', { class: 'kbd' }, String(i + 1)), h('span', { class: 'u-choice-main' }, (c.chance ? '🎲 ' : '') + c.label), note.length ? h('span', { class: 'u-choice-note' }, note) : null));
  });
  const body = h('div', null,
    h('div', { class: 'u-speaker' }, artEl('portrait.doctor', { size: 72, cls: 'u-art-tile u-art-portrait', title: '診所醫師' }), h('p', { class: 'u-p' }, d.text || '')), list);
  showModal({
    title: (isDilemma ? '🤔 兩難抉擇：' : '📰 事件：') + (d.title || ''),
    body, noActions: true, dismissable: false, pause: false, tag: 'dilemma',
    onKey: e => {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= d.choices.length && choiceAffordable(ctx.state, d.choices[n - 1])) { e.preventDefault(); choose(d, n - 1); }
    },
  });
}

function choose(d, i) {
  const state = ctx.state;
  const ch = d.choices[i];
  let out = null;
  try { out = resolveDilemma(state, i); } catch (e) { console.error(e); }
  if (!out) return;     // refused (not affordable / stale): keep the decision open
  shownKey = null;
  closeModal(true);
  // what really happened (a 🎲 option shows only the side that was rolled)
  const eff = out.chips && out.chips.length ? out.chips : effectChips(out.effects || ch.effects);
  const body = h('div', null,
    h('p', { class: 'u-p' }, h('b', null, `你選擇了：${ch.label}`)),
    out.roll ? h('p', { class: 'u-p ' + (out.roll === 'win' ? 'good' : 'bad') }, out.roll === 'win' ? '🎲 運氣不錯，成功了！' : '🎲 運氣不好，失敗了…') : null,
    h('p', { class: 'u-p' }, out.result || ch.result || ''),
    eff.length ? chips(eff) : null);
  showModal({ title: '📋 結果', body, tag: 'dilemma-result', buttons: [{ label: '好的', primary: true }] });
}

// ---------------------------------------------------------------- game over
export function showGameOver(p) {
  const state = ctx.state;
  const body = h('div', null,
    h('div', { class: 'u-verdict bad' }, '💸 診所倒閉了'),
    h('p', { class: 'u-p' }, p && p.reason ? p.reason : '資金見底，無力繼續經營。'),
    h('div', { class: 'u-kvrow' }, h('span', null, '經營時間'), h('b', null, `${state.time.year} 年 ${state.time.month} 月`)),
    h('div', { class: 'u-kvrow' }, h('span', null, '累計看診'), h('b', null, `${fmt(state.stats.patientsTotal)} 人`)),
    h('div', { class: 'u-kvrow' }, h('span', null, '治癒人數'), h('b', null, `${fmt(state.stats.cured)} 人`)),
    h('div', { class: 'u-kvrow' }, h('span', null, '最終聲譽'), h('b', null, fmt(state.reputation))));
  const buttons = [];
  let hasAuto = false;
  try { hasAuto = listSaves().some(s => s.slot === 'auto'); } catch (e) { /* ignore */ }
  if (hasAuto) buttons.push({ label: '讀取自動存檔', onClick: () => { loadGame(state, 'auto'); } });
  buttons.push({ label: '重新開業', primary: true, onClick: () => { newGame(state); } });
  showModal({ title: '遊戲結束', body, buttons, dismissable: false, tag: 'gameover', replace: true });
}

// ---------------------------------------------------------------- tutorial
export function showTutorial(force) {
  const state = ctx.state;
  let seen = false;
  try { seen = localStorage.getItem('ptgame.tutorialSeen') === '1'; } catch (e) { /* storage unavailable */ }
  if (!force && ((state.flags && state.flags.tutorialDone) || seen)) return;
  const steps = (INTRO_STEPS || []).map(s => typeof s === 'string' ? { title: '', text: s } : s);
  if (!steps.length) return;
  let i = 0;
  const textEl = h('p', { class: 'u-p u-intro-text' });
  const dots = h('div', { class: 'u-dots' });
  const head = h('div', { class: 'u-intro-head' });
  const body = h('div', null, artBanner('scene.clinic', { title: '診所一景' }), head, textEl, dots);
  function fill() {
    const s = steps[i];
    head.textContent = `${s.title ? s.title + '　' : ''}${i + 1} / ${steps.length}`;
    textEl.textContent = s.text || s.body || '';
    dots.replaceChildren(...steps.map((_, k) => h('i', { class: k === i ? 'on' : '' })));
  }
  fill();
  function done() {
    if (state.flags) state.flags.tutorialDone = true;
    try { localStorage.setItem('ptgame.tutorialSeen', '1'); } catch (e) { /* ignore */ }
  }
  let prevBtn, nextBtn;
  showModal({
    title: '🏥 新手導覽', body, tag: 'tutorial', pause: true, dismissable: true, onClose: done,
    buttons: [
      { label: '略過', onClick: () => { done(); } },
      { label: '上一步', onClick: (el) => { prevBtn = el; if (i > 0) { i--; fill(); syncBtns(); } return false; } },
      { label: '下一步', primary: true, onClick: (el) => { nextBtn = el; if (i < steps.length - 1) { i++; fill(); syncBtns(); return false; } done(); } },
    ],
    onShow: el => {
      const bs = el.querySelectorAll('.modal-actions .btn');
      prevBtn = bs[1]; nextBtn = bs[2];
      syncBtns();
    },
  });
  function syncBtns() {
    if (prevBtn) prevBtn.disabled = i === 0;
    if (nextBtn) nextBtn.textContent = i === steps.length - 1 ? '開始經營！' : '下一步';
  }
}

// ---------------------------------------------------------------- help
export function showHelp() {
  const keys = [
    ['左鍵', '放置／選取'], ['右鍵拖曳', '平移地圖'], ['滾輪', '縮放'],
    ['R', '旋轉建築'], ['M', '移動設備'], ['Shift', '連續放置'], ['G', '顯示／隱藏格線'],
    ['空白鍵', '暫停／繼續'], ['1 2 3', '切換速度'], ['Esc', '取消／關閉'],
    ['B', '建造'], ['O', '運作'], ['C', '診所'], ['V', '一覽'], ['P', '地圖'], ['Y', '系統'], ['?', '本說明'],
  ];
  const body = h('div', null,
    h('div', { class: 'u-keys' }, keys.map(k => h('div', { class: 'u-keyrow' }, h('span', { class: 'kbd' }, k[0]), h('span', null, k[1])))),
    h('p', { class: 'muted u-p' }, '小提醒：候診區要有沙發；熱敷、電療、牽引相鄰擺放有「黃金三寶區」加成；健保點數超過上限會稀釋點值。'));
  showModal({ title: '⌨ 操作說明', body, pause: false, tag: 'help', buttons: [{ label: '關閉', primary: true }] });
}

export function initModals() {
  bus.on('nhi:settled', p => showSettlement(p || {}));
  bus.on('inspection:result', p => showInspection(p || {}));
  bus.on('dilemma:show', p => showPending(p && (p.dilemma || p.event)));
  bus.on('event:show', p => showPending(p && (p.event || p.dilemma)));
  bus.on('game:over', p => showGameOver(p));
  bus.on('week:end', () => snapshotLedger(ctx.state));
  bus.on('state:loaded', () => { shownKey = null; });
}
