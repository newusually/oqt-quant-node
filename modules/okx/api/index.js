// OKX 子项目 JSON 接口（由顶层 /api/okx 分发）
//   行情/账户: instruments / tickers / book / positions / kline / pull / backfill / account / pnl / trades / status / cred
//   金字塔模拟: flowtrack / pyr_* / ai_strategy / flowtrack/stream(SSE)
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
    // 金字塔模拟引擎 stats()：常驻 server 进程，独立库 data/flowtrack/flowtrack.sqlite
    case 'flowtrack': {
      try {
        return require('../engines/flowtrack').stats();
      } catch (e) {
        return { ok: false, err: '订单流跟踪引擎异常: ' + String((e && e.message) || e) };
      }
    }
    /* 兼容路由：旧跃迁历史入口，委托到金字塔数据 */
    case 'flowtrack_jumphist': {
      try {
        return require('../engines/flowtrack').jumpHistory(q.cat, q.page, q.sort, q.order);
      } catch (e) {
        return { ok: false, err: '跃迁历史接口异常: ' + String((e && e.message) || e) };
      }
    }
    /* 兼容路由：旧合约榜 / 某合约交易明细 */
    case 'flowtrack_jm2insts': {
      try {
        return require('../engines/flowtrack').jumpInsts(q.limit);
      } catch (e) {
        return { ok: false, err: '跃迁合约榜接口异常: ' + String((e && e.message) || e) };
      }
    }
    case 'flowtrack_jm2trades': {
      try {
        return require('../engines/flowtrack').jumpTradesByInst(q.inst, q.page, q.marks);
      } catch (e) {
        return { ok: false, err: '跃迁合约交易接口异常: ' + String((e && e.message) || e) };
      }
    }
    /* 金字塔：总结 / 合约榜 / 明细 / K线标记 / 全部事件 / 持仓 */
    case 'pyr_summary': {
      try { return require('../engines/flowtrack').pyrSummary(); } catch (e) { return { ok: false, err: '金字塔总结接口异常: ' + String((e && e.message) || e) }; }
    }
    case 'pyr_insts': {
      try { return require('../engines/flowtrack').pyrInsts(q.limit); } catch (e) { return { ok: false, err: '金字塔合约榜接口异常: ' + String((e && e.message) || e) }; }
    }
    case 'pyr_trades': {
      try { return require('../engines/flowtrack').pyrTrades(q.inst, q.page, q.marks); } catch (e) { return { ok: false, err: '金字塔交易接口异常: ' + String((e && e.message) || e) }; }
    }
    case 'pyr_marks': {
      try { return require('../engines/flowtrack').pyrMarks(q.inst, q.tf); } catch (e) { return { ok: false, err: '金字塔标记接口异常: ' + String((e && e.message) || e) }; }
    }
    case 'pyr_all': {
      try { return require('../engines/flowtrack').pyrAll(q.page, q.sort, q.order, q.tf, q.ev); } catch (e) { return { ok: false, err: '金字塔明细接口异常: ' + String((e && e.message) || e) }; }
    }
    case 'pyr_positions': {
      try { return require('../engines/flowtrack').pyrPositions(q.page, q.tf, q.ev); } catch (e) { return { ok: false, err: '金字塔持仓接口异常: ' + String((e && e.message) || e) }; }
    }
    /* ★2026-11-10 AI 策略面板：读取服务器每日零点由 CodeBuddy/Hy4 生成的 data/ai_strategy.json
     *   返回 { report(结论/步骤/思维导图/明细/曲线), applied, locked, effective, error } */
    case 'ai_strategy': {
      try { return require('../engines/flowtrack').aiStrategy(); } catch (e) { return { ok: false, err: 'AI 策略接口异常: ' + String((e && e.message) || e) }; }
    }
    case 'cred':    return await credHandle(q, body);
    default: return { ok: false, err: 'unknown okx ep ' + ep };
  }
}
module.exports = { handle };
