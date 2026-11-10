'use strict';
const ROOT = '/home/ubuntu/oqt-quant-node';
async function main(){
  try {
    const RT = require(ROOT + '/modules/okx/engines/realtime');
    const t = await RT.tickers();
    console.log('[REST tickers] ok=', t && t.ok, 'list=', (t&&t.list)?t.list.length:0, 'sample=', (t&&t.list)?JSON.stringify(t.list.slice(0,1)):null);
  } catch(e){ console.log('[REST tickers] ERR', e.message); }
  try {
    const WS = require(ROOT + '/modules/okx/engines/okxws');
    console.log('[okxws] keys=', Object.keys(WS).slice(0,25));
    if (typeof WS.status === 'function') console.log('[okxws] status=', JSON.stringify(WS.status()));
    else if (typeof WS.connected === 'function') console.log('[okxws] connected=', WS.connected());
    else if (typeof WS.snap === 'function') { const s=WS.snap('BTC-USDT-SWAP'); console.log('[okxws] snap BTC=', JSON.stringify(s)); }
  } catch(e){ console.log('[okxws] ERR', e.message); }
  try {
    const WSF = require(ROOT + '/modules/okx/engines/wsfeed');
    console.log('[wsfeed] keys=', Object.keys(WSF).slice(0,25));
    if (typeof WSF.status === 'function') console.log('[wsfeed] status=', JSON.stringify(WSF.status()));
    else if (typeof WSF.snapshot === 'function') { const s=WSF.snapshot(); console.log('[wsfeed] snapshot len=', (s&&s.list)?s.list.length:0); }
  } catch(e){ console.log('[wsfeed] ERR', e.message); }
}
main().then(()=>process.exit(0)).catch(e=>{console.log('FATAL',e.message);process.exit(1);});
