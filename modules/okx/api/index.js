// M7 modules/okx/api · OKX 子项目 JSON 接口（被顶层 api/okx 分发）
//   端点: instruments(合约列表) / kline(真实K线+指标) / pull(实时获取·补充数据)
//        account / pnl / trades / status
'use strict';
const eng = require('../engines');
const realtime = require('../engines/realtime');

async function handle(ep, q) {
  switch (ep) {
    case 'instruments': return await eng.instruments(q.force === '1' || q.force === 'true');
    // ★实时行情（公共接口, 无需凭证）
    case 'tickers': return await realtime.tickers(q.force === '1' || q.force === 'true');
    case 'book':    return await realtime.book(q.inst || eng.cfg.inst, parseInt(q.sz || 12, 10));
    case 'positions': return await realtime.positions();
    case 'kline':       return await eng.kline(q.inst || eng.cfg.inst, q.tf || eng.cfg.defaultTf, q.limit || 1500, q.before || 0);
    case 'pull': {
      const r = await eng.pull(q.inst || eng.cfg.inst, q.tf || eng.cfg.defaultTf, q.pages || 3);
      return r;
    }
    // ★历史回补(分页往前翻)
    //   首屏: days=3 (只回填最近3天, 打开页面很快)
    //   移动K线到左边界: limit=1000 (往前翻到本地共1000根为止)
    //   手动一键: days=30
    case 'backfill': return await eng.backfill(q.inst || eng.cfg.inst, q.tf || eng.cfg.defaultTf, {
      days: q.days, limit: q.limit, rounds: q.rounds
    });
    case 'account': return await eng.account();
    case 'pnl':     return await eng.pnl();
    case 'trades':  return await eng.trades(parseInt(q.limit || 200, 10));
    case 'status':  return await eng.status();
    default: return { ok: false, err: 'unknown okx ep ' + ep };
  }
}
module.exports = { handle };
