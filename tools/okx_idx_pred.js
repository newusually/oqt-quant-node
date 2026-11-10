/* OKX 合约内部: 大盘指数→山寨合约 传导概率实验
 * 指数: BTC / ETH / 等权全市场(287合约平均)
 * 个股: 全部山寨合约
 * 数据: 本地K线库 (chan.loadCandles), 5m/15m/1h/4h
 *
 * 输出:
 *  A 联动概率矩阵   P(stk同根涨 | idx同根涨x%)      — 传导强度(描述)
 *  B 领先预测矩阵   P(stk下一根涨 | idx本根涨x%)    — 可落地预测
 *  C beta滚动预测   pred=beta60(t-1)*idxRet(t-1) 方向准确率+IC
 *  D 残差动量       ex(t-1)=stk-idx → stk(t) IC+分桶
 *  E 未来5根        idx信号根 → stk fwd5 均值/胜率 (接bestsig口径)
 *  F 每合约跟涨排名 beta/跟涨P/跟跌P
 */
'use strict';
const CH = require('../modules/okx/engines/chan');
const fs = require('fs');
const path = require('path');

const GRAINS = [['5m', 90], ['15m', 180], ['1h', 365], ['4h', 365]];
const IDX = ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'];
const BUCKETS = [[-999, -1.5], [-1.5, -0.5], [-0.5, 0.5], [0.5, 1.5], [1.5, 999]];
const bucket = x => { for (let i = 0; i < 5; i++) if (x >= BUCKETS[i][0] && x < BUCKETS[i][1]) return i; return 2; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
function corr(x, y) {
  const n = x.length; if (n < 30) return 0;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
function spearman(x, y) {
  const n = Math.min(x.length, y.length); if (n < 200) return 0;
  const rk = a => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = new Array(a.length); idx.forEach((p, k) => r[p[1]] = k); return r; };
  return corr(rk(x.slice(0, n)), rk(y.slice(0, n)));
}
/* 在线增量 Pearson 相关 (零数组防OOM) */
function newAcc() { return { n: 0, sx: 0, sy: 0, sxy: 0, sx2: 0, sy2: 0 }; }
function accAdd(A, x, y) { A.n++; A.sx += x; A.sy += y; A.sxy += x * y; A.sx2 += x * x; A.sy2 += y * y; }
function accR(A) {
  if (A.n < 500) return 0;
  const d = Math.sqrt((A.n * A.sx2 - A.sx * A.sx) * (A.n * A.sy2 - A.sy * A.sy));
  return d > 1e-12 ? (A.n * A.sxy - A.sx * A.sy) / d : 0;
}

function grainAnalysis(grain, days) {
  const since = Date.now() - days * 86400000;
  /* 指数 */
  const idxBars = {};
  for (const s of IDX) {
    const b = CH.loadCandles(grain, since, s);
    idxBars[s] = b ? b.slice().sort((x, y) => x.ts - y.ts) : [];
  }
  const btc = idxBars['BTC-USDT-SWAP'];
  if (!btc || btc.length < 500) return null;
  /* 公共 ts 轴 = BTC 的 ts (OKX 全市场同 grain 网格一致) */
  const T = btc.length, step = T > 1 ? btc[1].ts - btc[0].ts : 0;
  const tsAxis = btc.map(b => b.ts);
  const idxTsSet = new Set(tsAxis);
  /* 指数收益 (对齐轴, i>=1) */
  const rBtc = new Float64Array(T).fill(NaN), rEth = new Float64Array(T).fill(NaN);
  for (let i = 1; i < T; i++) {
    rBtc[i] = (btc[i].c / btc[i - 1].c - 1) * 100;
  }
  const eth = idxBars['ETH-USDT-SWAP'];
  if (eth && eth.length > 500) {
    const m = new Map(eth.map(b => [b.ts, b]));
    for (let i = 1; i < T; i++) { const p = m.get(tsAxis[i] - step), c = m.get(tsAxis[i]); if (p && c) rEth[i] = (c.c / p.c - 1) * 100; }
  }
  /* 等权指数: 读全合约收益, 同步累计 */
  /* 扫 kline 目录取全部合约 */
  const fsx = require('fs');
  const dir = path.resolve(__dirname, '../data/okx/kline/' + grain);
  let insts = [];
  try { insts = fsx.readdirSync(dir).filter(d => fsx.statSync(path.join(dir, d)).isDirectory()); } catch (e) { }
  const instsN = insts.filter(s => s.endsWith('-USDT-SWAP'));
  const rEw = new Float64Array(T).fill(NaN);
  const stkRet = {};    // inst -> Float64Array(T) NaN填充
  let cnt = 0;
  for (const s of instsN) {
    const b = CH.loadCandles(grain, since, s);
    if (!b || b.length < Math.min(500, T * 0.5)) continue;
    const mp = new Map(b.map(x => [x.ts, x]));
    const arr = new Float64Array(T).fill(NaN);
    for (let i = 1; i < T; i++) {
      const c = mp.get(tsAxis[i]), p = mp.get(tsAxis[i - 1]);
      if (c && p) arr[i] = (c.c / p.c - 1) * 100;
    }
    stkRet[s] = arr; cnt++;
    /* 等权: 逐根累计 (只在有效样本上) */
    for (let i = 1; i < T; i++) if (!isNaN(arr[i])) { rEw[i] = isNaN(rEw[i]) ? arr[i] : rEw[i] + arr[i]; }
  }
  /* 等权取均值 */
  const ewCnt = new Float64Array(T);
  for (const s of Object.keys(stkRet)) for (let i = 1; i < T; i++) if (!isNaN(stkRet[s][i])) ewCnt[i]++;
  for (let i = 0; i < T; i++) if (ewCnt[i] > 20) rEw[i] /= ewCnt[i]; else rEw[i] = NaN;
  console.log(`  [${grain}] 轴${T}根 步长${step / 1000}s 合约${cnt}个`);

  const IDXSETS = [
    { key: 'BTC', r: rBtc },
    { key: 'ETH', r: rEth },
    { key: 'EW', r: rEw }
  ];
  const out = { grain, days, axis: T, insts: cnt, step: step / 1000 };
  for (const I of IDXSETS) {
    const agg = {
      same: BUCKETS.map(() => ({ n: 0, up: 0, sum: 0 })),   // A 联动
      lead: BUCKETS.map(() => ({ n: 0, up: 0, sum: 0 })),   // B 领先
      dirN: 0, dirHit: 0, icPred: newAcc(),                 // C
      icRes: newAcc(),                                      // D
      fwd5: { n: 0, win: 0, sum: 0, byB: BUCKETS.map(() => ({ n: 0, win: 0, sum: 0 })) },  // E (idx信号根→stk未来5根)
      fwd5Dn: { n: 0, win: 0, sum: 0 }
    };
    const per = {};   // inst -> {beta, folUp, folDn, dir}
    const instKeys = Object.keys(stkRet);
    /* 预计算每合约 beta60 滚动 (相对该指数) — 用滚动窗口相关×波动比 */
    for (const s of instKeys) {
      const a = stkRet[s];
      const win = 60;
      /* 逐根增量: 直接滑动窗口算太贵(T×inst×60); 采样: 每10根更新一次beta */
      const betaArr = new Float64Array(T).fill(1);
      for (let i = win; i < T; i += 10) {
        const xs = [], ys = [];
        for (let k = i - win; k < i; k++) { const x = I.r[k], y = a[k]; if (!isNaN(x) && !isNaN(y)) { xs.push(x); ys.push(y); } }
        if (xs.length < 30) { betaArr[i] = 1; continue; }
        const c = corr(xs, ys);
        const vx = Math.sqrt(mean(xs.map(v => v * v))), vy = Math.sqrt(mean(ys.map(v => v * v)));
        betaArr[i] = (c && vx > 1e-9) ? c * vy / vx : 1;
      }
      for (let i = win; i < T; i++) betaArr[i] = betaArr[i - ((i - win) % 10)];
      per[s] = { betaArr, dirN: 0, dirHit: 0, upN: 0, upHit: 0, dnN: 0, dnHit: 0 };
    }
    for (let i = 2; i < T - 5; i++) {
      const ir = I.r[i], ip = I.r[i - 1];
      if (isNaN(ir) || isNaN(ip)) continue;
      const bi = bucket(ir), biP = bucket(ip);
      for (const s of instKeys) {
        const a = stkRet[s], p = per[s];
        const r = a[i];                     // 个股同根
        const rn = a[i + 1];                // 个股下一根 (领先预测目标)
        if (!isNaN(r) && !isNaN(ip)) {
          /* A 联动: idx本根 vs stk同根 */
          agg.same[bi].n++; agg.same[bi].sum += r; if (r > 0) agg.same[bi].up++;
          /* F 每合约跟涨/跟跌 */
          if (ip > 0.5) { p.upN++; if (r > 0) p.upHit++; }
          if (ip < -0.5) { p.dnN++; if (r < 0) p.dnHit++; }
        }
        if (!isNaN(rn)) {
          /* B 领先: idx本根ip → stk下一根rn */
          agg.lead[biP].n++; agg.lead[biP].sum += rn; if (rn > 0) agg.lead[biP].up++;
          /* C beta预测 (beta用 i-10 更新的值, 无未来) */
          const b = p.betaArr[Math.max(0, i - 10)];
          const pred = b * ip;
          agg.dirN++; if ((pred > 0) === (rn > 0)) agg.dirHit++;
          accAdd(agg.icPred, pred, rn);
          /* D 残差动量: ex(i)=stk(i)-idx(i) → stk(i+1) */
          const ei = a[i] - ir;
          if (!isNaN(ei)) accAdd(agg.icRes, ei, rn);
          /* E fwd5: idx本根方向 → stk未来5根 */
          if (!isNaN(ir) && !isNaN(a[i])) {
            let f = 0, ok = true;
            for (let k = 1; k <= 5; k++) { const v = a[i + k]; if (isNaN(v)) { ok = false; break; } f += v; }
            if (ok) {
              if (ir > 0.5) { agg.fwd5.n++; agg.fwd5.sum += f; if (f > 0) agg.fwd5.win++; agg.fwd5.byB[bi].n++; agg.fwd5.byB[bi].sum += f; if (f > 0) agg.fwd5.byB[bi].win++; }
              if (ir < -0.5) { agg.fwd5Dn.n++; agg.fwd5Dn.sum += f; if (f > 0) agg.fwd5Dn.win++; }
            }
          }
        }
      }
    }
    /* 汇总 */
    out[I.key] = {
      same: agg.same.map(b => ({ n: b.n, pUp: +(100 * b.up / b.n).toFixed(2), avg: +(b.sum / b.n).toFixed(3) })),
      lead: agg.lead.map(b => ({ n: b.n, pUp: +(100 * b.up / b.n).toFixed(2), avg: +(b.sum / b.n).toFixed(3) })),
      dirAcc: agg.dirN ? +(100 * agg.dirHit / agg.dirN).toFixed(2) : 0,
      icPred: +accR(agg.icPred).toFixed(4),
      icRes: +accR(agg.icRes).toFixed(4),
      fwd5: { n: agg.fwd5.n, avg: +(agg.fwd5.sum / agg.fwd5.n).toFixed(3), win: +(100 * agg.fwd5.win / agg.fwd5.n).toFixed(2), byB: agg.fwd5.byB.map(b => ({ n: b.n, avg: +(b.sum / b.n).toFixed(3), win: +(100 * b.win / b.n).toFixed(2) })) },
      fwd5Dn: { n: agg.fwd5Dn.n, avg: +(agg.fwd5Dn.sum / agg.fwd5Dn.n).toFixed(3), win: +(100 * agg.fwd5Dn.win / agg.fwd5Dn.n).toFixed(2) },
      perStock: instKeys.map(s => {
        const p = per[s];
        const arr = p.betaArr; let bs = 0, bn = 0;
        for (let i = 60; i < T; i += 25) if (!isNaN(arr[i])) { bs += arr[i]; bn++; }
        return {
          inst: s.replace('-USDT-SWAP', ''),
          beta: bn ? +(bs / bn).toFixed(2) : 0,
          folUp: p.upN ? +(100 * p.upHit / p.upN).toFixed(1) : 0, upN: p.upN,
          folDn: p.dnN ? +(100 * p.dnHit / p.dnN).toFixed(1) : 0, dnN: p.dnN
        };
      }).sort((a, b) => (b.beta * Math.min(b.upN, 1)) - (a.beta * Math.min(a.upN, 1)))
    };
  }
  return out;
}

async function main() {
  const R = {};
  for (const [g, d] of GRAINS) {
    console.log('[grain]', g, d + '天');
    R[g] = grainAnalysis(g, d);
  }
  const out = path.resolve(__dirname, '../data/analysis/okx-idx-report.json');
  fs.writeFileSync(out, JSON.stringify(R, null, 1));
  console.log('[done] ->', out);
  for (const g of Object.keys(R)) {
    const x = R[g]; if (!x) continue;
    console.log(g, 'BTC lead方向', x.BTC.dirAcc + '%', 'IC', x.BTC.icPred, '| EW lead方向', x.EW.dirAcc + '%', '残差IC', x.EW.icRes, '| fwd5(BTC强根)', x.BTC.fwd5.avg + '%', 'win', x.BTC.fwd5.win + '%');
  }
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
