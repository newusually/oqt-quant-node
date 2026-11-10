#!/usr/bin/env node
/* ============================================================================
 * modules/s/tools/gen_exam_bank.js —— ★万题题库生成器（2026-10-26 重写版）
 * ----------------------------------------------------------------------------
 * 用户需求："语文数学和英语 各科每个栏目的考试测试题目都差不多，要求更多更多种多样的
 *            题目才行，不要同一个问题问很多遍，给我搞个起码1万种考试测试题目，
 *            包括拼音测试等，不能总是一个字 一个词语，要多样性"
 *
 * 【本次重写修掉的硬伤】
 *   ① 声调题是错的：旧代码 stripTone 掉声调后又 four[R(0,3)] 随机挑一个声调当答案，
 *      "下面哪个是 tou 带声调的写法" 答案随机 → 等于教错。现已改为「用音节真实声调」。
 *   ② 生僻字漏网：旧代码用词频取前 3500 字当常用字，"腺/犀/觑/侯"照样出题。
 *      现改用权威《现代汉语常用字表》3500 字做白名单，字与词双重过滤。
 *   ③ 干扰项重复：韵母题出现过 ["ue","ing","ing","an"] 两个 ing 并列。现全局去重。
 *   ④ 英语释义成人化：旧素材是 WordNet，出过 "five-toed pachyderm"（五趾厚皮动物）
 *      拿给三年级小孩做。现改用 ECDICT，只取带「小学 zk / 初中 gk」标签的词，
 *      且释义取中文，题型做成中英互译。
 *   ⑤ 拼写题选项残缺："补全单词：elepha_t" 只有 2 个选项。现已保证 4 选 1。
 *
 * 【素材】由 fetch_bank_sources.js 从 GitHub 下载并清洗，落在 /tmp/bank_src：
 *   chars.json  常用字 3500（含多音字）    words.json  搜狗拼音词库 2.4 万条
 *   idioms.json 成语 2.2 万条（带释义）    en.json     ECDICT 小学/初中词汇
 *
 * 用法：node modules/s/tools/gen_exam_bank.js [--bank=/tmp/bank_src] [--total=10000]
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const PY = require('./fetch_bank_sources.js');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = ROOT + '/modules/s/题库';
const MANIFEST = OUT_DIR + '/manifest.json';

function arg(k, dft) {
  const m = process.argv.slice(2).find(a => a.startsWith('--' + k + '='));
  return m ? m.split('=').slice(1).join('=') : dft;
}
const BANK = arg('bank', '/tmp/bank_src');
const TOTAL = parseInt(arg('total', '10000'), 10) || 10000;

/* ---------------- 工具 ---------------- */
function R(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function pick(a) { return a && a.length ? a[Math.floor(Math.random() * a.length)] : null; }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
function uniq(a) { return Array.from(new Set(a.filter(x => x !== undefined && x !== null && String(x).length))); }
function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

/* ---------------- 素材 ---------------- */
console.log('[素材] 读取 ' + BANK);
const CHARS = readJson(BANK + '/chars.json') || [];   // [{c, py:[..]}]  py 可能多音
const WORDS = readJson(BANK + '/words.json') || [];   // [{w, py, syls}]
const IDIOMS = readJson(BANK + '/idioms.json') || []; // [{w, py, ex}]
const EN = readJson(BANK + '/en.json') || [];         // [{w, ph, cn, en, syn, ant, lv, frq}]
if (!CHARS.length || !WORDS.length) {
  console.error('[错误] 素材缺失，请先运行：node modules/s/tools/fetch_bank_sources.js');
  process.exit(1);
}

/* 字 → 全部读音 */
const CHAR_PY = {};
CHARS.forEach(function (x) { CHAR_PY[x.c] = x.py; });
/* 单字卡片：多音字取第一个（最常用音），f=分级 0最常用/1较常用/2次常用 */
const SINGLE = CHARS.map(function (x) { return { c: x.c, py: x.py[0], all: x.py, f: (x.f === undefined ? 2 : x.f) }; });
/* ★小学级字表：只取 frequency 0/1 两级（约 2500 字）
 *   旧代码用词频取前 3500 字，结果"赡/赡/婿"这类字照样拿来考三年级小孩。
 *   现在拼音单字题与干扰项一律只用小学级字。 */
const SINGLE_KID = SINGLE.filter(function (x) { return x.f <= 1; });
/* 只取单音字做「看拼音选字」，否则同音字一堆、答案不唯一 */
const UNIQUE = SINGLE_KID.filter(function (x) { return x.all.length === 1; });
/* 多音字集合：用于出多音字题 */
const POLY = SINGLE_KID.filter(function (x) { return x.all.length > 1; });

console.log('[素材] 单字 ' + CHARS.length + '（单音 ' + UNIQUE.length + ' / 多音 ' + POLY.length + '）· 词语 ' + WORDS.length + ' · 成语 ' + IDIOMS.length + ' · 英语 ' + EN.length);

/* ---------------- 出题核心 ---------------- */
const SEEN = new Set();
/* 按题干全局去重：同一道题全库只允许出现一次 */
function mk(o) {
  const key = String(o.q || '');
  if (!key || SEEN.has(key)) return null;
  SEEN.add(key);
  return o;
}
/* 四选一：选项去重 + 补齐到 4 个 + 打乱 */
function choice(q, right, wrongs, extra) {
  if (right === undefined || right === null || String(right) === '') return null;
  right = String(right);
  let cand = uniq(wrongs).filter(x => String(x) !== right);
  if (cand.length < 3 && extra && extra.fallback) {
    cand = cand.concat(uniq(extra.fallback).filter(x => String(x) !== right));
  }
  cand = uniq(cand).filter(x => String(x) !== right).slice(0, 3);
  if (cand.length < 3) return null;
  const opts = shuffle([right].concat(cand));
  return mk({
    type: 'choice', q: q, opts: opts, ans: opts.indexOf(right),
    speak: right, kp: (extra && extra.kp) || '', tag: (extra && extra.tag) || '',
    teach: (extra && extra.teach) || '', say: (extra && extra.say) || q, speakAns: right
  });
}
function fillList(list, maker, n) {
  let guard = 0;
  while (list.length < n && guard < n * 80) {
    guard++;
    const q = maker();
    if (q) list.push(q);
  }
}
/* 从素材里捞 N 个不重复的随机值 */
function sample(arr, n, mapFn) {
  const out = [];
  let guard = 0;
  while (out.length < n && guard < n * 20) {
    guard++;
    const v = mapFn ? mapFn(pick(arr)) : pick(arr);
    if (v !== undefined && v !== null && String(v) && out.indexOf(v) < 0) out.push(v);
  }
  return out;
}

/* 小学拼音教学口径：声母（y/w 有争议，出题时避开） */
const SM = ['b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'zh', 'ch', 'sh', 'r', 'z', 'c', 's'];
const YM = ['a', 'o', 'e', 'i', 'u', '\u00fc', 'ai', 'ei', 'ui', 'ao', 'ou', 'iu', 'ie', '\u00fce', 'er', 'an', 'en', 'in', 'un', '\u00fcn', 'ang', 'eng', 'ing', 'ong'];
/* 该音节拿来出「声母题」是否安全（避开整体认读与 y/w，免得答案打架） */
function safeForInitial(syl) {
  const s = PY.stripTone(syl);
  if (PY.WHOLE.indexOf(s) >= 0) return false;
  return /^[bpmfdtnlgkhjqxzcsryw]/.test(s);
}
/* 该音节拿来出「韵母题」是否安全 */
function safeForFinal(syl) {
  const s = PY.stripTone(syl);
  return YM.indexOf(PY.finalOf(s)) >= 0 && PY.WHOLE.indexOf(s) < 0;
}


/* ================= 拼音题（14 种题型） ================= */
const pyPool = [];
function genPinyin() {
  const T = TOTAL;
  /* 1) 汉字 → 拼音（只用单音字，保证答案唯一） */
  fillList(pyPool, function () {
    const c = pick(UNIQUE); if (!c) return null;
    const wrongs = sample(SINGLE, 3, function (x) { return x.py; });
    return choice('“' + c.c + '”的拼音是？', c.py, wrongs, {
      kp: '拼音认读', tag: '汉字注音',
      teach: '“' + c.c + '”读作 ' + c.py + '，注意看清声母和声调。',
      say: '“' + c.c + '”的拼音是哪个？'
    });
  }, Math.round(T * 0.020));

  /* 2) 拼音 → 汉字（干扰项不能同音，否则答案不唯一） */
  fillList(pyPool, function () {
    const c = pick(UNIQUE); if (!c) return null;
    const plain = PY.stripTone(c.py);
    const wrongs = sample(SINGLE, 8, function (x) {
      if (x.c === c.c) return null;
      return PY.stripTone(x.py) === plain ? null : x.c;
    });
    return choice('拼音 “' + c.py + '” 是哪个字？', c.c, wrongs, {
      kp: '拼音认读', tag: '看拼音选字',
      teach: c.py + ' 对应的字是“' + c.c + '”。',
      say: '拼音 ' + c.py + ' 是哪个字？'
    });
  }, Math.round(T * 0.045));

  /* 3) 词语 → 拼音 */
  fillList(pyPool, function () {
    const p = pick(WORDS); if (!p) return null;
    const wrongs = sample(WORDS, 3, function (x) { return x.py; });
    return choice('“' + p.w + '”的拼音是？', p.py, wrongs, {
      kp: '词语拼音', tag: '词语注音',
      teach: '“' + p.w + '”读作 ' + p.py + '。',
      say: '“' + p.w + '”的拼音是哪个？'
    });
  }, Math.round(T * 0.075));

  /* 4) 看拼音选词语（干扰项字数对齐，不能靠长度蒙） */
  fillList(pyPool, function () {
    const p = pick(WORDS); if (!p || p.w.length < 2) return null;
    const wrongs = sample(WORDS, 3, function (x) {
      return x.w.length === p.w.length ? x.w : null;
    });
    return choice('看拼音，选词语：' + p.py, p.w, wrongs, {
      kp: '看拼音写词', tag: '看拼音写词',
      teach: p.py + ' 对应的词是“' + p.w + '”。', say: '看拼音选词语：' + p.py
    });
  }, Math.round(T * 0.105));

  /* 5) 声母识别（避开整体认读音节与 y/w，免得答案打架） */
  fillList(pyPool, function () {
    const p = pick(WORDS); if (!p) return null;
    const cands = p.syls.filter(safeForInitial);
    if (!cands.length) return null;
    const syl = pick(cands);
    const ini = PY.initialOf(syl);
    if (!ini) return null;
    const wrongs = shuffle(SM.filter(function (x) { return x !== ini; })).slice(0, 3);
    return choice('“' + syl + '”的声母是？', ini, wrongs, {
      kp: '声母', tag: '声母识别',
      teach: '“' + syl + '”的声母是 ' + ini + '，发音要又轻又短。',
      say: '音节 ' + syl + ' 的声母是哪个？'
    });
  }, Math.round(T * 0.125));

  /* 6) 韵母识别 */
  fillList(pyPool, function () {
    const p = pick(WORDS); if (!p) return null;
    const cands = p.syls.filter(safeForFinal);
    if (!cands.length) return null;
    const syl = pick(cands);
    const fin = PY.finalOf(syl);
    if (!fin) return null;
    const wrongs = shuffle(YM.filter(function (x) { return x !== fin; })).slice(0, 3);
    return choice('“' + syl + '”的韵母是？', fin, wrongs, {
      kp: '韵母', tag: '韵母识别',
      teach: '“' + syl + '”的韵母是 ' + fin + '，发音要响亮。',
      say: '音节 ' + syl + ' 的韵母是哪个？'
    });
  }, Math.round(T * 0.145));

  /* 7) ★声调选择（本次重点修复）
   *    旧 bug：去掉声调后随机挑一个声调当答案 → 教错。
   *    现做法：取音节在词语里的真实声调当答案；
   *            干扰项 = 同一主元音的另外三个声调（都是合法音节），
   *            四个选项只能靠听音辨调区分。 */
  fillList(pyPool, function () {
    const p = pick(WORDS); if (!p) return null;
    const cands = p.syls.filter(function (s) {
      const plain = PY.stripTone(s);
      return PY.toneOf(s) > 0 && /[aeiouü]/.test(plain) && PY.WHOLE.indexOf(plain) < 0;
    });
    if (!cands.length) return null;
    const syl = pick(cands);
    const right = syl;
    const plain = PY.stripTone(syl);
    const base = PY.finalOf(syl);
    const order = ['a', 'o', 'e', 'i', 'u', 'ü'];
    let v = null;
    for (const x of order) { if (base.indexOf(x) >= 0) { v = x; break; } }
    if (!v) return null;
    const wrongs = [1, 2, 3, 4].map(function (t) { return PY.addTone(plain, t); })
      .filter(function (x) { return x !== right; });
    return choice('下面哪个是“' + plain + '”的正确声调？', right, wrongs, {
      kp: '声调', tag: '声调选择',
      teach: '“' + right + '”读第 ' + PY.toneOf(syl) + ' 声。一声平、二声扬、三声拐弯、四声降。',
      say: '选出 ' + plain + ' 的正确声调'
    });
  }, Math.round(T * 0.165));

  /* 8) ★整体认读音节
   *    注意：题干必须带上选项内容，否则 4 个选项随机、题干却固定，
   *    全局去重会把后面所有题判成"重复"→ 只能出 1 道。 */
  fillList(pyPool, function () {
    const right = pick(PY.WHOLE);
    const notWhole = sample(WORDS, 3, function (x) {
      const s = PY.stripTone(x.syls[0]);
      return (s && PY.WHOLE.indexOf(s) < 0 && /^[a-z]{2,4}$/.test(s)) ? s : null;
    });
    if (notWhole.length < 3) return null;
    const opts = shuffle([right].concat(notWhole));
    const q = '下列音节中，属于整体认读音节的是：\n' +
      opts.map(function (o, i) { return (i + 1) + '. ' + o; }).join('   ');
    return mk({
      type: 'choice', q: q, opts: opts, ans: opts.indexOf(right),
      speak: right, kp: '整体认读', tag: '整体认读音节',
      teach: '整体认读音节要整个记住、不拼读：' + PY.WHOLE.join('、') + '。',
      say: '选出整体认读音节', speakAns: right
    });
  }, Math.round(T * 0.178));

  /* 9) 前鼻音 / 后鼻音（小学拼音最大难点之一） */
  fillList(pyPool, function () {
    const p = pick(WORDS); if (!p) return null;
    const cands = p.syls.filter(function (s) {
      const k = PY.finKind(PY.finalOf(s));
      return k === '前鼻音' || k === '后鼻音';
    });
    if (!cands.length) return null;
    const syl = pick(cands);
    const right = PY.finKind(PY.finalOf(syl));
    const wrongs = ['前鼻音', '后鼻音', '平舌音', '翘舌音'].filter(function (x) { return x !== right; });
    return choice('“' + syl + '”的韵母是前鼻音还是后鼻音？', right, wrongs, {
      kp: '前后鼻音', tag: '鼻音辨析',
      teach: '“' + syl + '”的韵母是 ' + PY.finalOf(syl) + '，属于' + right + '。前鼻音收 -n，后鼻音收 -ng。',
      say: '音节 ' + syl + ' 是哪一类鼻音？'
    });
  }, Math.round(T * 0.195));

  /* 10) 平舌音 / 翘舌音 */
  fillList(pyPool, function () {
    const p = pick(WORDS); if (!p) return null;
    const cands = p.syls.filter(function (s) {
      const k = PY.tongueKind(PY.initialOf(s));
      return k === '平舌音' || k === '翘舌音';
    });
    if (!cands.length) return null;
    const syl = pick(cands);
    const right = PY.tongueKind(PY.initialOf(syl));
    const wrongs = ['平舌音', '翘舌音', '前鼻音', '后鼻音'].filter(function (x) { return x !== right; });
    return choice('“' + syl + '”的声母是平舌音还是翘舌音？', right, wrongs, {
      kp: '平翘舌', tag: '平翘舌辨析',
      teach: '“' + syl + '”的声母是 ' + PY.initialOf(syl) + '，属于' + right + '。z c s 平舌，zh ch sh r 翘舌。',
      say: '音节 ' + syl + ' 的声母是哪一类？'
    });
  }, Math.round(T * 0.210));

  /* 11) 三拼音节判断 */
  fillList(pyPool, function () {
    const p = pick(WORDS); if (!p) return null;
    const cands = p.syls.filter(function (s) { return PY.initialOf(s); });
    if (!cands.length) return null;
    const syl = pick(cands);
    const right = PY.isTriphthong(syl) ? '三拼音节' : '两拼音节';
    const wrongs = ['三拼音节', '两拼音节', '整体认读音节'].filter(function (x) { return x !== right; });
    return choice('“' + syl + '”是几拼音节？', right, wrongs, {
      kp: '拼读方法', tag: '音节结构',
      teach: '“' + syl + '”是' + right + '。三拼音节有声母+介母+韵母，拼时"声轻介快韵母响"。',
      say: '音节 ' + syl + ' 是几拼音节？'
    });
  }, Math.round(T * 0.222));

  /* 12) 多音字：给词语，问里面那个字读什么 */
  fillList(pyPool, function () {
    if (!POLY.length) return null;
    let p = null, idx = -1, ch = '';
    for (let k = 0; k < 40 && !p; k++) {
      const cand = pick(WORDS);
      if (!cand) continue;
      for (let i = 0; i < cand.w.length; i++) {
        if (CHAR_PY[cand.w[i]] && CHAR_PY[cand.w[i]].length > 1) { p = cand; idx = i; ch = cand.w[i]; break; }
      }
    }
    if (!p) return null;
    const right = p.syls[idx];
    const rec = CHAR_PY[ch] || [];
    const others = rec.filter(function (y) { return y !== right; });
    let wrongs = uniq(others);
    if (wrongs.length < 3) {
      wrongs = wrongs.concat(sample(SINGLE, 6, function (x) {
        return PY.stripTone(x.py) !== PY.stripTone(right) ? x.py : null;
      }));
    }
    return choice('“' + p.w + '”中的“' + ch + '”读什么？', right, uniq(wrongs), {
      kp: '多音字', tag: '多音字',
      teach: '“' + p.w + '”里“' + ch + '”读 ' + right + '；多音字要看它在词里的意思定读音。',
      say: '“' + p.w + '”中的“' + ch + '”读什么？'
    });
  }, Math.round(T * 0.240));

  /* 13) 音节个数 */
  fillList(pyPool, function () {
    const p = pick(WORDS); if (!p) return null;
    const right = String(p.w.length);
    const wrongs = ['1', '2', '3', '4'].filter(function (x) { return x !== right; });
    return choice('“' + p.w + '”有几个音节？', right, wrongs, {
      kp: '音节', tag: '音节计数',
      teach: '“' + p.w + '”有 ' + p.w.length + ' 个字，就有 ' + p.w.length + ' 个音节。',
      say: '“' + p.w + '”有几个音节？'
    });
  }, Math.round(T * 0.250));

  /* 14) 字母大小写 / 字母表顺序 */
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  fillList(pyPool, function () {
    const up = pick(LETTERS), low = up.toLowerCase();
    const wrongs = shuffle(LETTERS.filter(function (x) { return x !== up; })).slice(0, 3).map(function (x) { return x.toLowerCase(); });
    return choice('大写字母 “' + up + '” 的小写是？', low, wrongs, {
      kp: '字母', tag: '字母大小写',
      teach: up + ' 的小写是 ' + low + '。',
      say: '大写字母 ' + up + ' 的小写是哪个？'
    });
  }, Math.round(T * 0.256));
  fillList(pyPool, function () {
    const i = R(0, 22);
    const a = LETTERS[i], b = LETTERS[i + 1], c = LETTERS[i + 2];
    const wrongs = shuffle(LETTERS.filter(function (x) { return x !== c && x !== a && x !== b; })).slice(0, 3);
    return choice('按字母表顺序，' + a + ' ' + b + ' 后面是？', c, wrongs, {
      kp: '字母', tag: '字母顺序',
      teach: '字母表顺序：' + a + ' ' + b + ' ' + c + '。',
      say: a + ' ' + b + ' 后面是哪个字母？'
    });
  }, Math.round(T * 0.262));
  return pyPool;
}


/* ================= 语文题（8 种题型） ================= */
const cnPool = [];
function genChinese() {
  const T = TOTAL;
  /* 1) 看拼音写词 */
  fillList(cnPool, function () {
    const p = pick(WORDS); if (!p) return null;
    const wrongs = sample(WORDS, 3, function (x) { return x.w.length === p.w.length ? x.w : null; });
    return choice('看拼音写词：' + p.py, p.w, wrongs, {
      kp: '看拼音写词', tag: '看拼音写词',
      teach: p.py + ' 对应的词是“' + p.w + '”。', say: '看拼音写词：' + p.py
    });
  }, Math.round(T * 0.030));

  /* 2) 词语读音 */
  fillList(cnPool, function () {
    const p = pick(WORDS); if (!p) return null;
    const wrongs = sample(WORDS, 3, function (x) { return x.py; });
    return choice('“' + p.w + '”的正确读音是？', p.py, wrongs, {
      kp: '词语读音', tag: '选读音',
      teach: '“' + p.w + '”读 ' + p.py + '。', say: '“' + p.w + '”的正确读音是哪个？'
    });
  }, Math.round(T * 0.060));

  /* 3) 组词 */
  fillList(cnPool, function () {
    const p = pick(WORDS); if (!p || p.w.length < 2) return null;
    const ch = p.w[R(0, p.w.length - 1)];
    const wrongs = sample(WORDS, 3, function (x) {
      return (x.w.indexOf(ch) < 0 && x.w.length === p.w.length) ? x.w : null;
    });
    return choice('下面哪个词里有“' + ch + '”字？', p.w, wrongs, {
      kp: '组词', tag: '组词',
      teach: '“' + p.w + '”里有“' + ch + '”字。', say: '哪个词里有“' + ch + '”字？'
    });
  }, Math.round(T * 0.088));

  /* 4) 成语填空 */
  fillList(cnPool, function () {
    if (!IDIOMS.length) return null;
    const it = pick(IDIOMS);
    const i = R(0, 3);
    const blank = it.w.slice(0, i) + '（ ？ ）' + it.w.slice(i + 1);
    const right = it.w[i];
    const wrongs = sample(CHARS, 3, function (x) { return x.c; });
    return choice('填字成成语：' + blank, right, wrongs, {
      kp: '成语', tag: '成语填空',
      teach: '“' + it.w + '”：' + it.ex + '。', say: '填字成成语：' + blank
    });
  }, Math.round(T * 0.135));

  /* 4b) 成语释义 */
  fillList(cnPool, function () {
    if (IDIOMS.length < 4) return null;
    const it = pick(IDIOMS);
    const wrongs = sample(IDIOMS, 3, function (x) { return x.w !== it.w ? x.w : null; });
    return choice('“' + it.ex + '”说的是哪个成语？', it.w, wrongs, {
      kp: '成语', tag: '成语释义',
      teach: '“' + it.w + '”的意思是：' + it.ex + '。', say: '根据意思选成语'
    });
  }, Math.round(T * 0.180));

  /* 5) 汉字注音 */
  fillList(cnPool, function () {
    const c = pick(UNIQUE); if (!c) return null;
    const wrongs = sample(SINGLE, 3, function (x) { return x.py; });
    return choice('给“' + c.c + '”选出正确的读音', c.py, wrongs, {
      kp: '汉字读音', tag: '汉字注音',
      teach: '“' + c.c + '”读 ' + c.py + '。', say: '“' + c.c + '”的正确读音是哪个？'
    });
  }, Math.round(T * 0.215));

  /* 6) 反义词 */
  const ANT = [['大', '小'], ['多', '少'], ['上', '下'], ['左', '右'], ['前', '后'], ['高', '低'], ['长', '短'], ['黑', '白'], ['早', '晚'], ['远', '近'], ['快', '慢'], ['冷', '热'], ['新', '旧'], ['开', '关'], ['来', '去'], ['出', '入'], ['东', '西'], ['南', '北'], ['天', '地'], ['古', '今'], ['轻', '重'], ['深', '浅'], ['真', '假'], ['动', '静'], ['苦', '甜'], ['粗', '细'], ['胖', '瘦'], ['美', '丑'], ['忙', '闲'], ['老', '少'], ['进', '退'], ['买', '卖'], ['加', '减'], ['问', '答'], ['笑', '哭'], ['爱', '恨'], ['生', '死'], ['明', '暗'], ['清', '浊'], ['寒', '暑'], ['朝', '暮'], ['曲', '直'], ['始', '终'], ['是', '非'], ['难', '易'], ['得', '失'], ['聚', '散'], ['盛', '衰'], ['同', '异'], ['主', '客'], ['正', '反'], ['干', '湿'], ['软', '硬'], ['香', '臭'], ['饱', '饿'], ['醒', '睡'], ['起', '落'], ['迎', '送'], ['收', '放'], ['借', '还'], ['教', '学'], ['奖', '罚'], ['勤', '懒'], ['俭', '奢'], ['善', '恶'], ['公', '私'], ['敌', '友'], ['内', '外'], ['里', '外'], ['今', '昔'], ['古', '今'], ['天', '地'], ['日', '月']];
  fillList(cnPool, function () {
    const it = pick(ANT);
    const wrongs = sample(ANT, 3, function (x) { return x[0] !== it[0] ? x[1] : null; });
    return choice('“' + it[0] + '”的反义词是？', it[1], wrongs, {
      kp: '反义词', tag: '反义词',
      teach: '“' + it[0] + '”的反义词是“' + it[1] + '”。', say: '“' + it[0] + '”的反义词是哪个？'
    });
  }, Math.round(T * 0.238));

  /* 7) 量词搭配 */
  const CL = [['一（ ）牛', '头'], ['一（ ）马', '匹'], ['一（ ）鱼', '条'], ['一（ ）花', '朵'], ['一（ ）书', '本'], ['一（ ）树', '棵'], ['一（ ）桥', '座'], ['一（ ）飞机', '架'], ['一（ ）铅笔', '支'], ['一（ ）衣服', '件'], ['一（ ）鸭子', '只'], ['一（ ）桌子', '张'], ['一（ ）井', '口'], ['一（ ）眼镜', '副'], ['一（ ）红旗', '面'], ['一（ ）明月', '轮'], ['一（ ）大炮', '门'], ['一（ ）机枪', '挺'], ['一（ ）大刀', '把'], ['一（ ）机枪', '挺'], ['一（ ）大象', '头'], ['一（ ）老虎', '只'], ['一（ ）狮子', '头'], ['一（ ）猴子', '只'], ['一（ ）骏马', '匹'], ['一（ ）骆驼', '峰'], ['一（ ）帆船', '艘'], ['一（ ）子弹', '发'], ['一（ ）手枪', '把'], ['一（ ）蛋糕', '块'], ['一（ ）饼干', '片'], ['一（ ）米饭', '碗'], ['一（ ）面条', '碗'], ['一（ ）馒头', '个'], ['一（ ）包子', '笼'], ['一（ ）牛肉', '斤'], ['一（ ）白菜', '棵'], ['一（ ）黄瓜', '根'], ['一（ ）葡萄', '串'], ['一（ ）西瓜', '个'], ['一（ ）钥匙', '把'], ['一（ ）锁头', '把'], ['一（ ）剪刀', '把'], ['一（ ）雨伞', '把'], ['一（ ）扇子', '把'], ['一（ ）毛巾', '条'], ['一（ ）牙刷', '支'], ['一（ ）肥皂', '块'], ['一（ ）镜子', '面'], ['一（ ）梳子', '把'], ['一（ ）床单', '条'], ['一（ ）被子', '床'], ['一（ ）枕头', '个'], ['一（ ）椅子', '把'], ['一（ ）沙发', '张'], ['一（ ）电视', '台'], ['一（ ）电脑', '台'], ['一（ ）手机', '部'], ['一（ ）电话', '部'], ['一（ ）钟表', '座'], ['一（ ）台灯', '盏'], ['一（ ）蜡烛', '支'], ['一（ ）灯笼', '个'], ['一（ ）油画', '幅'], ['一（ ）照片', '张'], ['一（ ）地图', '张'], ['一（ ）邮票', '枚'], ['一（ ）硬币', '枚'], ['一（ ）钞票', '张'], ['一（ ）钱包', '个'], ['一（ ）书包', '个'], ['一（ ）钢笔', '支'], ['一（ ）墨水', '瓶'], ['一（ ）纸张', '张'], ['一（ ）日记', '篇'], ['一（ ）文章', '篇'], ['一（ ）小说', '部'], ['一（ ）诗歌', '首'], ['一（ ）歌曲', '首'], ['一（ ）电影', '部'], ['一（ ）戏剧', '出'], ['一（ ）比赛', '场'], ['一（ ）会议', '个'], ['一（ ）报告', '个'], ['一（ ）计划', '个'], ['一（ ）建议', '条'], ['一（ ）意见', '条'], ['一（ ）规定', '项'], ['一（ ）制度', '项'], ['一（ ）政策', '项'], ['一（ ）法律', '部'], ['一（ ）条例', '个']];
  fillList(cnPool, function () {
    const it = pick(CL);
    const wrongs = sample(CL, 3, function (x) { return x[1] !== it[1] ? x[1] : null; });
    return choice('填上合适的量词：' + it[0], it[1], wrongs, {
      kp: '量词', tag: '量词搭配',
      teach: '正确搭配是：' + it[0].replace('（ ）', it[1]) + '。', say: '填上合适的量词：' + it[0]
    });
  }, Math.round(T * 0.250));

  /* 8) 近义词 */
  const SYN = [['美丽', '漂亮'], ['高兴', '快乐'], ['喜欢', '喜爱'], ['立刻', '马上'], ['著名', '有名'], ['特别', '非常'], ['办法', '方法'], ['帮助', '帮忙'], ['安静', '宁静'], ['勇敢', '英勇'], ['聪明', '机灵'], ['温暖', '暖和'], ['悲伤', '难过'], ['茂密', '繁茂'], ['急忙', '连忙'], ['仔细', '认真'], ['简单', '容易'], ['坚固', '牢固'], ['失望', '灰心'], ['茂盛', '旺盛'], ['清晰', '清楚'], ['珍惜', '爱惜'], ['思考', '思索'], ['立刻', '立即'], ['惊奇', '惊讶'], ['仿佛', '好像'], ['慢慢', '渐渐'], ['忽然', '突然'], ['特别', '格外'], ['连忙', '赶忙'], []].filter(function (x) { return x.length === 2; });
  fillList(cnPool, function () {
    const it = pick(SYN);
    const wrongs = sample(SYN, 3, function (x) { return x[0] !== it[0] ? x[1] : null; });
    return choice('“' + it[0] + '”的近义词是？', it[1], wrongs, {
      kp: '近义词', tag: '近义词',
      teach: '“' + it[0] + '”的近义词是“' + it[1] + '”。', say: '“' + it[0] + '”的近义词是哪个？'
    });
  }, Math.round(T * 0.262));

  /* 9) 古诗填空（小学必背） */
  const POEMS = [
    ['静夜思', '李白', '床前明月光', '疑是地上霜', '举头望明月', '低头思故乡'],
    ['春晓', '孟浩然', '春眠不觉晓', '处处闻啼鸟', '夜来风雨声', '花落知多少'],
    ['咏鹅', '骆宾王', '鹅鹅鹅', '曲项向天歌', '白毛浮绿水', '红掌拨清波'],
    ['悯农', '李绅', '锄禾日当午', '汗滴禾下土', '谁知盘中餐', '粒粒皆辛苦'],
    ['登鹳雀楼', '王之涣', '白日依山尽', '黄河入海流', '欲穷千里目', '更上一层楼'],
    ['相思', '王维', '红豆生南国', '春来发几枝', '愿君多采撷', '此物最相思'],
    ['画', '王维', '远看山有色', '近听水无声', '春去花还在', '人来鸟不惊'],
    ['古朗月行', '李白', '小时不识月', '呼作白玉盘', '又疑瑶台镜', '飞在青云端'],
    ['寻隐者不遇', '贾岛', '松下问童子', '言师采药去', '只在此山中', '云深不知处'],
    ['池上', '白居易', '小娃撑小艇', '偷采白莲回', '不解藏踪迹', '浮萍一道开'],
    ['小池', '杨万里', '泉眼无声惜细流', '树阴照水爱晴柔', '小荷才露尖尖角', '早有蜻蜓立上头'],
    ['咏柳', '贺知章', '碧玉妆成一树高', '万条垂下绿丝绦', '不知细叶谁裁出', '二月春风似剪刀'],
    ['村居', '高鼎', '草长莺飞二月天', '拂堤杨柳醉春烟', '儿童散学归来早', '忙趁东风放纸鸢'],
    ['所见', '袁枚', '牧童骑黄牛', '歌声振林樾', '意欲捕鸣蝉', '忽然闭口立'],
    ['山行', '杜牧', '远上寒山石径斜', '白云生处有人家', '停车坐爱枫林晚', '霜叶红于二月花'],
    ['望庐山瀑布', '李白', '日照香炉生紫烟', '遥看瀑布挂前川', '飞流直下三千尺', '疑是银河落九天'],
    ['绝句', '杜甫', '两个黄鹂鸣翠柳', '一行白鹭上青天', '窗含西岭千秋雪', '门泊东吴万里船'],
    ['江雪', '柳宗元', '千山鸟飞绝', '万径人踪灭', '孤舟蓑笠翁', '独钓寒江雪'],
    ['草', '白居易', '离离原上草', '一岁一枯荣', '野火烧不尽', '春风吹又生'],
    ['赠汪伦', '李白', '李白乘舟将欲行', '忽闻岸上踏歌声', '桃花潭水深千尺', '不及汪伦送我情']
  ];
  fillList(cnPool, function () {
    const p = pick(POEMS);
    /* 从 4 句里随机挖掉一句，让娃选被挖的那句 */
    const lines = [p[2], p[3], p[4], p[5]];
    const i = R(0, 3);
    const right = lines[i];
    const shown = lines.slice();
    shown[i] = '（ ？ ）';
    const wrongs = sample(POEMS, 8, function (q) {
      if (q[0] === p[0]) return null;
      return pick([q[2], q[3], q[4], q[5]]);
    });
    return choice('补全诗：' + p[0] + '（' + p[1] + '）\n' + shown.join('，'), right, wrongs, {
      kp: '古诗积累', tag: '古诗填空',
      teach: '《' + p[0] + '》' + p[1] + '：' + lines.join('，') + '。', say: '补全诗：' + p[0]
    });
  }, Math.round(T * 0.280));

  /* 10) 古诗作者 */
  fillList(cnPool, function () {
    const p = pick(POEMS);
    const right = p[1];
    const authors = [];
    POEMS.forEach(function (q) { if (q[1] !== right && authors.indexOf(q[1]) < 0) authors.push(q[1]); });
    const wrongs = shuffle(authors).slice(0, 3);
    if (wrongs.length < 3) return null;
    return choice('《' + p[0] + '》的作者是谁？', right, wrongs, {
      kp: '古诗积累', tag: '古诗作者',
      teach: '《' + p[0] + '》是唐代诗人' + p[1] + '写的。', say: '这首诗的作者是谁？'
    });
  }, Math.round(T * 0.290));
  return cnPool;
}

/* ================= 英语题（ECDICT 小学/初中词） ================= */
const enPool = [];
function genEnglish() {
  if (!EN.length) { console.log('[警告] 没有英语素材，跳过英语题'); return enPool; }
  const T = TOTAL;
  const ALLW = EN.map(function (x) { return x.w; });
  const ALLCN = EN.map(function (x) { return x.cn; });
  /* 已学词表：同义/反义题的「两边」都必须在这里，绝不拿生词解释生词 */
  const ENSET = new Set(ALLW);
  const CNMAP = {};
  EN.forEach(function (x) { CNMAP[x.w] = x.cn; });
  function cnOf(w) { return CNMAP[w] || w; }

  /* 1) 中文 → 英文 */
  fillList(enPool, function () {
    const e = pick(EN); if (!e) return null;
    const wrongs = sample(EN, 8, function (x) {
      return (x.w !== e.w && x.cn !== e.cn && Math.abs(x.w.length - e.w.length) <= 2) ? x.w : null;
    });
    return choice('选出表示“' + e.cn + '”的单词', e.w, wrongs, {
      kp: '单词', tag: '看中文选单词',
      teach: e.w + ' = ' + e.cn + (e.ph ? '（/' + e.ph + '/）' : ''),
      say: '选出表示“' + e.cn + '”的单词'
    });
  }, Math.round(T * 0.035));

  /* 2) 英文 → 中文 */
  fillList(enPool, function () {
    const e = pick(EN); if (!e) return null;
    const wrongs = sample(EN, 8, function (x) { return x.w !== e.w ? x.cn : null; });
    return choice('What does “' + e.w + '” mean?', e.cn, wrongs, {
      kp: '单词', tag: '看单词选中文',
      teach: e.w + ' = ' + e.cn, say: '选出这个单词的意思'
    });
  }, Math.round(T * 0.075));

  /* 3) ★拼写填空（修复：保证 4 个选项、长度对齐、不重复） */
  fillList(enPool, function () {
    const e = pick(EN); if (!e || e.w.length < 4) return null;
    const i = R(1, e.w.length - 2);
    const blank = e.w.slice(0, i) + '_' + e.w.slice(i + 1);
    const wrongs = [];
    let guard = 0;
    while (wrongs.length < 3 && guard < 60) {
      guard++;
      const w2 = pick(ALLW);
      if (w2.length === e.w.length && w2 !== e.w && w2[i] !== e.w[i]) {
        const b2 = w2.slice(0, i) + '_' + w2.slice(i + 1);
        if (b2 !== blank && wrongs.indexOf(b2) < 0) wrongs.push(b2);
      }
    }
    if (wrongs.length < 3) return null;
    return choice('补全单词：' + blank + '  （' + e.cn + '）', e.w, wrongs, {
      kp: '拼写', tag: '单词拼写',
      teach: '正确拼写是 ' + e.w + '（' + e.cn + '）。', say: '补全这个单词'
    });
  }, Math.round(T * 0.115));

  /* 4) ★同义词
   *    说明：ECDICT 没有同义词字段（exchange 里的 s: 是名词复数，不是 synonym），
   *    旧代码误把 s: 当同义词 → 只能出 6 道题。这里改用内置的小学常用同义词对，
   *    并且只挑「对子两边都在已学词表里」的来出，绝不拿生词解释生词。 */
  const SYN_PAIRS = [['big', 'large'], ['small', 'little'], ['happy', 'glad'], ['fast', 'quick'], ['begin', 'start'], ['end', 'finish'], ['like', 'love'], ['look', 'see'], ['speak', 'talk'], ['hear', 'listen'], ['house', 'home'], ['job', 'work'], ['gift', 'present'], ['help', 'assist'], ['answer', 'reply'], ['near', 'close'], ['hard', 'difficult'], ['easy', 'simple'], ['right', 'correct'], ['ill', 'sick'], ['kid', 'child'], ['road', 'street'], ['shop', 'store'], ['learn', 'study'], ['make', 'create'], ['keep', 'hold'], ['choose', 'select'], ['hurt', 'harm'], ['jump', 'leap'], ['walk', 'step'], ['sleep', 'rest'], ['want', 'wish'], ['need', 'require'], ['think', 'believe'], ['get', 'receive'], ['give', 'offer'], ['come', 'arrive'], ['go', 'leave'], ['say', 'speak'], ['tell', 'inform'], ['cut', 'slice'], ['wash', 'clean'], ['help', 'aid'], ['old', 'ancient'], ['angry', 'mad'], ['afraid', 'scared'], ['beautiful', 'pretty'], ['clever', 'smart'], ['cold', 'cool'], ['dangerous', 'risky'], ['dark', 'black'], ['dear', 'expensive'], ['different', 'unlike'], ['difficult', 'hard'], ['empty', 'blank'], ['famous', 'well-known'], ['funny', 'amusing'], ['glad', 'pleased'], ['great', 'wonderful'], ['healthy', 'well'], ['honest', 'truthful'], ['hungry', 'starving'], ['important', 'necessary'], ['interesting', 'exciting'], ['kind', 'friendly'], ['lazy', 'idle'], ['little', 'small'], ['lucky', 'fortunate'], ['nervous', 'worried'], ['nice', 'pleasant'], ['poor', 'needy'], ['quiet', 'silent'], ['ready', 'prepared'], ['rich', 'wealthy'], ['rude', 'impolite'], ['sad', 'unhappy'], ['safe', 'secure'], ['short', 'brief'], ['shy', 'bashful'], ['sick', 'ill'], ['sorry', 'regretful'], ['strange', 'unusual'], ['strong', 'powerful'], ['sure', 'certain'], ['tired', 'sleepy'], ['true', 'real'], ['unhappy', 'sad'], ['useful', 'helpful'], ['weak', 'feeble'], ['well', 'healthy'], ['wet', 'damp'], ['wise', 'clever'], ['wrong', 'mistaken']];
  const SYN_OK = SYN_PAIRS.filter(function (p) { return ENSET.has(p[0]) && ENSET.has(p[1]); });
  fillList(enPool, function () {
    if (!SYN_OK.length) return null;
    const it = pick(SYN_OK);
    const right = it[1];
    const wrongs = shuffle(ALLW.filter(function (x) { return x !== it[0] && x !== right; })).slice(0, 3);
    return choice('Synonym of “' + it[0] + '” (' + cnOf(it[0]) + '):', right, wrongs, {
      kp: '同义词', tag: '同义词',
      teach: it[0] + '（' + cnOf(it[0]) + '）的同义词是 ' + right + '（' + cnOf(right) + '）。',
      say: '选出这个单词的同义词'
    });
  }, Math.round(T * 0.138));

  /* 5) 反义词（同样用内置词对，两边都必须在已学词表内） */
  const ANT_PAIRS = [['big', 'small'], ['hot', 'cold'], ['fast', 'slow'], ['up', 'down'], ['in', 'out'], ['day', 'night'], ['black', 'white'], ['old', 'young'], ['new', 'old'], ['open', 'close'], ['come', 'go'], ['yes', 'no'], ['good', 'bad'], ['happy', 'sad'], ['left', 'right'], ['front', 'back'], ['near', 'far'], ['tall', 'short'], ['long', 'short'], ['heavy', 'light'], ['easy', 'hard'], ['rich', 'poor'], ['early', 'late'], ['strong', 'weak'], ['right', 'wrong'], ['first', 'last'], ['always', 'never'], ['clean', 'dirty'], ['dry', 'wet'], ['quiet', 'loud'], ['many', 'few'], ['more', 'less'], ['love', 'hate'], ['laugh', 'cry'], ['find', 'lose'], ['win', 'lose'], ['remember', 'forget'], ['teach', 'learn'], ['buy', 'sell'], ['give', 'take'], ['ask', 'answer'], ['push', 'pull'], ['start', 'stop'], ['begin', 'end'], ['sweet', 'bitter'], ['cheap', 'expensive'], ['wide', 'narrow'], ['deep', 'shallow'], ['thick', 'thin'], ['soft', 'hard'], ['bright', 'dark'], ['warm', 'cool'], ['summer', 'winter'], ['stand', 'sit'], ['sleep', 'wake'], ['friend', 'enemy'], ['here', 'there'], ['now', 'then'], ['near', 'far'], ['young', 'old'], ['east', 'west'], ['north', 'south'], ['left', 'right']];
  const ANT_OK = ANT_PAIRS.filter(function (p) { return ENSET.has(p[0]) && ENSET.has(p[1]); });
  fillList(enPool, function () {
    if (!ANT_OK.length) return null;
    const it = pick(ANT_OK);
    const right = it[1];
    const wrongs = shuffle(ALLW.filter(function (x) { return x !== it[0] && x !== right; })).slice(0, 3);
    return choice('Opposite of “' + it[0] + '” (' + cnOf(it[0]) + '):', right, wrongs, {
      kp: '反义词', tag: '反义词',
      teach: it[0] + '（' + cnOf(it[0]) + '）的反义词是 ' + right + '（' + cnOf(right) + '）。',
      say: '选出这个单词的反义词'
    });
  }, Math.round(T * 0.155));

  /* 6) 首字母 */
  fillList(enPool, function () {
    const e = pick(EN); if (!e) return null;
    const first = e.w[0].toLowerCase();
    const wrongs = shuffle('abcdefghijklmnopqrstvwxyz'.split('')).filter(function (x) { return x !== first; }).slice(0, 3);
    return choice('“' + e.w + '”（' + e.cn + '）的第一个字母是？', first, wrongs, {
      kp: '字母', tag: '首字母',
      teach: e.w + ' 的首字母是 ' + first + '。', say: '这个单词的第一个字母是哪个？'
    });
  }, Math.round(T * 0.170));

  /* 7) 元音字母个数 */
  fillList(enPool, function () {
    const e = pick(EN); if (!e) return null;
    const n = (e.w.match(/[aeiou]/g) || []).length;
    if (n < 1) return null;
    const right = String(n);
    const wrongs = ['1', '2', '3', '4', '5'].filter(function (x) { return x !== right; }).slice(0, 3);
    return choice('“' + e.w + '”里有几个元音字母（a e i o u）？', right, wrongs, {
      kp: '字母', tag: '元音计数',
      teach: '“' + e.w + '”里有 ' + n + ' 个元音字母。', say: '这个单词里有几个元音字母？'
    });
  }, Math.round(T * 0.183));

  /* 8) 单词长度 */
  fillList(enPool, function () {
    const e = pick(EN); if (!e || e.w.length < 3) return null;
    const right = String(e.w.length);
    const wrongs = ['3', '4', '5', '6', '7', '8'].filter(function (x) { return x !== right; }).slice(0, 3);
    return choice('“' + e.w + '”（' + e.cn + '）由几个字母组成？', right, wrongs, {
      kp: '拼写', tag: '字母计数',
      teach: '“' + e.w + '”由 ' + e.w.length + ' 个字母组成。', say: '这个单词由几个字母组成？'
    });
  }, Math.round(T * 0.196));

  /* 9) 单词归类 */
  const CATS = [
    ['动物', /猫|狗|猪|牛|羊|鸟|鱼|虎|狮|象|熊|马|鸡|鸭|鹅|兔|鼠|狼|狐|蛇|蛙|蜂|蚂蚁|熊猫|猴|鹿|驴|骆驼|斑马|长颈鹿|袋鼠|鲸|海豚|蟹|蝴蝶|动物|宠物/],
    ['食物', /苹果|香蕉|橘子|橙|梨|葡萄|桃|米|面|面包|蛋|奶|水|汁|蛋糕|糖|肉|汤|饺子|西红柿|土豆|胡萝卜|洋葱|饭|餐|食物|饮料|油|盐|胡椒|黄油|奶酪|三明治|披萨|沙拉|饼干|巧克力|早餐|午餐|晚餐|水果|蔬菜/],
    ['颜色', /红|蓝|绿|黄|黑|白|粉|紫|棕|灰|色|颜色/],
    ['学习用品', /书|笔|尺|包|桌|椅|黑板|教室|图书馆|作业|课|页|词|信|学校|老师|学生|班级|功课|字典|橡皮/],
    ['家庭成员', /父亲|母亲|爸爸|妈妈|兄弟|姐妹|祖父|祖母|爷爷|奶奶|父母|婴儿|家庭|叔叔|舅舅|阿姨|儿子|女儿|孩子|亲人|亲戚|夫妻|丈夫|妻子|邻居/],
    ['身体部位', /头|发|眼|耳|鼻|嘴|牙|脸|手|臂|腿|脚|指|身体|膝盖|肩|肘|胃|脖子|唇|下巴/],
    ['动作', /跑|跳|走|游|唱|画|读|写|玩|吃|喝|睡|坐|站|开|关|看|听|说|工作|学习|帮助|买|卖|给|拿|做|找|丢|赢|等|煮|洗|清洁|切|搬|抓|扔|爬|骑|飞|教|知道|想|意思是|理解|记得|忘记/],
    ['天气自然', /太阳|月亮|星|天空|云|雨|雪|风|树|花|草|山|河|海|湖|森林|天气|季节|春|夏|秋|冬|温暖|凉爽|干燥|潮湿|空气|岛|海滩|石头|沙|小山|山谷|植物|叶子|树枝|根|种子|田地/],
    ['交通工具', /汽车|公共汽车|自行车|火车|飞机|船|出租车|地铁|道路|机场|票|乘客|轮子/],
    ['数字', /一|二|三|四|五|六|七|八|九|十|十一|十二|二十|百|数字|数目/],
    ['时间', /时间|天|周|月|年|今天|明天|早上|下午|晚上|夜|小时|分钟|昨天|工作日|周末|假日|生日/],
    ['方位', /上|下|左|右|前|后|附近|远|这里|那里|北|南|东|西|中间|中心|角落|边|之间|旁边/]
  ];
  function catOf(cn) {
    for (let i = 0; i < CATS.length; i++) if (CATS[i][1].test(cn)) return CATS[i][0];
    return null;
  }
  const BY_CAT = {};
  EN.forEach(function (x) {
    const c = catOf(x.cn);
    if (c) (BY_CAT[c] = BY_CAT[c] || []).push(x);
  });
  const CAT_NAMES = Object.keys(BY_CAT);
  fillList(enPool, function () {
    const e = pick(EN); if (!e) return null;
    const c = catOf(e.cn);
    if (!c) return null;
    const wrongs = shuffle(CAT_NAMES.filter(function (x) { return x !== c; })).slice(0, 3);
    if (wrongs.length < 3) return null;
    return choice('“' + e.w + '”（' + e.cn + '）属于哪一类？', c, wrongs, {
      kp: '词汇分类', tag: '单词归类',
      teach: '“' + e.w + '”意思是“' + e.cn + '”，属于' + c + '。', say: '这个单词属于哪一类？'
    });
  }, Math.round(T * 0.225));

  /* 10) 看英文释义选中文 */
  fillList(enPool, function () {
    const cands = EN.filter(function (x) { return x.en; });
    if (cands.length < 4) return null;
    const e = pick(cands);
    const wrongs = sample(cands, 8, function (x) { return x.w !== e.w ? x.cn : null; });
    return choice('Read and choose: ' + e.en, e.cn, wrongs, {
      kp: '阅读理解', tag: '英释选义',
      teach: e.w + ' = ' + e.cn + '。英文解释是：' + e.en, say: '根据英文解释选出意思'
    });
  }, Math.round(T * 0.262));
  return enPool;
}


/* ================= 数学题（13 种题型） ================= */
const maPool = [];
function numQ(q, ans, kp, tag, teach, say) {
  if (typeof ans !== 'number' || !isFinite(ans) || ans < 0) return null;
  const opts = uniq([ans, ans + R(1, 5), Math.max(0, ans - R(1, 5)), ans + R(6, 12)]);
  const wrongs = opts.filter(function (x) { return Number(x) !== ans; }).map(String);
  if (wrongs.length < 3) return null;
  return choice(q, String(ans), wrongs, { kp: kp, tag: tag, teach: teach, say: say || q });
}
function genMath() {
  const T = TOTAL;
  fillList(maPool, function () { const a = R(2, 40), b = R(2, 40); return numQ(a + ' ＋ ' + b + ' ＝ ？', a + b, '加法', '口算', '个位加个位，满十进一：' + a + '＋' + b + '＝' + (a + b) + '。', a + ' 加 ' + b + ' 等于几？'); }, Math.round(T * 0.025));
  fillList(maPool, function () { const a = R(10, 60), b = R(2, a - 1); return numQ(a + ' － ' + b + ' ＝ ？', a - b, '减法', '口算', '从 ' + a + ' 里去掉 ' + b + '，剩 ' + (a - b) + '。', a + ' 减 ' + b + ' 等于几？'); }, Math.round(T * 0.050));
  fillList(maPool, function () { const a = R(6, 9), b = R(3, 9); return numQ(a + ' ＋ ' + b + ' ＝ ？（凑十法）', a + b, '进位加法', '进位加法', '把 ' + b + ' 分成 ' + (10 - a) + ' 和 ' + (b - (10 - a)) + '，10＋' + (b - (10 - a)) + '＝' + (a + b) + '。', a + ' 加 ' + b + ' 等于几？'); }, Math.round(T * 0.070));
  fillList(maPool, function () { const a = R(11, 30), b = R(3, 9); return numQ(a + ' － ' + b + ' ＝ ？（退位）', a - b, '退位减法', '退位减法', '个位不够减，向十位借一当十：' + a + '－' + b + '＝' + (a - b) + '。', a + ' 减 ' + b + ' 等于几？'); }, Math.round(T * 0.090));
  fillList(maPool, function () { const a = R(2, 9), b = R(2, 9); return numQ(a + ' × ' + b + ' ＝ ？', a * b, '乘法', '乘法口诀', '乘法口诀：' + a + '×' + b + '＝' + (a * b) + '。', a + ' 乘 ' + b + ' 等于几？'); }, Math.round(T * 0.115));
  fillList(maPool, function () { const b = R(2, 9), c = R(2, 9); return numQ((b * c) + ' ÷ ' + b + ' ＝ ？', c, '除法', '除法', '想乘法：' + b + '×' + c + '＝' + (b * c) + '，所以商是 ' + c + '。', (b * c) + ' 除以 ' + b + ' 等于几？'); }, Math.round(T * 0.138));
  fillList(maPool, function () {
    const a = R(2, 20), b = R(2, 20);
    const cmp = a > b ? '＞' : (a < b ? '＜' : '＝');
    const wrongs = ['＞', '＜', '＝'].filter(function (x) { return x !== cmp; });
    return choice(a + ' （ ？ ） ' + b, cmp, wrongs, {
      kp: '比大小', tag: '比大小', teach: '先比十位再比个位：' + a + cmp + b + '。', say: a + ' 和 ' + b + ' 中间填什么符号？'
    });
  }, Math.round(T * 0.158));
  fillList(maPool, function () { const a = R(2, 9), b = R(2, 9), c = R(1, 9); return numQ(a + ' × ' + b + ' ＋ ' + c + ' ＝ ？', a * b + c, '混合运算', '混合运算', '先算乘法：' + a + '×' + b + '＝' + (a * b) + '，再加 ' + c + '＝' + (a * b + c) + '。', '先乘后加，等于几？'); }, Math.round(T * 0.180));
  fillList(maPool, function () { const x = R(2, 15), s = R(x + 1, x + 20); return numQ('？ ＋ ' + x + ' ＝ ' + s + '，？是几？', s - x, '求未知数', '填空题', '用和减去一个加数：' + s + '－' + x + '＝' + (s - x) + '。', '括号里填几？'); }, Math.round(T * 0.198));
  fillList(maPool, function () { const y = R(1, 20), j = R(0, 9); return numQ(y + '元' + j + '角 ＝ ？角', y * 10 + j, '人民币', '元角换算', '1元＝10角，' + y + '元＝' + (y * 10) + '角，加 ' + j + '角＝' + (y * 10 + j) + '角。', '一共是多少角？'); }, Math.round(T * 0.215));
  /* 找规律（等差数列）—— 参数空间放大到 19×11，够抽 200 道不重样 */
  fillList(maPool, function () {
    const a = R(1, 19), d = R(3, 13);
    const seq = [a, a + d, a + 2 * d];
    const right = a + 3 * d;
    const wrongs = uniq([right + d, right - d, right + 2 * d, right + R(1, 5)]).map(String).filter(function (x) { return x !== String(right); });
    return choice('按规律填数：' + seq.join('、') + '、（ ？ ）', String(right), wrongs, {
      kp: '找规律', tag: '数列规律',
      teach: '每次加 ' + d + '：' + seq.join(' → ') + ' → ' + right + '。', say: '按规律，括号里填几？'
    });
  }, Math.round(T * 0.235));
  /* 数的组成（扩展到三位数，组合数 9×10×10） */
  fillList(maPool, function () {
    const h = R(1, 9), t = R(0, 9), o = R(0, 9);
    const right = h * 100 + t * 10 + o;
    const wrongs = uniq([t * 100 + h * 10 + o, h * 100 + o * 10 + t, right + 100, right + R(1, 9)]).map(String).filter(function (x) { return x !== String(right); });
    return choice(h + '个百、' + t + '个十和' + o + '个一组成的数是？', String(right), wrongs, {
      kp: '数的组成', tag: '数位',
      teach: h + '个百是' + (h * 100) + '，' + t + '个十是' + (t * 10) + '，加' + o + '个一，合起来是' + right + '。', say: '这个数是多少？'
    });
  }, Math.round(T * 0.250));
  /* 简单应用题 */
  fillList(maPool, function () {
    const a = R(5, 50), b = R(3, 30);
    const right = a - b;
    if (right < 0) return null;
    const wrongs = uniq([right + R(1, 4), Math.max(0, right - R(1, 4)), a + b, right + R(5, 9)]).map(String).filter(function (x) { return x !== String(right); });
    return choice('小明有 ' + a + ' 颗糖，吃掉 ' + b + ' 颗，还剩几颗？', String(right), wrongs, {
      kp: '应用题', tag: '解决问题',
      teach: '剩下的 = 原有的 － 吃掉的：' + a + '－' + b + '＝' + right + '（颗）。', say: '还剩几颗糖？'
    });
  }, Math.round(T * 0.262));
  /* 长度单位换算：1米＝100厘米 */
  fillList(maPool, function () {
    const m = R(1, 9), cm = R(1, 99);
    const right = m * 100 + cm;
    const wrongs = uniq([m * 10 + cm, m + cm, right + 50, right + R(1, 30)]).map(String).filter(function (x) { return x !== String(right); });
    return choice(m + '米' + cm + '厘米 ＝ ？厘米', String(right), wrongs, {
      kp: '长度单位', tag: '单位换算',
      teach: '1米＝100厘米，' + m + '米＝' + (m * 100) + '厘米，加 ' + cm + '厘米＝' + right + '厘米。', say: '一共是多少厘米？'
    });
  }, Math.round(T * 0.272));
  /* 时间换算：1时＝60分 */
  fillList(maPool, function () {
    const h = R(1, 5), mi = R(1, 59);
    const right = h * 60 + mi;
    const wrongs = uniq([h + mi, h * 100 + mi, right + 30, right + R(1, 20)]).map(String).filter(function (x) { return x !== String(right); });
    return choice(h + '时' + mi + '分 ＝ ？分', String(right), wrongs, {
      kp: '时间单位', tag: '单位换算',
      teach: '1时＝60分，' + h + '时＝' + (h * 60) + '分，加 ' + mi + '分＝' + right + '分。', say: '一共是多少分？'
    });
  }, Math.round(T * 0.280));
  /* 图形边数（空间与图形） */
  const SHAPES = [['三角形', 3], ['正方形', 4], ['长方形', 4], ['五边形', 5], ['六边形', 6], ['八边形', 8]];
  fillList(maPool, function () {
    const it = pick(SHAPES);
    const right = String(it[1]);
    const wrongs = uniq(['3', '4', '5', '6', '8'].filter(function (x) { return x !== right; })).slice(0, 3);
    if (wrongs.length < 3) return null;
    return choice('一个' + it[0] + '有几条边？', right, wrongs, {
      kp: '图形认识', tag: '空间图形',
      teach: it[0] + '有 ' + it[1] + ' 条边。', say: '这个图形有几条边？'
    });
  }, Math.round(T * 0.286));
  /* 长方形周长 */
  fillList(maPool, function () {
    const a = R(3, 20), b = R(2, 15);
    const right = (a + b) * 2;
    const wrongs = uniq([a + b, a * b, right + R(2, 8), Math.max(0, right - R(2, 8))]).map(String).filter(function (x) { return x !== String(right); });
    return choice('长方形的长是 ' + a + ' 厘米，宽是 ' + b + ' 厘米，周长是多少厘米？', String(right), wrongs, {
      kp: '周长', tag: '图形计算',
      teach: '周长 =（长＋宽）× 2 =（' + a + '＋' + b + '）× 2 = ' + right + '（厘米）。', say: '这个长方形的周长是多少？'
    });
  }, Math.round(T * 0.296));
  return maPool;
}

/* ================= 主流程 ================= */
const py = genPinyin();
const cn = genChinese();
const en = genEnglish();
const ma = genMath();
const sum = py.length + cn.length + en.length + ma.length;
console.log('[生成] 拼音 ' + py.length + ' · 语文 ' + cn.length + ' · 英语 ' + en.length + ' · 数学 ' + ma.length + ' · 合计 ' + sum);

function writeBank(file, type, name, qs) {
  const obj = {
    type: type, name: name,
    说明: '由 tools/gen_exam_bank.js 依据 GitHub 开源素材生成（常用字表+搜狗拼音词库+ECDICT），题型多样、全局去重',
    questions: qs
  };
  fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(obj), 'utf8');
  console.log('[写出] ' + file + '  ' + qs.length + ' 题');
}
writeBank('生成_拼音题库.json', 'pinyin', '生成·拼音题库（声母/韵母/声调/鼻音/平翘舌/多音字）', py);
writeBank('生成_语文题库.json', 'chinese', '生成·语文题库（看拼音写词/组词/成语/反义/量词）', cn);
writeBank('生成_英语题库.json', 'english', '生成·英语题库（中英互译/拼写/同反义/归类）', en);
writeBank('生成_数学题库.json', 'math', '生成·数学题库（口算/乘除/比大小/规律/应用题）', ma);

/* 登记到 manifest */
try {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const add = [
    { file: '生成_拼音题库.json', type: 'pinyin', name: '生成·拼音题库（声母/韵母/声调/鼻音/平翘舌/多音字）' },
    { file: '生成_语文题库.json', type: 'chinese', name: '生成·语文题库（看拼音写词/组词/成语/反义/量词）' },
    { file: '生成_英语题库.json', type: 'english', name: '生成·英语题库（中英互译/拼写/同反义/归类）' },
    { file: '生成_数学题库.json', type: 'math', name: '生成·数学题库（口算/乘除/比大小/规律/应用题）' }
  ];
  add.forEach(function (a) {
    if (!m.banks.some(function (b) { return b.file === a.file; })) m.banks.push(a);
  });
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 1), 'utf8');
  console.log('[manifest] 已登记 ' + m.banks.length + ' 个题库');
} catch (e) { console.log('[manifest] 登记失败: ' + e.message); }
console.log('[完成] 目标 ' + TOTAL + ' 题，实际 ' + sum + ' 题');

