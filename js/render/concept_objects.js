// Concept-style objects + painted floors (S-N). Procedural redraw of every placeable that has no atlas sprite, in the style of
// docs/ART_STYLE.md (1px #14111b outline, 3-tone shading lit from the top-left, white top highlights, flat fills + 1px detail,
// bright-blue screens with white ECG / cross patterns).
//
// Pipeline (same idea as artdraw.js people): every object is drawn ONCE at 2x "design" resolution (K px per world px) into a
// master canvas, auto-outlined, then pre-scaled to the current device scale (zoom x DPR) on demand (lod()). Lines therefore stay
// crisp at every zoom, and a 1x1 machine has the same detail density as the atlas items next to it.
//
// Sprite contract (compatible with the atlas objects of artdraw.js): the master canvas carries .art=1 (hit-test scaling),
// .dw/.dh = size in world px, .ax/.ay = anchor in WORLD px (the top corner of the footprint's first tile), .cobj=1 and
// .lod(S, lvl, exact) -> pre-scaled canvas (blit() in artdraw.js draws that one). Painted floors are plain 64x32 canvases.
import { BUILDABLES } from '../data/buildables.js';

const K = 2;                       // design px per world px
const PAD = 8;                     // design px of padding around every master
const OUT = '#14111b';

// ───────────────────────── palette (assets/art concept sheet) ─────────────────────────
// ramp = { s: deepest (creases / underside), r: right face (dark), l: left face (mid), t: top (light), h: highlight }
const R = (s, r, l, t, h) => ({ s, r, l, t, h });
const C = {
  blue: R('#125ade', '#1e66ea', '#2a7ef6', '#5aaef6', '#9cc8f8'),
  blueD: R('#0e3f9c', '#125ade', '#1e66ea', '#368af6', '#7ab4f6'),
  navy: R('#14213a', '#1e365a', '#2a365a', '#364272', '#5a667e'),
  steel: R('#5a667e', '#7e8aba', '#96a2c6', '#d2d2de', '#f6f6f6'),
  white: R('#aab4cc', '#c6cede', '#e6eaf4', '#f6f6f6', '#ffffff'),
  panel: R('#9fb8cc', '#c2d6e4', '#eaf6f6', '#f6ffff', '#ffffff'),
  cream: R('#b4a8a0', '#d2c6ba', '#e8dccc', '#f2e8da', '#fdf6ec'),
  wall: R('#bba890', '#d8c8ae', '#ecd8b8', '#f6eadc', '#fff8ee'),
  wood: R('#7a5a3c', '#a97f55', '#c8a27a', '#e2c49a', '#f6e2bc'),
  woodD: R('#4a3626', '#6e5034', '#8a6644', '#a97f55', '#c8a27a'),
  green: R('#0e3c34', '#164a3e', '#1e5a4e', '#2a7a5e', '#5cb08a'),
  greenL: R('#164a3e', '#1e5a4e', '#2a664e', '#3a8a68', '#7ac49a'),
  leaf: R('#1e5a4e', '#2a7a2a', '#429602', '#5aae02', '#9bd44a'),
  red: R('#8c1c2c', '#b82a3c', '#e23a3a', '#ee5a5a', '#ff9a8a'),
  rose: R('#9a2a48', '#c43e5a', '#d24e66', '#e87a8e', '#f6b0bc'),
  orange: R('#a8481c', '#d06a2a', '#ea7e4e', '#f4a070', '#ffd0a8'),
  yellow: R('#b8841c', '#dca630', '#f6c64e', '#ffe08a', '#fff4c0'),
  purple: R('#3c3c78', '#5a5aa2', '#7a6ab6', '#9a7fc6', '#c8b4ea'),
  teal: R('#145a72', '#1e7ea2', '#2a9ec0', '#5ac8dc', '#a8ecf0'),
  glass: R('#2a7ef6', '#5aaef6', '#9cc8f8', '#cfe6f5', '#ffffff'),
  dark: R('#0c0a12', '#14111b', '#1e1e36', '#2a2a48', '#5a667e'),
  soil: R('#2a1c12', '#3a281a', '#4a3626', '#5c4630', '#7a5a3c'),
  pot: R('#7a3a1e', '#a24e26', '#c8662e', '#e08a4e', '#f6b07a'),
};
const BALLS = [C.red, C.yellow, C.blue, C.leaf, C.purple, C.orange, C.teal, C.rose];
const SCR = '#368af6', SCR_D = '#1e66ea', SCR_H = '#9cc8f8', WHITE = '#f6f6f6';

const hash = (x, y, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ───────────────────────── pixel rasteriser ─────────────────────────
function fillPoly(g, pts, col) {
  let y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
  g.fillStyle = col;
  const n = pts.length, xs = [];
  for (let y = Math.ceil(y0 - 0.5), ye = Math.ceil(y1 - 0.5); y < ye; y++) {
    const yc = y + 0.5; xs.length = 0;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if ((a[1] <= yc && b[1] > yc) || (b[1] <= yc && a[1] > yc)) xs.push(a[0] + (yc - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.ceil(xs[i] - 0.5), xb = Math.ceil(xs[i + 1] - 0.5);
      if (xb > xa) g.fillRect(xa, y, xb - xa, 1);
    }
  }
}
function fillEll(g, cx, cy, rx, ry, col) {
  g.fillStyle = col;
  for (let y = Math.ceil(cy - ry - 0.5); y <= Math.floor(cy + ry - 0.5); y++) {
    const d = (y + 0.5 - cy) / ry; if (d * d >= 1) continue;
    const hw = rx * Math.sqrt(1 - d * d);
    const xa = Math.ceil(cx - hw - 0.5), xb = Math.ceil(cx + hw - 0.5);
    if (xb > xa) g.fillRect(xa, y, xb - xa, 1);
  }
}
function line(g, x0, y0, x1, y1, col, th = 1) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  g.fillStyle = col;
  for (let i = 0; i < 2000; i++) {
    g.fillRect(x0, y0, th, th);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
const LX = -0.52, LY = -0.62, LZ = 0.59;     // light direction (from the top-left)
function sphere(g, cx, cy, rx, ry, ramp, spec = true) {
  for (let y = Math.ceil(cy - ry - 0.5); y <= Math.floor(cy + ry - 0.5); y++) {
    for (let x = Math.ceil(cx - rx - 0.5); x <= Math.floor(cx + rx - 0.5); x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry, q = nx * nx + ny * ny;
      if (q >= 1) continue;
      const d = nx * LX + ny * LY + Math.sqrt(1 - q) * LZ;
      g.fillStyle = d > 0.74 ? ramp.t : d > 0.22 ? ramp.l : ramp.r;
      g.fillRect(x, y, 1, 1);
    }
  }
  if (spec && rx >= 4) {
    g.fillStyle = ramp.h;
    const sx = Math.round(cx - rx * 0.42), sy = Math.round(cy - ry * 0.5);
    g.fillRect(sx, sy, Math.max(1, Math.round(rx * 0.28)), 1);
    if (rx >= 7) g.fillRect(sx - 1, sy + 1, 1, 1);
  }
}

// ───────────────────────── iso pen (design px; u along def.w, v along def.h, z in world px) ─────────────────────────
function makePen(g, AX, AY, rot) {
  const sn = v => Math.round(v * 32) / 32;
  const pt = (u, v, z) => {
    u = sn(u); v = sn(v);
    if (rot) { const t = u; u = v; v = t; }
    return [AX + (u - v) * 64, AY + (u + v) * 32 - Math.round(z * K)];
  };
  const side = (s, flip) => (flip ? (s === 'l' ? 'r' : 'l') : s);
  const colr = (c, s) => (typeof c === 'string' ? c : c[s]);
  const poly = (pts, col) => fillPoly(g, pts, col);
  const P = { g, rot, pt };
  // axis-aligned box: left face (+v side), right face (+u side), top
  P.box = (u0, v0, u1, v1, z0, z1, c, o = {}) => {
    if (u1 <= u0 || v1 <= v0) return;
    const A = pt(u0, v0, z1), B = pt(u1, v0, z1), Cc = pt(u1, v1, z1), D = pt(u0, v1, z1);
    const b0 = pt(u0, v1, z0), b1 = pt(u1, v1, z0), b2 = pt(u1, v0, z0), b3 = pt(u0, v0, z0);
    // which of the logical faces are the visible actual left / right faces
    const faces = [[D, Cc, b1, b0], [B, Cc, b1, b2]];        // logical v1-face, logical u1-face
    const lc = c.l ? c : { l: c, r: c, t: c, s: c, h: c };
    // logical v1-face is the actual LEFT face when rot=0, actual RIGHT face when rot=1
    poly(faces[0], rot ? lc.r : lc.l);
    poly(faces[1], rot ? lc.l : lc.r);
    poly([A, B, Cc, D], lc.t);
    if (o.edge !== false && z1 - z0 > 2) {
      // top-left highlight rim + vertical front corner crease
      line(g, D[0], D[1], Cc[0], Cc[1], lc.h);
      line(g, A[0], A[1], D[0], D[1], lc.h);
      if (z1 - z0 > 4) line(g, Cc[0], Cc[1], b1[0], b1[1], lc.s);
    }
    return { A, B, C: Cc, D, b0, b1, b2, b3 };
  };
  P.fL = (u0, u1, v, z0, z1, c) => poly([pt(u0, v, z1), pt(u1, v, z1), pt(u1, v, z0), pt(u0, v, z0)], colr(c, side('l', rot)));
  P.fR = (v0, v1, u, z0, z1, c) => poly([pt(u, v0, z1), pt(u, v1, z1), pt(u, v1, z0), pt(u, v0, z0)], colr(c, side('r', rot)));
  P.top = (u0, v0, u1, v1, z, c) => poly([pt(u0, v0, z), pt(u1, v0, z), pt(u1, v1, z), pt(u0, v1, z)], colr(c, 't'));
  P.poly3 = (pts, c) => poly(pts.map(q => pt(q[0], q[1], q[2])), c);
  P.ln = (u0, v0, z0, u1, v1, z1, c, th = 1) => { const a = pt(u0, v0, z0), b = pt(u1, v1, z1); line(g, a[0], a[1], b[0], b[1], c, th); };
  P.dot = (u, v, z, c, w = 1, h = 1) => { const a = pt(u, v, z); g.fillStyle = c; g.fillRect(a[0], a[1], w, h); };
  // ground disc (rw = horizontal radius in world px)
  P.disc = (u, v, z, rw, c) => { const a = pt(u, v, z); fillEll(g, a[0], a[1], rw * K, rw * K / 2, colr(c, 't')); };
  P.ball = (u, v, z, rw, c, rh) => { const a = pt(u, v, z); sphere(g, a[0], a[1], rw * K, (rh || rw) * K, c); };
  // vertical (optionally tapered) cylinder, radii in world px (horizontal)
  P.cyl = (u, v, z0, z1, r0, r1, c, o = {}) => {
    if (r1 == null) r1 = r0;
    const a = pt(u, v, z0), b = pt(u, v, z1);
    const yb = a[1], yt = b[1], cx = a[0];
    const R0 = r0 * K, R1 = r1 * K, ry0 = R0 / 2, ry1 = R1 / 2;
    fillEll(g, cx, yb, R0, ry0, c.r);
    for (let y = Math.ceil(yt - 0.5); y <= Math.floor(yb - 0.5); y++) {
      const t = (y + 0.5 - yt) / Math.max(1, yb - yt);
      const hw = R1 + (R0 - R1) * t;
      const xa = Math.ceil(cx - hw - 0.5), xb = Math.ceil(cx + hw - 0.5);
      for (let x = xa; x < xb; x++) {
        const d = (x + 0.5 - cx) / hw;
        g.fillStyle = d < -0.62 ? c.t : d < 0.12 ? c.l : c.r;
        g.fillRect(x, y, 1, 1);
      }
      if (o.hi !== false) { g.fillStyle = c.h; g.fillRect(Math.round(cx - hw * 0.62), y, 1, 1); }
    }
    // bottom curve (drawn over the straight rows' lower edge) then top cap
    for (let x = Math.ceil(cx - R0 - 0.5); x < Math.ceil(cx + R0 - 0.5); x++) {
      const d = (x + 0.5 - cx) / R0; const yy = yb + ry0 * Math.sqrt(Math.max(0, 1 - d * d));
      g.fillStyle = d < -0.62 ? c.t : d < 0.12 ? c.l : c.r;
      for (let y = Math.round(yb); y < Math.round(yy); y++) g.fillRect(x, y, 1, 1);
    }
    if (o.cap !== false) { fillEll(g, cx, yt, R1, ry1, o.capCol || c.t); if (R1 > 6 && o.rim !== false) { g.fillStyle = c.h; for (let x = Math.round(cx - R1 * 0.7); x < cx - R1 * 0.2; x++) g.fillRect(x, Math.round(yt - ry1 * 0.7), 1, 1); } }
  };
  // filled ellipse painted on a vertical logical face ('L': face at v spanning u, 'R': face at u spanning v); radii in world px
  P.fcirc = (face, u, v, z, rw, c, rz) => {
    const a = pt(u, v, z), slope = ((face === 'L') !== !!rot) ? 0.5 : -0.5;
    const rx = rw * K, ry = (rz || rw) * K;
    g.fillStyle = c;
    for (let x = Math.ceil(a[0] - rx - 0.5); x < Math.ceil(a[0] + rx - 0.5); x++) {
      const d = (x + 0.5 - a[0]) / rx, hh = ry * Math.sqrt(Math.max(0, 1 - d * d));
      const yc = a[1] + (x + 0.5 - a[0]) * slope;
      const y0 = Math.ceil(yc - hh - 0.5), y1 = Math.ceil(yc + hh - 0.5);
      if (y1 > y0) g.fillRect(x, y0, 1, y1 - y0);
    }
  };
  // polyline in face coordinates: pts of [a, t] with a in 0..1 along the face (u or v), t in 0..1 up the face
  P.faceLine = (face, f0, f1, k, z0, z1, pts, c) => {
    const mp = q => (face === 'L' ? pt(f0 + (f1 - f0) * q[0], k, z0 + (z1 - z0) * q[1]) : pt(k, f0 + (f1 - f0) * q[0], z0 + (z1 - z0) * q[1]));
    for (let i = 0; i + 1 < pts.length; i++) { const a = mp(pts[i]), b = mp(pts[i + 1]); line(g, a[0], a[1], b[0], b[1], c); }
  };
  // screen panel on a logical face with a white pattern. kind: ecg | cross | fan | wave | heart
  P.screen = (face, f0, f1, k, z0, z1, kind = 'ecg', bg = SCR) => {
    const fn = face === 'L' ? P.fL : P.fR;
    fn(f0, f1, k, z0, z1, '#14111b');                                  // bezel
    const ins = 0.04 * (f1 - f0);
    const dz = Math.min(1.1, (z1 - z0) * 0.12);
    fn(f0 + ins, f1 - ins, k, z0 + dz, z1 - dz, kind === 'fan' ? '#1e365a' : bg);
    const a0 = f0 + ins, a1 = f1 - ins, y0 = z0 + dz, y1 = z1 - dz;
    const F = (pts, c) => P.faceLine(face, a0, a1, k, y0, y1, pts, c);
    if (kind === 'ecg' || kind === 'heart') {
      F([[0.08, 0.45], [0.34, 0.45], [0.42, 0.78], [0.5, 0.2], [0.58, 0.62], [0.64, 0.45], [0.92, 0.45]], '#f6f6f6');
      F([[0.08, 0.15], [0.3, 0.15]], SCR_H); F([[0.62, 0.15], [0.92, 0.15]], SCR_H);
    } else if (kind === 'cross') {
      F([[0.5, 0.2], [0.5, 0.8]], '#f6f6f6'); F([[0.32, 0.5], [0.68, 0.5]], '#f6f6f6');
      F([[0.47, 0.2], [0.47, 0.8]], '#f6f6f6'); F([[0.32, 0.47], [0.68, 0.47]], '#f6f6f6');
    } else if (kind === 'fan') {
      F([[0.5, 0.88], [0.2, 0.18]], '#5aaef6'); F([[0.5, 0.88], [0.8, 0.18]], '#5aaef6');
      F([[0.2, 0.18], [0.5, 0.1], [0.8, 0.18]], '#9cc8f8'); F([[0.5, 0.7], [0.5, 0.3]], '#2a7ef6'); F([[0.38, 0.55], [0.62, 0.55]], '#2a7ef6');
    } else if (kind === 'wave') {
      F([[0.06, 0.5], [0.2, 0.72], [0.32, 0.28], [0.44, 0.72], [0.56, 0.28], [0.68, 0.72], [0.8, 0.28], [0.94, 0.5]], '#f6f6f6');
    }
  };
  return P;
}

// ───────────────────────── scene helpers shared by several objects ─────────────────────────
function monitor(P, u, v, z, w = 0.36, kind = 'ecg') {          // desktop monitor: stand + bezel, screen on the logical +v face
  P.box(u + w / 2 - 0.05, v - 0.03, u + w / 2 + 0.05, v + 0.05, z, z + 1.5, C.navy, { edge: false });
  P.box(u + w / 2 - 0.02, v - 0.01, u + w / 2 + 0.02, v + 0.03, z + 1, z + 4, C.steel, { edge: false });
  P.box(u, v - 0.04, u + w, v + 0.04, z + 4, z + 14, C.navy);
  P.screen('L', u, u + w, v + 0.04, z + 4.6, z + 13.4, kind);
}
function keyboard(P, u, v, z) { P.box(u, v, u + 0.3, v + 0.1, z, z + 0.8, C.white, { edge: false }); P.top(u + 0.03, v + 0.02, u + 0.27, v + 0.06, z + 0.8, '#9cc8f8'); }
function lampShade(P, u, v, z, c = C.yellow) { P.cyl(u, v, z, z + 1.5, 2, 2, C.steel); P.cyl(u, v, z + 1.5, z + 3.5, 1, 1, C.steel, { cap: false }); P.cyl(u, v, z + 3.5, z + 9, 4.5, 3.2, c); }
function pillow(P, u0, v0, u1, v1, z) { P.box(u0, v0, u1, v1, z, z + 2, C.white); }
function treatBed(P, u0, v0, u1, v1, o = {}) {              // blue-topped treatment bed, long axis 'v' (default) or 'u'; pillow at the low end
  const legC = C.steel;
  for (const [a, b] of [[u0 + 0.04, v0 + 0.04], [u1 - 0.1, v0 + 0.04], [u0 + 0.04, v1 - 0.1], [u1 - 0.1, v1 - 0.1]]) P.box(a, b, a + 0.06, b + 0.06, 0, 5, legC, { edge: false });
  P.box(u0, v0, u1, v1, 5, 8.5, o.frame || C.white);
  P.box(u0 + 0.02, v0 + 0.02, u1 - 0.02, v1 - 0.02, 8.5, 12, o.sheet || C.blue);
  if (o.axis === 'u') pillow(P, u0 + 0.06, v0 + 0.06, u0 + 0.3, v1 - 0.06, 12);
  else pillow(P, u0 + 0.06, v0 + 0.05, u1 - 0.06, v0 + 0.3, 12);
}
function winL(P, u0, u1, v, z0, z1) {                         // window on the wall face at v (logical left face)
  P.fL(u0, u1, v, z0, z1, '#f6f6f6');
  const du = (u1 - u0) * 0.07, dz = 1.4;
  P.fL(u0 + du, u1 - du, v, z0 + dz, z1 - dz, '#bfe0f2');
  P.fL(u0 + du, u1 - du, v, z1 - dz - 4, z1 - dz, '#d8eef9');
  P.fL((u0 + u1) / 2 - 0.015, (u0 + u1) / 2 + 0.015, v, z0 + dz, z1 - dz, '#f6f6f6');
  P.fL(u0 + du, u1 - du, v, (z0 + z1) / 2 - 0.5, (z0 + z1) / 2 + 0.5, '#f6f6f6');
  P.ln(u0 + du * 1.6, v, z0 + dz + 1.5, u0 + du * 1.6 + (u1 - u0) * 0.14, v, z0 + dz + 8, '#eef8fc');
}
function winR(P, v0, v1, u, z0, z1) {
  P.fR(v0, v1, u, z0, z1, '#f6f6f6');
  const dv = (v1 - v0) * 0.07, dz = 1.4;
  P.fR(v0 + dv, v1 - dv, u, z0 + dz, z1 - dz, '#a8d4ee');
  P.fR(v0 + dv, v1 - dv, u, z1 - dz - 4, z1 - dz, '#c4e4f6');
  P.fR((v0 + v1) / 2 - 0.015, (v0 + v1) / 2 + 0.015, u, z0 + dz, z1 - dz, '#f6f6f6');
  P.fR(v0 + dv, v1 - dv, u, (z0 + z1) / 2 - 0.5, (z0 + z1) / 2 + 0.5, '#f6f6f6');
}
function frameL(P, u0, u1, v, z0, z1, fill, border = '#f6f6f6') { P.fL(u0, u1, v, z0, z1, border); P.fL(u0 + 0.04, u1 - 0.04, v, z0 + 1, z1 - 1, fill); }
function frameR(P, v0, v1, u, z0, z1, fill, border = '#f6f6f6') { P.fR(v0, v1, u, z0, z1, border); P.fR(v0 + 0.04, v1 - 0.04, u, z0 + 1, z1 - 1, fill); }

// dollhouse room shell: cream walls, white trim, blue accent band, beige tile floor, low front partitions with door gaps.
function roomShell(P, w, h, o = {}) {
  const T = 0.09, WH = o.wh || 40, acc = o.acc || C.blue;
  // floor slab + tile checker
  P.box(0, 0, w, h, 0, 2, C.cream, { edge: false });
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) P.top(i + 0.02, j + 0.02, i + 0.98, j + 0.98, 2, (i + j) & 1 ? '#e6d8c8' : '#eee2d4');
  for (let i = 0; i <= w; i++) P.ln(i, 0, 2, i, h, 2, '#d2c6ba');
  for (let j = 0; j <= h; j++) P.ln(0, j, 2, w, j, 2, '#d2c6ba');
  if (o.rug) o.rug(P);
  // back walls
  P.box(0, 0, w, T, 2, WH, C.wall, { edge: false });
  P.box(0, T, T, h, 2, WH, C.wall, { edge: false });
  P.top(0, 0, w, T, WH, '#fdf6ec'); P.top(0, T, T, h, WH, '#fdf6ec');
  // baseboards, accent band, cap
  P.fL(T, w, T, 2, 5, '#f6f6f6'); P.fR(T, h, T, 2, 5, '#f6f6f6');
  P.fL(T, w, T, 5, 5.5, '#d2c6ba'); P.fR(T, h, T, 5, 5.5, '#bba890');
  P.fL(T, w, T, WH * 0.5, WH * 0.5 + 3.5, acc.l); P.fR(T, h, T, WH * 0.5, WH * 0.5 + 3.5, acc.r);
  P.fL(T, w, T, WH * 0.5 + 3.5, WH * 0.5 + 4.5, '#f6f6f6'); P.fR(T, h, T, WH * 0.5 + 3.5, WH * 0.5 + 4.5, '#d2d2de');
  P.fL(T, w, T, WH - 2, WH, '#f6f6f6'); P.fR(T, h, T, WH - 2, WH, '#d2d2de');
  // the wall's own vertical highlight at the inner corner
  P.ln(T, T, 2, T, T, WH, '#b4a8a0');
  if (o.decor) o.decor(P);
  if (o.furnish) o.furnish(P);
  // low front partitions with a door gap (so the inside stays readable)
  const PH = 9, gA = h / 2 - 0.3, gB = h / 2 + 0.3, gC = w / 2 - 0.3, gD = w / 2 + 0.3;
  const wallSeg = (u0, v0, u1, v1) => {
    P.box(u0, v0, u1, v1, 2, PH, C.wall, { edge: false });
    P.box(u0, v0, u1, v1, PH, PH + 1.5, C.white);
    P.box(u0, v0, u1, v1, PH - 3.5, PH - 1, acc, { edge: false });
  };
  wallSeg(T, h - T, gC, h); wallSeg(gD, h - T, w, h);          // front-left edge (v = h)
  wallSeg(w - T, T, w, gA); wallSeg(w - T, gB, w, h - T);      // front-right edge (u = w)
  P.box(0, h - T, T, h, 2, WH - 14, C.wall); P.box(0, h - T, T, h, WH - 14, WH - 12, C.white);   // front corner post
}

// ───────────────────────── objects ─────────────────────────
// each: { hm: height above the footprint's top corner (world px), draw(P, w, h) } ; (w,h) = logical footprint
const DRAW = {
  sofa: { hm: 34, draw(P, w) {
    const g = C.greenL, gd = C.green;
    for (const [a, b] of [[0.08, 0.1], [w - 0.15, 0.1], [0.08, 0.86], [w - 0.15, 0.86]]) P.box(a, b, a + 0.07, b + 0.07, 0, 3, C.steel, { edge: false });
    P.box(0.04, 0.06, w - 0.04, 0.96, 3, 8, gd);
    P.box(0.04, 0.06, w - 0.04, 0.38, 8, 28, g);                        // backrest
    for (let i = 1; i < w; i++) P.fL(i - 0.012, i + 0.012, 0.38, 10, 27, C.green.l);
    for (let i = 0; i < w; i++) { P.dot(i + 0.5, 0.38, 22, C.greenL.h); P.dot(i + 0.5, 0.38, 15, C.greenL.h); }
    P.box(0.04, 0.06, 0.3, 0.96, 8, 19, g);                              // left arm
    for (let i = 0; i < w; i++) P.box(0.3 + i * (w - 0.6) / w, 0.38, 0.3 + (i + 1) * (w - 0.6) / w - 0.02, 0.94, 8, 13, C.greenL);
    P.box(0.34, 0.42, 0.62, 0.56, 13, 21, C.yellow);                      // cushion
    P.box(w - 0.3, 0.06, w - 0.04, 0.96, 8, 19, g);                      // right arm
  } },
  water: { hm: 50, draw(P) {
    P.box(0.27, 0.27, 0.73, 0.73, 0, 26, C.panel);
    P.fL(0.27, 0.73, 0.73, 3, 4, C.panel.s);
    P.fL(0.34, 0.66, 0.73, 17, 22, C.blueD.l);
    P.fL(0.4, 0.46, 0.73, 12, 15, '#e23a3a'); P.fL(0.54, 0.6, 0.73, 12, 15, '#2a7ef6');
    P.fL(0.34, 0.66, 0.73, 6, 9, '#9fb8cc');
    P.box(0.25, 0.25, 0.75, 0.75, 26, 28, C.steel);
    P.cyl(0.5, 0.5, 28, 46, 9, 9, C.glass, { capCol: '#cfe6f5' });
    P.cyl(0.5, 0.5, 46, 49, 4, 5, C.white);
    P.fL(0.4, 0.6, 0.73, 22.5, 23.5, '#9cc8f8');
  } },
  tv: { hm: 52, draw(P, w) {
    // low media cabinet + wall-style flat screen
    P.box(0.08, 0.2, w - 0.08, 0.78, 0, 11, C.cream);
    P.fL(0.1, w - 0.1, 0.78, 3, 4, C.cream.s);
    for (let i = 0; i < 4; i++) P.fL(0.2 + i * (w - 0.4) / 4, 0.2 + (i + 1) * (w - 0.4) / 4 - 0.04, 0.78, 4.5, 9.5, i & 1 ? C.cream.l : C.cream.t);
    for (let i = 0; i < 4; i++) P.dot(0.2 + (i + 0.5) * (w - 0.4) / 4, 0.78, 7, C.steel.l);
    P.box(0.04, 0.16, w - 0.04, 0.82, 11, 12.5, C.wood);
    P.box(w / 2 - 0.12, 0.36, w / 2 + 0.12, 0.5, 12.5, 15, C.steel, { edge: false });     // stand
    P.box(0.14, 0.4, w - 0.14, 0.52, 15, 41, C.navy);                                      // panel
    P.screen('L', 0.2, w - 0.2, 0.52, 16.4, 39.6, 'ecg');
    P.box(0.3, 0.25, 0.5, 0.35, 12.5, 14, C.steel, { edge: false });                       // set-top box
    P.ball(w - 0.25, 0.5, 15.5, 3, C.leaf);
  } },
  plant: { hm: 58, draw(P) {
    P.cyl(0.5, 0.5, 0, 15, 8.5, 11, C.pot);
    P.cyl(0.5, 0.5, 14, 17, 11.5, 11.5, C.pot, { capCol: C.soil.l });
    const B = (u, v, z, rx, ry) => P.ball(u, v, z, rx, C.leaf, ry);
    // dome of leaf blobs, back to front, bottom to top
    B(0.5, 0.3, 28, 9, 8); B(0.28, 0.4, 25, 9, 7); B(0.7, 0.34, 26, 9, 7); B(0.3, 0.62, 24, 9, 7); B(0.72, 0.62, 24, 9, 7);
    B(0.5, 0.45, 34, 11, 9); B(0.34, 0.5, 36, 8, 8); B(0.66, 0.5, 36, 8, 8);
    B(0.5, 0.66, 28, 10, 8);
    B(0.42, 0.42, 45, 7, 7); B(0.6, 0.46, 46, 7, 7); B(0.5, 0.5, 52, 5, 5);
    for (const [u, v, z] of [[0.4, 0.7, 28], [0.62, 0.7, 26], [0.5, 0.58, 40], [0.3, 0.5, 31], [0.7, 0.5, 32]]) { P.ln(u, v, z, u + 0.06, v, z + 5, C.leaf.s); P.dot(u - 0.04, v, z + 3, C.leaf.h, 2, 1); }
  } },
  sign: { hm: 34, draw(P) {
    P.box(0.3, 0.38, 0.7, 0.62, 0, 3, C.steel);
    P.box(0.46, 0.46, 0.54, 0.54, 3, 22, C.steel, { edge: false });
    P.box(0.12, 0.42, 0.88, 0.58, 18, 34, C.blue);
    P.fL(0.16, 0.84, 0.58, 19.2, 32.8, '#2a7ef6');
    // arrow + cross
    P.faceLine('L', 0.16, 0.84, 0.58, 19.2, 32.8, [[0.14, 0.5], [0.52, 0.5]], '#f6f6f6');
    P.faceLine('L', 0.16, 0.84, 0.58, 19.2, 32.8, [[0.14, 0.56], [0.52, 0.56]], '#f6f6f6');
    P.faceLine('L', 0.16, 0.84, 0.58, 19.2, 32.8, [[0.4, 0.84], [0.56, 0.53], [0.4, 0.2]], '#f6f6f6');
    P.faceLine('L', 0.16, 0.84, 0.58, 19.2, 32.8, [[0.43, 0.84], [0.59, 0.53], [0.43, 0.2]], '#f6f6f6');
    P.faceLine('L', 0.16, 0.84, 0.58, 19.2, 32.8, [[0.82, 0.3], [0.82, 0.72]], '#9cc8f8');
    P.faceLine('L', 0.16, 0.84, 0.58, 19.2, 32.8, [[0.72, 0.51], [0.92, 0.51]], '#9cc8f8');
  } },
  reception: { hm: 46, draw(P, w) {
    // counter: front desk (customer side +v) with a raised back shelf, monitor, bell
    P.box(0.05, 0.12, w - 0.05, 0.52, 0, 24, C.cream);                       // back unit
    P.box(0.05, 0.5, w - 0.05, 0.94, 0, 15, C.panel);                        // front desk body
    P.fL(0.1, w - 0.1, 0.94, 4, 9, C.blue.l);                                 // blue accent panel
    P.fL(0.1, w - 0.1, 0.94, 9, 10, '#f6f6f6'); P.fL(0.1, w - 0.1, 0.94, 3, 4, '#f6f6f6');
    P.fcirc('L', w / 2, 0.94, 6.5, 2.8, '#f6f6f6');                         // white cross emblem
    P.fL(w / 2 - 0.015, w / 2 + 0.015, 0.94, 3.6, 9.4, '#2a7ef6'); P.fL(w / 2 - 0.1, w / 2 + 0.1, 0.94, 6, 7, '#2a7ef6');
    P.box(0.02, 0.48, w - 0.02, 0.98, 15, 17, C.wood);                       // counter top
    P.box(0.05, 0.12, w - 0.05, 0.5, 24, 25.5, C.wood);
    monitor(P, 0.3, 0.3, 25.5, 0.4);
    keyboard(P, 0.34, 0.56, 17);
    // bell + ticket tray + pen cup
    P.cyl(w - 0.45, 0.72, 17, 18, 3.2, 3.2, C.yellow); P.ball(w - 0.45, 0.72, 18.5, 2.8, C.yellow); P.dot(w - 0.45, 0.72, 22, C.yellow.h);
    P.box(w - 0.9, 0.62, w - 0.65, 0.86, 17, 18, C.white, { edge: false }); P.box(w - 0.88, 0.64, w - 0.66, 0.84, 18, 19.2, '#f6f6f6', { edge: false });
    P.box(w - 0.95, 0.2, w - 0.8, 0.36, 25.5, 30, C.blue);
  } },
  heatbox: { hm: 44, draw(P) {
    // hydrocollator / hot-pack steamer: stainless tub with a red lid, display, knobs, steam, a red hot-pack draped on the lid
    P.box(0.2, 0.22, 0.8, 0.78, 0, 20, C.steel);
    P.fL(0.2, 0.8, 0.78, 3, 4, C.steel.s);
    P.fL(0.28, 0.72, 0.78, 12, 17, '#14111b'); P.fL(0.3, 0.7, 0.78, 12.8, 16.2, '#3a0e12');
    P.faceLine('L', 0.3, 0.7, 0.78, 12.8, 16.2, [[0.1, 0.5], [0.3, 0.5], [0.4, 0.9], [0.5, 0.1], [0.6, 0.5], [0.9, 0.5]], '#ff6a4a');
    P.dot(0.34, 0.78, 8, '#e23a3a', 2, 2); P.dot(0.48, 0.78, 8, '#f6c64e', 2, 2); P.dot(0.62, 0.78, 8, '#5aae02', 2, 2);
    P.box(0.16, 0.18, 0.84, 0.82, 20, 24, C.red);                              // lid
    P.box(0.4, 0.4, 0.6, 0.5, 24, 26, C.steel, { edge: false });               // lid handle
    // draped red hot-pack
    P.ball(0.5, 0.58, 27, 8, C.red, 4.5); P.ball(0.62, 0.52, 26, 5, C.red, 3.5);
    // steam
    const st = '#eaf6f6';
    for (const [u, v, z, r] of [[0.34, 0.4, 32, 3], [0.4, 0.38, 38, 3.5], [0.5, 0.4, 44, 3]]) P.ball(u, v, z, r, { t: '#ffffff', l: '#eaf6f6', r: '#cfe6f5', h: '#ffffff', s: st }, r * 0.8);
  } },
  ir_lamp: { hm: 70, draw(P) {
    // floor lamp on a 3-leg caster base, jointed arm, bell-shaped infrared head with a glowing red face
    P.cyl(0.5, 0.5, 0, 3, 11, 11, C.steel);
    for (const [u, v] of [[0.3, 0.3], [0.72, 0.34], [0.5, 0.74]]) P.ball(u, v, 1.5, 2.2, C.navy);
    P.cyl(0.5, 0.5, 3, 5, 4, 4, C.navy);
    P.box(0.47, 0.47, 0.53, 0.53, 5, 40, C.steel, { edge: false });
    P.box(0.455, 0.455, 0.545, 0.545, 18, 22, C.navy, { edge: false });
    P.ball(0.5, 0.5, 42, 4, C.steel);
    P.ln(0.5, 0.5, 42, 0.5, 0.66, 52, C.steel.t, 2);
    P.ball(0.5, 0.66, 52, 3, C.steel);
    // head: dark bell housing + red grille face looking down-left
    P.box(0.34, 0.6, 0.72, 0.86, 46, 66, C.steel);
    P.fL(0.34, 0.72, 0.86, 46, 66, C.navy.l);
    P.fL(0.37, 0.69, 0.86, 48.5, 63.5, '#e23a3a');
    P.fL(0.4, 0.66, 0.86, 51, 61, '#ff6a4a');
    P.fL(0.45, 0.61, 0.86, 54, 58, '#ffb090');
    for (const z of [50.2, 53.2, 56.2, 59.2, 62.2]) P.fL(0.37, 0.69, 0.86, z, z + 0.5, '#8c1c2c');
    P.box(0.34, 0.6, 0.72, 0.86, 66, 68, C.steel);
  } },
  redcord: { hm: 56, draw(P, w, h) {
    // blue mat + slim steel suspension frame + red cords with grips
    P.box(0.1, 0.1, 1.9, 1.9, 0, 2, C.blue, { edge: false });
    P.top(0.16, 0.16, 1.84, 1.84, 2, '#368af6');
    for (let i = 1; i < 6; i++) P.ln(0.16, 0.16 + i * 0.28, 2, 1.84, 0.16 + i * 0.28, 2, '#2a7ef6');
    P.ln(0.16, 1.0, 2, 1.84, 1.0, 2, '#9cc8f8');
    const post = (u, v) => P.box(u, v, u + 0.07, v + 0.07, 2, 50, C.steel);
    post(0.14, 0.14);
    P.box(0.14, 0.14, 0.21, 1.93, 48, 51, C.steel);
    P.box(0.14, 0.14, 1.93, 0.21, 48, 51, C.steel);
    post(0.14, 1.86);
    post(1.86, 0.14);
    P.box(0.14, 0.97, 1.93, 1.04, 48, 51, C.navy);
    P.box(0.84, 0.92, 1.08, 1.08, 44, 48, C.navy);
    for (const [u, v] of [[0.9, 1.06], [1.02, 1.06]]) {
      P.ln(u, v, 44, u, v + 0.02, 20, '#e23a3a', 2); P.ln(u, v, 44, u, v, 20, '#ff6a4a', 1);
      P.box(u - 0.035, v - 0.03, u + 0.035, v + 0.03, 15, 21, C.white, { edge: false });
    }
    P.box(0.84, 1.04, 1.08, 1.12, 8, 11, C.red);
    P.ln(0.9, 1.06, 15, 0.88, 1.08, 10, '#e23a3a', 2); P.ln(1.02, 1.06, 15, 1.04, 1.08, 10, '#e23a3a', 2);
    post(1.86, 1.86);
    P.box(1.86, 0.14, 1.93, 1.93, 48, 51, C.steel);
    P.box(0.14, 1.86, 1.93, 1.93, 48, 51, C.steel);
    P.dot(1.7, 1.0, 49, '#e23a3a', 4, 2);
  } },
  fine_table: { hm: 26, draw(P, w) {
    for (const [u, v] of [[0.14, 0.2], [w - 0.24, 0.2], [0.14, 0.76], [w - 0.24, 0.76]]) P.box(u, v, u + 0.1, v + 0.1, 0, 12, C.blue, { edge: false });
    P.box(0.06, 0.12, w - 0.06, 0.88, 12, 15, C.wood);
    P.top(0.1, 0.16, w - 0.1, 0.84, 15, '#e8cf9e');
    // peg board + beads + blocks + pencils
    P.box(0.18, 0.24, 0.62, 0.52, 15, 16, C.blue, { edge: false });
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) P.ball(0.26 + i * 0.1, 0.32 + j * 0.1, 18, 1.8, BALLS[(i + j * 2) % 5]);
    for (let i = 0; i < 5; i++) P.ball(1.0 + i * 0.1, 0.7 - (i & 1) * 0.06, 17.5, 2.2, BALLS[(i + 2) % 7]);
    P.box(w - 0.55, 0.3, w - 0.42, 0.43, 15, 19, C.red); P.box(w - 0.4, 0.34, w - 0.27, 0.47, 15, 19, C.yellow); P.box(w - 0.47, 0.32, w - 0.34, 0.45, 19, 22, C.blue);
    P.ln(1.1, 0.38, 15.5, 1.35, 0.3, 15.5, '#f6c64e', 2);
  } },
  coffee: { hm: 44, draw(P) {
    // espresso machine: dark body, steel front, blue display, two spouts, cup + drip tray, bean hopper on top
    P.box(0.22, 0.24, 0.78, 0.76, 0, 28, C.woodD);
    P.box(0.22, 0.24, 0.78, 0.76, 28, 30, C.steel);
    P.fL(0.22, 0.78, 0.76, 17, 27, C.steel.l);
    P.fL(0.3, 0.7, 0.76, 22, 26.5, '#14111b'); P.fL(0.32, 0.68, 0.76, 22.8, 25.7, '#2a7ef6');
    P.dot(0.5, 0.76, 24, '#f6f6f6', 4, 1); P.dot(0.4, 0.76, 25, '#f6f6f6', 2, 1);
    P.fL(0.3, 0.7, 0.76, 17.6, 19, '#14111b');
    P.box(0.34, 0.66, 0.4, 0.76, 15, 17.5, C.steel, { edge: false }); P.box(0.6, 0.66, 0.66, 0.76, 15, 17.5, C.steel, { edge: false });
    P.fL(0.22, 0.78, 0.76, 5, 7, '#14111b');
    P.box(0.26, 0.6, 0.74, 0.84, 5, 7, C.steel);
    P.cyl(0.5, 0.74, 7, 12, 3.4, 3, C.white);
    P.dot(0.5, 0.74, 11.2, '#6e5034', 4, 1);
    P.ball(0.28, 0.3, 21, 2, C.red);
    P.cyl(0.5, 0.4, 30, 40, 7, 7, C.glass, { capCol: C.glass.t });
    for (let i = 0; i < 5; i++) P.dot(0.42 + (i % 3) * 0.06, 0.4 + (i % 2) * 0.03, 33 + i * 1.2, '#6e5034', 3, 2);
    P.cyl(0.5, 0.4, 40, 42, 6, 6, C.steel);
  } },
  ball_pit: { hm: 20, draw(P) {
    // padded blue pen filled with coloured balls
    P.box(0.04, 0.04, 1.96, 1.96, 0, 2, C.teal, { edge: false });
    P.top(0.18, 0.18, 1.82, 1.82, 2, '#145a72');
    P.box(0.04, 0.04, 1.96, 0.2, 2, 13, C.blue);                               // back pads
    P.box(0.04, 0.2, 0.2, 1.96, 2, 13, C.blue);
    const bs = [];
    for (let j = 0; j < 9; j++) for (let i = 0; i < 9; i++) {
      const u = 0.28 + i * 0.18 + ((j & 1) ? 0.09 : 0) + (hash(i, j, 1) - 0.5) * 0.04, v = 0.28 + j * 0.18 + (hash(i, j, 2) - 0.5) * 0.04;
      if (u > 1.8 || v > 1.8) continue;
      bs.push([u, v, BALLS[Math.floor(hash(i, j, 4) * BALLS.length)], 6 + hash(i, j, 3) * 3]);
    }
    bs.sort((a, b) => (a[0] + a[1]) - (b[0] + b[1]));
    for (const [u, v, c, z] of bs) P.ball(u, v, z, 4.3, c);
    P.box(0.2, 1.8, 1.96, 1.96, 2, 13, C.blue);                                  // front pads
    P.box(1.8, 0.2, 1.96, 1.8, 2, 13, C.blue);
    for (let i = 0; i < 6; i++) { P.dot(0.32 + i * 0.28, 1.96, 8, C.blue.h, 2, 1); P.dot(1.96, 0.32 + i * 0.28, 8, C.blue.h, 1, 2); }
    P.ball(1.1, 2.12, 2.5, 3.2, C.yellow); P.ball(1.45, 2.05, 2.5, 3.2, C.red);
  } },
  bookshelf: { hm: 38, draw(P, w) {
    P.box(0.05, 0.3, w - 0.05, 0.84, 0, 32, C.wood);
    // recess + shelves + books on the front (+v) face
    P.fL(0.12, w - 0.12, 0.84, 2.5, 30, C.woodD.r);
    const tiers = [[3, 10], [12, 20], [22, 30]];
    tiers.forEach(([z0, z1], t) => {
      let u = 0.14;
      let k = 0;
      while (u < w - 0.26) {
        const bw = 0.06 + hash(k, t, 1) * 0.05, bh = (z1 - z0) * (0.62 + hash(k, t, 2) * 0.36);
        const c = BALLS[(k * 3 + t * 5) % BALLS.length];
        P.fL(u, u + bw - 0.012, 0.84, z0, z0 + bh, c.l); P.fL(u, u + 0.014, 0.84, z0, z0 + bh, c.t);
        u += bw; k++;
      }
      P.fL(0.1, w - 0.1, 0.84, z0 - 1.2, z0, C.wood.t);
    });
    P.box(0.05, 0.3, w - 0.05, 0.84, 32, 34, C.wood);
    P.ball(0.4, 0.55, 37, 3.4, C.yellow); P.box(w - 0.6, 0.45, w - 0.35, 0.7, 34, 38, C.red);
  } },
  exam_room: { ns: 1, hm: 44, draw(P) {
    roomShell(P, 2, 2, { wh: 40,
      decor(P) {
        winL(P, 1.1, 1.8, 0.09, 15, 34);
        frameR(P, 0.35, 1.0, 0.09, 17, 33, '#eaf6f6');                           // anatomy chart on the left wall
        P.faceLine('R', 0.35, 1.0, 0.09, 17, 33, [[0.5, 0.15], [0.5, 0.85]], '#5aaef6'); P.faceLine('R', 0.35, 1.0, 0.09, 17, 33, [[0.25, 0.6], [0.75, 0.6]], '#5aaef6');
        P.fcirc('R', 0.09, 0.78, 28, 1.4, '#e23a3a');
        // stethoscope on a hook
        P.dot(0.09, 1.28, 29, '#7e8aba', 2, 2);
        P.faceLine('R', 1.2, 1.5, 0.09, 14, 29, [[0.3, 0.95], [0.1, 0.6], [0.25, 0.3], [0.5, 0.2], [0.75, 0.3], [0.9, 0.6], [0.7, 0.95]], '#1e365a');
        P.fcirc('R', 0.09, 1.38, 15, 1.6, '#d2d2de');
      },
      furnish(P) {
        treatBed(P, 0.28, 0.5, 0.86, 1.78);
        // desk with drawers + monitor + stool
        P.box(1.1, 0.2, 1.9, 0.78, 0, 16, C.wood);
        P.fL(1.1, 1.9, 0.78, 2, 3, C.wood.s);
        for (let i = 0; i < 2; i++) { P.fL(1.15 + i * 0.4, 1.5 + i * 0.4, 0.78, 3.5, 7.5, C.wood.t); P.dot(1.32 + i * 0.4, 0.78, 6, C.steel.h, 3, 1); P.fL(1.15 + i * 0.4, 1.5 + i * 0.4, 0.78, 8.5, 14, C.wood.l); P.dot(1.32 + i * 0.4, 0.78, 11.5, C.steel.h, 3, 1); }
        P.box(1.06, 0.16, 1.94, 0.82, 16, 17.5, C.cream);
        monitor(P, 1.3, 0.34, 17.5, 0.4);
        keyboard(P, 1.34, 0.56, 17.5);
        P.cyl(1.7, 0.6, 17.5, 21, 2.2, 2.2, C.white);
        P.cyl(1.4, 1.2, 6, 8, 5, 5, C.navy); P.box(1.38, 1.18, 1.42, 1.22, 2, 6, C.steel, { edge: false });
      } });
  } },
  us_room: { ns: 1, hm: 44, draw(P) {
    roomShell(P, 2, 2, { wh: 40, acc: C.navy,
      decor(P) {
        winL(P, 1.25, 1.85, 0.09, 15, 34);
        P.fR(0.4, 1.1, 0.09, 16, 32, '#14111b'); P.screen('R', 0.42, 1.08, 0.09, 17, 31, 'fan');
      },
      furnish(P) {
        treatBed(P, 0.28, 0.5, 0.86, 1.78, { sheet: C.teal });
        // ultrasound cart
        for (const [u, v] of [[1.15, 0.62], [1.55, 0.62], [1.15, 1.0], [1.55, 1.0]]) P.ball(u, v, 1.5, 1.6, C.dark);
        P.box(1.08, 0.55, 1.62, 1.08, 3, 26, C.navy);
        P.fL(1.14, 1.56, 1.08, 6, 12, C.steel.l); P.fL(1.18, 1.52, 1.08, 7, 9, '#14111b');
        P.fL(1.14, 1.56, 1.08, 14, 15, C.steel.t);
        P.dot(1.2, 1.08, 20, '#e23a3a', 2, 2); P.dot(1.3, 1.08, 20, '#f6c64e', 2, 2);
        P.box(1.04, 0.5, 1.66, 0.82, 26, 28, C.steel);
        P.box(1.2, 0.58, 1.5, 0.66, 28, 31, C.steel, { edge: false });
        P.box(1.06, 0.55, 1.62, 0.7, 31, 46, C.navy);
        P.screen('L', 1.1, 1.58, 0.7, 32.2, 44.8, 'fan');
        P.ln(1.62, 1.0, 20, 1.78, 1.2, 12, '#14111b', 1); P.ball(1.78, 1.2, 11, 2.2, C.steel);
      } });
  } },
  rest_room: { ns: 1, hm: 44, draw(P) {
    roomShell(P, 2, 2, { wh: 40, acc: C.teal,
      rug: P => { P.disc(1.45, 1.35, 2, 20, C.blue); P.disc(1.45, 1.35, 2.2, 15, { t: '#9cc8f8' }); },
      decor(P) {
        winL(P, 0.95, 1.65, 0.09, 15, 34);
        frameR(P, 0.45, 0.95, 0.09, 17, 31, '#f4a3b8');
        P.fcirc('R', 0.09, 0.7, 24, 2.6, '#fff3d0');
      },
      furnish(P) {
        // bed with a rose blanket
        for (const [a, b] of [[0.34, 0.44], [0.9, 0.44], [0.34, 1.76], [0.9, 1.76]]) P.box(a, b, a + 0.07, b + 0.07, 0, 5, C.woodD, { edge: false });
        P.box(0.3, 0.42, 0.98, 1.82, 5, 9, C.white);
        P.box(0.32, 0.44, 0.96, 1.8, 9, 12.5, C.rose);
        P.box(0.32, 0.9, 0.96, 1.8, 12.5, 14, C.rose);
        P.fL(0.32, 0.96, 1.8, 11, 11.8, C.rose.t);
        pillow(P, 0.36, 0.46, 0.92, 0.72, 12.5);
        P.box(0.38, 0.5, 0.9, 0.7, 14.5, 15.5, C.white, { edge: false });
        // nightstand + lamp
        P.box(1.2, 0.24, 1.7, 0.62, 0, 14, C.wood);
        P.fL(1.24, 1.66, 0.62, 7.2, 8, C.wood.s); P.dot(1.44, 0.62, 10, C.steel.h, 3, 1); P.dot(1.44, 0.62, 4, C.steel.h, 3, 1);
        lampShade(P, 1.45, 0.43, 14, C.yellow);
        // plant in the corner
        P.cyl(1.7, 1.55, 0, 8, 4.5, 5.5, C.pot);
        P.ball(1.7, 1.55, 14, 5, C.leaf, 6); P.ball(1.62, 1.5, 19, 3.5, C.leaf, 4);
      } });
  } },
  shockwave_room: { ns: 1, hm: 44, draw(P) {
    roomShell(P, 2, 2, { wh: 40, acc: C.purple,
      decor(P) {
        winL(P, 1.2, 1.85, 0.09, 15, 34);
        P.fR(0.4, 1.1, 0.09, 16, 32, '#14111b'); P.screen('R', 0.42, 1.08, 0.09, 17, 31, 'wave');
      },
      furnish(P) {
        treatBed(P, 0.28, 0.5, 0.86, 1.78, { sheet: C.purple });
        // shockwave unit on a cart: white body, blue panel, handpiece on a coiled cable
        for (const [u, v] of [[1.18, 0.6], [1.6, 0.6], [1.18, 0.98], [1.6, 0.98]]) P.ball(u, v, 1.5, 1.6, C.dark);
        P.box(1.1, 0.52, 1.7, 1.06, 3, 25, C.white);
        P.fL(1.16, 1.64, 1.06, 6, 11, C.purple.l); P.fL(1.2, 1.4, 1.06, 7, 10, '#14111b');
        P.dot(1.5, 1.06, 8.5, '#f6c64e', 2, 2); P.dot(1.58, 1.06, 8.5, '#e23a3a', 2, 2);
        P.box(1.06, 0.48, 1.74, 0.8, 25, 27, C.steel);
        P.box(1.14, 0.52, 1.66, 0.62, 27, 43, C.navy);
        P.screen('L', 1.18, 1.62, 0.62, 28.4, 41.8, 'wave');
        P.faceLine('L', 1.7, 1.9, 1.0, 6, 22, [[0.1, 0.9], [0.3, 0.6], [0.2, 0.4], [0.5, 0.3], [0.6, 0.1]], '#1e365a');
        P.box(1.62, 1.18, 1.82, 1.34, 4, 9, C.orange); P.ball(1.72, 1.26, 9.5, 3, C.steel);
      } });
  } },
  laser_room: { ns: 1, hm: 44, draw(P) {
    roomShell(P, 2, 2, { wh: 40, acc: C.red,
      decor(P) {
        winL(P, 1.25, 1.85, 0.09, 15, 34);
        // warning triangle + goggles
        P.poly3([[0.09, 0.5, 18], [0.09, 1.0, 18], [0.09, 0.75, 32]], '#14111b');
        P.poly3([[0.09, 0.56, 19.2], [0.09, 0.94, 19.2], [0.09, 0.75, 30]], '#f6c64e');
        P.dot(0.09, 0.75, 21, '#14111b', 2, 5); P.dot(0.09, 0.75, 27, '#14111b', 2, 2);
        P.fcirc('R', 0.09, 1.3, 24, 1.8, '#2a7ef6'); P.fcirc('R', 0.09, 1.45, 23.5, 1.8, '#2a7ef6');
      },
      furnish(P) {
        treatBed(P, 0.28, 0.5, 0.86, 1.78, { sheet: C.rose });
        // laser cabinet + articulated arm + handpiece
        P.box(1.2, 0.3, 1.8, 0.82, 0, 30, C.white);
        P.fL(1.26, 1.74, 0.82, 4, 12, C.red.l); P.fL(1.3, 1.5, 0.82, 5.6, 10.4, '#14111b');
        P.dot(1.6, 0.82, 8, '#f6c64e', 2, 2); P.dot(1.68, 0.82, 8, '#e23a3a', 2, 2);
        P.fL(1.26, 1.74, 0.82, 16, 26, C.red.r);
        P.fcirc('L', 1.5, 0.82, 21, 3, '#f6c64e');
        P.box(1.14, 0.24, 1.86, 0.88, 30, 32, C.steel);
        P.box(1.4, 0.4, 1.5, 0.5, 32, 50, C.steel, { edge: false });
        P.ball(1.45, 0.45, 51, 2.5, C.steel);
        P.ln(1.45, 0.45, 51, 1.3, 0.95, 47, C.steel.t, 2); P.ball(1.3, 0.95, 47, 2.2, C.steel);
        P.box(1.24, 0.92, 1.36, 1.04, 28, 44, C.red); P.dot(1.3, 1.04, 28, '#ff9a8a', 2, 2);
        P.ln(1.3, 1.0, 28, 1.0, 1.3, 15, '#ff3a3a');
      } });
  } },
  manual_room: { ns: 1, hm: 44, draw(P) {
    roomShell(P, 2, 2, { wh: 40, acc: C.blue,
      decor(P) {
        winL(P, 1.25, 1.85, 0.09, 15, 34);
        // wall shelf with oil bottles
        P.box(0.12, 0.4, 0.2, 1.1, 21, 23, C.wood);
        P.cyl(0.15, 0.55, 23, 29, 2.4, 2.4, C.teal); P.cyl(0.15, 0.75, 23, 31, 2.4, 2.4, C.yellow); P.cyl(0.15, 0.95, 23, 28, 2.4, 2.4, C.rose);
        frameR(P, 1.2, 1.8, 0.09, 17, 31, '#eaf6f6');
        P.faceLine('R', 1.2, 1.8, 0.09, 17, 31, [[0.3, 0.2], [0.5, 0.8], [0.7, 0.2]], '#5aaef6');
      },
      furnish(P) {
        // wide wooden treatment table with a cream cover + rolled towel
        for (const [a, b] of [[0.3, 0.46], [0.88, 0.46], [0.3, 1.74], [0.88, 1.74]]) P.box(a, b, a + 0.1, b + 0.1, 0, 10, C.woodD, { edge: false });
        P.box(0.26, 0.44, 1.0, 1.84, 10, 14, C.wood);
        P.box(0.28, 0.46, 0.98, 1.82, 14, 17.5, C.cream);
        P.box(0.3, 0.48, 0.96, 0.68, 17.5, 20, C.white);
        P.cyl(0.9, 1.7, 17.5, 20.5, 3.2, 3.2, C.teal);
        // anatomical skeleton model on a stand
        P.cyl(1.5, 1.35, 0, 2, 7, 7, C.steel); P.box(1.46, 1.31, 1.54, 1.39, 2, 36, C.steel, { edge: false });
        P.ball(1.5, 1.35, 42, 4.2, C.white); P.dot(1.46, 1.46, 41, '#14111b', 2, 2); P.dot(1.54, 1.46, 41, '#14111b', 2, 2);
        P.ball(1.5, 1.35, 30, 6, C.white, 7); P.ln(1.4, 1.35, 33, 1.6, 1.35, 33, '#aab4cc'); P.ln(1.4, 1.35, 29, 1.6, 1.35, 29, '#aab4cc'); P.ln(1.4, 1.35, 25, 1.6, 1.35, 25, '#aab4cc');
        P.cyl(1.7, 0.55, 0, 8, 4, 5, C.pot); P.ball(1.7, 0.55, 14, 5, C.leaf, 6);
      } });
  } },
  speech_room: { ns: 1, hm: 44, draw(P) {
    roomShell(P, 2, 2, { wh: 40, acc: C.purple,
      decor(P) {
        // big wall mirror + speech-bubble poster
        P.fL(0.25, 1.3, 0.09, 12, 33, '#f6f6f6'); P.fL(0.3, 1.25, 0.09, 13.2, 31.8, '#bfe0f2'); P.fL(0.3, 1.25, 0.09, 24, 31.8, '#d8eef9');
        P.ln(0.4, 0.09, 15, 0.62, 0.09, 24, '#eef8fc');
        winL(P, 1.45, 1.9, 0.09, 15, 34);
        frameR(P, 0.45, 1.05, 0.09, 17, 33, '#f6f6f6');
        P.fcirc('R', 0.09, 0.75, 27, 3.6, C.purple.t, 2.6);
        P.dot(0.09, 0.66, 27, '#f6f6f6', 2, 2); P.dot(0.09, 0.75, 27, '#f6f6f6', 2, 2); P.dot(0.09, 0.84, 27, '#f6f6f6', 2, 2);
      },
      furnish(P) {
        // round table + two chairs + flash cards + microphone
        P.cyl(1.0, 1.0, 0, 11, 2.2, 2.2, C.steel, { cap: false });
        P.cyl(1.0, 1.0, 11, 14, 13, 13, C.wood);
        P.box(0.78, 0.9, 0.9, 1.04, 14, 14.8, C.red, { edge: false }); P.box(0.95, 0.84, 1.07, 0.98, 14, 14.8, C.yellow, { edge: false }); P.box(1.1, 0.94, 1.22, 1.08, 14, 14.8, C.blue, { edge: false });
        P.cyl(1.2, 0.8, 14, 20, 1.2, 1.2, C.steel); P.ball(1.2, 0.8, 21.5, 2.4, C.dark);
        const chair = (u, v, c) => { P.box(u, v, u + 0.3, v + 0.3, 7, 9, c); for (const [a, b] of [[u + 0.02, v + 0.02], [u + 0.24, v + 0.02], [u + 0.02, v + 0.24], [u + 0.24, v + 0.24]]) P.box(a, b, a + 0.04, b + 0.04, 0, 7, C.steel, { edge: false }); };
        P.box(0.42, 0.7, 0.72, 0.78, 9, 19, C.green);
        chair(0.42, 0.7, C.greenL);
        chair(1.42, 1.3, C.blue); P.box(1.42, 1.58, 1.72, 1.66, 9, 19, C.blue);
        P.cyl(0.3, 1.6, 0, 7, 3.5, 4.2, C.pot); P.ball(0.3, 1.6, 12, 4.2, C.leaf, 5);
      } });
  } },
  si_room: { ns: 1, hm: 50, draw(P) {
    roomShell(P, 3, 3, { wh: 44, acc: C.orange,
      rug: P => { P.disc(1.0, 2.1, 2, 46, C.blue); P.disc(1.0, 2.1, 2.2, 38, { t: '#5aaef6' }); },
      decor(P) {
        const cs = BALLS;
        for (let i = 0; i < 6; i++) P.fcirc('L', 0.45 + i * 0.42, 0.09, 19 + (i % 3) * 4.5, 3.4, cs[i % 6].l);
        winL(P, 2.1, 2.9, 0.09, 17, 38);
        for (let i = 0; i < 4; i++) P.fcirc('R', 0.09, 0.7 + i * 0.5, 22 + (i % 2) * 6, 3.4, cs[(i + 3) % 6].l);
      },
      furnish(P) {
        // ball pit
        P.box(1.7, 0.25, 2.85, 1.45, 2, 3, C.teal, { edge: false });
        P.box(1.7, 0.25, 2.85, 0.4, 3, 12, C.blue); P.box(1.7, 0.4, 1.85, 1.45, 3, 12, C.blue);
        const bs = [];
        for (let j = 0; j < 6; j++) for (let i = 0; i < 6; i++) { const u = 1.95 + i * 0.16 + ((j & 1) ? 0.08 : 0), v = 0.52 + j * 0.15; if (u < 2.75) bs.push([u, v, BALLS[Math.floor(hash(i, j, 9) * 7)], 7 + hash(i, j, 3) * 2]); }
        bs.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
        for (const [u, v, c, z] of bs) P.ball(u, v, z, 3.9, c);
        P.box(1.85, 1.3, 2.85, 1.45, 3, 12, C.blue); P.box(2.7, 0.4, 2.85, 1.3, 3, 12, C.blue);
        // balance beam
        for (const u of [0.35, 0.95, 1.55]) P.box(u, 1.0, u + 0.14, 1.14, 0, 5, C.blue, { edge: false });
        P.box(0.3, 0.97, 1.74, 1.17, 5, 8, C.wood);
        P.top(0.34, 1.0, 1.7, 1.14, 8, '#e2c49a');
        // bean bags + soft mat + swing ball
        P.ball(0.6, 2.4, 5, 8, C.purple, 6); P.ball(1.35, 2.7, 5, 8, C.orange, 6);
        P.box(0.2, 1.6, 0.9, 2.0, 2, 4, C.yellow);
        P.ball(2.4, 2.4, 9, 10, C.teal, 9); P.ball(2.4, 2.4, 9, 10, { t: '#5ac8dc', l: '#2a9ec0', r: '#1e7ea2', h: '#a8ecf0', s: '#145a72' }, 9);
      } });
  } },
  // ---- fall-backs for the five items the atlas normally supplies (only used when the atlas is missing / failed to load) ----
  bed: { hm: 26, draw(P) {
    treatBed(P, 0.1, 0.12, 0.9, 1.9);
    P.box(0.08, 1.84, 0.92, 1.9, 5, 14, C.white);                              // footboard
  } },
  traction: { hm: 54, draw(P) {
    treatBed(P, 0.1, 0.5, 0.9, 1.9);
    P.box(0.12, 0.1, 0.88, 0.4, 0, 30, C.white);
    P.box(0.16, 0.12, 0.84, 0.3, 30, 52, C.navy);
    P.screen('L', 0.22, 0.78, 0.3, 32, 50, 'ecg');
    P.ln(0.3, 0.4, 28, 0.3, 0.7, 14, '#e23a3a', 2);
  } },
  tens: { hm: 46, draw(P) {
    for (const [u, v] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) P.ball(u, v, 1.5, 1.6, C.dark);
    P.box(0.22, 0.24, 0.78, 0.76, 3, 24, C.white);
    P.box(0.2, 0.2, 0.8, 0.5, 24, 40, C.navy);
    P.screen('L', 0.24, 0.76, 0.5, 25.4, 38.6, 'ecg');
    P.fL(0.28, 0.72, 0.76, 7, 11, C.blue.l);
    P.ln(0.7, 0.76, 16, 0.9, 0.9, 6, '#e23a3a'); P.ln(0.3, 0.76, 16, 0.12, 0.9, 6, '#1e66ea');
  } },
  soft_mat: { hm: 8, draw(P, w) {
    P.box(0.05, 0.05, w - 0.05, 0.95, 0, 3, C.purple);
    P.top(0.12, 0.12, w - 0.12, 0.88, 3, '#9a7fc6');
    P.ln(0.12, 0.5, 3, w - 0.12, 0.5, 3, '#7a6ab6');
    P.ln(w / 2, 0.12, 3, w / 2, 0.88, 3, '#7a6ab6');
  } },
  shockwave: { hm: 50, draw(P) {
    for (const [u, v] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) P.ball(u, v, 1.5, 1.6, C.dark);
    P.box(0.24, 0.26, 0.76, 0.76, 3, 26, C.navy);
    P.fL(0.3, 0.7, 0.76, 7, 14, C.steel.l);
    P.box(0.22, 0.22, 0.78, 0.5, 26, 44, C.navy);
    P.screen('L', 0.26, 0.74, 0.5, 27.4, 42.6, 'wave');
    P.ln(0.78, 0.7, 20, 0.92, 0.9, 10, '#14111b'); P.box(0.86, 0.84, 0.96, 0.96, 4, 12, C.orange);
  } },
};

// ───────────────────────── master canvas + lod cache ─────────────────────────
const _masters = new Map();
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function outline(g, W, H) {
  const img = g.getImageData(0, 0, W, H), d = img.data, src = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) { if (d[i * 4 + 3] >= 128) src[i] = 1; else d[i * 4 + 3] = d[i * 4 + 3] >= 60 ? d[i * 4 + 3] : d[i * 4 + 3]; }
  const oc = [20, 17, 27];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (src[i]) continue;
    if ((x > 0 && src[i - 1]) || (x < W - 1 && src[i + 1]) || (y > 0 && src[i - W]) || (y < H - 1 && src[i + W])) {
      const k = i * 4; d[k] = oc[0]; d[k + 1] = oc[1]; d[k + 2] = oc[2]; d[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

function buildMaster(defId, rot) {
  const def = BUILDABLES[defId], dr = DRAW[defId];
  if (!def || !dr) return null;
  const w = def.w, h = def.h, fw = rot ? h : w, fh = rot ? w : h;
  const AX = fh * 64 + PAD, AY = dr.hm * K + PAD;
  const W = (fw + fh) * 64 + PAD * 2, H = AY + (fw + fh) * 32 + PAD;
  const c = mk(W, H), g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  const P = makePen(g, AX, AY, rot);
  // soft ground shadow (drawn first; alpha stays below the outline threshold)
  const cx = AX + (fw - fh) * 32, cy = AY + (fw + fh) * 16;
  if (!dr.ns) {
    const sr = (fw + fh) * 26 * (dr.sh || 0.8);
    fillEll(g, cx, cy + 2, sr, sr / 2, 'rgba(20,17,27,0.09)');
    fillEll(g, cx, cy + 2, sr * 0.78, sr * 0.39, 'rgba(20,17,27,0.09)');
  }
  dr.draw(P, w, h, rot);
  outline(g, W, H);
  c.art = 1; c.cobj = 1; c.dw = W / K; c.dh = H / K; c.ax = AX / K; c.ay = AY / K;
  attachLod(c);
  return c;
}

function resize(src, tw, th) {
  if (src.width === tw && src.height === th) return src;
  let cur = src;
  while (cur.width > tw * 2 || cur.height > th * 2) {
    const nw = Math.max(tw, Math.ceil(cur.width / 2)), nh = Math.max(th, Math.ceil(cur.height / 2));
    const c = mk(nw, nh), g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(cur, 0, 0, nw, nh); cur = c;
  }
  const out = mk(tw, th), g = out.getContext('2d');
  // whole-number upscales stay pixel-crisp; everything else is smoothed
  const ix = tw / cur.width, iy = th / cur.height;
  g.imageSmoothingEnabled = !(ix >= 1 && Math.abs(ix - Math.round(ix)) < 0.01 && Math.abs(iy - Math.round(iy)) < 0.01);
  g.imageSmoothingQuality = 'high';
  g.drawImage(cur, 0, 0, tw, th);
  return out;
}

let nLod = 0;
const _lods = [];
function attachLod(m) {
  const levels = new Map();
  _lods.push(levels);
  m.lod = (S, lvl, exact) => {
    let e = levels.get(lvl);
    if (e) return e;
    const Sq = exact ? S : Math.pow(2, Math.round(Math.log2(S) * 4) / 4);
    const tw = Math.max(2, Math.round(m.dw * Sq)), th = Math.max(2, Math.round(m.dh * Sq));
    e = resize(m, tw, th);
    if (e === m) { e = mk(tw, th); e.getContext('2d').drawImage(m, 0, 0); }
    e.ex = !!exact;
    if (++nLod > 500) { for (const l of _lods) l.clear(); nLod = 1; }
    levels.set(lvl, e);
    return e;
  };
}

export function hasConceptObject(defId) { return !!DRAW[defId]; }
export function conceptObjectSprite(defId, rot) {
  const key = defId + (rot ? ':1' : ':0');
  let s = _masters.get(key);
  if (s === undefined) { s = buildMaster(defId, rot ? 1 : 0); _masters.set(key, s); }
  return s;
}

// A ready-to-use canvas (<= maxW x maxH CSS px, x dpr) for DOM thumbnails (build panel / selection card).
export function conceptThumb(defId, maxW = 52, maxH = 44, dpr = 1) {
  const m = conceptObjectSprite(defId, 0);
  if (!m) return null;
  const k = Math.min(maxW / m.dw, maxH / m.dh);
  return resize(m, Math.max(2, Math.round(m.dw * k * dpr)), Math.max(2, Math.round(m.dh * k * dpr)));
}

// ───────────────────────── painted floors (64x32, 1px detail; the renderer draws them 1:1 with nearest-neighbour) ─────────────────────────
function tile64(fn) {
  const c = mk(64, 32), g = c.getContext('2d', { willReadFrequently: true });
  for (let y = 0; y < 32; y++) {
    const half = y < 16 ? 2 * y + 1 : 2 * (31 - y) + 1;
    for (let x = 32 - half; x < 32 + half; x++) {
      const dx = x + 0.5 - 32, dy = y + 0.5 - 16;
      const u = (dx / 32 + dy / 16) / 2 + 0.5, v = (dy / 16 - dx / 32) / 2 + 0.5;   // u along +x (down-right), v along +y (down-left)
      const col = fn(x, y, u, v);
      if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
    }
  }
  c.ax = 32; c.ay = 0;
  return c;
}
const FLOORS = {
  // blue anti-slip mat: ribbed rows along the tile, bevelled edge (lit top-left, shaded bottom-right), a few grip dots
  floor_mat: () => tile64((x, y, u, v) => {
    if (u < 0.035 || v < 0.035) return '#9cc8f8';
    if (u > 0.965 || v > 0.965) return '#125ade';
    if (u < 0.08 || v < 0.08) return '#5aaef6';
    if (u > 0.92 || v > 0.92) return '#1e66ea';
    const rib = Math.floor(v * 7);
    const f = v * 7 - rib;
    if (f < 0.16) return '#5aaef6';                                  // lit rib crest
    if (f > 0.84) return '#1e66ea';                                  // rib shadow
    return ((Math.floor(u * 11) + rib) & 1) && f > 0.4 && f < 0.6 ? '#9cc8f8' : '#2a7ef6';
  }),
  // warm planks along the tile (5 per tile), staggered joints, soft grain
  floor_wood: () => tile64((x, y, u, v) => {
    if (u < 0.03 || v < 0.03) return '#f0dcb4';
    if (u > 0.97 || v > 0.97) return '#7a5a3c';
    const pv = v * 4, plank = Math.floor(pv), f = pv - plank;
    if (f < 0.09) return '#8a6644';                                  // seam
    const jp = (u + plank * 0.31) % 0.62;
    if (jp < 0.02) return '#8a6644';                                 // staggered butt joints
    if (f < 0.2) return '#e2c49a';                                   // lit upper edge
    const tone = (plank + Math.floor((u + plank * 0.31) / 0.62)) % 3;
    const base = tone === 0 ? '#c8a27a' : tone === 1 ? '#bf9568' : '#d2ad84';
    const r = hash(Math.floor(u * 30) * 2 + plank * 5, plank + Math.floor((u + plank * 0.31) / 0.62), 5);
    if (r < 0.035) return '#a97f55';                                 // a few grain flecks
    return base;
  }),
  // accessible ramp: shaded incline bands, wheelchair pictogram, yellow/black safety stripe on the low edge
  ramp: () => tile64((x, y, u, v) => {
    if (u < 0.03 || v < 0.03) return '#f6f6f6';
    if (u > 0.97 || v > 0.97) return '#5a667e';
    if (v > 0.8) { if (v > 0.93) return '#14111b'; return (Math.floor((x + 2 * y) / 3) & 1) ? '#f6c64e' : '#14111b'; }
    const band = Math.min(2, Math.floor(u * 3)), edge = (u * 3) % 1;
    if (band > 0 && edge < 0.06) return '#8e9ab0';
    const ix = x - 32, iy = y - 14;
    if (WHEEL.has(ix + ',' + iy)) return '#ffffff';
    if (Math.hypot(ix / 6.5, (iy + 0.5) / 5.8) < 1) return '#2a7ef6';
    return ['#d2d8e2', '#bcc4d2', '#a6b0c2'][band];
  }),
};
const WHEEL = new Set();
(() => {
  // 9x9 wheelchair pictogram centred on (0,0): head, back/seat, leg, wheel arc
  const rows = [
    '...##....',
    '...##....',
    '...#.....',
    '...####..',
    '...#.....',
    '#..#####.',
    '#.....#..',
    '.#....#.#',
    '..####..#',
  ];
  rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch === '#') WHEEL.add((i - 4) + ',' + (j - 4)); }));
})();
const _floorCache = new Map();
export function hasConceptFloor(id) { return !!FLOORS[id]; }
export function conceptFloorSprite(id) {
  let s = _floorCache.get(id);
  if (!s) { s = FLOORS[id] ? FLOORS[id]() : null; if (s) _floorCache.set(id, s); }
  return s;
}
