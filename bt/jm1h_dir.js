/* 方向分列版：跃迁反转 C 组按 做多/做空 拆开，看净期望与胜率 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DIR = '/home/ubuntu/oqt-quant-node/data/okx/kline/1h';
const TH = 200, FEE = 10;
const STABLE = new Set(['USDC', 'USDT', 'DAI', 'FDUSD', 'TUSD', 'BUSD', 'USDE', 'USDG',
  'PYUSD', 'EURC', 'USDP', 'USDD', 'FRAX', 'LUSD', 'GUSD', 'SUSD', 'USDB', 'CRVUSD',
  'RLUSD', 'XUSD', 'USDX', 'EURT', 'AEUR', 'EURR', 'USDS']);

function loadBars(inst) {
  const dir = path.join(DIR, inst);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => /^\d{6}\.sqlite$/.test(f)).sort();
  const map = new Map();
  for (const f of files) {
    try {
      const db = new DatabaseSync(path.join(dir, f), { readOnly: true });
      for (const r of db.prepare('SELECT ts,o,c FROM kline WHERE o>0 AND c>0 ORDER BY ts').all()) {
        map.set(+r.ts, { t: +r.ts, o: +r.o, c: +r.c });
      }
      db.close();
    } catch (e) { }
  }
  return Array.from(map.values()).sort((a, b) => a.t - b.t);
}

const MAXH = 12;
const insts = fs.readdirSync(DIR).filter(d => !d.startsWith('.') && !STABLE.has(d.split('-')[0]));
console.log('合约数:', insts.length);

// revLong / revShort 各自 {n,sum,ss,win}
const res = {};
for (let h = 1; h <= MAXH; h++) {
  res[h] = { L: { n: 0, sum: 0, ss: 0, win: 0 }, S: { n: 0, sum: 0, ss: 0, win: 0 } };
}

for (const inst of insts) {
  const bars = loadBars(inst);
  if (!bars || bars.length < 80) continue;
  for (let i = 2; i < bars.length - 1; i++) {
    const p0 = bars[i - 2], p1 = bars[i - 1], p2 = bars[i];
    const chgA = (p1.c - p0.c) / p0.c * 10000;
    const chgB = (p2.c - p1.c) / p1.c * 10000;
    let revDir = 0;
    if (chgA <= -TH && chgB >= TH) revDir = 1;       // 急跌后急涨 → 做多
    else if (chgA >= TH && chgB <= -TH) revDir = -1;  // 急涨后急跌 → 做空
    if (!revDir) continue;
    const entry = bars[i + 1].o;
    for (let H = 1; H <= MAXH; H++) {
      const exit = bars[i + 1 + H] && bars[i + 1 + H].o;
      if (!(exit > 0)) continue;
      const g = (exit - entry) / entry * 10000;
      const v = g * revDir - FEE;
      const b = revDir === 1 ? res[H].L : res[H].S;
      b.n++; b.sum += v; b.ss += v * v; if (v > 0) b.win++;
    }
  }
}

const avg = b => b.n ? b.sum / b.n : 0;
const sd = b => { if (b.n < 2) return 0; const m = b.sum / b.n; return Math.sqrt(Math.max(0, b.ss / b.n - m * m) * b.n / (b.n - 1)); };
const wr = b => b.n ? b.win / b.n * 100 : 0;

console.log('\n=== 跃迁反转 C 组 方向分列（TH=200bp，1h K线，净期望bp/笔，含10bp成本）===');
console.log('间隔   做多(n,净bp,胜率)       做空(n,净bp,胜率)       合并(n,净bp,胜率)');
for (let H = 1; H <= MAXH; H++) {
  const L = res[H].L, S = res[H].S;
  const Cn = L.n + S.n, Csum = L.sum + S.sum, Cwin = L.win + S.win;
  const C = { n: Cn, sum: Csum, win: Cwin };
  const f = b => `(${(b.n/1000).toFixed(1)}k, ${avg(b).toFixed(2)}, ${wr(b).toFixed(1)}%)`.padEnd(24);
  console.log((H + 'h').padEnd(7) + f(L) + f(S) + `(${(C.n/1000).toFixed(1)}k, ${avg(C).toFixed(2)}, ${wr(C).toFixed(1)}%)`);
}
