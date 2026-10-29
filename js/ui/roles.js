// 「需要：物理治療師／護理師」 role chips (✔ = that role is on the payroll, ⚠ = not hired yet). Shared by the build cards / tray /
// tooltip / selection card / equipment table. Pure DOM helpers over sim/qualify.js.
import { h, setClass, setText } from './dom.js';
import { roleChips, requiredRolesFor, roleShort, operatesFor } from '../sim/qualify.js';

// chip row for a building; null when the building needs nobody. Call updateRoleRow() when the payroll changes (cheap: no DOM writes if unchanged).
export function roleRow(state, defId, opts = {}) {
  const roles = requiredRolesFor(defId);
  if (!roles.length) return null;
  const el = h('div', { class: 'u-roles' + (opts.cls ? ' ' + opts.cls : '') }, h('span', { class: 'u-roles-l' }, '需要：'),
    roles.map(r => h('span', { class: 'tag u-role', dataset: { role: r }, tip: `${roleShort(r)}：薪水月付、需先在「一覽 → 員工清單」招聘` }, roleShort(r))));
  el._defId = defId;
  updateRoleRow(el, state);
  return el;
}
export function updateRoleRow(el, state) {
  if (!el) return;
  const chips = roleChips(state, el._defId);
  el.childNodes.forEach((n, i) => {
    const c = chips[i - 1];
    if (!c) return;
    setClass(n, 'ok', c.ok); setClass(n, 'lack', !c.ok);
    setText(n, (c.ok ? '✔ ' : '⚠ ') + c.label);
  });
  // partially staffed (one of several alternatives hired) is fine; flag the row only when NOBODY is hired for it
  setClass(el, 'lack', chips.length > 0 && chips.every(c => !c.ok));
  el.dataset.lack = chips.every(c => !c.ok) ? '1' : '0';
}
// plain-text variant: 「需要：✔ 物理治療師　⚠ 護理師」 ('' when nobody is needed)
export function roleLine(state, defId) {
  const chips = roleChips(state, defId);
  return chips.length ? '需要：' + chips.map(c => (c.ok ? '✔ ' : '⚠ ') + c.label).join('　') : '';
}

// tooltip for a staff role: everything it can operate ("可操作的設施")
export function operatesTip(role) {
  const lines = operatesFor(role).filter(o => o.treatments.length || o.defId === 'reception').map(o =>
    `${o.name}${o.treatments.length ? '（' + o.treatments.join('、') + '）' : '（掛號）'}${o.setupOnly ? ' ・只需開機設定' : ''}`);
  return lines.length ? `${roleShort(role)}可操作的設施\n` + lines.join('\n') : `${roleShort(role)}沒有專屬設施`;
}
