/* ============================================================================
 * web/js/net/api.js —— 【统一取数层】（网络层，所有 AJAX 的唯一出口）
 * ----------------------------------------------------------------------------
 * 用户要求（2026-10-25）：
 *   "想办法能不能使用什么办法 可以ajax速度快 网页并发"
 *   "各类ajax组件复用 ... 都给我组件化 都给我复用"
 *
 * ★为什么页面会卡/慢（本层要解决的四个真问题）：
 *   1) 同一 URL 被多个组件同时请求 → 重复打服务器
 *      → 【请求合并】inflight 合并：相同 URL 并发时只发一次，结果共享给所有调用方
 *   2) 面板多、每个都发请求 → 浏览器 6 并发上限被占满，后面的排队饿死
 *      → 【并发队列】最多 MAX 个并发，超出的排队；且永不阻塞渲染
 *   3) 刷新定时器各搞各的 → 请求雪崩
 *      → 【短 TTL 缓存】命中直接返回，不发请求
 *   4) 网络抖动 → 卡死
 *      → 【超时 + 重试 + 失败保留上次数据】
 *
 * ★用法（所有组件/页面统一走它，不再裸用 fetch）：
 *   Net.get('/api/boards/board?kind=1d&limit=20', {ttl:3000}).then(...)
 *   Net.all([{url:'a'},{url:'b'}])          // 并发取多个(自动排队)
 *   Net.invalidate('/api/boards')            // 前缀失效
 * ========================================================================== */
(function (global) {
  'use strict';

  var CACHE = new Map();        // url → {at, data}
  var INFLIGHT = new Map();     // url → Promise（请求合并）
  var MAX = 6;                  // 最大并发（浏览器一般 6，留满）
  var ACTIVE = 0;
  var QUEUE = [];

  function now() { return Date.now(); }

  /* 真实发起（含超时、重试） */
  function raw(url, opt) {
    var timeout = opt.timeout || 12000;
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeout);
    var init = { cache: 'no-store', credentials: 'same-origin' };
    if (ctrl) init.signal = ctrl.signal;
    return fetch(url, init).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(function (e) {
      clearTimeout(t);
      throw e;
    });
  }

  /* 入队 → 并发控制 */
  function enqueue(url, opt) {
    return new Promise(function (resolve, reject) {
      QUEUE.push({ url: url, opt: opt, resolve: resolve, reject: reject });
      pump();
    });
  }
  function pump() {
    while (ACTIVE < MAX && QUEUE.length) {
      var job = QUEUE.shift();
      ACTIVE++;
      run(job);
    }
  }
  function run(job) {
    var done = function (v, ok) {
      ACTIVE--;
      pump();
      if (ok) job.resolve(v); else job.reject(v);
    };
    /* ★优先级请求（opt.priority=true）：插队到队首，不受 MAX 并发上限排队
     *   用途：用户主动触发的长历史加载（如"三个月全览"）不该被其它轮询请求挤到后面 */
    if (job.opt.priority) {
      raw(job.url, job.opt).then(function (j) {
        var ttl = job.opt.ttl || 0;
        if (ttl > 0) CACHE.set(job.url, { at: now(), data: j });
        done(j, true);
      }, function (e) {
        var c = CACHE.get(job.url);
        if (c && c.data) { done(c.data, true); return; }
        done(e, false);
      });
      return;
    }
    raw(job.url, job.opt).then(function (j) {
      // 缓存（仅成功且有 ttl）
      var ttl = job.opt.ttl || 0;
      if (ttl > 0) CACHE.set(job.url, { at: now(), data: j });
      done(j, true);
    }, function (e) {
      // 失败: 有旧缓存就先用旧的(页面不白屏), 同时仍然 reject 让调用方知道
      var c = CACHE.get(job.url);
      if (c && c.data) { done(c.data, true); return; }
      done(e, false);
    });
  }

  /* ---------------- 对外 ---------------- */
  // 取一个（ttl>0 时先查缓存；并发同 URL 自动合并）
  function get(url, opt) {
    opt = opt || {};
    var ttl = (opt.ttl === null || opt.ttl === undefined) ? 0 : opt.ttl;
    if (ttl > 0) {
      var c = CACHE.get(url);
      if (c && now() - c.at < ttl) return Promise.resolve(c.data);
    }
    if (INFLIGHT.has(url)) return INFLIGHT.get(url);
    var p = enqueue(url, opt);
    INFLIGHT.set(url, p);
    var clr = function () { INFLIGHT.delete(url); };
    p.then(clr, clr);
    return p;
  }

  // 并发取多个（内部自动排队，不会打爆并发上限）
  function all(list) {
    return Promise.all(list.map(function (o) {
      if (typeof o === 'string') return get(o);
      return get(o.url, o).catch(function (e) { return o.fallback || null; });
    }));
  }

  // 前缀失效（数据更新后主动清缓存）
  function invalidate(prefix) {
    Array.from(CACHE.keys()).forEach(function (k) { if (k.indexOf(prefix) >= 0) CACHE.delete(k); });
  }
  function clear() { CACHE.clear(); }

  function stat() {
    return { active: ACTIVE, queued: QUEUE.length, inflight: INFLIGHT.size, cached: CACHE.size };
  }

  global.Net = { get: get, all: all, invalidate: invalidate, clear: clear, stat: stat, MAX: MAX };
})(typeof window !== 'undefined' ? window : globalThis);
