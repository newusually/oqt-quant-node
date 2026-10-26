/*
 * readq.js — 业务层 / 全站统一「读题」服务
 * 目标：不管哪个页面、哪个板块、中文还是英语，出题后一律
 *       ① 先念题目  ② 有选项就把选项也念出来  ③ 按顺序念，不互相掐断。
 * 用法：App.ReadQ.read(题目对象)      —— 中文题（含数学/语文/试卷）
 *       App.ReadQ.readEn(题目对象)    —— 英语题
 *       App.ReadQ.readText("题干", ["A","B"]) —— 手动拼
 * 说明：内部走 App.Speech.seq 顺序播报（云端/本机都会排队，绝不被下一句 cancel）。
 * 兼容：不用 ?? ?. 不用 await，纯 ES5。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var ABC = "ABCDEFGHIJ";

  function plain(s) {
    return String((s === null || s === undefined) ? "" : s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }
  function arr(v) { return Object.prototype.toString.call(v) === "[object Array]" ? v : null; }

  /* 算式转口语：3+2=5 → "3 加 2 等于 5"，否则会被读成"三加二等于五"里的符号读不出来 */
  var OPS = { "+": "加", "-": "减", "×": "乘", "*": "乘", "÷": "除以", "/": "除以" };
  function mathZh(s) {
    var t = String((s === null || s === undefined) ? "" : s);
    t = t.replace(/(\d)\s*([+\-*×÷\/])\s*(\d)/g, function (m, a, op, b) {
      return a + " " + (OPS[op] || op) + " " + b;
    });
    t = t.replace(/\s*=\s*/g, "等于");
    t = t.replace(/\s*\?\s*$/, "几？");
    return t.replace(/\s+/g, " ").trim();
  }

  /* ---------- 题干：各页面字段不统一，这里统一兜底 ---------- */
  function stem(q) {
    if (!q) return "";
    return plain(q.say || q.text || q.ti || q.s || q.q || q.title || q.stem || q.word || "");
  }

  /* ---------- 选项：返回 { kind, list } 或 null ---------- */
  function optsOf(q) {
    if (!q) return null;
    var ty = q.t || q.type || "";
    var o = q.o;
    // 试卷：连线题 q.o = { left, right }
    if (o && !arr(o) && arr(o.left) && o.left.length) {
      return { kind: "match", left: o.left, right: arr(o.right) || [] };
    }
    // 试卷：单选/多选/判断/排序，q.o 是纯数组
    if (arr(o) && o.length) {
      if (ty === "sorting") return { kind: "sort", list: o };
      if (ty === "single" || ty === "multiple" || ty === "judge") return { kind: "pick", list: o };
      // 其它题型（填空/计算/简答）q.o 不是选项，不念
      return null;
    }
    // 普通题卡：q.opts（可能打乱后存在 q.opts，原始在 q._raw.opts）
    var p = arr(q.opts) || (q._raw && arr(q._raw.opts));
    if (p && p.length) return { kind: "pick", list: p };
    var p2 = arr(q.options) || arr(q.choices);
    if (p2 && p2.length) return { kind: "pick", list: p2 };
    return null;
  }

  /* ---------- 把选项拼成一句能念的话 ---------- */
  function optText(o, isEn) {
    var i, out = "";
    if (!o) return "";
    if (o.kind === "pick") {
      out = isEn ? "Options: " : "选项是：";
      for (i = 0; i < o.list.length && i < ABC.length; i++) {
        out += ABC.charAt(i) + (isEn ? ", " : "，") + (isEn ? plain(o.list[i]) : mathZh(plain(o.list[i]))) + (isEn ? ". " : "。");
      }
      return out;
    }
    if (o.kind === "sort") {
      return (isEn ? "Put these in order: " : "请把这些按顺序排好：") +
        o.list.map(plain).join(isEn ? ", " : "，");
    }
    if (o.kind === "match") {
      return (isEn ? "Match the left with the right. Left: " : "请把左右两边连起来。左边有：") +
        o.left.map(plain).join(isEn ? ", " : "，") +
        (isEn ? ". Right: " : "。右边有：") + o.right.map(plain).join(isEn ? ", " : "，");
    }
    return "";
  }

  /* ---------- 是否允许自动朗读（尊重页面「自动朗读」开关） ---------- */
  function allowed() {
    if (!App.Store || !App.Store.state) return true;
    return !!App.Store.state.autoRead;
  }

  /* ---------- 主入口：念题 + 念选项 ---------- */
  function read(q, opt) {
    opt = opt || {};
    var S = App.Speech;
    if (!S || !q) return;
    if (!opt.force && !allowed()) return;
    var st = typeof q === "string" ? plain(q) : stem(q);
    var o = typeof q === "string" ? null : optsOf(q);
    var list = [];
    // 中文题把算式转成口语（3+2 → 3 加 2），英文题不处理
    if (st && !opt.en) st = mathZh(st);
    if (st) list.push({ t: st, en: !!opt.en });
    var ot = optText(o, !!opt.en);
    if (ot) list.push({ t: ot, en: !!opt.en });
    if (!list.length) return;
    S.seq(list);
  }
  // 英语题：题干和选项都用英文嗓音
  function readEn(q, opt) {
    opt = opt || {};
    opt.en = true;
    read(q, opt);
  }
  // 手动拼：题干 + 选项数组
  function readText(text, opts, opt) {
    opt = opt || {};
    var S = App.Speech;
    if (!S) return;
    if (!opt.force && !allowed()) return;
    var list = [], i;
    if (text) list.push({ t: plain(text), en: !!opt.en });
    if (arr(opts) && opts.length) {
      list.push({ t: optText({ kind: "pick", list: opts }, !!opt.en), en: !!opt.en });
    }
    if (list.length) S.seq(list);
  }

  App.ReadQ = {
    stem: stem,
    optsOf: optsOf,
    optText: optText,
    read: read,
    readEn: readEn,
    readText: readText
  };
})(window);
