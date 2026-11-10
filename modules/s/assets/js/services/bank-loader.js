/* ============================================================================
 * bank-loader.js — 服务层 / 题库与试卷单按需加载器（2026-10-27）
 * ----------------------------------------------------------------------------
 * 用户需求: "学习园地的数据库要分类分页分月, 不要全部都在一个文件"
 *
 * 改造前: 试卷中心/针对辅导 两页一次性 <script> 引入 18 个题库 + 3 个卷单
 *         ≈ 21.6MB, 首屏全部下载执行。
 * 改造后:
 *   - 题库(题目内容, 学科-年级 18 片) → 开卷时才按需注入对应 1 片(~0.3-2MB);
 *   - 试卷单(卷目录, papers.js/papers-py.js 常驻 + papers-ext 按年级 6 片)
 *     → 初始只载当前年级片, 切年级时补载;
 *   - 针对辅导推荐算法需要全量卷单/题库 → loadAllBanksSlow() 后台渐进
 *     (并发 2 依次注入, 不阻塞首屏渲染)。
 * 所有加载 Promise 去重; 文件为 IIFE 同步注册到 App.DATA, onload 即生效。
 * ========================================================================== */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  App.Bank = App.Bank || {};

  var _cache = {};        // url → Promise<void>
  var _paperGrades = {};  // 年级 → true (ext 片已加载)

  function loadScript(src) {
    if (_cache[src]) return _cache[src];
    _cache[src] = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { delete _cache[src]; reject(new Error("加载失败: " + src)); };
      document.head.appendChild(s);
    });
    return _cache[src];
  }

  /* 题库(题目内容): exam/{subj}-g{N}.js → App.DATA.exam["{subj}-{N}"] */
  function loadBank(subj, g) {
    var key = subj + "-" + g;
    if (App.DATA && App.DATA.exam && App.DATA.exam[key]) return Promise.resolve();
    return loadScript("assets/js/data/exam/" + subj + "-g" + g + ".js");
  }

  /* 试卷单: 基础卷(1080) + 拼音卷(150) 常驻一次; 扩展卷按年级片(每片≈2000套) */
  function loadPapers(g) {
    var ps = [loadScript("assets/js/data/exam/papers.js"), loadScript("assets/js/data/exam/papers-py.js")];
    if (g) {
      ps.push(loadScript("assets/js/data/exam/papers-ext-g" + g + ".js").then(function () { _paperGrades[g] = true; }));
    }
    return Promise.all(ps);
  }
  function papersGradesLoaded() { return Object.keys(_paperGrades).map(Number); }

  /* 开卷前确保: 该卷的题库 + 该卷年级的卷单(卷单其实列表渲染时已载, 这里兜底) */
  function ensurePaper(p) {
    if (!p) return Promise.resolve();
    return Promise.all([loadBank(p.s, p.g), loadPapers(p.g)]);
  }

  /* 后台渐进加载全部题库(针对辅导推荐用): 并发 2, 全部完成后 resolve */
  function loadAllBanksSlow() {
    var jobs = [], subj, g;
    var subjects = ["chinese", "math", "english"];
    for (g = 1; g <= 6; g++) { for (var i = 0; i < subjects.length; i++) { subj = subjects[i]; jobs.push([subj, g]); } }
    var cursor = 0, results = [];
    return new Promise(function (resolve) {
      function next() {
        if (cursor >= jobs.length) { resolve(results); return; }
        var batch = jobs.slice(cursor, cursor + 2);
        cursor += 2;
        Promise.all(batch.map(function (j) { return loadBank(j[0], j[1]).catch(function () { }); }))
          .then(function (r) { results = results.concat(r); setTimeout(next, 60); });
      }
      next();
    });
  }

  App.Bank = {
    loadBank: loadBank,
    loadPapers: loadPapers,
    papersGradesLoaded: papersGradesLoaded,
    ensurePaper: ensurePaper,
    loadAllBanksSlow: loadAllBanksSlow,
    loadScript: loadScript
  };
})(window);
