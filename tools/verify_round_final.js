/* 最终验收(本轮): 学习乐园只播自己的(混播修复+静音) · 涨幅排行榜页 · 总览面板实时化/着色/账户曲线 · 三页K线实时
 * 用法: NODE_PATH=C:\Users\Administrator\.workbuddy\binaries\node\workspace\node_modules node tools/verify_round_final.js
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
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1400',
      '--autoplay-policy=no-user-gesture-required']   // 允许自动播放(验证播报链路)
  });

  /* ============ 1. 学习乐园 ============ */
  {
    const p = await b.newPage();
    await p.setViewport({ width: 1500, height: 1100 });
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
    p.on('response', r => { if (r.status() >= 400) errs.push('HTTP' + r.status() + ' ' + r.url()); });
    await p.goto(BASE + '/modules/s/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 8000));
    console.log('\n【学习乐园 modules/s/index.html】');
    const r = await p.evaluate(() => ({
      quantNav: !!document.querySelector('.nav-quant'),
      quantLinks: Array.from(document.querySelectorAll('.nav-quant a')).map(a => a.getAttribute('href')),
      homeBtn: !!document.querySelector('.tb-home'),
      tv: !!document.querySelector('#tvbox .otv'),
      hasAnnouncer: !!window.Announcer,
      speechOk: !!(window.App && App.Speech),
      cloudVoice: (window.App && App.Store && App.Store.state && App.Store.state.voiceCloud) || ''
    }));
    log(r.hasAnnouncer, 'announcer.js 已加载');
    log(!r.quantNav, '行情选项卡 nav-quant 已删除(用户要求只留返回主站): ' + JSON.stringify(r.quantLinks));
    log(r.homeBtn, '返回主站按钮存在');
    log(!r.tv, '行情电台电视已删除(不混播首页行情语言)');
    log(r.speechOk, '学习乐园 Speech 服务已加载');
    log(r.cloudVoice === 'g-tw', '学习乐园默认嗓音=台湾女声(g-tw): ' + r.cloudVoice);
    log(errs.length === 0, '无 JS 错误' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
    await p.screenshot({ path: 'tools/shots/s_radio.png' });
    await p.close();
  }

  /* ============ 2. 日涨幅排行榜页 ============ */
  {
    const p = await b.newPage();
    await p.setViewport({ width: 1500, height: 1100 });
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
    p.on('response', r => { if (r.status() >= 400) errs.push('HTTP' + r.status() + ' ' + r.url()); });
    await p.goto(BASE + '/web/rank.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 9000));
    console.log('\n【日涨幅排行榜 web/rank.html】');
    const r = await p.evaluate(() => ({
      rows: document.querySelectorAll('#rk-body tr').length,
      firstName: (document.querySelector('#rk-body .rk-name') || {}).textContent || '',
      firstPct: (document.querySelectorAll('#rk-body td')[4] || {}).textContent || '',
      tv: !!document.querySelector('#tvbox .otv'),
      muted: window.Announcer ? !!window.Announcer.isMuted() : null,
      lbA: (document.getElementById('lb-a-count') || {}).textContent,
      lbOkx: (document.getElementById('lb-okx-count') || {}).textContent,
      flashCss: getComputedStyle(document.body).getPropertyValue('--panel') !== ''
    }));
    log(r.rows >= 10, 'A股涨幅榜渲染 ' + r.rows + ' 行 (第一名 ' + r.firstName + ' ' + r.firstPct.trim() + ')');
    log(r.tv, '电台电视已挂载');
    log(r.muted === true, '排行榜页语音已静音(用户: 太烦了)');
    log(/只/.test(r.lbA || ''), '直播条 A股总数: ' + r.lbA);
    log(/个/.test(r.lbOkx || ''), '直播条 OKX 合约数: ' + r.lbOkx);

    // 切到 OKX 榜
    await p.evaluate(() => { document.querySelector('.rk-tab[data-mkt="okx"]').click(); });
    await new Promise(r => setTimeout(r, 600));
    const r2 = await p.evaluate(() => ({
      rows: document.querySelectorAll('#rk-body tr').length,
      first: (document.querySelector('#rk-body .rk-name') || {}).textContent || '',
      firstCode: (document.querySelectorAll('#rk-body td')[2] || {}).textContent || ''
    }));
    log(r2.rows >= 10, 'OKX 涨幅榜渲染 ' + r2.rows + ' 行 (' + r2.first + ' ' + r2.firstCode + ')');

    // 切跌幅榜
    await p.evaluate(() => { document.querySelector('.rk-tab[data-dir="lose"]').click(); });
    await new Promise(r => setTimeout(r, 600));
    const r3 = await p.evaluate(() => ({
      rows: document.querySelectorAll('#rk-body tr').length,
      first: (document.querySelector('#rk-body .rk-name') || {}).textContent || '',
      pct: (document.querySelectorAll('#rk-body td')[4] || {}).textContent || ''
    }));
    log(r3.rows >= 10 && /▼|-/.test(r3.pct), 'OKX 跌幅榜渲染 ' + r3.rows + ' 行 (' + r3.first + ' ' + r3.pct.trim() + ')');

    // 悬停第一行 → 弹 5 分钟悬浮K线窗(共用 ChanPop)
    await p.evaluate(() => { document.querySelector('.rk-tab[data-mkt="a"]').click(); document.querySelector('.rk-tab[data-dir="gain"]').click(); });
    await new Promise(r => setTimeout(r, 500));
    await p.hover('#rk-body tr');
    await new Promise(r => setTimeout(r, 5000));
    const pop = await p.evaluate(() => {
      var box = document.getElementById('chanpop');
      return {
        on: !!(box && box.classList.contains('on')),
        title: box ? (box.querySelector('.chanpop-t') || {}).textContent : '',
        bars: window.__popBars || 0,
        cv: !!(box && box.querySelector('canvas'))
      };
    });
    log(pop.on, '悬停弹出悬浮K线窗: ' + pop.title);
    log(pop.cv, '悬浮窗内已绘 K 线(canvas)');
    log(errs.length === 0, '无 JS 错误' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
    await p.screenshot({ path: 'tools/shots/rank_page.png' });
    await p.close();
  }

  /* ============ 3. 总览页 ============ */
  {
    const p = await b.newPage();
    await p.setViewport({ width: 1500, height: 1100 });
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
    p.on('response', r => { if (r.status() >= 400) errs.push('HTTP' + r.status() + ' ' + r.url()); });
    await p.goto(BASE + '/web/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 9000));
    console.log('\n【总览 web/index.html】');
    const r = await p.evaluate(() => ({
      cards: document.querySelectorAll('.mk-card').length,
      cardCodes: Array.from(document.querySelectorAll('.mk-card')).map(c => c.getAttribute('data-code')),
      cardHref: (document.querySelector('.mk-card') || {}).getAttribute ? document.querySelector('.mk-card').getAttribute('data-href') : '',
      rankItems: document.querySelectorAll('.rk-item').length,
      rankHref: (document.querySelector('.rk-item') || {}).getAttribute ? document.querySelector('.rk-item').getAttribute('data-href') : '',
      tv: !!document.querySelector('#tvbox .otv'),
      muted: window.Announcer ? !!window.Announcer.isMuted() : null,
      rankTab: Array.from(document.querySelectorAll('nav a')).some(a => (a.getAttribute('href') || '').indexOf('/web/rank.html') >= 0),
      hotFirstName: (document.querySelector('#rk-hot .rk-name') || {}).textContent || '',
      hotFirstPct: (document.querySelectorAll('#rk-hot .rk-pct')[0] || {}).textContent || '',
      eqChart: !!document.querySelector('#chart-equity canvas'),
      holdChips: document.querySelectorAll('#ov-hold .ov-hold-i').length,
      autoRefresh: (window.ChanPop && typeof window.ChanPop.refresh === 'function'),
      tintUp: Array.from(document.querySelectorAll('.panel')).some(e => e.classList.contains('tint-up')),
      tintDn: Array.from(document.querySelectorAll('.panel')).some(e => e.classList.contains('tint-dn'))
    }));
    log(r.cards >= 6, '大盘行情卡片 ' + r.cards + ' 张');
    // ★用户 2026-10-25: "大盘两个eth 只要一个 其他的删除 sol xrp不是大盘的 按实际的来"
    var okxCards = r.cardCodes.filter(function (c) { return /-SWAP$/.test(c || ''); });
    log(okxCards.filter(function (c) { return /^ETH-/.test(c); }).length === 1,
      '大盘 ETH 恰好 1 张(不得重复): ' + JSON.stringify(okxCards));
    log(okxCards.every(function (c) { return /^(BTC|ETH)-/.test(c); }),
      '大盘只显示 BTC/ETH(SOL/XRP/DOGE 不得占大盘位): ' + JSON.stringify(okxCards));
    log(/\/modules\/(astock|nq|okx)\//.test(r.rankHref || ''), '卡片点击可进模块页: ' + r.rankHref);
    log(r.rankItems >= 20, '排行榜条目 ' + r.rankItems + ' 条(热门+最快+跌幅)');
    log(/\/modules\//.test(r.rankHref || ''), '排行点击可进模块页: ' + r.rankHref);
    log(r.tv, 'oqt 财经电台已挂载');
    log(r.muted === true, '首页语音已静音(用户: 太烦了)');
    log(r.rankTab, '导航含涨幅榜选项卡');
    log(r.hotFirstName.length > 0, '热门行情第一名: ' + r.hotFirstName + ' ' + (r.hotFirstPct || '').trim());
    log(r.eqChart, '账户净值/累计盈亏曲线已绘制(ECharts canvas)');
    log(r.autoRefresh, 'ChanPop 悬浮窗支持自动刷新(共用组件)');
    log(r.tintUp || r.tintDn, '面板随涨跌着色(tint-up/tint-dn)');

    // 悬停卡片 → 悬浮K线(首次悬停要冷拉种子数据, OKX 合约最多要拉 6 轮, 多等一会)
    await p.hover('.mk-card');
    await new Promise(r => setTimeout(r, 20000));
    const pop = await p.evaluate(() => {
      var box = document.getElementById('chanpop');
      return { on: !!(box && box.classList.contains('on')), cv: !!(box && box.querySelector('canvas')) };
    });
    log(pop.on && pop.cv, '悬停卡片弹出 5 分钟实时K线窗');
    // 再悬停一次(应命中缓存秒开)
    await p.hover('.mk-card');
    await new Promise(r => setTimeout(r, 2500));
    const pop2 = await p.evaluate(() => {
      var box = document.getElementById('chanpop');
      return { on: !!(box && box.classList.contains('on')), cv: !!(box && box.querySelector('canvas')) };
    });
    log(pop2.on && pop2.cv, '再次悬停秒开(缓存命中)');
    // ★自动刷新: 悬停不动等 12s(>10s 刷新周期) → 窗仍在且无报错(fresh 重取+重绘)
    await new Promise(r => setTimeout(r, 12000));
    const pop3 = await p.evaluate(() => {
      var box = document.getElementById('chanpop');
      return { on: !!(box && box.classList.contains('on')), cv: !!(box && box.querySelector('canvas')) };
    });
    log(pop3.on && pop3.cv, '悬浮窗 12s 后仍在(10s 自动刷新正常)');
    log(errs.length === 0, '无 JS 错误' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
    await p.screenshot({ path: 'tools/shots/ov_final.png' });
    await p.close();
  }

  /* ============ 4. A股页 ============ */
  {
    const p = await b.newPage();
    await p.setViewport({ width: 1500, height: 1100 });
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
    p.on('response', r => { if (r.status() >= 400) errs.push('HTTP' + r.status() + ' ' + r.url()); });
    await p.goto(BASE + '/modules/astock/web/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 9000));
    console.log('\n【A股 modules/astock/web/index.html】');
    const r = await p.evaluate(() => ({
      rankRows: document.querySelectorAll('#a-rank .rk-item').length,
      firstName: (document.querySelector('#a-rank .rk-name') || {}).textContent || '',
      firstPct: (document.querySelectorAll('#a-rank .rk-pct')[0] || {}).textContent || '',
      rankTab: Array.from(document.querySelectorAll('nav a')).some(a => (a.getAttribute('href') || '').indexOf('/web/rank.html') >= 0),
      klineCv: !!document.querySelector('#idxcv'),
      klinePx: (document.getElementById('idx-price') || {}).textContent || ''
    }));
    log(r.rankRows >= 10, '全市场涨幅榜面板 ' + r.rankRows + ' 行 (' + r.firstName + ' ' + r.firstPct.trim() + ')');
    log(r.rankTab, '导航含涨幅榜选项卡');
    log(r.klineCv, 'A股主图 K 线 canvas 存在(实时价: ' + r.klinePx + ')');
    log(errs.length === 0, '无 JS 错误' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
    await p.close();
  }

  /* ============ 5. OKX页 ============ */
  {
    const p = await b.newPage();
    await p.setViewport({ width: 1600, height: 1200 });
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
    p.on('response', r => { if (r.status() >= 400) errs.push('HTTP' + r.status() + ' ' + r.url()); });
    await p.goto(BASE + '/modules/okx/web/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 10000));
    console.log('\n【OKX modules/okx/web/index.html】');
    const r = await p.evaluate(() => ({
      instItems: document.querySelectorAll('.inst-item').length,
      pxItems: document.querySelectorAll('.ii-px').length,
      pxWithArrow: Array.from(document.querySelectorAll('.ii-px')).filter(e => e.querySelector('.ii-arrow')).length,
      okxRankRows: document.querySelectorAll('#okx-rank .rk-item').length,
      okxRankFirst: (document.querySelector('#okx-rank .rk-name') || {}).textContent || '',
      bookRows: document.querySelectorAll('.book-row').length,
      klineCv: !!document.querySelector('#idxcv'),
      autoRefresh: (window.ChanPop && typeof window.ChanPop.refresh === 'function')
    }));
    log(r.instItems > 400, '合约列表 ' + r.instItems + ' 个(全部列出)');
    log(r.pxWithArrow >= 100, '列表实时价格+箭头 ' + r.pxWithArrow + '/' + r.pxItems + ' 个已刷新');
    log(r.okxRankRows >= 10, '全市场合约涨幅榜 ' + r.okxRankRows + ' 行 (' + r.okxRankFirst + ')');
    log(r.bookRows > 10, '实时买卖队列 ' + r.bookRows + ' 行');
    log(r.klineCv, 'OKX 主图 K 线 canvas 存在');
    log(r.autoRefresh, 'ChanPop 悬浮窗支持自动刷新(共用组件)');
    log(errs.length === 0, '无 JS 错误' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
    await p.screenshot({ path: 'tools/shots/okx_final.png' });
    await p.close();
  }

  /* ============ 6. NQ页 ============ */
  {
    const p = await b.newPage();
    await p.setViewport({ width: 1500, height: 1100 });
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
    p.on('response', r => { if (r.status() >= 400) errs.push('HTTP' + r.status() + ' ' + r.url()); });
    await p.goto(BASE + '/modules/nq/web/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 8000));
    console.log('\n【NQ modules/nq/web/index.html】');
    const r = await p.evaluate(() => ({
      px: (document.getElementById('idx-price') || {}).textContent,
      pct: (document.getElementById('idx-pct') || {}).textContent,
      last: (document.getElementById('s-last') || {}).textContent,
      stLine: (document.getElementById('st-line') || {}).textContent,
      rankTab: Array.from(document.querySelectorAll('nav a')).some(a => (a.getAttribute('href') || '').indexOf('/web/rank.html') >= 0),
      klineCv: !!document.querySelector('#idxcv')
    }));
    log(/\d/.test(r.px || ''), 'NQ 实时价格: ' + r.px + ' ' + r.pct);
    log(/实时/.test(r.stLine || ''), '状态行: ' + r.stLine);
    log(r.rankTab, '导航含涨幅榜选项卡');
    log(r.klineCv, 'NQ 主图 K 线 canvas 存在');
    log(errs.length === 0, '无 JS 错误' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
    await p.close();
  }

  await b.close();
  console.log('\n========== 结果: ' + (fail === 0 ? '全部通过 ✓' : fail + ' 项失败 ✗') + ' ==========');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('验证脚本异常:', e); process.exit(2); });
