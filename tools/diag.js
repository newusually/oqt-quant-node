'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const ROOT = '/home/ubuntu/oqt-quant-node';
const now = Date.now();
function pct(ms){ return ((now-ms)/60000).toFixed(1)+' min ago'; }
try {
  const db = new DatabaseSync(path.join(ROOT,'data/okx/updown.sqlite'));
  for (const g of ['1m','3m','5m','15m','1h']) {
    const r = db.prepare('SELECT max(ts) m, count(*) c, max(total) mt FROM updown WHERE grain=?').get(g);
    console.log('[breadth '+g+'] latest='+(r.m?pct(r.m)+' ('+new Date(r.m).toISOString().slice(0,16)+')':'?')+' rows='+r.c+' total_max='+r.mt);
  }
} catch(e){ console.log('[breadth] ERR', e.message); }
try {
  const KS = require(path.join(ROOT,'modules/okx/engines/kstore'));
  for (const g of ['1m','3m','5m','15m']) {
    let ch; try { ch = KS.readChain(g, 'BTC-USDT-SWAP', 0, 1); } catch(e){ console.log('[BTC '+g+'] readChain ERR',e.message); continue; }
    if (!ch.length) { console.log('[BTC '+g+'] no chain'); continue; }
    const db = KS.roOpen(ch[0]);
    if (!db) { console.log('[BTC '+g+'] cannot open '+ch[0]); continue; }
    const r = db.prepare('SELECT max(ts) m, count(*) c FROM kline').get();
    console.log('[BTC '+g+'] latest='+(r.m?pct(r.m)+' ('+new Date(r.m).toISOString().slice(0,16)+')':'?')+' rows='+r.c);
  }
} catch(e){ console.log('[BTC kline] ERR', e.message); }
