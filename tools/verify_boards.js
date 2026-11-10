/* 验收(2026-10-25 本轮): 美股/ETF/商品板块 · 1D当日口径 · 1m/5m分时榜 · 左右对称 · 图表 · 组件复用
 * 用法: NODE_PATH=C:\Users\Administrator\.workbuddy\binaries\node\workspace\node_modules node tools/verify_boards.js
 */
/* puppeteer-core 解析：优先用项目内 E 盘副本（tools/puppeteer/node_modules），
 * 避免依赖 C 盘 WorkBuddy 运行时目录 */
const path = require('path');
function loadPuppeteer() {
  const local = path.join(__dirname, 'puppeteer', 'node_modules', 'puppeteer-core');
  try { return require(local); } catch (e) { }
  try { return require('puppeteer-core'); } catch (e) {
    throw new Error('puppeteer-core 未找到。请先执行: cd tools/puppeteer && npm install puppeteer-core');
  }
}
const puppeteer = loadPuppeteer();
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://127.0.0.1:8080';
let fail = 0;
const log = (ok, m) => { if (!ok) fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + m); };

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--window-size=1700,1500']
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1680, height: 1400 });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });

  await p.goto(BASE + '/web/index.html', { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise(r => setTimeout(r, 16000));   // 等 WS 面板首屏 + 各组件挂载

  console.log('【总览 web/index.html · 2026-10-25 美股化改造】');

  /* ---- 1. 板块卡片 ---- */
  const c = await p.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.mk-card'));
    return {
      n: cards.length,
      names: cards.map(x => {
        const nm = x.querySelector('.mk-name');
        return nm ? nm.textContent.trim() : '';
      }),
      pxs: cards.map(x => (x.querySelector('.mk-px') || {}).textContent || ''),
      pcts: cards.map(x => (x.querySelector('.mk-pct') || {}).textContent || ''),
      ws: (document.getElementById('lb-ws') || {}).textContent || ''
    };
  });
  log(c.n >= 8, '板块卡片 ' + c.n + ' 张');
  log(c.names.some(n => /美股/.test(n)) && c.names.some(n => /ETF/.test(n)) && c.names.some(n => /贵金属|能源/.test(n)),
    '板块含 美股/ETF/贵金属能源: ' + JSON.stringify(c.names.slice(0, 5)));
  log(c.pxs.filter(x => /\d/.test(x)).length >= 8, '卡片价格已填充: ' + JSON.stringify(c.pxs.slice(0, 4)));
  log(/WS/.test(c.ws), 'WS 状态条: ' + c.ws);

  /* ---- 2. 板块标签 + 面板 ---- */
  const t = await p.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('.sct-tab'));
    return {
      n: tabs.length,
      names: tabs.map(x => x.textContent.trim()),
      on: (tabs.filter(x => x.classList.contains('on'))[0] || {}).textContent || '',
      panel: !!document.getElementById('sect-panel'),
      hasPanelDom: document.querySelectorAll('#sect-panel .pn-hd').length
    };
  });
  log(t.n >= 8, '板块标签 ' + t.n + ' 个: ' + JSON.stringify(t.names.slice(0, 6)));
  log(t.hasPanelDom > 0, '面板组件已挂载: ' + t.on);

  /* ---- 3. ★左右对称双榜（核心布局要求） ---- */
  const bd = await p.evaluate(() => {
    const pairs = Array.from(document.querySelectorAll('#sect-panel .bd-pair'));
    if (!pairs.length) return { n: 0 };
    const a = pairs[0];
    const boxes = a.querySelectorAll(':scope > .bd-box');
    const cols = getComputedStyle(a).gridTemplateColumns.split(' ').filter(Boolean);
    const L = boxes[0] ? boxes[0].querySelectorAll('.bd-row').length : 0;
    const R = boxes[1] ? boxes[1].querySelectorAll('.bd-row').length : 0;
    const lr = boxes[0] ? boxes[0].getBoundingClientRect() : null;
    const rr = boxes[1] ? boxes[1].getBoundingClientRect() : null;
    return {
      n: pairs.length, cols: cols.length, colsTxt: cols.join(' | '),
      L, R,
      // ★左右对称: 两列宽度相等(±2px) 且 顶部对齐
      sameW: lr && rr ? Math.abs(lr.width - rr.width) < 2 : false,
      sameTop: lr && rr ? Math.abs(lr.top - rr.top) < 2 : false,
      sameRow: lr && rr ? Math.abs(lr.top - rr.top) < 4 && rr.left > lr.left : false,
      upTag: boxes[0] ? (boxes[0].querySelector('.bd-tag') || {}).textContent : '',
      dnTag: boxes[1] ? (boxes[1].querySelector('.bd-tag') || {}).textContent : ''
    };
  });
  log(bd.n > 0, '面板内存在左右双榜 ' + bd.n + ' 组');
  log(bd.cols === 2, '双榜为两列 grid: ' + bd.colsTxt);
  log(bd.L > 0 && bd.R > 0, '左(涨幅)' + bd.L + '行 / 右(跌幅)' + bd.R + '行');
  log(bd.sameW && bd.sameTop, '★左右对称: 等宽=' + bd.sameW + ' 同行对齐=' + bd.sameTop);
  log(/涨幅榜/.test(bd.upTag || '') && /跌幅榜/.test(bd.dnTag || ''), '左=' + bd.upTag + ' 右=' + bd.dnTag);

  /* ---- 4. 榜单类型齐全（1D/5m/1m） ---- */
  const kinds = await p.evaluate(() => {
    const tags = Array.from(document.querySelectorAll('#sect-panel .bd-tag')).map(x => x.textContent.trim());
    const subs = Array.from(document.querySelectorAll('#sect-panel .bd-sub')).map(x => x.textContent.trim());
    return { tags, subs };
  });
  log(kinds.tags.filter(x => /涨幅榜/.test(x)).length >= 3, '涨跌幅榜 ≥3 组(1D/5m/1m): ' + JSON.stringify(kinds.tags));
  log(kinds.subs.some(x => /当日1D/.test(x)), '含【当日1D】口径: ' + JSON.stringify([...new Set(kinds.subs)]));
  log(kinds.subs.some(x => /5分钟/.test(x)) && kinds.subs.some(x => /1分钟/.test(x)), '含 5分钟/1分钟 分时榜');

  /* ---- 5. 图表（每板块多种） ---- */
  const ch = await p.evaluate(() => {
    const cs = Array.from(document.querySelectorAll('#sect-panel .pn-ch-bx canvas'));
    const titles = Array.from(document.querySelectorAll('#sect-panel .pn-ch-t')).map(x => x.textContent.trim());
    return { n: cs.length, w: cs[0] ? cs[0].getBoundingClientRect().width : 0, titles };
  });
  log(ch.n >= 3, '面板内图表 ' + ch.n + ' 个(复用 EKit): ' + JSON.stringify(ch.titles));
  log(ch.w > 100, '图表已布局 宽=' + Math.round(ch.w) + 'px');

  /* ---- 6. 三列榜单 ---- */
  const rk = await p.evaluate(() => ({
    hot: document.querySelectorAll('#rk-hot .bd-row').length,
    fast: document.querySelectorAll('#rk-fast .bd-row').length,
    lose: document.querySelectorAll('#rk-lose .bd-row').length
  }));
  log(rk.hot > 0 && rk.fast > 0 && rk.lose > 0, '三榜: 当日涨幅' + rk.hot + ' / 5分钟' + rk.fast + ' / 当日跌幅' + rk.lose);

  /* ---- 7. 切标签 → 换板块 ---- */
  const before = await p.evaluate(() => (document.querySelector('#sect-panel .pn-t') || {}).textContent || '');
  await p.evaluate(() => {
    const ts = document.querySelectorAll('.sct-tab');
    const jp = Array.from(ts).find(x => /日本|韩国|贵金属|外盘ETF/.test(x.textContent));
    if (jp) jp.click();
  });
  await new Promise(r => setTimeout(r, 6000));
  const after = await p.evaluate(() => ({
    t: (document.querySelector('#sect-panel .pn-t') || {}).textContent || '',
    rows: document.querySelectorAll('#sect-panel .bd-row').length
  }));
  log(after.t && after.t !== before, '切标签换板块: ' + before.trim() + ' → ' + after.t.trim());
  log(after.rows > 0, '切换后面板有数据 ' + after.rows + ' 行');

  /* ---- 8. 组件/分层存在 + 无 A股字样 ---- */
  const arch = await p.evaluate(() => ({
    net: !!window.Net, ekit: !!window.EKit, board: !!window.Board,
    panel: !!window.Panel, sectors: !!window.Sectors,
    dl: !!window.Dl, search: !!window.Search,
    ekitTypes: window.EKit ? window.EKit.types : [],
    netStat: window.Net ? window.Net.stat() : null,
    aText: /A股/.test(document.body.innerText)
  }));
  log(arch.net && arch.ekit && arch.board && arch.panel && arch.sectors, '分层组件全部就绪(Net/EKit/Board/Panel/Sectors)');
  log(arch.dl && arch.search, '服务层就绪(下载/搜索)');
  log(arch.ekitTypes.length >= 6, '图表类型 ' + arch.ekitTypes.length + ' 种: ' + arch.ekitTypes.join(','));
  log(arch.netStat && arch.netStat.active <= 6, '取数并发≤6: ' + JSON.stringify(arch.netStat));
  log(!arch.aText, '★页面已无"A股"字样(改为美股)');

  log(errs.length === 0, '无 JS 错误' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));

  await p.screenshot({ path: 'tools/shots/ov_boards.png', fullPage: false });
  await b.close();
  console.log('\n========== 结果: ' + (fail === 0 ? '全部通过 ✓' : fail + ' 项失败 ✗') + ' ==========');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('验证脚本异常:', e); process.exit(2); });
