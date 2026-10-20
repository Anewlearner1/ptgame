// Headless smoke test. Boots the game, runs N game-minutes at x3, asserts no console errors/warnings/failed requests.
// Usage (server must be running: `python3 -m http.server 8201` in repo root):
//   node tools/smoke.mjs [--url http://localhost:8201/index.html] [--minutes 10] [--shot out.png] [--w 1280 --h 720 --dpr 1]
// "minutes" are REAL minutes at x3 speed (default 2). Exit code 1 on any error/warning/failed request/stuck agent.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const url = arg('url', 'http://localhost:8201/index.html');
const minutes = parseFloat(arg('minutes', '2'));
const shot = arg('shot', '');
const W = +arg('w', 1280), H = +arg('h', 720), DPR = +arg('dpr', 1);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }).catch(() => chromium.launch());
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
const p = await ctx.newPage();
const problems = [];
p.on('console', m => { if (['error', 'warning'].includes(m.type())) problems.push(m.type() + ': ' + m.text()); });
p.on('pageerror', e => problems.push('PAGEERR ' + e.message));
p.on('requestfailed', r => problems.push('REQFAIL ' + r.url()));
p.on('response', r => { if (r.status() >= 400) problems.push('HTTP ' + r.status() + ' ' + r.url()); });

await p.goto(url);
await p.waitForTimeout(1500);
await p.evaluate(() => { document.querySelector('#modal-root button')?.click(); window.__game.bus.emit('speed:set', { speed: 3 }); });

const t0 = Date.now();
let maxPat = 0, minFps = 1e9;
const stuck = new Map();   // agent id -> {x,y,since}
while (Date.now() - t0 < minutes * 60000) {
  await p.waitForTimeout(5000);
  const r = await p.evaluate(() => {
    const s = window.__game.state;
    // auto-dismiss pending modals so the sim keeps running
    document.querySelectorAll('#modal-root button').forEach((bt, i) => { if (i === 0) bt.click(); });
    return { t: s.time, money: s.money, pat: s.patients.length, rep: Math.round(s.reputation),
      agents: [...s.patients, ...s.staff].map(a => ({ id: a.id, x: a.x, y: a.y, st: a.stage || a.state })) };
  });
  maxPat = Math.max(maxPat, r.pat);
  const now = Date.now();
  for (const a of r.agents) {
    const prev = stuck.get(a.id);
    if (!prev || Math.abs(prev.x - a.x) + Math.abs(prev.y - a.y) > 0.05) stuck.set(a.id, { x: a.x, y: a.y, since: now, st: a.st });
  }
  const present = new Set(r.agents.map(a => a.id));
  for (const id of [...stuck.keys()]) if (!present.has(id)) stuck.delete(id);   // agent gone
  for (const [id, v] of stuck) if (now - v.since > 120000 && !['working', 'treating', 'registering', 'idle', 'resting', 'chatting'].includes(v.st)) problems.push(`STUCK agent ${id} ${v.st} >2min at ${v.x.toFixed(1)},${v.y.toFixed(1)}`);
  console.log(`Y${r.t.year} M${r.t.month} W${r.t.week} money=${r.money} patients=${r.pat} rep=${r.rep}`);
}
const fps = await p.evaluate(() => new Promise(res => { let n = 0; const t = performance.now(); const f = () => { n++; performance.now() - t < 2000 ? requestAnimationFrame(f) : res(n / 2); }; requestAnimationFrame(f); }));
console.log('fps≈', fps.toFixed(1), 'maxPatients', maxPat);
if (shot) await p.screenshot({ path: shot });
console.log(problems.length ? 'PROBLEMS:\n' + [...new Set(problems)].join('\n') : 'OK: no console problems');
await b.close();
process.exit(problems.length ? 1 : 0);
