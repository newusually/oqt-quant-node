/*
 * exam-engine.js — 服务层 / 试卷引擎
 * 1080 套试卷 + 74115 题（开源题库 bank.db）：取题、组卷、判分。
 * 题目按 学科/年级 分文件存放于 App.DATA.exam["{subject}-{grade}"]。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});

  var SUBJ_NAME = { chinese: "语文", math: "数学", english: "英语" };
  var SUBJ_ICON = { chinese: "📖", math: "🧮", english: "🔤" };
  var TYPE_NAME = {
    pinyin: "拼音专项", unit: "单元测试", mid: "期中复习", final: "期末冲刺", kp: "专项练习",
    review: "综合复习", hard: "提升挑战", wrong: "易错专练", speed: "限时挑战"
  };
  var TYPE_ICON = {
    unit: "📘", mid: "📗", final: "📕", kp: "🎯",
    review: "🔄", hard: "🚀", wrong: "⚠️", speed: "⏱️"
  };
  var QTYPE_NAME = {
    single: "单选题", multiple: "多选题", judge: "判断题", fill: "填空题",
    calculation: "计算题", sorting: "排序题", matching: "连线题",
    short_answer: "简答题", cloze: "完形填空", pinyin_word: "看拼音写词"
  };

  var bankCache = {};   // "chinese-1" -> {kps, byId}

  function bank(subject, grade) {
    var key = subject + "-" + grade;
    if (!bankCache[key]) {
      var d = App.DATA && App.DATA.exam && App.DATA.exam[key];
      /* ★2026-10-27 懒加载: 题库未加载时不再缓存 null —— 否则 App.Bank.loadBank
       *   注入题库后这里永远返回 null(旧值卡住)。未加载就返回 null 不缓存。 */
      if (!d) return null;
      var byId = {}, i;
      for (i = 0; i < d.qs.length; i++) { byId[d.qs[i].i] = d.qs[i]; }
      bankCache[key] = { kps: d.kps || {}, byId: byId, meta: d.meta };
    }
    return bankCache[key];
  }

  /* ---------- 试卷列表与筛选 ---------- */
  function allPapers() {
    var d = App.DATA && App.DATA.exam && App.DATA.exam.papers;
    return (d && d.papers) || [];
  }
  function list(opt) {
    opt = opt || {};
    var out = allPapers(), i, p;
    if (opt.grade) out = out.filter(function (p) { return p.g === opt.grade; });
    if (opt.subject) out = out.filter(function (p) { return p.s === opt.subject; });
    if (opt.type) out = out.filter(function (p) { return p.ty === opt.type; });
    if (opt.kw) {
      var kw = String(opt.kw).toLowerCase();
      out = out.filter(function (p) { return p.ti.toLowerCase().indexOf(kw) >= 0 || p.id.indexOf(kw) >= 0; });
    }
    // 默认把"已做过"的排前面? 不，按编号稳定排序
    return out;
  }
  function page(items, no, size) {
    size = size || 12;
    var total = Math.max(1, Math.ceil(items.length / size));
    no = Math.min(Math.max(1, no || 1), total);
    var start = (no - 1) * size;
    return { no: no, total: total, items: items.slice(start, start + size) };
  }
  function get(id) {
    var ps = allPapers(), i;
    for (i = 0; i < ps.length; i++) { if (ps[i].id === id) return ps[i]; }
    return null;
  }
  function stats() {
    var ps = allPapers();
    var byGrade = {}, bySubj = {}, byType = {}, i;
    for (i = 0; i < ps.length; i++) {
      byGrade[ps[i].g] = (byGrade[ps[i].g] || 0) + 1;
      bySubj[ps[i].s] = (bySubj[ps[i].s] || 0) + 1;
      byType[ps[i].ty] = (byType[ps[i].ty] || 0) + 1;
    }
    var qTotal = 0, k;
    for (k in App.DATA.exam) {
      if (k === "papers") continue;   // papers 是试卷库，不是题库
      if (App.DATA.exam[k] && App.DATA.exam[k].meta && App.DATA.exam[k].meta.total) qTotal += App.DATA.exam[k].meta.total;
    }
    return { papers: ps.length, questions: qTotal, byGrade: byGrade, bySubj: bySubj, byType: byType };
  }

  /* ---------- 取题：把试卷的题目 id 列表换成完整题目 ---------- */
  function loadQuestions(paper) {
    if (!paper) return [];
    var b = bank(paper.s, paper.g), out = [], i, q;
    if (!b) return [];
    for (i = 0; i < paper.qs.length; i++) {
      q = b.byId[paper.qs[i]];
      if (q) out.push(q);
    }
    return out;
  }

  /* ---------- 判分 ---------- */
  function norm(s) {
    return String((s === null || s === undefined) ? "" : s).replace(/\s+/g, "").replace(/[，。！？、；：""''（）]/g, "").toLowerCase();
  }
  function judge(q, ans) {
    // ans: 用户答案（索引 / 数组 / 字符串 / map）
    if ((ans === null || ans === undefined) || ans === "") return false;
    try {
      switch (q.t) {
        case "single":
        case "judge":
          if (ans === q.a) return true;                      // ans 本身就是下标/同值
          if (q.o && typeof q.a === "number") return q.o[q.a] === ans;   // a=下标, ans=内容
          if (q.o && typeof q.a === "string") return q.o.indexOf(q.a) === ans; // a=内容, ans=下标
          return false;
        case "multiple":
          if (!Array.isArray(ans) || !Array.isArray(q.a)) return false;
          if (ans.length !== q.a.length) return false;
          /* a 可能是下标数组或内容数组, 两种都收进集合再比对 */
          var s = {}, i;
          for (i = 0; i < q.a.length; i++) {
            s[q.a[i]] = 1;
            if (q.o && q.o[q.a[i]] !== undefined) s[q.o[q.a[i]]] = 1;
          }
          for (i = 0; i < ans.length; i++) { if (!s[ans[i]]) return false; }
          return true;
        case "fill":
        case "cloze":
          var acc = Array.isArray(q.a) ? q.a[0] : q.a;
          return norm(ans) === norm(String(acc).split("|")[0]) ||
                 String(acc).split("|").some(function (x) { return norm(ans) === norm(x); });
        case "calculation": {
          var x = parseFloat(String(ans).replace(/[^0-9.\-]/g, ""));
          var y = parseFloat(String(q.a).replace(/[^0-9.\-]/g, ""));
          if (isNaN(x) || isNaN(y)) return norm(ans) === norm(q.a);
          return Math.abs(x - y) < 1e-6;
        }
        case "sorting":
          if (!Array.isArray(ans) || !Array.isArray(q.a)) return false;
          if (ans.length !== q.a.length) return false;
          for (var j = 0; j < ans.length; j++) { if (ans[j] !== q.a[j]) return false; }
          return true;
        case "matching":
          if (!ans || typeof ans !== "object") return false;
          var keys = Object.keys(q.a), ok = true, hit = 0;
          for (var k2 = 0; k2 < keys.length; k2++) {
            if ((ans[keys[k2]] === null || ans[keys[k2]] === undefined)) { ok = false; continue; }
            if (ans[keys[k2]] === q.a[keys[k2]]) hit++;
            else ok = false;
          }
          return ok && hit === keys.length;
        case "pinyin_word": {
          var pw = Array.isArray(q.a) ? q.a[0] : q.a;
          return norm(ans) === norm(pw);
        }
        case "short_answer": {
          var ref = (q.a && q.a.keywords) || [];
          var na = norm(ans);
          if (!na) return false;
          for (var m = 0; m < ref.length; m++) {
            if (na.indexOf(norm(ref[m])) >= 0) return true;
          }
          return false;
        }
        default:
          return norm(ans) === norm(q.a);
      }
    } catch (e) { return false; }
  }

  /* ---------- 成绩记录 ---------- */
  function results() {
    if (!App.Store || !App.Store.state) return {};
    if (!App.Store.state.examResults) App.Store.state.examResults = {};
    return App.Store.state.examResults;
  }
  function saveResult(paperId, score, total) {
    if (!App.Store || !App.Store.state) return;
    if (!App.Store.state.examResults) App.Store.state.examResults = {};
    var old = App.Store.state.examResults[paperId];
    App.Store.state.examResults[paperId] = {
      score: score, total: total,
      best: old ? Math.max(old.best || 0, score) : score,
      times: (old ? old.times : 0) + 1,
      at: new Date().toISOString().slice(0, 10)
    };
    App.Store.save();
  }

  App.Exam = {
    SUBJ_NAME: SUBJ_NAME, SUBJ_ICON: SUBJ_ICON,
    TYPE_NAME: TYPE_NAME, TYPE_ICON: TYPE_ICON, QTYPE_NAME: QTYPE_NAME,
    bank: bank, list: list, page: page, get: get, stats: stats,
    loadQuestions: loadQuestions, judge: judge,
    results: results, saveResult: saveResult
  };
})(window);
