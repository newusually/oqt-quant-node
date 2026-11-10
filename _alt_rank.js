const U = require('/home/ubuntu/oqt-quant-node/modules/okx/engines/universe');
const https = require('https');

function getJSON(url) {
  return new Promise((res, rej) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, r => {
      let s = '';
      r.on('data', d => s += d);
      r.on('end', () => { try { res(JSON.parse(s)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });
}

(async () => {
  await U.universe();
  const a = U.universeSync();
  let pool = [];
  if (Array.isArray(a)) pool = a;
  else if (a && typeof a === 'object') {
    for (const k of Object.keys(a)) {
      const v = a[k];
      if (Array.isArray(v)) pool = pool.concat(v);
    }
  }
  console.log('UNIV total:', pool.length, 'sample:', JSON.stringify(pool[0]));
  // 识别字段
  const k0 = pool[0] || {};
  const keys = Object.keys(k0);
  console.log('fields:', keys.join(','));

  // 山寨池 = 加密永续 剔除 BTC / ETH
  const alt = pool.filter(x => {
    const sym = (x.sym || x.base || x.instId || '').toUpperCase();
    const instId = (x.instId || '').toUpperCase();
    if (sym === 'BTC' || sym === 'ETH') return false;
    if (!instId.endsWith('USDT-SWAP')) return false;
    return true;
  });
  console.log('山寨池(剔除BTC/ETH)数量:', alt.length);

  // 取 OKX 全量 tickers
  const tk = await getJSON('https://www.okx.com/api/v5/market/tickers?instType=SWAP');
  const map = {};
  for (const r of (tk.data || [])) map[r.instId] = r;

  const arr = [];
  for (const x of alt) {
    const r = map[x.instId];
    if (!r) continue;
    const last = parseFloat(r.last);
    const volCcy = parseFloat(r.volCcy24h || '0');   // 本位币数量
    const volC = parseFloat(r.vol24h || '0');          // 合约张数
    const notional = volCcy * last;                    // 真实 USDT 成交额 = 本位币 × 价格
    arr.push({ sym: (x.sym || x.instId), instId: x.instId, last, volCcy, volC, notional, sector: x.sector });
  }
  console.log('有行情数据的山寨合约:', arr.length);

  const byVol = [...arr].sort((p, q) => q.notional - p.notional);
  const byPx = [...arr].sort((p, q) => q.last - p.last);
  const pf = v => (v >= 1 ? v.toFixed(4) : v.toExponential(3));

  console.log('\n=== 量最大(24h 真实USDT成交额) TOP12 ===');
  for (const r of byVol.slice(0, 12))
    console.log(`  ${r.sym.padEnd(8)} 价=${pf(r.last).padStart(15)}  额=${(r.notional/1e9).toFixed(2)}亿USDT  张=${(r.volC/1e6).toFixed(1)}M  板块=${r.sector||'-'}`);

  console.log('\n=== 价格最高 TOP12 ===');
  for (const r of byPx.slice(0, 12))
    console.log(`  ${r.sym.padEnd(8)} 价=${pf(r.last).padStart(15)}  额=${(r.notional/1e9).toFixed(2)}亿USDT  张=${(r.volC/1e6).toFixed(1)}M  板块=${r.sector||'-'}`);
})().catch(e => console.log('ERR', e.message));
