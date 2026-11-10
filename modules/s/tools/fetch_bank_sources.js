#!/usr/bin/env node
/* ============================================================================
 * modules/s/tools/fetch_bank_sources.js —— ★题库素材下载 + 清洗器（2026-10-26）
 * ----------------------------------------------------------------------------
 * 干什么的：把 GitHub 上的开源素材抓下来，按「小学生能看懂」的标准清洗一遍，
 *           产出 4 份干净素材，供 gen_exam_bank.js 出题。
 *
 * 为什么要洗：直接拿开源词库出题会出事——
 *   原生成器用词频取前 3500 字，"腺 / 犀 / 觑 / 侯" 这类字照样混进来；
 *   原英语素材是 WordNet 成人词典，"five-toed pachyderm"（五趾厚皮动物）
 *   这种释义拿给三年级小孩做，等于没出。
 *
 * 素材源（全部 GitHub 免费开源）：
 *   ① 常用字表   elephantnose/characters        3500常用汉字.txt
 *   ② 汉字拼音   babysbreath517/chinese-dictionary  char_base.json（含多音字）
 *   ③ 词语拼音   mozillazg/phrase-pinyin-data    pinyin_phrase.txt（搜狗拼音词库）
 *   ④ 成语       babysbreath517/chinese-dictionary  idiom.json（释义/出处）
 *   ⑤ 英语词典   skywind3000/ECDICT              ecdict.csv（含 小学zk / 初中gk 标签）
 *
 * 用法：node modules/s/tools/fetch_bank_sources.js [--src=/tmp] [--out=/tmp/bank_src]
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

function arg(k, dft) {
  const m = process.argv.slice(2).find(a => a.startsWith('--' + k + '='));
  return m ? m.split('=').slice(1).join('=') : dft;
}
const SRC = arg('src', '/tmp');
const OUT = arg('out', '/tmp/bank_src');
fs.mkdirSync(OUT, { recursive: true });

const RAW = {
  'common.txt': 'https://raw.githubusercontent.com/elephantnose/characters/master/3500%E5%B8%B8%E7%94%A8%E6%B1%89%E5%AD%97.txt',
  'char_base.json': 'https://raw.githubusercontent.com/babysbreath517/chinese-dictionary/master/character/char_base.json',
  'pinyin_phrase.txt': 'https://raw.githubusercontent.com/mozillazg/phrase-pinyin-data/master/pinyin.txt',
  'idiom_xinhua.json': 'https://raw.githubusercontent.com/babysbreath517/chinese-dictionary/master/idiom/idiom.json',
  'ecdict.csv': 'https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv'
};

/* ---------------- 下载（已存在且非空则跳过） ---------------- */
function download() {
  console.log('[1/4] 检查/下载素材…');
  Object.keys(RAW).forEach(function (f) {
    const p = path.join(SRC, f);
    if (fs.existsSync(p) && fs.statSync(p).size > 1024) {
      console.log('  · ' + f + ' 已存在 ' + (fs.statSync(p).size / 1048576).toFixed(1) + 'MB，跳过');
      return;
    }
    process.stdout.write('  · 下载 ' + f + ' … ');
    const r = require('child_process').spawnSync('curl', ['-sL', '--max-time', '600', '-o', p, RAW[f]], { encoding: 'utf8' });
    if (fs.existsSync(p) && fs.statSync(p).size > 1024) {
      console.log('OK ' + (fs.statSync(p).size / 1048576).toFixed(1) + 'MB');
    } else {
      console.log('失败！' + (r.stderr || ''));
    }
  });
}

/* ---------------- 拼音语言学模型 ---------------- */
/* 声母表：zh/ch/sh 必须排在 z/c/s 前面，否则 "shi" 会被切成 s + hi */
const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's'];
/* 整体认读音节：直接记，不拼读 —— 小学语文一年级重点 */
const WHOLE = ['zhi', 'chi', 'shi', 'ri', 'zi', 'ci', 'si', 'yi', 'wu', 'yu', 'ye', 'yue', 'yuan', 'yin', 'yun', 'ying'];
/* 韵母分类（用于出前后鼻音、单复韵母题） */
const FIN_SIMPLE = ['a', 'o', 'e', 'i', 'u', 'ü', 'er'];                  // 单韵母
const FIN_COMPOUND = ['ai', 'ei', 'ui', 'ao', 'ou', 'iu', 'ie', 'üe'];     // 复韵母
const FIN_FRONT = ['an', 'en', 'in', 'un', 'ün'];                          // 前鼻韵母
const FIN_BACK = ['ang', 'eng', 'ing', 'ong'];                             // 后鼻韵母
const ALL_FINALS = [].concat(FIN_SIMPLE, FIN_COMPOUND, FIN_FRONT, FIN_BACK);
const TONE_CH = { a: 'ā á ǎ à', o: 'ō ó ǒ ò', e: 'ē é ě è', i: 'ī í ǐ ì', u: 'ū ú ǔ ù', 'ü': 'ǖ ǘ ǚ ǜ' };
const TONE_OFF = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ'.split('');
const NO_TONE = { 'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a', 'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e', 'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i', 'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o', 'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u', 'ǖ': 'ü', 'ǘ': 'ü', 'ǚ': 'ü', 'ǜ': 'ü' };
function stripTone(s) {
  return String(s || '').replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/g, c => NO_TONE[c] || c).toLowerCase();
}
/* 声调数字：1=一声 2=二声 3=三声 4=四声 0=轻声/无声调 */
function toneOf(syl) {
  const s = String(syl || '');
  for (let i = 0; i < s.length; i++) {
    const t = TONE_OFF.indexOf(s[i]);
    if (t >= 0) return (t % 4) + 1;
  }
  return 0;
}
/* 给无声调音节加声调：按 a>o>e>i>u>ü 的标调规则定位韵母里的主元音 */
function addTone(syl, tone) {
  const s = stripTone(syl);
  if (!tone) return s;
  const order = ['a', 'o', 'e', 'i', 'u', 'ü'];
  let idx = -1;
  for (const v of order) { idx = s.indexOf(v); if (idx >= 0) break; }
  if (idx < 0) return s;
  const v = s[idx];
  const four = (TONE_CH[v] || '').split(' ');
  if (four.length < 4) return s;
  return s.slice(0, idx) + four[tone - 1] + s.slice(idx + 1);
}
/* 音节 → 声母。y/w 是隔音字母，不是声母，yi/wu/yu 属零声母 */
function initialOf(syl) {
  const s = stripTone(syl);
  if (/^[yw]/.test(s) && WHOLE.indexOf(s) >= 0) return '';
  for (const k of INITIALS) if (s.indexOf(k) === 0) return k;
  return '';
}
/* 音节 → 韵母（无声调，保留 ü）。整体认读音节返回其"实际韵母" */
function finalOf(syl) {
  let s = stripTone(syl);
  const W2F = { zhi: 'i', chi: 'i', shi: 'i', ri: 'i', zi: 'i', ci: 'i', si: 'i', yi: 'i', wu: 'u', yu: 'ü', ye: 'ie', yue: 'üe', yuan: 'üan', yin: 'in', yun: 'ün', ying: 'ing' };
  if (W2F[s]) return W2F[s];
  const ini = initialOf(s);
  if (ini) s = s.slice(ini.length);
  if (s === 'üan') return 'üan';
  if (s === 'u' && /^[jqxy]/.test(ini)) return 'ü';
  return s;
}
/* 韵母归类：前鼻音 / 后鼻音 / 复韵母 / 单韵母 */
function finKind(fin) {
  const f = stripTone(fin);
  if (FIN_FRONT.indexOf(f) >= 0) return '前鼻音';
  if (FIN_BACK.indexOf(f) >= 0) return '后鼻音';
  if (FIN_COMPOUND.indexOf(f) >= 0) return '复韵母';
  if (FIN_SIMPLE.indexOf(f) >= 0) return '单韵母';
  return '';
}
/* 平舌音 / 翘舌音 */
function tongueKind(ini) {
  if (['z', 'c', 's'].indexOf(ini) >= 0) return '平舌音';
  if (['zh', 'ch', 'sh', 'r'].indexOf(ini) >= 0) return '翘舌音';
  return '';
}
/* 三拼音节：有介母 i/u/ü 且声母后跟两个及以上元音 */
function isTriphthong(syl) {
  const ini = initialOf(syl), fin = finalOf(syl);
  if (!ini || fin.length < 2) return false;
  return /^[iü]/.test(fin) || /^u[^ng]/.test(fin);
}
module.exports = { stripTone, toneOf, addTone, initialOf, finalOf, finKind, tongueKind, isTriphthong, INITIALS, WHOLE, ALL_FINALS };

/* ---------------- 清洗 ---------------- */
const CJK = /^[\u4e00-\u9fa5]+$/;
function readLines(p) {
  try { return fs.readFileSync(p, 'utf8').split(/\r?\n/); } catch (e) { return []; }
}
function readJson(p) {
  const txt = fs.readFileSync(p, 'utf8');
  try { return JSON.parse(txt); } catch (e) { /* 该文件是 JSONL（每行一个对象），逐行解析 */ }
  const out = [];
  txt.split(/\r?\n/).forEach(function (line) {
    const s = line.trim().replace(/,$/, '');
    if (!s || s === '[' || s === ']') return;
    try { out.push(JSON.parse(s)); } catch (e2) { /* 脏行跳过 */ }
  });
  return out.length ? out : null;
}
/* 简易 CSV 解析：正确处理 "引号内逗号" 与 "引号转义双写" */
function parseCSV(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function cleanCommonChars() {
  console.log('[2/4] 清洗常用字表…');
  const set = new Set();
  readLines(path.join(SRC, 'common.txt')).forEach(function (l) {
    const c = l.trim();
    if (c && CJK.test(c) && c.length === 1) set.add(c);
  });
  console.log('  常用字 ' + set.size + ' 个');
  return set;
}

function cleanChars(COMMON) {
  /* 分级：char_common.json 的 frequency 字段
   *   0=最常用(500字)  1=较常用(2000字)  2=次常用(1000字)
   * 小学出题只用 0/1 两级，2 级（如"赡""婿"）留给初中，避免出超纲字 */
  const cc = readJson(path.join(SRC, 'char_common.json')) || [];
  const freq = {};
  cc.forEach(function (x) { if (x.char) freq[x.char] = (typeof x.frequency === 'number' ? x.frequency : 2); });
  const cb = readJson(path.join(SRC, 'char_base.json')) || [];
  const map = {};
  cb.forEach(function (x) {
    const c = x.char;
    if (!c || c.length !== 1 || !COMMON.has(c)) return;
    const pys = (x.pinyin || []).map(function (p) { return String(p).trim(); }).filter(Boolean);
    if (!pys.length) return;
    map[c] = pys;
  });
  const out = Object.keys(map).map(function (c) { return { c: c, py: map[c], f: (freq[c] === undefined ? 2 : freq[c]) }; });
  console.log('  汉字拼音 ' + out.length + ' 条（含多音字；小学级 ' +
    out.filter(function (x) { return x.f <= 1; }).length + ' 个）');
  return out;
}

function cleanWords(COMMON) {
  console.log('[3/4] 清洗词语（搜狗拼音词库）…');
  const seen = new Set(), out = [];
  readLines(path.join(SRC, 'pinyin_phrase.txt')).forEach(function (line) {
    const m = line.match(/^([^#\s:]+):\s*([a-zA-ZüÜāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ\s]+)/);
    if (!m) return;
    const w = m[1], py = m[2].trim();
    if (!CJK.test(w) || w.length < 2 || w.length > 3) return;
    if (seen.has(w)) return;
    let ok = true;
    for (const ch of w) if (!COMMON.has(ch)) { ok = false; break; }
    if (!ok) return;
    const syls = py.split(/\s+/).filter(Boolean);
    if (syls.length !== w.length) return;   // 拼音音节数与字数对不上，直接丢（含儿化音等）
    seen.add(w);
    out.push({ w: w, py: py, syls: syls });
  });
  console.log('  词语 ' + out.length + ' 条（全部由 3500 常用字组成）');
  return out;
}

function cleanIdioms(COMMON) {
  const ij = readJson(path.join(SRC, 'idiom.json')) || [];
  const seen = new Set(), out = [];
  ij.forEach(function (x) {
    const w = x.word || '';
    const ex = String(x.explanation || '').replace(/\s+/g, '');
    if (w.length !== 4 || !CJK.test(w) || seen.has(w)) return;
    let ok = true;
    for (const ch of w) if (!COMMON.has(ch)) { ok = false; break; }
    if (!ok) return;
    const py = String(x.pinyin || '').trim();
    if (py && py.replace(/[^\s]/g, '').length !== 3) return;   // 拼音不是 4 个音节，丢
    if (ex.length < 5 || ex.length > 40) return;
    if (/[（(][^）)]*[）)]/.test(ex)) return;                     // 释义里带括号说明的太绕
    seen.add(w);
    out.push({ w: w, py: py, ex: ex });
  });
  console.log('  成语 ' + out.length + ' 条');
  return out;
}

/* 英语：ECDICT 的 tag 字段带考试标签，zk=小学 gk=初中 ck=高中 */
function cleanEnglish() {
  console.log('[4/4] 清洗英语词汇（ECDICT · 小学/初中）…');
  const lines = readLines(path.join(SRC, 'ecdict.csv'));
  const out = [], wmap = {};
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = parseCSV(lines[i]);
    const w = String(f[0] || '').toLowerCase().trim();
    const tag = String(f[7] || '');
    if (!/^[a-z][a-z'&-]{0,11}$/.test(w)) continue;
    if (tag.indexOf('zk') < 0 && tag.indexOf('gk') < 0) continue;   // 只留小学/初中
    if (w.length < 2) continue;
    /* 中文释义：丢掉 [经][计] 这类专业标签行，只留第一条主释义 */
    let cn = String(f[3] || '').replace(/\r/g, '');
    cn = cn.split('\n').filter(function (s) { return s.trim() && !/^\[[^\]]+\]/.test(s.trim()); })[0] || '';
    cn = cn.replace(/^[a-z]+\.\s*/i, '').replace(/[；;].*$/, '').trim();
    /* 只留前两个义项：n. 能力, 才干 → 能力、才干（义项太多小孩读不完） */
    const cnItems = cn.split(/[，,]/).map(function (x) { return x.trim(); }).filter(Boolean);
    cn = cnItems.slice(0, 2).join('、');
    if (cn.length > 20) cn = cnItems[0] || '';
    if (!cn || cn.length > 20) continue;
    /* 白名单必须包含「、」——多义项正是用它连接的，漏掉会把多义词全砍光 */
    if (/[^\u4e00-\u9fa5a-zA-Z·\-\s.、]/.test(cn)) continue;         // 只留干净的中英文释义
    /* 英文释义：取第一条，砍长句 */
    let en = String(f[2] || '').split('\n')[0].replace(/^[a-z]+\.\s*/i, '').trim();
    if (en.length > 60) en = en.slice(0, 57).replace(/\s+\S*$/, '') + '…';
    if (!en || en.length < 6) en = '';
    /* 同义/反义：来自 exchange 字段的 s:/a: 前缀 */
    const ex = String(f[10] || '');
    const grab = function (tagc) {
      const m = ex.match(new RegExp('(?:^|/)' + tagc + ':([^/]+)'));
      return m ? m[1].split('|').map(function (x) { return x.trim().toLowerCase(); }).filter(function (x) { return /^[a-z][a-z'\-]{1,11}$/.test(x); }).slice(0, 3) : [];
    };
    const rec = {
      w: w,
      ph: String(f[1] || '').trim(),
      cn: cn,
      en: en,
      syn: grab('s'),
      ant: grab('a'),
      lv: tag.indexOf('zk') >= 0 ? '小学' : '初中',
      frq: parseInt(f[9] || '0', 10) || 99999
    };
    wmap[w] = rec;
    out.push(rec);
  }
  /* 同义/反义必须是"小学/初中已经认识的词"，否则等于用生词解释生词 */
  out.forEach(function (r) {
    r.syn = r.syn.filter(function (x) { return x !== r.w && wmap[x]; });
    r.ant = r.ant.filter(function (x) { return x !== r.w && wmap[x]; });
  });
  out.sort(function (a, b) { return a.frq - b.frq; });
  console.log('  英语词汇 ' + out.length + ' 条（小学 ' + out.filter(function (x) { return x.lv === '小学'; }).length + ' / 初中 ' + out.filter(function (x) { return x.lv === '初中'; }).length + '）');
  return out;
}

/* ---------------- 主流程 ---------------- */
if (require.main === module) {
  download();
  const COMMON = cleanCommonChars();
  fs.writeFileSync(path.join(OUT, 'chars.json'), JSON.stringify(cleanChars(COMMON)));
  fs.writeFileSync(path.join(OUT, 'words.json'), JSON.stringify(cleanWords(COMMON)));
  fs.writeFileSync(path.join(OUT, 'idioms.json'), JSON.stringify(cleanIdioms(COMMON)));
  fs.writeFileSync(path.join(OUT, 'en.json'), JSON.stringify(cleanEnglish()));
  console.log('[完成] 素材已写入 ' + OUT);
}
