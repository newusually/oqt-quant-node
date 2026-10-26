/* 验收：删除美股/指数/ETF/贵金属/能源后的全站状态
 * 用法: NODE_PATH=C:\Users\Administrator\.workbuddy\binaries\node\workspace\node_modules node tools/verify_cleanup.js
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

const BAD_TEXT = ['美股', '所有指数', '外盘ETF', '贵金属', '能源板块', 'A股', 'NQ期货', '纳斯达克100期货'];
const BAD_SYMS = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'US500', 'US100',
  'QQQ', 'SPY', 'IWM', 'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'TLT', 'TMF', 'XBI', 'XLE', 'SMH',
  'LIT', 'URNM', 'USO', 'JP225', 'KR200', 'XAU', 'XAG', 'XPT', 'XPD', 'CL', 'NG', 'BZ',
  'XOM', 'CVX', 'SONY', 'SAMSUNG', 'HYUNDAI', 'NAVER', 'XIAOMI', 'POPMART', 'EWJ', 'EWY', 'EWZ'];

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

  // ---------- ① 总览页 ----------
  console.log('\n【总览 /web/index.html】');
  await p.goto(BASE + '/web/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 9000));

  const txt = await p.evaluate(() => document.body.innerText);
  for (const t of BAD_TEXT) {
    log(!txt.includes(t), `页面无「${t}」字样`);
  }
  log(!txt.includes('NaN') && !txt.includes('undefined'), '页面无 NaN/undefined');
  log(errs.length === 0, '零 JS 错误' + (errs.length ? ' → ' + errs.slice(0, 5).join(' | ') : ''));

  // 板块标签
  const tabs = await p.evaluate(() => Array.from(document.querySelectorAll('.sct-tab')).map(e => e.textContent.trim()));
  console.log('  板块标签:', tabs.join(' / '));
  log(tabs.length > 0, '板块标签已渲染(' + tabs.length + '个)');
  log(!tabs.some(t => /美股|ETF|贵金属|能源|日股|韩股|港股/.test(t)), '板块标签无传统金融');

  // 板块卡片
  const cards = await p.evaluate(() => Array.from(document.querySelectorAll('#mkt-cards .mk-name')).map(e => e.textContent.trim()));
  console.log('  板块卡片:', cards.slice(0, 12).join(' | '));
  log(cards.length > 0, '板块卡片已渲染(' + cards.length + '个)');
  log(!cards.some(c => /美股|ETF|贵金属|能源|日股|韩股|港股/.test(c)), '板块卡片无传统金融');

  // 榜单合约
  const rows = await p.evaluate(() => Array.from(document.querySelectorAll('#rp-hot .rk-item .rk-name, #rp-lose .rk-item .rk-name')).map(e => e.textContent.trim()));
  const hitSyms = rows.filter(r => BAD_SYMS.includes(r.trim().toUpperCase()));
  log(hitSyms.length === 0, '涨幅/跌幅榜无传统金融合约' + (hitSyms.length ? ' → ' + hitSyms.join(',') : ''));

  // Taker 榜
  const tk = await p.evaluate(() => Array.from(document.querySelectorAll('#tk-body tr td:nth-child(2)')).map(e => e.textContent.trim()));
  const tkHit = tk.filter(t => BAD_SYMS.includes(t.toUpperCase()));
  log(tkHit.length === 0, 'Taker 榜无传统金融合约' + (tkHit.length ? ' → ' + tkHit.join(',') : ''));
  log(tk.length > 0, 'Taker 榜已渲染(' + tk.length + '行)');

  // 图表容器
  const charts = await p.evaluate(() => Array.from(document.querySelectorAll('.chart-box canvas, .fl-chart canvas, #vscrypto-panel canvas')).length);
  log(charts > 0, '图表已渲染(' + charts + '个 canvas)');

  await p.screenshot({ path: 'tools/shots/clean_overview.png', fullPage: false });

  // ---------- ② 涨幅榜页 ----------
  console.log('\n【涨幅榜 /web/rank.html】');
  await p.goto(BASE + '/web/rank.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));
  const rtxt = await p.evaluate(() => document.body.innerText);
  for (const t of BAD_TEXT) log(!rtxt.includes(t), `涨幅榜页无「${t}」`);
  const rrows = await p.evaluate(() => Array.from(document.querySelectorAll('#rk-gain .bd-row .bd-name, #rk-lose .bd-row .bd-name')).map(e => e.textContent.trim()));
  const rHit = rrows.filter(r => BAD_SYMS.includes(r.toUpperCase()));
  log(rHit.length === 0, '涨幅榜无传统金融合约' + (rHit.length ? ' → ' + rHit.join(',') : ''));
  log(rrows.length > 0, '涨幅榜已渲染(' + rrows.length + '行)');
  const rpack = await p.evaluate(() => document.querySelectorAll('#rk-gain .rp-hd').length + document.querySelectorAll('#rk-lose .rp-hd').length);
  log(rpack === 2, '涨幅榜页用 RankPack 组件(2个)');

  // ---------- ③ OKX 页 ----------
  console.log('\n【OKX /modules/okx/web/index.html】');
  await p.goto(BASE + '/modules/okx/web/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise(r => setTimeout(r, 9000));
  const otxt = await p.evaluate(() => document.body.innerText);
  for (const t of BAD_TEXT) log(!otxt.includes(t), `OKX页无「${t}」`);
  const icats = await p.evaluate(() => Array.from(document.querySelectorAll('#inst-cats .icat')).map(e => e.textContent.trim()));
  console.log('  合约分类芯片:', icats.join(' / '));
  log(icats.length > 0, '合约分类芯片已渲染(' + icats.length + '个)');
  log(!icats.some(t => /美股|ETF|贵金属|能源|日股|韩股|港股/.test(t)), '分类芯片无传统金融');
  const ilist = await p.evaluate(() => Array.from(document.querySelectorAll('#inst-list .inst-item .ii-name')).map(e => e.textContent.trim()));
  const iHit = ilist.filter(r => BAD_SYMS.includes(r.replace('-USDT-SWAP', '').toUpperCase()));
  log(iHit.length === 0, '合约列表无传统金融' + (iHit.length ? ' → ' + iHit.slice(0, 5).join(',') : ''));
  log(ilist.length > 0, '合约列表已渲染(' + ilist.length + '项)');
  await p.screenshot({ path: 'tools/shots/clean_okx.png', fullPage: false });

  // ---------- ④ 已删页面 404 ----------
  console.log('\n【已删页面】');
  for (const [name, path] of [['美股页', '/modules/astock/web/index.html'], ['指数页', '/modules/nq/web/index.html']]) {
    const r = await p.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(e => null);
    const code = r ? r.status() : 0;
    log(code === 404, `${name} 返回 404 (实际 ${code})`);
  }

  await b.close();
  console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
