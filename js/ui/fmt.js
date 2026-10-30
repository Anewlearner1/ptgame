// Formatting + label tables (all 繁體中文).
import { POINT_LABELS } from '../core/constants.js';

export const nf = new Intl.NumberFormat('en-US');
export function fmt(n) { return nf.format(Math.round(n || 0)); }
export function money(n) { n = Math.round(n || 0); return (n < 0 ? '-' : '') + 'NT$ ' + nf.format(Math.abs(n)); }
export function signed(n) { n = Math.round(n || 0); return (n > 0 ? '+' : n < 0 ? '-' : '') + nf.format(Math.abs(n)); }
export function pct(r, d = 0) { return (r * 100).toFixed(d) + '%'; }

export const POINT_ICONS = { culinary: '🍳', device: '🔧', service: '🛎' };
export const TRACK_COLORS = { culinary: '#d1495b', device: '#3b7fd1', service: '#3a9d4d' };

export const STAGE_LABELS = {
  arriving: '抵達中', to_reception: '前往點餐', registering: '點餐中', waiting: '候位中',
  to_station: '前往取餐', treating: '用餐中', leaving: '離店中',
};
export const STAFF_STATE_LABELS = {
  idle: '待命', walking: '移動中', working: '出餐中', resting: '休息中', chatting: '聊天中',
};
export const TYPE_ICONS = { elder: '👴', office: '💼', student: '🎒', family: '👨‍👩‍👧' };
export const ROLE_ICONS = { chef: '👨‍🍳', cook: '🔥', barista: '🧋', server: '🍽', cashier: '🧾' };

// mod labels / chips live in sim/efftext.js (shared with the event engine's result summaries)
export { MOD_LABELS, modChips } from '../sim/efftext.js';

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
  if (e.risk) out.push({ text: `食安風險 ${signed(e.risk)}`, good: e.risk < 0 });
  return out;
}

export function fmtDateTime(ts) {
  if (ts == null) return '';
  const d = new Date(ts);
  if (isNaN(d)) return String(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
