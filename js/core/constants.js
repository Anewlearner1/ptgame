// Global constants shared by every module. Do not duplicate these numbers elsewhere.

export const MAP_W = 32;            // total grid size (lot sits inside it, rest is street)
export const MAP_H = 32;

export const OPEN_MIN = 8 * 60;     // restaurant opens 08:00 (minutes since midnight)
export const CLOSE_MIN = 20 * 60;   // closes 20:00
export const DAY_GAME_MIN = CLOSE_MIN - OPEN_MIN;   // 720 game minutes per "week"
export const WEEK_REAL_SEC = 45;    // one in-game WEEK == one operating day, 45 real sec at speed x1
export const MIN_PER_REAL_SEC = DAY_GAME_MIN / WEEK_REAL_SEC;   // 16 game-min per real sec at x1
export const WEEKS_PER_MONTH = 4;
export const MONTHS_PER_YEAR = 12;
export const SPEEDS = [0, 1, 2, 3]; // 0 = paused

// Walking: 3 tiles / real sec at x1  ->  tiles per game minute
export const WALK_TILES_PER_MIN = 3 / MIN_PER_REAL_SEC;

export const TILE_W = 64;           // iso diamond width (px, at zoom 1)
export const TILE_H = 32;           // iso diamond height

export const START_MONEY = 1200000;
export const SAVE_KEY_PREFIX = 'restgame.save.';
export const SAVE_VERSION = 1;

export const POINT_KEYS = ['culinary', 'device', 'service'];
export const POINT_LABELS = { culinary: '廚藝', device: '設備', service: '服務' };
export const ROLES = ['chef', 'cook', 'barista', 'server', 'cashier'];
export const ROLE_LABELS = { chef: '主廚', cook: '廚師', barista: '吧台師', server: '外場服務生', cashier: '櫃檯收銀' };
