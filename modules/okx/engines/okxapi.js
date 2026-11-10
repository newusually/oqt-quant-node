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
let _credAt = 0;
function cred() {
  // 已读到凭证 → 不再重复读盘；未配置(false) → 每 5 秒重试一次，
  // 这样用户在页面上填写凭证后无需重启服务即可生效。
  const now = Date.now();
  if (_cred === null || (_cred === false && now - _credAt > 5000)) {
    _credAt = now;
    try { _cred = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); } catch (e) { _cred = false; }
  }
  return _cred || null;
}

// 前端「API 设置」保存凭证 → 写入 config/api.json(权限 600, 已被 .gitignore 忽略)
function saveCred(c) {
  const obj = {
    apiKey: String((c && c.apiKey) || '').trim(),
    secret: String((c && c.secret) || '').trim(),
    passphrase: String((c && c.passphrase) || '').trim()
  };
  if (!obj.apiKey || !obj.secret || !obj.passphrase) return { ok: false, err: 'apiKey / secret / passphrase 三项都不能为空' };
  try {
    fs.writeFileSync(CFG_PATH, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(CFG_PATH, 0o600);
  } catch (e) { return { ok: false, err: '凭证写入失败: ' + e.message }; }
  _cred = obj; _credAt = Date.now();
  return { ok: true };
}

function clearCred() {
  try { fs.unlinkSync(CFG_PATH); } catch (e) { }
  _cred = false; _credAt = Date.now();
  return { ok: true };
}

// 状态(仅回显 apiKey 掩码, 绝不回传 secret/passphrase)
function credInfo() {
  const c = cred();
  const k = c && c.apiKey ? c.apiKey : '';
  return {
    ok: true,
    configured: !!c,
    apiKey: k ? (k.slice(0, 6) + '****' + k.slice(-4)) : '',
    path: 'modules/okx/config/api.json'
  };
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

module.exports = { call, balance, positions, fills, fillsAll, cred, credInfo, saveCred, clearCred, BASE };
