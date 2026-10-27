#!/usr/bin/env node
/* ============================================================================
 * tools/gen_pinyin_syl.js —— ★重建「拼音音节 → 同音汉字」朗读表（2026-10-26）
 * ----------------------------------------------------------------------------
 * 问题：原 pinyin-data.js 的 SYL 表存在大量【声调错位/音节不匹配】
 *   （实测 539 处，如 bei 的二声位放“北(běi)”、三声位放“百(bǎi)”），
 *   TTS 按字发音 → 读出来的声调就是错的（用户反馈“拼音读音不准”）。
 *
 * 做法：用 mozillazg/pinyin-data（单字带调拼音）+ 词语库字频（常用度）自动重建：
 *   每个音节 × 每个声调 → 选【最常用且拼音完全匹配】的汉字；
 *   某声调确实没有常用字 → 沿用该音节其它声调的常用字（而不是拿别的音节凑）。
 *
 * 用法：node tools/gen_pinyin_syl.js --src=/tmp --apply
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = ROOT + '/modules/s/assets/js/services/pinyin-data.js';
function arg(k) { const m = process.argv.slice(2).find(a => a.startsWith('--' + k)); return !!m; }
const SRC = (process.argv.slice(2).find(a => a.startsWith('--src=')) || '--src=/tmp').split('=')[1] || '/tmp';

const TONELESS = { '\u0101': 'a', '\u00e1': 'a', '\u01ce': 'a', '\u00e0': 'a', '\u0113': 'e', '\u00e9': 'e', '\u011b': 'e', '\u00e8': 'e', '\u012b': 'i', '\u00ed': 'i', '\u01d0': 'i', '\u00ec': 'i', '\u014d': 'o', '\u00f3': 'o', '\u01d2': 'o', '\u00f2': 'o', '\u016b': 'u', '\u00fa': 'u', '\u01d4': 'u', '\u00f9': 'u', '\u01d6': 'v', '\u01d8': 'v', '\u01da': 'v', '\u01dc': 'v' };
const TONE_ORDER = '\u0101\u00e1\u01ce\u00e0\u0113\u00e9\u011b\u00e8\u012b\u00ed\u01d0\u00ec\u014d\u00f3\u01d2\u00f2\u016b\u00fa\u01d4\u00f9\u01d6\u01d8\u01da\u01dc';
function strip(s) { return String(s).replace(/[\u0101\u00e1\u01ce\u00e0\u0113\u00e9\u011b\u00e8\u012b\u00ed\u01d0\u00ec\u014d\u00f3\u01d2\u00f2\u016b\u00fa\u01d4\u00f9\u01d6\u01d8\u01da\u01dc]/g, c => TONELESS[c] || c).replace(/\u00fc/g, 'v'); }
function toneOf(s) { for (const ch of String(s)) { const i = TONE_ORDER.indexOf(ch); if (i >= 0) return i % 4 + 1; } return 0; }

/* 单字 → 带调拼音 */
const charPy = new Map();
fs.readFileSync(SRC + '/pinyin_char.txt', 'utf8').split(/\r?\n/).forEach(function (line) {
  const m = line.match(/^U\+([0-9A-Fa-f]+):\s*(\S+)/);
  if (!m) return;
  const c = parseInt(m[1], 16);
  if (c >= 0x4e00 && c <= 0x9fa5) charPy.set(String.fromCharCode(c), m[2].split(','));
});

/* 常用度（词语库字频） */
const FREQ = new Map();
fs.readFileSync(SRC + '/pinyin_phrase.txt', 'utf8').split(/\r?\n/).forEach(function (line) {
  const m = line.match(/^([^#\s:]+):/);
  if (!m) return;
  for (const ch of m[1]) FREQ.set(ch, (FREQ.get(ch) || 0) + 1);
});
const COMMON = new Set(Array.from(FREQ.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3500).map(x => x[0]));
console.log('[素材] 单字 ' + charPy.size + ' · 常用字 ' + COMMON.size);

/* (音节|声调) → 候选字（按常用度降序） */
const byKey = new Map();
charPy.forEach(function (pys, ch) {
  /* ★常用字优先（f=字频）；非常用字兜底（f=-1，排在最后）——
   *   保证 TTS 读得准，同时 eng→鞥 这类没有常用字的音节仍有字可读 */
  const f = COMMON.has(ch) ? (FREQ.get(ch) || 0) : -1;
  /* ★只取【主要读音】（字典第一个）：多音字的罕见音会污染表，
   *   例如“棍”有罕见读音 āo，字频又比“凹”高 → 一声就被选成“棍”。 */
  const p = pys[0];
  const t = toneOf(p); if (!t) return;
  const s = strip(p);
  const k = s + '|' + t;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push({ ch: ch, f: f });
});
byKey.forEach(function (arr) { arr.sort(function (a, b) { return b.f - a.f; }); });

/* 音节清单：沿用原表的 key（保证覆盖）+ 常用音节 */
const srcTxt = fs.readFileSync(TARGET, 'utf8');
const iS = srcTxt.indexOf('SYL:'), iN = srcTxt.indexOf('NEU:');
const sylSrc = srcTxt.slice(iS, iN > iS ? iN : undefined);
const keys = [];
let m;
const re = /([a-z\u00fc]{1,6}):\s*"([^"]+)"/g;
while ((m = re.exec(sylSrc))) keys.push(m[1]);
console.log('[原表] 音节 ' + keys.length + ' 个');

const NEW = {};
let fixed = 0, dropped = 0;
keys.forEach(function (syl) {
  const s = strip(syl);
  let out = '', any = false;
  for (let t = 1; t <= 4; t++) {
    const c = byKey.get(s + '|' + t);
    if (c && c.length) { out += c[0].ch; any = true; continue; }
    /* 该声调没有常用字 → 用本音节其它声调的常用字（按 1 声优先） */
    let fb = null;
    for (const t2 of [1, 2, 3, 4]) { const c2 = byKey.get(s + '|' + t2); if (c2 && c2.length) { fb = c2[0].ch; break; } }
    out += fb || '';
  }
  if (!any || out.length !== 4) { dropped++; return; }
  NEW[syl] = out;
});
console.log('[重建] 生成 ' + Object.keys(NEW).length + ' 个音节 · 丢弃(无常用字) ' + dropped);

/* 输出 JS 片段（按声母分组排版，保持原文件可读性） */
const GROUPS = [
  ['零声母 / y / w', ['a', 'o', 'e', 'ai', 'ei', 'ao', 'ou', 'an', 'en', 'ang', 'eng', 'er', 'yi', 'ya', 'ye', 'yao', 'you', 'yan', 'yin', 'yang', 'ying', 'yong', 'wu', 'wa', 'wo', 'wai', 'wei', 'wan', 'wen', 'wang', 'weng', 'yu', 'yue', 'yuan', 'yun']],
  ['b', null], ['p', null], ['m', null], ['f', null], ['d', null], ['t', null],
  ['n', null], ['l', null], ['g', null], ['k', null], ['h', null],
  ['j', null], ['q', null], ['x', null], ['zh', null], ['ch', null], ['sh', null], ['r', null],
  ['z', null], ['c', null], ['s', null]
];
let body = '';
const used = new Set();
GROUPS.forEach(function (g) {
  const list = g[1] ? g[1].filter(function (k) { return NEW[k]; })
    : Object.keys(NEW).filter(function (k) { return k.indexOf(g[0]) === 0 && !used.has(k); });
  if (!list.length) return;
  body += '      // ' + g[0] + '\n      ';
  body += list.map(function (k) { used.add(k); return k + ': "' + NEW[k] + '"'; }).join(', ') + ',\n';
});
const rest = Object.keys(NEW).filter(function (k) { return !used.has(k); });
if (rest.length) { body += '      // 其它\n      ' + rest.map(function (k) { return k + ': "' + NEW[k] + '"'; }).join(', ') + ',\n'; }

/* 写回：只替换 SYL:{...} 内部 */
const start = srcTxt.indexOf('{', iS) + 1;
const end = srcTxt.lastIndexOf('}', iN > iS ? iN : srcTxt.length);
const outTxt = srcTxt.slice(0, start) + '\n' + body + '    ' + srcTxt.slice(end);
if (arg('apply')) {
  fs.copyFileSync(TARGET, TARGET + '.bak');
  fs.writeFileSync(TARGET, outTxt, 'utf8');
  console.log('[已写入] ' + TARGET + '（原文件备份为 .bak）');
} else {
  console.log('[预览] 未写入，加 --apply 生效。前 12 行：');
  console.log(body.split('\n').slice(0, 12).join('\n'));
}