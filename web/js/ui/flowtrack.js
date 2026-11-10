/* flowtrack.js — 总览面板分层组合器（浏览器端）
 * 业务代码位于 ./flowtrack_ui.layers/，10 层在同一函数作用域内拼接，
 * 与后端 modules/okx/engines/flowtrack.js 组合器保持同一套分层语义。
 * 每层 < 20KB；构建戳变更时只需改 V。 */
(function (global) {
  'use strict';
  var BASE = '/web/js/ui/flowtrack_ui.layers/';
  var V = '20261110q';
  var LAYERS = [
    '01-state.js', '02-css.js', '03-skeleton.js', '04-tables.js',
    '05-curve-core.js', '06-curve-bind.js', '07-load.js',
    '08-ai.js', '08b-ai-charts.js', '09-boot.js'
  ];
  function fail(e) {
    var box = global.document.getElementById('flowtrack-panel');
    if (box) box.innerHTML = '<div style="padding:16px;color:#ff6b6b">金字塔面板加载失败：' + String((e && e.message) || e) + '</div>';
    if (global.console) global.console.error('[ft-ui]', e);
  }
  Promise.all(LAYERS.map(function (f) {
    return global.fetch(BASE + f + '?v=' + V, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(f + ' HTTP ' + r.status);
      return r.text();
    });
  })).then(function (parts) {
    new Function('global', parts.join('\n'))(global);
  }).catch(fail);
})(window);
