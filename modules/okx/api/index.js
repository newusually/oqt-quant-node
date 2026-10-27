// M7 modules/okx/api · OKX 子项目 JSON 接口（被顶层 api/okx 分发）
//   端点: instruments(合约列表) / kline(真实K线+指标) / pull(实时获取·补充数据)
//        account / pnl / trades / status
'use strict';
const eng = require('../engines');
const realtime = require('../engines/realtime');
const okxapi = require('../engines/okxapi');

// ★OKX API 凭证管理: 页面「API 设置」输入 apiKey/secret/passphrase
//   只接受 POST(凭证不能出现在 URL 上, 会被 access log 留存)
//   action: status(默认) / save / test / clear
async function credHandle(q, body) {
  const act = (body && body.action) || 'status';
  if (act === 'status') return await okxapi.credInfo();
  if (act === 'save') {
    const r = okxapi.saveCred(body);
    if (!r.ok) return r;
    const acc = await eng.account();
    const info = okxapi.credInfo();
    if (!acc.ok) return { ok: false, saved: true, apiKey: info.apiKey, err: '凭证已保存, 但连接 OKX 失败: ' + acc.err };
    return { ok: true, msg: '已连接 OKX 账户', apiKey: info.apiKey, totalEq: acc.totalEq, ccy: acc.ccy };
  }
  if (act === 'test') {
    const acc = await eng.account();
    if (!acc.ok) return { ok: false, err: acc.err };
    return { ok: true, msg: 'OKX 账户连接正常', totalEq: acc.totalEq, ccy: acc.ccy };
  }
  if (act === 'clear') { okxapi.clearCred(); return { ok: true, msg: '凭证已清除' }; }
  return { ok: false, err: 'unknown cred action ' + act };
}

async function handle(ep, q, body) {
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
    case 'cred':    return await credHandle(q, body);
    // ★历史回补进度（页面底部进度面板）
    case 'backfillprogress': return await require('../engines/backfillprogress').progress(q);
    default: return { ok: false, err: 'unknown okx ep ' + ep };
  }
}
module.exports = { handle };
