/* bjtime.js — ★统一时间组件（2026-11-11q）
 * 用户要求：所有时间显示统一为固定格式北京时间，做成共用独立组件。
 * 固定格式 = 'YYYY-MM-DD HH:mm:ss'（24小时制），时区硬编码 Asia/Shanghai，
 * 不依赖浏览器/系统 locale（Intl formatToParts + en-CA 固定顺序）。
 *
 * 用法:
 *   BJTime.fmt(v)      // 毫秒时间戳 / Date / 可解析字符串 → 'YYYY-MM-DD HH:mm:ss'
 *   BJTime.fmtId(id)   // 'YYYYMMDD_HHMMSS'（ai_history 快照 id，本身即北京时间）→ 固定格式
 *   BJTime.norm(s)     // 服务器各种时间串（'YYYY-MM-DD HH:mm:ss (北京时间)' / 'YYYY/MM/DD...' / id）
 *                        → 固定 'YYYY-MM-DD HH:mm:ss'，去后缀、统一分隔符
 *   BJTime.short(v)    // 'MM-DD HH:mm:ss'（省年）
 *   BJTime.TZ          // 'Asia/Shanghai'
 */
(function (global) {
  'use strict';
  var TZ = 'Asia/Shanghai';
  var dtf = null;
  function getDtf() {
    if (!dtf) dtf = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    return dtf;
  }
  function toDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    var n = +v;
    if (isFinite(n) && n > 1e12) return new Date(n);   // 13 位毫秒时间戳
    var d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  /* 毫秒/Date → 固定 'YYYY-MM-DD HH:mm:ss'（北京时间） */
  function fmt(v) {
    var d = toDate(v);
    if (!d) return '—';
    var m = {};
    var ps = getDtf().formatToParts(d);
    for (var i = 0; i < ps.length; i++) m[ps[i].type] = ps[i].value;
    return m.year + '-' + m.month + '-' + m.day + ' ' + m.hour + ':' + m.minute + ':' + m.second;
  }
  /* 快照 id 'YYYYMMDD_HHMMSS'（ai_apply 落盘时即北京时间）→ 固定格式 */
  function fmtId(id) {
    var s = String(id == null ? '' : id);
    var m = /^(\d{4})(\d{2})(\d{2})[_T](\d{2})(\d{2})(\d{2})/.exec(s);
    return m ? (m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5] + ':' + m[6]) : s;
  }
  /* 任意来源时间串 → 固定 'YYYY-MM-DD HH:mm:ss'（去 '(北京时间)' 后缀、统一分隔符） */
  function norm(s) {
    if (s == null || s === '') return '—';
    s = String(s).replace(/\s*[(（]\s*北京时间\s*[)）]\s*$/, '').trim();
    if (/^\d{8}[_T]\d{6}/.test(s)) return fmtId(s);
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s)) return s.slice(0, 19).replace('T', ' ');
    if (/^\d{4}\/\d{1,2}\/\d{1,2}/.test(s)) {
      var t = s.replace(/\//g, '-');
      var mm = /^(\d{4})-(\d{1,2})-(\d{1,2})(.*)$/.exec(t);
      if (mm) {
        var p2 = function (x) { return (x.length < 2 ? '0' + x : x); };
        var rest = (mm[4] || '').trim();
        return mm[1] + '-' + p2(mm[2]) + '-' + p2(mm[3]) + (rest ? ' ' + rest : '');
      }
      return t;
    }
    var d = toDate(s);
    return d ? fmt(d) : s;
  }
  /* 'MM-DD HH:mm:ss'（省年，紧凑列） */
  function short(v) {
    var f = (typeof v === 'string' && /[(（]北京时间/.test(v)) ? norm(v) : fmt(v);
    return f === '—' ? f : f.slice(5);
  }
  global.BJTime = { fmt: fmt, fmtId: fmtId, norm: norm, short: short, toDate: toDate, TZ: TZ };
})(typeof window !== 'undefined' ? window : globalThis);
