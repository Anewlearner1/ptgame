// Tiny synchronous event bus. Events are documented in docs/ARCHITECTURE.md §6.
const handlers = new Map();

export const bus = {
  on(evt, fn) {
    if (!handlers.has(evt)) handlers.set(evt, new Set());
    handlers.get(evt).add(fn);
    return () => handlers.get(evt).delete(fn);
  },
  emit(evt, payload) {
    const set = handlers.get(evt);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (e) { console.error('[bus]', evt, e); }
    }
  },
  clear() { handlers.clear(); },
};
