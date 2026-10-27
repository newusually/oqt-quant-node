/* ============================================================================
 * api/boards.js —— 【统一榜单/面板 API】（所有板块页面共用，组件化取数入口）
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25）：
 *   "想办法能不能使用什么办法 可以ajax速度快 网页并发 还有各类ajax组件复用"
 *   "所有板块页面 所有面板 都给我组件化 都给我复用 同样的画图等都可以复用"
 *   "js 每个计算 画图 下载 搜索 都分类 分层架构做好 做到复用"
 *
 * ★设计要点（为"快"和"复用"）：
 *   1) 单一入口: 任何板块/任何榜单都走 /api/boards/* ，前端组件只认这一套
 *   2) panel 接口【一次请求返回整个面板所需全部数据】(卡片+多榜单+图表数据)
 *      → 页面用一个请求渲染一个面板，请求数从 N 降到 1，天然解决并发压力
 *   3) 数据源是【常驻内存的 WebSocket 引擎】→ 响应是纯内存读取，毫秒级、零外部请求
 * ========================================================================== */
'use strict';
const T = require('../modules/okx/engines/universe');
const WS = require('../modules/okx/engines/okxws');
const I = require('../modules/okx/engines/insts');
const S = require('../modules/okx/engines/sentiment');
const A = require('../modules/okx/engines/analysis');
const FL = require('../modules/okx/engines/flow');
const REL = require('../modules/okx/engines/relation');
const CMP = require('../modules/okx/engines/compare');
const P3 = require('../modules/okx/engines/panel3');
const BF = require('../modules/okx/engines/backfill');
const UD = require('../modules/okx/engines/updown');

function int(v, d) { const n = parseInt(v, 10); return isFinite(n) ? n : d; }

/* 榜单类型 → 引擎调用（新增榜单只改这张表，组件无需改动） */
const KINDS = {
  '1d': { fn: () => 'boards', kind: '1d', label: '当日(1D)' },
  '5m': { fn: () => 'boards', kind: '5m', label: '5分钟' },
  '1m': { fn: () => 'boards', kind: '1m', label: '1分钟' }
};

async function handle(ep, q) {
  switch (ep) {
    /* 板块列表（含每板块品种数/上涨数/均涨幅/代表品种）—— 首页板块导航用 */
    case 'sectors': {
      const s = await T.sectorSummary();
      return {
        ok: !!s.ok, at: Date.now(), sectors: s.sectors || [],
        ws: WS.getStat()
      };
    }

    /* ★单个榜单：gain(涨幅榜) + lose(跌幅榜) 左右对称并列 */
    case 'board': {
      const kind = KINDS[q.kind] ? q.kind : '1d';
      const k = KINDS[kind];
      const opt = { sector: q.sector || '', limit: int(q.limit, 20) };
      const d = await T.boards(k.kind, opt);
      if (!d.ok) return { ok: false, kind, err: '数据源未就绪' };
      return {
        ok: true, kind, label: k.label, at: d.at, src: d.src || 'rest',
        sector: q.sector || 'all',
        gain: d.gain || [], lose: d.lose || [], list: d.list || [],
        scanned: d.scanned || 0
      };
    }

    /* ★面板全量数据：一次请求 = 卡片 + 多榜单 + 图表数据（关键：减少请求数） */
    case 'panel': {
      const sid = q.sector || '';
      const n = int(q.limit, 15);
      const kinds = (q.kinds || '1d,5m,1m').split(',');
      const [sq, ws] = await Promise.all([
        T.sectorQuotes(sid, 60),
        Promise.resolve(WS.getStat())
      ]);
      const boards = {};
      /* ★2026-10-26 提速：多周期榜单并行取（Promise.all），避免串行累加阻塞 */
      await Promise.all(kinds.map(async (kind) => {
        if (!KINDS[kind]) return;
        const k = KINDS[kind];
        const opt = { sector: sid, limit: n };
        const d = await T.boards(k.kind, opt);
        if (d && d.ok) {
          boards[kind] = {
            kind, label: k.label, gain: d.gain || [], lose: d.lose || [],
            list: d.list || [], scanned: d.scanned || 0, at: d.at
          };
        }
      }));
      // 图表直接可用的数据（前端组件拿去就能画，无需再加工）
      const list = (sq.list || []).slice(0, 20);
      const charts = {
        // 柱状: 板块内涨幅 top10
        barRank: list.slice(0, 10).map(x => ({ name: x.name, value: +x.pct.toFixed(2), code: x.code })),
        // 饼图: 涨跌家数
        pieUpDown: [
          { name: '上涨', value: (sq.list || []).filter(x => x.pct > 0).length },
          { name: '下跌', value: (sq.list || []).filter(x => x.pct < 0).length }
        ],
        // 横向条: 成交额 top10
        barTurn: list.slice().sort((a, b) => (b.turn || 0) - (a.turn || 0)).slice(0, 10)
          .map(x => ({ name: x.name, value: +(x.turn || 0).toFixed(0), code: x.code }))
      };
      return {
        ok: !!sq.ok, at: Date.now(), sector: sid, ws,
        cards: list,
        boards,
        charts
      };
    }

    /* 某板块行情列表（供卡片/表格/搜索/下载复用） */
    case 'quotes': {
      const d = await T.sectorQuotes(q.sector || '', int(q.limit, 60));
      return { ok: !!d.ok, at: Date.now(), list: d.list || [] };
    }

    /* 合约分类列表（OKX 页左侧分类列表用） */
    case 'universe': {
      const u = await T.universe();
      const by = {};
      (u.list || []).forEach(x => { (by[x.sector] = by[x.sector] || []).push(x); });
      const groups = (u.sectors || []).map(s => ({
        id: s.id, name: s.name, icon: s.icon, count: s.count,
        list: (by[s.id] || []).map(x => ({ code: x.instId, sym: x.sym, name: x.name, cat: x.cat }))
      }));
      return { ok: !!u.ok, at: Date.now(), groups, sectors: u.sectors || [] };
    }

    /* WS 引擎健康度（页面显示"实时/延迟"用） */
    case 'ws': return { ok: true, at: Date.now(), ws: WS.getStat() };

    /* ★主流币实时行情（首页直播条用：多个主流币的价格+当日1D涨跌幅）
     *   数据源 = WS tickers 内存快照（sodUtc8 口径 = 北京时间当日开盘） */
    case 'majors': {
      const syms = (q.syms || 'BTC,ETH,SOL,XRP,BNB,DOGE').toUpperCase().split(',')
        .map(s => s.trim()).filter(Boolean).slice(0, 12);
      const [u, qq] = await Promise.all([T.universe(), T.quotesAll()]);
      const meta = {};
      for (const x of (u.list || [])) meta[x.sym] = x;
      const list = [];
      for (const sym of syms) {
        const m = meta[sym];
        if (!m) continue;
        const t = qq.map[m.instId];
        if (!t) continue;
        list.push({
          sym, instId: m.instId, name: m.name || sym,
          px: t.last, pxText: t.pxText,
          pct: t.pct1d, pctText: t.pct1dText,
          turn: Math.round(t.turn || 0)
        });
      }
      return { ok: true, at: Date.now(), list };
    }

    /* ★市场情绪（按板块实时计算，用户 2026-10-25: "要按板块分类 分别计算市场情绪"） */
    case 'sentiment': {
      const d = await S.compute(false, int(q.bars, 1));
      return { ok: !!d.ok, at: Date.now(), bars: int(q.bars, 1), all: d.all || null, sectors: d.sectors || [] };
    }

    /* ★合约信息库（概念/分类，用户 2026-10-25: "介绍和概念都要保存在数据库然后分类"） */
    case 'insts': {
      await I.ensure();
      const d = I.search({ q: q.q || '', sector: q.sector || '', limit: int(q.limit, 100) });
      return { ok: !!d.ok, at: Date.now(), list: d.list || [] };
    }

    /* 合约详情（概念 + 实时行情） */
    case 'inst': {
      await I.ensure();
      const sym = (q.sym || '').toUpperCase();
      const info = I.get(sym);
      const [u, qq] = await Promise.all([T.universe(), T.quotesAll()]);
      const m = (u.list || []).find(x => x.sym === sym);
      const t = m ? qq.map[m.instId] : null;
      return {
        ok: !!info, at: Date.now(), sym,
        info: info ? {
          instId: info.instId, sym: info.sym, name: info.name, sector: info.sector,
          concept: info.concept, lever: info.lever
        } : null,
        quote: t ? { px: t.px, pct1d: t.pct1d, pct1dText: t.pct1dText, pct24: t.pct24, turn: t.turn } : null
      };
    }

    /* 分类树（板块 → 合约数，供"各个板块分布"） */
    case 'insttree': {
      await I.ensure();
      return { ok: true, at: Date.now(), tree: I.tree() };
    }

    /* ★AI 全市场分析（500+ 合约，用户 2026-10-25） */
    case 'ai': {
      const d = await A.analyze();
      return {
        ok: !!d.ok, at: Date.now(), total: d.total, up: d.up, down: d.down, flat: d.flat,
        turn: d.turn, pctAvg: d.pctAvg, takerCov: d.takerCov, mood: d.mood,
        sectors: d.sectors || [], gainTop: d.gainTop || [], loseTop: d.loseTop || [],
        takerStrong: d.takerStrong || [], takerWeak: d.takerWeak || [],
        // ★第三轮新增：各合约情绪榜 / 市场买卖倾向 / 榜单解读
        moodTop: d.moodTop || [], moodLow: d.moodLow || [],
        marketBias: d.marketBias, marketBiasColor: d.marketBiasColor,
        marketBiasReason: d.marketBiasReason, marketBiasText: d.marketBiasText,
        reads: d.reads || [],
        ai: d.ai || null, timeText: d.timeText
      };
    }

    /* 板块对比图数据（各板块 涨跌/taker/情绪/成交额，供"各个合约比较分类的画图"） */
    case 'sectordist': {
      const d = await A.analyze();
      if (!d.ok) return { ok: false, err: d.err };
      return {
        ok: true, at: Date.now(),
        sectors: (d.sectors || []).map(s => ({
          id: s.id, name: (s.icon ? s.icon + ' ' : '') + s.name, icon: s.icon, count: s.count,
          up: s.up, down: s.down, pctAvg: s.pctAvg, takerBuy: s.takerBuy,
          turn: s.turn, score: s.score, label: s.label
        }))
      };
    }


    /* ★★★⑥ 关系核实（用户 2026-10-25 第四轮）
     *   "要求核实涨跌比例和加密货币涨跌的关系 和takervol比例和涨跌幅度的关系
     *    要求核实如何才能买卖信号"
     *   "要求比较每个分时比较关系 和大盘的关系做表格做图"
     *   一次返回：① 关系核实(领先性/横截面/板块级/交叉表)
     *            ② 买卖信号规则 + 命中率回测（含阈值敏感性）
     *            ③ 分时多档(1m/5m/15m) 板块 × 大盘 对比
     */
    case 'relation': {
      try {
        const d = await REL.all({
          bars: int(q.bars, 120),
          buyTh: int(q.buyTh, 60),
          sellTh: int(q.sellTh, 40)
        });
        if (!d.ok) return { ok: false, err: d.err || '核实数据未就绪', verify: d.verify || null };
        return d;
      } catch (e) {
        return { ok: false, err: String((e && e.message) || e) };
      }
    }

    /* ⑦ 只取分时对比（轻量，AJAX 高频刷新用） */
    case 'intraday': {
      const d = await REL.intraday();
      if (!d.ok) return { ok: false, err: d.err };
      return { ok: true, at: Date.now(), list: d.list, market: d.market };
    }

    /* ★★★⑨ 数字货币基准对比（用户 2026-10-25 第五轮）
     *   "要求全部变成和合约数字货币比较曲线"
     *   "所有主页的面板能和合约数字货币比较就比较"
     *   "多用曲线 多用K线 曲线和K线都开始双条跑"
     *   sector 参数指定对比对象（缺省 = 全市场）
     */
    case 'vscrypto': {
      const sid = q.sector || '';
      const d = await CMP.all({ sector: sid });
      if (!d.ok) return { ok: false, err: d.err || '对比数据未就绪' };
      return d;
    }

    /* ⑩ 仅取数字货币基准 K 线（供其他面板叠加基准线） */
    case 'benchmark': {
      const d = await CMP.benchmark();
      if (!d.ok) return { ok: false, err: d.err };
      return {
        ok: true, at: Date.now(),
        name: d.eq.name, icon: d.eq.icon, sym: d.sym,
        candles: d.eq.candles, pct: d.eq.pct,
        btc: { candles: d.btc.candles, pct: d.btc.pct }
      };
    }


    /* ★第六轮: 首页最重要参考 —— 板块涨跌 ↔ takervol 双曲线（三个月 + 分页左移） */
    case 'maindual': {
      const d = await P3.mainDual({
        sector: q.sector || '',
        grain: q.grain || '1h',
        bars: int(q.bars, 100),
        beforeTs: int(q.beforeTs, 0)
      });
      if (!d.ok) return { ok: false, err: d.err };
      return d;
    }

    /* ★第六轮: 加密货币双面板（净买量&动能 ↔ 涨幅 / 情绪值 ↔ 涨跌幅） */
    case 'cryptopanels': {
      const d = await P3.cryptoPanels({
        grain: q.grain || '1h',
        bars: int(q.bars, 2160)
      });
      if (!d.ok) return { ok: false, err: d.err };
      return d;
    }

    /* ★第六轮: 合约级曲线（信号详情用） */
    case 'contractcurve': {
      const d = await P3.contractCurve(q.sym, {
        grain: q.grain || '5m', bars: int(q.bars, 200)
      });
      if (!d.ok) return { ok: false, err: d.err };
      return d;
    }

    /* ★第六轮: 回补任务状态（历史覆盖度） */
    case 'backfill': {
      const cov = await BF.coverage(q.grain || '1h');
      return {
        ok: true, at: Date.now(),
        coverage: cov,
        jobs: BF.allJobs(),
        state: (() => {
          const st = BF.state();
          return { cursorCount: Object.keys(st.cursor || {}).length, log: (st.log || []).slice(-10) };
        })()
      };
    }

    /* ★★★首页播报下方：全市场 15m 涨跌家数统计（2026-10-26）
     *   "搜索的 OKX 合约 200 多，每15分钟算上涨/下跌家数、比例、差额，
     *    并与主力合约(BTC)15分钟涨幅比较 → 画双曲线 + 详细表格"
     *   参数: grain(15m/1h/5m) sector(板块) bars(根数, 默认4000≈42天) beforeTs(左移看更早) lead(主力, 默认BTC) */
    case 'updown': {
      try {
        const d = await UD.updown({
          grain: q.grain || '15m',
          sector: q.sector || '',
          bars: int(q.bars, 4000),
          beforeTs: int(q.beforeTs, 0),
          lead: q.lead || 'BTC',
          /* ★2026-10-28 服务端分页(可选): 传了才分页, 不传=全量(向后兼容)。
           *   3m bars=18000 全量响应实测 4.32 MB, 表格一屏只显示 20 行 → 分页省 99.9% 传输 */
          page: int(q.page, 0),
          pageSize: int(q.pageSize, 0)
        });
        return d;
      } catch (e) {
        return { ok: false, err: String((e && e.message) || e), bars: [] };
      }
    }

    /* ★2026-10-26 用户要求：连续上涨/下跌家数 > N 的区段统计 + BTC 多空关系核实 */
    case 'streak': {
      try {
        return await require('../modules/okx/engines/streak').streak({
          grain: q.grain || '15m',
          thr: int(q.thr, 100),
          minLen: int(q.minLen, 2),
          bars: int(q.bars, 18000),
          maxRows: int(q.maxRows, 400)
        });
      } catch (e) { return { ok: false, err: String((e && e.message) || e), rows: [] }; }
    }

    /* ★★★首页总览：BTC 涨跌家数买卖信号回测（2026-10-26）
     *   "下跌家数≥50%连续3次 → 第4次≤20% → 只买BTC"
     *   计算 15m/5m/3m/1h/2h/4h 六个周期，输出全部历史信号 + 汇总回测表 */
    case 'buysignal': {
      try {
        const { buySignals } = require('../modules/okx/engines/buysignal');
        const d = await buySignals({ bars: int(q.bars, 2000) });
        return d;
      } catch (e) {
        return { ok: false, err: String((e && e.message) || e), all: [] };
      }
    }

    /* ★★★买卖信号的数据库存档状态（2026-10-26）
     *   "所有表格都保存到数据库 + 换新电脑自动检测回补数据"
     *   返回: buysig.sqlite 中六周期已存档信号数、时间范围、本地K线库完整度 */
    case 'buysigstore': {
      try {
        const S = require('../modules/okx/engines/buysigstore');
        const all = S.loadAll();
        const st = S.checkIntegrity ? await S.checkIntegrity() : null;
        return { ok: true, at: Date.now(), count: all.length, integrity: st };
      } catch (e) {
        return { ok: false, err: String((e && e.message) || e) };
      }
    }

    default: return { ok: false, err: 'unknown boards ep ' + ep };
  }
}

module.exports = { handle };
