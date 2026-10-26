// L2 core · 日志（原 cpp/core 日志工具 1:1 转换）
'use strict';
const fs = require('fs');
const path = require('path');
const LOG_DIR = path.join(__dirname, '..', 'data', 'logs');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}

function ts() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function line(level, args) {
  const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const out = `[${ts()}][${level}] ${msg}`;
  if (level === 'ERR') console.error(out); else console.log(out);
  try { fs.appendFileSync(path.join(LOG_DIR, 'node.log'), out + '\n'); } catch (e) {}
}
module.exports = {
  info: (...a) => line('INFO', a),
  warn: (...a) => line('WARN', a),
  err: (...a) => line('ERR', a),
  dbg: (...a) => line('DBG', a),
};
