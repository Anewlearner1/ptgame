// Generates the pixel-art PWA icons (pure Node + zlib, no canvas). Run: node tools/genicons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

const G = 32;                                   // logical pixel grid
const INK = [31, 45, 51], TEAL = [42, 157, 143], TEAL2 = [35, 138, 125], TEAL3 = [29, 92, 87];
const CREAM = [253, 246, 227], WOOD = [200, 162, 122], GOLD = [244, 162, 97], ACC = [231, 111, 81];

const inCross = (x, y) => (x >= 7 && x <= 24 && y >= 12 && y <= 19) || (x >= 12 && x <= 19 && y >= 7 && y <= 24);
const roundedOut = (x, y) => { // notched corners (pixel-art "rounded" square) for the non-maskable icon
  const c = 3, ex = Math.min(x, G - 1 - x), ey = Math.min(y, G - 1 - y);
  return ex + ey < c;
};

// colour at logical pixel; mode 'any' = bordered rounded square on transparent, 'full' = full bleed (maskable / apple)
function colorAt(x, y, mode) {
  if (mode === 'any' && roundedOut(x, y)) return null;
  if (mode === 'any' && (x === 0 || y === 0 || x === G - 1 || y === G - 1 || roundedOut(x - 1, y) || roundedOut(x + 1, y) || roundedOut(x, y - 1) || roundedOut(x, y + 1))) return INK;
  if (inCross(x, y)) return (!inCross(x, y + 1)) ? WOOD : (y === 12 || y === 7) && x > 7 ? [255, 255, 255] : CREAM;
  const near = (dx, dy) => inCross(x + dx, y + dy);
  if (near(1, 0) || near(-1, 0) || near(0, 1) || near(0, -1)) return INK;
  // tiny sparkle pixels + ground shadow
  if ((x === 5 && y === 5) || (x === 26 && y === 6)) return [255, 255, 255];
  if ((x === 4 && y === 6) || (x === 6 && y === 6) || (x === 5 && y === 4) || (x === 5 && y === 6)) return [200, 235, 228];
  if (y >= 26 && y <= 27 && x >= 8 && x <= 24) return TEAL3;
  if (mode === 'any' && (x === 1 || y === 1 || x === G - 2 || y === G - 2)) return TEAL3;
  return y < 16 ? TEAL : y < 26 ? TEAL2 : TEAL2;
}

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, mode) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const c = colorAt(Math.floor(x * G / size), Math.floor(y * G / size), mode);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      if (c) { raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255; }
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
function svg(mode) {
  const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  let rects = '';
  for (let y = 0; y < G; y++) {
    let x = 0;
    while (x < G) {
      const c = colorAt(x, y, mode); let e = x + 1;
      while (e < G && JSON.stringify(colorAt(e, y, mode)) === JSON.stringify(c)) e++;
      if (c) rects += `<rect x="${x}" y="${y}" width="${e - x}" height="1" fill="${hex(c)}"/>`;
      x = e;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${G} ${G}" shape-rendering="crispEdges">${rects}</svg>\n`;
}

writeFileSync(join(OUT, 'icon-192.png'), png(192, 'any'));
writeFileSync(join(OUT, 'icon-512.png'), png(512, 'any'));
writeFileSync(join(OUT, 'icon-maskable-512.png'), png(512, 'full'));
writeFileSync(join(OUT, 'apple-touch-icon.png'), png(180, 'full'));
writeFileSync(join(OUT, 'icon.svg'), svg('any'));
console.log('icons written to', OUT);
