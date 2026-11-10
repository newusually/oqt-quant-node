/* 04-ws.js — 采集层：OKX WebSocket 与合约池
 * 本文件由分层组合器 flowtrack.js 载入，与其他层共享同一执行作用域。
 * 请勿单独 require；改动后运行 node --check 与桩测试。 */
/* ============================== 数据采集 ============================== */
function isStableInst(instId) {
  const base = String(instId || '').split('-')[0].toUpperCase();
  return STABLE_BASES.indexOf(base) >= 0;
}

async function loadUniverse() {
  try {
    const r = await fetch(CFG.HTTP_BASE + '/api/v5/public/instruments?instType=SWAP');
    const j = await r.json();
    if (j && j.code === '0' && Array.isArray(j.data)) {
      const list = j.data
        .filter(x => x.instType === 'SWAP' && x.settleCcy === 'USDT' && x.state === 'live')
        .map(x => x.instId)
        .filter(x => !isStableInst(x));
      if (list.length > 50) return list;
    }
  } catch (e) { console.error('[ft] instruments REST 失败:', e.message); }
  try {
    const p = path.join(CFG.DB_DIR, '..', 'okx', 'instruments', 'instruments.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const arr = Array.isArray(j) ? j : (j.data || []);
    return arr.filter(x => x.instType === 'SWAP' && x.settleCcy === 'USDT')
      .map(x => x.instId).filter(x => !isStableInst(x));
  } catch (e) { console.error('[ft] 本地 instruments 兜底失败:', e.message); }
  return [];
}

function onBook(instId, d) {
  let b = books.get(instId);
  if (!b) { b = { bids: [], asks: [], ts: 0 }; books.set(instId, b); }
  b.bids = d.bids || [];
  b.asks = d.asks || [];
  b.ts = +d.ts || Date.now();
  ws.booksMsgs++;
}

function onTrade(d) {
  const instId = d.instId;
  const sz = +d.sz, px = +d.px, ts = +d.ts || Date.now();
  if (!isFinite(sz) || sz <= 0) return;
  lastPx.set(instId, px);
  recordPx(instId, px, ts, 'trade');
  let t = taker.get(instId);
  if (!t) { t = { b: [] }; taker.set(instId, t); }
  const bi = Math.floor(ts / CFG.SCAN_MS);
  let cur = t.b.length ? t.b[t.b.length - 1] : null;
  if (!cur || cur.i !== bi) {
    cur = { i: bi, buy: 0, sell: 0 };
    t.b.push(cur);
    while (t.b.length > CFG.TAKER_BUCKETS) t.b.shift();
  }
  if (d.side === 'buy') cur.buy += sz; else cur.sell += sz;
  ws.tradeMsgs++;
}

function onMsg(m) {
  ws.msgs++;
  if (m.event === 'error') { ws.err++; return; }
  if (!m.arg || !m.data) return;
  const ch = m.arg.channel;
  if (ch === 'books5') { for (const d of m.data) onBook(d.instId, d); }
  else if (ch === 'trades') { for (const d of m.data) onTrade(d); }
}

function openConn(args, idx) {
  let sock;
  try { sock = new WebSocket(CFG.WS_URL); }
  catch (e) { console.error('[ft] WS 创建失败:', e.message); return null; }
  const conn = { sock, idx, args, alive: false, ping: null };
  ws.conns[idx] = conn;
  const send = (o) => { try { if (sock.readyState === 1) sock.send(typeof o === 'string' ? o : JSON.stringify(o)); } catch (e) { } };
  sock.onopen = () => {
    conn.alive = true;
    for (let i = 0; i < args.length; i += 50) send({ op: 'subscribe', args: args.slice(i, i + 50) });
  };
  sock.onmessage = (ev) => {
    if (ev.data === 'pong') return;
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    onMsg(m);
  };
  sock.onerror = () => { ws.err++; };
  sock.onclose = () => {
    conn.alive = false;
    if (conn.ping) { clearInterval(conn.ping); conn.ping = null; }
    setTimeout(() => { if (ws.conns[idx] === conn) { ws.reconnect++; openConn(args, idx); } }, 2500);
  };
  conn.ping = setInterval(() => { try { if (sock.readyState === 1) send('ping'); } catch (e) { } }, CFG.PING_MS);
  return conn;
}

function startWs() {
  const args = [];
  for (const id of universe) {
    args.push({ channel: 'books5', instId: id });
    args.push({ channel: 'trades', instId: id });
  }
  const n = Math.min(16, Math.ceil(args.length / CFG.SUB_PER_CONN));
  for (let i = 0; i < n; i++) openConn(args.slice(i * CFG.SUB_PER_CONN, (i + 1) * CFG.SUB_PER_CONN), i);
  ws.subs = args.length;
  console.log(`[ft] WS 启动: ${universe.length} 合约 × 2 频道 = ${args.length} 订阅, ${n} 条连接`);
}

async function pollDeep() {
  if (!deepList.length || !db) return;
  const ins = db.prepare('INSERT INTO depth(ts,inst_id,imb10,bid10,ask10,imb10w) VALUES(?,?,?,?,?,?)');
  for (const id of deepList) {
    try {
      const r = await fetch(CFG.HTTP_BASE + '/api/v5/market/books?instId=' + encodeURIComponent(id) + '&sz=10');
      const j = await r.json();
      if (j && j.code === '0' && j.data && j.data[0]) {
        const d = j.data[0];
        const bs = (d.bids || []).slice(0, 10).reduce((s, x) => s + (+x[1] || 0), 0);
        const as = (d.asks || []).slice(0, 10).reduce((s, x) => s + (+x[1] || 0), 0);
        const tot = bs + as;
        const imb10 = tot > 0 ? (bs - as) / tot : 0;
        let bw = 0, aw = 0;
        const dd = CFG.WEIGHT_DECAY;
        (d.bids || []).slice(0, 10).forEach((x, i) => { bw += (+x[1] || 0) / (1 + dd * i); });
        (d.asks || []).slice(0, 10).forEach((x, i) => { aw += (+x[1] || 0) / (1 + dd * i); });
        const tw = bw + aw;
        const imb10w = tw > 0 ? (bw - aw) / tw : 0;
        deepStat.imb10Sum += imb10; deepStat.imb10N++; deepStat.ok++;
        ins.run(Date.now(), id, +imb10.toFixed(6), bs, as, +imb10w.toFixed(6));
      } else deepStat.fail++;
    } catch (e) { deepStat.fail++; }
    await new Promise(r => setTimeout(r, CFG.DEEP_GAP_MS));
  }
}

