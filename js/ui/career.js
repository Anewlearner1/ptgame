// Career UI (docs/GOALS_AND_ENDING.md §2/§3/§5/§6/§8): 目標 tab builder, red dot, toasts, review / ending body builders.
// Everything is coded against the sim contract (js/sim/career.js); every call is guarded so a missing / stub sim never breaks the UI.
// Text tables (js/data/goals.js) are loaded lazily: the UI has its own Chinese fallbacks for every string.
import { bus } from '../core/bus.js';
import { ctx } from './ctx.js';
import * as CAR from '../sim/career.js';
import { LOTS } from '../data/lots.js';
import { TREATMENTS } from '../data/treatments.js';
import { h, setText, setClass, bar, setBar } from './dom.js';
import { fmt, money } from './fmt.js';

// ---------------------------------------------------------------- data tables (js/data/goals.js, loaded lazily)
let DATA = null;
import('../data/goals.js').then(m => { DATA = m; bus.emit('career:ui-data', {}); }).catch(() => { /* optional table */ });

export function careerData() { return DATA; }
// CAREER_TEXT lookup by dotted path ('yearReview.title'); fallback when the table / key is missing
export function ct(key, fallback) {
  let v = DATA && DATA.CAREER_TEXT;
  for (const k of String(key).split('.')) v = v && typeof v === 'object' ? v[k] : undefined;
  return typeof v === 'string' && v ? v : fallback;
}
export function tpl(key, fallback, vars) {
  let s = ct(key, fallback);
  for (const k of Object.keys(vars || {})) s = s.split('{' + k + '}').join(vars[k]);
  return s;
}
export const careerYears = () => (typeof CAR.CAREER_YEARS === 'number' ? CAR.CAREER_YEARS : 10);

function safe(fn, fb) { try { const v = fn(); return v === undefined ? fb : v; } catch (e) { return fb; } }

// ---------------------------------------------------------------- grades / dimensions
export const GRADE_KEYS = ['S', 'A', 'B', 'C', 'D'];
const GRADE_NAME = { S: '傑出', A: '優良', B: '穩健', C: '吃力', D: '艱困' };
export function gradeName(g) {
  const G = DATA && DATA.GRADES;
  const info = Array.isArray(G) ? G.find(x => x && x.grade === g) : (G && G[g]);
  const lab = info && typeof info === 'object' ? (info.label || info.name || info.title) : (typeof info === 'string' ? info : '');
  return typeof lab === 'string' && lab ? lab : (GRADE_NAME[g] || '');
}
export function gradeKey(g) { g = String(g || '').toUpperCase(); return GRADE_KEYS.includes(g) ? g : ''; }
// doctor mood by grade: S/A happy, B normal, C/D tired
export function gradeMood(g) { g = gradeKey(g); return g === 'S' || g === 'A' ? 'happy' : g === 'B' ? 'normal' : g ? 'tired' : 'normal'; }
export function gradeBadge(g, cls) {
  const k = gradeKey(g);
  return h('span', { class: 'u-grade ' + (k ? 'u-g-' + k : 'u-g-none') + (cls ? ' ' + cls : ''), dataset: { grade: k }, 'aria-label': k ? `評等 ${k}` : '尚無評等' }, k || '—');
}

export const DIM_KEYS = ['fin', 'rep', 'care', 'team', 'local'];
const DIM_FB = { fin: ['💰', '財務'], rep: ['📣', '聲譽'], care: ['❤️', '照護'], team: ['👥', '團隊'], local: ['🏘', '在地'] };
export function dimInfo(k) {
  const fb = DIM_FB[k] || ['', k];
  const raw = DATA && DATA.DIM_LABELS && DATA.DIM_LABELS[k];
  let emoji = fb[0], label = fb[1];
  if (typeof raw === 'string' && raw) {
    const m = raw.match(/^(\p{Extended_Pictographic}️?)\s*(.*)$/u);
    if (m) { emoji = m[1]; label = m[2] || label; } else label = raw;
  } else if (raw && typeof raw === 'object') {
    emoji = raw.emoji || raw.icon || emoji;
    label = raw.label || raw.name || label;
  }
  return { emoji, label };
}

// ---------------------------------------------------------------- number formatting
export function nv(v) {
  if (typeof v !== 'number' || !isFinite(v)) return v == null ? '—' : String(v);
  const a = Math.abs(v);
  if (a >= 1000) return fmt(v);
  if (a >= 100 || Number.isInteger(v)) return String(Math.round(v));
  return String(+v.toFixed(2));
}
const CMP = { '>=': '≥', '<=': '≤', '>': '>', '<': '<', '==': '＝', '=': '＝', '===': '＝', gte: '≥', lte: '≤', gt: '>', lt: '<', eq: '＝' };
export const cmpSym = c => CMP[c] || (typeof c === 'string' && c) || '≥';
// NT$ in the Taiwanese 萬 unit once it gets big ("NT$ 25 萬"), plain below 10,000
export function moneyShort(v) {
  const a = Math.abs(Math.round(v || 0));
  const body = a >= 10000 ? `NT$ ${+(a / 10000).toFixed(a >= 1000000 ? 0 : 1)} 萬` : 'NT$ ' + fmt(a);
  return (v < 0 ? '-' : '') + body;
}
const signedMoney = v => (v > 0 ? '+' : '') + moneyShort(v);
const signedNum = v => (v > 0 ? '+' : v < 0 ? '-' : '') + fmt(Math.abs(v));
// goal-condition value by the unit declared in GOAL_METRICS
export function metricText(key, v) {
  const m = DATA && DATA.GOAL_METRICS && DATA.GOAL_METRICS[key];
  const unit = m && m.unit;
  if (typeof v !== 'number') return nv(v);
  if (unit === 'NT$') return moneyShort(v);
  if (unit === '0/1') return v >= 1 ? '成立' : '未成立';
  if (unit === '%') return nv(v) + '%';
  if (unit && unit !== '點') return nv(v) + unit;
  return nv(v);
}

// review.stats keys -> label / formatter, in display order (the sim's keys: js/sim/career.js buildReview). Unknown keys are ignored.
// `low`: lower is better (delta colours flip); `money`: deltas shown in 萬.
const STAT_SLOTS = [
  { keys: ['moneyDelta', 'moneyChange', 'cashDelta', 'netProfit', 'net'], label: '資金變化', f: signedMoney, tone: true, money: true },
  { keys: ['patients', 'patientsYear', 'patientsServed', 'served'], label: '看診病患', f: v => fmt(v) + ' 人' },
  { keys: ['repDelta', 'reputationDelta', 'repChange'], label: '聲譽變化', f: signedNum, tone: true },
  { keys: ['cured', 'curedYear'], label: '治癒人數', f: v => fmt(v) + ' 人' },
  { keys: ['events', 'eventsHandled', 'eventCount'], label: '處理事件', f: v => fmt(v) + ' 件' },
  { keys: ['reputation', 'rep', 'repEnd'], label: '年底聲譽', f: fmt },
  { keys: ['income', 'revenue', 'yearIncome'], label: '全年營收', f: money, money: true },
  { keys: ['lot', 'lotName', 'lotLevel'], label: '診所規模', f: lotLabel, expanded: true },
  { keys: ['community', 'communityCount', 'outreach'], label: '社區活動', f: v => fmt(v) + ' 次' },
  { keys: ['research', 'researchDone'], label: '完成研發', f: v => fmt(v) + ' 項' },
  { keys: ['slip', 'slips', 'slipCount'], label: '滑倒事故', f: v => fmt(v) + ' 次', low: true },
  { keys: ['resign', 'resigns'], label: '員工離職', f: v => fmt(v) + ' 人', low: true },
  { keys: ['breakdown', 'breakdowns'], label: '設備故障', f: v => fmt(v) + ' 次', low: true },
  { keys: ['morale'], label: '平均士氣', f: v => nv(v) },
  { keys: ['avgSat', 'satisfaction', 'avgSatisfaction'], label: '平均滿意度', f: v => nv(v) },
  { keys: ['selfPayShare', 'selfShare'], label: '自費占比', f: v => (v <= 1 ? Math.round(v * 100) : Math.round(v)) + '%' },
];
function lotLabel(v) {
  if (typeof v === 'string' && !/^L?\d$/i.test(v)) return v;
  const i = typeof v === 'number' ? v : parseInt(String(v).replace(/\D/g, ''), 10);
  return (LOTS[i] && LOTS[i].name) || String(v);
}
// -> [{key,label,text,raw,numeric}]
export function statRows(stats, max = 99) {
  const out = [];
  if (!stats || typeof stats !== 'object') return out;
  for (const s of STAT_SLOTS) {
    const k = s.keys.find(x => stats[x] != null && (typeof stats[x] === 'number' ? isFinite(stats[x]) : typeof stats[x] === 'string'));
    if (!k) continue;
    const raw = stats[k];
    let text = s.f(raw);
    if (s.expanded && stats.expanded) text += ' ⬆';
    out.push({ key: k, label: s.label, text, raw, numeric: typeof raw === 'number' && !s.expanded, tone: !!s.tone, low: !!s.low, money: !!s.money });
    if (out.length >= max) break;
  }
  return out;
}

function deltaEl(cur, prev, { unit = '', cls = '', low = false, money: isMoney = false } = {}) {
  if (typeof cur !== 'number' || typeof prev !== 'number') return h('span', { class: 'u-dl u-dl-none' });
  const d = Math.round((cur - prev) * 100) / 100;
  if (!d) return h('span', { class: 'u-dl u-dl-eq' + (cls ? ' ' + cls : '') }, '＝');
  const ad = Math.abs(d);
  const body = isMoney ? moneyShort(ad).replace('NT$ ', '') : (ad >= 1000 ? fmt(ad) : nv(ad));
  const good = low ? d < 0 : d > 0;
  return h('span', { class: 'u-dl ' + (good ? 'u-dl-up' : 'u-dl-dn') + (cls ? ' ' + cls : ''), dataset: { dir: d > 0 ? 'up' : 'down' } }, (d > 0 ? '↑' : '↓') + body + unit);
}

// ---------------------------------------------------------------- review pieces (modal + 目標 tab)
function reviewLine(review) {
  if (review && typeof review.line === 'string' && review.line) return review.line;
  const L = DATA && DATA.GRADE_LINES && DATA.GRADE_LINES[gradeKey(review && review.grade)];
  const pick = a => (Array.isArray(a) && a.length ? String(a[(review.year || 0) % a.length]) : '');
  if (typeof L === 'string') return L;
  if (Array.isArray(L)) return pick(L);
  if (L && typeof L === 'object') return pick(L[review.strongest]) || pick(L[Object.keys(L)[0]]) || String(L.line || L.text || '');
  return '';
}
function reviewQuote(review) {
  const line = reviewLine(review);
  if (!line) return null;
  const q = quoteBox(line);
  if (review.weakLine) q.appendChild(h('div', { class: 'u-quote-w' }, '👉 ' + review.weakLine));
  return q;
}

// five dimension bars; strongest / weakest highlighted; delta vs the previous review
export function dimBars(review, prev) {
  const dims = (review && review.dims) || {};
  const keys = DIM_KEYS.filter(k => typeof dims[k] === 'number');
  const vals = keys.map(k => dims[k]);
  const hi = Math.max(...vals), lo = Math.min(...vals);
  const mixed = hi !== lo;
  const best = mixed ? keys.find(k => dims[k] === hi) : null, worst = mixed ? keys.find(k => dims[k] === lo) : null;
  const rows = keys.map(k => {
    const d = dimInfo(k), v = dims[k];
    const tone = v < 40 ? 'bad' : v < 60 ? 'warn' : '';
    const b = bar(v / 100, tone);
    return h('div', { class: 'u-dim' + (k === best ? ' best' : '') + (k === worst ? ' worst' : ''), dataset: { dim: k } },
      h('span', { class: 'u-dim-lab' }, h('span', { class: 'u-dim-emo' }, d.emoji), d.label),
      b,
      h('b', { class: 'u-dim-num' }, Math.round(v)),
      deltaEl(v, prev && prev.dims && prev.dims[k]));
  });
  const note = best && worst ? h('div', { class: 'u-small u-dim-note' },
    h('span', { class: 'good' }, tpl('yearReview.strongest', '最強面向：{dim}', { dim: `${dimInfo(best).emoji}${dimInfo(best).label}` })), '　',
    h('span', { class: 'u-warn' }, tpl('yearReview.weakest', '待加強：{dim}', { dim: `${dimInfo(worst).emoji}${dimInfo(worst).label}` }))) : null;
  return h('div', { class: 'u-dims' }, rows, note);
}

export function statGrid(review, prev, max = 9) {
  const rows = statRows(review && review.stats, max);
  const prevRows = statRows(prev && prev.stats);
  if (!rows.length) return null;
  return h('div', { class: 'u-rv-stats' }, rows.map(r => {
    const p = prevRows.find(x => x.label === r.label);
    return h('div', { class: 'u-rv-stat', dataset: { stat: r.key } },
      h('span', { class: 'u-rv-sl' }, r.label),
      h('b', { class: r.numeric && r.tone ? (r.raw > 0 ? 'good' : r.raw < 0 ? 'bad' : '') : '' }, r.text),
      p && r.numeric && p.numeric ? deltaEl(r.raw, p.raw, { low: r.low, money: r.money }) : null);
  }));
}

export function goalResults(review) {
  const gs = (review && Array.isArray(review.goals)) ? review.goals : [];
  if (!gs.length) return null;
  return h('div', { class: 'u-rv-goals' }, gs.map(g => h('div', { class: 'u-check ' + (g.done ? 'good' : 'muted') },
    h('span', null, g.done ? '✔' : '✘'), h('span', { class: 'u-grow' }, g.name || g.id || ''), h('span', { class: 'u-small' }, g.done ? '已達成' : '未達成'))));
}

export function quoteBox(text, label) {
  if (!text) return null;
  return h('div', { class: 'u-quote' }, label ? h('div', { class: 'u-quote-h' }, label) : null, h('div', { class: 'u-quote-t' }, String(text)));
}

// compact summary of one review (used by the 歷年總結 list); the year-review modal composes the same pieces plus a hero
export function reviewSummary(review, prev) {
  return h('div', { class: 'u-rv-sum' },
    reviewQuote(review),
    h('div', { class: 'u-sec u-sec-sm' }, '五大面向'), dimBars(review, prev),
    statGrid(review, prev, 16) ? [h('div', { class: 'u-sec u-sec-sm' }, ct('yearReview.highlights', '本年重點')), statGrid(review, prev, 16)] : null,
    goalResults(review) ? [h('div', { class: 'u-sec u-sec-sm' }, ct('yearReview.plan', '年度計畫')), goalResults(review)] : null,
    review && review.journal ? quoteBox(review.journal, ct('milestoneJournal', '📖 院長日誌')) : null);
}

export function yearReviewBody(review, prev, moodArt) {
  const score = Math.round(review.score || 0);
  const yr = review.year || 0;
  const sdelta = prev && typeof prev.score === 'number' ? deltaEl(review.score, prev.score, { cls: 'u-dl-lg' }) : null;
  const title = ct('yearReview.title', '年度總結');
  const hero = h('div', { class: 'u-rv-hero' },
    moodArt,
    gradeBadge(review.grade, 'u-grade-xl u-grade-pop'),
    h('div', { class: 'u-rv-heroT' },
      h('div', { class: 'u-rv-year' }, `第 ${yr} 年 ${title}`),
      h('div', { class: 'u-rv-score' }, h('b', null, score), ' 分', sdelta ? [' ', sdelta] : null),
      h('div', { class: 'u-small muted' }, gradeName(gradeKey(review.grade)) ? `${ct('yearReview.gradeLabel', '年度等級')} ${gradeKey(review.grade)}・${gradeName(gradeKey(review.grade))}` : '')));
  const sg = statGrid(review, prev), gr = goalResults(review);
  return { hero, rest: [
    reviewQuote(review),
    h('div', { class: 'u-sec u-sec-sm' }, '五大面向' + (prev ? '（↑↓ 與去年相比）' : '')), dimBars(review, prev),
    sg ? [h('div', { class: 'u-sec u-sec-sm' }, ct('yearReview.highlights', '本年重點')), sg] : null,
    gr ? [h('div', { class: 'u-sec u-sec-sm' }, ct('yearReview.plan', '年度計畫')), gr] : null,
    review.journal ? quoteBox(review.journal, ct('milestoneJournal', '📖 院長日誌')) : null,
  ] };
}

// 10-year grade strip (non-interactive) used by the ending modal and the 目標 tab timeline
export function gradeStrip(reviews, curYear, onPick) {
  const years = careerYears();
  const byYear = new Map((reviews || []).map(r => [r.year, r]));
  const pills = [];
  for (let y = 1; y <= years; y++) {
    const r = byYear.get(y);
    const g = r ? gradeKey(r.grade) : '';
    const tag = onPick && r ? 'button' : 'span';
    const el = h(tag, { class: 'u-tl-pill ' + (g ? 'u-g-' + g : 'empty') + (curYear === y && !r ? ' cur' : ''), dataset: { year: y },
      'aria-label': g ? `第${y}年 評等${g}` : `第${y}年 ${curYear === y ? '進行中' : '尚未結算'}` },
      h('small', null, y), h('b', null, g || (curYear === y ? '…' : '·')));
    if (tag === 'button') { el.type = 'button'; el.addEventListener('click', () => onPick(y)); }
    pills.push(el);
  }
  return h('div', { class: 'u-tl' }, pills);
}


// ---------------------------------------------------------------- ending pieces (career-ending modal)
function treatLabel(v) {
  if (v && typeof v === 'object') return v.name || (TREATMENTS[v.id] && TREATMENTS[v.id].name) || v.id || '';
  return (TREATMENTS[v] && TREATMENTS[v].name) || String(v);
}
const END_STATS = [
  ['totalIncome', '十年營收', v => money(v)],
  ['totalPatients', '累計病患', v => fmt(v) + ' 人'],
  ['totalCured', '治癒人數', v => fmt(v) + ' 人'],
  ['eventsHandled', '處理事件', v => fmt(v) + ' 件'],
  ['achievementsDone', '完成成就', v => fmt(v) + ' 個'],
  ['peakReputation', '最高聲譽', v => fmt(v)],
  ['finalLot', '最終店面', lotLabel],
  ['topTreatment', '最常用療法', treatLabel],
];
export function endingStatRows(stats) {
  const out = [];
  if (!stats || typeof stats !== 'object') return out;
  const L = (DATA && DATA.CAREER_TEXT && DATA.CAREER_TEXT.statLabels) || {};
  for (const [k, label, f] of END_STATS) {
    const v = stats[k];
    if (v == null || (typeof v === 'number' && !isFinite(v)) || v === '') continue;
    out.push({ key: k, label: typeof L[k] === 'string' ? L[k] : label, text: f(v) });
  }
  return out;
}
export function endingStatsCard(stats) {
  const rows = endingStatRows(stats);
  if (!rows.length) return null;
  return h('div', { class: 'u-end-stats' }, rows.map(r => h('div', { class: 'u-end-stat', dataset: { stat: r.key } }, h('span', { class: 'u-rv-sl' }, r.label), h('b', null, r.text))));
}
export function endingInfo(ending) {
  const EL = DATA && DATA.ENDINGS;
  const E = Array.isArray(EL) ? EL.find(x => x && x.id === (ending && ending.id)) : (EL && ending && EL[ending.id]);
  const e = E && typeof E === 'object' ? E : {};
  const th = ending.thanksText || ending.thanks || e.thanks || '';
  return {
    emoji: ending.emoji || e.emoji || '🏁',
    title: ending.title || e.title || '生涯結局',
    desc: ending.desc || e.desc || '',
    thanks: Array.isArray(th) ? th.join('\n\n') : String(th),
  };
}
// plain-text career card (fallback when the sim gives none)
export function cardText(state, ending) {
  const sim = safe(() => CAR.careerCardText(state), '');
  if (typeof sim === 'string' && sim.trim()) return sim;
  const info = endingInfo(ending || {});
  const rv = reviewsNow(state);
  const lines = [`🏥 ${state.clinicName || '幸福復健科診所'}　${info.emoji} ${info.title}`];
  if (ending && ending.grade) lines.push(`最終評等 ${ending.grade}${ending.score != null ? `（${Math.round(ending.score)} 分）` : ''}`);
  if (rv.length) lines.push('歷年評等：' + rv.map(r => `${r.year}${gradeKey(r.grade) || '-'}`).join(' '));
  for (const r of endingStatRows(ending && ending.stats)) lines.push(`${r.label}：${r.text}`);
  lines.push('— 復健科診所物語');
  return lines.join('\n');
}
export async function copyText(text) {
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------- red dot / seen bookkeeping
const seen = new Set();
let dotBtn = null, dotEl = null, tabDot = null;
let goalsViewed = false;                 // the 目標 tab is mounted and visible right now

function onboard(state) { return safe(() => CAR.onboardingList(state), []) || []; }
function goalsNow(state) { return safe(() => CAR.currentGoals(state), []) || []; }
function reviewsNow(state) { return safe(() => CAR.yearReviews(state), []) || []; }
function obHidden(state) { return !!(state.career && state.career.onboarding && state.career.onboarding.hidden); }

// every "something new to look at" key that exists right now
export function collectKeys(state) {
  const keys = [];
  if (!state) return keys;
  if (!obHidden(state)) for (const t of onboard(state)) keys.push((t.done ? 'obd:' : 'ob:') + t.id);
  const gy = (state.career && state.career.goals && state.career.goals.year) || state.time.year;
  for (const g of goalsNow(state)) keys.push((g.done ? 'gd:' : 'g:') + gy + ':' + g.id);
  for (const r of reviewsNow(state)) keys.push('rv:' + r.year);
  if (state.career && state.career.ending) keys.push('end');
  return keys;
}
export function unseenCount(state) {
  let n = 0;
  for (const k of collectKeys(state)) if (!seen.has(k)) n++;
  return n;
}
export function markSeen(state) { for (const k of collectKeys(state)) seen.add(k); refreshDot(state); }

// Load / boot baseline: an existing game counts everything as already seen; a brand-new game keeps its starter tasks unseen
function baseline(state) {
  seen.clear();
  const t = state.time || {};
  const fresh = (t.year || 1) <= 1 && (t.month || 1) <= 1 && !onboard(state).some(x => x.done);
  if (fresh) {
    for (const k of collectKeys(state)) if (/^(obd|gd|rv):/.test(k) || k === 'end') seen.add(k);
  } else for (const k of collectKeys(state)) seen.add(k);
}

function ensureDot() {
  if (dotEl && dotEl.isConnected) return true;
  const btn = document.querySelector('#sidebar .sidebar-btn[data-p="clinic"]');
  if (!btn) return false;
  dotBtn = btn;
  dotEl = h('i', { class: 'u-dot', hidden: true, 'aria-hidden': 'true' });
  btn.appendChild(dotEl);
  return true;
}
export function refreshDot(state) {
  if (!state) return;
  const n = goalsViewed ? 0 : unseenCount(state);
  if (ensureDot()) {
    if (dotEl.hidden === (n > 0)) dotEl.hidden = !(n > 0);
    if (dotBtn) { const lab = n > 0 ? '診所（有新的目標）' : '診所'; if (dotBtn.getAttribute('aria-label') !== lab) dotBtn.setAttribute('aria-label', lab); }
  }
  // dot on the 🎯 目標 tab button while another clinic tab is open
  const tb = [...document.querySelectorAll('#panel .tabs .tab')].find(t => (t.firstChild && String(t.firstChild.textContent || '').startsWith('🎯')));
  if (tb) {
    if (!tabDot || tabDot.parentNode !== tb) { tabDot = h('i', { class: 'u-dot u-dot-tab', hidden: true, 'aria-hidden': 'true' }); tb.appendChild(tabDot); }
    const on = n > 0 && !tb.classList.contains('active');
    if (tabDot.hidden === on) tabDot.hidden = !on;
  } else tabDot = null;
}

// ---------------------------------------------------------------- toasts
let lastToast = { at: 0, text: '' };
function noteToast(p) { if (p && p.from !== 'career' && p.text) lastToast = { at: performance.now(), text: String(p.text) }; }
function toastOnce(match, text, kind = 'good') {
  // the sim may already have announced it; wait one macrotask so a toast emitted right after the event is seen too
  setTimeout(() => {
    const recent = performance.now() - lastToast.at < 1200 && match.some(m => m && lastToast.text.includes(m));
    if (recent) return;
    bus.emit('toast', { text, kind, from: 'career' });
  }, 0);
}
function goalName(g) {
  if (g && typeof g === 'object') return g.name || g.id || '';
  const f = goalsNow(ctx.state).find(x => x.id === g);
  return (f && f.name) || (g ? String(g) : '');
}
function onGoalDone(p) {
  if (!p) return;
  const name = goalName(p.goal);
  const rw = p.rewardText || (p.goal && p.goal.rewardText) || '';
  toastOnce([name, '目標達成'], tpl('toastGoalDone', '🎯 目標達成：{name}　{reward}', { name, reward: rw }).trim());
  refreshDot(ctx.state);
}
function onOnboardDone(p) {
  if (!p) return;
  const name = goalName(p.task);
  const rw = p.rewardText || (p.task && p.task.rewardText) || '';
  toastOnce([name, '新手任務'], tpl('toastOnboardingDone', '✅ 新手任務完成：{name}　{reward}', { name, reward: rw }).trim());
  refreshDot(ctx.state);
}

// ---------------------------------------------------------------- opening the 目標 tab (clinic.js registers the opener)
let opener = null;
export function setGoalsOpener(fn) { opener = fn; }
export function openGoalsTab() { if (opener) opener(); }

// ---------------------------------------------------------------- lifecycle
let inited = false;
export function initCareerUI(state) {
  if (inited) return;
  inited = true;
  baseline(state);
  bus.on('toast', noteToast);
  bus.on('career:goal-done', onGoalDone);
  bus.on('career:onboarding-done', onOnboardDone);
  let pend = 0;
  const soon = () => { if (pend) return; pend = setTimeout(() => { pend = 0; refreshDot(ctx.state || state); }, 120); };
  bus.on('career:changed', soon);
  bus.on('career:year-review', soon);
  bus.on('career:ending', soon);
  bus.on('state:loaded', () => { baseline(ctx.state || state); soon(); });
  setInterval(() => refreshDot(ctx.state || state), 600);
  setTimeout(() => refreshDot(state), 300);
}

// ---------------------------------------------------------------- 目標 tab (mounted by panels/clinic.js)
const goalsStore = { open: new Set() };

function sectionHead(title, right) {
  return h('div', { class: 'u-sec u-career-sec' }, h('span', null, title), right || null);
}

export function mountGoalsTab(body, state) {
  goalsViewed = true;
  refreshDot(state);
  const root = h('div', { class: 'u-career' });
  body.appendChild(root);
  let alive = true;
  const stillAlive = () => alive && root.isConnected;

  // ---- 新手任務
  const obCount = h('b', { class: 'u-ob-count' });
  const obHideBtn = h('button', { class: 'btn small u-ob-hide', type: 'button' }, '隱藏');
  const obTodo = h('div', { class: 'u-list2 u-ob-list' });
  const obDoneBox = h('details', { class: 'u-ob-donebox' }, h('summary', { class: 'u-small muted' }));
  const obDoneList = h('div', { class: 'u-list2 u-ob-list' });
  obDoneBox.appendChild(obDoneList);
  const obAllDone = h('div', { class: 'u-ob-alldone good' }, '🎉 ' + ct('onboardingDoneAll', '新手任務全部完成！'));
  const obShow = h('button', { class: 'btn small u-ob-show', type: 'button' }, '顯示新手任務');
  const obBox = h('div', { class: 'u-ob' }, obAllDone, obTodo, obDoneBox);
  const obHead = sectionHead(ct('onboardingHeader', '新手任務'), h('span', { class: 'u-career-right' }, obCount, obHideBtn));
  const obRows = new Map();
  obHideBtn.addEventListener('click', () => {
    if (state.career && state.career.onboarding) state.career.onboarding.hidden = true;
    update();
  });
  obShow.addEventListener('click', () => {
    if (state.career && state.career.onboarding) state.career.onboarding.hidden = false;
    update();
  });
  function makeTask(t) {
    const mark = h('span', { class: 'u-ob-mark', 'aria-hidden': 'true' });
    const name = h('b', { class: 'u-ob-name' }), desc = h('div', { class: 'u-small u-ob-desc' }), hint = h('div', { class: 'u-small muted u-ob-hint' });
    const pb = bar(), ptxt = h('span', { class: 'u-small muted u-ob-ptxt' });
    const prog = h('div', { class: 'u-ob-prog' }, pb, ptxt);
    const rew = h('span', { class: 'tag u-chip good u-ob-rew' });
    const el = h('div', { class: 'card u-obtask', dataset: { task: t.id } },
      mark, h('div', { class: 'u-grow u-ob-main' }, h('div', { class: 'u-ob-head' }, name), desc, prog, h('div', { class: 'u-ob-foot' }, hint, rew)));
    return { el, mark, name, desc, hint, pb, ptxt, prog, rew };
  }
  function updateTasks(list) {
    let done = 0;
    for (const t of list) {
      let r = obRows.get(t.id);
      if (!r) { r = makeTask(t); obRows.set(t.id, r); }
      if (t.done) done++;
      setText(r.name, t.name || t.id);
      setText(r.desc, t.desc || '');
      setText(r.hint, t.hint ? '💡 ' + t.hint : '');
      r.hint.hidden = !t.hint || !!t.done;
      setText(r.mark, t.done ? '✔' : '○');
      setClass(r.el, 'u-done', !!t.done);
      const showProg = !t.done && t.target > 1;
      r.prog.hidden = !showProg;
      if (showProg) { setBar(r.pb, (t.progress || 0) / t.target); setText(r.ptxt, `${nv(Math.min(t.progress || 0, t.target))} / ${nv(t.target)}`); }
      const rt = t.rewardText || '';
      r.rew.hidden = !rt;
      setText(r.rew, t.done ? `✔ 已領 ${rt}` : `🎁 ${rt}`);
      const want = t.done ? obDoneList : obTodo;
      if (r.el.parentNode !== want) want.appendChild(r.el);
    }
    // keep the open order stable: unfinished tasks keep their list order
    const order = list.filter(t => !t.done).map(t => obRows.get(t.id).el);
    order.forEach((el, i) => { if (obTodo.children[i] !== el) obTodo.insertBefore(el, obTodo.children[i] || null); });
    setText(obCount, `${done}/${list.length || 10}`);
    setText(obDoneBox.firstChild, `已完成 ${done} 項（點開查看）`);
    obDoneBox.hidden = !done;
    obTodo.hidden = done >= list.length;
    obAllDone.hidden = !(list.length && done >= list.length);
  }

  // ---- 本年目標
  const goalHint = h('span', { class: 'u-small muted u-career-right' });
  const goalList = h('div', { class: 'u-list2 u-goals' });
  const goalEmpty = h('div', { class: 'u-small muted u-empty' }, ct('emptyYearly', '本年目標準備中…'));
  const goalRows = new Map();
  function makeGoal(g) {
    const kind = h('span', { class: 'tag u-gkind' });
    const name = h('b', { class: 'u-gname' }), stat = h('span', { class: 'tag u-gstat' });
    const desc = h('div', { class: 'u-small u-gdesc' });
    const pb = bar(), ptxt = h('span', { class: 'u-small u-gptxt' });
    const conds = h('div', { class: 'u-conds' });
    const rew = h('div', { class: 'u-small u-grew' });
    const el = h('div', { class: 'card u-goal', dataset: { goal: g.id } },
      h('div', { class: 'u-ghead' }, kind, name, stat), desc,
      h('div', { class: 'u-gprog' }, pb, ptxt), conds, rew);
    return { el, kind, name, stat, desc, pb, ptxt, conds, rew, condSig: '', condRows: [] };
  }
  function updateGoals(list) {
    goalEmpty.hidden = list.length > 0;
    const seenIds = new Set();
    for (const g of list) {
      seenIds.add(g.id);
      let r = goalRows.get(g.id);
      if (!r) { r = makeGoal(g); goalRows.set(g.id, r); goalList.appendChild(r.el); }
      const core = g.kind === 'core';
      setClass(r.el, 'core', core); setClass(r.el, 'u-done', !!g.done);
      setText(r.kind, core ? ct('coreLabel', '主要目標') : ct('bonusLabel', '加分目標'));
      setText(r.name, g.name || g.id);
      setText(r.stat, g.done ? (g.claimed ? '🎁 ' + ct('claimed', '已領取') : '✔ 已達成') : '進行中');
      setClass(r.stat, 'u-ok', !!g.done);
      setText(r.desc, g.desc || '');
      const ratio = typeof g.pct === 'number' && isFinite(g.pct) ? (g.pct > 1 ? g.pct / 100 : g.pct) : (g.target > 0 ? (g.progress || 0) / g.target : 0);
      setBar(r.pb, g.done ? 1 : ratio);
      setText(r.ptxt, g.done ? '完成' : `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%`);
      const cs = Array.isArray(g.conds) ? g.conds : [];
      const sig = cs.map(c => c.key).join('|');
      if (sig !== r.condSig) {
        r.condSig = sig;
        r.condRows = cs.map(() => ({
          mark: h('span', { class: 'u-cmark' }), label: h('span', { class: 'u-grow u-clab' }), val: h('span', { class: 'u-cval' }),
        }));
        r.conds.replaceChildren(...r.condRows.map(x => h('div', { class: 'u-cond' }, x.mark, x.label, x.val)));
      }
      cs.forEach((c, i) => {
        const x = r.condRows[i];
        setText(x.mark, c.ok ? '✔' : '✘');
        x.mark.parentNode.className = 'u-cond ' + (c.ok ? 'ok' : 'no');
        setText(x.label, c.label || c.key);
        const bin = (DATA && DATA.GOAL_METRICS && DATA.GOAL_METRICS[c.key] && DATA.GOAL_METRICS[c.key].unit) === '0/1';
        setText(x.val, bin ? metricText(c.key, c.value) : c.target != null ? `${metricText(c.key, c.value)} / ${cmpSym(c.cmp)}${metricText(c.key, c.target)}` : metricText(c.key, c.value));
      });
      r.conds.hidden = !cs.length;
      const rt = g.rewardText || '';
      setText(r.rew, rt ? (g.claimed ? `🎁 ${ct('claimed', '已領取')}：${rt}` : `🎁 獎勵：${rt}`) : '');
      r.rew.hidden = !rt;
      setClass(r.rew, 'u-got', !!g.claimed);
    }
    for (const [id, r] of goalRows) if (!seenIds.has(id)) { r.el.remove(); goalRows.delete(id); }
    // core first, keep stable otherwise
    const ordered = [...list].sort((a, b) => (b.kind === 'core') - (a.kind === 'core'));
    ordered.forEach((g, i) => { const el = goalRows.get(g.id).el; if (goalList.children[i] !== el) goalList.insertBefore(el, goalList.children[i] || null); });
  }

  // ---- 生涯進度
  const sumYear = h('b', { class: 'u-cs-year' }), sumGrade = h('span', { class: 'tag u-cs-avg' }), sumEndless = h('span', { class: 'tag u-cs-endless' }, '♾ 無盡模式');
  const sumEnd = h('div', { class: 'u-cs-end' });
  const tlBox = h('div', { class: 'u-tlbox' });
  const sumCard = h('div', { class: 'card u-cs' }, h('div', { class: 'u-cs-row' }, sumYear, sumGrade, sumEndless), sumEnd, tlBox);
  let tlSig = '';
  function pickYear(y) {
    const d = revBox.querySelector(`details[data-year="${y}"]`);
    if (!d) return;
    d.open = !d.open;
    if (d.open) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---- 歷年總結
  const revBox = h('div', { class: 'u-list2 u-revlist' });
  const revEmpty = h('div', { class: 'u-small muted u-empty' }, ct('emptyHistory', '還沒有年度總結。每年年底會替這一年打分數、發評等。'));
  const revRows = new Map();
  function makeReview(r) {
    const sumBody = h('div', { class: 'u-rv-detailbody' });
    const lab = h('summary', { class: 'u-rev-sum' });
    const el = h('details', { class: 'card u-rev', dataset: { year: r.year } }, lab, sumBody);
    const ref = { el, lab, sumBody, sig: '' };
    el.addEventListener('toggle', () => { if (el.open) fillReview(ref); });
    return ref;
  }
  function fillReview(ref) {
    const list = reviewsNow(state);
    const r = list.find(x => x.year === +ref.el.dataset.year);
    if (!r) return;
    const prev = list.find(x => x.year === r.year - 1) || null;
    const sig = JSON.stringify([r.grade, r.score, r.dims, r.line]);
    if (ref.sig === sig && ref.sumBody.firstChild) return;
    ref.sig = sig;
    ref.sumBody.replaceChildren(reviewSummary(r, prev));
  }
  function updateReviews(list) {
    revEmpty.hidden = list.length > 0;
    const ys = new Set();
    for (const r of list) {
      ys.add(r.year);
      let ref = revRows.get(r.year);
      if (!ref) { ref = makeReview(r); revRows.set(r.year, ref); }
      const g = gradeKey(r.grade);
      const lsig = g + '|' + Math.round(r.score || 0);
      if (ref.lsig !== lsig) {
        ref.lsig = lsig;
        ref.lab.replaceChildren(h('span', { class: 'u-rev-y' }, `第 ${r.year} 年`), gradeBadge(g, 'u-grade-sm'),
          h('span', { class: 'u-rev-score' }, `${Math.round(r.score || 0)} 分`), h('span', { class: 'u-rev-line u-grow' }, reviewLine(r)));
      }
      if (ref.el.open) fillReview(ref);
    }
    for (const [y, ref] of revRows) if (!ys.has(y)) { ref.el.remove(); revRows.delete(y); }
    const ordered = [...list].sort((a, b) => b.year - a.year);
    ordered.forEach((r, i) => { const el = revRows.get(r.year).el; if (revBox.children[i] !== el) revBox.insertBefore(el, revBox.children[i] || null); });
  }

  root.append(
    h('div', { class: 'u-section' }, obHead, obBox, obShow),
    h('div', { class: 'u-section' }, sectionHead(ct('yearlyHeader', '本年度計畫'), goalHint), goalList, goalEmpty),
    h('div', { class: 'u-section' }, sectionHead(ct('careerHeader', '生涯進度')), sumCard),
    h('div', { class: 'u-section' }, sectionHead(ct('sections.history', '歷年總結')), revBox, revEmpty));

  function update() {
    if (!stillAlive()) return;
    goalsViewed = true;
    // onboarding
    const hidden = obHidden(state);
    const list = onboard(state);
    obHead.hidden = false;
    obBox.hidden = hidden || !list.length;
    obHideBtn.hidden = hidden || !list.length;
    obShow.hidden = !hidden || !list.length;
    obCount.hidden = !list.length;
    obHead.parentNode.hidden = !list.length;
    updateTasks(list);
    // goals
    const goals = goalsNow(state);
    updateGoals(goals);
    const left = Math.max(1, 12 - ((state.time && state.time.month) || 1) + 1);
    setText(goalHint, `第 ${state.time.year} 年・` + (left <= 1 ? '年底前最後一個月' : tpl('timeLeft', '還剩 {months} 個月', { months: left })));
    // career summary + timeline
    const rv = reviewsNow(state);
    const sm = safe(() => CAR.careerSummary(state), null) || {};
    const years = careerYears();
    const yr = sm.year || state.time.year;
    setText(sumYear, sm.endless ? `生涯第 ${yr} 年` : '生涯' + tpl('careerYearLabel', '第 {year} 年 / 共 {total} 年', { year: Math.min(yr, years), total: years }));
    sumEndless.hidden = !sm.endless;
    const ag = gradeKey(sm.avgGrade);
    sumGrade.hidden = !ag;
    setText(sumGrade, ag ? `平均評等 ${ag}` : '');
    let endTxt;
    if (sm.ending && sm.ending.title) endTxt = `${sm.ending.emoji || '🏁'} 已達成結局：${sm.ending.title}`;
    else if (sm.projected && sm.projected.title) endTxt = `${sm.projected.emoji || '🔮'} 預估結局：${sm.projected.title}`;
    else endTxt = rv.length ? '🔮 預估結局：再累積一點成績就看得出來' : '🔮 預估結局：第一年底出爐後開始推估';
    if (sm.endless && !(sm.ending && sm.ending.title)) endTxt += '（無盡模式不再觸發結局）';
    setText(sumEnd, endTxt);
    const tsig = rv.map(r => r.year + gradeKey(r.grade)).join('|') + '@' + yr;
    if (tsig !== tlSig) { tlSig = tsig; tlBox.replaceChildren(gradeStrip(rv, Math.min(yr, years), pickYear)); }
    updateReviews(rv);
    markSeen(state);
  }

  // in-place refresh when the sim announces a change (≤ 5 Hz) or the data tables arrive
  let last = 0, pend = 0;
  const kick = () => {
    if (!stillAlive()) { off(); return; }
    const now = performance.now();
    if (now - last >= 200) { last = now; update(); } else if (!pend) pend = setTimeout(() => { pend = 0; last = performance.now(); update(); }, 200 - (now - last));
  };
  const offs = [bus.on('career:changed', kick), bus.on('career:ui-data', kick), bus.on('career:goal-done', kick), bus.on('career:onboarding-done', kick)];
  function off() { alive = false; goalsViewed = false; offs.forEach(f => f()); clearTimeout(pend); }
  // tab switched away: the next tabbed.select clears the body, which detaches `root`; clear the viewed flag lazily
  const watch = setInterval(() => { if (!root.isConnected) { clearInterval(watch); off(); refreshDot(state); } }, 300);
  update();
  return { update };
}
