// oqt-quant-node 入口 · 纯 Node 原生 http（不使用 nginx）
// 静态资源根 = 项目根；JSON 接口前缀 = /api/*
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const log = require('./core/log');
// ★进程守护：崩溃捕获 + 心跳 + 优雅退出
//   本项目有 7 个 setInterval 定时器（WS预热/K线保鲜/价格刷新/缓存预热…），
//   任何一个回调抛异常都会成为 uncaughtException → Node 默认直接终止进程。
//   未挂处理器时进程会【静默死亡】，日志里查不到任何原因（这是历史上"服务莫名关闭"的根因）。
const guard = require('./core/guard');
guard.install({ heartbeatMs: 60000 });

// ★单实例锁（2026-10-27）：防止 systemd + 手动 nohup 双开
//   双开的危害实测：OKX 限流翻倍(50011惩罚→下载奇慢) + 同一批 SQLite WAL 锁竞争 + 磁盘写 94% 打满。
//   规则：锁文件里的 PID 还活着 → 本次启动直接退出；锁是残留（旧进程已死）→ 接管。
//   ★判活必须区分 EPERM/ESRCH：非 root 用户对 root 进程 kill 0 报 EPERM——进程活着但没权限。
//   ★锁文件放 /tmp（全局可写）：data 目录 root 所有，ubuntu 用户写不进锁会让防护失效。
const LOCK_FILE = '/tmp/oqt-quant-node.lock';
(function singleInstance() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const oldPid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim(), 10);
      if (oldPid && oldPid !== process.pid) {
        let alive = false;
        try { process.kill(oldPid, 0); alive = true; }
        catch (e) { alive = (e.code === 'EPERM'); }   // EPERM=活着(没权限发信号)；ESRCH=真死了
        if (alive) {
          console.error(`[lock] 已有实例在运行 PID=${oldPid}，本次启动退出。` +
            `重启请用: sudo systemctl restart oqt-quant-node`);
          process.exit(1);
        }
        console.error('[lock] 检测到残留锁（旧进程已死），接管继续');
      }
    }
    fs.writeFileSync(LOCK_FILE, String(process.pid));
    process.on('exit', () => {
      try {
        if (fs.readFileSync(LOCK_FILE, 'utf8').trim() === String(process.pid)) fs.unlinkSync(LOCK_FILE);
      } catch (e) { }
    });
  } catch (e) { console.error('[lock] 锁检查失败(不阻塞启动):', e.message); }
})();

const ROOT = __dirname;
const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

const API_ROUTES = [
  ['/api/okx/', require('./api/okx')],
  // ★统一榜单/面板 API(所有板块页面共用, 组件化取数入口)
  ['/api/boards/', require('./api/boards')],
  // ★全站行情摘要(总览/播报/AI分析共用)
  ['/api/market/', require('./api/market')],
  // 学习园地: B站教学视频搜索代理(服务端 wbi 签名, 前端走官方 iframe 播放)
  ['/api/study/', require('./api/study')]
];

// ★s 模块的云端 TTS 代理(原始音频, 不是 JSON)
//   浏览器直连 translate_tts / dictvoice 会被 Chrome ORB 拦掉(没 CORS 头) → 没声音。
//   服务端转发后再加上 Access-Control-Allow-Origin 给浏览器放行。
const ttsProxy = require('./modules/s/api/tts');
async function handleTts(res, q) {
  const r = await ttsProxy.ttsProxy(q);
  if (!r.ok) {
    const buf = Buffer.from(JSON.stringify(r));
    res.writeHead(r.err && /请求失败/.test(r.err) ? 502 : 400,
      { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
    res.end(buf);
    return;
  }
  res.writeHead(200, {
    'Content-Type': r.contentType || 'audio/mpeg',
    'Content-Length': r.audio.length,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(r.audio);
}

// ★毫秒级行情 SSE: /api/okx/stream —— OKX 公共WS 增量推送(价格变动 ~300ms 批量到达)
//   用户要求"行情毫秒级ws"；EventSource 自动重连, 比轮询实时得多。
function handleOkxStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(': ok\n\n');
  let wsfeed = null;
  try { wsfeed = require('./modules/okx/engines/wsfeed'); } catch (e) {
    res.write('data: ' + JSON.stringify({ ok: false, err: String(e.message || e) }) + '\n\n');
    res.end();
    return;
  }
  const unsub = wsfeed.subscribe(function (payload) {
    try { res.write(payload); } catch (e) { }
  });
  // 20 秒无事件 → 探活一次, 顺带报告连接状态
  const hb = setInterval(function () {
    try {
      const st = wsfeed.stats();
      res.write(': hb ' + JSON.stringify({ c: st.connected, n: st.count }) + '\n\n');
    } catch (e) { }
  }, 20000);
  req.on('close', function () {
    clearInterval(hb);
    try { unsub(); } catch (e) { }
  });
}

// ★实时涨跌家数 SSE: /api/okx/updown-live?grain=5m —— 每秒推送「当前形成中bar + 前一根」
//   前端详细表格顶 2 行据此秒级刷新(其余历史行走预聚合)。复用 stream 的 SSE 头与探活。
function handleUpdownLive(req, res) {
  const q = url.parse(req.url, true).query;
  const grain = (q.grain || '5m');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*'
  });
  res.write(': ok\n\n');
  let mod = null;
  try { mod = require('./modules/okx/engines/liveupdown'); } catch (e) {
    res.write('data: ' + JSON.stringify({ ok: false, err: String(e.message || e) }) + '\n\n');
    res.end();
    return;
  }
  mod.ensureStarted();
  const send = function (tip) { try { res.write('data: ' + JSON.stringify(tip) + '\n\n'); } catch (e) { } };
  // 立即推一次(若已有缓存 tip)
  const init = mod.tip(grain);
  if (init) send(init);
  const unsub = mod.subscribe(grain, send);
  const hb = setInterval(function () { try { res.write(': hb\n\n'); } catch (e) { } }, 20000);
  req.on('close', function () {
    clearInterval(hb);
    try { unsub(); } catch (e) { }
  });
}

// 静态服务黑名单：后端目录/敏感文件禁止通过 HTTP 直接访问（数据、配置、源码、凭证）
// ★2026-10-24 修 s 模块白屏: 原实现用 indexOf 子串匹配, 把 /modules/s/assets/js/core/config.js
//   与 /modules/s/data/ 也拦成 403 → Vue 起不来 → 白屏。
//   改为【只拦项目根下的后端目录】(以 / 开头的一级路径段), 业务模块( modules/*/ )内部不动;
//   凭证类文件(cred/secret/.env)仍全局拦。
// ★凭证目录必须阻断: 里面有 api.json(OKX apiKey/secret/passphrase), 否则任何人都能 GET 下来
const STATIC_BLOCK = ['/data/', '/config/', '/core/', '/lib/', '/engines/', '/services/', '/tools/', '/api/', '/node_modules/', '/modules/okx/config/']; /* ★凭证目录阻断 */
function isBlocked(safe) {
  const s = safe.replace(/\\/g, '/'); // Windows 反斜杠归一化，避免漏拦
  // 只拦「根级」后端目录: 路径必须以 /<blocked>/ 开头
  if (STATIC_BLOCK.some(b => s.startsWith(b))) return true;
  // 业务模块内的同名目录按需拦: modules/<mod>/config|data|core|lib|engines|services|tools
  //   但 s 模块是纯前端站(assets/js/core、data/banks 都是它的公开静态资源) → 放行
  const mm = s.match(/^\/modules\/([^/]+)\//);
  if (mm && mm[1] !== 's') {
    const seg = s.slice(mm[0].length).split('/')[0];
    if (['config', 'data', 'core', 'lib', 'engines', 'services', 'tools'].indexOf(seg) >= 0) return true;
  }
  const base = path.basename(s).toLowerCase();
  if (/cred|secret|\.env/.test(base)) return true;
  if (/\.php$/.test(base)) return true;      // PHP 源码绝不外泄（latest 的 s/tts.php 等）
  return false;
}

function sendJSON(res, obj, code) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code || 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(buf);
}

/* ★活跃度追踪（2026-10-25 CPU 优化）
 *   记录最近一次真实 API 请求时间 → 后台重任务据此判断"用户是否在用"。
 *   没人用时全部重任务自动降频/停止 → CPU 归零。 */
/* ★初始为 0 —— 启动后若没有任何真实请求，就视为"空闲"，
 *   这样服务一启动 CPU 就是 0，等用户真的打开页面才开始预热。 */
let LAST_ACTIVE = 0;
function markActive() { LAST_ACTIVE = Date.now(); }
function isActive(windowMs) {
  if (!LAST_ACTIVE) return false;              // 从没被访问过 → 空闲
  return (Date.now() - LAST_ACTIVE) < (windowMs || 30 * 60 * 1000);
}

// ★读取请求体(JSON)：POST 专用。凭证/密钥这类敏感参数绝不能拼在 URL 上
//   (URL 会被 apache access log / 浏览器历史记录留存)，必须走 POST body。
function readJsonBody(req) {

  if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') return Promise.resolve({});

  return new Promise(function (resolve) {

    var chunks = [], size = 0;

    req.on('data', function (c) {

      size += c.length;

      if (size > 65536) { resolve({}); req.destroy(); return; }

      chunks.push(c);

    });

    req.on('end', function () {

      try { var j = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(j && typeof j === 'object' ? j : {}); }

      catch (e) { resolve({}); }

    });

    req.on('error', function () { resolve({}); });

  });

}

async function handleApi(res, prefix, api, u, q, body) {
  markActive();
  let ep = decodeURIComponent(u.pathname.slice(prefix.length));
  if (!ep || ep === '/') ep = 'status';
  if (ep.endsWith('/')) ep = ep.slice(0, -1);
  try {
    const out = await api.handle(ep, q, body || {});
    sendJSON(res, out || { ok: false, err: 'empty' });
  } catch (e) {
    sendJSON(res, { ok: false, err: String(e && e.stack || e) }, 500);
  }
}

function serveStatic(res, pathname) {
  markActive();
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/web/index.html';
  // 防目录穿越
  const safe = path.normalize(rel).replace(/^(\.\.[\/\\])+/, '');
  if (isBlocked(safe)) { res.writeHead(403); res.end('forbidden'); return; }
  let fp = path.join(ROOT, safe);
  if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.stat(fp, (err, st) => {
    if (st && st.isDirectory()) {
      // 目录 → 优先该目录下的 index.html
      const idx = path.join(fp, 'index.html');
      if (!idx.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
      fp = idx;
    } else if (err || !st || !st.isFile()) {
      // 文件不存在 → 404（★不静默回退总览页: 否则已删除的页面会返回 200，
      //   让调用方误以为页面还在。用户 2026-10-25: "删除...代码也清空并且删除注释和痕迹"）
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found: ' + rel);
      return;
    }
    fs.readFile(fp, (e2, data) => {
      if (e2) { res.writeHead(404); res.end('not found'); return; }
      const ext = path.extname(fp).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  const p = u.pathname;
  // ★s 模块云端 TTS 代理(原始音频)
  if (p === '/api/s/tts') {
    handleTts(res, u.query).catch(e => {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ ok: false, err: String(e && e.message || e) }));
    });
    return;
  }
  // ★毫秒级行情 SSE(OKX 公共WS 增量)
  if (p === '/api/okx/stream') {
    handleOkxStream(req, res);
    return;
  }
  // ★实时涨跌家数 SSE(当前形成中bar + 前一根, WS 秒级)
  if (p === '/api/okx/updown-live') {
    handleUpdownLive(req, res);
    return;
  }
  // API 路由
  for (const [prefix, api] of API_ROUTES) {
    if (p.startsWith(prefix)) {
      readJsonBody(req).then(function (body) { return handleApi(res, prefix, api, u, u.query, body); })
        .catch(e => sendJSON(res, { ok: false, err: String(e) }, 500));
      return;
    }
  }
  serveStatic(res, p);
});

// ★把 HTTP server 暴露给 guard，收到 SIGTERM/SIGINT 时能优雅关闭（而非强杀）
global.__OQT_HTTP_SERVER__ = server;

server.listen(PORT, () => {
  log.info('oqt-quant-node 启动', 'port=' + PORT, 'nginx=off', 'staticRoot=' + ROOT);
  log.info('oqt-quant-node 运行时', 'node=' + process.version, 'exec=' + process.execPath);
  console.log('oqt-quant-node  running  http://127.0.0.1:' + PORT + '  (no nginx)');
  // ★后台预热全市场行情摘要(总览页/播报用) —— 不阻塞启动, 避免首访超时
  setTimeout(() => {
    try {
      require('./modules/okx/engines/market').warm()
        .then(() => console.log('[warm] market summary 已就绪'))
        .catch(e => console.log('[warm] market summary 失败: ' + e.message));
    } catch (e) { }
  }, 2500);
  // ★★★2026-10-26 ★首页播报下方"涨跌家数统计" 依赖 15m 三个月历史
  //   当前 15m 库只有少数合约 → 启动后静默后台回填（断点续传, 不阻塞启动）
  //   用户需求: "总共三个月 每15分钟计算 我搜索的这些 OKX 合约 200 多"
  setTimeout(() => {
    (async () => {
      try {
        const T = require('./modules/okx/engines/universe');
        const BF = require('./modules/okx/engines/backfill');
        const u = await T.universe();
        if (!u.ok || !u.list || !u.list.length) { console.log('[ud15m] universe 未就绪, 回填跳过'); return; }
        const list = u.list.map(x => ({ instId: x.instId }));
        console.log('[ud15m] 启动 15m 一年后台回填(尽力拉到OKX数据尽头), ' + list.length + ' 个合约（断点续传, 下载中不影响在线）');
        /* ★2026-10-26 降并发: node:sqlite 同步写入会阻塞主事件循环, concurrency 6×多调度=全站卡20s
         *   → 降到 2, 保证在线请求(板块/涨跌/信号)不被堵死
         * ★2026-10-27 用户: "尽力查询最近一年数据 如果真的是新币就查询最远的数据返回就行 不要超过边界"
         *   → days 90→365: 尽力拉一年; OKX 实际只保留 ~100 天, 拉到尽头 done+floor 标记,
         *     之后重启/重跑全部秒过, 不越界不重拉 */
        BF.runBatch({ kind: 'kline', grain: '15m', days: 365, list, jobKey: 'ud15m', concurrency: 4 })
          .then(r => console.log('[ud15m] 回填完成: ' + JSON.stringify(r.ok ? r.job : r)))
          .catch(e => console.log('[ud15m] 回填异常: ' + (e && e.message || e)));
      } catch (e) {
        console.log('[ud15m] 回填启动失败: ' + (e && e.message || e));
      }
    })();
  }, 15000);
  // ★★★2026-10-26 BTC涨跌家数买卖信号用：3m/2h/4h 周期K线后台回填
  //   需求: "计算15分钟 5分钟 3分钟 1小时 2小时 4小时的买卖信号"
  //   启动后为全市场回补 3m(短周期)/2h/4h(长周期)，断点续传，不阻塞在线
  setTimeout(() => {
    (async () => {
      try {
        const T = require('./modules/okx/engines/universe');
        const BF = require('./modules/okx/engines/backfill');
        const u = await T.universe();
        if (!u.ok || !u.list || !u.list.length) { console.log('[sigbf] universe 未就绪, 信号周期回补跳过'); return; }
        const list = u.list.map(x => ({ instId: x.instId }));
        /* ★2026-10-26 三周期串行(不并发)+低并发2: 避免24路同步sqlite写阻塞主线程
         * ★2026-10-27 days 90→365: 尽力拉一年, OKX 尽头即停(floor 标记防越界重拉) */
        for (const g of ['1h', '2h', '4h', '3m', '5m']) {
          try {
            const r = await BF.runBatch({ kind: 'kline', grain: g, days: 365, list, jobKey: 'sigbf:' + g, concurrency: 4 });
            console.log('[sigbf:' + g + '] 回填完成: ' + JSON.stringify((r && r.job) ? r.job : r));
          } catch (e) {
            console.log('[sigbf:' + g + '] 回填异常: ' + (e && e.message || e));
          }
          /* 周期间隔让主线程喘气（写库不再挤占在线请求） */
          await new Promise(r => setTimeout(r, 3000));
        }
      } catch (e) {
        console.log('[sigbf] 信号周期回补启动失败: ' + (e && e.message || e));
      }
    })();
  }, 30000);

  /* ★2026-10-28 启用「涨跌家数预聚合库」(updownstore) —— 总览详细表格提速 40 倍
   *   缘起: updownstore.build/agg 早在 10-26 就写好了, 但全项目**零调用点**,
   *         预计算表永远是空的 → updown.js 每次请求都退化成实时扫描
   *         287 合约 × 18001 根 ≈ 517 万行, 实测 3m 36 秒 / 5m 43 秒。
   *         用户体感: "详细表格特别慢、切换分时特别慢"。
   *   修法: 启动 5 分钟后(避开启动高峰)串行构建; 之后每 30 分钟重建一次。
   *   顺序: 15m/1h/2h/4h 数据量小先建(用户最常用), 5m/3m 放最后(行数最多)。
   *   build 内部已加 setImmediate 让出主线程, 构建期间在线请求不受影响。 */
  {
    const AGG_GRAINS = ['15m', '1h', '2h', '4h', '5m', '3m'];
    let aggBuilding = false;
    async function buildAggAll(tag, grains) {
      if (aggBuilding) { console.log('[agg] 上一轮仍在构建, 跳过(' + tag + ')'); return; }
      aggBuilding = true;
      const t0 = Date.now();
      try {
        const UDST = require('./modules/okx/engines/updownstore');
        const list = (grains && grains.length) ? grains : AGG_GRAINS;
        for (const g of list) {
          try {
            const r = await UDST.build(g);
            if (r && r.ok) {
              console.log('[agg] ' + g + ' 构建完成: 片数=' + r.slices + ' 合约=' + r.contracts +
                ' 耗时=' + r.ms + 'ms (' + tag + ')');
            } else {
              console.log('[agg] ' + g + ' 构建失败: ' + JSON.stringify(r));
            }
          } catch (e) {
            console.log('[agg] ' + g + ' 构建异常: ' + ((e && e.message) || e));
          }
          await new Promise(r => setTimeout(r, 5000));   // 周期间隔, 别把 IO 打满
        }
        console.log('[agg] 构建结束(' + ((grains && grains.length) ? '部分:' + grains.join('/') : '全量') + '), 总耗时 ' + Math.round((Date.now() - t0) / 1000) + 's (' + tag + ')');
      } finally {
        aggBuilding = false;
      }
    }
    setTimeout(function () { buildAggAll('boot').catch(function () { }); }, 300000);
    // ★2026-10-28: 短周期(3m/5m/15m)每5分钟重建, 满足"5分钟内补完"需求(长周期变化慢, 走低频省IO)
    setTimeout(function () {
      setInterval(function () { buildAggAll('fast', ['3m', '5m', '15m']).catch(function () { }); }, 300000);
    }, 350000);
    // 长周期(1h/2h/4h)保持30分钟, 变化慢且省IO
    setInterval(function () { buildAggAll('slow', ['1h', '2h', '4h']).catch(function () { }); }, 1800000);
  }

  // ★回补进度缓存预热: 6 个周期每 100s 后台重算一次 progress(),
  //   保证前端「分时段查询 / 切换周期」永远命中 CACHE_TTL(120s) 缓存(0.x 秒),
  //   不再因缓存过期触发冷计算(~2.5s)而感觉"切换慢 / 查询慢"。
  //   (statOne 已改为只读首末月片, 冷计算从 10.8s 降到 ~2.5s; 再加热使其近乎即时)
  (function prewarmProgress() {
    const mod = require('./modules/okx/engines/backfillprogress');
    const tick = function () {
      for (const g of (mod.GRAINS || [])) {
        try { const p = mod.progress({ grain: g }); if (p && p.catch) p.catch(function () { }); } catch (e) { }
      }
    };
    tick();
    setInterval(tick, 100000);
  })();

  // ★K线保鲜员: 每 30s 给最近浏览过的合约拉最新K线落库
  //   (主图形成中K线由前端 SSE 实时拼; 这里保证已收线的K线持续入库, 60s 对账重载有真实数据可拿)
  setInterval(() => {
    /* ★空闲时把保鲜周期拉长（用户不在 → 不需要每 30 秒拉一次） */
    const idle = !isActive();
    if (idle && Math.random() > 0.2) return;   // 空闲时 1/5 概率执行
    try {
      require('./modules/okx/engines/kline').keepLatest().catch(() => { });
    } catch (e) { }
  }, 30000);

  /* ★2026-10-26 全市场 5m 保鲜已并入下方「统一串行轮转链」（原来独立 3 分钟周期
   *   占空比 67%, 是其它分时保鲜 busy 丢失的根源 → 统一串行后 5m/15m/3m/2h/4h 都保鲜） */

  /* ★2026-10-26 全分时保鲜（用户: "不仅15分 5分 3分 等这些分时选项卡都要"）
   *   15m/3m/2h/4h 串行轮转: 每 5 分钟跑一个周期（287合约一轮约2分钟, 限流安全;
   *   串行 setTimeout 链永不 busy 撞自己）→ 每个周期每 20 分钟追新一次。
   *   5m 由上方「全市场保鲜」每 3 分钟独立负责。
   *   背景: 原来只有启动时一轮回填, 服务运行越久所有分时库越旧,
   *   统计/信号全部基于陈旧K线（实测 BTC 15m 滞后 3 小时）。 */
  async function keepGrain(grain, tag, retry) {
    try {
      const T = require('./modules/okx/engines/universe');
      const KL = require('./modules/okx/engines/kline');
      const u = await T.universe();
      if (!u.ok || !u.list || !u.list.length) return;
      const r = await KL.keepAllMarket(u.list.map(x => x.instId), grain);
      /* ★busy(撞上其它保鲜) → 30s 后重试, 最多 6 次（原只 1 次, 高占空比下整轮丢失） */
      if (r && !r.ok && r.err === 'busy') {
        const n = (retry || 0);
        if (n < 6) setTimeout(() => keepGrain(grain, tag, n + 1), 30000);
        return;
      }
      if (r && r.got) console.log('[kline] ' + (tag || grain) + ' 保鲜 ' + r.got + ' 个 / ' + (r.fail || 0) + ' 失败');
    } catch (e) { }
  }
  /* ★统一串行轮转链: 一个链管全部分时（永不 busy 撞自己）
   *   序列里 5m 出现两次 → 5m 每 24 分钟追新两次, 其余每 24 分钟一次;
   *   启动 90s 后先给每个周期各补一轮（换机/重启快速追齐）, 再进入常轮转 */
  (function keepLoop() {
    const SEQ = ['3m', '5m', '15m', '3m', '5m', '1h', '2h', '4h'];
    let i = 0;
    const tick = () => {
      setTimeout(async () => {
        /* ★空闲时降频(1/3 概率)而非完全跳过——原 isActive 全跳导致空闲期间
         *   分时库彻底停更(实测 15m 停 45 分钟), 用户打开页面看到陈旧统计 */
        if (isActive() || Math.random() < 0.6) await keepGrain(SEQ[i++ % SEQ.length], '分时保鲜');
        else i++;
        tick();
      }, isActive() ? 100000 : 240000);
    };
    setTimeout(async () => {
      try {
        for (const g of ['15m', '5m', '3m', '1h', '2h', '4h']) {
          await keepGrain(g, '启动补' + g);
        }
      } catch (e) { }
      tick();
    }, 90000);
  })();

  /* ★2026-10-25 关系核实引擎后台预热（板块涨跌↔takervol↔买卖信号）
   *   核实要读全部 K线库 → 冷启 3 秒（连接池后），仍不宜放请求链路
   *   → 启动后异步算好并缓存，页面 AJAX 秒开 */
  setTimeout(() => {
    try {
      const REL = require('./modules/okx/engines/relation');
      REL.warm({ bars: 120 }).then(function (r) {
        console.log('[relation] 关系核实预热 ' + (r.ok ? '完成' : '失败') + ' ' + r.ms + 'ms / 合约 ' + r.contracts);
      }).catch(function (e) { console.log('[relation] 预热失败: ' + (e && e.message || e)); });
    } catch (e) { }
  }, 120000);      // 2 分钟（等全市场 K线保鲜先跑完一轮）
  setInterval(() => {
    /* ★空闲时降频 */
    if (!isActive() && Math.random() > 0.33) return;
    try {
      require('./modules/okx/engines/relation').warm({ bars: 120 })
        .catch(function () { });
    } catch (e) { }
  }, 300000);      // 5 分钟

  /* ★2026-10-25 全站行情改走【统一 WebSocket 引擎】(用户: "能不能全部使用ws")
   *   - tickers 频道: 全量合约 → 价格/当日1D涨跌(sodUtc8)/成交额 全在内存
   *   - trades  频道: 活跃标的 → 逐笔成交本地分桶 → 30s/1m/5m/15m taker 买卖比例
   *   → API 读内存即可, 毫秒级响应、零 REST 配额、彻底不受 OKX REST 限流影响
   *   (绝不用多IP伪造绕过限流: 违反服务条款会被封 IP 段) */
  setTimeout(() => {
    (async () => {
      try {
        const T = require('./modules/okx/engines/universe');
        const WS = require('./modules/okx/engines/okxws');
        if (WS.isStarted()) return;
        const u = await T.universe(true);
        const ids = (u.list || []).map(x => x.instId);
        /* ★2026-10-25 用户: "08:45:00 买100%/卖0% 时间延长了5分钟 没有秒级的更新吗"
         *   → trades 频道从「加密 top20」扩展到【全市场】
         *   作用：okxws 内置 30 秒分桶 trades 聚合 → 可给出【30秒 / 1分钟】秒级滚动的
         *        takervol（rubik REST 只有 5 分钟粒度，做不到秒级）
         *   负载：okxws 每条成交只做一次 JSON.parse + 桶累加，实测可控 */
        await T.quotesAll(true);   // 预热行情缓存（副作用保留，q 已无人用）
        /* ★启动时只订阅核心合约（CPU 优化）
       *   全量 287 合约 × 2 频道 = 574 订阅 → 每秒 1200+ 消息 → CPU 20~80%。
       *   改为：启动只订 12 个核心合约，用户访问页面后自动恢复全量。 */
      const CORE = ['BTC','ETH','SOL','XRP','BNB','DOGE','ADA','AVAX','LINK','DOT','TRX','TON'];
        // ★全市场 trades 订阅（秒级 taker 数据源）；加密成交极频繁的先取 top120，其余全订阅
        /* ★CPU 优化（2026-10-25 实测）：
         *   原来 ids(287) + tradeIds(287) = 574 订阅 → 每秒 1200+ 条消息
         *   → 进程常驻 20~84% CPU，而用户根本没在看页面。
         *   现在：启动只订 12 个核心合约（24 订阅），
         *   全量列表交给 okxws 保存，用户访问页面时自动 exitIdleMode() 恢复全量。 */
        const coreSet = new Set(CORE.map(sym => {
          const hit = (u.list || []).find(x => x.sym === sym);
          return hit ? hit.instId : null;
        }).filter(Boolean));
        const startIds = ids.filter(x => coreSet.has(x));
        const startTrades = startIds.slice();
        /* 全量列表传给 okxws（供 exitIdleMode 恢复） */
        const r = WS.start(startIds, startTrades, ids);
        console.log('[ws] 行情WS启动（核心订阅模式） ' + JSON.stringify(r));
      } catch (e) {
        console.log('[ws] 启动失败: ' + (e && e.message || e));
      }
    })();
  }, 3000);

  /* ★2026-10-26 taker 已删除：不再下载 taker-volume、不再落库、不再排行
   *   相关 engine 文件(takerdb/takerws)、UI(takerall)、DB(taker.sqlite) 均已移除 */

  /* ★2026-10-25 第三轮：板块价格曲线后台预热
   *   冷读全市场 5m K线库实测 9.1 秒 → 绝不能放在请求链路上
   *   → 启动后异步把各板块的价格曲线算好（内存缓存 60s），首访即可秒开
   *   每 10 分钟刷新一次（K线库在保鲜员作用下会持续增长） */
  setTimeout(() => {
    try {
      const FL = require('./modules/okx/engines/flow');
      const T = require('./modules/okx/engines/universe');
      T.universe().then(function (u) {
        if (!u.ok) return;
        const sids = (u.sectors || []).map(s => s.id);
        return FL.warmPrice(sids).then(function (n) {
          console.log('[flow] 板块价格曲线预热完成 ' + n + ' 个板块');
        });
      }).catch(function (e) { console.log('[flow] 预热失败: ' + (e && e.message || e)); });
    } catch (e) { }
  }, 8000);      // 8 秒（尽早开始预热，实测全量板块约 50 秒）
  setInterval(() => {
    /* ★空闲时跳过 */
    if (!isActive()) return;
    try {
      const FL = require('./modules/okx/engines/flow');
      const T = require('./modules/okx/engines/universe');
      T.universe().then(function (u) {
        if (!u.ok) return;
        return FL.warmPrice((u.sectors || []).map(s => s.id));
      }).catch(function () { });
    } catch (e) { }
  }, 600000);     // 10 分钟

  /* ★2026-10-25 第六轮：三个月双曲线 / 信号验证 / 加密货币双面板 后台预热
   *   实测冷读：maindual 2.4s / signal 2.3s / cryptopanels 2.1s
   *   → 首页 8+ 个面板并发时，后到的请求会排队甚至超时 → 必须预热
   *
   * ★★ CPU 优化（2026-10-25 16:30 实测修复）：
   *   原来每 90 秒全量预热 4 项（其中 mainDual 2160 根 = 287 合约 × 2160 根
   *   的 SQLite 聚合），实测让进程常驻占 CPU 21~84% —— 而用户根本没在用。
   *   修法（三管齐下）：
   *     ① 周期 90s → 5 分钟（预热只为"用户点开时秒开"，5 分钟足够）
   *     ② 拆分轻重：最重的 2160 根历史单独放 15 分钟周期
   *     ③ 互斥 + 空闲检测：上一轮没跑完就跳过；且只在有真实请求后 30 秒才启动
   */
  var warmBusy = false;
  var warmLastHit = Date.now();     // 最近一次真实请求时间

  function warmV6(heavy) {
    if (warmBusy) return Promise.resolve();   // 上一轮还没跑完 → 跳过
    warmBusy = true;
    try {
      const P3 = require('./modules/okx/engines/panel3');
      /* 预热覆盖：默认窗口(100根) + 各板块默认窗口
       * → 用户切板块/点「三个月全览」时全部命中缓存 */
      const tasks = [
        P3.mainDual({ sector: '', grain: '1h', bars: 100 }),
        P3.cryptoPanels({ grain: '1h' })
      ];
      /* 最重的「三个月全览」(2160 根) 单独放慢周期 */
      if (heavy) {
        tasks.push(P3.mainDual({ sector: '', grain: '1h', bars: 2160 }));
      }
      return Promise.all(tasks).then(function (r) {
        var ok = r.filter(x => x && x.ok).length;
        console.log('[v6] 预热 ' + ok + '/' + r.length + ' 项（' +
          (heavy ? '含2160根历史' : '轻量') + '）');
      }).catch(function (e) {
        console.log('[v6] 预热异常: ' + (e && e.message || e));
      }).finally(function () {
        warmBusy = false;
      });
    } catch (e) {
      warmBusy = false;
      return Promise.resolve();
    }
  }

  /* ★空闲检测：只有在"用户最近用过"之后才继续预热
   *   完全没人用 → 停止一切预热 → CPU 降到 0 */
  function warmIdle() {
    // 30 分钟没有任何真实请求 → 认为用户不在，停止预热
    if (Date.now() - warmLastHit > 30 * 60 * 1000) return;
    warmV6(false);
  }

  /* ★启动后不立即跑重预热 —— 等用户真的访问过页面再预热（否则开机就烧 CPU） */
  setTimeout(function () { if (isActive()) warmV6(true); }, 20000);
  setInterval(function () { warmIdle(); }, 300000);   // 5 分钟（轻量预热，仅活跃时）

  /* ★WS 空闲模式（2026-10-25 CPU 优化实测）
   *   全量订阅 574 项 → 每秒 1200+ 条消息 → 常驻 16~84% CPU。
   *   用户 3 分钟没访问页面 → 只保留 12 个核心合约的订阅；
   *   一访问立刻恢复全量。 */
  var wasActive = null;   // null=未知，首次只同步状态不切换
  setInterval(function () {
    const act = isActive(3 * 60 * 1000);   // 3 分钟活跃窗口
    if (act === wasActive) return;
    const first = (wasActive === null);
    wasActive = act;
    try {
      const WS = require('./modules/okx/engines/okxws');
      if (first) {
        /* 首次同步：服务刚启动时默认全量（此时 WS 刚起来），
           只有已经空闲很久才降到核心订阅 */
        if (!act) WS.enterIdleMode();
        return;
      }
      if (act) WS.exitIdleMode();
      else WS.enterIdleMode();
    } catch (e) { }
  }, 30000);
  setInterval(function () { warmV6(true); }, 900000); // 15 分钟（重历史）
});
