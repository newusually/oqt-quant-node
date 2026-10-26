/*
 * banks.js — 业务层 / 题库融合 · 变种 · 知识点追踪
 * 能力：
 *  1) 多 JSON 融合：读取 题库/manifest.json，把多份真题卷按 type 合并到题库池。
 *  2) 变种引擎：内置题库是“生成器”，每次抽题都重新随机 → 题目无限变种；
 *     应用题还能随机替换动植物图片（同品类互换），旧题秒变新题。
 *  3) 知识点(kp) + 讲解(teach)：每题携带，答错时弹出针对性讲解；并统计薄弱知识点，
 *     供“巩固练习”页面做针对性教学。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U;
  var TYPES = ["problems", "math", "chinese", "pinyin", "english"];

  // 内置源（注册时由内容模块传入）与 外部源（manifest 加载）
  var pools = {};
  TYPES.forEach(function (t) { pools[t] = []; });

  /* ---------- 薄弱知识点（localStorage 持久化，失败退回内存） ---------- */
  var weak = {};
  try { var s = w.localStorage.getItem("fg_weak"); if (s) weak = JSON.parse(s) || {}; } catch (e) {}
  function saveWeak() { try { w.localStorage.setItem("fg_weak", JSON.stringify(weak)); } catch (e) {} }
  function record(kp, ok) {
    if (!kp) return;
    if (ok) { if (weak[kp] > 0) { weak[kp]--; if (weak[kp] <= 0) delete weak[kp]; } }
    else { weak[kp] = (weak[kp] || 0) + 1; }
    saveWeak();
  }
  function weakList() {
    return Object.keys(weak).map(function (k) { return { kp: k, n: weak[k] }; })
                .sort(function (a, b) { return b.n - a.n; });
  }
  function clearWeak() { weak = {}; saveWeak(); }

  /* ---------- 注册题库源 ---------- */
  // source: { questions:[...] } 或 { gens:[{ gen:fn, weight:Number }] } 或单个 gen 函数
  function register(type, source) {
    if (TYPES.indexOf(type) < 0) return;
    if (!pools[type]) pools[type] = [];
    if (typeof source === "function") pools[type].push({ gens: [{ gen: source, weight: 1 }] });
    else if (source && source.gens) pools[type].push(source);
    else if (source && source.questions) pools[type].push(source);
  }

  /* ---------- 收集所有题目（调用生成器 + 合并静态题） ----------
   * rounds：生成器多跑几轮。生成器每次调用都重新随机，
   * 轮数越多变体越多，保证抽题不重复、每次都不一样。 */
  function collect(type, rounds) {
    var out = [], r = Math.max(1, rounds || 1);
    pools[type].forEach(function (src) {
      if (src.gens) {
        src.gens.forEach(function (g) {
          var n = g.weight || 1, k, i;
          for (k = 0; k < r; k++) {
            for (i = 0; i < n; i++) {
              try { var q = g.gen(); if (q) out.push(q); } catch (e) {}
            }
          }
        });
      } else if (src.questions) {
        src.questions.forEach(function (q) { out.push(q); });
      }
    });
    return out;
  }

  /* ---------- 变种：应用题随机替换同品类图片 ---------- */
  function mutateProblem(q) {
    if (!q || !q.kind) return q;
    var nq = JSON.parse(JSON.stringify(q));
    try {
      var cur = App.IMG.get(q.e);
      var cat = cur ? cur.cat : null;
      var alt = App.IMG.pick(cat);            // 同品类随机换一个动植物
      if (alt && alt.id !== q.e) nq.e = alt.id;
    } catch (e) {}
    return nq;
  }

  /* ---------- 抽题 ---------- */
  function draw(type, n, opt) {
    opt = opt || {};
    var all = collect(type);
    // 池子不够 n 题时，生成器多跑几轮凑变体（生成器每次调用都重新随机，不会重复）
    var guard2 = 0;
    while (all.length < n && guard2++ < 6) all = all.concat(collect(type, 4));
    // 可按知识点过滤（针对性巩固）
    if (opt.kps && opt.kps.length) {
      var f = all.filter(function (q) { return opt.kps.indexOf(q.kp) >= 0; });
      if (f.length) all = f;
    }
    var used = opt.exclude || {};
    var out = [], guard = 0;
    while (out.length < n && guard++ < n * 60 + 200) {
      if (!all.length) break;
      var q = all[U.R(0, all.length - 1)];
      var key = qKey(q);
      if (used[key]) continue;
      used[key] = true;
      // 变种：应用题每次抽都尝试换图
      if (q.kind && Math.random() < 0.7) q = mutateProblem(q);
      out.push(q);
    }
    return out;
  }
  function qKey(q) {
    if (q.kind) return "p:" + q.kind + ":" + q.a + ":" + q.b + ":" + q.c + ":" + q.e + ":" + q.text;
    if (q.word) return "w:" + q.word;                                    // 拼写题
    if (q.say && q.opts) return "s:" + q.say;                            // 听力题
    if (q.text && q.opts) return "c:" + q.text + ":" + q.opts.join(","); // 完形填空
    if (q.q && q.opts) return "h:" + q.q + ":" + q.opts.join(",");       // 选择题
    if (q.tag && q.say) return "m:" + q.tag + ":" + q.say + ":" + (q.ans || "");
    return "x:" + (q.say || q.html || JSON.stringify(q));
  }

  /* ---------- 外部多 JSON 融合加载 ---------- */
  var externalLoaded = false;
  function loadExternal() {
    return new w.Promise(function (resolve) {
      if (externalLoaded) { resolve(true); return; }
      App.ajax(App.config.bankDir + "/manifest.json").then(function (man) {
        var list = (man && man.banks) || [];
        var jobs = list.map(function (b) {
          return App.ajax(App.config.bankDir + "/" + b.file).then(function (j) {
            var t = j.type || b.type;
            if (!t) return;
            var qs = j.questions || j["题目"] || j["试卷"] || [];
            if (qs && qs.length) {
              // 标注来源与默认知识点
              qs.forEach(function (q) { if (!q.kp) q.kp = q.tag || "综合"; if (!q.teach && q.eq) q.teach = "正确答案：" + q.eq; });
              register(t, { questions: qs });
            }
          }).catch(function () {});
        });
        // 顺序无关，全部尝试
        var done = 0;
        jobs.forEach(function (p) { p.then(function () { if (++done >= jobs.length) finish(); }); });
        if (!jobs.length) finish();
        function finish() { externalLoaded = true; resolve(true); }
      }).catch(function () { externalLoaded = true; resolve(false); });
    });
  }

  App.Banks = {
    register: register,
    collect: collect,
    draw: draw,
    mutateProblem: mutateProblem,
    loadExternal: loadExternal,
    record: record,
    weakList: weakList,
    clearWeak: clearWeak,
    qKey: qKey
  };
})(window);
