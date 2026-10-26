/*
 * compat.js — 基础层 / 兼容层
 * 目标：让页面在微信/QQ/钉钉 X5 内核（约 Chromium 57-66）及更老的浏览器也能运行。
 * 规则：本文件及全部脚本禁止使用 ?? 与 ?. （ES2020，老内核不支持）。
 *       不使用 ES Module（file:// 下无法加载），全部走 window 全局。
 */
(function (w) {
  "use strict";

  /* ---------- 1. Promise / fetch（极老浏览器回退） ---------- */
  if (!w.Promise) {
    try {
      // 极简 Promise 垫片（够用即可：用于异步流程）
      w.Promise = function (fn) {
        var self = this, done = [], faild = [];
        function resolve(v) { self._v = v; done.forEach(function (f) { f(v); }); }
        function reject(v) { self._e = v; faild.forEach(function (f) { f(v); }); }
        this.then = function (f) { done.push(f); return this; };
        this.catch = function (f) { faild.push(f); return this; };
        fn(resolve, reject);
      };
    } catch (e) {}
  }

  if (!w.fetch) {
    // 用 XHR 实现最小 fetch（支持 GET / text / json）
    w.fetch = function (url) {
      return new w.Promise(function (resolve, reject) {
        var xhr = new w.XMLHttpRequest();
        xhr.open("GET", url, true);
        xhr.onreadystatechange = function () {
          if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 400) {
              resolve({ ok: true, status: xhr.status, text: function () { return xhr.responseText; }, json: function () { return JSON.parse(xhr.responseText); } });
            } else {
              reject(new Error("fetch fail " + xhr.status));
            }
          }
        };
        xhr.onerror = function () { reject(new Error("fetch error")); };
        try { xhr.send(); } catch (e) { reject(e); }
      });
    };
  }

  /* ---------- 2. Array / String / Object 垫片 ---------- */
  if (!Array.prototype.includes) {
    Array.prototype.includes = function (v) {
      for (var i = 0; i < this.length; i++) { if (this[i] === v) return true; }
      return false;
    };
  }
  if (!Array.prototype.find) {
    Array.prototype.find = function (f) {
      for (var i = 0; i < this.length; i++) { if (f(this[i], i, this)) return this[i]; }
      return undefined;
    };
  }
  if (!Array.prototype.findIndex) {
    Array.prototype.findIndex = function (f) {
      for (var i = 0; i < this.length; i++) { if (f(this[i], i, this)) return i; }
      return -1;
    };
  }
  if (!String.prototype.includes) {
    String.prototype.includes = function (s) { return this.indexOf(s) !== -1; };
  }
  if (!Object.assign) {
    Object.assign = function (t) {
      for (var i = 1; i < arguments.length; i++) {
        var s = arguments[i];
        if (s) { for (var k in s) { if (Object.prototype.hasOwnProperty.call(s, k)) t[k] = s[k]; } }
      }
      return t;
    };
  }
  if (!Object.keys) {
    Object.keys = function (o) {
      var r = []; for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) r.push(k); }
      return r;
    };
  }
  if (typeof w.Number.isNaN !== "function") {
    w.Number.isNaN = function (v) { return typeof v === "number" && v !== v; };
  }

  /* ---------- 3. DOM 垫片 ---------- */
  if (!Element.prototype.closest) {
    Element.prototype.closest = function (sel) {
      var el = this;
      while (el) { if (el.matches && el.matches(sel)) return el; el = el.parentNode; }
      return null;
    };
  }
  if (!Element.prototype.matches) {
    Element.prototype.matches = function (sel) {
      return (this.msMatchesSelector || this.webkitMatchesSelector || this.mozMatchesSelector || function () { return false; }).call(this, sel);
    };
  }

  /* ---------- 4. 浏览器能力检测（供后续降级判断） ---------- */
  var ua = w.navigator ? w.navigator.userAgent : "";
  var cap = {
    isOldWebKit: /MQQBrowser|TBS|MicroMessenger|QQ\/|DingTalk|UCBrowser|Quark/i.test(ua),
    isMobile: /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(ua),
    hasFetch: typeof w.fetch === "function",
    hasSpeech: "speechSynthesis" in w && "SpeechSynthesisUtterance" in w,
    hasAudio: !!(w.AudioContext || w.webkitAudioContext)
  };
  // 是否需要在 CSS 上做老内核修正（加 class）
  w.__COMPAT__ = cap;
  w.document.documentElement.className += (cap.isOldWebKit ? " x5 " : " ") + (cap.isMobile ? " mob " : "");

  /* ---------- 5. 全局 AJAX 助手（统一 fetch/XHR，带超时与回退） ---------- */
  w.App = w.App || {};
  w.App.ajax = function (url, type) {
    type = type || "json";
    return new w.Promise(function (resolve, reject) {
      var ok = function (txt) {
        try { resolve(type === "json" ? JSON.parse(txt) : txt); }
        catch (e) { reject(e); }
      };
      // 优先用 fetch；file:// 或老浏览器会失败，这里用 try/catch 包裹
      try {
        w.fetch(url).then(function (r) {
          if (r && r.ok) { (type === "json" ? r.json() : r.text()).then(ok).catch(reject); }
          else reject(new Error("not ok"));
        }).catch(function () { reject(new Error("fetch fail")); });
      } catch (e) { reject(e); }
    });
  };
})(window);
