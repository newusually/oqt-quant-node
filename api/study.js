'use strict';
/*
 * api/study.js · 学习园地专用接口
 *   /api/study/status               健康检查
 *   /api/study/bili-search?kw=xxx   哔哩哔哩教学视频搜索（服务端代理 + wbi 签名）
 *
 * 为什么必须走服务端代理:
 *   1) B站搜索接口要 wbi 签名(salt 动态), 且浏览器直连会被 CORS 拦截;
 *   2) 完成后交给前端用 B站**官方 iframe 播放器**播放(player.bilibili.com), 合规稳定,
 *      不需要任何第三方解码器 —— 所谓「私有协议解码」既违反平台条款也随时会失效。
 * 内容安全: 面向小学生的学习站点, 搜索结果会按关键词做家长友好过滤。
 */
const crypto = require('crypto');
const https = require('https');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52
];

let COOKIE = '';
let COOKIE_AT = 0;
/* wbi salt 定期更新（nav 接口风控严重时退化到这里的兜底值） */
let SALT = { img: '7cd084941338484aae1ad9425b84077c', sub: '4932caff0ff746eab6f01bf08b70ac45' };

/* ---------- 低层 HTTP ---------- */
function req(url, opts) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('bad url')); }
    const headers = Object.assign({
      'User-Agent': UA,
      'Referer': 'https://www.bilibili.com/',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }, opts.headers || {});
    if (COOKIE) headers.Cookie = COOKIE;
    const r = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers, timeout: 12000 }, resp => {
      let d = '';
      resp.on('data', c => { d += c; });
      resp.on('end', () => resolve({ body: d, headers: resp.headers, status: resp.statusCode }));
    });
    r.on('timeout', () => { r.destroy(new Error('timeout')); });
    r.on('error', reject);
  });
}

async function warmCookie() {
  const now = Date.now();
  if (COOKIE && now - COOKIE_AT < 30 * 60 * 1000) return;
  try {
    const home = await req('https://www.bilibili.com/');
    const sc = home.headers['set-cookie'] || [];
    COOKIE = sc.map(c => c.split(';')[0]).join('; ');
    COOKIE_AT = now;
  } catch (e) { /* 拿不到就用匿名, 多数接口仍可用 */ }
}

function getMixinKey(orig) {
  return MIXIN_KEY_ENC_TAB.slice(0, 32).map(i => orig[i]).join('').slice(0, 32);
}
function encWbi(params) {
  const mixinKey = getMixinKey(SALT.img + SALT.sub);
  Object.assign(params, { wts: Math.round(Date.now() / 1000) });
  const chrFilter = /[!'()*]/g;
  const query = Object.keys(params).sort().map(k =>
    encodeURIComponent(k) + '=' + encodeURIComponent(String(params[k]).replace(chrFilter, ''))
  ).join('&');
  const w_rid = crypto.createHash('md5').update(query + mixinKey).digest('hex');
  return query + '&w_rid=' + w_rid;
}

/* ---------- 内容安全 ---------- */
/* 面向小学生站点：屏蔽明显不适宜的结果 */
const BAD_WORDS = [
  '色情', '情色', '赌博', '博彩', '暴力', '血腥', '恐怖', '惊悚', '成人', '裸',
  '擦边', '撩', '约炮', '毒', '枪支', '炒作', '原神剧情吐槽', '骂', '悬疑杀人'
];
function titleOK(t) {
  const s = (t || '').toLowerCase();
  for (let i = 0; i < BAD_WORDS.length; i++) if (s.indexOf(BAD_WORDS[i]) >= 0) return false;
  return true;
}
function cleanTitle(t) {
  return String(t || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
}
/* 教学相关性：优先保留含教学信号词的结果 */
const TEACH_HINT = ['小学', '一年级', '二年级', '三年级', '数学', '语文', '英语', '拼音', '奥数',
  '讲解', '教学', '课程', '课件', '老师', '名师', '人教版', '北师大', '同步', '动画', '启蒙', '算式', '应用题'];
function teachScore(t) {
  let s = 0;
  for (let i = 0; i < TEACH_HINT.length; i++) if (t.indexOf(TEACH_HINT[i]) >= 0) s++;
  return s;
}

/* ---------- 搜索 ---------- */
const CACHE = new Map();
function cacheGet(k) {
  const v = CACHE.get(k);
  if (v && Date.now() - v.t < 5 * 60 * 1000) return v.d;
  return null;
}
function cacheSet(k, d) {
  CACHE.set(k, { t: Date.now(), d: d });
  if (CACHE.size > 60) CACHE.delete(CACHE.keys().next().value);
}

async function biliSearch(kw, page, order) {
  kw = String(kw || '').trim();
  if (!kw) return { ok: false, err: '缺少关键词' };
  const ck = kw + '|' + (page || 1) + '|' + (order || '');
  const hit = cacheGet(ck);
  if (hit) return Object.assign({ cached: true }, hit);

  await warmCookie();
  const params = { search_type: 'video', keyword: kw, page: page || 1 };
  if (order) params.order = order;
  const url = 'https://api.bilibili.com/x/web-interface/search/type?' + encWbi(params);
  const r = await req(url);
  let j;
  try { j = JSON.parse(r.body); } catch (e) {
    return { ok: false, err: 'B站返回异常(可能被风控)', raw: String(r.body || '').slice(0, 120) };
  }
  if (j.code !== 0) return { ok: false, err: 'B站接口: ' + j.message, code: j.code };

  const list = (j.data && j.data.result) || [];
  let out = list.map(v => ({
    bvid: v.bvid,
    title: cleanTitle(v.title),
    author: v.author || '',
    pic: v.pic || '',
    duration: v.duration || '',
    play: v.play || 0,
    danmaku: v.video_review || 0,
    desc: cleanTitle(v.description || '').slice(0, 60)
  })).filter(v => v.bvid && titleOK(v.title));

  /* 教学相关性排序：含教学词多的排前面，其次播放量 */
  out.sort((a, b) => (teachScore(b.title) - teachScore(a.title)) || (b.play - a.play));

  const data = { ok: true, kw: kw, total: j.data.numResults || out.length, list: out.slice(0, 24) };
  cacheSet(ck, data);
  return data;
}

/* 按科目预置的推荐关键词（即使不输入也能直接出内容） */
const SUBJECT_PRESET = {
  math: '小学一年级 数学 动画 教学',
  chinese: '小学一年级 语文 课文 讲解',
  english: '小学 英语 启蒙 动画',
  pinyin: '小学 汉语拼音 教学 动画',
  olympic: '小学 奥数 思维训练 讲解',
  writing: '小学 看图写话 作文 入门'
};

async function handle(ep, q) {
  q = q || {};
  if (ep === 'status') return { ok: true, service: 'study-api', features: ['bili-search'] };

  if (ep === 'bili-search') {
    let kw = q.kw || q.keyword || '';
    const subj = q.subject || '';
    if (!kw && SUBJECT_PRESET[subj]) kw = SUBJECT_PRESET[subj];
    try {
      return await biliSearch(kw, parseInt(q.page || '1', 10) || 1, q.order || '');
    } catch (e) {
      return { ok: false, err: String(e && e.message || e) };
    }
  }
  if (ep === 'presets') return { ok: true, presets: SUBJECT_PRESET };

  return { ok: false, err: 'unknown endpoint: ' + ep };
}

module.exports = { handle };
