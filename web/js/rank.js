/* ============================================================================
 * rank.js —— 日涨幅/跌幅排行榜页
 * ----------------------------------------------------------------------------
 * ★2026-10-25 用户要求:
 *   "涨幅榜要修正为和主页一样的组件 只显示1D北京时间的涨幅榜和跌幅榜"
 *   → 本页改用【总览页同一套 RankPack 组件】（分类标签 + 榜单 + 配图 + 解读），
 *     数据源 /api/boards/board?kind=1d
 *     = WS tickers 的 sodUtc8（北京时间当日开盘）→ 北京时间当日 1D 涨跌幅
 *
 * 本文件职责：挂载两个 RankPack（涨幅榜 / 跌幅榜）+ 悬停 5 分钟 K 线 + 直播条
 * ========================================================================== */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function cls(p) { return p > 0 ? 'up' : (p < 0 ? 'dn' : 'flat'); }

  var CD = 8;             // 刷新倒计时(秒)
  var LOADED = false;

  /* ---------------- 通用悬浮K线取数（OKX 合约，共用 ChanPop） ----------------
   * inst 形如 ETH-USDT-SWAP；弹出【5分钟】实时 ajax 悬浮K线窗 */
  var POP_TF = '5m';
  function popFetch(inst, tf, n, extra) {
    function build(t) {
      var u = '/api/okx/kline?inst=' + encodeURIComponent(inst) + '&tf=' + t + '&limit=' + (n || 300);
      if (extra && extra.before) u += '&before=' + extra.before;
      return u;
    }
    var t0 = tf || POP_TF;
    return fetch(build(t0), { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (k) {
      var bars = (k && k.ok) ? (k.rows || k.bars || []) : [];
      if (!bars.length && t0 !== '1d') {
        // 该品种没有 5 分钟数据 → 回退日线（至少给个图看）
        return fetch(build('1d'), { cache: 'no-store' }).then(function (r2) { return r2.json(); }).then(function (k2) {
          return { ok: !!(k2 && k2.ok), bars: (k2 && k2.rows) || (k2 && k2.bars) || [], chan: (k2 && k2.chan) || null };
        });
      }
      return { ok: !!(k && k.ok), bars: bars, chan: (k && k.chan) || null };
    }).catch(function () { return { ok: false, bars: [] }; });
  }

  function initPop() {
    if (!window.ChanPop) return;
    window.ChanPop.setFetch({ kline: popFetch });
  }

  /* ---------------- 直播条 ---------------- */
  function renderBar(d) {
    function set(id, txt, pct) {
      var e = $(id); if (!e) return;
      e.textContent = txt;
      e.className = (pct === null || pct === undefined) ? '' : cls(pct);
    }
    set('lb-okx-count', (d.universe && d.universe.okx ? d.universe.okx + ' 个' : '-'));
    set('lb-time', d.timeText || new Date().toLocaleString('zh-CN'));
  }

  /* ---------------- 合约数（直播条） ---------------- */
  function refreshCount() {
    fetch('/api/market/rank?limit=1&t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) renderBar(d); })
      .catch(function () { });
  }

  /* ---------------- 加载遮罩 ---------------- */
  function hideLoader() {
    if (LOADED) return;
    LOADED = true;
    var l = $('loader');
    if (l) { l.classList.add('hide'); setTimeout(function () { if (l.parentNode) l.parentNode.removeChild(l); }, 500); }
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    // 时钟
    function tick() { var c = $('clock'); if (c) c.textContent = new Date().toLocaleString('zh-CN'); }
    tick(); setInterval(tick, 1000);

    // ★oqt 财经电台（电视动画保留, 语音静音）
    if (window.Announcer) {
      if (window.Announcer.mute) window.Announcer.mute(true);
      window.Announcer.mountTV('tvbox');
    }

    initPop();

    // ★榜单：与总览页同一套 RankPack 组件（分类标签 + 榜单 + 配图 + 解读）
    if (window.RankPack) {
      window.RankPack.mount('rk-gain', {
        kind: '1d', scope: '全市场', metric: '涨跌幅', tf: '1D',
        only: 'gain', charts: ['bar', 'pie'], limit: 12, interval: 8000,
        onPick: function (code) {
          if (code) location.href = '/modules/okx/web/index.html?inst=' + encodeURIComponent(code);
        }
      });
      window.RankPack.mount('rk-lose', {
        kind: '1d', scope: '全市场', metric: '涨跌幅', tf: '1D',
        only: 'lose', charts: ['bar'], limit: 12, interval: 8000,
        onPick: function (code) {
          if (code) location.href = '/modules/okx/web/index.html?inst=' + encodeURIComponent(code);
        }
      });
    }

    refreshCount();
    setInterval(refreshCount, 30000);

    // ★榜单数据到达即隐藏加载遮罩（RankPack 渲染完成后）
    if (window.RankPack) {
      var iv = setInterval(function () {
        var rows = document.querySelectorAll('#rk-gain .bd-row, #rk-lose .bd-row').length;
        if (rows > 0) { clearInterval(iv); hideLoader(); }
      }, 300);
      setTimeout(function () { clearInterval(iv); hideLoader(); }, 12000);
    }

    // ★实时: 每 1 秒倒计时
    setInterval(function () {
      CD--;
      if (CD <= 0) { CD = 8; refreshCount(); }
      var cd = $('lb-cd'); if (cd) cd.textContent = String(CD);
    }, 1000);

    setTimeout(hideLoader, 12000);   // 兜底
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
