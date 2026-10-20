// Isometric projection helpers (S-C). World space = px at zoom 1; screen = world * zoom + cam offset.
// Tile (gx,gy): its TOP corner sits at gridToScreen(gx,gy); the diamond spans TILE_W x TILE_H below that.
import { TILE_W, TILE_H } from '../core/constants.js';
import { sizeOf } from '../core/grid.js';

export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;

export function gridToScreen(gx, gy) {
  return { x: (gx - gy) * HALF_W, y: (gx + gy) * HALF_H };
}
// allocation-free variants for hot loops
export function isoX(gx, gy) { return (gx - gy) * HALF_W; }
export function isoY(gx, gy) { return (gx + gy) * HALF_H; }

// sx, sy = CSS px relative to the canvas. cam = {x, y, zoom} (x,y = screen offset of world origin).
export function screenToGrid(sx, sy, cam) {
  const z = cam.zoom || 1;
  const wx = (sx - cam.x) / z;
  const wy = (sy - cam.y) / z;
  return { x: wy / TILE_H + wx / TILE_W, y: wy / TILE_H - wx / TILE_W };
}

export function tileAt(sx, sy, cam) {
  const g = screenToGrid(sx, sy, cam);
  return { x: Math.floor(g.x), y: Math.floor(g.y) };
}

// Placement origin (top-left footprint tile) so that the cursor tile sits near the footprint centre.
export function placementOrigin(def, rot, tx, ty) {
  if (!def) return { x: tx, y: ty };
  const { w, h } = sizeOf(def, rot || 0);
  return { x: tx - Math.floor((w - 1) / 2), y: ty - Math.floor((h - 1) / 2) };
}
