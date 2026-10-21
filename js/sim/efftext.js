// Human-readable (繁體中文) labels for mod patches and event effects. Pure data -> text helpers, shared by the
// event engine (result summaries), the 診所 panel (目前效應) and ui/fmt.js. No state access.
import { PATIENT_TYPES } from '../data/patients.js';

export const MOD_LABELS = {
  nhiTurnover: ['健保翻桌率', 'pct'], selfPayConv: ['自費轉換率', 'pct'], selfPayPrice: ['自費單價', 'pct'],
  researchGain: ['點數獲得', 'pct'], elderSat: ['長輩滿意度', 'abs'], walkSpeed: ['步行速度', 'pct'],
  spawnMult: ['來客量', 'pct'], patience: ['病患耐心', 'pct'], slipRisk: ['滑倒風險', 'pct'],
  staffStamina: ['員工體力消耗', 'pct'], rentMult: ['房租', 'pct'], wageMult: ['薪資支出', 'pct'],
  nhiCapBonus: ['健保點數上限', 'pct'],
};
export const LOWER_BETTER = new Set(['slipRisk', 'staffStamina', 'rentMult', 'wageMult']);

const MINUS = '−';   // U+2212, same glyph the event result chips use
export function sgn(v) { return v > 0 ? '+' : v < 0 ? MINUS : ''; }
export function signedNum(v, digits = 0) {
  const a = Math.abs(v);
  const t = digits ? (Math.round(a * 10 ** digits) / 10 ** digits).toString() : Math.round(a).toLocaleString('en-US');
  return sgn(v) + t;
}

function labelOf(key, over) {
  if (over && over[key]) return over[key];
  if (key.startsWith('typeSpawn.')) {
    const t = key.slice('typeSpawn.'.length);
    return [((PATIENT_TYPES[t] || {}).name || t) + '來客', 'pct'];
  }
  return MOD_LABELS[key] || [key, 'abs'];
}

// {nhiTurnover:0.2, elderSat:8, 'typeSpawn.elder':0.3} -> [{text:'健保翻桌率 +20%', good:true}, ...]
export function modChips(patch, over) {
  const out = [];
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (typeof v !== 'number' || v === 0) continue;
    const m = labelOf(k, over);
    const val = m[1] === 'pct' ? Math.abs(Math.round(v * 100)) + '%' : String(Math.round(Math.abs(v) * 100) / 100);
    const good = LOWER_BETTER.has(k) ? v < 0 : v > 0;
    out.push({ text: `${m[0]} ${sgn(v)}${val}`, good });
  }
  return out;
}

// buff effect {weeks,label,mods,spawn} -> flat mods patch (typeSpawn.* keys), the shape stored on the entry
export function buffPatch(b) {
  const mods = {};
  for (const k of Object.keys((b && b.mods) || {})) if (typeof b.mods[k] === 'number') mods[k] = b.mods[k];
  for (const t of Object.keys((b && b.spawn) || {})) if (typeof b.spawn[t] === 'number') mods['typeSpawn.' + t] = b.spawn[t];
  return mods;
}

// 「持續 3 週：病患 +15%」
const BUFF_LABELS = { spawnMult: ['病患', 'pct'] };
export function buffText(b) {
  const chips = modChips(buffPatch(b), BUFF_LABELS);
  const body = chips.length ? chips.map(c => c.text).join('、') : (b.label || '特殊效應');
  return `持續 ${Math.max(1, Math.round(b.weeks || 1))} 週：${body}`;
}
export function buffGood(b) {
  const chips = modChips(buffPatch(b));
  if (!chips.length) return true;
  return chips.filter(c => c.good).length >= chips.length / 2;
}
