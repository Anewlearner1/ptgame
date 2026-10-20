// Game clock + calendar. One in-game week == one operating day (OPEN_MIN..CLOSE_MIN).
// advanceClock is called by main.js every sub-step; it emits the rollover events of ARCHITECTURE §6.
import { bus } from '../core/bus.js';
import { OPEN_MIN, CLOSE_MIN, WEEKS_PER_MONTH, MONTHS_PER_YEAR } from '../core/constants.js';

const MAX_ROLLS_PER_CALL = 8;   // safety net if someone passes a huge dtMin

export function advanceClock(state, dtMin) {
  const t = state.time;
  if (!(dtMin > 0)) return;
  if (state.events && state.events.pendingDilemma) return;   // a decision modal freezes the clock
  t.clock += dtMin;
  let guard = 0;
  while (t.clock >= CLOSE_MIN && guard++ < MAX_ROLLS_PER_CALL) {
    const carry = t.clock - CLOSE_MIN;
    rollWeek(state);
    // carry-over minutes (only non-zero for giant steps) restart the new day
    t.clock = OPEN_MIN + (carry > 0 && carry < CLOSE_MIN - OPEN_MIN ? carry : 0);
    // a modal decision (random event) pauses the game: stop consuming minutes
    if (state.events && state.events.pendingDilemma) { t.clock = OPEN_MIN; break; }
  }
  if (t.clock > CLOSE_MIN) t.clock = CLOSE_MIN - 0.001;
}

function rollWeek(state) {
  const t = state.time;
  bus.emit('week:end', { year: t.year, month: t.month, week: t.week });
  let monthEnded = false, yearEnded = false;
  if (t.week >= WEEKS_PER_MONTH) {
    monthEnded = true;
    bus.emit('month:end', { year: t.year, month: t.month });
    if (t.month >= MONTHS_PER_YEAR) {
      yearEnded = true;
      bus.emit('year:end', { year: t.year });
    }
  }
  // advance the date itself
  if (monthEnded) {
    t.week = 1;
    if (yearEnded) { t.month = 1; t.year += 1; } else t.month += 1;
  } else {
    t.week += 1;
  }
  t.clock = OPEN_MIN;
  if (yearEnded) bus.emit('year:start', { year: t.year });
  if (monthEnded) bus.emit('month:start', { year: t.year, month: t.month });
  bus.emit('week:start', { year: t.year, month: t.month, week: t.week });
}

export function formatDate(state) {
  const t = state.time;
  return `第${t.year}年 ${t.month}月 第${t.week}週`;
}

export function formatClock(state) {
  return formatMinutes(state.time.clock);
}

export function formatMinutes(min) {
  const m = Math.floor(min);
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

// Weeks elapsed since game start (0-based). Handy for cooldowns.
export function absoluteWeek(state) {
  const t = state.time;
  return ((t.year - 1) * MONTHS_PER_YEAR + (t.month - 1)) * WEEKS_PER_MONTH + (t.week - 1);
}

export function isOpen(state) {
  return state.time.clock >= OPEN_MIN && state.time.clock < CLOSE_MIN;
}
