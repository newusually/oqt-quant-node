/* speakfx.js — 教学特效引擎 (2026-10-27)
 * 1) 包装 Speech.speak/speakPinyin/speakEn: opt.el 传元素 → 朗读自动高亮+外框(读哪亮哪)
 * 2) App.FX.speakSentence(el, text, opt): 句子跟读, 逐字(中)/逐词(英) karaoke 高亮+划线
 * 3) App.FX.setAttention(mode): 注意力模式 calm/normal/focus(Store 持久化, 影响高亮强度与时长)
 * 4) 静态标注工具: ring 圈出 / box 框选 / underline 划线 / wavy 波浪 / circleNum 数字圈 / auxline 辅助线
 * 依赖: Speech(先加载), Store(可选), fx.css */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var S = App.Speech;
  if (!S) return;

  /* ---------- 注意力模式 ---------- */
  var DWELL = { calm: 1.5, normal: 1, focus: 0.85 };   /* 高亮驻留倍率 */
  var mode = "normal";
  try { if (App.Store && App.Store.state && App.Store.state.fxAt) mode = App.Store.state.fxAt; } catch (e) {}
  function applyBody() {
    if (!document.body) return;
    var cl = document.body.classList;
    ["fx-at-calm", "fx-at-normal", "fx-at-focus"].forEach(function (c) { cl.remove(c); });
    cl.add("fx-at-" + mode);
  }
  if (document.body) applyBody(); else document.addEventListener("DOMContentLoaded", applyBody);
  function setAttention(m) {
    if (!(m in DWELL)) return;
    mode = m; applyBody();
    try { if (App.Store) { App.Store.state.fxAt = m; App.Store.save && App.Store.save(); } } catch (e) {}
  }

  /* ---------- 包装 Speech: opt.el 自动高亮 ---------- */
  function wrap(fnName, isEn) {
    var orig = S[fnName];
    S[fnName] = function (text, opt) {
      opt = opt || {};
      if (opt.el && opt.el.classList && !opt.el.classList.contains("fx-speaking")) {
        var est = 1200;
        try { if (S.estimate) est = S.estimate(text, { en: isEn }); } catch (e) {}
        var dur = Math.max(600, est * (opt.rate ? 1 / opt.rate : 1)) * DWELL[mode];
        var el = opt.el;
        el.classList.add("fx-speaking");
        if (isEn) el.classList.add("fx-en");
        setTimeout(function () { el.classList.remove("fx-speaking", "fx-en"); }, dur + 350);
      }
      return orig.call(S, text, opt);
    };
  }
  wrap("speak", false); wrap("speakPinyin", false); wrap("speakEn", true);

  /* ---------- 句子跟读 karaoke ---------- */
  /* 把 el 内容拆成 .fx-w span(中文按字, 英文按词), 朗读并按时长比例逐个点亮 */
  function splitTokens(text, en) {
    var out = [], i, s = String(text);
    if (en) {
      out = s.split(/(\s+)/).filter(function (x) { return x.length; });
    } else {
      for (i = 0; i < s.length; i++) out.push(s[i]);
    }
    return out;
  }
  function speakSentence(el, text, opt) {
    opt = opt || {};
    if (!el || el.classList.contains("fx-kara")) { /* 正在读, 忽略重复点击 */ return; }
    var en = !!opt.en;
    var raw = el.textContent;
    if (text) raw = text;
    var toks = splitTokens(raw, en);
    /* 重建内容: 标点/空白保持原样但不参与高亮 */
    el.classList.add("fx-kara");
    var html = "", meta = [], t = 0;
    for (var i = 0; i < toks.length; i++) {
      var tok = toks[i];
      var speakable = /[\u4e00-\u9fa5a-zA-Z0-9]/.test(tok);
      if (speakable) {
        html += '<span class="fx-w" data-i="' + meta.length + '">' + tok.replace(/</g, "&lt;") + "</span>";
        meta.push({ el: null, w: Math.max(1, tok.replace(/\s/g, "").length), from: t });
        t += Math.max(1, tok.replace(/\s/g, "").length);
      } else {
        html += tok === " " ? " " : tok.replace(/</g, "&lt;");
      }
    }
    el.innerHTML = html;
    var spans = el.querySelectorAll(".fx-w");
    for (var j = 0; j < spans.length; j++) meta[+spans[j].getAttribute("data-i")].el = spans[j];
    /* 时长分配: 总时长按权重切片 */
    var est = 1600;
    try { if (S.estimate) est = S.estimate(raw, { en: en }); } catch (e) {}
    var total = Math.max(800, est * (opt.rate ? 1 / opt.rate : 1)) * DWELL[mode];
    /* 播放 */
    if (en) S.speakEn(raw, { rate: opt.rate || 0.85 }); else S.speak(raw, { rate: opt.rate });
    var acc = 0;
    for (var k = 0; k < meta.length; k++) {
      (function (m, delay, dur) {
        setTimeout(function () {
          if (m.el) m.el.classList.add("fx-on");
          if (opt.line !== false) m.el.classList.add("fx-underline");
        }, delay);
        setTimeout(function () {
          if (m.el) { m.el.classList.remove("fx-on"); }
        }, delay + dur);
      })(meta[k], total * (meta[k].from / t), total * (meta[k].w / t));
      acc += meta[k].w;
    }
    setTimeout(function () {
      el.classList.remove("fx-kara");
      /* 还原纯文本, 保持 DOM 干净 */
      el.textContent = raw;
    }, total + 500);
  }

  /* ---------- 静态标注工具 ---------- */
  function cls(el, c, on) { if (el && el.classList) el.classList[on === false ? "remove" : "add"](c); }
  function ring(el, ms) { cls(el, "fx-ring"); if (ms) setTimeout(function () { cls(el, "fx-ring", false); }, ms); return el; }
  function box(el, ms) { cls(el, "fx-box"); if (ms) setTimeout(function () { cls(el, "fx-box", false); }, ms); return el; }
  function underline(el, ms) { cls(el, "fx-underline"); if (ms) setTimeout(function () { cls(el, "fx-underline", false); }, ms); return el; }
  function wavy(el, ms) { cls(el, "fx-wavy"); if (ms) setTimeout(function () { cls(el, "fx-wavy", false); }, ms); return el; }
  function circleNum(el) { return ring(el); }
  /* auxline(container, segs): segs=[[x1,y1,x2,y2],...] 百分比坐标, 叠加 SVG 虚线辅助线 */
  function auxline(container, segs) {
    if (!container) return;
    var old = container.querySelector("svg.fx-aux-svg");
    if (old) old.remove();
    container.classList.add("fx-aux");
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "fx-aux-svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    (segs || []).forEach(function (s) {
      var l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l.setAttribute("x1", s[0]); l.setAttribute("y1", s[1]);
      l.setAttribute("x2", s[2]); l.setAttribute("y2", s[3]);
      svg.appendChild(l);
    });
    container.appendChild(svg);
    return svg;
  }

  App.FX = {
    setAttention: setAttention,
    attention: function () { return mode; },
    speakSentence: speakSentence,
    ring: ring, box: box, underline: underline, wavy: wavy,
    circleNum: circleNum, auxline: auxline
  };
})(window);
