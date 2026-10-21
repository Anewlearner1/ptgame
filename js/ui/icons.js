// Hand-drawn inline-SVG icon set for the concept interface style (docs/ART_STYLE.md §2.9 / §3): outlined (1.5px #14111b),
// bright 3-tone fills (medical blue / gold / white), rounded joins. No images, no fonts, no canvas — strings only.
//   iconSvg(name)            -> '<svg …>' string (24x24 viewBox, sized by CSS)
//   icon(name, cls)          -> <span class="u-ico …"> holding the svg
//   dual(emoji, name, cls)   -> <span class="u-dual"> holding the classic emoji AND the svg; css/ui.css shows exactly one
//                               (emoji for the classic style, svg under html.style-concept) so the DOM never changes with the style.
//   weatherIconName(kind)    -> icon name for state.weather.kind
const INK = '#14111b';
const S = `stroke="${INK}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"`;
// double stroke = outlined line: dark under, colour over
const line = (d, col, w = 1.8) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w + 2}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${col}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

function gearPath(cx, cy, ro, ri, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, d = Math.PI / n;
    for (const [r, off] of [[ri, -0.55], [ro, -0.32], [ro, 0.32], [ri, 0.55]]) pts.push([cx + Math.cos(a + d * off * 1.0) * r, cy + Math.sin(a + d * off * 1.0) * r]);
  }
  return 'M' + pts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('L') + 'z';
}

const cloud = (fill, tx = 0, ty = 0) => `<path transform="translate(${tx} ${ty})" d="M7.5 18.5h9.2a4 4 0 0 0 .8-7.9 5.6 5.6 0 0 0-10.7-1A4.5 4.5 0 0 0 7.5 18.5z" fill="${fill}" ${S}/><path transform="translate(${tx} ${ty})" d="M8.5 11.6a3.4 3.4 0 0 1 2.2-2" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".9"/>`;

const PATHS = {
  // ---- money / reputation / date / weather
  coin: `<circle cx="12" cy="12" r="9.2" fill="#f6c64e" ${S}/><circle cx="12" cy="12" r="6.1" fill="#ffe08a" stroke="#c98a14" stroke-width="1.2"/><path d="M12 8.6v6.8M9.8 10.4h3.3a1.4 1.4 0 0 1 0 2.8h-2.2a1.4 1.4 0 0 0 0 2.8h3.3" fill="none" stroke="#c98a14" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.2 8.2a6.8 6.8 0 0 1 3-2.7" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>`,
  trophy: `<path d="M7.2 5.5H3.8v2a3.6 3.6 0 0 0 3.7 3.6M16.8 5.5h3.4v2a3.6 3.6 0 0 1-3.7 3.6" fill="none" ${S}/><path d="M6.6 3.5h10.8v6a5.4 5.4 0 0 1-10.8 0z" fill="#f6c64e" ${S}/><path d="M9.2 5v4.2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M10.6 14.6h2.8V18h-2.8z" fill="#c98a14" ${S}/><path d="M7.6 18h8.8a1 1 0 0 1 1 1v1.8H6.6V19a1 1 0 0 1 1-1z" fill="#2a7ef6" ${S}/><path d="M12 6.2l.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 8.3l2-.3z" fill="#fff" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>`,
  calendar: `<rect x="3.2" y="4.8" width="17.6" height="16" rx="3.2" fill="#f6f6f6" ${S}/><path d="M3.2 11V8a3.2 3.2 0 0 1 3.2-3.2h11.2A3.2 3.2 0 0 1 20.8 8v3z" fill="#2a7ef6" ${S}/><path d="M8 3v3.6M16 3v3.6" ${S} stroke-width="1.8"/><rect x="6.4" y="13.4" width="3" height="2.4" rx=".6" fill="#5aaef6"/><rect x="10.6" y="13.4" width="3" height="2.4" rx=".6" fill="#5aaef6"/><rect x="14.8" y="13.4" width="3" height="2.4" rx=".6" fill="#f6c64e"/><rect x="6.4" y="16.9" width="3" height="2.4" rx=".6" fill="#5aaef6"/><rect x="10.6" y="16.9" width="3" height="2.4" rx=".6" fill="#5aaef6"/>`,
  sunny: `${[0, 45, 90, 135, 180, 225, 270, 315].map(a => `<g transform="rotate(${a} 12 12)">${line('M12 2.2v2.6', '#f6c64e', 1.6)}</g>`).join('')}<circle cx="12" cy="12" r="5.3" fill="#f6c64e" ${S}/><path d="M9 10.4a3.4 3.4 0 0 1 2-1.6" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/>`,
  cloudy: `<path d="M5 12.5A3.2 3.2 0 0 1 8 8.4a4 4 0 0 1 7.2.5" fill="#d2d2de" ${S} transform="translate(-0.5 -1)"/>${cloud('#f6f6f6', 0.5, 0.5)}`,
  rain: `${cloud('#b9d8fa', 0, -2.6)}${line('M8.5 17.2l-1 2.6', '#2a7ef6', 1.6)}${line('M12.5 17.2l-1 2.6', '#2a7ef6', 1.6)}${line('M16.5 17.2l-1 2.6', '#2a7ef6', 1.6)}`,
  cold: `${line('M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9', '#9cc8f8', 1.5)}${line('M9.6 4.6L12 6.6l2.4-2M9.6 19.4L12 17.4l2.4 2', '#9cc8f8', 1.3)}<circle cx="12" cy="12" r="1.7" fill="#fff" stroke="${INK}" stroke-width="1.2"/>`,
  hot: `<rect x="9.2" y="2.8" width="5.6" height="13.4" rx="2.8" fill="#f6f6f6" ${S}/><circle cx="12" cy="17.6" r="3.8" fill="#e23a3a" ${S}/><path d="M12 7.4v10" stroke="#e23a3a" stroke-width="2.2" stroke-linecap="round"/><path d="M10.6 8.2v3" stroke="#fff" stroke-width="1" stroke-linecap="round"/>${line('M17.8 6.2h2.4M17.8 9.6h3M17.8 13h2.4', '#ea7e4e', 1.3)}`,
  typhoon: `${line('M3.6 8.4h10.6a3 3 0 1 0-3-3', '#5aaef6', 1.7)}${line('M3.6 12.6h14.6a3 3 0 1 1-3 3', '#2a7ef6', 1.7)}${line('M3.6 17h6.6a2.4 2.4 0 1 1-2.4 2.4', '#9cc8f8', 1.6)}`,
  // ---- sidebar / tab bar
  hammer: `<g transform="rotate(42 12 12)"><rect x="10.3" y="7" width="3.4" height="15.5" rx="1.5" fill="#c8a27a" ${S}/><path d="M10.7 9v12" stroke="#e8c9a2" stroke-width="1" stroke-linecap="round"/><path d="M3.8 3.4h13.6a2 2 0 0 1 2 2v2.4a2 2 0 0 1-2 2H3.8z" fill="#2a7ef6" ${S}/><path d="M5.2 5.1h10" stroke="#9cc8f8" stroke-width="1.3" stroke-linecap="round"/><path d="M3.8 3.4C2.2 3.9 1.6 5.2 1.6 6.6s.6 2.7 2.2 3.2z" fill="#5a667e" ${S}/></g>`,
  flask: `<rect x="4.4" y="19.2" width="14.6" height="2.6" rx="1.2" fill="#5a667e" ${S}/><path d="M16.8 19.2a6.3 6.3 0 0 0-1.9-10.9" fill="none" ${S} stroke-width="1.9"/><g transform="rotate(-22 10 9)"><rect x="7" y="2.4" width="6" height="11.2" rx="1.6" fill="#2a7ef6" ${S}/><rect x="8" y="1" width="4" height="2.2" rx=".8" fill="#9cc8f8" ${S}/><path d="M8.4 5v7" stroke="#9cc8f8" stroke-width="1.2" stroke-linecap="round"/><rect x="8.2" y="13.6" width="3.6" height="2" rx=".7" fill="#5a667e" ${S}/></g><rect x="4.4" y="15.4" width="8.2" height="2" rx=".8" fill="#d2d2de" ${S}/>`,
  clinic: `<path d="M3.4 10.6L12 3.2l8.6 7.4V19a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2z" fill="#f6f6f6" ${S}/><path d="M3.4 10.6L12 3.2l8.6 7.4" fill="none" stroke="${INK}" stroke-width="1.5"/><path d="M10.4 8.6h3.2v2.7h2.7v3.2h-2.7v2.7h-3.2v-2.7H7.7v-3.2h2.7z" fill="#2a7ef6" ${S} stroke-width="1.3"/><path d="M5.2 19.4h13.6" stroke="#9cc8f8" stroke-width="1.3" stroke-linecap="round"/>`,
  clipboard: `<rect x="4.8" y="4" width="14.4" height="17.6" rx="2.6" fill="#f6f6f6" ${S}/><rect x="8.6" y="2.2" width="6.8" height="4.2" rx="1.6" fill="#5a667e" ${S}/><path d="M8 11l1.2 1.2 2-2.2M13 11.2h3.2M8 15.4h8.2M8 18.4h5.4" fill="none" stroke="#2a7ef6" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  pin: `<path d="M12 21.6s-6.8-6.2-6.8-11.4a6.8 6.8 0 0 1 13.6 0c0 5.2-6.8 11.4-6.8 11.4z" fill="#ea7e4e" ${S}/><circle cx="12" cy="10.2" r="2.7" fill="#f6f6f6" ${S}/><path d="M8 8a4.6 4.6 0 0 1 2.4-2.4" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".9"/>`,
  gear: `<path d="${gearPath(12, 12, 9.6, 7, 8)}" fill="#96a2c6" ${S}/><circle cx="12" cy="12" r="3.2" fill="#f6f6f6" ${S}/><path d="M6.6 8.6a6 6 0 0 1 2-2" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>`,
  // ---- misc chrome
  stats: `<rect x="3.6" y="12" width="4.6" height="8.6" rx="1.2" fill="#5aaef6" ${S}/><rect x="9.7" y="4.4" width="4.6" height="16.2" rx="1.2" fill="#2a7ef6" ${S}/><rect x="15.8" y="9" width="4.6" height="11.6" rx="1.2" fill="#f6c64e" ${S}/>`,
  bill: `<path d="M5.4 3.2h13.2v17.6l-2.2-1.5-2.2 1.5-2.2-1.5-2.2 1.5-2.2-1.5-2.2 1.5z" fill="#f6f6f6" ${S}/><path d="M8.6 8h6.8M8.6 11.6h6.8M8.6 15.2h3.6" fill="none" stroke="#2a7ef6" stroke-width="1.6" stroke-linecap="round"/>`,
  medal: `<path d="M8 2.8l4 6.2 4-6.2" fill="#2a7ef6" ${S}/><circle cx="12" cy="15" r="6.2" fill="#f6c64e" ${S}/><path d="M12 11.2l1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5-1.8-1.7 2.5-.3z" fill="#fff" stroke="${INK}" stroke-width="1" stroke-linejoin="round"/>`,
  cross: `<path d="M9.2 3.6h5.6v5.6h5.6v5.6h-5.6v5.6H9.2v-5.6H3.6V9.2h5.6z" fill="currentColor" stroke="none"/>`,
  fullscreen: `<path d="M3.6 9V5.4a1.8 1.8 0 0 1 1.8-1.8H9M15 3.6h3.6a1.8 1.8 0 0 1 1.8 1.8V9M20.4 15v3.6a1.8 1.8 0 0 1-1.8 1.8H15M9 20.4H5.4a1.8 1.8 0 0 1-1.8-1.8V15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
  bulb: `<path d="M12 2.8a6 6 0 0 0-3.6 10.8c.7.6 1 1.3 1 2.1h5.2c0-.8.3-1.5 1-2.1A6 6 0 0 0 12 2.8z" fill="#ffe08a" ${S}/><rect x="9.4" y="16.6" width="5.2" height="3.4" rx="1.2" fill="#96a2c6" ${S}/><path d="M9.2 7.4a3.4 3.4 0 0 1 2-1.6" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>`,
};
export const ICON_NAMES = Object.keys(PATHS);

export function iconSvg(name) {
  const p = PATHS[name];
  if (!p) return '';
  return `<svg class="u-svg" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">${p}</svg>`;
}

export function icon(name, cls) {
  const el = document.createElement('span');
  el.className = 'u-ico' + (cls ? ' ' + cls : '');
  el.dataset.ico = name;
  el.innerHTML = iconSvg(name);
  return el;
}

// Emoji for the classic style + node (svg / sprite) for the concept style; css toggles which one is displayed.
export function dual(emoji, node, cls) {
  const el = document.createElement('span');
  el.className = 'u-dual' + (cls ? ' ' + cls : '');
  const c = document.createElement('span'); c.className = 'u-d-c'; c.textContent = emoji;
  const n = document.createElement('span'); n.className = 'u-d-n';
  if (typeof node === 'string') n.innerHTML = iconSvg(node); else if (node) n.appendChild(node);
  el.append(c, n);
  el._c = c; el._n = n;
  return el;
}

const WEATHER_ICON = { sunny: 'sunny', cloudy: 'cloudy', rain: 'rain', cold: 'cold', hot: 'hot', typhoon: 'typhoon' };
export function weatherIconName(kind) { return WEATHER_ICON[kind] || 'sunny'; }
