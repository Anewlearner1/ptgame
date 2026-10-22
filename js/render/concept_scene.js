// Concept-style SCENE art (S-O): ground, building shell, backdrop, cars, status icons, shadows, overlays (bubbles, bars,
// zone glow, weather). Everything is vector-drawn (canvas paths) at an internal 2x resolution and cached; nothing here is
// used unless art.js artEnabled() is true (renderer.js branches), so the "classic" pixel-art scene is untouched.
// Palette / rules: docs/ART_STYLE.md. Light comes from the upper left: left faces mid, right faces dark, top brightest.
import { MAP_W, MAP_H } from '../core/constants.js';

const K = 2;                                   // internal supersampling of every cached sprite
export const OUT = '#14111b';                  // outline colour (never pure black)
export const FONT = '"Noto Sans TC","PingFang TC","Microsoft JhengHei","Heiti TC",sans-serif';
const TAU = Math.PI * 2;

// ───────────────────────── colour helpers ─────────────────────────
function rgb(h) {
  if (h[0] !== '#') return [128, 128, 128];
  if (h.length === 4) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
const hx = n => { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? '0' : '') + n.toString(16); };
export function mixc(a, b, t) {
  const A = rgb(a), B = rgb(b);
  return '#' + hx(A[0] + (B[0] - A[0]) * t) + hx(A[1] + (B[1] - A[1]) * t) + hx(A[2] + (B[2] - A[2]) * t);
}
const SH = '#1e2a52';                           // shade target (cool navy, keeps shadows blue not muddy)
const lit = (c, t) => mixc(c, '#ffffff', t);
const dim = (c, t) => mixc(c, SH, t);
const _sets = new Map();
function faces(c) {
  let s = _sets.get(c);
  if (!s) { s = { t: lit(c, 0.28), l: c, r: dim(c, 0.2), hi: lit(c, 0.6), lo: dim(c, 0.34) }; _sets.set(c, s); }
  return s;
}
const hash2 = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ───────────────────────── canvas / path helpers ─────────────────────────
function mk(w, h, ax, ay, fn) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * K); c.height = Math.ceil(h * K);
  const g = c.getContext('2d');
  g.scale(K, K); g.lineJoin = 'round'; g.lineCap = 'round';
  fn(g);
  c.ax = ax; c.ay = ay; c.dw = w; c.dh = h; c.scene = 1;
  return c;
}
const isoP = (ax, ay) => (u, v, z) => [ax + (u - v) * 32, ay + (u + v) * 16 - (z || 0)];
function poly(g, pts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }
function fillPoly(g, pts, col) { poly(g, pts); g.fillStyle = col; g.fill(); }
function strokeLine(g, a, b, col, w = 1) { g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.strokeStyle = col; g.lineWidth = w; g.stroke(); }
function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function circ(g, x, y, r, col) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fillStyle = col; g.fill(); }
function ell(g, x, y, rx, ry, col) { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fillStyle = col; g.fill(); }

// 3-face iso box. c = base colour (string). o.noOutline, o.cap (white cap line on top)
function box(g, p, u0, v0, u1, v1, z0, z1, c, o = {}) {
  const s = typeof c === 'string' ? faces(c) : c;
  fillPoly(g, [p(u0, v1, z1), p(u1, v1, z1), p(u1, v1, z0), p(u0, v1, z0)], s.l);
  fillPoly(g, [p(u1, v0, z1), p(u1, v1, z1), p(u1, v1, z0), p(u1, v0, z0)], s.r);
  fillPoly(g, [p(u0, v0, z1), p(u1, v0, z1), p(u1, v1, z1), p(u0, v1, z1)], s.t);
  if (!o.noHi) {
    strokeLine(g, p(u0, v1, z1 - 0.5), p(u1, v1, z1 - 0.5), s.hi, 1);
    strokeLine(g, p(u1, v1, z1 - 0.5), p(u1, v0, z1 - 0.5), lit(s.t, 0.3), 1);
  }
  if (!o.noOutline) {
    poly(g, [p(u0, v0, z1), p(u1, v0, z1), p(u1, v0, z0), p(u1, v1, z0), p(u0, v1, z0), p(u0, v1, z1)]);
    g.strokeStyle = o.out || OUT; g.lineWidth = 1; g.stroke();
  }
}

// ───────────────────────── ground tiles (64x32 diamonds, drawn with a 0.7px bleed so tiles never show seams) ─────────────────────────
const TW = 70, TH = 38, TAX = 35, TAY = 3;     // tile canvas (world px) and the anchor of the diamond's top corner
function tile(fn) {
  return mk(TW, TH, TAX, TAY, g => {
    const e = 0.9;
    g.save();
    g.beginPath(); g.moveTo(TAX, TAY - e * 0.5); g.lineTo(TAX + 32 + e * 2, TAY + 16); g.lineTo(TAX, TAY + 32 + e * 0.5); g.lineTo(TAX - 32 - e * 2, TAY + 16); g.closePath();
    g.clip();
    const P = (u, v) => [TAX + (u - v) * 32, TAY + (u + v) * 16];
    fn(g, P);
    g.restore();
  });
}
function uvEdge(g, P, u0, v0, u1, v1, col, w = 1) { strokeLine(g, P(u0, v0), P(u1, v1), col, w); }
function flatDiamond(g, P, col) { fillPoly(g, [P(-0.05, -0.05), P(1.05, -0.05), P(1.05, 1.05), P(-0.05, 1.05)], col); }

const CREAM = '#ede1d4', CREAM2 = '#e4d8cb', JOINT = '#d2c6ba', JOINT_D = '#c6baae';
function lotTile(base, seed) {
  return tile((g, P) => {
    flatDiamond(g, P, base);
    // soft shade toward the lower edges (cheap tile bevel), then joints on the two upper edges
    fillPoly(g, [P(1, 0), P(1, 1), P(0, 1), P(0.04, 0.96), P(0.96, 0.96), P(0.96, 0.04)], 'rgba(198,186,174,0.35)');
    uvEdge(g, P, 0, 0, 1, 0, '#cfc2b4', 1.3); uvEdge(g, P, 0, 0, 0, 1, '#cfc2b4', 1.3);
    uvEdge(g, P, 0.03, 0.05, 0.97, 0.05, 'rgba(255,255,255,0.55)', 0.9); uvEdge(g, P, 0.05, 0.03, 0.05, 0.97, 'rgba(255,255,255,0.45)', 0.9);
    if (seed) { // a faint diagonal sheen on some tiles (clean-floor shine)
      uvEdge(g, P, 0.3, 0.7, 0.55, 0.45, 'rgba(255,255,255,0.4)', 1.4); uvEdge(g, P, 0.42, 0.78, 0.6, 0.62, 'rgba(255,255,255,0.3)', 1);
    }
  });
}
function sidewalkTile(seed) {
  return tile((g, P) => {
    flatDiamond(g, P, seed ? '#e9ddcc' : '#ebe0cf');
    uvEdge(g, P, 0, 0, 1, 0, '#cfc2ae', 1.2); uvEdge(g, P, 0, 0, 0, 1, '#cfc2ae', 1.2);
    uvEdge(g, P, 0.04, 0.07, 0.96, 0.07, 'rgba(255,255,255,0.6)', 0.9); uvEdge(g, P, 0.07, 0.04, 0.07, 0.96, 'rgba(255,255,255,0.5)', 0.9);
    // paver split
    uvEdge(g, P, 0.5, 0, 0.5, 1, 'rgba(207,194,174,0.55)', 0.8);
  });
}
const ASPH = ['#b8c2ce', '#b4bec9'];
function asphaltTile(seed, mark) {
  return tile((g, P) => {
    flatDiamond(g, P, ASPH[seed & 1]);
    if (mark === 'dash') {
      for (const [a, b] of [[0.1, 0.46], [0.58, 0.94]]) { // dashed centre line, drawn as a thin parallelogram along +x
        fillPoly(g, [P(a, 0.46), P(b, 0.46), P(b, 0.54), P(a, 0.54)], '#f6f6f6');
      }
    } else if (mark === 'zebra') {
      for (const [a, b] of [[0.06, 0.26], [0.4, 0.6], [0.74, 0.94]]) {
        fillPoly(g, [P(a, -0.02), P(b, -0.02), P(b, 1.02), P(a, 1.02)], '#f6f6f6');
        uvEdge(g, P, b, 0.02, b, 0.98, 'rgba(123,136,156,0.45)', 0.9);
      }
    } else {
      if (seed === 1) { uvEdge(g, P, 0.2, 0.7, 0.4, 0.5, 'rgba(255,255,255,0.18)', 1); }
    }
  });
}
function grassTile(seed) {
  return tile((g, P) => {
    flatDiamond(g, P, ['#95d344', '#92cf40', '#98d548', '#93d042'][seed & 3]);
    const n = 3 + (seed & 1);
    for (let i = 0; i < n; i++) {
      const u = 0.18 + hash2(seed, i, 1) * 0.64, v = 0.18 + hash2(seed, i, 2) * 0.64;
      const [x, y] = P(u, v);
      g.strokeStyle = '#6fb52e'; g.lineWidth = 1; g.beginPath();
      g.moveTo(x - 2, y + 1); g.lineTo(x - 2.6, y - 1.6); g.moveTo(x, y + 1); g.lineTo(x, y - 2.8); g.moveTo(x + 2, y + 1); g.lineTo(x + 2.6, y - 1.6); g.stroke();
      g.strokeStyle = '#b4e66a'; g.beginPath(); g.moveTo(x - 0.7, y - 0.5); g.lineTo(x - 0.9, y - 2); g.stroke();
    }
    if (seed === 3 || seed === 6) { const [x, y] = P(0.6, 0.35); circ(g, x, y, 1.5, '#f6f6f6'); circ(g, x, y, 0.7, '#f6c64e'); }
    if (seed === 5) { const [x, y] = P(0.35, 0.62); circ(g, x, y, 1.4, '#ffd4e0'); circ(g, x, y, 0.6, '#f6c64e'); }
  });
}
function doormatTile() {
  return tile((g, P) => {
    flatDiamond(g, P, '#eaded2');
    fillPoly(g, [P(0.1, 0.1), P(0.9, 0.1), P(0.9, 0.9), P(0.1, 0.9)], '#364272');
    fillPoly(g, [P(0.2, 0.2), P(0.8, 0.2), P(0.8, 0.8), P(0.2, 0.8)], '#2a7ef6');
    for (let i = 0; i < 4; i++) uvEdge(g, P, 0.28 + i * 0.15, 0.24, 0.28 + i * 0.15, 0.76, 'rgba(255,255,255,0.55)', 1);
    poly(g, [P(0.1, 0.1), P(0.9, 0.1), P(0.9, 0.9), P(0.1, 0.9)]); g.strokeStyle = OUT; g.lineWidth = 0.9; g.stroke();
  });
}
const _gt = new Map();
// kind = groundKind() result; (gx,gy) picks a stable variant
export function sceneGround(kind, gx, gy) {
  let key = kind, mk_;
  if (kind === 'grass' || kind === 'grass2') {
    const r = (hash2(gx, gy, 9) * 8) | 0; key = 'g' + r;
    mk_ = () => grassTile(r);
  } else if (kind === 'asphalt') { const r = (gx + gy) & 1; key = 'a' + r; mk_ = () => asphaltTile(r); }
  else if (kind === 'asphalt_dash') { key = 'ad'; mk_ = () => asphaltTile(0, 'dash'); }
  else if (kind === 'crosswalk') { key = 'cw'; mk_ = () => asphaltTile(0, 'zebra'); }
  else if (kind === 'sidewalk') { const r = (gx + gy) & 1; key = 's' + r; mk_ = () => sidewalkTile(r); }
  else if (kind === 'doormat') mk_ = doormatTile;
  else if (kind === 'lot2') { key = 'l2'; mk_ = () => lotTile(CREAM2, 1); }
  else { key = 'l1'; mk_ = () => lotTile(CREAM, 0); }
  let s = _gt.get(key);
  if (!s) { s = mk_(); _gt.set(key, s); }
  return s;
}

// ───────────────────────── building shell ─────────────────────────
const WALL = '#f3e7d3', WALL_L = '#ecdfc9', WALL_R = '#d9cab0', TRIM = '#fbfaf6', BASE = '#f6f6f6', WHEIGHT = 48;
const GLASS = '#cfe6f5', GLASS_HI = '#eaf6fb', GLASS_D = '#9cc8f8', FRAME = '#f6f6f6';
const EXT = 0.022;                                   // bleed along the run direction so neighbouring wall pieces never show a seam

// Tall wall, 2 variants x 2 orientations. dir 'L' = wall in the plane u=0 running along v (long face points +u: the "right" face);
// dir 'R' = wall in the plane v=0 running along u (long face points +v: the "left" face).
function wallPiece(dir, win) {
  const T = 0.2, H = WHEIGHT;
  return mk(76, 84, dir === 'L' ? 48 : 28, 62, g => {
    const p = isoP(dir === 'L' ? 48 : 28, 62);
    // coordinates: a = along the wall (0..1), b = depth (-T..0 behind the inside face)
    const P = (a, b, z) => (dir === 'L' ? p(b, a, z) : p(a, b, z));
    const long = dir === 'L' ? WALL_R : WALL_L;
    const a0 = -EXT * 0, a1 = 1 + EXT;
    // inside face
    fillPoly(g, [P(a0, 0, H), P(a1, 0, H), P(a1, 0, 0), P(a0, 0, 0)], long);
    // top face
    fillPoly(g, [P(a0, -T, H), P(a1, -T, H), P(a1, 0, H), P(a0, 0, H)], TRIM);
    // baseboard + trim lines on the inside face
    fillPoly(g, [P(a0, 0, 5.5), P(a1, 0, 5.5), P(a1, 0, 0), P(a0, 0, 0)], BASE);
    strokeLine(g, P(a0, 0, 5.5), P(a1, 0, 5.5), dim(long, 0.14), 1);
    fillPoly(g, [P(a0, 0, H), P(a1, 0, H), P(a1, 0, H - 2.5), P(a0, 0, H - 2.5)], dir === 'L' ? '#e9e3d6' : '#fffdf8');
    // soft medical-blue accent band above the baseboard
    fillPoly(g, [P(a0, 0, 9.5), P(a1, 0, 9.5), P(a1, 0, 8), P(a0, 0, 8)], 'rgba(90,174,246,0.55)');
    // window
    if (win) {
      const w0 = 0.08, w1 = 0.92, z0 = 12, z1 = 41;
      fillPoly(g, [P(w0 - 0.05, 0, z1 + 2), P(w1 + 0.05, 0, z1 + 2), P(w1 + 0.05, 0, z0 - 2), P(w0 - 0.05, 0, z0 - 2)], dim(long, 0.1));   // reveal / shadow
      fillPoly(g, [P(w0, 0, z1 + 1.5), P(w1, 0, z1 + 1.5), P(w1, 0, z0 - 1.5), P(w0, 0, z0 - 1.5)], FRAME);
      fillPoly(g, [P(w0 + 0.05, 0, z1 - 0.5), P(w1 - 0.05, 0, z1 - 0.5), P(w1 - 0.05, 0, z0 + 0.5), P(w0 + 0.05, 0, z0 + 0.5)], '#8cc4ee');
      fillPoly(g, [P(w0 + 0.05, 0, z1 - 0.5), P(w1 - 0.05, 0, z1 - 0.5), P(w1 - 0.05, 0, z1 - 9), P(w0 + 0.05, 0, z1 - 9)], '#b4dcf6');
      // diagonal glare
      fillPoly(g, [P(0.16, 0, z0 + 0.5), P(0.28, 0, z0 + 0.5), P(0.46, 0, z1 - 0.5), P(0.34, 0, z1 - 0.5)], GLASS_HI);
      fillPoly(g, [P(0.58, 0, z0 + 0.5), P(0.63, 0, z0 + 0.5), P(0.77, 0, z1 - 0.5), P(0.72, 0, z1 - 0.5)], GLASS_HI);
      strokeLine(g, P(0.5, 0, z0 + 0.5), P(0.5, 0, z1 - 0.5), FRAME, 1.6);             // mullion
      strokeLine(g, P(w0 + 0.05, 0, z0 + 0.5), P(w1 - 0.05, 0, z0 + 0.5), '#d2d2de', 1.2);   // sill
    }
    // outline: top-back edge + base line (no verticals: pieces butt together)
    strokeLine(g, P(a0, -T, H), P(a1, -T, H), OUT, 1.1);
    strokeLine(g, P(a0, 0, 0), P(a1, 0, 0), OUT, 1.1);
    strokeLine(g, P(a0, 0, H), P(a1, 0, H), dim(OUT, 0), 0.8);
  });
}
function endCap(g, P, T, H, col, a) {   // end face of a wall run (visible on the last piece)
  fillPoly(g, [P(a, -T, H), P(a, 0, H), P(a, 0, 0), P(a, -T, 0)], col);
}
function pillar(h, top) {
  const w = 0.24;
  return mk(56, h + 34, 28, h + 12, g => {
    const p = isoP(28, h + 12);
    box(g, p, -w * 0.9, -w * 0.9, w * 0.3, w * 0.3, 0, h, '#efe2cc');
    // white cap
    box(g, p, -w * 0.95, -w * 0.95, w * 0.35, w * 0.35, h, h + 2.5, '#ffffff');
    // base band
    fillPoly(g, [p(w * 0.3, -w * 0.9, 5), p(w * 0.3, w * 0.3, 5), p(w * 0.3, w * 0.3, 0), p(w * 0.3, -w * 0.9, 0)], '#ffffff');
    fillPoly(g, [p(-w * 0.9, w * 0.3, 5), p(w * 0.3, w * 0.3, 5), p(w * 0.3, w * 0.3, 0), p(-w * 0.9, w * 0.3, 0)], '#ffffff');
    strokeLine(g, p(-w * 0.9, w * 0.3, 5), p(w * 0.3, w * 0.3, 5), 'rgba(20,17,27,0.35)', 0.8);
    strokeLine(g, p(w * 0.3, w * 0.3, 5), p(w * 0.3, -w * 0.9, 5), 'rgba(20,17,27,0.35)', 0.8);
  });
}
// low front / side walls
function lowWall(dir) {
  const T = 0.18, H = 12;
  const ax = dir === 'L' ? 30 : 30, ay = 30;
  return mk(76, 50, ax, ay, g => {
    const p = isoP(ax, ay);
    const P = (a, b, z) => (dir === 'F' ? p(a, b, z) : p(b, a, z));   // F: along u at v=b ; S: along v at u=b
    const long = dir === 'F' ? WALL_L : WALL_R;
    const b0 = 0, b1 = T, a0 = 0, a1 = 1 + EXT;
    // visible long face is the one at b1
    fillPoly(g, [P(a0, b1, H), P(a1, b1, H), P(a1, b1, 0), P(a0, b1, 0)], long);
    fillPoly(g, [P(a0, b0, H), P(a1, b0, H), P(a1, b1, H), P(a0, b1, H)], '#ffffff');
    fillPoly(g, [P(a0, b1, 4), P(a1, b1, 4), P(a1, b1, 0), P(a0, b1, 0)], BASE);
    strokeLine(g, P(a0, b1, H - 0.5), P(a1, b1, H - 0.5), '#d6e8f6', 1);
    strokeLine(g, P(a0, b0, H), P(a1, b0, H), OUT, 1);
    strokeLine(g, P(a0, b1, 0), P(a1, b1, 0), OUT, 1.1);
    strokeLine(g, P(a0, b1, H), P(a1, b1, H), 'rgba(20,17,27,0.5)', 0.8);
  });
}
function doorFrame() {
  const ax = 36, ay = 70;
  return mk(72, 100, ax, ay, g => {
    const p = isoP(ax, ay);
    const H = 50;
    // posts (outer face at v=0.2)
    const post = (a0, a1) => box(g, p, a0, 0, a1, 0.2, 0, H - 4, '#efe2cc');
    // glass door in the opening
    const o0 = 0.14, o1 = 0.86, vv = 0.14;
    fillPoly(g, [p(o0, vv, 36), p(o1, vv, 36), p(o1, vv, 0), p(o0, vv, 0)], '#9ec6e4');   // dark interior behind the glass
    fillPoly(g, [p(0.18, 0.2, 35), p(0.5, 0.2, 35), p(0.5, 0.2, 1.5), p(0.18, 0.2, 1.5)], GLASS);
    fillPoly(g, [p(0.5, 0.2, 35), p(0.82, 0.2, 35), p(0.82, 0.2, 1.5), p(0.5, 0.2, 1.5)], '#c2def0');
    fillPoly(g, [p(0.24, 0.2, 33), p(0.31, 0.2, 33), p(0.43, 0.2, 7), p(0.36, 0.2, 7)], GLASS_HI);
    fillPoly(g, [p(0.56, 0.2, 33), p(0.6, 0.2, 33), p(0.7, 0.2, 9), p(0.66, 0.2, 9)], GLASS_HI);
    for (const [a, b] of [[0.18, 0.5], [0.5, 0.82]]) {
      poly(g, [p(a, 0.2, 35), p(b, 0.2, 35), p(b, 0.2, 1.5), p(a, 0.2, 1.5)]); g.strokeStyle = FRAME; g.lineWidth = 1.5; g.stroke();
    }
    strokeLine(g, p(0.47, 0.2, 22), p(0.47, 0.2, 14), '#7e8aba', 1.2); strokeLine(g, p(0.53, 0.2, 22), p(0.53, 0.2, 14), '#7e8aba', 1.2);   // handles
    strokeLine(g, p(o0, 0.2, 0), p(o1, 0.2, 0), OUT, 1.1);
    post(0, 0.14); post(0.86, 1);
    // lintel / sign band
    box(g, p, 0, 0, 1, 0.2, H - 4, H, '#2a7ef6');
    fillPoly(g, [p(0.04, 0.2, H - 1.2), p(0.96, 0.2, H - 1.2), p(0.96, 0.2, H - 2.8), p(0.04, 0.2, H - 2.8)], 'rgba(255,255,255,0.8)');
    // canopy awning (blue + white stripes) sloping out over the door
    const aw = (a0, a1, col) => {
      fillPoly(g, [p(a0, 0.2, H - 4), p(a1, 0.2, H - 4), p(a1, 0.78, H - 12), p(a0, 0.78, H - 12)], col);
      fillPoly(g, [p(a0, 0.78, H - 12), p(a1, 0.78, H - 12), p(a1, 0.78, H - 17), p(a0, 0.78, H - 17)], col);
    };
    const n = 6;
    for (let i = 0; i < n; i++) aw(-0.04 + i * (1.08 / n), -0.04 + (i + 1) * (1.08 / n), i & 1 ? '#f6f6f6' : '#2a7ef6');
    poly(g, [p(-0.04, 0.2, H - 4), p(1.04, 0.2, H - 4), p(1.04, 0.78, H - 12), p(1.04, 0.78, H - 17), p(-0.04, 0.78, H - 17), p(-0.04, 0.78, H - 12)]);
    g.strokeStyle = OUT; g.lineWidth = 1; g.stroke();
    strokeLine(g, p(-0.04, 0.78, H - 12), p(1.04, 0.78, H - 12), 'rgba(20,17,27,0.4)', 0.8);
    // scalloped valance highlight
    strokeLine(g, p(-0.02, 0.2, H - 4.7), p(1.02, 0.2, H - 4.7), 'rgba(255,255,255,0.7)', 1);
  });
}

// ───────────────────────── backdrop ─────────────────────────
function blob(g, list, base, mid, light, hi) {   // list of [x,y,r] circles with a toon outline and offset-layered shading
  g.lineJoin = 'round';
  g.fillStyle = base; g.strokeStyle = OUT; g.lineWidth = 2.2;
  for (const [x, y, r] of list) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); }
  for (const [x, y, r] of list) { g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  g.save();
  g.beginPath(); for (const [x, y, r] of list) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); } g.clip();
  g.fillStyle = mid; for (const [x, y, r] of list) { g.beginPath(); g.arc(x - r * 0.14, y - r * 0.16, r * 0.86, 0, TAU); g.fill(); }
  g.fillStyle = light; for (const [x, y, r] of list) { g.beginPath(); g.arc(x - r * 0.3, y - r * 0.34, r * 0.5, 0, TAU); g.fill(); }
  g.fillStyle = hi; for (const [x, y, r] of list) { g.beginPath(); g.arc(x - r * 0.42, y - r * 0.46, r * 0.17, 0, TAU); g.fill(); }
  g.restore();
}
function treeSprite(pink) {
  const w = 64, h = 96, ax = 32, ay = 70;   // tile top corner; trunk base = (32, 86)
  return mk(w, h, ax, ay, g => {
    const bx = 32, by = ay + 17;
    ell(g, bx, by + 1, 13, 5, 'rgba(20,17,27,0.16)');
    // trunk
    g.beginPath(); g.moveTo(bx - 3.6, by); g.lineTo(bx - 2.6, by - 15); g.lineTo(bx + 2.6, by - 15); g.lineTo(bx + 3.6, by); g.closePath();
    g.fillStyle = '#a97f55'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.2; g.stroke();
    g.beginPath(); g.moveTo(bx + 0.4, by - 1); g.lineTo(bx + 0.9, by - 15); g.lineTo(bx + 2.6, by - 15); g.lineTo(bx + 3.4, by - 1); g.closePath(); g.fillStyle = '#7a5a3c'; g.fill();
    const cy = by - 30;
    const list = [[bx - 11, cy + 4, 11.5], [bx + 11, cy + 4, 11.5], [bx, cy - 1, 14.5], [bx - 6, cy - 11, 10.5], [bx + 7, cy - 10, 10]];
    if (pink) blob(g, list, '#d8648d', '#ee86aa', '#ffb2cb', '#fff2f6');
    else blob(g, list, '#2a7a3a', '#3fa63a', '#7fd04a', '#d4f6a0');
  });
}
function bushSprite() {
  return mk(44, 48, 22, 26, g => {
    const bx = 22, by = 26 + 15;
    ell(g, bx, by, 14, 4.5, 'rgba(20,17,27,0.16)');
    blob(g, [[bx - 7, by - 6, 7.5], [bx + 7, by - 6, 7.5], [bx, by - 10, 8.5]], '#2a7a3a', '#3fa63a', '#7fd04a', '#d4f6a0');
  });
}
function lampSprite() {
  return mk(40, 84, 20, 66, g => {
    const bx = 20, by = 66 + 16;
    ell(g, bx, by, 8, 3, 'rgba(20,17,27,0.18)');
    // base, post
    box(g, isoP(bx, by - 16), 0.4, 0.4, 0.6, 0.6, 0, 4, '#7e8aba');
    g.beginPath(); g.moveTo(bx - 1.6, by - 3); g.lineTo(bx - 1.1, by - 52); g.lineTo(bx + 1.5, by - 52); g.lineTo(bx + 2, by - 3); g.closePath();
    g.fillStyle = '#5a667e'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1; g.stroke();
    g.fillStyle = '#7e8aba'; g.fillRect(bx - 1, by - 50, 1, 46);
    // lamp head
    rrect(g, bx - 6.5, by - 61, 13, 9, 3.5); g.fillStyle = '#ffe9a8'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.1; g.stroke();
    rrect(g, bx - 5, by - 59.5, 5, 6, 2); g.fillStyle = '#fffbe6'; g.fill();
    rrect(g, bx - 8, by - 65, 16, 5, 2.5); g.fillStyle = '#1e66ea'; g.fill(); g.strokeStyle = OUT; g.stroke();
    g.fillStyle = '#5aaef6'; g.fillRect(bx - 5, by - 64, 8, 1);
  });
}
function planterSprite() {
  return mk(60, 54, 30, 32, g => {
    const p = isoP(30, 32);
    box(g, p, 0.2, 0.2, 0.8, 0.8, 0, 6, '#d9825b');
    fillPoly(g, [p(0.22, 0.22, 6), p(0.78, 0.22, 6), p(0.78, 0.78, 6), p(0.22, 0.78, 6)], '#4a8a2e');
    const fl = (u, v, z, col) => { const [x, y] = p(u, v, z); circ(g, x, y - 3, 3.1, col); circ(g, x - 0.8, y - 3.8, 1.1, 'rgba(255,255,255,0.7)'); strokeLine(g, [x, y - 1], [x, y + 1], '#2a7a3a', 1); };
    g.fillStyle = '#3fa63a';
    for (const [u, v] of [[0.3, 0.4], [0.65, 0.35], [0.5, 0.65], [0.35, 0.7]]) { const [x, y] = p(u, v, 7); ell(g, x, y - 2, 4, 3, '#3fa63a'); }
    fl(0.32, 0.38, 8, '#ea6a8a'); fl(0.66, 0.34, 8, '#f6c64e'); fl(0.5, 0.64, 9, '#ff9ac2'); fl(0.3, 0.68, 8, '#f6f6f6');
  });
}
// neighbouring buildings: 3x2 footprint, 4 palettes
function buildingSprite(w, d, hgt, wall, trim, roof, glass) {
  const W = (w + d) * 32 + 8, H = (w + d) * 16 + hgt + 26, ax = d * 32 + 4, ay = hgt + 16;
  return mk(W, H, ax, ay, g => {
    const p = isoP(ax, ay);
    box(g, p, 0, 0, w, d, 0, hgt, wall);
    // roof cap + parapet
    box(g, p, -0.04, -0.04, w + 0.04, d + 0.04, hgt, hgt + 4, trim);
    const s = faces(wall), floors = Math.max(2, Math.floor((hgt - 10) / 17));
    // windows: left face (v = d) runs along u, right face (u = w) runs along v
    const winL = (u0, z0) => {
      fillPoly(g, [p(u0, d, z0 + 11), p(u0 + 0.3, d, z0 + 11), p(u0 + 0.3, d, z0), p(u0, d, z0)], '#f6f6f6');
      fillPoly(g, [p(u0 + 0.03, d, z0 + 9.6), p(u0 + 0.27, d, z0 + 9.6), p(u0 + 0.27, d, z0 + 1.4), p(u0 + 0.03, d, z0 + 1.4)], glass);
      fillPoly(g, [p(u0 + 0.03, d, z0 + 9.6), p(u0 + 0.13, d, z0 + 9.6), p(u0 + 0.2, d, z0 + 1.4), p(u0 + 0.03, d, z0 + 1.4)], lit(glass, 0.45));
    };
    const winR = (v0, z0) => {
      fillPoly(g, [p(w, v0, z0 + 11), p(w, v0 + 0.3, z0 + 11), p(w, v0 + 0.3, z0), p(w, v0, z0)], '#e6e6ee');
      fillPoly(g, [p(w, v0 + 0.03, z0 + 9.6), p(w, v0 + 0.27, z0 + 9.6), p(w, v0 + 0.27, z0 + 1.4), p(w, v0 + 0.03, z0 + 1.4)], dim(glass, 0.18));
      fillPoly(g, [p(w, v0 + 0.03, z0 + 9.6), p(w, v0 + 0.1, z0 + 9.6), p(w, v0 + 0.15, z0 + 1.4), p(w, v0 + 0.03, z0 + 1.4)], lit(glass, 0.2));
    };
    for (let r = 0; r < floors; r++) {
      const z0 = 7 + r * 17;
      for (let i = 0; i < w * 3 - 1; i++) winL(0.2 + i * 0.333, z0);
      for (let i = 0; i < d * 3 - 1; i++) winR(0.2 + i * 0.333, z0);
      // ledge between floors
      if (r) { strokeLine(g, p(0.02, d, z0 - 2), p(w, d, z0 - 2), lit(s.l, 0.55), 1); strokeLine(g, p(w, d, z0 - 2), p(w, 0.02, z0 - 2), lit(s.r, 0.35), 1); }
    }
    // entrance door on the left face + awning stripe on tall ones
    fillPoly(g, [p(w * 0.5 - 0.2, d, 13), p(w * 0.5 + 0.2, d, 13), p(w * 0.5 + 0.2, d, 0), p(w * 0.5 - 0.2, d, 0)], '#364272');
    fillPoly(g, [p(w * 0.5 - 0.16, d, 12), p(w * 0.5 + 0.16, d, 12), p(w * 0.5 + 0.16, d, 0), p(w * 0.5 - 0.16, d, 0)], '#9cc8f8');
    strokeLine(g, p(w * 0.5, d, 12), p(w * 0.5, d, 0), '#f6f6f6', 1);
    // rooftop unit
    box(g, p, 0.3, 0.3, 0.9, 0.8, hgt + 4, hgt + 9, '#d2d2de');
    box(g, p, 1.5, 0.4, 1.9, 0.9, hgt + 4, hgt + 11, '#96a2c6');
    // silhouette re-outline (box() outlined the main block, the windows covered part of it)
    poly(g, [p(-0.04, -0.04, hgt + 4), p(w + 0.04, -0.04, hgt + 4), p(w, 0, 0), p(w, d, 0), p(0, d, 0), p(-0.04, d + 0.04, hgt + 4)]);
    g.strokeStyle = OUT; g.lineWidth = 1; g.stroke();
  });
}
const BLDG = [
  () => buildingSprite(3, 2, 56, '#f0d8c0', '#fff2e6', '#c9a98c', '#5aaef6'),     // cream
  () => buildingSprite(3, 2, 80, '#bcd6f0', '#eef6ff', '#8aa8c8', '#368af6'),     // light blue
  () => buildingSprite(3, 2, 44, '#f6c8d2', '#fff0f3', '#d79aa8', '#5aaef6'),     // pink
  () => buildingSprite(3, 2, 68, '#e8e0f2', '#f8f4ff', '#a89cc6', '#2a7ef6'),     // lavender
];

// ───────────────────────── cars ─────────────────────────
const CAR_COLORS = ['#e23a3a', '#2a7ef6', '#f6c64e', '#5aae02', '#e8eaf2', '#9a7fc6'];
function carSprite(i, dirSign) {
  const col = CAR_COLORS[i % CAR_COLORS.length], ax = 40, ay = 26;
  return mk(106, 84, ax, ay, g => {
    const p = isoP(ax, ay);
    const U0 = 0.04, U1 = 1.96, V0 = 0.14, V1 = 0.86;
    // soft ground shadow
    ell(g, ax + 16, ay + 26, 40, 12, 'rgba(20,17,27,0.16)');
    // wheels (dark, behind the body on the far side)
    const wheel = (u, v) => { const [x, y] = p(u, v, 3.6); ell(g, x, y, 5, 4.4, '#1e1e36'); ell(g, x, y, 2.2, 1.9, '#7e8aba'); };
    wheel(0.5, V0 + 0.02); wheel(1.55, V0 + 0.02);
    box(g, p, U0, V0, U1, V1, 3.5, 9.5, col);
    // rounded nose / tail: small chamfer via top highlights
    // cabin
    const c0 = 0.52, c1 = 1.5;
    box(g, p, c0, V0 + 0.1, c1, V1 - 0.1, 9.5, 15.5, col);
    // windows (left face v = V1-0.1, right face u = c1)
    const wv = V1 - 0.1;
    fillPoly(g, [p(c0 + 0.05, wv, 14.5), p(0.97, wv, 14.5), p(0.97, wv, 10.4), p(c0 + 0.05, wv, 10.4)], '#b4dcf4');
    fillPoly(g, [p(1.03, wv, 14.5), p(c1 - 0.05, wv, 14.5), p(c1 - 0.05, wv, 10.4), p(1.03, wv, 10.4)], '#b4dcf4');
    fillPoly(g, [p(c1, V0 + 0.15, 14.5), p(c1, V1 - 0.15, 14.5), p(c1, V1 - 0.15, 10.4), p(c1, V0 + 0.15, 10.4)], '#7fb4de');
    fillPoly(g, [p(c0 + 0.08, wv, 14.5), p(c0 + 0.2, wv, 14.5), p(c0 + 0.12, wv, 10.4), p(c0 + 0.05, wv, 10.4)], 'rgba(255,255,255,0.7)');
    // lights on the end faces (right face at u = U1 is the front for dirSign > 0)
    const hl = dirSign > 0 ? '#fff3b0' : '#e23a3a';
    fillPoly(g, [p(U1, V0 + 0.1, 8), p(U1, V0 + 0.28, 8), p(U1, V0 + 0.28, 5.2), p(U1, V0 + 0.1, 5.2)], hl);
    fillPoly(g, [p(U1, V1 - 0.28, 8), p(U1, V1 - 0.1, 8), p(U1, V1 - 0.1, 5.2), p(U1, V1 - 0.28, 5.2)], hl);
    // side stripe
    strokeLine(g, p(U0 + 0.05, V1, 6.6), p(U1 - 0.05, V1, 6.6), lit(col, 0.55), 0.9);
    // near wheels on the visible (left) side
    wheel(0.5, V1 + 0.02); wheel(1.55, V1 + 0.02);
  });
}
const _cars = new Map();
export function sceneCar(i, dirSign) {
  const key = (i % CAR_COLORS.length) + (dirSign < 0 ? 'b' : 'f');
  let s = _cars.get(key);
  if (!s) { s = carSprite(i, dirSign); _cars.set(key, s); }
  return s;
}

// ───────────────────────── scenery registry ─────────────────────────
const _it = new Map();
const ITEMS = {
  wallL: () => wallPiece('L', false), wallL_win: () => wallPiece('L', true),
  wallR: () => wallPiece('R', false), wallR_win: () => wallPiece('R', true),
  wallCorner: () => pillar(WHEIGHT, true), lowCorner: () => pillar(14, false),
  lowFront: () => lowWall('F'), lowSide: () => lowWall('S'), doorFrame,
  tree: () => treeSprite(false), tree2: () => treeSprite(true), bush: bushSprite, lamp: lampSprite, planter: planterSprite,
  bldg0: BLDG[0], bldg1: BLDG[1], bldg2: BLDG[2], bldg3: BLDG[3],
};
export function sceneItem(kind) {
  let s = _it.get(kind);
  if (!s) { s = (ITEMS[kind] || ITEMS.bush)(); _it.set(kind, s); }
  return s;
}
export function clearSceneCaches() { _gt.clear(); _it.clear(); _cars.clear(); _icons.clear(); _shadow = null; _sets.clear(); }

// ───────────────────────── status icons (bright, outlined, ~18px) ─────────────────────────
const ICON_FN = {
  anger(g) {            // red 4-arc "vein" mark
    g.strokeStyle = OUT; g.lineWidth = 4.6; arcs(g); g.strokeStyle = '#e23a3a'; g.lineWidth = 2.6; arcs(g);
    g.strokeStyle = '#ff9a8a'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(5.2, 5.6); g.lineTo(5.2, 4.3); g.moveTo(5.2, 4.2); g.lineTo(6.4, 4.2); g.stroke();
    function arcs(gg) {
      gg.beginPath();
      gg.moveTo(3.2, 7.5); gg.quadraticCurveTo(7, 7.5, 7, 3.2);
      gg.moveTo(10.8, 3.2); gg.quadraticCurveTo(10.8, 7.5, 14.8, 7.5);
      gg.moveTo(14.8, 10.5); gg.quadraticCurveTo(10.8, 10.5, 10.8, 14.8);
      gg.moveTo(7, 14.8); gg.quadraticCurveTo(7, 10.5, 3.2, 10.5);
      gg.stroke();
    }
  },
  sleep(g) {            // Zzz
    const z = (x, y, s) => {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + s, y); g.lineTo(x, y + s); g.lineTo(x + s, y + s);
      g.strokeStyle = OUT; g.lineWidth = 3.6; g.stroke(); g.strokeStyle = '#cfe6ff'; g.lineWidth = 1.9; g.stroke();
    };
    z(2.5, 9.5, 6.5); z(9, 3.2, 5); z(13.2, 0.8, 3.4);
  },
  heart(g) {
    heartPath(g, 9, 9.2, 7.4); g.fillStyle = '#f0507a'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.4; g.stroke();
    g.fillStyle = '#ffb4c8'; g.beginPath(); g.ellipse(5.6, 5.6, 1.9, 1.2, -0.6, 0, TAU); g.fill();
  },
  money(g) {
    circ(g, 9, 9, 7.6, '#f6c64e'); g.strokeStyle = OUT; g.lineWidth = 1.4; g.beginPath(); g.arc(9, 9, 7.6, 0, TAU); g.stroke();
    g.beginPath(); g.arc(9, 9, 5.2, 0, TAU); g.strokeStyle = '#d99b1e'; g.lineWidth = 1; g.stroke();
    g.fillStyle = '#9a6a10'; g.font = '700 8.5px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 9, 9.6);
    g.fillStyle = '#fff2b0'; g.beginPath(); g.ellipse(5.8, 5.3, 1.6, 0.9, -0.7, 0, TAU); g.fill();
  },
  warn(g) {
    g.beginPath(); g.moveTo(9, 1.6); g.lineTo(16.6, 15.4); g.lineTo(1.4, 15.4); g.closePath();
    g.fillStyle = '#ffc400'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.5; g.stroke();
    g.fillStyle = OUT; rrect(g, 8.1, 6.4, 1.8, 5, 0.9); g.fill(); circ(g, 9, 13.1, 1.05, OUT);
    g.fillStyle = '#fff0a0'; g.fillRect(6.2, 12.2, 0.1, 0.1);
  },
  star(g) {
    starPath(g, 9, 9.6, 8, 3.7); g.fillStyle = '#ffd23f'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.4; g.stroke();
    starPath(g, 9, 9.6, 5.2, 2.3); g.fillStyle = '#ffe98a'; g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.ellipse(6.6, 6.6, 1.2, 0.7, -0.7, 0, TAU); g.fill();
  },
  check(g) {
    circ(g, 9, 9, 7.6, '#2fb85a'); g.strokeStyle = OUT; g.lineWidth = 1.4; g.beginPath(); g.arc(9, 9, 7.6, 0, TAU); g.stroke();
    g.beginPath(); g.moveTo(5, 9.4); g.lineTo(8, 12.2); g.lineTo(13.2, 5.8); g.strokeStyle = '#fff'; g.lineWidth = 2.4; g.stroke();
  },
  question(g) {
    circ(g, 9, 9, 7.6, '#2a7ef6'); g.strokeStyle = OUT; g.lineWidth = 1.4; g.beginPath(); g.arc(9, 9, 7.6, 0, TAU); g.stroke();
    g.fillStyle = '#fff'; g.font = '700 11.5px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', 9, 9.8);
  },
  sweat(g) {
    g.beginPath(); g.moveTo(9, 1.2); g.bezierCurveTo(9.8, 5, 14.4, 8, 14.4, 11.6); g.arc(9, 11.6, 5.4, 0, Math.PI, false); g.bezierCurveTo(3.6, 8, 8.2, 5, 9, 1.2); g.closePath();
    g.fillStyle = '#5aaef6'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.4; g.stroke();
    g.fillStyle = '#e6f6ff'; g.beginPath(); g.ellipse(6.8, 11, 1.1, 2, 0.3, 0, TAU); g.fill();
  },
  note(g) {
    g.strokeStyle = OUT; g.lineWidth = 3.2; g.beginPath(); g.moveTo(11.5, 12.4); g.lineTo(11.5, 3); g.lineTo(15.6, 4.6); g.stroke();
    g.strokeStyle = '#9a7fc6'; g.lineWidth = 1.5; g.stroke();
    g.beginPath(); g.ellipse(8.6, 12.8, 3.6, 2.8, -0.4, 0, TAU); g.fillStyle = '#9a7fc6'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.3; g.stroke();
  },
};
function heartPath(g, cx, cy, r) {
  g.beginPath(); g.moveTo(cx, cy + r * 0.92);
  g.bezierCurveTo(cx - r * 1.35, cy + r * 0.1, cx - r * 1.0, cy - r * 1.0, cx, cy - r * 0.35);
  g.bezierCurveTo(cx + r * 1.0, cy - r * 1.0, cx + r * 1.35, cy + r * 0.1, cx, cy + r * 0.92); g.closePath();
}
function starPath(g, cx, cy, R, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i & 1 ? r : R; g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  g.closePath();
}
const _icons = new Map();
export function sceneIcon(name) {
  let s = _icons.get(name);
  if (!s) {
    const fn = ICON_FN[name] || ICON_FN.warn;
    s = mk(18, 18, 9, 18, g => fn(g));
    _icons.set(name, s);
  }
  return s;
}

// ───────────────────────── people shadow ─────────────────────────
let _shadow = null;
export function sceneShadow() {
  if (_shadow) return _shadow;
  _shadow = mk(34, 16, 17, 8, g => {
    const gr = g.createRadialGradient(17, 8, 1, 17, 8, 15);
    gr.addColorStop(0, 'rgba(20,17,27,0.26)'); gr.addColorStop(0.55, 'rgba(20,17,27,0.17)'); gr.addColorStop(1, 'rgba(20,17,27,0)');
    g.save(); g.translate(17, 8); g.scale(1, 0.46); g.translate(-17, -8);
    g.fillStyle = gr; g.beginPath(); g.arc(17, 8, 15, 0, TAU); g.fill(); g.restore();
  });
  return _shadow;
}

// draw a scene sprite (2x canvas) at world (x,y) of its anchor
export function putScene(g, s, x, y) { g.drawImage(s, x - s.ax, y - s.ay, s.dw, s.dh); }

// ───────────────────────── static layer ─────────────────────────
// Layer coordinates = world px - (NX, NY). Built at 2x, plus 1x and 0.5x mips for zoomed-out drawing.
export const NX = -1060, NY = -170, NW = 2120, NH = 1260;
let L2 = null, L1 = null, L05 = null, okLayer = true;
function newCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function half(src) {
  const c = newCanvas(Math.ceil(src.width / 2), Math.ceil(src.height / 2));
  const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
export function sceneSupported() { return okLayer; }
export function releaseSceneLayer() { L2 = L1 = L05 = vc = null; vcKey = ''; }
const sign = { x: 0, y: 0, w: 128, h: 17 };
export const signBox = sign;

// ctxIn: { state, groundKind(gx,gy), items[{kind,gx,gy,key}], name, badges[], badgeSkip(gx,gy) }
export function buildSceneLayer(info) {
  const { state } = info;
  const lot = state.lot;
  try {
    if (!L2) { L2 = newCanvas(NW * K, NH * K); }
    const g = L2.getContext('2d');
    if (!g) throw new Error('no ctx');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, L2.width, L2.height);
    g.setTransform(K, 0, 0, K, -NX * K, -NY * K);
    g.imageSmoothingEnabled = true;
    drawSlab(g);
    const P = (gx, gy) => [(gx - gy) * 32, (gx + gy) * 16];
    for (let gy = 0; gy < MAP_H; gy++) for (let gx = 0; gx < MAP_W; gx++) {
      const s = sceneGround(info.groundKind(gx, gy), gx, gy), q = P(gx, gy);
      g.drawImage(s, q[0] - s.ax, q[1] - s.ay, s.dw, s.dh);
    }
    const sg = signGeom(g, info, lot);
    for (const it of info.items) {
      let kind = it.kind;
      if (kind === 'wallR_win' && it.gy === lot.y0 && it.gx + 1 > sg.gx - 0.1 && it.gx < sg.gx + sg.pw / 32 + 0.1) kind = 'wallR';   // the sign hangs where a window would be
      const s = sceneItem(kind), q = P(it.gx, it.gy);
      g.drawImage(s, Math.round(q[0] - s.ax), Math.round(q[1] - s.ay), s.dw, s.dh);
    }
    drawSign(g, info, sg);
    L1 = half(L2); L05 = half(L1);
    layerVer++;
    okLayer = true;
  } catch (e) { okLayer = false; L2 = L1 = L05 = null; }
  return okLayer;
}

function drawSlab(g) {
  const P = (gx, gy) => [(gx - gy) * 32, (gx + gy) * 16];
  const L = P(0, MAP_H), B = P(MAP_W, MAP_H), R = P(MAP_W, 0), T = P(0, 0), SL = 30;
  // far-side soil lip is hidden by the ground; draw the two visible faces
  fillPoly(g, [L, B, [B[0], B[1] + SL], [L[0], L[1] + SL]], '#c49a6c');
  fillPoly(g, [B, R, [R[0], R[1] + SL], [B[0], B[1] + SL]], '#a07852');
  fillPoly(g, [L, B, [B[0], B[1] + 5], [L[0], L[1] + 5]], '#7fc22e');
  fillPoly(g, [B, R, [R[0], R[1] + 5], [B[0], B[1] + 5]], '#69a824');
  strokeLine(g, [L[0], L[1] + 11], [B[0], B[1] + 11], 'rgba(255,255,255,0.18)', 1);
  poly(g, [L, B, R, [R[0], R[1] + SL], [B[0], B[1] + SL], [L[0], L[1] + SL]]); g.strokeStyle = OUT; g.lineWidth = 1.2; g.stroke();
  strokeLine(g, B, [B[0], B[1] + SL], OUT, 1.2);
  void T;
}

const SIGN_FS = 13, SIGN_BS = 15;
function signGeom(g, info, lot) {
  const { name, badges } = info;
  g.font = '700 ' + SIGN_FS + 'px ' + FONT;
  const nameW = Math.ceil(g.measureText(name).width);
  const badgesW = badges.length ? badges.length * (SIGN_BS + 3) + 4 : 0;
  const pw = Math.max(132, nameW + badgesW + 38), ph = 22;
  const gx = lot.x0 + lot.w / 2 - pw / 64, gy = lot.y0;
  const sx = (gx - gy) * 32, sy = (gx + gy) * 16 - 45;
  sign.x = sx; sign.y = sy; sign.w = pw; sign.h = ph;
  return { gx, gy, pw, ph, sx, sy, nameW, badgesW };
}

function drawSign(g, info, sg) {
  const { name, badges } = info;
  const { pw, ph, sx, sy, nameW, badgesW } = sg;
  const FS = SIGN_FS, BS = SIGN_BS;
  g.save();
  g.setTransform(K, K * 0.5, 0, K, (sx - NX) * K, (sy - NY) * K);
  // mounting shadow + plate
  rrect(g, -1, 1.5, pw + 2, ph + 1, 5); g.fillStyle = 'rgba(20,17,27,0.2)'; g.fill();
  rrect(g, 0, 0, pw, ph, 5); g.fillStyle = '#1e365a'; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.4; g.stroke();
  rrect(g, 2, 2, pw - 4, ph - 4, 3.5); g.strokeStyle = 'rgba(156,200,248,0.65)'; g.lineWidth = 0.8; g.stroke();
  rrect(g, 3, 3, pw - 6, 3.4, 1.6); g.fillStyle = 'rgba(255,255,255,0.14)'; g.fill();
  // cross badge
  circ(g, 14, ph / 2, 7.2, '#f6f6f6'); circ(g, 14, ph / 2, 5.8, '#2a7ef6');
  g.fillStyle = '#fff'; g.fillRect(12.6, ph / 2 - 4, 2.8, 8); g.fillRect(10, ph / 2 - 1.4, 8, 2.8);
  g.fillStyle = '#ffffff'; g.font = '700 ' + FS + 'px ' + FONT; g.textAlign = 'left'; g.textBaseline = 'middle';
  const tx = 26 + (pw - 26 - 6 - badgesW - nameW) / 2;
  g.fillText(name, tx, ph / 2 + 0.6);
  if (badges.length) {
    let bx = tx + nameW + 6;
    g.font = '13px "Noto Color Emoji","Apple Color Emoji","Segoe UI Emoji",' + FONT; g.textAlign = 'center';
    for (const ic of badges) {
      circ(g, bx + BS / 2, ph / 2, BS / 2, '#f6f6f6');
      g.fillStyle = '#000'; g.fillText(ic, bx + BS / 2, ph / 2 + 0.8);
      bx += BS + 3;
    }
  }
  g.restore();
}

// blit the visible part of the static layer. (ctx has the world->device transform; vx0.. = visible world rect; S = device px per world px)
// The smoothed, non-integer-ratio blit of a big canvas is the most expensive single draw of the frame, so its result (the whole
// visible background, BG colour included) is cached per camera state and copied 1:1 while the camera rests.
let layerVer = 0, vc = null, vcKey = '';
// `extra(g)` (optional) paints more static content on top of the layer INTO the cached copy (painted floors); `extraKey` must
// change whenever that content changes.
export function layerCovers() { return !!L2; }            // true when drawSceneLayer() will overwrite the whole canvas
let vcS = 0, vcX = 0, vcY = 0, vcV = -1, vcE = 0;      // cache key of `vc` (numbers: no per-frame string / DOMMatrix allocation)
export function drawSceneLayer(ctx, vx0, vy0, vx1, vy1, S, bg, extra, extraKey) {
  if (!L2) return;
  const cw = ctx.canvas.width, ch = ctx.canvas.height, ek = extraKey || 0;
  if (!vc || vc.width !== cw || vc.height !== ch) { vc = newCanvas(cw, ch); vcKey = ''; }
  if (vcKey !== 'ok' || vcS !== S || vcX !== vx0 || vcY !== vy0 || vcV !== layerVer || vcE !== ek) {
    const m = ctx.getTransform();
    const g = vc.getContext('2d', { alpha: false });
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = bg; g.fillRect(0, 0, cw, ch);
    g.setTransform(m.a, 0, 0, m.d, m.e, m.f);
    blitLayer(g, vx0, vy0, vx1, vy1, S);
    if (extra) { g.imageSmoothingEnabled = false; extra(g); }
    vcKey = 'ok'; vcS = S; vcX = vx0; vcY = vy0; vcV = layerVer; vcE = ek;
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(vc, 0, 0); ctx.restore();
}
function blitLayer(ctx, vx0, vy0, vx1, vy1, S) {
  const k = S <= 0.62 ? 0.5 : S <= 1.25 ? 1 : 2;
  const src = k === 2 ? L2 : k === 1 ? L1 : L05;
  let sx = Math.max(0, Math.floor((vx0 - NX) * k)), sy = Math.max(0, Math.floor((vy0 - NY) * k));
  let ex = Math.min(src.width, Math.ceil((vx1 - NX) * k)), ey = Math.min(src.height, Math.ceil((vy1 - NY) * k));
  if (ex <= sx || ey <= sy) return;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(src, sx, sy, ex - sx, ey - sy, sx / k + NX, sy / k + NY, (ex - sx) / k, (ey - sy) / k);
}

// ───────────────────────── overlays: bubbles / labels / bars / rings ─────────────────────────
// Screen-space canvases at device resolution (d = dpr). Returns a canvas with .cw/.ch = size in CSS px (same contract as the classic ones).
export function sceneBubble(text, kind, d) {
  const g0 = document.createElement('canvas').getContext('2d');
  const pill = kind === 'tag' || kind === 'bad' || kind === 'zone';
  const fs = 12;
  const font = (pill ? '700 ' : '600 ') + fs + 'px ' + FONT;
  g0.font = font;
  const tw = Math.ceil(g0.measureText(text).width);
  const padX = pill ? 9 : 8, h = fs + (pill ? 9 : 10), w = tw + padX * 2, tail = pill ? 0 : 6;
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * d) + 2; c.height = Math.ceil((h + tail) * d) + 2;
  const g = c.getContext('2d');
  g.scale(d, d); g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center'; g.lineJoin = 'round';
  const r = pill ? h / 2 : 7;
  if (pill) {
    const fill = kind === 'bad' ? '#c43e5a' : '#1e365a';
    rrect(g, 1, 1.6, w - 2, h - 1.6, r); g.fillStyle = 'rgba(20,17,27,0.22)'; g.fill();      // soft drop
    rrect(g, 1, 1, w - 2, h - 2, r); g.fillStyle = fill; g.fill(); g.strokeStyle = OUT; g.lineWidth = 1.2; g.stroke();
    rrect(g, 2.4, 2.2, w - 4.8, (h - 4) * 0.42, r * 0.7); g.fillStyle = 'rgba(255,255,255,0.13)'; g.fill();
    g.fillStyle = '#ffffff';
  } else {
    // white bubble, navy outline, little tail
    g.beginPath();
    g.moveTo(1 + r, 1); g.arcTo(w - 1, 1, w - 1, h - 1, r); g.arcTo(w - 1, h - 1, 1, h - 1, r);
    g.lineTo(w / 2 + 5, h - 1); g.lineTo(w / 2, h + tail - 0.5); g.lineTo(w / 2 - 5, h - 1);
    g.arcTo(1, h - 1, 1, 1, r); g.arcTo(1, 1, w - 1, 1, r); g.closePath();
    g.fillStyle = '#ffffff'; g.fill(); g.strokeStyle = '#1e365a'; g.lineWidth = 1.6; g.stroke();
    g.fillStyle = '#1e365a';
  }
  g.fillText(text, w / 2, h / 2 + 0.5);
  c.cw = w; c.ch = h + tail;
  return c;
}

// rounded progress bar centred on (wx, wy) (top-left y), world px. green = treating, blue = registering
export function sceneBar(g, wx, wy, pct, green) {
  const W = 30, H = 7, x = wx - W / 2, y = wy - 1;
  rrect(g, x - 1, y - 1, W + 2, H + 2, (H + 2) / 2); g.fillStyle = OUT; g.fill();
  rrect(g, x, y, W, H, H / 2); g.fillStyle = '#eaeaf6'; g.fill();
  const fw = Math.max(H, W * Math.max(0, Math.min(1, pct)));
  rrect(g, x, y, fw, H, H / 2); g.fillStyle = green ? '#5aae02' : '#2a7ef6'; g.fill();
  rrect(g, x + 1.2, y + 0.9, Math.max(1, fw - 2.4), 2.2, 1.1); g.fillStyle = green ? '#9bd44a' : '#7fbcf8'; g.fill();
}

export function sceneSelRing(g, X, Y, pulse) {
  g.save();
  g.beginPath(); g.ellipse(X, Y, 17 * pulse, 8.5 * pulse, 0, 0, TAU);
  g.fillStyle = 'rgba(90,174,246,0.16)'; g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 4; g.stroke();
  g.strokeStyle = '#2a7ef6'; g.lineWidth = 2; g.stroke();
  g.restore();
}

export function sceneSparkle(g, X, Y, r, a) {
  g.fillStyle = 'rgba(255,226,120,' + a.toFixed(2) + ')';
  g.beginPath(); g.moveTo(X, Y - r); g.quadraticCurveTo(X + r * 0.18, Y - r * 0.18, X + r, Y); g.quadraticCurveTo(X + r * 0.18, Y + r * 0.18, X, Y + r);
  g.quadraticCurveTo(X - r * 0.18, Y + r * 0.18, X - r, Y); g.quadraticCurveTo(X - r * 0.18, Y - r * 0.18, X, Y - r); g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,' + a.toFixed(2) + ')'; g.beginPath(); g.arc(X, Y, r * 0.22, 0, TAU); g.fill();
}

// ───────────────────────── daylight + weather ─────────────────────────
export const DAY_KEYS_NEW = [[0, 255, 238, 210], [0.1, 255, 249, 240], [0.22, 255, 255, 255], [0.62, 255, 255, 255], [0.8, 255, 224, 190], [0.92, 208, 188, 226], [1, 150, 160, 214]];
export const ZONE_COL_NEW = { golden3: '246,198,78', premium: '154,127,198', kidpark: '90,200,60' };
export const ZONE_DEFAULT_NEW = '42,200,220';

// kind-specific tint multipliers (r,g,b) for the daylight multiply
const TINT_NEW = { rain: [0.86, 0.92, 1], meiyu: [0.86, 0.92, 1], typhoon: [0.66, 0.72, 0.86], cold: [0.9, 0.96, 1], cloudy: [0.94, 0.96, 1], hot: [1, 0.98, 0.91] };
export function tintFor(kind) { return TINT_NEW[kind] || null; }

export function weatherNew(g, kind, W, H, ts, perfLevel) {
  if (kind === 'rain' || kind === 'meiyu' || kind === 'typhoon') {
    const heavy = kind === 'typhoon';
    const n = heavy ? 220 : 130, len = heavy ? 22 : 15, sl = heavy ? 0.55 : 0.18, sp = heavy ? 1500 : 900;
    g.fillStyle = heavy ? 'rgba(70,90,130,0.10)' : 'rgba(120,150,200,0.06)'; g.fillRect(0, 0, W, H);
    g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass ? (heavy ? 'rgba(235,244,255,0.85)' : 'rgba(235,246,255,0.9)') : 'rgba(110,160,230,0.28)';
      g.lineWidth = pass ? 1 : 2.4;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const px = (i * 97.31 + ts * sp * sl) % (W + 60) - 30;
        const py = (i * 53.17 + ts * sp * (0.8 + (i % 5) * 0.08)) % (H + 40) - 20;
        g.moveTo(px, py); g.lineTo(px + len * sl, py + len);
      }
      g.stroke();
    }
    if (heavy) {
      for (let i = 0; i < 14; i++) {
        const px = ((i * 211 + ts * 520) % (W + 80)) - 40, py = (i * 71 + Math.sin(ts * 3 + i) * 30 + 40 * i) % H;
        g.save(); g.translate(px, py); g.rotate(ts * 4 + i);
        g.beginPath(); g.ellipse(0, 0, 5, 2.4, 0, 0, TAU); g.fillStyle = i & 1 ? '#5aae02' : '#3fa63a'; g.fill(); g.strokeStyle = 'rgba(20,17,27,0.6)'; g.lineWidth = 0.8; g.stroke();
        g.restore();
      }
      const flash = Math.sin(ts * 0.7) * Math.sin(ts * 2.3);
      if (flash > 0.96) { g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 0, W, H); }
    }
  } else if (kind === 'cold') {
    g.fillStyle = 'rgba(150,196,255,0.10)'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      const px = (i * 131.7 + Math.sin(ts * 0.6 + i) * 20) % W, py = (i * 61.3 + ts * 22 * (0.5 + (i % 4) * 0.2)) % H, r = 1 + (i % 3) * 0.55;
      g.fillStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.arc(px, py, r + 1.6, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.92)'; g.beginPath(); g.arc(px, py, r, 0, TAU); g.fill();
    }
    const gr = g.createLinearGradient(0, H * 0.7, 0, H); gr.addColorStop(0, 'rgba(220,238,255,0)'); gr.addColorStop(1, 'rgba(220,238,255,0.2)');
    g.fillStyle = gr; g.fillRect(0, H * 0.7, W, H * 0.3);
  } else if (kind === 'hot') {
    const gr = g.createRadialGradient(W * 0.9, 0, 10, W * 0.9, 0, Math.max(W, H) * 0.9);
    gr.addColorStop(0, 'rgba(255,236,150,0.4)'); gr.addColorStop(1, 'rgba(255,200,90,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 6; i++) { const y0 = H * 0.5 + i * 40 + Math.sin(ts * 2 + i) * 6; rrect(g, 0, y0, W, 8, 4); g.fill(); }
  } else if (kind === 'cloudy') {
    g.fillStyle = 'rgba(190,206,228,0.09)'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(110,130,165,0.07)';
    for (let i = 0; i < 3; i++) { const cx = ((ts * 8 + i * W * 0.45) % (W + 360)) - 180, cy = H * (0.25 + i * 0.28); g.beginPath(); g.ellipse(cx, cy, 170, 46, 0, 0, TAU); g.fill(); }
  }
  void perfLevel;
}
// The vignette is a smooth gradient: it is rendered once into a quarter-resolution canvas and stretched over the view with
// bilinear filtering (a textured quad) instead of evaluating a radial-gradient shader over every device pixel each frame
// (the largest single fill of a frame on a phone-sized canvas). Differs from the analytic gradient by <= 1 level.
let _vg = null;
export function vignetteNew(g, W, H, dpr) {
  dpr = dpr || 1;
  if (!_vg || _vg.w !== W || _vg.h !== H || _vg.d !== dpr) {
    const cw = Math.max(8, Math.ceil(W * dpr / 4)), ch = Math.max(8, Math.ceil(H * dpr / 4));
    const c = newCanvas(cw, ch), gc = c.getContext('2d');
    gc.setTransform(cw / W, 0, 0, ch / H, 0, 0);
    const vg = gc.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.5, W / 2, H / 2, Math.max(W, H) * 0.85);
    vg.addColorStop(0, 'rgba(30,54,90,0)'); vg.addColorStop(1, 'rgba(30,54,90,0.17)');
    gc.fillStyle = vg; gc.fillRect(0, 0, W, H);
    _vg = { w: W, h: H, d: dpr, c };
  }
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low';
  g.drawImage(_vg.c, 0, 0, W, H);
  g.imageSmoothingEnabled = false;
}
