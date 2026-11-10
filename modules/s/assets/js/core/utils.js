/*
 * utils.js — 基础层 / 通用工具
 * 提供：DOM 选择、随机数、洗牌、转义、彩带、分数控制等。
 * 注意：禁止使用 ?? 与 ?. ，全部用传统写法以保证老内核兼容。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});

  function $(id) { return document.getElementById(id); }
  function qs(sel, root) { return (root || document).querySelector(sel); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  // 闭区间随机整数 [x, y]
  function R(x, y) { return Math.floor(Math.random() * (y - x + 1)) + x; }
  // 从数组随机取一个
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  // 洗牌（返回新数组，不修改原数组）
  function shuffled(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  // 去重随机不放回：从 pool 中取 n 个
  function sample(pool, n) {
    var a = shuffled(pool);
    return a.slice(0, Math.min(n, a.length));
  }
  // 文本转义（防 XSS）
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // 把数字高亮为 <b>
  function hlNums(text) { return String(text).replace(/(\d+)/g, "<b>$1</b>"); }

  // 彩带特效：优先 canvas-confetti（开源库），并保留 emoji 彩带双通道
  function confetti(n, box) {
    n = n || 26;
    if (w.confetti) {
      try { w.confetti({ particleCount: Math.min(120, n * 2), spread: 75, origin: { x: 0.5, y: 0.62 }, disableForReducedMotion: true }); } catch (e) {}
    }
    var es = ["🎉", "⭐", "🌟", "✨", "🎊", "🎈", "💫", "🏅"];
    var root = box || document.body;
    for (var i = 0; i < n; i++) {
      (function (i) {
        var d = document.createElement("div");
        d.className = "confetti";
        d.textContent = es[Math.floor(Math.random() * es.length)];
        d.style.left = (Math.floor(Math.random() * 100)) + "vw";
        d.style.animationDuration = (1.6 + Math.random() * 1.6) + "s";
        d.style.animationDelay = (Math.random() * 0.5) + "s";
        root.appendChild(d);
        setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 3800);
      })(i);
    }
  }

  /* ---------- 题目判定：支持多正确答案（组词等：accept 数组里任一选项都对） ---------- */
  function isCorrect(q, i) {
    if (!q) return false;
    if (q.accept && q.opts) return q.accept.indexOf(q.opts[i]) >= 0;
    return i === q.ans;
  }
  function ansText(q) {
    if (!q) return "";
    if (q.accept && q.accept.length) return q.accept.join(" 或 ");
    return q.speakAns || (q.opts ? q.opts[q.ans] : "");
  }

  App.U = {
    $: $, qs: qs, qsa: qsa,
    R: R, pick: pick, shuffled: shuffled, sample: sample,
    esc: esc, hlNums: hlNums, confetti: confetti,
    isCorrect: isCorrect, ansText: ansText
  };
})(window);
