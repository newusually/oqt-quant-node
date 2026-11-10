/* ============================================================================
 * page-common.js —— 各模块页面共用：等待动画 + 全站自动播报
 *   用户要求：
 *     "打开http://127.0.0.1/modules/s/index.html 不自动播报 把自动朗读关闭按钮删除掉
 *      默认直接播报 无法关闭自动朗读功能"
 *     "为什么打开这个网站居然不播报 我要求全部播报 不仅是学习页面 okx a股 等
 *      给我播报最新行情和总结一下热门的行情等"
 *   → 本模块让 OKX / A股 / NQ / 学习乐园 四个页面一进来就播报最新行情摘要。
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------------- 等待动画（小人搬东西） ---------------- */
  var LOADER_HTML =
    '<div class="loader-box" id="ld-global">' +
      '<svg class="ld-worker" viewBox="0 0 150 150" aria-label="正在搬运数据的小人">' +
        '<ellipse cx="75" cy="138" rx="44" ry="7" fill="rgba(255,255,255,.06)"/>' +
        '<g class="carry"><rect class="box-item" x="52" y="30" width="46" height="32" rx="4"/>' +
        '<path d="M75 30 v32 M52 46 h46" stroke="rgba(255,255,255,.34)" stroke-width="2.4" fill="none"/></g>' +
        '<circle class="head" cx="68" cy="92" r="14"/>' +
        '<path d="M56 84 q12 -12 24 0" fill="#3d7bff"/>' +
        '<circle cx="63" cy="93" r="2.2" fill="#2b2118"/><circle cx="74" cy="93" r="2.2" fill="#2b2118"/>' +
        '<path d="M64 99 q5 4 10 0" stroke="#2b2118" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
        '<path class="body" d="M56 104 h24 a4 4 0 0 1 4 4 v26 a4 4 0 0 1 -4 4 h-24 a4 4 0 0 1 -4 -4 v-26 a4 4 0 0 1 4 -4z"/>' +
        '<path class="limb arm-l" d="M58 110 L48 92"/><path class="limb arm-r" d="M78 110 L88 92"/>' +
        '<path class="limb leg-l" d="M60 134 L54 146"/><path class="limb leg-r" d="M76 134 L82 146"/>' +
        '<rect class="box-item" x="104" y="122" width="26" height="18" rx="3" opacity=".55"/>' +
        '<rect class="box-item" x="16" y="130" width="20" height="12" rx="3" opacity=".38"/>' +
      '</svg>' +
      '<div class="ld-text">正在搬运最新行情数据…</div>' +
      '<div class="ld-dots"><i></i><i></i><i></i></div>' +
    '</div>';

  var shown = false;
  function showLoader(text) {
    if (shown || document.getElementById('ld-global')) return;
    shown = true;
    var d = document.createElement('div');
    d.innerHTML = LOADER_HTML;
    var el = d.firstChild;
    document.body.appendChild(el);
    if (text) { var t = el.querySelector('.ld-text'); if (t) t.textContent = text; }
  }
  function hideLoader() {
    var el = document.getElementById('ld-global');
    if (!el) return;
    el.classList.add('hide');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 500);
  }

  /* ---------------- 自动播报 ---------------- */
  function startBroadcast(opt) {
    opt = opt || {};
    if (!window.Announcer) return;
    window.Announcer.start({
      auto: true,
      interval: opt.interval || 240000,
      delay: opt.delay || 3200,
      onSummary: function (sm) { if (opt.onSummary) opt.onSummary(sm); hideLoader(); }
    });
  }

  window.PageCommon = {
    showLoader: showLoader,
    hideLoader: hideLoader,
    startBroadcast: startBroadcast
  };

  // 页面加载完（window.load）后自动隐藏
  window.addEventListener('load', function () { setTimeout(hideLoader, 1200); });
})();
