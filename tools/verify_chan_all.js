// 最终验收: 新信号规则 / 旧信号清零 / 指标精简 / 全市场同步 / 自由布局 / s模块
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
let fail = 0;
const log = (ok, m) => { if (!ok) fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + m); };

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox','--window-size=1600,1400'] });

  for (const t of [
    { name: 'okx', url: 'http://127.0.0.1:8080/modules/okx/web/' },
    { name: 'nq', url: 'http://127.0.0.1:8080/modules/nq/web/' },
    { name: 'astock', url: 'http://127.0.0.1:8080/modules/astock/web/' }
  ]) {
    const p = await b.newPage();
    await p.setViewport({ width: 1600, height: 1400 });
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
    p.on('response', r => { if (r.status() >= 400) errs.push('HTTP' + r.status() + ' ' + r.url()); });
    await p.goto(t.url, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 10000));
    console.log('\n【' + t.name + '】');
    const info = await p.evaluate(() => {
      const cv = document.getElementById('idxcv');
      const ms = cv.__macdSig;
      const mainSel = document.getElementById('mainInd-sel') || document.getElementById('idx-ind-main');
      const subSel = document.getElementById('subInd-sel') || document.getElementById('idx-ind-sub');
      return {
        baseOk: ms && ms.base ? !!ms.base.ok : false,
        sigCount: ms && ms.sigs ? ms.sigs.length : 0,
        allAngLt40: ms && ms.sigs ? ms.sigs.every(s => s.ang < 40) : false,
        dirs: ms && ms.sigs ? { buy: ms.sigs.filter(s => s.dir > 0).length, sell: ms.sigs.filter(s => s.dir < 0).length } : null,
        oldBis: (cv.__chanBis || []).length,
        mainOpts: mainSel ? mainSel.options.length : -1,
        subOpts: subSel ? subSel.options.length : -1,
        hasDock: typeof window.Dock !== 'undefined',
        sigRows: document.querySelectorAll('#sg-tb tr, #sig-tb tr').length,
        sigSub: (document.getElementById('sg-sub') || {}).textContent
      };
    });
    console.log('  ' + JSON.stringify(info));
    log(info.baseOk, 'DIF/DEA 延长虚线交叉信号已启用');
    log(info.sigCount > 1, '历史信号 ' + info.sigCount + ' 条');
    log(info.allAngLt40, '夹角全部 < 40°');
    log(info.dirs && info.dirs.buy > 0 && info.dirs.sell > 0, '买/卖都有 (买' + (info.dirs ? info.dirs.buy : 0) + '/卖' + (info.dirs ? info.dirs.sell : 0) + ')');
    log(info.oldBis === 0, '旧缠论买卖信号已清空');
    log(info.mainOpts === 1 && info.subOpts === 1, '主图/副图其他指标已删除');
    log(info.hasDock, '自由布局已接入');
    console.log('  ERRORS(' + errs.length + ')');
    errs.slice(0, 5).forEach(e => console.log('    ' + e));
    await p.screenshot({ path: `E:\\oqt-quant-node\\tools\\shots\\${t.name}_v4.png` });
    await p.close();
  }

  /* 全市场信号 */
  console.log('\n【全市场信号同步】');
  const okx = await (await fetch('http://127.0.0.1:8080/api/okx/signals_all?tf=1h&limit=100000')).json();
  console.log('  OKX: ' + okx.count + ' 条信号 / 已扫 ' + okx.scanned + '/' + okx.total + ' 合约');
  const t = okx.rows.map(r => r.t);
  const days = new Set(t.map(x => new Date(x).toISOString().slice(0, 10)));
  const insts = new Set(okx.rows.map(r => r.inst));
  const angs = okx.rows.map(r => r.ang);
  console.log('    覆盖 ' + days.size + ' 天 (' + new Date(Math.min(...t)).toISOString().slice(0, 10) + ' → ' + new Date(Math.max(...t)).toISOString().slice(0, 10) + ') · ' + insts.size + ' 个合约 · 夹角 ' + Math.min(...angs).toFixed(0) + '~' + Math.max(...angs).toFixed(0) + '°');
  log(okx.count > 1000, 'OKX 全市场信号 ' + okx.count + ' 条');
  log(days.size > 3, '覆盖多天历史 (' + days.size + ' 天)');
  const ast = await (await fetch('http://127.0.0.1:8080/api/astock/signals?limit=5000')).json();
  console.log('  A股: ' + (ast.rows || []).length + ' 条信号 · scanning=' + !!ast.scanning);
  log((ast.rows || []).length > 0, 'A股全市场有信号');
  const u = await (await fetch('http://127.0.0.1:8080/api/astock/universe')).json();
  console.log('  A股全市场: ' + u.count + ' 只');
  log(u.count > 3000, 'A股 ' + u.count + ' 只');

  console.log('\n════════ 结果: ' + (fail === 0 ? '全部通过' : fail + ' 项未通过') + ' ════════');
  await b.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
