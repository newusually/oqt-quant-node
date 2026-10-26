// M7 modules/s/api/tts.js · 云端 TTS 代理（纯联网发音）
//   ★为什么需要代理:
//     浏览器直接请求 translate.google.com/translate_tts / dict.youdao.com/dictvoice
//     会被 Chrome 的 ORB(Opaque Response Blocking) 拦掉 —— 这些接口不带
//     Access-Control-Allow-Origin 头, 跨域 <audio>/fetch 一律 ERR_BLOCKED_BY_ORB,
//     结果就是"点试听一点声音都没有"。
//     服务端转发就没有同源限制, 再加上 Access-Control-Allow-Origin: * 给浏览器放行。
//   ★全程联网: 这里每次都实时去云端 TTS 拉音频, 不用本机语音、也不用本地录音文件。
'use strict';

// 云端 TTS 源: {id, name, lang, tl, spd, src}
//   g  = 谷歌翻译 TTS(长中文/英文都能念)
//   yd = 有道词典音(只认单词/短语, 整句会 500)
const VOICES = {
  'g-zh':   { name: '谷歌普通话 · 女声', lang: 'zh-CN', tl: 'zh-CN', spd: 1,   src: 'g' },
  'g-zh-s': { name: '谷歌慢速 · 教学音', lang: 'zh-CN', tl: 'zh-CN', spd: 0.4, src: 'g' },
  'g-tw':   { name: '谷歌台湾国语 · 女声', lang: 'zh-TW', tl: 'zh-TW', spd: 1,   src: 'g' },
  'g-hk':   { name: '谷歌粤语 · 女声', lang: 'zh-HK', tl: 'zh-HK', spd: 1,   src: 'g' },
  'yd-zh':  { name: '有道词典 · 普通话', lang: 'zh-CN', tl: 'zh-CN', spd: 1,   src: 'yd' },
  'g-en':   { name: '谷歌英语 · 女声', lang: 'en-US', tl: 'en',    spd: 1,   src: 'g' },
  'g-en-s': { name: '谷歌英语 · 慢速', lang: 'en-US', tl: 'en',    spd: 0.5, src: 'g' },
  'yd-en':  { name: '有道词典 · 英语', lang: 'en-US', tl: 'en',    spd: 1,   src: 'yd' }
};

function buildUrl(v, text) {
  var t = String(text || '').slice(0, 180);
  if (v.src === 'g') {
    return 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&ttsspeed=' + v.spd +
      '&tl=' + encodeURIComponent(v.tl) + '&q=' + encodeURIComponent(t);
  }
  return 'https://dict.youdao.com/dictvoice?le=' + (v.tl === 'en' ? 'en' : 'zh') +
    '&audio=' + encodeURIComponent(t);
}

// 代理: /api/s/tts?text=...&voice=g-zh  →  云端音频(mp3)
async function ttsProxy(q) {
  const text = String(q.text || '').trim();
  if (!text) return { ok: false, err: '缺少 text' };
  const vid = (q.voice && VOICES[q.voice]) ? q.voice : 'g-zh';
  const v = VOICES[vid];
  const url = buildUrl(v, text);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' }
    });
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || buf.length < 512 || (ct && ct.indexOf('audio') < 0 && ct.indexOf('octet') < 0)) {
      return { ok: false, err: '云端 TTS 无音频返回(http=' + res.status + ', ct=' + ct + ')', bytes: buf.length };
    }
    return {
      ok: true, audio: buf, contentType: 'audio/mpeg',
      voice: vid, name: v.name, bytes: buf.length
    };
  } catch (e) {
    return { ok: false, err: '云端 TTS 请求失败: ' + (e && e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { ttsProxy, VOICES, buildUrl };
