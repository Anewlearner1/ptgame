// Generates the pixel-art PWA icons (pure Node + zlib, no canvas). Run: node tools/genicons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

const G = 32;                                   // logical pixel grid
const INK = [58, 28, 20], RED = [214, 74, 52], RED2 = [186, 56, 40], RED3 = [122, 36, 28];
const CREAM = [253, 246, 227], WOOD = [200, 162, 122], GOLD = [244, 190, 80], ACC = [231, 111, 81];

// a steaming noodle bowl: half-ellipse body, rim, a red band, a wooden base and three wisps of steam
const inBody = (x, y) => y >= 15 && y <= 24 && ((x - 15.5) / 9.6) ** 2 + ((y - 15) / 9.6) ** 2 <= 1;
const inRim = (x, y) => y >= 14 && y <= 15 && x >= 5 && x <= 26;
const inBase = (x, y) => y >= 25 && y <= 26 && x >= 11 && x <= 20;
const inSteam = (x, y) => y >= 5 && y <= 11 && [10, 15, 20].some(c => x === c + (((y + c) >> 1) & 1));
const inShape = (x, y) => inBody(x, y) || inRim(x, y) || inBase(x, y);
const roundedOut = (x, y) => { // notched corners (pixel-art "rounded" square) for the non-maskable icon
  const c = 3, ex = Math.min(x, G - 1 - x), ey = Math.min(y, G - 1 - y);
  return ex + ey < c;
};

// colour at logical pixel; mode 'any' = bordered rounded square on transparent, 'full' = full bleed (maskable / apple)
function colorAt(x, y, mode) {
  if (mode === 'any' && roundedOut(x, y)) return null;
  if (mode === 'any' && (x === 0 || y === 0 || x === G - 1 || y === G - 1 || roundedOut(x - 1, y) || roundedOut(x + 1, y) || roundedOut(x, y - 1) || roundedOut(x, y + 1))) return INK;
  if (inRim(x, y)) return y === 14 ? [255, 255, 255] : CREAM;
  if (inBody(x, y)) return y === 19 || y === 20 ? RED : (x - 15.5) > 5 ? [232, 220, 196] : CREAM;
  if (inBase(x, y)) return WOOD;
  if (inSteam(x, y)) return [255, 255, 255];
  const near = (dx, dy) => inShape(x + dx, y + dy) || inSteam(x + dx, y + dy);
  if (near(1, 0) || near(-1, 0) || near(0, 1) || near(0, -1)) return INK;
  if ((x === 5 && y === 5) || (x === 26 && y === 6)) return GOLD;
  if (y >= 27 && y <= 28 && x >= 8 && x <= 24) return RED3;
  if (mode === 'any' && (x === 1 || y === 1 || x === G - 2 || y === G - 2)) return RED3;
  return y < 16 ? RED : RED2;
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
