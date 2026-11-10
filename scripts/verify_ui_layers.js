#!/usr/bin/env node
/* 从组合器源码解析真实请求 URL，逐个校验 9 层可达 + 拼接体可编译。
 * 避免「手工 curl 用了正确路径、浏览器却请求错误路径」这类漏检。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = process.env.UI_ORIGIN || 'http://127.0.0.1';
const src = fs.readFileSync(path.join(ROOT, 'web/js/ui/flowtrack.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
const base = (src.match(/var\s+BASE\s*=\s*'([^']+)'/) || [])[1];
const v = (src.match(/var\s+V\s*=\s*'([^']+)'/) || [])[1];
const block = (src.match(/var\s+LAYERS\s*=\s*\[([\s\S]*?)\]/) || [])[1] || '';
const layers = Array.from(block.matchAll(/'([^']+\.js)'/g), m => m[1]);
const build = (html.match(/__BUILD\s*=\s*'([^']+)'/) || [])[1];
const scriptV = (html.match(/flowtrack\.js\?v=([^'"\s]+)/) || [])[1];

if (!base || !v || layers.length < 9) {
  console.error('FAIL 组合器解析失败 base=' + base + ' v=' + v + ' layers=' + layers.length);
  process.exit(1);
}
if (build !== v || scriptV !== v) {
  console.error('FAIL 版本戳不一致 __BUILD=' + build + ' script?v=' + scriptV + ' 组合器V=' + v);
  process.exit(1);
}
console.log('BASE=' + base + '  V=' + v + '  layers=' + layers.length);

(async () => {
  let bad = 0;
  const parts = [];
  for (const f of layers) {
    const url = ORIGIN + base + f + '?v=' + v;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const t = await r.text();
      if (!r.ok || !t.trim()) { console.log('  FAIL ' + r.status + '  ' + url); bad++; continue; }
      console.log('  OK   ' + r.status + ' ' + String(t.length).padStart(6) + 'B  ' + f);
      parts.push(t);
    } catch (e) {
      console.log('  FAIL ' + e.message + '  ' + url); bad++;
    }
  }
  if (bad) { console.log('FAIL ' + bad + '/' + layers.length + ' 个层不可达'); process.exit(1); }
  try {
    new Function('global', parts.join('\n'));
    console.log('PASS ' + layers.length + '/' + layers.length + ' 层可达，拼接体编译成功');
  } catch (e) {
    console.log('FAIL 拼接体编译: ' + e.message);
    process.exit(1);
  }
})();
