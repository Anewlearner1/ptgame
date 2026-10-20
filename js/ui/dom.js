// Tiny DOM helpers shared by every ui module (no framework).
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'tip') el.dataset.tip = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && k !== 'list') { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, kids);
  return el;
}

export function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else if (k instanceof Node) el.appendChild(k);
    else el.appendChild(document.createTextNode(String(k)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Only touch the DOM when the value actually changed.
export function setText(el, txt) {
  txt = String(txt);
  if (el._t !== txt) { el._t = txt; el.textContent = txt; }
}
export function setClass(el, cls, on) {
  if (el.classList.contains(cls) !== !!on) el.classList.toggle(cls, !!on);
}
export function setAttr(el, name, val) {
  if (el.getAttribute(name) !== String(val)) el.setAttribute(name, val);
}

// Progress bar: .bar > i. Returns the element; use setBar(el, ratio, tone).
export function bar(ratio = 0, tone) {
  const el = h('span', { class: 'bar' + (tone ? ' ' + tone : '') }, h('i'));
  setBar(el, ratio, tone);
  return el;
}
export function setBar(el, ratio, tone) {
  const w = (clamp(ratio || 0, 0, 1) * 100).toFixed(1) + '%';
  const i = el.firstChild;
  if (i._w !== w) { i._w = w; i.style.width = w; }
  if (tone !== undefined) {
    setClass(el, 'warn', tone === 'warn');
    setClass(el, 'bad', tone === 'bad');
  }
}
// bar tone by value: high is good
export function toneOf(ratio) { return ratio < 0.25 ? 'bad' : ratio < 0.5 ? 'warn' : ''; }

// Keyed list reconcile: keeps existing row elements (and their hover/focus state),
// appends new rows, removes stale ones. Never reorders existing rows.
export function reconcile(container, items, keyFn, createFn, updateFn) {
  const rows = container._rows || (container._rows = new Map());
  const seen = new Set();
  for (const it of items) {
    const k = keyFn(it);
    seen.add(k);
    let row = rows.get(k);
    if (!row) { row = createFn(it); rows.set(k, row); container.appendChild(row); }
    if (updateFn) updateFn(row, it);
  }
  for (const [k, row] of rows) {
    if (!seen.has(k)) { row.remove(); rows.delete(k); }
  }
  return rows;
}

// Build tab strip + swappable body. tabs: [{id,label,build(body)->{update?}}]
// Returns {el, update(), select(id)}
export function tabbed(tabs, store, onChange) {
  const bar = h('div', { class: 'tabs' });
  const body = h('div', { class: 'u-tabbody' });
  const root = h('div', { class: 'u-tabbed' }, bar, body);
  let cur = null, curTab = null;
  const btns = {};
  function select(id) {
    if (!tabs.some(t => t.id === id)) id = tabs[0].id;
    if (store) store.tab = id;
    for (const t of tabs) setClass(btns[t.id], 'active', t.id === id);
    clear(body);
    body._rows = null;
    curTab = tabs.find(t => t.id === id);
    cur = curTab.build(body) || {};
    if (cur.update) cur.update();
    if (onChange) onChange(id);
  }
  for (const t of tabs) {
    btns[t.id] = h('button', { class: 'tab', type: 'button', onclick: () => select(t.id) }, t.label);
    bar.appendChild(btns[t.id]);
  }
  select((store && store.tab) || tabs[0].id);
  return { el: root, update() { if (cur && cur.update) cur.update(); }, select, body };
}
