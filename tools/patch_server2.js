const fs = require('fs');
const p = '/home/ubuntu/oqt-quant-node/server.js';
let s = fs.readFileSync(p, 'utf8');

// 1) remove '1m' from the slow SEQ (1m now handled by dedicated direct-pull loop)
const seqOld = "const SEQ = ['1m', '3m', '5m', ";
if (!s.includes(seqOld)) { console.error('SEQ anchor NOT FOUND'); process.exit(2); }
s = s.replace(seqOld, "const SEQ = ['3m', '5m', ");

// 2) replace the dedicated loop body with a direct-pull version (bypass ALL_KEEP_GAP)
const loopOld = `  (function oneMinuteKlineLoop() {
    const tick = () => {
      setTimeout(async () => {
        try { await keepGrain('1m', '1m保鲜·快'); } catch (e) {}
        tick();
      }, 75000);
    };
    setTimeout(tick, 30000);
  })();`;
if (!s.includes(loopOld)) { console.error('LOOP anchor NOT FOUND'); process.exit(3); }
const loopNew = `  /* ★2026-11-01 1分钟K线独立直拉: 绕过 keepAllMarket 的 ALL_KEEP_GAP(2.5min) 节流 —— 该节流为慢周期设,
   * 但 1m 需每分钟刷新, 被节流后整轮才轮到一次 → 1m K线滞后 76min(用户报分钟数都不对/都不动)。
   * 这里直接 KL.pull 逐合约拉最新 1m(仍走 GATE 全局限流, 不挤兑实时), 每 ~60s 一轮。 */
  (function oneMinuteKlineLoop() {
    let n = 0;
    const tick = async () => {
      try {
        const KL = require('./modules/okx/engines/kline');
        const U = require('./modules/okx/engines/universe');
        const u = await U.universe();
        const list = (u.list || []).filter(x => x.instId && x.instId.endsWith('SWAP'));
        for (const x of list) { try { await KL.pull(x.instId, '1m', 1); } catch (e) {} }
        if ((++n) % 5 === 0) console.log('[1m保鲜·直拉] 拉取 ' + list.length + ' 合约 1m (round ' + n + ')');
      } catch (e) {}
      setTimeout(tick, 60000);
    };
    setTimeout(tick, 30000);
  })();`;
s = s.replace(loopOld, loopNew);

fs.writeFileSync(p + '.bak2_' + Date.now(), s);
fs.writeFileSync(p, s);
console.log('PATCH2 OK; new length', s.length);
