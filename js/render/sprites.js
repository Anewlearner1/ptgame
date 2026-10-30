// Procedural pixel-art sprites (S-C). Everything is drawn at "art resolution" (1 art px = 2 screen px at zoom 1),
// alpha-thresholded, auto-outlined, then upscaled x2 with smoothing off and cached.
// Every returned canvas carries .ax/.ay = anchor in sprite px:
//   objects  -> anchor is the TOP corner of the footprint's first tile (= gridToScreen(obj.x,obj.y))
//   tiles    -> anchor is the top corner of the diamond (32, 0)
//   people   -> anchor is the feet centre (or the seat point for the sit pose)
//   icons    -> anchor is bottom centre
import { BUILDABLES } from '../data/buildables.js';
import * as PAT from '../data/patients.js';
import * as STF from '../data/staffdefs.js';
import { artObjectSprite } from './artdraw.js';
import { artEnabled } from './art.js';
import { conceptObjectSprite, conceptFloorSprite } from './concept_objects.js';

const PX = 2;

// ───────────────────────── colour utils ─────────────────────────
function hex2rgb(h) {
  if (typeof h !== 'string' || h[0] !== '#') return [128, 128, 128];
  if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
const h2 = n => (n < 16 ? '0' : '') + n.toString(16);
function rgb2hex(r, g, b) {
  return '#' + h2(Math.max(0, Math.min(255, Math.round(r)))) + h2(Math.max(0, Math.min(255, Math.round(g)))) + h2(Math.max(0, Math.min(255, Math.round(b))));
}
export function mix(a, b, t) {
  const A = hex2rgb(a), B = hex2rgb(b);
  return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
const DARK = '#1d1a38';
const lighten = (c, t) => mix(c, '#ffffff', t);
const darken = (c, t) => mix(c, DARK, t);

const _fs = new Map();
function faceSet(hex) {
  let s = _fs.get(hex);
  if (!s) {
    s = { t: lighten(hex, 0.12), l: darken(hex, 0.08), r: darken(hex, 0.30), hi: lighten(hex, 0.42), hi2: lighten(hex, 0.22), lo: darken(hex, 0.45) };
    _fs.set(hex, s);
  }
  return s;
}

// ───────────────────────── art canvas helpers ─────────────────────────
function makeArt(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  return { c, g, w, h };
}

// threshold alpha, add coloured outline, upscale
function finishArt(a, ax, ay, o = {}) {
  const { c, g, w, h } = a;
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const k = i * 4;
    if (d[k + 3] >= 110) d[k + 3] = 255; else { d[k + 3] = 0; }
  }
  if (o.outline !== false) {
    const src = new Uint8ClampedArray(d);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (src[i + 3]) continue;
        let j = -1;
        if (x > 0 && src[i - 4 + 3]) j = i - 4;
        else if (x < w - 1 && src[i + 4 + 3]) j = i + 4;
        else if (y > 0 && src[i - w * 4 + 3]) j = i - w * 4;
        else if (y < h - 1 && src[i + w * 4 + 3]) j = i + w * 4;
        if (j >= 0) {
          d[i] = src[j] * 0.34 + 14; d[i + 1] = src[j + 1] * 0.30 + 10; d[i + 2] = src[j + 2] * 0.36 + 28; d[i + 3] = 255;
        }
      }
    }
  }
  g.putImageData(img, 0, 0);
  const out = document.createElement('canvas');
  out.width = w * PX; out.height = h * PX;
  const og = out.getContext('2d');
  og.imageSmoothingEnabled = false;
  og.drawImage(c, 0, 0, w, h, 0, 0, w * PX, h * PX);
  out.ax = ax * PX; out.ay = ay * PX;
  return out;
}

// ───────────────────────── iso pen (3-face boxes in local tile coords) ─────────────────────────
// Local coords: u along def.w, v along def.h; with rot=1 the axes are swapped so the "back" stays at low u/v.
function makePen(g, ax, ay, rot) {
  const p = (x, y, z) => [ax + (x - y) * 16, ay + (x + y) * 8 - z];
  const poly = (pts, col) => {
    g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(Math.round(pts[0][0]), Math.round(pts[0][1]));
    for (let i = 1; i < pts.length; i++) g.lineTo(Math.round(pts[i][0]), Math.round(pts[i][1]));
    g.closePath(); g.fill(); g.stroke();
  };
  const line = (a, b, col) => {
    let x0 = Math.round(a[0]), y0 = Math.round(a[1]);
    const x1 = Math.round(b[0]), y1 = Math.round(b[1]);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    g.fillStyle = col;
    for (let i = 0; i < 400; i++) {
      g.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  };
  const S = c => (typeof c === 'string' ? faceSet(c) : c);
  const boxXY = (x0, y0, x1, y1, z0, z1, col) => {
    const s = S(col);
    poly([p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), p(x0, y1, z0)], s.l);
    poly([p(x1, y0, z1), p(x1, y1, z1), p(x1, y1, z0), p(x1, y0, z0)], s.r);
    poly([p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)], s.t);
    if (z1 - z0 > 2) {
      line(p(x0, y1, z1), p(x1, y1, z1), s.hi);
      line(p(x1, y1, z1), p(x1, y0, z1), s.hi2);
      line(p(x1, y1, z0), p(x1, y1, z1 - 1), s.lo);
    }
  };
  const faceY = (x0, x1, y, z0, z1, col) => poly([p(x0, y, z1), p(x1, y, z1), p(x1, y, z0), p(x0, y, z0)], col);
  const faceX = (y0, y1, x, z0, z1, col) => poly([p(x, y0, z1), p(x, y1, z1), p(x, y1, z0), p(x, y0, z0)], col);
  const topXY = (x0, y0, x1, y1, z, col) => poly([p(x0, y0, z), p(x1, y0, z), p(x1, y1, z), p(x0, y1, z)], col);
  const P = {
    g, p, poly, line, rot,
    box: (u0, v0, u1, v1, z0, z1, col) => (rot ? boxXY(v0, u0, v1, u1, z0, z1, col) : boxXY(u0, v0, u1, v1, z0, z1, col)),
    fL: (u0, u1, v, z0, z1, col) => (rot ? faceX(u0, u1, v, z0, z1, col) : faceY(u0, u1, v, z0, z1, col)),
    fR: (v0, v1, u, z0, z1, col) => (rot ? faceY(v0, v1, u, z0, z1, col) : faceX(v0, v1, u, z0, z1, col)),
    top: (u0, v0, u1, v1, z, col) => (rot ? topXY(v0, u0, v1, u1, z, col) : topXY(u0, v0, u1, v1, z, col)),
    xy: (u, v) => (rot ? [v, u] : [u, v]),
    pt(u, v, z) { const q = rot ? p(v, u, z) : p(u, v, z); return q; },
    ball(u, v, z, r, col, hi) {
      const q = P.pt(u, v, z);
      g.fillStyle = col; g.beginPath(); g.arc(q[0], q[1], r, 0, 6.2832); g.fill();
      if (hi !== false) { g.fillStyle = hi || lighten(col, 0.4); g.fillRect(Math.round(q[0] - r * 0.5), Math.round(q[1] - r * 0.6), Math.max(1, Math.round(r * 0.45)), 1); }
    },
    disc(u, v, z, rx, ry, col) {
      const q = P.pt(u, v, z);
      g.fillStyle = col; g.beginPath(); g.ellipse(q[0], q[1], rx, ry, 0, 0, 6.2832); g.fill();
    },
    dot(u, v, z, col) { const q = P.pt(u, v, z); g.fillStyle = col; g.fillRect(Math.round(q[0]), Math.round(q[1]), 1, 1); },
    px(u, v, z, w, h, col) { const q = P.pt(u, v, z); g.fillStyle = col; g.fillRect(Math.round(q[0]), Math.round(q[1]), w, h); },
    ln(u0, v0, z0, u1, v1, z1, col) { line(P.pt(u0, v0, z0), P.pt(u1, v1, z1), col); },
    poly3(pts, col) { poly(pts.map(q => P.pt(q[0], q[1], q[2])), col); },
  };
  return P;
}

// ───────────────────────── tiny bitmap icons ─────────────────────────
function bitmapSprite(rows, pal, outline = true) {
  const w = rows[0].length + 2, h = rows.length + 2;
  const a = makeArt(w, h);
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.' || !pal[ch]) continue;
      a.g.fillStyle = pal[ch];
      a.g.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  return finishArt(a, w / 2, h - 1, { outline });
}

const ICONS = {
  anger: { rows: ['.RR....RR.', 'RRORR.RROR'.replace('O', 'R'), '.RRR..RRR.', '..........', '.RRR..RRR.', 'RRRR..RRRR', '.RR....RR.'], pal: { R: '#e8392f' } },
  sleep: { rows: ['.WWWWW....', '....WW....', '...WW.....', '..WW......', '.WWWWW.WWW', '........W.', '.......WWW'], pal: { W: '#cfe3ff' } },
  heart: { rows: ['.RR..RR.', 'RHRRRRRR', 'RRRRRRRR', '.RRRRRR.', '..RRRR..', '...RR...'], pal: { R: '#f0507a', H: '#ffc2d4' } },
  money: { rows: ['..OOOO..', '.OYYYYO.', 'OYYDDYYO', 'OYDYYYYO', 'OYYDDYYO', 'OYYYYDYO', '.OYDDYO.', '..OOOO..'], pal: { O: '#b8860b', Y: '#ffd23f', D: '#b8860b' } },
  warn: { rows: ['....YY....', '...YYYY...', '...YKKY...', '..YYKKYY..', '..YYKKYY..', '.YYYYYYYY.', '.YYYKKYYY.', 'YYYYYYYYYY'], pal: { Y: '#ffc400', K: '#2a2233' } },
  star: { rows: ['....Y....', '....Y....', '...YYY...', 'YYYYYYYYY', '.YYYYYYY.', '..YYYYY..', '.YYY.YYY.', '.YY...YY.'], pal: { Y: '#ffe14d' } },
  check: { rows: ['.......GG', '......GGG', 'G....GGG.', 'GG..GGG..', '.GGGGG...', '..GGG....', '...G.....'], pal: { G: '#3cc46a' } },
  question: { rows: ['..BBBB..', '.BB..BB.', '.....BB.', '....BB..', '...BB...', '........', '...BB...'], pal: { B: '#6aa7ff' } },
  sweat: { rows: ['...B...', '..BBB..', '.BBLBB.', '.BBBBB.', '..BBB..'], pal: { B: '#5fb7ff', L: '#e6f6ff' } },
  note: { rows: ['..PPPP', '..P..P', '..P..P', '..P..P', 'PPP.PPP', 'PPP.PPP'], pal: { P: '#a77bff' } },
};
const _icons = new Map();
export function getIconSprite(name) {
  let s = _icons.get(name);
  if (!s) {
    const d = ICONS[name] || ICONS.warn;
    s = bitmapSprite(d.rows, d.pal);
    _icons.set(name, s);
  }
  return s;
}

// ───────────────────────── people ─────────────────────────
export const DIRS = 4;   // 0:+x (down-right) 1:+y (down-left) 2:-x (up-left) 3:-y (up-right)
const SKINS = ['#f6d2b0', '#f1c9a5', '#e0b48a', '#c99770'];
const HAIRS = ['#2b2b33', '#3a2a1e', '#5a3825', '#1c1c24'];
const PERSON_KINDS = ['elder', 'office', 'student', 'family', 'chef', 'cook', 'barista', 'server', 'cashier'];
const POSES = { walk: 0, stand: 0, sit: 1, work: 2 };

function patPal(kind, def) {
  const t = PAT.PATIENT_TYPES && PAT.PATIENT_TYPES[kind];
  return (t && t.palette) || def;
}
function roleColor(role, def) {
  const r = STF.STAFF_ROLES && STF.STAFF_ROLES[role];
  return (r && r.color) || def;
}

function specFor(kind, variant) {
  const v = variant | 0;
  const base = { skin: SKINS[v & 3], hair: HAIRS[(v >> 1) & 3], style: 'short', shirt: '#cccccc', pants: '#3a4252', shoes: '#4a3b34' };
  switch (kind) {
    case 'elder': {
      const p = patPal('elder', { skin: '#f1c9a5', hair: '#c9c9c9', shirt: '#b7d7c4', pants: '#4b5d6b' });
      return { ...base, skin: p.skin, hair: p.hair, style: v & 1 ? 'bun' : 'bald', shirt: p.shirt, pants: p.pants, cane: true, stoop: true, glasses: !!(v & 2), shoes: '#6b5a4a' };
    }
    case 'office': {
      const p = patPal('office', { skin: '#f6d2b0', hair: '#2b2b33', shirt: '#f2f2f2', pants: '#3c3f58' });
      return { ...base, skin: p.skin, hair: p.hair, style: v & 1 ? 'long' : 'short', shirt: p.shirt, pants: p.pants, tie: '#c4373b', glasses: !!(v & 2), shoes: '#222' };
    }
    case 'student': {
      const p = patPal('student', { skin: '#e0b48a', hair: '#3a2a1e', shirt: '#ff7a3d', pants: '#222831' });
      return { ...base, skin: p.skin, hair: p.hair, style: v & 1 ? 'twin' : 'short', shirt: p.shirt, pants: p.pants, pack: v & 2 ? '#2b6fd6' : '#d9362b', shoes: '#f4f4f4' };
    }
    case 'family': {
      const p = patPal('family', { skin: '#f3c7a1', hair: '#5a3825', shirt: '#ffd166', pants: '#118ab2' });
      if (v & 2) return { ...base, skin: p.skin, hair: p.hair, style: v & 1 ? 'twin' : 'bowl', shirt: p.shirt, pants: p.pants, kid: true, pack: v & 1 ? '#e0488a' : '#3aa0e0', shorts: true, shoes: '#fff' };
      return { ...base, skin: SKINS[v & 3], hair: p.hair, style: v & 1 ? 'long' : 'short', shirt: p.shirt, pants: p.pants, shoes: '#4a3b34' };
    }
    case 'chef':
      return { ...base, style: 'short', shirt: '#f4f7fa', pants: '#3a3f4a', coat: '#f8fafc', toque: true, shoes: '#2a2a33' };
    case 'cook': {
      const c = roleColor('cook', '#e87a3a');
      return { ...base, style: v & 1 ? 'bun' : 'short', shirt: c, pants: '#3b3b44', apron: '#f2f2f2', bandana: darken(c, 0.15), shoes: '#2a2a33' };
    }
    case 'barista': {
      const c = roleColor('barista', '#3fa66b');
      return { ...base, style: v & 1 ? 'bun' : 'long', shirt: '#f4f4f4', pants: '#2f3a52', apron: c, shoes: '#2a2a33' };
    }
    case 'server': {
      const c = roleColor('server', '#8e5bc4');
      return { ...base, style: v & 1 ? 'bun' : 'short', shirt: '#fafafa', pants: '#222831', vest: c, tie: '#222', tray: true, shoes: '#1c1c24' };
    }
    case 'cashier': {
      const c = roleColor('cashier', '#e87fae');
      return { ...base, style: 'long', shirt: c, pants: mix(c, '#ffffff', 0.5), lanyard: '#ffd23f', shoes: '#fff', skin: SKINS[v & 3] };
    }
    default:
      return { ...base, shirt: '#8aa0b8' };
  }
}

const PW = 16, PH = 28, PTOP = 3;

function drawPerson(g, s, front, pose, frame, right) {
  const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const kid = !!s.kid;
  const walking = pose === 0 && frame >= 0;
  const bob = walking && (frame & 1) ? -1 : 0;
  const hy = PTOP + (s.stoop ? 1 : 0) + bob + (pose === 1 ? 0 : 0);      // head top row
  const bodyH = kid ? 4 : 6, legH = kid ? 4 : 6;
  const by = PTOP + 8 + bob + (s.stoop ? 0 : 0);                             // body top row
  const L0 = PTOP + 8 + bodyH;                                              // hips row (fixed)
  const shirtD = darken(s.shirt, 0.22), shirtL = lighten(s.shirt, 0.18);
  const pantsD = darken(s.pants, 0.22);
  const skinD = darken(s.skin, 0.15);
  const dxs = right ? 1 : 0;      // look/lean to the right

  // ── legs ──
  const lLift = pose === 0 && frame === 0 ? 1 : 0, rLift = pose === 0 && frame === 2 ? 1 : 0;
  if (pose === 1) {
    // sitting: thighs toward viewer, shins down
    R(5, L0 - 1, 6, 3, s.pants); R(4, L0 + 1, 8, 1, s.pants); R(5, L0 + 1, 6, 1, lighten(s.pants, 0.12));
    R(5, L0 + 2, 2, 3, s.shorts ? s.skin : s.pants); R(9, L0 + 2, 2, 3, s.shorts ? s.skin : s.pants);
    R(4, L0 + 5, 3, 1, s.shoes); R(9, L0 + 5, 3, 1, s.shoes);
  } else {
    R(5, L0 + bob, 6, 2, s.pants); R(5, L0 + 1 + bob, 6, 1, pantsD);
    const legC = s.shorts ? s.skin : s.pants;
    const ll = legH - 2 - lLift, rl = legH - 2 - rLift;
    if (s.shorts) { R(5, L0 + 2, 2, 1, s.pants); R(9, L0 + 2, 2, 1, s.pants); }
    R(5, L0 + 2, 2, ll, legC); R(9, L0 + 2, 2, rl, legC);
    if (s.shorts) { R(5, L0 + 2, 2, 1, s.pants); R(9, L0 + 2, 2, 1, s.pants); }
    R(4, L0 + 2 + ll - 1 + 1 - 1, 3, 1, s.shoes); R(9, L0 + 2 + rl - 1 + 1 - 1, 3, 1, s.shoes);
    R(4, L0 + 2 + ll - 1, 3, 1, s.shoes); R(9, L0 + 2 + rl - 1, 3, 1, s.shoes);
  }

  // ── backpack (behind body for front view = peeks at sides; on the back view fully visible) ──
  if (s.pack && !front) { R(4, by, 8, bodyH - 1, s.pack); R(4, by + bodyH - 2, 8, 1, darken(s.pack, 0.25)); }
  if (s.pack && front) { R(3, by + 1, 1, 3, s.pack); R(12, by + 1, 1, 3, s.pack); }

  // ── torso ──
  const tb = pose === 1 ? 0 : 0;
  R(5, by, 6, bodyH, s.shirt);
  R(10, by, 1, bodyH, shirtD);
  if (front) {
    if (s.coat) {
      R(5, by, 6, bodyH + 2, s.coat); R(10, by, 1, bodyH + 2, '#cdd6de'); R(7, by + 1, 2, bodyH + 1, s.shirt); R(8, by + 3, 1, 1, '#9db'); R(5, by + bodyH + 1, 6, 1, '#dde5ec');
      if (s.stetho) { R(6, by, 1, 3, '#44505e'); R(9, by, 1, 3, '#44505e'); R(7, by + 3, 2, 1, '#44505e'); R(8, by + 4, 1, 1, '#9aa7b3'); }
    } else {
      R(7, by, 2, 1, s.skin);                   // collar V
      if (s.tie) { R(7, by + 1, 2, 1, s.tie); R(7, by + 2, 1, 3, s.tie); R(8, by + 2, 1, 3, darken(s.tie, 0.2)); }
      if (s.lanyard) { R(6, by, 1, 3, s.lanyard); R(9, by, 1, 3, s.lanyard); R(7, by + 3, 2, 2, '#fff'); }
      if (s.band) R(5, by + 1, 6, 1, lighten(s.shirt, 0.25));
      if (s.apron) { R(5, by + 1, 6, bodyH + 1, s.apron); R(5, by + 1, 6, 1, darken(s.apron, 0.2)); R(6, by, 1, 1, darken(s.apron, 0.3)); R(9, by, 1, 1, darken(s.apron, 0.3)); R(7, by + 3, 2, 1, darken(s.apron, 0.12)); }
      if (s.vest) { R(5, by, 2, bodyH, s.vest); R(9, by, 2, bodyH, s.vest); R(7, by, 2, bodyH, '#fafafa'); R(7, by + 2, 2, 1, '#222'); }
    }
  } else if (s.coat) {
    R(5, by, 6, bodyH + 2, s.coat); R(10, by, 1, bodyH + 2, '#cdd6de'); R(5, by + bodyH + 1, 6, 1, '#dde5ec');
  } else if (s.apron) { R(5, by + 2, 6, bodyH - 1, darken(s.apron, 0.1)); R(5, by + 3, 6, 1, darken(s.apron, 0.25));
  } else if (s.vest) { R(5, by, 6, bodyH, s.vest); R(7, by, 2, 1, s.skin);
  } else if (s.lanyard) { R(7, by, 2, 1, s.lanyard); }

  // ── arms ──
  const sleeve = s.coat || s.shirt;
  const shortSleeve = s.shorts && !s.coat;
  const aL = pose === 0 ? (frame === 0 ? 1 : frame === 2 ? -1 : 0) : 0;
  const ah = bodyH - 1;
  if (pose === 2 && front) {
    const w = frame & 1;
    R(4, by + 1, 2, 3, sleeve); R(10, by + 1, 2, 3, sleeve);
    R(5, by + 3 + w, 2, 1, s.skin); R(9, by + 3 - w, 2, 1, s.skin);
    R(6, by + 2, 4, 1, shirtL);
  } else if (pose === 2) {
    const w = frame & 1;
    R(3, by - 0 + w, 2, ah, sleeve); R(11, by + (1 - w), 2, ah, sleeve);
    R(3, by + ah - 1 + w, 2, 1, s.skin); R(11, by + ah - 1 + (1 - w), 2, 1, s.skin);
  } else if (pose === 1) {
    R(3, by + 1, 2, ah - 1, sleeve); R(11, by + 1, 2, ah - 1, sleeve);
    R(4, by + ah - 1, 2, 1, s.skin); R(10, by + ah - 1, 2, 1, s.skin);
  } else {
    R(3, by + aL, 2, ah, sleeve); R(11, by - aL, 2, ah, sleeve);
    R(3, by + aL + ah - 1, 2, 1, s.skin); R(11, by - aL + ah - 1, 2, 1, s.skin);
    if (shortSleeve) { R(3, by + aL + 1, 2, 1, s.skin); R(11, by - aL + 1, 2, 1, s.skin); R(3, by + aL, 2, 1, s.shirt); R(11, by - aL, 2, 1, s.shirt); }
  }

  // cane (viewer's right hand)
  if (s.cane && pose !== 1) { R(13, by + ah - 2 - aL * 0, 1, L0 + legH - by - ah + 2, '#8a5a2b'); R(12, by + ah - 2, 2, 1, '#a9733a'); }

  // server's tray (viewer's right hand): steel plate with a bowl of soup
  if (s.tray && pose !== 1) { const ty = by + ah - 2; R(11, ty, 5, 1, '#d2d2de'); R(11, ty + 1, 5, 1, '#7e8aba'); R(13, ty - 2, 2, 2, '#f6f6f6'); R(13, ty - 2, 2, 1, '#e23a3a'); }

  // ── head ──
  const skin = s.skin;
  R(5, hy, 6, 8, skin); R(4, hy + 1, 8, 6, skin);
  R(11, hy + 2, 1, 4, skinD);
  if (front) {
    const ex = 6 + dxs, ex2 = 9 + dxs;
    if (s.glasses) {
      R(ex - 1, hy + 3, 3, 3, '#e8f4ff'); R(ex2 - 1, hy + 3, 3, 3, '#e8f4ff');
      R(ex - 1, hy + 3, 3, 1, '#46465a'); R(ex2 - 1, hy + 3, 3, 1, '#46465a'); R(ex - 1, hy + 5, 3, 1, '#46465a'); R(ex2 - 1, hy + 5, 3, 1, '#46465a');
      R(ex, hy + 4, 1, 1, '#22222a'); R(ex2, hy + 4, 1, 1, '#22222a'); R(ex + 2, hy + 4, ex2 - ex - 3, 1, '#46465a');
    } else {
      R(ex, hy + 4, 1, 2, '#22222a'); R(ex2, hy + 4, 1, 2, '#22222a');
      if (kid) { R(ex - 1, hy + 5, 1, 1, '#f5a0a0'); R(ex2 + 1, hy + 5, 1, 1, '#f5a0a0'); }
    }
    R(7 + dxs, hy + 6, 2, 1, '#b5545a');
  }
  // hair
  const hc = s.hair, hcD = darken(hc, 0.25), hcL = lighten(hc, 0.2);
  if (!front) {
    // back of head
    if (s.style === 'bald') { R(4, hy + 1, 8, 4, hc); R(5, hy, 6, 1, skin); R(5, hy + 5, 6, 1, hc); R(5, hy + 1, 6, 1, skin); }
    else { R(4, hy + 1, 8, 6, hc); R(5, hy, 6, 8, hc); R(5, hy + 7, 6, 1, skin); R(5, hy + 1, 3, 1, hcL); }
    if (s.style === 'long') { R(4, hy + 6, 8, 3, hc); R(5, hy + 9, 6, 1, hc); }
    if (s.style === 'bun') R(6, hy - 2, 4, 2, hc);
    if (s.style === 'twin') { R(3, hy + 4, 1, 4, hc); R(12, hy + 4, 1, 4, hc); }
    if (s.style === 'cap') { R(4, hy, 8, 3, s.cap); R(5, hy - 1, 6, 1, s.cap); R(7, hy - 1, 2, 1, darken(s.cap, 0.3)); }
    if (s.style === 'bowl') { R(4, hy + 1, 8, 6, hc); R(5, hy + 7, 6, 1, hc); }
  } else {
    switch (s.style) {
      case 'bald':
        R(6, hy, 4, 1, hc); R(4, hy + 2, 1, 3, hc); R(11, hy + 2, 1, 3, hc); R(4, hy + 1, 2, 1, hc); R(10, hy + 1, 2, 1, hc);
        break;
      case 'long':
        R(5, hy, 6, 2, hc); R(4, hy + 1, 8, 2, hc); R(4, hy + 3, 1, 5, hc); R(11, hy + 3, 1, 5, hc); R(5, hy + 2, 2, 1, hc); R(9, hy + 2, 2, 1, hc); R(6, hy, 2, 1, hcL);
        break;
      case 'bun':
        R(5, hy, 6, 2, hc); R(4, hy + 1, 8, 2, hc); R(4, hy + 3, 1, 2, hc); R(11, hy + 3, 1, 2, hc); R(6, hy - 2, 4, 2, hc); R(7, hy - 2, 1, 1, hcL);
        break;
      case 'cap': {
        const c = s.cap;
        R(5, hy, 6, 3, c); R(4, hy + 1, 8, 2, c); R(6, hy, 2, 1, lighten(c, 0.25));
        R(right ? 8 : 3, hy + 3, 5, 1, darken(c, 0.2));
        R(4, hy + 3, 1, 2, hc); R(11, hy + 3, 1, 2, hc);
        break;
      }
      case 'bowl':
        R(5, hy, 6, 2, hc); R(4, hy + 1, 8, 3, hc); R(6, hy + 4, 1, 1, hc); R(9, hy + 4, 1, 1, hc); R(5, hy, 3, 1, hcL);
        break;
      case 'twin':
        R(5, hy, 6, 2, hc); R(4, hy + 1, 8, 3, hc); R(3, hy + 3, 1, 4, hc); R(12, hy + 3, 1, 4, hc); R(3, hy + 2, 1, 1, '#ff7aa8'); R(12, hy + 2, 1, 1, '#ff7aa8');
        break;
      default:   // short
        R(5, hy, 6, 2, hc); R(4, hy + 1, 8, 2, hc); R(4, hy + 3, 1, 2, hc); R(11, hy + 3, 1, 2, hc); R(6, hy + 2, 1, 1, hc); R(9, hy + 2, 2, 1, hc); R(5, hy, 3, 1, hcL);
    }
  }
  // headgear: chef's toque, cook's bandana
  if (s.toque) { R(5, hy - 3, 6, 3, '#ffffff'); R(4, hy - 2, 8, 2, '#ffffff'); R(4, hy, 8, 1, '#e4e6ee'); R(5, hy - 3, 2, 1, '#f1f3f8'); }
  if (s.bandana) { R(4, hy, 8, 2, s.bandana); R(5, hy - 1, 6, 1, s.bandana); if (!front) R(11, hy + 1, 2, 2, darken(s.bandana, 0.2)); }
}

const _people = new Map();
export function getPersonSprite(kind, dir, frame, opts) {
  const o = opts || {};
  const poseName = o.pose || 'walk';
  const pose = POSES[poseName] != null ? POSES[poseName] : 0;
  let ki = PERSON_KINDS.indexOf(kind);
  if (ki < 0) ki = PERSON_KINDS.length;
  const variant = (o.variant | 0) & 7;
  const d = ((dir | 0) % 4 + 4) % 4;
  const f = pose === 0 ? (poseName === 'stand' ? -1 : ((frame | 0) & 3)) : ((frame | 0) & 1);
  const key = ((((ki * 8 + variant) * 3 + pose) * 4 + d) * 5) + (f + 1);
  let s = _people.get(key);
  if (s) return s;
  // dir -> front/back + mirror. 0 (+x): front,right  1 (+y): front,left  2 (-x): back,left  3 (-y): back,right
  const front = d === 0 || d === 1;
  const right = d === 0 || d === 3;
  const spec = specFor(kind, variant);
  const a = makeArt(PW, PH);
  if (!right) { a.g.translate(PW, 0); a.g.scale(-1, 1); }
  drawPerson(a.g, spec, front, pose, f, right);
  a.g.setTransform(1, 0, 0, 1, 0, 0);
  const kid = !!spec.kid;
  const bodyH = kid ? 4 : 6, legH = kid ? 4 : 6;
  const L0 = PTOP + 8 + bodyH;
  const ay = pose === 1 ? L0 + 2 : L0 + legH;
  s = finishArt(a, 8, ay);
  _people.set(key, s);
  return s;
}

let _shadow = null;
export function getShadowSprite() {
  if (_shadow) return _shadow;
  const c = document.createElement('canvas');
  c.width = 28; c.height = 14;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20,14,40,0.28)';
  g.beginPath(); g.ellipse(14, 7, 12, 5, 0, 0, 6.2832); g.fill();
  g.fillStyle = 'rgba(20,14,40,0.18)';
  g.beginPath(); g.ellipse(14, 7, 9, 3.5, 0, 0, 6.2832); g.fill();
  c.ax = 14; c.ay = 7;
  _shadow = c;
  return c;
}

// ───────────────────────── ground & floor tiles ─────────────────────────
const hash2 = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// Rasterise a 2:1 diamond tile (tessellates exactly). fn(x,y,u,v,rnd) -> colour; u runs along +x (down-right), v along +y (down-left).
function tileSprite(fn, seed = 0) {
  const a = makeArt(32, 16);
  const g = a.g;
  for (let y = 0; y < 16; y++) {
    const half = (y < 8 ? 4 * y + 2 : 4 * (15 - y) + 2) / 2;
    for (let x = Math.ceil(16 - half); x < 16 + half; x++) {
      const dx = x + 0.5 - 16, dy = y + 0.5 - 8;
      const u = (dx / 16 + dy / 8) / 2 + 0.5, v = (dy / 8 - dx / 16) / 2 + 0.5;
      const c = fn(x, y, u, v, hash2(x, y, seed));
      if (c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); }
    }
  }
  return finishArt(a, 16, 0, { outline: false });
}

const GROUND = {
  grass: () => tileSprite((x, y, u, v, r) => (r < 0.1 ? '#639f4c' : r > 0.93 ? '#9bd079' : r > 0.985 ? '#f6e27a' : '#7ab65f'), 1),
  grass2: () => tileSprite((x, y, u, v, r) => (r < 0.12 ? '#5f9a4a' : r > 0.9 ? '#92c872' : '#72ad58'), 2),
  sidewalk: () => tileSprite((x, y, u, v, r) => (u < 0.04 || v < 0.04 ? '#b4b3be' : r < 0.07 ? '#bdbcc7' : '#d4d3dc')),
  asphalt: () => tileSprite((x, y, u, v, r) => (r < 0.08 ? '#4a4f5b' : r > 0.94 ? '#6a6f7a' : '#575c69'), 3),
  asphalt_dash: () => tileSprite((x, y, u, v, r) => (Math.abs(v - 0.5) < 0.07 && u > 0.12 && u < 0.88 ? '#f1cf55' : r < 0.08 ? '#4a4f5b' : r > 0.94 ? '#6a6f7a' : '#575c69'), 3),
  curb: () => tileSprite((x, y, u, v, r) => (v > 0.88 ? '#e9e8ee' : r < 0.07 ? '#bdbcc7' : '#d4d3dc')),
  crosswalk: () => tileSprite((x, y, u, v, r) => {
    const band = (u > 0.08 && u < 0.28) || (u > 0.42 && u < 0.62) || (u > 0.76 && u < 0.96);
    return band ? '#efeee8' : (r < 0.08 ? '#4a4f5b' : '#575c69');
  }, 3),
  lot: () => tileSprite((x, y, u, v, r) => (u < 0.035 || v < 0.035 ? '#d7cfbd' : r < 0.04 ? '#e2dbc9' : '#efe9dc')),
  lot2: () => tileSprite((x, y, u, v, r) => (u < 0.035 || v < 0.035 ? '#d2cab7' : r < 0.04 ? '#ddd5c2' : '#e8e1d2')),
  doormat: () => tileSprite((x, y, u, v, r) => (u < 0.1 || u > 0.9 || v < 0.1 || v > 0.9 ? '#6b2b2b' : (x + y) % 3 === 0 ? '#9a3d3d' : '#8a3434')),
  floor_tile: () => tileSprite((x, y, u, v, r) => {
    if (u < 0.04 || v < 0.04) return '#216156';
    const rib = Math.floor(u * 6) & 1;
    return rib ? (r < 0.1 ? '#2a7468' : '#2f7f73') : (r < 0.1 ? '#3b9082' : '#3f968a');
  }),
  floor_wood: () => tileSprite((x, y, u, v, r) => {
    const plank = Math.floor(v * 4);
    if (Math.abs(v * 4 - Math.round(v * 4)) < 0.06) return '#7a4c22';
    const joint = Math.abs(((u + plank * 0.37) % 1) - 0.5) < 0.02;
    if (joint) return '#8a5a2b';
    return plank & 1 ? (r < 0.15 ? '#bc8650' : '#c89258') : (r < 0.15 ? '#b07a45' : '#be8a50');
  }),
  ramp: () => tileSprite((x, y, u, v, r) => {
    if (v < 0.1 || v > 0.9) return (Math.floor(u * 8) & 1) ? '#f2c230' : '#2d2d33';
    const sh = 1 - u * 0.25;
    const chev = Math.abs(((u * 4 + Math.abs(v - 0.5) * 2) % 1) - 0.5) < 0.12;
    const base = mix('#c9d0d8', '#8f98a4', 1 - sh + 0.15);
    return chev ? '#f5f7fa' : (r < 0.05 ? darken(base, 0.1) : base);
  }),
};

const _ground = new Map();
export function getGroundSprite(kind) {
  let s = _ground.get(kind);
  if (!s) {
    const f = GROUND[kind] || SCENE[kind];
    s = f ? f() : GROUND.lot();
    _ground.set(kind, s);
  }
  return s;
}

const _floors = new Map();
export function getFloorSprite(floorId) {
  if (artEnabled()) { const cf = conceptFloorSprite(floorId); if (cf) return cf; }   // concept style (art.js 'new'); classic falls through untouched
  let s = _floors.get(floorId);
  if (!s) {
    if (GROUND[floorId]) s = GROUND[floorId]();
    else {
      const def = BUILDABLES[floorId];
      const c = (def && def.top) || '#cccccc', d = (def && def.color) || '#999999';
      s = tileSprite((x, y, u, v, r) => (u < 0.04 || v < 0.04 ? d : r < 0.1 ? darken(c, 0.08) : c));
    }
    _floors.set(floorId, s);
  }
  return s;
}

// ───────────────────────── walls & scenery (anchored at the tile's top corner) ─────────────────────────
function piece(w, h, ax, ay, fn, outline = true) {
  const a = makeArt(w, h);
  const P = makePen(a.g, ax, ay, 0);
  fn(P);
  return finishArt(a, ax, ay, { outline });
}
const WALL = '#f1e8d4', WALL_T = '#d8cdb4', TEAL = '#3aa6a0', GLASS = '#a9dcf1';
const WH = 24;   // tall wall height in art px (= 48 px)

const SCENE = {
  wallL: () => piece(40, 44, 24, 32, P => {
    // plane x=0, thickness to -0.2; we draw as xy box through rot=0 helpers (u=x)
    P.box(-0.2, 0, 0, 1, 0, WH, WALL);
    P.fR(0, 1, 0, 0, 3, TEAL);
  }),
  wallL_win: () => piece(40, 44, 24, 32, P => {
    P.box(-0.2, 0, 0, 1, 0, WH, WALL);
    P.fR(0, 1, 0, 0, 3, TEAL);
    P.fR(0.14, 0.86, 0, 8, 20, '#ffffff'); P.fR(0.2, 0.8, 0, 9, 19, GLASS);
    P.fR(0.2, 0.8, 0, 9, 11, '#c9ecf8'); P.fR(0.48, 0.52, 0, 9, 19, '#ffffff');
  }),
  wallR: () => piece(40, 44, 16, 32, P => {
    P.box(0, -0.2, 1, 0, 0, WH, WALL);
    P.fL(0, 1, 0, 0, 3, TEAL);
  }),
  wallR_win: () => piece(40, 44, 16, 32, P => {
    P.box(0, -0.2, 1, 0, 0, WH, WALL);
    P.fL(0, 1, 0, 0, 3, TEAL);
    P.fL(0.14, 0.86, 0, 8, 20, '#ffffff'); P.fL(0.2, 0.8, 0, 9, 19, GLASS);
    P.fL(0.2, 0.8, 0, 9, 11, '#c9ecf8'); P.fL(0.48, 0.52, 0, 9, 19, '#ffffff');
  }),
  wallCorner: () => piece(40, 46, 20, 34, P => {
    P.box(-0.22, -0.22, 0.04, 0.04, 0, WH + 2, '#e6d9bd');
    P.fL(-0.22, 0.04, 0.04, 0, 3, TEAL);
  }),
  lowFront: () => piece(40, 24, 16, 14, P => {
    P.box(0, 0, 1, 0.18, 0, 5, WALL); P.box(0, 0, 1, 0.18, 5, 6, TEAL);
  }),
  lowSide: () => piece(40, 24, 16, 14, P => {
    P.box(0, 0, 0.18, 1, 0, 5, WALL); P.box(0, 0, 0.18, 1, 5, 6, TEAL);
  }),
  lowCorner: () => piece(40, 28, 16, 18, P => {
    P.box(0, 0, 0.22, 0.22, 0, 9, '#e6d9bd');
  }),
  doorFrame: () => piece(48, 52, 18, 40, P => {
    P.box(0, 0, 0.14, 0.2, 0, 25, '#e6d9bd');
    P.box(0.86, 0, 1, 0.2, 0, 25, '#e6d9bd');
    P.box(0, 0, 1, 0.2, 22, 26, TEAL);
    for (let i = 0; i < 5; i++) P.fL(i * 0.2, i * 0.2 + 0.2, 0.8, 19, 23, i & 1 ? '#fff4e0' : '#e0524a');
    P.box(0, 0.2, 1, 0.8, 23, 24, '#e0524a');
    P.fL(0.18, 0.82, 0, 6, 12, '#cfeaf5');
  }),
  tree: () => piece(48, 72, 24, 60, P => {
    P.box(0.42, 0.42, 0.58, 0.58, 0, 10, '#7a4f2a');
    P.ball(0.5, 0.5, 20, 10, '#3f8f4a'); P.ball(0.35, 0.55, 16, 7, '#4aa356'); P.ball(0.62, 0.45, 18, 8, '#3a8745'); P.ball(0.5, 0.5, 27, 7, '#5bb865');
  }),
  tree2: () => piece(48, 72, 24, 60, P => {
    P.box(0.44, 0.44, 0.56, 0.56, 0, 12, '#7a4f2a');
    P.ball(0.5, 0.5, 22, 9, '#e8a0b8'); P.ball(0.38, 0.5, 18, 6, '#f2b6c8'); P.ball(0.62, 0.5, 19, 7, '#dc8fa8'); P.ball(0.5, 0.45, 28, 6, '#f6c4d2');
  }),
  bush: () => piece(40, 30, 20, 20, P => { P.ball(0.4, 0.5, 6, 6, '#3f8f4a'); P.ball(0.62, 0.5, 6, 6, '#4aa356'); P.ball(0.5, 0.45, 10, 5, '#5bb865'); }),
  lamp: () => piece(24, 56, 12, 46, P => {
    P.box(0.46, 0.46, 0.54, 0.54, 0, 28, '#4a5362'); P.box(0.4, 0.4, 0.6, 0.6, 28, 31, '#ffe9a8'); P.box(0.38, 0.38, 0.62, 0.62, 31, 32, '#4a5362');
  }),
  bench: () => piece(40, 28, 16, 18, P => {
    P.box(0.1, 0.2, 0.9, 0.35, 2, 9, '#8b5a2b'); P.box(0.1, 0.35, 0.9, 0.8, 2, 4, '#b07a45');
    P.box(0.1, 0.2, 0.18, 0.28, 0, 2, '#444'); P.box(0.82, 0.2, 0.9, 0.28, 0, 2, '#444'); P.box(0.1, 0.72, 0.18, 0.8, 0, 2, '#444'); P.box(0.82, 0.72, 0.9, 0.8, 0, 2, '#444');
  }),
  planter: () => piece(40, 36, 20, 24, P => { P.box(0.15, 0.15, 0.85, 0.85, 0, 5, '#b86b43'); P.ball(0.35, 0.4, 8, 4, '#e8556b'); P.ball(0.6, 0.55, 8, 4, '#ffd23f'); P.ball(0.5, 0.3, 8, 4, '#ff9ac2'); P.top(0.18, 0.18, 0.82, 0.82, 5, '#5a8a3a'); P.ball(0.35, 0.4, 8, 3, '#e8556b'); P.ball(0.62, 0.58, 7, 3, '#ffd23f'); }),
};

// neighbouring buildings (3x2 footprint) for the backdrop
function bldg(w, d, hgt, col, win, roof) {
  const W = (w + d) * 16 + 8, H = (w + d) * 8 + hgt + 14;
  return piece(W, H, d * 16 + 4, hgt + 8, P => {
    P.box(0, 0, w, d, 0, hgt, col);
    const rows = Math.floor((hgt - 6) / 9);
    for (let r = 0; r < rows; r++) {
      for (let i = 0; i < w * 2 - 1; i++) P.fL(0.28 + i * 0.5, 0.28 + i * 0.5 + 0.28, d, 5 + r * 9, 10 + r * 9, hash2(i, r) < 0.25 ? '#ffe9a0' : win);
      for (let i = 0; i < d * 2 - 1; i++) P.fR(0.28 + i * 0.5, 0.28 + i * 0.5 + 0.28, w, 5 + r * 9, 10 + r * 9, hash2(i, r, 5) < 0.25 ? '#e8d28a' : darken(win, 0.2));
    }
    P.box(0.1, 0.1, w - 0.1, d - 0.1, hgt, hgt + 3, roof);
  });
}
SCENE.bldg0 = () => bldg(3, 2, 56, '#d9b8a0', '#7fb2cf', '#b98f76');
SCENE.bldg1 = () => bldg(3, 2, 80, '#a9bfd6', '#cfe6f5', '#8499b3');
SCENE.bldg2 = () => bldg(3, 2, 44, '#e6d0a0', '#8fc0d8', '#c8aa72');
SCENE.bldg3 = () => bldg(3, 2, 68, '#c7a8c9', '#d8eef8', '#9a7f9c');

const CAR_COLORS = ['#d9453b', '#3b82d9', '#f2c14e', '#4aa356', '#e8e8ee', '#8a5fd0'];
export function getCarSprite(i, dirSign) {
  const key = 'car' + (i % CAR_COLORS.length) + (dirSign < 0 ? 'b' : 'f');
  let s = _ground.get(key);
  if (s) return s;
  const col = CAR_COLORS[i % CAR_COLORS.length];
  s = piece(64, 40, 16, 26, P => {
    P.box(0.06, 0.12, 1.94, 0.88, 3, 8, col);
    P.box(0.5, 0.18, 1.45, 0.82, 8, 13, '#aee0f5'); P.box(0.52, 0.2, 1.43, 0.8, 12, 13, col);
    P.fL(0.55, 0.9, 0.82, 8.5, 12, '#7fc4e0'); P.fL(1.0, 1.4, 0.82, 8.5, 12, '#7fc4e0');
    P.fR(0.2, 0.8, 1.94, 4, 7, dirSign > 0 ? '#fff3b0' : '#e8392f');
    P.fR(0.2, 0.8, 0.06, 4, 7, dirSign > 0 ? '#e8392f' : '#fff3b0');
    P.ball(0.4, 0.9, 2, 2.5, '#22222a', false); P.ball(1.6, 0.9, 2, 2.5, '#22222a', false);
  });
  _ground.set(key, s);
  return s;
}
export const CAR_VARIANTS = CAR_COLORS.length;

// ───────────────────────── objects ─────────────────────────
const WOOD = '#b9854f', WOOD_D = '#8b5e34', METAL = '#aeb8bf', WHITE = '#f4f1ea', SCREEN = '#1f2a35';
const PAL_BALLS = ['#ef5350', '#ffca28', '#42a5f5', '#66bb6a', '#ab47bc', '#ff7043'];

function colSet(def) {
  const base = faceSet(def.color || '#999999');
  return def.top ? { ...base, t: def.top, hi: lighten(def.top, 0.35) } : base;
}

// Mini-room with partition walls. furnish(P) draws the interior (back-to-front).
function room(P, w, h, o, furnish) {
  const WT = 0.16, H = o.wallH || 22;
  P.box(0, 0, w, h, 0, 1.5, o.floor);
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if ((i + j) & 1) P.top(i, j, i + 1, j + 1, 1.5, o.floor2 || lighten(o.floor, 0.09));
  P.box(0, 0, w, WT, 1.5, H, o.wall);
  P.box(0, WT, WT, h, 1.5, H, o.wall);
  P.fL(WT, w, WT, 1.5, 4.5, o.base || TEAL);
  P.fR(WT, h, WT, 1.5, 4.5, o.base || TEAL);
  P.fL(0, w, WT, H - 1.5, H, lighten(o.wall, 0.3));
  if (o.decor) o.decor(P);
  furnish(P);
  const gapA = w / 2 - 0.34, gapB = w / 2 + 0.34;
  const gapC = h / 2 - 0.34, gapD = h / 2 + 0.34;
  const lowH = 5.5, acc = o.base || TEAL;
  P.box(WT, h - 0.12, gapA, h, 1.5, lowH, o.wall); P.box(gapB, h - 0.12, w, h, 1.5, lowH, o.wall);
  P.box(WT, h - 0.12, gapA, h, lowH, lowH + 1, acc); P.box(gapB, h - 0.12, w, h, lowH, lowH + 1, acc);
  P.box(w - 0.12, WT, w, gapC, 1.5, lowH, o.wall); P.box(w - 0.12, gapD, w, h - 0.12, 1.5, lowH, o.wall);
  P.box(w - 0.12, WT, w, gapC, lowH, lowH + 1, acc); P.box(w - 0.12, gapD, w, h - 0.12, lowH, lowH + 1, acc);
  P.box(0, h - 0.12, WT, h, 1.5, H - 6, o.wall);   // corner posts
  P.box(w - 0.12, 0, w, WT, 1.5, H - 6, o.wall);
}

function window2(P, u0, u1, v, z0, z1) {
  P.fL(u0, u1, v, z0, z1, '#ffffff'); P.fL(u0 + 0.06, u1 - 0.06, v, z0 + 1, z1 - 1, GLASS);
  P.fL(u0 + 0.06, u1 - 0.06, v, z1 - 4, z1 - 1, '#d4f0fb'); P.fL((u0 + u1) / 2 - 0.02, (u0 + u1) / 2 + 0.02, v, z0 + 1, z1 - 1, '#ffffff');
}
function bedUnit(P, u0, v0, u1, v1, z, sheet, pillowV) {
  P.box(u0, v0, u1, v1, z, z + 2.5, '#eef2f6');
  P.box(u0 + 0.02, v0 + 0.02, u1 - 0.02, v1 - 0.02, z + 2.5, z + 4.5, sheet);
  P.box(u0 + 0.06, v0 + 0.04, u1 - 0.06, v0 + 0.04 + pillowV, z + 4.5, z + 6, '#ffffff');
}

const ROOMS = {
  exam_room: { wall: '#e8f1f0', floor: '#cfe6e4', base: TEAL,
    decor(P) {
      P.fR(0.3, 1.1, 0.16, 7, 19, '#ffffff'); P.fR(0.55, 0.85, 0.16, 11, 17, '#f0a0a0'); P.fR(0.62, 0.78, 0.16, 8, 11, '#6aa7ff'); P.fR(0.6, 0.8, 0.16, 17, 19, '#f0a0a0');
      window2(P, 1.1, 1.8, 0.16, 8, 19);
    },
    furnish(P) {
      P.box(0.28, 0.5, 0.8, 1.65, 1.5, 6, '#e3eeed'); P.box(0.28, 0.5, 0.8, 1.65, 6, 7.5, TEAL); P.box(0.3, 0.5, 0.78, 0.72, 7.5, 9, '#ffffff');
      P.box(1.1, 0.3, 1.9, 0.78, 1.5, 8, WOOD); P.box(1.1, 0.3, 1.9, 0.78, 8, 9, '#dcb98a');
      P.box(1.35, 0.35, 1.65, 0.48, 9, 10.5, '#333'); P.box(1.25, 0.3, 1.75, 0.4, 10.5, 16, '#2b3440'); P.fL(1.28, 1.72, 0.4, 11.5, 15, '#6fd0ff');
      P.box(1.7, 0.5, 1.85, 0.72, 9, 10.5, '#ffffff');
      P.box(1.25, 1.0, 1.55, 1.3, 1.5, 5, '#5c6670'); P.box(1.3, 1.05, 1.5, 1.25, 5, 6, '#3a424c');
    } },
  us_room: { wall: '#9db4d0', floor: '#5d6b82', floor2: '#667590', base: '#3a4f73',
    decor(P) { P.fR(0.3, 1.1, 0.16, 8, 18, '#2b3a55'); P.fR(0.4, 1.0, 0.16, 10, 16, '#58d6b0'); window2(P, 1.2, 1.8, 0.16, 8, 18); },
    furnish(P) {
      P.box(0.3, 0.5, 0.88, 1.8, 1.5, 6, '#e9f1f7'); P.box(0.32, 0.52, 0.86, 1.78, 6, 7.5, '#6aa3d8'); P.box(0.34, 0.52, 0.84, 0.74, 7.5, 9, '#fff');
      P.box(1.3, 0.35, 1.85, 0.95, 1.5, 11, '#e9edf0');
      P.box(1.35, 0.3, 1.8, 0.45, 11, 12, '#c3ccd3'); P.box(1.3, 0.3, 1.85, 0.42, 12, 21, '#222a33'); P.fL(1.34, 1.81, 0.42, 13, 20, '#0d2a1d');
      P.ln(1.38, 0.42, 16, 1.5, 0.42, 19, '#53ff9a'); P.ln(1.5, 0.42, 19, 1.6, 0.42, 15, '#53ff9a'); P.ln(1.6, 0.42, 15, 1.78, 0.42, 17, '#53ff9a');
      P.fL(1.35, 1.8, 0.95, 4, 6, '#9aa7b3'); P.ball(1.2, 0.95, 7, 1.6, '#444');
    } },
  rest_room: { wall: '#f2d6bf', floor: '#d7b48c', floor2: '#cba47c', base: '#c27a5a',
    decor(P) { window2(P, 0.9, 1.6, 0.16, 8, 19); P.fR(0.4, 0.9, 0.16, 9, 16, '#f4a3b8'); P.fR(0.45, 0.85, 0.16, 11, 14, '#fff3d0'); },
    furnish(P) {
      bedUnit(P, 0.3, 0.45, 1.0, 1.75, 1.5, '#f48fb1', 0.35);
      P.box(1.35, 0.3, 1.8, 0.7, 1.5, 7, '#a86b43'); P.box(1.5, 0.4, 1.65, 0.55, 7, 10, '#f5e6a8'); P.ball(1.575, 0.475, 12, 3, '#ffe9a0');
      P.box(1.4, 1.2, 1.7, 1.5, 1.5, 4, '#c0673e'); P.ball(1.55, 1.35, 8, 3.5, '#4aa356'); P.ball(1.45, 1.3, 7, 2.5, '#5bb865');
    } },
  shockwave_room: { wall: '#e1dcf2', floor: '#aeb4c6', floor2: '#b8bed0', base: '#6c5fa8',
    decor(P) { P.fR(0.3, 1.1, 0.16, 8, 18, '#ffffff'); P.fR(0.45, 0.95, 0.16, 11, 15, '#b9a6f0'); P.fR(0.55, 0.85, 0.16, 12, 14, '#7a65d6'); window2(P, 1.2, 1.8, 0.16, 8, 18); },
    furnish(P) {
      bedUnit(P, 0.3, 0.5, 0.95, 1.8, 1.5, '#8aa0d6', 0.3);
      P.box(1.3, 0.35, 1.8, 0.85, 1.5, 11, '#f08c3a'); P.box(1.3, 0.35, 1.8, 0.5, 11, 12, '#c7701f'); P.box(1.35, 0.3, 1.75, 0.42, 12, 20, '#222'); P.fL(1.4, 1.7, 0.42, 13, 19, '#ffcf70');
      P.ln(1.3, 0.8, 8, 1.05, 1.1, 8, '#222'); P.ball(1.05, 1.15, 8, 1.8, '#d9d9e0');
    } },
  laser_room: { wall: '#f0d6d8', floor: '#9aa0ad', floor2: '#a4aab7', base: '#a1303f',
    decor(P) { P.poly3([[1.0, 0.16, 8], [1.5, 0.16, 8], [1.25, 0.16, 18]].map(q => [q[0], q[1], q[2]]), '#ffc400'); P.fL(1.22, 1.28, 0.16, 10, 14, '#2a2233'); P.fR(0.3, 1.0, 0.16, 8, 17, '#fff'); P.fR(0.4, 0.9, 0.16, 10, 15, '#e8392f'); },
    furnish(P) {
      bedUnit(P, 0.3, 0.5, 0.95, 1.8, 1.5, '#dbe3ee', 0.3);
      P.box(1.4, 0.3, 1.85, 0.7, 1.5, 17, '#7a1f2b'); P.fL(1.45, 1.8, 0.7, 10, 15, '#222'); P.fL(1.5, 1.7, 0.7, 11, 14, '#ff6a6a');
      P.ln(1.4, 0.5, 17, 1.0, 1.1, 20, '#9aa0ad'); P.ball(1.0, 1.1, 20, 2.2, '#c7c7d2'); P.ln(1.0, 1.1, 18, 0.7, 1.15, 9, '#ff3030');
    } },
  manual_room: { wall: '#e9d3b3', floor: '#c9a574', floor2: '#bf9a68', base: '#7a5632',
    decor(P) {
      P.box(1.15, 0.17, 1.9, 0.38, 9, 10, WOOD_D); P.box(1.2, 0.18, 1.35, 0.3, 10, 15, '#f4c542'); P.box(1.45, 0.18, 1.6, 0.3, 10, 17, '#7fd1c8'); P.box(1.7, 0.18, 1.83, 0.3, 10, 14, '#e87fae');
      P.fR(0.4, 1.0, 0.16, 9, 17, '#fff'); P.fR(0.5, 0.9, 0.16, 11, 15, '#9fcf8a');
    },
    furnish(P) {
      P.box(0.3, 0.5, 0.2 + 0.8, 1.8, 1.5, 3.5, WOOD_D); P.box(0.3, 0.5, 1.0, 1.8, 3.5, 7, '#f3ece0'); P.box(0.3, 0.5, 1.0, 0.8, 7, 8, '#8fc27a');
      P.box(0.26, 0.46, 0.34, 0.54, 0, 3.5, WOOD_D);
      P.box(1.35, 1.1, 1.65, 1.4, 1.5, 5, '#5c6670'); P.box(1.4, 1.15, 1.6, 1.35, 5, 6, '#3a424c');
      P.ball(1.5, 0.75, 4, 3.5, '#4aa356'); P.box(1.4, 0.6, 1.6, 0.8, 1.5, 3, '#c0673e');
    } },
  speech_room: { wall: '#e2d6f2', floor: '#d3c8e8', floor2: '#dcd2ee', base: '#7d55a0',
    decor(P) { P.fL(0.3, 1.5, 0.16, 6, 19, '#ffffff'); P.fL(0.36, 1.44, 0.16, 7, 18, '#d6eef8'); P.fL(0.5, 0.8, 0.16, 12, 13, '#ffffff'); P.fR(0.4, 1.0, 0.16, 9, 17, '#fff'); P.fR(0.5, 0.9, 0.16, 11, 15, '#f0a0c0'); },
    furnish(P) {
      P.box(0.8, 0.5, 1.6, 1.1, 1.5, 6.5, WOOD); P.box(0.8, 0.5, 1.6, 1.1, 6.5, 7.5, '#e8cfa0');
      P.box(1.0, 0.6, 1.15, 0.75, 7.5, 9.5, '#ef5350'); P.box(1.25, 0.7, 1.4, 0.85, 7.5, 9.5, '#42a5f5'); P.box(1.3, 0.55, 1.5, 0.65, 7.5, 8.5, '#ffca28');
      P.box(0.3, 0.7, 0.55, 0.95, 1.5, 5, '#7d55a0'); P.box(1.7, 1.3, 1.95, 1.55, 1.5, 5, '#8e5ea8');
    } },
  si_room: { wall: '#fff0c4', floor: '#ffd98a', floor2: '#ffc56b', base: '#ff8f3d', wallH: 24,
    decor(P) {
      const cs = ['#ef5350', '#ffca28', '#42a5f5', '#66bb6a', '#ab47bc', '#ff7043'];
      for (let i = 0; i < 7; i++) P.fL(0.5 + i * 0.38, 0.5 + i * 0.38 + 0.2, 0.16, 8 + (i % 3) * 4, 11 + (i % 3) * 4, cs[i % cs.length]);
      for (let i = 0; i < 5; i++) P.fR(0.5 + i * 0.5, 0.5 + i * 0.5 + 0.22, 0.16, 8 + (i % 2) * 5, 11 + (i % 2) * 5, cs[(i + 2) % cs.length]);
    },
    furnish(P) {
      P.top(0.4, 1.7, 1.7, 2.8, 1.5, '#6cc1f0');
      P.box(0.35, 0.4, 1.5, 0.6, 1.5, 4.5, '#c07a3a');
      P.box(1.9, 0.4, 2.85, 1.5, 1.5, 3, '#2aa5b8');
      for (let k = 0; k < 14; k++) P.ball(2.0 + (k % 4) * 0.22 + hash2(k, 1) * 0.05, 0.5 + Math.floor(k / 4) * 0.28, 4, 1.9, PAL_BALLS[k % 6]);
      P.box(1.9, 1.38, 2.85, 1.5, 3, 4.8, '#2aa5b8');
      P.box(2.2, 2.1, 2.5, 2.4, 1.5, 6, '#ab47bc'); P.box(2.25, 2.15, 2.45, 2.35, 6, 8, '#e1bee7');
    } },
};

const OBJ = {
  sofa(P, o) {
    const c = o.def.color || '#c2475a';
    P.box(0.04, 0.04, o.w - 0.04, 0.34, 0, 13, c);
    P.box(0.04, 0.3, o.w - 0.04, 0.98, 0, 5.5, c);
    for (let i = 0; i < o.w; i++) { P.top(i + 0.06, 0.34, i + 0.94, 0.96, 5.5, lighten(c, 0.2)); P.ln(i, 0.34, 5.5, i, 0.96, 5.5, darken(c, 0.35)); }
    P.box(0, 0.04, 0.2, 0.98, 0, 9, darken(c, 0.1)); P.box(o.w - 0.2, 0.04, o.w, 0.98, 0, 9, darken(c, 0.1));
    P.box(0.3, 0.38, 0.62, 0.62, 5.5, 9, '#ffd166');
  },
  water(P, o) {
    P.box(0.28, 0.28, 0.72, 0.72, 0, 10, '#e9eef2'); P.fL(0.32, 0.68, 0.72, 2, 8, o.def.color || '#3b7fd1');
    P.fL(0.45, 0.55, 0.72, 5, 6, '#e9eef2'); P.fL(0.3, 0.4, 0.72, 6, 7, '#e8392f'); P.fL(0.6, 0.7, 0.72, 6, 7, '#3b7fd1');
    P.box(0.33, 0.33, 0.67, 0.67, 10, 20, '#8ccaff'); P.box(0.4, 0.4, 0.6, 0.6, 20, 22, '#6aaee8'); P.fL(0.36, 0.44, 0.67, 12, 19, '#c9e8ff');
  },
  tv(P, o) {
    P.box(0.1, 0.35, o.w - 0.1, 0.85, 0, 5, '#6b4e31'); P.fL(0.2, o.w - 0.2, 0.85, 1, 4, '#563d26');
    P.box(0.15, 0.42, o.w - 0.15, 0.56, 5, 18, '#15171c'); P.fL(0.2, o.w - 0.2, 0.56, 6, 17, '#3f78c0'); P.fL(0.2, o.w - 0.2, 0.56, 12, 17, '#6aa3e0');
    P.fL(0.5, 0.7, 0.56, 7, 11, '#ffd166'); P.fL(1.0, 1.5, 0.56, 8, 9, '#fff'); P.fL(1.0, 1.3, 0.56, 10, 11, '#fff');
    P.box(0.55, 0.45, 0.65, 0.55, 18, 19, '#15171c');
  },
  plant(P) {
    P.box(0.3, 0.3, 0.7, 0.7, 0, 6, '#c0673e'); P.top(0.32, 0.32, 0.68, 0.68, 6, '#5a3a22'); P.box(0.28, 0.28, 0.72, 0.72, 5, 7, '#d4784b');
    P.ball(0.35, 0.5, 10, 4.5, '#2e8b3e'); P.ball(0.65, 0.45, 11, 4.5, '#3aa04c'); P.ball(0.5, 0.65, 11, 4.5, '#34953f'); P.ball(0.5, 0.45, 16, 5, '#4cb95c'); P.ball(0.42, 0.52, 20, 3.5, '#5fd070');
  },
  sign(P) {
    P.box(0.3, 0.46, 0.7, 0.5, 0, 12, '#4a5362'); P.box(0.28, 0.5, 0.72, 0.62, 0, 1, '#4a5362');
    P.box(0.22, 0.4, 0.78, 0.5, 4, 14, '#f2b705'); P.fL(0.28, 0.72, 0.5, 5.5, 12.5, '#ffd966');
    P.fL(0.34, 0.66, 0.5, 8.5, 9.5, '#2a2233'); P.ln(0.58, 0.5, 11, 0.68, 0.5, 9, '#2a2233'); P.ln(0.58, 0.5, 7, 0.68, 0.5, 9, '#2a2233');
  },
  reception(P, o) {
    P.box(0.05, 0.1, o.w - 0.05, 0.5, 0, 9, '#c9b58f');
    P.box(0.05, 0.45, o.w - 0.05, 0.98, 0, 10, WOOD); P.fL(0.1, o.w - 0.1, 0.98, 1, 9, '#d9c7a5');
    P.fL(0.35, o.w - 0.35, 0.98, 3, 8, TEAL); P.fL(0.5 * o.w - 0.04, 0.5 * o.w + 0.04, 0.98, 3.5, 7.5, '#fff'); P.fL(0.5 * o.w - 0.14, 0.5 * o.w + 0.14, 0.98, 5, 6, '#fff');
    P.box(0, 0.42, o.w, 1.0, 10, 11.5, '#f3e6cc');
    P.box(0.3, 0.3, 0.7, 0.4, 11.5, 13, '#333'); P.box(0.25, 0.22, 0.75, 0.3, 13, 19, '#2b3440'); P.fL(0.28, 0.72, 0.3, 14, 18, '#7fd1ff');
    P.ball(o.w - 0.5, 0.75, 13, 1.6, '#ffd23f'); P.box(o.w - 1.0, 0.6, o.w - 0.8, 0.8, 11.5, 12.5, '#fff');
  },
  heatbox(P) {
    P.box(0.12, 0.12, 0.88, 0.88, 0, 9, '#efe9df'); P.fL(0.2, 0.8, 0.88, 2, 8, '#c8c2b8');
    for (let i = 0; i < 4; i++) P.fL(0.24 + i * 0.14, 0.3 + i * 0.14, 0.88, 3, 7, i % 2 ? '#ff7a3d' : '#ffb24a');
    P.box(0.08, 0.08, 0.92, 0.92, 9, 12.5, '#d2452f'); P.fL(0.4, 0.6, 0.92, 10, 11.5, '#ffd0c0');
    P.dot(0.35, 0.5, 15, '#fff'); P.dot(0.55, 0.45, 17, '#fff'); P.dot(0.45, 0.55, 19, '#ffffffaa');
  },
  tens(P, o) {
    P.box(0.18, 0.18, 0.82, 0.82, 0, 6, '#cfd6dd'); P.fL(0.24, 0.76, 0.82, 1, 5, '#aab4bd');
    P.box(0.24, 0.24, 0.76, 0.68, 6, 12, o.def.color || '#5b4bb8'); P.fL(0.3, 0.7, 0.68, 7, 11, '#b8f0c8');
    P.ln(0.34, 0.68, 9, 0.46, 0.68, 10, '#1d6b3a'); P.ln(0.46, 0.68, 10, 0.58, 0.68, 8, '#1d6b3a');
    P.px(0.3, 0.7, 13, 1, 1, '#ff5252'); P.px(0.7, 0.7, 13, 1, 1, '#5aff8a');
    P.ball(0.3, 0.9, 6, 2, '#f4c542'); P.ball(0.72, 0.92, 6, 2, '#f4c542');
    P.ln(0.3, 0.9, 6, 0.4, 0.8, 8, '#222'); P.ln(0.72, 0.92, 6, 0.6, 0.8, 8, '#222');
  },
  traction(P) {
    for (const [u, v] of [[0.2, 0.2], [0.72, 0.2], [0.2, 1.72], [0.72, 1.72]]) P.box(u, v, u + 0.08, v + 0.08, 0, 3, '#5c6670');
    P.box(0.18, 0.18, 0.82, 1.82, 3, 7, '#d8cdb8'); P.box(0.18, 0.18, 0.82, 1.82, 7, 8, '#4a9aa8');
    P.box(0.2, 0.2, 0.8, 0.5, 8, 9.5, '#fff');
    P.box(0.32, 0.04, 0.68, 0.22, 0, 26, '#8d99a3'); P.fL(0.38, 0.62, 0.22, 12, 20, '#222'); P.fL(0.42, 0.58, 0.22, 14, 18, '#68e08a');
    P.box(0.36, 0.04, 0.64, 1.0, 24, 27, '#aab4bd');
    P.ln(0.5, 1.0, 24, 0.5, 1.0, 12, '#444'); P.box(0.42, 0.95, 0.58, 1.06, 10, 12, '#f08c3a');
  },
  ir_lamp(P) {
    P.disc(0.5, 0.5, 1, 7, 3.5, '#4a4a54'); P.box(0.3, 0.3, 0.7, 0.7, 0, 2, '#33333c');
    P.box(0.46, 0.46, 0.54, 0.54, 2, 22, '#8a8a96');
    P.box(0.28, 0.34, 0.72, 0.7, 20, 27, '#c77d12'); P.fL(0.32, 0.68, 0.7, 21, 26, '#ff4a2a'); P.fL(0.4, 0.6, 0.7, 23, 25, '#ffb38a');
    P.box(0.4, 0.3, 0.6, 0.38, 27, 28, '#8a8a96');
    P.dot(0.5, 0.8, 16, '#ff8a6a'); P.dot(0.4, 0.82, 12, '#ff8a6a'); P.dot(0.6, 0.82, 9, '#ff8a6a');
  },
  bed(P) {
    for (const [u, v] of [[0.16, 0.16], [0.78, 0.16], [0.16, 1.78], [0.78, 1.78]]) P.box(u, v, u + 0.06, v + 0.06, 0, 4, '#8a96a3');
    P.box(0.12, 0.12, 0.88, 1.88, 4, 7, '#eef2f6'); P.box(0.14, 0.14, 0.86, 1.86, 7, 9, '#7fb3d9');
    P.box(0.2, 0.18, 0.8, 0.55, 9, 11, '#ffffff'); P.box(0.14, 1.1, 0.86, 1.86, 9, 10, '#5f9bc7');
  },
  redcord(P) {
    P.box(0.15, 0.15, 1.85, 1.85, 0, 1.5, '#4a7eb0'); P.top(0.25, 0.25, 1.75, 1.75, 1.5, '#5f95c9');
    P.box(0.12, 0.12, 0.22, 0.22, 0, 26, '#e9eef2'); P.box(1.78, 0.12, 1.88, 0.22, 0, 26, '#e9eef2');
    P.box(0.12, 0.12, 1.88, 0.22, 24, 27, '#e9eef2');
    P.ln(0.6, 0.2, 24, 0.7, 0.95, 7, '#e8392f'); P.ln(0.62, 0.2, 24, 0.72, 0.95, 7, '#e8392f'); P.ln(1.3, 0.2, 24, 1.2, 0.95, 7, '#e8392f'); P.ln(1.32, 0.2, 24, 1.22, 0.95, 7, '#e8392f');
    P.box(0.62, 0.9, 0.82, 1.0, 5, 7, '#222'); P.box(1.1, 0.9, 1.3, 1.0, 5, 7, '#222');
    P.box(0.12, 1.78, 0.22, 1.88, 0, 26, '#e9eef2'); P.box(1.78, 1.78, 1.88, 1.88, 0, 26, '#e9eef2');
    P.box(0.12, 1.78, 1.88, 1.88, 24, 27, '#e9eef2');
  },
  fine_table(P, o) {
    for (const [u, v] of [[0.12, 0.2], [o.w - 0.2, 0.2], [0.12, 0.78], [o.w - 0.2, 0.78]]) P.box(u, v, u + 0.08, v + 0.08, 0, 5, WOOD_D);
    P.box(0.08, 0.15, o.w - 0.08, 0.88, 5, 7, o.def.top || '#e8cb6a');
    P.box(0.3, 0.3, 0.45, 0.45, 7, 10, '#ef5350'); P.box(0.55, 0.4, 0.7, 0.55, 7, 9, '#42a5f5'); P.box(0.8, 0.3, 0.95, 0.45, 7, 11, '#66bb6a'); P.box(1.2, 0.4, 1.7, 0.7, 7, 8, '#fff'); P.ball(1.3, 0.55, 8, 1.2, '#ff7043'); P.ball(1.45, 0.5, 8, 1.2, '#ab47bc'); P.ball(1.6, 0.6, 8, 1.2, '#ffca28');
  },
  shockwave(P) {
    P.box(0.2, 0.2, 0.8, 0.8, 2, 12, '#37474f'); P.fL(0.28, 0.72, 0.8, 4, 10, '#546e7a');
    P.ball(0.25, 0.25, 1, 1.8, '#222', false); P.ball(0.75, 0.25, 1, 1.8, '#222', false); P.ball(0.25, 0.78, 1, 1.8, '#222', false); P.ball(0.75, 0.78, 1, 1.8, '#222', false);
    P.box(0.24, 0.24, 0.76, 0.5, 12, 19, '#15202a'); P.fL(0.3, 0.7, 0.5, 13, 18, '#ffb347'); P.ln(0.36, 0.5, 15, 0.46, 0.5, 17, '#fff'); P.ln(0.46, 0.5, 17, 0.58, 0.5, 14, '#fff');
    P.ln(0.8, 0.5, 9, 0.95, 0.9, 6, '#222'); P.ball(0.95, 0.9, 6, 2, '#cfd8dc');
  },
  coffee(P) {
    P.box(0.1, 0.12, 0.9, 0.9, 0, 8, '#8d6e63'); P.fL(0.16, 0.84, 0.9, 1, 7, '#6d4c41');
    P.box(0.2, 0.16, 0.8, 0.7, 8, 20, '#3a2a26'); P.fL(0.28, 0.72, 0.7, 14, 18, '#1d1514'); P.fL(0.3, 0.4, 0.7, 15, 17, '#e8392f'); P.fL(0.6, 0.7, 0.7, 15, 17, '#53ff9a');
    P.fL(0.3, 0.7, 0.7, 9, 12, '#cfd8dc');
    P.box(0.42, 0.74, 0.58, 0.88, 8, 11, '#f4f1ea'); P.dot(0.5, 0.8, 13, '#fff'); P.dot(0.46, 0.8, 15, '#ffffffbb');
  },
  ball_pit(P, o) {
    P.box(0.05, 0.05, 1.95, 0.2, 0, 5, '#00acc1'); P.box(0.05, 0.2, 0.2, 1.95, 0, 5, '#00acc1');
    P.top(0.2, 0.2, 1.95, 1.95, 3, '#4fc3d6');
    for (let k = 0; k < 30; k++) { const u = 0.3 + (k % 6) * 0.27 + hash2(k, 2) * 0.06, v = 0.3 + Math.floor(k / 6) * 0.34 + hash2(k, 3) * 0.06; P.ball(u, v, 4, 2, PAL_BALLS[(k * 7) % 6]); }
    P.box(1.8, 0.2, 1.95, 1.95, 0, 5, '#00acc1'); P.box(0.2, 1.8, 1.8, 1.95, 0, 5, '#00acc1');
    P.fL(0.3, 1.7, 1.95, 1, 4, '#26c6da');
  },
  soft_mat(P, o) {
    const cs = ['#ef9a9a', '#ffe082', '#80cbc4', '#90caf9'];
    for (let i = 0; i < o.w; i++) { P.box(i + 0.02, 0.02, i + 0.98, 0.98, 0, 2.5, cs[i % 4]); P.box(i + 0.02, 0.02, i + 0.5, 0.5, 2.5, 3, lighten(cs[i % 4], 0.2)); }
  },
  bookshelf(P, o) {
    P.box(0.05, 0.1, o.w - 0.05, 0.5, 0, 22, '#a1887f'); P.fL(0.1, o.w - 0.1, 0.5, 2, 21, '#6d4c41');
    const cs = ['#ef5350', '#ffca28', '#42a5f5', '#66bb6a', '#ab47bc', '#ff7043', '#26c6da'];
    for (let r = 0; r < 3; r++) {
      const z = 3 + r * 6.5;
      for (let i = 0; i < 15; i++) { const u = 0.13 + i * ((o.w - 0.26) / 15); P.fL(u, u + 0.09, 0.5, z, z + 4 + Math.floor(hash2(i, r) * 2), cs[(i + r * 3) % cs.length]); }
      P.fL(0.1, o.w - 0.1, 0.5, z - 1, z, '#a1887f');
    }
    P.box(0.05, 0.1, o.w - 0.05, 0.5, 22, 23, '#d7ccc8');
  },
};

const HMAX = { sofa: 18, water: 26, tv: 24, plant: 28, sign: 18, reception: 24, heatbox: 22, tens: 18, traction: 32, ir_lamp: 34, bed: 16, redcord: 34, fine_table: 18, shockwave: 24, coffee: 24, ball_pit: 14, soft_mat: 6, bookshelf: 28, si_room: 32 };

const _objs = new Map();
export function getObjectSprite(defId, rot) {
  const adef = BUILDABLES[defId];
  if (adef) { const as = artObjectSprite(adef, rot ? 1 : 0); if (as) return as; }   // atlas art (null unless loaded + enabled + matched)
  if (artEnabled()) { const cs = conceptObjectSprite(defId, rot ? 1 : 0); if (cs) return cs; }   // concept-style procedural redraw (concept_objects.js)
  const key = defId + (rot ? ':1' : ':0');
  let s = _objs.get(key);
  if (s) return s;
  const def = BUILDABLES[defId] || { id: defId, w: 1, h: 1, color: '#ff00ff', top: '#ff88ff', height: 12 };
  const r = rot ? 1 : 0;
  const w = def.w, h = def.h;
  const fw = r ? h : w, fh = r ? w : h;
  const room_ = ROOMS[defId];
  const hmax = room_ ? (room_.wallH || 22) + 6 : (HMAX[defId] || Math.ceil((def.height || 16) / 2) + 8);
  const pad = 4;
  const W = (fw + fh) * 16 + pad * 2, Hh = (fw + fh) * 8 + hmax + pad * 2;
  const ax = fh * 16 + pad, ay = hmax + pad;
  const a = makeArt(W, Hh);
  const P = makePen(a.g, ax, ay, r);
  const o = { def, w, h };
  if (room_) room(P, w, h, room_, room_.furnish);
  else if (OBJ[defId]) OBJ[defId](P, o);
  else P.box(0.05, 0.05, w - 0.05, h - 0.05, 0, Math.max(2, (def.height || 12) / 2), colSet(def));
  s = finishArt(a, ax, ay);
  if (!room_ && !OBJ[defId] && def.glyph) {
    const g = s.getContext('2d');
    g.font = '18px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(def.glyph, s.ax + (fw / 2 - fh / 2) * 32, s.ay + (fw / 2 + fh / 2) * 16 - (def.height || 12));
  }
  _objs.set(key, s);
  return s;
}

// alpha lookup for pixel-accurate hit tests
const _alpha = new WeakMap();
export function spriteHit(sprite, px, py) {
  if (sprite.art) { const f = sprite.width / sprite.dw; px *= f; py *= f; }       // atlas sprites are drawn at dw x dh world px
  if (px < 0 || py < 0 || px >= sprite.width || py >= sprite.height) return false;
  let m = _alpha.get(sprite);
  if (!m) {
    const d = sprite.getContext('2d').getImageData(0, 0, sprite.width, sprite.height).data;
    m = new Uint8Array(sprite.width * sprite.height);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] > 40 ? 1 : 0;
    _alpha.set(sprite, m);
  }
  return m[(py | 0) * sprite.width + (px | 0)] === 1;
}

// Pre-render everything once (called by initRenderer) so no hitches happen mid-game.
export function warmSprites() {
  for (const id of Object.keys(BUILDABLES)) {
    const d = BUILDABLES[id];
    if (d.layer === 'floor') getFloorSprite(id); else { getObjectSprite(id, 0); getObjectSprite(id, 1); }
  }
  for (const k of Object.keys(GROUND)) getGroundSprite(k);
  for (const k of Object.keys(SCENE)) getGroundSprite(k);
  for (const k of Object.keys(ICONS)) getIconSprite(k);
  for (const k of PERSON_KINDS) {
    for (let d = 0; d < 4; d++) for (let f = 0; f < 4; f++) getPersonSprite(k, d, f, { variant: 0 });
  }
}
