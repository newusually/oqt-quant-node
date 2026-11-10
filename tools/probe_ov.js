/* 快速诊断: 首页总览页 JS 错误抓取 */
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
  p.on('response', r => { if (r.status() >= 400) errs.push('HTTP' + r.status() + ' ' + r.url()); });
  await p.goto(BASE + '/web/index.html', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 9000));
  const st = await p.evaluate(() => ({
    cards: document.querySelectorAll('.mk-card').length,
    rankItems: document.querySelectorAll('.rk-item').length,
    tv: !!document.querySelector('#tvbox .otv'),
    hasOv: typeof window.Ov !== 'undefined',
    ovKeys: (typeof window.Ov !== 'undefined' && window.Ov) ? Object.keys(window.Ov) : [],
    muted: window.Announcer ? window.Announcer.isMuted() : null,
    panels: document.querySelectorAll('.panel').length,
    bodyLen: document.body.innerHTML.length
  }));
  console.log('STATE: ' + JSON.stringify(st, null, 2));
  console.log('ERRS(' + errs.length + '):');
  errs.slice(0, 8).forEach(e => console.log('  ' + e));
  await b.close();
})().catch(e => { console.error('probe error', e); process.exit(2); });
