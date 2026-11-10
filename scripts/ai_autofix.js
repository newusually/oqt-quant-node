#!/usr/bin/env node
/* ai_autofix.js — 把 AI 报告 codeChanges 里的代码改动自动应用到代码文件（带护栏）。
 * 护栏：文件白名单(仅引擎层/脚本目录) → oldCode 必须在文件中唯一 → 先备份 → 替换 → node --check → 失败回滚。
 * 结果写回 ai_strategy.json 的 autoFix 字段（前端可见），needsRestart=true 表示引擎需重启生效。
 * 用法: node ai_autofix.js [ai_strategy.json 路径] */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT = process.argv[2] || path.join(__dirname, '..', 'data', 'ai_strategy.json');
const ROOT = path.join(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'data', 'ai_backups');

/* 只允许改引擎分层与脚本目录下的 .js 文件（相对 ROOT），禁止路径穿越/其它目录 */
const WHITELIST = [
  /^modules\/okx\/engines\/flowtrack\.layers\/[A-Za-z0-9._-]+\.js$/,
  /^scripts\/[A-Za-z0-9._-]+\.js$/
];
/* 永不触碰的文件 */
const DENY = [/01-config\.js$/];

function fail(msg) { console.error('[autofix] ' + msg); }

let j;
try { j = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { return fail('读取 ' + OUT + ' 失败: ' + e.message); }
const changes = Array.isArray(j.codeChanges) ? j.codeChanges : [];
const applicable = changes.filter(function (c) { return c && c.file && c.oldCode && c.newCode; });
if (!applicable.length) {
  j.autoFix = { ranAt: new Date().toISOString(), applied: 0, skipped: changes.length, results: [], needsRestart: false };
  console.log('[autofix] 无可自动应用的代码改动（codeChanges=' + changes.length + ' 条，均缺 file/oldCode/newCode）');
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(j, null, 2));
  fs.renameSync(tmp, OUT);
  process.exit(0);
}

const results = [];
let applied = 0;
for (const c of applicable) {
  const r = { title: (c.title || '').slice(0, 80), file: c.file, status: 'skipped', msg: '' };
  try {
    const rel = String(c.file).replace(/\\/g, '/');
    if (!WHITELIST.some(function (re) { return re.test(rel); })) {
      r.msg = '文件不在白名单'; results.push(r); continue;
    }
    if (DENY.some(function (re) { return re.test(rel); })) {
      r.msg = '配置层文件禁止自动修改'; results.push(r); continue;
    }
    const abs = path.join(ROOT, rel);
    if (!abs.startsWith(ROOT)) { r.msg = '路径穿越被拒绝'; results.push(r); continue; }
    if (!fs.existsSync(abs)) { r.msg = '文件不存在'; results.push(r); continue; }
    const src = fs.readFileSync(abs, 'utf8');
    const oldCode = String(c.oldCode);
    const cnt = src.split(oldCode).length - 1;
    if (cnt === 0) { r.msg = 'oldCode 在文件中不存在(代码可能已变化)'; results.push(r); continue; }
    if (cnt > 1) { r.msg = 'oldCode 在文件中出现 ' + cnt + ' 次，不唯一，拒绝盲替'; results.push(r); continue; }
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const d = new Date();
    const pad = function (n) { return (n < 10 ? '0' : '') + n; };
    const bakName = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '_' + path.basename(rel);
    const bakAbs = path.join(BACKUP_DIR, bakName);
    fs.writeFileSync(bakAbs, src);
    const patched = src.replace(oldCode, String(c.newCode));
    fs.writeFileSync(abs, patched);
    try {
      execFileSync('node', ['--check', abs], { stdio: 'pipe' });
      r.status = 'applied'; r.backup = 'data/ai_backups/' + bakName; r.msg = '已应用并通过语法校验';
      applied++;
      console.log('[autofix] 已应用: ' + rel + ' (' + (c.title || '') + ')，备份 ' + bakName);
    } catch (e) {
      fs.writeFileSync(abs, src); // 回滚
      r.status = 'rolledback'; r.msg = '语法校验失败已回滚: ' + String(e.stderr || e.message).slice(0, 200);
      console.error('[autofix] ' + rel + ' 语法校验失败，已回滚');
    }
  } catch (e) {
    r.msg = '异常: ' + e.message;
  }
  results.push(r);
}

j.autoFix = {
  ranAt: new Date().toISOString(),
  applied: applied,
  skipped: applicable.length - applied,
  results: results,
  needsRestart: applied > 0
};
const tmp = OUT + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(j, null, 2));
fs.renameSync(tmp, OUT);
console.log('[autofix] 完成: 应用 ' + applied + ' / 候选 ' + applicable.length +
  (applied > 0 ? ' · needsRestart=true（引擎重启后生效）' : ''));
