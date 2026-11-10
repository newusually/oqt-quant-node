/* 诊断: 首页首次悬停 .mk-card → 悬浮窗取数链路(请求耗时/状态) */
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
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--window-size=1600,1400'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1500, height: 1100 });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + (e.stack || e.message)));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  await p.goto(BASE + '/web/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 8000));
  // 首张卡片是什么
  const first = await p.evaluate(() => {
    var c = document.querySelector('.mk-card');
    return c ? { code: c.getAttribute('data-code'), name: (c.querySelector('.mk-name') || {}).textContent } : null;
  });
  console.log('FIRST CARD: ' + JSON.stringify(first));
  // 记录 kline 请求
  const reqs = [];
  p.on('response', async r => {
    if (/\/api\/(okx|astock|nq)\/kline/.test(r.url())) {
      let body = '';
      try { body = await r.text(); } catch (e) { }
      reqs.push({ url: r.url().slice(0, 120), status: r.status(), ms: 0, len: body.length, ok: (() => { try { return JSON.parse(body).ok; } catch (e) { return null; } })() });
    }
  });
  const tHover = Date.now();
  await p.hover('.mk-card');
  // 轮询等悬浮窗打开, 最多 30s
  let opened = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const st = await p.evaluate(() => {
      var box = document.getElementById('chanpop');
      return { on: !!(box && box.classList.contains('on')), cv: !!(box && box.querySelector('canvas')), empty: (box && box.querySelector('.chanpop-empty-ov') || {}).textContent || '' };
    });
    if (st.on && st.cv) { opened = true; console.log('POPUP OPEN after ' + (Date.now() - tHover) + 'ms'); break; }
    if (i === 29) console.log('POPUP NOT OPEN in 30s, last state: ' + JSON.stringify(st));
  }
  await new Promise(r => setTimeout(r, 500));
  console.log('KLINE REQS: ' + JSON.stringify(reqs, null, 1));
  console.log('ERRS: ' + (errs.length ? errs.slice(0, 5).join(' | ') : 'none'));
  await b.close();
})().catch(e => { console.error('probe error', e); process.exit(2); });
