// L3 lib · sqldump — 通用 .sql 文本转储解析器（一比一承接原 cpp/vendor/sqlite 的数据读取职责）
// 原项目的 database/*.sql 是 INSERT 语句文本转储（非二进制 SQLite），本模块纯 Node 解析为行数组。
// 带「文件路径 + mtime」缓存，避免重复解析；支持 maxRows 上限以控制超大文件内存。
'use strict';
const fs = require('fs');
const log = require('../core/log');

const cache = {}; // file -> { mtime, data }

// 解析 VALUES(...) 内部元组，正确处理单引号字符串('' 转义)、数字、NULL
function parseValues(s) {
  const out = [];
  let i = 0; const n = s.length;
  while (i < n) {
    while (i < n && (s[i] === ' ' || s[i] === ',')) i++;
    if (i >= n) break;
    if (s[i] === "'") {
      i++; let buf = '';
      while (i < n) {
        if (s[i] === "'") {
          if (s[i + 1] === "'") { buf += "'"; i += 2; continue; }
          i++; break;
        }
        buf += s[i]; i++;
      }
      out.push(buf);
    } else {
      let buf = '';
      while (i < n && s[i] !== ',') { buf += s[i]; i++; }
      buf = buf.trim();
      if (buf === '' || buf.toUpperCase() === 'NULL') out.push(null);
      else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(buf)) out.push(parseFloat(buf));
      else out.push(buf);
    }
  }
  return out;
}

const RE = /INSERT OR REPLACE INTO "([^"]+)" \(([^)]+)\) VALUES \(([^;]*)\);/g;

function parseFile(file, maxRows) {
  const txt = fs.readFileSync(file, 'utf8');
  const rows = [];
  let table = null, columns = null;
  let m;
  RE.lastIndex = 0;
  while ((m = RE.exec(txt))) {
    if (!table) {
      table = m[1];
      columns = m[2].split(',').map(x => x.trim().replace(/^"|"$/g, ''));
    }
    const vals = parseValues(m[3]);
    const obj = {};
    for (let i = 0; i < columns.length; i++) obj[columns[i]] = vals[i];
    rows.push(obj);
    if (maxRows && rows.length >= maxRows) break;
  }
  return { table, columns, rows };
}

// 加载转储（缓存）。maxRows 仅用于超大文件的内存保护。
function load(file, maxRows) {
  try {
    const st = fs.statSync(file);
    const hit = cache[file];
    if (hit && hit.mtime === st.mtimeMs && ((maxRows === null || maxRows === undefined) || hit.data.rows.length >= Math.min(maxRows, hit.data.rows.length))) {
      // 命中但可能受 maxRows 截断 —— 若请求无上限或已足够则返回
      if ((maxRows === null || maxRows === undefined) || hit.data.rows.length >= maxRows) return hit.data;
    }
    const data = parseFile(file, maxRows);
    cache[file] = { mtime: st.mtimeMs, data };
    return data;
  } catch (e) {
    log.warn('sqldump.load fail', file, String(e));
    return { table: null, columns: [], rows: [] };
  }
}

// 按时间列过滤（毫秒时间戳），fromMs/toMs 可空
function byTime(rows, col, fromMs, toMs) {
  if ((fromMs === null || fromMs === undefined) && (toMs === null || toMs === undefined)) return rows;
  return rows.filter(r => {
    const t = +r[col];
    if (isNaN(t)) return true;
    if ((fromMs !== null && fromMs !== undefined) && t < fromMs) return false;
    if ((toMs !== null && toMs !== undefined) && t > toMs) return false;
    return true;
  });
}

function lastN(rows, n) {
  if (!n || rows.length <= n) return rows;
  return rows.slice(rows.length - n);
}

// 毫秒时间戳 → {y,m,d,h,i,s,date} 便捷结构（北京时间展示由前端处理）
function tsInfo(ms) {
  const d = new Date(+ms);
  if (isNaN(d.getTime())) return null;
  return {
    ms: +ms,
    iso: d.toISOString(),
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    i: d.getUTCMinutes(),
  };
}

module.exports = { load, byTime, lastN, tsInfo, parseValues };
