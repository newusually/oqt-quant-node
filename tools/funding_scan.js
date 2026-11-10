#!/usr/bin/env node
/* funding_scan.js — 实时资金费率扫描: 对冲(carry)机会在哪
 * 逻辑: 现货多 + 永续空 锁价格 → 空头收资金费(费率为正时)
 * 输出: 全合约 funding 排名 + 年化 + 现货永续锁回本时间(往返成本0.3%)
 */
'use strict';
const https = require('https');
function get(url) {
  return new Promise((res, rej) => {
    https.get(url, r => { let s = ''; r.on('data', d => s += d); r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } }); }).on('error', rej);
  });
}
async function main() {
  const T = require('../modules/okx/engines/universe');
  const u = await T.universe();
  const list = ((u && Array.isArray(u.list)) ? u.list : (Array.isArray(u) ? u : [])).map(x => x.instId || x.code).filter(Boolean);
  console.log('universe', list.length);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const inst = list[i];
    try {
      const j = await get('https://www.okx.com/api/v5/public/funding-rate?instId=' + inst);
      const d = j.data && j.data[0];
      if (d && d.fundingRate != null) out.push({ inst, rate: +d.fundingRate });
    } catch (e) { }
    if (i % 10 === 9) await new Promise(r => setTimeout(r, 1100));   /* <20req/2s */
  }
  const ann = r => (r.rate * 3 * 365 * 100);                        /* 年化% */
  const be = r => (0.3 / (r.rate * 3 * 100));                       /* 锁仓往返0.3%成本 → 回本天数 */
  const pos = out.filter(r => r.rate > 0).sort((a, b) => b.rate - a.rate);
  const neg = out.filter(r => r.rate < 0).sort((a, b) => a.rate - b.rate);
  const med = (() => { const s = out.map(r => r.rate).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; })();
  console.log('扫描成功', out.length, '中位数费率', (med * 100).toFixed(4) + '%/8h');
  console.log('=== 做空收资金费 Top15 (现货多+永续空) ===');
  pos.slice(0, 15).forEach(r => console.log(r.inst.padEnd(20), (r.rate * 100).toFixed(4) + '%/8h', '年化' + ann(r).toFixed(0) + '%', '锁仓回本' + be(r).toFixed(1) + '天'));
  console.log('=== 做多收资金费 Top10 (现货空/杠杆卖+永续多) ===');
  neg.slice(0, 10).forEach(r => console.log(r.inst.padEnd(20), (r.rate * 100).toFixed(4) + '%/8h', '年化' + ann(r).toFixed(0) + '%', '锁仓回本' + be(r).toFixed(1) + '天'));
  const btc = out.find(r => r.inst === 'BTC-USDT-SWAP'), eth = out.find(r => r.inst === 'ETH-USDT-SWAP');
  console.log('BTC', btc ? (btc.rate * 100).toFixed(4) + '%/8h 年化' + ann(btc).toFixed(1) + '%' : '-',
    '| ETH', eth ? (eth.rate * 100).toFixed(4) + '%/8h 年化' + ann(eth).toFixed(1) + '%' : '-');
  const fs = require('fs');
  fs.writeFileSync('data/analysis/funding-scan.json', JSON.stringify({ at: Math.floor(Date.now() / 1000), out }, null, 1));
  console.log('SAVED data/analysis/funding-scan.json');
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
