/*
 * app.js — 应用层 / 启动器（Vue 挂载）
 * 每个 HTML 只写 <div id="app" data-view="xxx"></div>，由这里读取视图名并挂载对应 Vue 应用。
 * 视图文件统一把自己注册进 App.views，例如 App.views.abacus = { ... }。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});

  function boot() {
    var host = document.getElementById("app");
    if (!host) return;
    var name = host.getAttribute("data-view") || "";
    if (App.SEO) App.SEO.apply(name);   // 动态 SEO：补齐 meta / OG / JSON-LD
    var def = (App.views && App.views[name]) || null;
    var oldKernel = /old-kernel/.test(document.documentElement.className || "");
    if (!w.Vue) {
      host.innerHTML = "<div class='wrap'><div class='card'>" +
        (oldKernel
          ? "😢 当前浏览器内核太旧，跑不动 Vue 3 渲染引擎。请升级浏览器（推荐 Chrome / Edge / Safari 最新版），或用手机微信默认浏览器打开。"
          : "😢 页面「" + name + "」加载失败，请刷新重试。") +
        "</div></div>";
      return;
    }
    if (!def) {
      host.innerHTML = "<div class='wrap'><div class='card'>😢 页面「" + name + "」还没做好，先去别的小天地玩吧！</div></div>";
      return;
    }
    var app = w.Vue.createApp(def);
    if (App.Shell) app.component("site-shell", App.Shell);
    if (App.BraceBox) app.component("brace-box", App.BraceBox);
    app.config.errorHandler = function (err) {
      if (w.console && w.console.warn) w.console.warn("[view]", name, err && err.message);
    };
    app.mount(host);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})(window);
