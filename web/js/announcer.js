/* ============================================================================
 * announcer.js —— 【全站通用】行情自动播报 + 市场情绪分析 + 电视式播报动画
 * ----------------------------------------------------------------------------
 * 用户要求：
 *   "打开这个网站居然不播报 我要求全部播报 不仅是学习页面 okx a股 等
 *    给我播报最新行情和总结一下热门的行情等"
 *   "并且还要有AI分析 哪些股票 合约等 期货 可以接入 分析市场热度
 *    实时显示时间 还有语音播报 市场情绪 给我整的像样点 跟同花顺财经播报一样"
 *   "最好总览出个电视机 可以有个动画就是跟电台一样播报实时新闻一样"
 *
 * 设计：
 *   1) window.Announcer.speak(text)      → 通过 /api/s/tts 代理云端发音(带队列/去重)
 *   2) window.Announcer.fetchSummary()   → 拉 /api/market/summary(多市场行情摘要)
 *   3) window.Announcer.start(opts)      → 页面载入自动播报 + 定时轮播
 *   4) window.Announcer.mountTV(boxId)    → 电视式播报动画(字幕滚动 + 扫描线 + 抖动)
 *
 * ★发音通道与 s 模块一致: 走 Node 代理 /api/s/tts（浏览器直连云端 TTS 会被 ORB 拦掉）
 * ========================================================================== */
(function (global) {
  'use strict';

  var A = {
    enabled: true,          // 全局开关（用户要求：默认直接播报、无法关闭）
    muted: false,           // ★静音开关（用户 2026-10-24: "首页播报语音取消 不要语音了 太烦了"）
    queue: [],
    busy: false,
    timer: null,
    lastText: '',
    lastAt: 0,
    audio: null,
    ttsBase: '/api/s/tts',
    voice: 'g-zh',
    _unlocked: false,
    _items: []
  };

  /* ---------------- 发音通道自动探测 ----------------
   * node 版 → /api/s/tts (Node 代理)
   * latest 版(PHP+Apache) → /s/tts.php
   * 两者都试一遍, 哪个通用哪个
   */
  var TTS_CANDIDATES = ['/api/s/tts', '/s/tts.php'];
  var TTS_BASE = null;
  function pickTts() {
    if (TTS_BASE) return TTS_BASE;
    for (var i = 0; i < TTS_CANDIDATES.length; i++) {
      var u = TTS_CANDIDATES[i] + '?text=%E4%B8%89&voice=g-zh';
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', u, false);   // 同步探测一次(仅首次)
        xhr.send();
        if (xhr.status === 200 && (xhr.responseType === '' || (xhr.responseText || '').length > 100)) {
          TTS_BASE = TTS_CANDIDATES[i];
          return TTS_BASE;
        }
      } catch (e) { }
    }
    TTS_BASE = TTS_CANDIDATES[0];
    return TTS_BASE;
  }

  /* ★学习乐园( modules/s/* )用【台湾女声】(g-tw)播报行情电台
   *   —— 用户要求「学习乐园那个声音女生 自动播放这个电台」 */
  if (typeof location !== 'undefined' && /\/modules\/s\//.test(location.pathname || '')) {
    A.voice = 'g-tw';
  }

  /* ---------------- 发音 ---------------- */
  function speak(text, opts) {
    opts = opts || {};
    if (!A.enabled || A.muted || !text) return;      // ★静音: 一律不出声(用户: 太烦了)
    var t = String(text).trim();
    if (!t) return;
    // 去重: 3 分钟内同一句话不重复播
    if (!opts.force && t === A.lastText && Date.now() - A.lastAt < 180000) return;
    A.lastText = t; A.lastAt = Date.now();
    A.queue.push({ text: t, voice: opts.voice || A.voice });
    if (A.queue.length > 6) A.queue.splice(0, A.queue.length - 6);
    pump();
  }

  /* ★静音开关: 首页/排行榜页用户嫌语音烦 → 只保留电视动画, 不出声 */
  function mute(v) {
    A.muted = !!v;
    A.queue = [];
    try { if (A.audio) A.audio.pause(); } catch (e) { }
    hideUnlockHint();
    var ch = document.querySelector('.otv-ch');
    if (ch) ch.textContent = A.muted ? 'oqt 财经电台 · 🔇 静音' : 'oqt 财经电台';
  }

  function pump() {
    if (A.busy || !A.queue.length) return;
    var job = A.queue.shift();
    A.busy = true;
    var url = pickTts() + '?text=' + encodeURIComponent(job.text.slice(0, 180)) +
              '&voice=' + encodeURIComponent(job.voice);
    try {
      var a = new Audio();
      A.audio = a;
      a.preload = 'auto';
      // ★关键: 必须把代理 URL 赋给 src, 否则音频元素没有源, 永远不出声
      a.src = url;
      a.crossOrigin = 'anonymous';
      var done = false;
      function fin(ok) {
        if (done) return; done = true;
        A.busy = false;
        try { a.pause(); } catch (e) {}
        if (!ok) { /* 播报失败也要继续下一条, 不能卡死队列 */ }
        setTimeout(pump, 260);
      }
      a.onended = function () { fin(true); };
      a.onerror = function () { fin(false); };
      // 浏览器要求用户手势后才允许播放 → 失败时给个提示并跳过
      var pr = a.play();
      if (pr && pr.then) {
        pr.then(function () { A._unlocked = true; hideUnlockHint(); }).catch(function (e) {
          // 自动播放被拦: 挂一次性手势监听, 用户点一下后自动继续播
          showUnlockHint();
          unlockThen(function () { a.play().catch(function () {}); });
        });
      }
      // 兜底: 音频太长(>20s)就当播完
      setTimeout(function () { fin(true); }, Math.max(6000, job.text.length * 420));
    } catch (e) {
      A.busy = false;
      setTimeout(pump, 400);
    }
  }

  /* ---------------- 自动播放被拦时的友好提示 ----------------
   * 浏览器(Chrome/Edge)规定: 未经用户手势不得自动播放声音。
   * 这不是 bug —— 给用户一个明确提示: 点一下页面就开始播。 */
  var HINT_ID = 'ann-unlock-hint';
  function showUnlockHint() {
    if (A._unlocked || document.getElementById(HINT_ID)) return;
    var d = document.createElement('div');
    d.id = HINT_ID;
    d.innerHTML = '🔊 <b>请点击页面任意处</b> 开启语音播报（浏览器安全策略：未经手势不允许自动播放声音）';
    d.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:99999;' +
      'padding:12px 22px;border-radius:12px;font-size:14px;color:#fff;' +
      'background:linear-gradient(90deg,#3d7bff,#8b5cf6);' +
      'border:1px solid #8fd0ff;box-shadow:0 8px 32px rgba(61,123,255,.5);cursor:pointer;' +
      'animation:hintPulse 1.6s ease-in-out infinite;';
    var sty = document.createElement('style');
    sty.textContent = '@keyframes hintPulse{0%,100%{box-shadow:0 8px 32px rgba(61,123,255,.4);}50%{box-shadow:0 8px 44px rgba(139,92,246,.75);}}';
    document.head.appendChild(sty);
    d.onclick = function () { A._unlocked = true; hideUnlockHint(); pump(); };
    document.body.appendChild(d);
  }
  function hideUnlockHint() {
    var el = document.getElementById(HINT_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function unlockThen(cb) {
    if (A._unlocked) { cb(); return; }
    function h() {
      document.removeEventListener('pointerdown', h, true);
      document.removeEventListener('keydown', h, true);
      A._unlocked = true;
      hideUnlockHint();
      cb();
    }
    document.addEventListener('pointerdown', h, true);
    document.addEventListener('keydown', h, true);
  }

  /* ---------------- 行情摘要 ---------------- */
  function fetchSummary() {
    return fetch('/api/market/summary?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; });
  }

  /* ---------------- 摘要转播报稿 ---------------- */
  // sm: {ok, hot:[{name,code,pct,px}], gainers:[], losers:[], mood:{score,label}, aStock:{...}, nq:{...}, okx:{...}, ts}
  function toScript(sm) {
    if (!sm || !sm.ok) return null;
    var parts = [];
    var now = new Date();
    var hh = now.getHours(), mm = now.getMinutes();
    parts.push('现在是' + hh + '点' + (mm < 10 ? '0' + mm : mm) + '分，' + 'oqt量化播报为您带来最新行情。');

    // 1) 大盘/主市场
    var mk = [];
    if (sm.aStock && sm.aStock.name) mk.push(sm.aStock.name + ' ' + sm.aStock.pctText);
    if (sm.nq && sm.nq.name) mk.push(sm.nq.name + ' ' + sm.nq.pctText);
    if (sm.okx && sm.okx.name) mk.push(sm.okx.name + ' ' + sm.okx.pctText);
    if (mk.length) parts.push(mk.join('，') + '。');

    // 2) 热门行情
    if (sm.hot && sm.hot.length) {
      var t = sm.hot.slice(0, 3).map(function (x) {
        return x.name + (x.pct >= 0 ? '涨' : '跌') + Math.abs(x.pct).toFixed(2) + '个点';
      }).join('，');
      parts.push('热门行情方面，' + t + '。');
    }

    // 3) 最快涨幅
    if (sm.gainers && sm.gainers.length) {
      var g = sm.gainers[0];
      parts.push('当前涨幅最快的是' + g.name + '，' + (g.pct >= 0 ? '上涨' : '下跌') + Math.abs(g.pct).toFixed(2) + '个点。');
    }

    // 4) 市场情绪 + AI 结论
    if (sm.mood) {
      parts.push('市场情绪' + sm.mood.label + '，情绪指数' + sm.mood.score + '。');
    }
    if (sm.ai && sm.ai.text) {
      parts.push(sm.ai.text);
    }
    return parts.join('');
  }

  /* ---------------- 启动 ---------------- */
  // opt: {auto:true, interval: 300000(5分钟), tv: 'tvbox', onSummary: fn}
  function start(opt) {
    opt = opt || {};
    if (A.timer) clearInterval(A.timer);
    var tick = function () {
      fetchSummary().then(function (sm) {
        if (!sm || !sm.ok) return;
        A._items = (sm.hot || []).slice(0, 12);
        if (opt.onSummary) opt.onSummary(sm);
        if (opt.auto !== false) {
          var script = toScript(sm);
          if (script) speak(script, { force: true });
        }
      });
    };
    // 首次延迟一点（等页面渲染完）
    setTimeout(tick, opt.delay || 2600);
    // ★用户要求: 播报一次以后【每隔5分钟】播报
    A.timer = setInterval(tick, opt.interval || 300000);
    // ★异动监测: 最近1分钟内涨跌超过2% → 立即插播
    startMoverWatch(opt);
    // 用户手势后自动解锁播放（静音时不弹解锁提示）
    if (!A.muted) unlockThen(function () { });
  }

  /* ---------------- 异动播报（1分钟内涨跌 > 2% 立即播报） ----------------
   * 每 20 秒拉一次全市场实时榜, 与约 60 秒前的快照比价:
   * 任一品种 1 分钟内价格变动 ≥ 2% → 立即插播一条异动警报(不受 5 分钟间隔限制) */
  var MOVER_SNAP = [];        // [{at, px: {code: price}}]
  var MOVER_TIMER = null;
  var MOVER_LAST_AT = 0;
  function startMoverWatch(opt) {
    if (MOVER_TIMER) return;
    var check = function () {
      fetch('/api/market/rank?limit=60&t=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok) return;
          var now = Date.now();
          var px = {};
          var nameOf = {};
          var all = []
            .concat(d.a.gain || [], d.a.lose || [], d.okx.gain || [], d.okx.lose || []);
          for (var i = 0; i < all.length; i++) {
            if (all[i].code && all[i].px) { px[all[i].code] = all[i].px; nameOf[all[i].code] = all[i].name; }
          }
          MOVER_SNAP.push({ at: now, px: px });
          if (MOVER_SNAP.length > 12) MOVER_SNAP.shift();
          // 找约 60 秒前的快照
          var base = null;
          for (var k = MOVER_SNAP.length - 1; k >= 0; k--) {
            if (now - MOVER_SNAP[k].at >= 55000) { base = MOVER_SNAP[k]; break; }
          }
          if (!base || now - MOVER_LAST_AT < 60000) return;    // 1 分钟内不重复播同主题
          var hits = [];
          for (var code in px) {
            var p0 = base.px[code];
            if (!p0 || p0 <= 0) continue;
            var chg = (px[code] - p0) / p0 * 100;
            if (Math.abs(chg) >= 2) hits.push({ code: code, name: nameOf[code] || code, chg: chg });
          }
          if (!hits.length) return;
          hits.sort(function (x, y) { return Math.abs(y.chg) - Math.abs(x.chg); });
          MOVER_LAST_AT = now;
          var top = hits.slice(0, 3).map(function (x) {
            return x.name + (x.chg >= 0 ? '急涨' : '急跌') + Math.abs(x.chg).toFixed(1) + '个点';
          }).join('，');
          speak('紧急快讯，市场异动！' + top + '。请注意风险。', { force: true });
          if (opt && opt.onMover) opt.onMover(hits);
        })
        .catch(function () { });
    };
    setTimeout(check, 20000);                 // 首次 20 秒后开始(先攒快照)
    MOVER_TIMER = setInterval(check, 20000);
  }

  /* ---------------- 电视式播报动画 ---------------- */
  // 在 box 内渲染: CRT 边框 + 扫描线 + 字幕滚动 + 频道条
  function mountTV(boxId, opt) {
    opt = opt || {};
    var box = document.getElementById(boxId);
    if (!box) return null;
    box.innerHTML =
      '<div class="otv">' +
        '<div class="otv-crt">' +
          '<div class="otv-scan"></div>' +
          '<div class="otv-bar"><span class="otv-dot"></span><span class="otv-ch">oqt 财经电台</span><span class="otv-time" id="otv-time">--:--:--</span></div>' +
          '<div class="otv-body" id="otv-body"></div>' +
          '<div class="otv-ticker" id="otv-ticker"></div>' +
        '</div>' +
      '</div>';

    var body = document.getElementById('otv-body');
    var ticker = document.getElementById('otv-ticker');
    var timeEl = document.getElementById('otv-time');

    setInterval(function () {
      if (timeEl) timeEl.textContent = new Date().toLocaleTimeString('zh-CN');
    }, 1000);

    // 滚动字幕
    var cur = '';
    function push(txt) {
      if (!txt || txt === cur) return;
      cur = txt;
      if (body) {
        body.innerHTML = '<div class="otv-line">' + esc(txt) + '</div>';
        var l = body.querySelector('.otv-line');
        if (l) { l.classList.remove('go'); void l.offsetWidth; l.classList.add('go'); }
      }
    }

    // 底部滚动条（行情快讯）
    var tickerItems = [];
    var tk = setInterval(function () {
      if (!tickerItems.length) { if (ticker) ticker.textContent = '等待行情数据…'; return; }
      tickerItems.push(tickerItems.shift());
      if (ticker) ticker.textContent = tickerItems.join('   ◆   ');
    }, 3200);

    // 数据源
    function pull() {
      fetchSummary().then(function (sm) {
        if (!sm || !sm.ok) return;
        var lines = [];
        if (sm.aStock && sm.aStock.name) lines.push(sm.aStock.name + ' ' + sm.aStock.pctText + '　' + (sm.aStock.pxText || ''));
        if (sm.nq && sm.nq.name) lines.push(sm.nq.name + ' ' + sm.nq.pctText + '　' + (sm.nq.pxText || ''));
        if (sm.okx && sm.okx.name) lines.push(sm.okx.name + ' ' + sm.okx.pctText + '　' + (sm.okx.pxText || ''));
        if (sm.mood) lines.push('市场情绪：' + sm.mood.label + '（' + sm.mood.score + '）');
        if (sm.ai && sm.ai.text) lines.push(sm.ai.text);
        push(lines.join('　｜　'));

        tickerItems = (sm.hot || []).slice(0, 10).map(function (x) {
          return x.name + ' ' + (x.pct >= 0 ? '+' : '') + x.pct.toFixed(2) + '%';
        });
        if (sm.gainers && sm.gainers.length && tickerItems.length) {
          tickerItems.push('最快涨幅：' + sm.gainers[0].name + ' ' + sm.gainers[0].pct.toFixed(2) + '%');
        }
      });
    }
    pull();
    setInterval(pull, 15000);

    // 每次刷新都念一遍（像电台）—— 5 分钟一轮
    var spk = setInterval(function () {
      fetchSummary().then(function (sm) {
        var s = toScript(sm);
        if (s) speak(s, { force: true });
      });
    }, opt.speakEvery || 300000);
    setTimeout(function () {
      fetchSummary().then(function (sm) {
        var s = toScript(sm);
        if (s) speak(s, { force: true });
      });
    }, 4200);

    return { pull: pull, stop: function () { clearInterval(spk); clearInterval(tk); } };
  }

  function esc(s) {
    return String((s === null || s === undefined) ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  global.Announcer = {
    speak: speak,
    start: start,
    fetchSummary: fetchSummary,
    toScript: toScript,
    mountTV: mountTV,
    state: A,
    setVoice: function (v) { A.voice = v; },
    mute: mute,
    isMuted: function () { return A.muted; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
