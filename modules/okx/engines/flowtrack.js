'use strict';
/* flowtrack.js — 分层组合器（保持各层共享同一执行作用域）
 * 业务代码位于 ./flowtrack.layers/，按职责分为 11 层，每层 < 50KB。
 * __dirname 传入原引擎目录，保证数据库与 AI 策略文件相对路径不变。 */
const fs = require('fs');
const path = require('path');
const LAYER_DIR = path.join(__dirname, 'flowtrack.layers');
const LAYERS = [
  "01-config.js",
  "02-state.js",
  "03-db.js",
  "04-ws.js",
  "05-macd.js",
  "06-orderflow.js",
  "07-pyramid.js",
  "08-persist.js",
  "09-curve-ai.js",
  "10-query.js",
  "11-start.js"
];
let src = '';
for (const f of LAYERS) src += fs.readFileSync(path.join(LAYER_DIR, f), 'utf8') + '\n';
const _m = { exports: {} };
new Function('module', 'exports', 'require', '__dirname', '__filename', src)(
  _m, _m.exports, require, __dirname, __filename);
module.exports = _m.exports;
