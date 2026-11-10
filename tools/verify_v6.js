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
const OUT = 'E:\\oqt-quant-node\\tools\\shots';
function log(ok, msg) { console.log((ok ? '  ✅ ' : '  ❌ ') + msg); }

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required', '--window-size=1600,1400']
  });
  let pass = 0, fail = 0;
  const T = (ok, m) => { ok ? pass++ : fail++; log(ok, m); };

  /* ═══ ① 总览 ═══ */
  {
    const p = await browser.newPage();
    await p.setViewport({ width: 1600, height: 1400 });
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
    p.on('response', r => { if (r.status() >= 400) errs.push('HTTP' + r.status() + ' ' + r.url()); });
    await p.goto('http://127.0.0.1:8080/web/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 9000));
    console.log('\n【① 总览页 · 全局行情监控中心】');
    const d = await p.evaluate(() => ({
      loaderGone: !document.getElementById('loader'),
      cards: document.querySelectorAll('#mkt-cards .mk-card').length,
      hot: document.querySelectorAll('#rk-hot .rk-item').length,
      fast: document.querySelectorAll('#rk-fast .rk-item').length,
      lose: document.querySelectorAll('#rk-lose .rk-item').length,
      mood: (document.getElementById('mood-score') || {}).textContent,
      ai: ((document.getElementById('ai-text') || {}).textContent || '').length,
      aiTime: (document.getElementById('ai-time') || {}).textContent,
      tv: !!document.querySelector('.otv-crt'),
      tvLine: ((document.querySelector('.otv-line') || {}).textContent || '').length,
      ticker: ((document.getElementById('otv-ticker') || {}).textContent || '').length,
      navs: document.querySelectorAll('nav a').length,
      navNames: [...document.querySelectorAll('nav a')].map(a => a.textContent.trim()),
      noJsonPanel: document.body.innerText.indexOf('JSON 接口示例') < 0,
      clock: (document.getElementById('clock') || {}).textContent
    }));
    T(d.loaderGone, '等待动画(小人搬东西)已消失');
    T(d.cards >= 8, '大盘行情卡片 ' + d.cards + ' 个');
    T(d.hot >= 5 && d.fast >= 5 && d.lose >= 5, '热门/最快/跌幅 三榜各 ' + d.hot + '/' + d.fast + '/' + d.lose + ' 行');
    T(d.mood && d.mood !== '-', '市场情绪指数 ' + d.mood);
    T(d.ai > 20, 'AI 市场分析已渲染 (' + d.ai + ' 字)');
    T(d.aiTime && d.aiTime.indexOf('更新于') >= 0, 'AI 分析带实时时间: ' + d.aiTime);
    T(d.tv && d.tvLine > 10, '电视播报动画 + 字幕');
    T(d.ticker > 10, '电视底部快讯滚动条');
    T(d.navs === 5, '导航 5 项: ' + d.navNames.join('/'));
    T(d.noJsonPanel, '已删除 JSON 接口示例面板');
    T(d.clock && d.clock.length > 8, '实时时钟: ' + d.clock);
    T(errs.length === 0, '0 JS 错误 (' + errs.length + ')');
    errs.slice(0, 4).forEach(e => console.log('    ' + e));
    await p.screenshot({ path: OUT + '\\ov_v6.png', fullPage: true });
    await p.close();
  }

  /* ═══ ② OKX ═══ */
  {
    const p = await browser.newPage();
    await p.setViewport({ width: 1600, height: 1400 });
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
    p.on('response', r => { if (r.status() >= 400) errs.push('HTTP' + r.status() + ' ' + r.url()); });
    await p.goto('http://127.0.0.1:8080/modules/okx/web/', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 13000));
    console.log('\n【② OKX 页】');
    const d = await p.evaluate(() => {
      const tr = document.querySelector('#sg-tb tr');
      const tds = tr ? tr.querySelectorAll('td') : [];
      const cv = document.getElementById('idxcv');
      let drawn = 0;
      if (cv) { const dd = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 0; i < dd.length; i += 4 * 37) if (dd[i + 3] > 40) drawn++; }
      const px = document.querySelector('.ii-px');
      const sideH = (document.getElementById('side') || {}).getBoundingClientRect ? document.getElementById('side').getBoundingClientRect().height : 0;
      return {
        sigTime: tds[0] ? tds[0].textContent : '-',
        sigTimeOK: !(tds[0] && /NaN|undefined|Invalid/.test(tds[0].textContent)),
        sigRows: document.querySelectorAll('#sg-tb tr').length,
        sigSub: (document.getElementById('sg-sub') || {}).textContent,
        canvasDrawn: drawn,
        sideH: Math.round(sideH),
        sideCollapsed: (document.getElementById('side') || {}).className.indexOf('collapsed') >= 0,
        instPx: (document.getElementById('inst-price') || {}).textContent,
        tickerRows: document.querySelectorAll('.ii-px[data-px]').length,
        firstPx: px ? px.textContent.trim() : '-',
        hasArrow: px ? /[▲▼—]/.test(px.textContent) : false,
        px4: px ? /\.\d{4}/.test(px.textContent) : false,
        bookAsks: document.querySelectorAll('#book-asks .book-row').length,
        bookBids: document.querySelectorAll('#book-bids .book-row').length,
        bookMid: ((document.getElementById('book-mid') || {}).textContent || '').trim(),
        posRows: document.querySelectorAll('#pos-tb tr').length,
        posSum: ((document.getElementById('pos-sum') || {}).textContent || '').trim(),
        navs: document.querySelectorAll('nav a').length
      };
    });
    console.log('  ', JSON.stringify(d));
    T(d.sigTimeOK, '买卖信号时间无 NaN: "' + d.sigTime + '"');
    T(d.sigRows > 50, '信号表 ' + d.sigRows + ' 行 / ' + d.sigSub);
    T(d.canvasDrawn > 500, 'K线有买卖信号标记 (' + d.canvasDrawn + ' 采样)');
    T(d.sideCollapsed && d.sideH < 500, '侧栏折叠只占 ' + d.sideH + 'px (不是整屏)');
    T(d.tickerRows > 0 && d.hasArrow, '侧栏实时价+箭头 ' + d.tickerRows + ' 项, 例 "' + d.firstPx + '"');
    T(d.px4, '价格4位小数');
    T(d.bookAsks > 0 && d.bookBids > 0, '实时买卖队列 卖' + d.bookAsks + '/买' + d.bookBids + ' · ' + d.bookMid);
    T(d.posRows > 0, '持仓监控面板 ' + d.posRows + ' 行 · ' + d.posSum);
    T(d.navs === 5, '导航 5 项');
    T(errs.length === 0, '0 JS 错误 (' + errs.length + ')');
    errs.slice(0, 4).forEach(e => console.log('    ' + e));
    await p.screenshot({ path: OUT + '\\okx_v6.png', fullPage: true });
    await p.close();
  }

  /* ═══ ③ NQ / A股 ═══ */
  for (const [name, url] of [['NQ', 'http://127.0.0.1:8080/modules/nq/web/'], ['A股', 'http://127.0.0.1:8080/modules/astock/web/']]) {
    const p = await browser.newPage();
    await p.setViewport({ width: 1600, height: 1200 });
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
    await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 11000));
    console.log('\n【③ ' + name + ' 页】');
    const d = await p.evaluate(() => {
      const cv = document.getElementById('idxcv');
      let drawn = 0;
      if (cv) { const dd = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 0; i < dd.length; i += 4 * 37) if (dd[i + 3] > 40) drawn++; }
      const tr = document.querySelector('#sig-tb tr');
      const tds = tr ? tr.querySelectorAll('td') : [];
      return {
        canvasDrawn: drawn,
        sigRows: document.querySelectorAll('#sig-tb tr').length,
        sigTime: tds[0] ? tds[0].textContent : '-',
        sigTimeOK: !(tds[0] && /NaN|undefined|Invalid/.test(tds[0].textContent)),
        navs: document.querySelectorAll('nav a').length,
        hasChanSignal: !!window.ChanSignal,
        loaderGone: !document.getElementById('ld-global')
      };
    });
    console.log('  ', JSON.stringify(d));
    T(d.canvasDrawn > 400, 'K线画布有内容 (' + d.canvasDrawn + ')');
    T(d.sigRows > 1, '信号表 ' + d.sigRows + ' 行, 时间 "' + d.sigTime + '"');
    T(d.sigTimeOK, '信号时间无 NaN');
    T(d.navs === 5, '导航 5 项(能回 NQ/OKX)');
    T(d.hasChanSignal, '共用信号模块已加载');
    T(d.loaderGone, '等待动画已消失');
    T(errs.length === 0, '0 JS 错误 (' + errs.length + ')');
    errs.slice(0, 4).forEach(e => console.log('    ' + e));
    await p.screenshot({ path: OUT + '\\' + (name === 'NQ' ? 'nq_v6' : 'astock_v6') + '.png', fullPage: true });
    await p.close();
  }

  /* ═══ ④ 学习乐园 ═══ */
  {
    const p = await browser.newPage();
    await p.setViewport({ width: 1400, height: 1100 });
    const errs = [];
    const reqs = [];
    p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
    p.on('response', r => { if (/api\/s\/tts|api\/market/.test(r.url())) reqs.push(r.status() + ' ' + r.url().replace('http://127.0.0.1:8080', '').slice(0, 55)); });
    await p.goto('http://127.0.0.1:8080/modules/s/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 10000));
    console.log('\n【④ 学习乐园】');
    const d = await p.evaluate(() => ({
      hasCloseBtn: document.body.innerText.indexOf('自动朗读关') >= 0,
      hasOnTag: document.body.innerText.indexOf('🔊 自动朗读') >= 0,
      storeAutoRead: window.App && App.Store ? App.Store.state.autoRead : null,
      announcer: !!window.Announcer,
      title: document.title
    }));
    console.log('  ', JSON.stringify(d));
    T(!d.hasCloseBtn, '自动朗读【关闭】按钮已删除');
    T(d.hasOnTag, '显示「🔊 自动朗读」常开标识');
    T(d.storeAutoRead === true, 'Store.autoRead 恒 true (无法关闭)');
    T(d.announcer, '全站播报模块已加载');
    T(reqs.length > 0, '已发起行情/播报请求 ' + reqs.length + ' 次');
    reqs.slice(0, 4).forEach(x => console.log('    ' + x));
    T(errs.length === 0, '0 JS 错误 (' + errs.length + ')');
    errs.slice(0, 4).forEach(e => console.log('    ' + e));
    await p.screenshot({ path: OUT + '\\s_v6.png' });
    await p.close();
  }

  /* ═══ ⑤ 经 Apache 80 全路径 ═══ */
  console.log('\n【⑤ 经 Apache 80】');
  for (const u of ['/web/index.html', '/modules/okx/web/', '/modules/nq/web/', '/modules/astock/web/', '/modules/s/index.html', '/web/js/announcer.js', '/web/js/chan-signal.js', '/web/js/page-common.js', '/web/css/overview.css']) {
    const p = await browser.newPage();
    let code = 0;
    try {
      const r = await p.goto('http://127.0.0.1' + u, { waitUntil: 'domcontentloaded', timeout: 30000 });
      code = r ? r.status() : 0;
    } catch (e) { code = 0; }
    await p.close();
    T(code === 200, u + ' → ' + code);
  }

  await browser.close();
  console.log('\n═══ 通过 ' + pass + ' / 失败 ' + fail + ' ═══');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
