/* 盈利曲线验收(一个月回测): OKX 页 + A股 页共用 curve-panel.js 组件
 * 用法: NODE_PATH=C:\Users\Administrator\.workbuddy\binaries\node\workspace\node_modules node tools/verify_curve.js
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

async function checkCurve(b, url, label, waitMs) {
  const p = await b.newPage();
  await p.setViewport({ width: 1500, height: 1100 });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
  p.on('response', r => { if (r.status() >= 400) errs.push('HTTP' + r.status() + ' ' + r.url()); });
  await p.goto(BASE + url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, waitMs));
  console.log('\n【' + label + ' ' + url + '】');
  const r = await p.evaluate(() => {
    var box = document.getElementById('curve-box');
    var stat = box ? box.querySelector('.btc-stat') : null;
    var note = box ? box.querySelector('[id$="-note"]') : null;
    var cv = box ? box.querySelector('canvas.btc-cv') : null;
    var days = box ? box.querySelector('input[id$="-days"]') : null;
    var txt = stat ? stat.textContent : '';
    var mN = txt.match(/笔数(\d+)/), mWr = txt.match(/胜率([\d.]+)%/);
    return {
      hasBox: !!box,
      statTxt: txt.replace(/\s+/g, ' ').slice(0, 120),
      n: mN ? +mN[1] : -1,
      wr: mWr ? +mWr[1] : -1,
      note: note ? note.textContent : '',
      daysVal: days ? +days.value : -1,
      cvW: cv ? cv.clientWidth : 0,
      hasCurvePanel: !!window.CurvePanel
    };
  });
  log(r.hasCurvePanel, 'curve-panel.js 共享组件已加载');
  log(r.hasBox, 'curve-box 面板存在');
  log(r.n > 0, '回测有成交: 笔数=' + r.n + ' 胜率=' + r.wr + '%');
  log(/回测窗口 30 天/.test(r.note), 'note 显示一个月窗口: ' + r.note);
  log(r.daysVal === 30, '工具条回测窗口默认 30 天 (当前 ' + r.daysVal + ')');
  log(r.cvW > 100, '曲线 canvas 已布局 (宽 ' + r.cvW + 'px)');
  log(errs.length === 0, '无 JS 错误' + (errs.length ? ' → ' + errs.slice(0, 3).join(' | ') : ''));
  await p.screenshot({ path: 'tools/shots/curve_' + (label.indexOf('OKX') >= 0 ? 'okx' : 'astock') + '.png' });
  await p.close();
  return r;
}

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1400']
  });

  const okx = await checkCurve(b, '/modules/okx/web/index.html', 'OKX合约页', 12000);
  const a = await checkCurve(b, '/modules/astock/web/index.html?code=sh600519', 'A股页', 15000);

  // 曲线应跨越多天(不是一条竖线/一天)
  console.log('\n【窗口跨度】');
  log(okx.n >= 5, 'OKX 一个月回测笔数=' + okx.n + ' (样本充足)');
  log(a.n >= 0, 'A股 一个月回测笔数=' + a.n + ' (日线信号稀疏属正常)');

  await b.close();
  console.log('\n========== ' + (fail === 0 ? '全部通过 ✓' : fail + ' 项失败 ✗') + ' ==========');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
