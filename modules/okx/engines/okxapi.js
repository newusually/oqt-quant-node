// M4 modules/okx/engines/okxapi · OKX v5 私有接口客户端(HMAC-SHA256 签名)
//   端点: account/balance(净值) / trade/fills-history(成交流水+已实现盈亏) / account/positions
//   凭证: modules/okx/config/api.json (apiKey/secret/passphrase), 已被 .gitignore 忽略。
//   异常统一降级为 {ok:false, err} —— 页面显示明确错误而非崩溃。
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.okx.com';
const CFG_PATH = path.join(__dirname, '../config/api.json');
let _cred = null;
function cred() {
  if (_cred === null) {
    try { _cred = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); } catch (e) { _cred = false; }
  }
  return _cred || null;
}

function sign(ts, method, requestPath, bodyStr) {
  const prehash = ts + method.toUpperCase() + requestPath + (bodyStr || '');
  return crypto.createHmac('sha256', cred().secret).update(prehash).digest('base64');
}

async function call(method, p, qs, body) {
  const c = cred();
  if (!c || !c.apiKey || !c.secret || !c.passphrase) {
    return { ok: false, err: 'OKX API 凭证未配置(缺 apiKey/secret/passphrase), 检查 modules/okx/config/api.json' };
  }
  let requestPath = p;
  if (qs && Object.keys(qs).length) requestPath += '?' + new URLSearchParams(qs).toString();
  const bodyStr = body ? JSON.stringify(body) : '';
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const headers = {
    'OK-ACCESS-KEY': c.apiKey,
    'OK-ACCESS-SIGN': sign(ts, method, requestPath, bodyStr),
    'OK-ACCESS-TIMESTAMP': ts,
    'OK-ACCESS-PASSPHRASE': c.passphrase,
    'Content-Type': 'application/json'
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(BASE + requestPath, {
      method: method.toUpperCase(), headers, body: body ? bodyStr : undefined, signal: ctrl.signal
    });
    const j = await res.json();
    if (!j || j.code !== '0') return { ok: false, err: 'OKX API: ' + (j && j.msg ? j.msg : '未知错误') + ' (code=' + (j && j.code) + ')' };
    return { ok: true, data: j.data };
  } catch (e) {
    return { ok: false, err: 'OKX API 请求失败: ' + e.message };
  } finally { clearTimeout(timer); }
}

async function balance() { return await call('GET', '/api/v5/account/balance'); }
async function positions(qs) { return await call('GET', '/api/v5/account/positions', qs || { instType: 'SWAP' }); }
// fills-history: OKX 硬上限 limit=100(超过会报 51000 Parameter limit error)
async function fills(limit) {
  let n = parseInt(limit || 100, 10);
  if (!isFinite(n) || n < 1) n = 100;
  if (n > 100) n = 100;
  return await call('GET', '/api/v5/trade/fills-history', { instType: 'SWAP', limit: String(n) });
}

// 全量成交流水: fills-history 单次上限 100, 用 after 参数向前翻页直到取完。
// after = "返回比 after 时间戳更早的记录"; 每次取回后用最小 ts 作为下一次 after。
async function fillsAll(maxPages) {
  const pages = Math.max(1, Math.min(parseInt(maxPages || 20, 10) || 20, 50));
  const all = [];
  const seen = new Set();
  let after = null;
  for (let p = 0; p < pages; p++) {
    const qs = { instType: 'SWAP', limit: '100' };
    if (after) qs.after = String(after);
    const r = await call('GET', '/api/v5/trade/fills-history', qs);
    if (!r.ok) return { ok: false, err: r.err };
    const data = r.data || [];
    if (!data.length) break;
    let oldest = null;
    for (const f of data) {
      const ts = +f.ts;
      if (!isFinite(ts)) continue;
      const key = f.billId || (f.instId + ':' + f.ts + ':' + f.fillPx + ':' + f.fillSz);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(f);
      if (oldest === null || ts < oldest) oldest = ts;
    }
    if (data.length < 100) break;      // 已到最后一页
    if (oldest === null || oldest === after) break;  // 无进展，防死循环
    after = oldest;
  }
  return { ok: true, data: all };
}

module.exports = { call, balance, positions, fills, fillsAll, cred, BASE };
