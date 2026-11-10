#!/usr/bin/env node
/* ============================================================================
 * modules/s/tools/gen_exam_papers.js —— ★试卷中心数据生成器（2026-10-26）
 * ----------------------------------------------------------------------------
 * 背景：试卷中心.html 引用了 assets/js/data/exam/{chinese,math,english}-g1..6.js
 *       共 18 份题库文件 + papers.js（试卷清单），但这些文件在仓库里从来就不存在，
 *       于是 App.DATA.exam 为空 → 页面一片空白。
 *
 * 本脚本把 tools/gen_exam_bank.js 与 tools/gen_life_bank.js 产出的题库，
 * 按「知识点 → 年级」规则分派到 18 个分册里，并生成试卷清单：
 *   · App.DATA.exam["chinese-1"]  = { kps:{...}, qs:[...], meta:{total:N} }
 *   · App.DATA.exam.papers        = { papers:[ {id,g,s,ty,ti,qs:[题id...]} ] }
 *
 * 用法：node modules/s/tools/gen_exam_papers.js [--per=300]
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const BANK_DIR = ROOT + '/modules/s/题库';
const OUT_DIR = ROOT + '/modules/s/assets/js/data/exam';
fs.mkdirSync(OUT_DIR, { recursive: true });

function arg(k, dft) {
  const m = process.argv.slice(2).find(a => a.startsWith('--' + k + '='));
  return m ? m.split('=').slice(1).join('=') : dft;
}
const PER = parseInt(arg('per', '300'), 10) || 300;

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

/* ---------------- 素材 ---------------- */
const SRC = [
  { f: '生成_拼音题库.json', subj: 'chinese' },
  { f: '生成_语文题库.json', subj: 'chinese' },
  { f: '生成_数学题库.json', subj: 'math' },
  { f: '生成_英语题库.json', subj: 'english' },
  { f: '生成_思维训练.json', subj: 'math' },
  { f: '生成_脑筋急转弯.json', subj: 'chinese' },
  { f: '生成_安全自护.json', subj: 'chinese' },
  { f: '生成_生活常识.json', subj: 'chinese' },
  { f: '生成_交际处世.json', subj: 'chinese' }
];

/* 题型 → 适合的年级（小学 1-6） */
const GRADE_OF = {
  '汉字注音': [1, 2], '看拼音选字': [1, 2], '声母识别': [1, 2], '韵母识别': [1, 2],
  '声调选择': [1, 2], '整体认读音节': [1, 2], '鼻音辨析': [1, 2], '平翘舌辨析': [1, 2],
  '音节计数': [1, 2], '字母大小写': [1, 2], '字母顺序': [1, 2],
  '看拼音写词': [1, 2, 3], '选读音': [2, 3], '词语注音': [2, 3], '组词': [2, 3, 4],
  '多音字': [3, 4], '量词搭配': [2, 3, 4], '反义词': [2, 3, 4], '近义词': [3, 4, 5],
  '成语填空': [4, 5, 6], '成语释义': [4, 5, 6], '古诗填空': [4, 5, 6], '古诗作者': [4, 5, 6],
  '口算': [1, 2], '进位加法': [1, 2], '退位减法': [1, 2], '比大小': [1, 2, 3],
  '元角换算': [2, 3], '单位换算': [2, 3, 4], '数位': [2, 3], '数列规律': [3, 4, 5],
  '乘法口诀': [2, 3], '除法': [3, 4], '混合运算': [3, 4, 5], '填空题': [3, 4, 5],
  '解决问题': [4, 5, 6], '图形计算': [4, 5, 6], '空间图形': [3, 4, 5],
  '首字母': [3, 4], '元音计数': [3, 4], '字母计数': [3, 4],
  '看中文选单词': [4, 5, 6], '看单词选中文': [4, 5, 6], '单词拼写': [4, 5, 6],
  '单词归类': [4, 5, 6], '同义词': [5, 6], '反义词': [5, 6], '英释选义': [5, 6]
};
/* 学科 → 该学科的题库来源 */
function pickGrade(q, subj) {
  const t = q.tag || q.kp || '';
  let g = GRADE_OF[t];
  if (!g) {
    /* 按学科兜底：数学偏中低段，语文/英语偏中高段 */
    g = subj === 'math' ? [2, 3, 4] : (subj === 'english' ? [3, 4, 5] : [2, 3, 4]);
  }
  return g[Math.floor(Math.random() * g.length)];
}

const SUBJECTS = ['chinese', 'math', 'english'];
const GRADES = [1, 2, 3, 4, 5, 6];
/* books[subj][grade] = [ {i,t,stem,opts,a,kp,teach} ] */
const books = {};
SUBJECTS.forEach(function (s) { books[s] = {}; GRADES.forEach(function (g) { books[s][g] = []; }); });

let gid = 0;
SRC.forEach(function (src) {
  const j = readJson(path.join(BANK_DIR, src.f));
  if (!j || !j.questions) { console.log('[跳过] ' + src.f + '（不存在或为空）'); return; }
  j.questions.forEach(function (q) {
    const g = pickGrade(q, src.subj);
    gid++;
    /* 只保留渲染用得到的字段，去掉重复的 speak/speakAns，压体积 */
    books[src.subj][g].push({
      i: 'q' + gid,
      t: 'single',
      stem: q.q,
      opts: q.opts,
      a: q.ans,
      kp: q.kp || q.tag || '综合',
      teach: q.teach || ''
    });
  });
  console.log('[读取] ' + src.f);
});

