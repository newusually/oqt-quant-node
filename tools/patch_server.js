const fs = require('fs');
const p = '/home/ubuntu/oqt-quant-node/server.js';
const s0 = fs.readFileSync(p, 'utf8');
const anchor = "  })();\n\n  /* ★2026-10-25 关系核实引擎后台预热";
if (!s0.includes(anchor)) { console.error('ANCHOR NOT FOUND'); process.exit(2); }
const inject = `  })();

  /* ★2026-11-01 1分钟K线独立快刷: 原 SEQ 仅 1 个 '1m', 整轮 ~76min 才轮到 → 1m K线/涨跌家数滞后达 76min
   * (用户报"分钟数都不对/都不动")。改为独立 ~75s 循环, 与 SEQ 串行链互不干扰(allKeepRunning 防重入)。 */
  (function oneMinuteKlineLoop() {
    const tick = () => {
      setTimeout(async () => {
        try { await keepGrain('1m', '1m保鲜·快'); } catch (e) {}
        tick();
      }, 75000);
    };
    setTimeout(tick, 30000);
  })();

  /* ★2026-11-01 1分钟涨跌家数实时续写: 历史由 backfill_breadth_1m.js 回填, 之后无续写逻辑,
   * 导致 1分钟标签页 涨跌家数/MACD/列表/广播 停在回填时刻。breadth1m.start() 从 kstore 已有 1m K线
   * 增量续写并补历史洞(无需再打 OKX, 不挤兑实时限流)。 */
  try { require('./modules/okx/engines/breadth1m').start(); } catch (e) { console.log('[breadth1m] 启动失败: ' + e.message); }

  /* ★2026-10-25 关系核实引擎后台预热`;
const s1 = s0.replace(anchor, inject);
fs.writeFileSync(p + '.bak_' + Date.now(), s0);
fs.writeFileSync(p, s1);
console.log('PATCHED OK; new length', s1.length, 'old', s0.length);
