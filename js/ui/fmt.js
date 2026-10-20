// Formatting + label tables (all 繁體中文).
import { POINT_LABELS } from '../core/constants.js';

export const nf = new Intl.NumberFormat('en-US');
export function fmt(n) { return nf.format(Math.round(n || 0)); }
export function money(n) { n = Math.round(n || 0); return (n < 0 ? '-' : '') + 'NT$ ' + nf.format(Math.abs(n)); }
export function signed(n) { n = Math.round(n || 0); return (n > 0 ? '+' : n < 0 ? '-' : '') + nf.format(Math.abs(n)); }
export function pct(r, d = 0) { return (r * 100).toFixed(d) + '%'; }

export const POINT_ICONS = { medical: '🩺', device: '🔧', service: '🛎' };
export const TRACK_COLORS = { medical: '#d1495b', device: '#3b7fd1', service: '#3a9d4d' };

export const STAGE_LABELS = {
  arriving: '抵達中', to_reception: '前往掛號', registering: '掛號中', waiting: '候診中',
  to_station: '前往治療', treating: '治療中', leaving: '離院中',
};
export const STAFF_STATE_LABELS = {
  idle: '待命', walking: '移動中', working: '治療中', resting: '休息中', chatting: '聊天中',
};
export const TYPE_ICONS = { elder: '👴', office: '💼', sports: '🏃', kid: '🧒' };
export const ROLE_ICONS = { doctor: '🩺', pt: '💪', ot: '🧩', st: '🗣', nurse: '💉' };

export const MOD_LABELS = {
  nhiTurnover: ['健保翻桌率', 'pct'], selfPayConv: ['自費轉換率', 'pct'], selfPayPrice: ['自費單價', 'pct'],
  researchGain: ['點數獲得', 'pct'], elderSat: ['長輩滿意度', 'abs'], walkSpeed: ['步行速度', 'pct'],
  spawnMult: ['來客量', 'pct'], patience: ['病患耐心', 'pct'], slipRisk: ['滑倒風險', 'pct'],
  staffStamina: ['員工體力消耗', 'pct'], rentMult: ['房租', 'pct'], wageMult: ['薪資支出', 'pct'],
  nhiCapBonus: ['健保點數上限', 'pct'],
};
const LOWER_BETTER = new Set(['slipRisk', 'staffStamina', 'rentMult', 'wageMult']);

// {nhiTurnover:0.2, elderSat:8} -> [{text:'健保翻桌率 +20%', good:true}, ...]
export function modChips(patch) {
  const out = [];
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (typeof v !== 'number') continue;
    const m = MOD_LABELS[k] || [k, 'abs'];
    const sign = v > 0 ? '+' : v < 0 ? '-' : '';
    const val = m[1] === 'pct' ? Math.abs(Math.round(v * 100)) + '%' : String(Math.abs(v));
    const good = LOWER_BETTER.has(k) ? v < 0 : v > 0;
    out.push({ text: `${m[0]} ${sign}${val}`, good });
  }
  return out;
}

// dilemma / event choice effects -> chips
export function effectChips(e) {
  const out = [];
  if (!e) return out;
  if (e.money) out.push({ text: `資金 ${signed(e.money)}`, good: e.money > 0 });
  if (e.reputation) out.push({ text: `聲譽 ${signed(e.reputation)}`, good: e.reputation > 0 });
  if (e.sat) out.push({ text: `滿意度 ${signed(e.sat)}`, good: e.sat > 0 });
  if (e.points) for (const k of Object.keys(e.points)) {
    if (e.points[k]) out.push({ text: `${POINT_LABELS[k] || k}點 ${signed(e.points[k])}`, good: e.points[k] > 0 });
  }
  if (e.nhiPenalty) out.push({ text: `健保扣款 ${money(e.nhiPenalty)}`, good: false });
  return out;
}

export function fmtDateTime(ts) {
  if (ts == null) return '';
  const d = new Date(ts);
  if (isNaN(d)) return String(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
