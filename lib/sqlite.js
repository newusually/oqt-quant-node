// L3 lib · SQLite 封装（原 cpp/vendor/sqlite 1:1 转换）
// 优先使用 Node 22 内置 node:sqlite；不可用时退化为内存/JSON 透传（不影响行情接口）。
'use strict';
let Database = null;
try {
  // Node 22.5+ 实验模块
  Database = require('node:sqlite').DatabaseSync;
} catch (e) {
  Database = null;
}

function open(file) {
  if (!Database) return null;
  try {
    return new Database(file, { open: true, readonly: true, allowExtension: false });
  } catch (e) {
    return null;
  }
}

function query(db, sql, params = []) {
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    return stmt.all(...params);
  } catch (e) {
    return [];
  }
}

module.exports = { open, query, available: !!Database };
