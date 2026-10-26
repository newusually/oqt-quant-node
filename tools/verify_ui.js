/* 验收(2026-10-25): ① 涨幅榜页改用 RankPack 组件(只1D涨幅+跌幅) ② 首页直播条多主流币
 *   ③ OKX页涨幅榜+跌幅榜用与主页同一套 CSS
 * 用法: NODE_PATH=C:\Users\Administrator\.workbuddy\binaries\node\workspace\node_modules node tools/verify_ui.js
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
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--window-size=1700,1500']
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1680, height: 1400 });
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errs.push('CONSOLE ' + m.text()); });

  // ══════════ ① 涨幅榜页 ══════════
  console.log('\n【涨幅榜页 /web/rank.html】');
  await p.goto(BASE + '/web/rank.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(7000);

  const rk = await p.evaluate(() => ({
    // RankPack 结构: .rp-hd(分类标签) + .rp-bd(榜单) + .rp-charts(配图) + .rp-iter(解读)
    gainPacks: document.querySelectorAll('#rk-gain .rp-hd').length,
    losePacks: document.querySelectorAll('#rk-lose .rp-hd').length,
    gainRows: document.querySelectorAll('#rk-gain .bd-row').length,
    loseRows: document.querySelectorAll('#rk-lose .bd-row').length,
    gainTag: (document.querySelector('#rk-gain .bd-tag') || {}).textContent || '',
    loseTag: (document.querySelector('#rk-lose .bd-tag') || {}).textContent || '',
    gainCats: (document.querySelector('#rk-gain .rp-cats') || {}).textContent || '',
    loseCats: (document.querySelector('#rk-lose .rp-cats') || {}).textContent || '',
    gainIter: (document.querySelector('#rk-gain .rp-iter') || {}).textContent || '',
    charts: document.querySelectorAll('#rk-gain .rp-chx canvas, #rk-lose .rp-chx canvas').length,
    // 旧表格应已移除
    oldTable: document.querySelectorAll('#rk-body').length,
    oldTabs: document.querySelectorAll('.rk-tab').length
  }));
  console.log('  ', JSON.stringify(rk));
  log(rk.gainPacks === 1 && rk.losePacks === 1, '涨幅/跌幅各挂 1 个 RankPack 组件');
  log(rk.gainRows > 0, '涨幅榜有行(' + rk.gainRows + ')');
  log(rk.loseRows > 0, '跌幅榜有行(' + rk.loseRows + ')');
  log(/涨幅/.test(rk.gainTag), '涨幅榜标签正确: ' + rk.gainTag.trim());
  log(/跌幅/.test(rk.loseTag), '跌幅榜标签正确: ' + rk.loseTag.trim());
  log(/1D/.test(rk.gainCats) && /涨跌幅/.test(rk.gainCats), '分类标签含 1D/涨跌幅: ' + rk.gainCats.replace(/\s+/g, ' ').trim());
  log(/解读/.test(rk.gainIter), '带解读结论');
  log(rk.charts > 0, '配图已渲染(' + rk.charts + ' canvas)');
  log(rk.oldTable === 0 && rk.oldTabs === 0, '旧表格/旧 tab 已移除');
  await p.screenshot({ path: 'tools/shots/rank_page.png' });

  // ══════════ ② 首页直播条多主流币 ══════════
  console.log('\n【总览 /web/index.html】');
  await p.goto(BASE + '/web/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(8000);
  const mj = await p.evaluate(() => {
    const items = Array.from(document.querySelectorAll('#lb-majors .lb-mj')).map(e => ({
      txt: e.textContent.replace(/\s+/g, ' ').trim(),
      sym: (e.querySelector('.lb-mj-n') || {}).textContent || '',
      px: (e.querySelector('.lb-mj-p') || {}).textContent || '',
      pct: (e.querySelector('.lb-mj-c') || {}).textContent || '',
      cls: (e.querySelector('.lb-mj-c') || {}).className || ''
    }));
    const bar = document.querySelector('.live-bar');
    return { items, count: items.length, barDisplay: bar ? getComputedStyle(bar).display : '' };
  });
  console.log('  ', JSON.stringify(mj.items.map(i => i.txt)));
  log(mj.count >= 5, '直播条主流币数量=' + mj.count + ' (≥5)');
  log(mj.items.every(i => i.px && i.pct && /[▲▼]/.test(i.pct)), '每个都有价格+涨跌幅');
  log(mj.items.every(i => /up|dn|flat/.test(i.cls)), '涨跌幅有红绿 class');
  await p.screenshot({ path: 'tools/shots/overview_majors.png' });

  // ══════════ ③ OKX 页榜单样式 ══════════
  console.log('\n【OKX 页 /modules/okx/web/index.html】');
  await p.goto(BASE + '/modules/okx/web/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await wait(8000);
  const ok = await p.evaluate(() => {
    const g = document.querySelector('#okx-rank');
    const l = document.querySelector('#okx-rank-lose');
    const st = (el) => el ? {
      rows: el.querySelectorAll('.bd-row').length,
      tag: (el.querySelector('.bd-tag') || {}).textContent || '',
      tagColor: (el.querySelector('.bd-tag') || {}).className || '',
      hdr: !!el.querySelector('.rp-hd'),
      charts: el.querySelectorAll('.rp-chx canvas').length,
      firstRow: (el.querySelector('.bd-row') || {}).textContent ? el.querySelector('.bd-row').textContent.replace(/\s+/g, ' ').trim() : ''
    } : null;
    return {
      gain: st(g), lose: st(l),
      boardsCss: !!Array.from(document.styleSheets).find(s => (s.href || '').indexOf('boards.css') >= 0),
      // RankPack 样式是否真的生效（.bd-row 应该有 display:flex 等）
      rowDisplay: g && g.querySelector('.bd-row') ? getComputedStyle(g.querySelector('.bd-row')).display : 'none'
    };
  });
  console.log('  ', JSON.stringify(ok));
  log(ok.boardsCss, '已加载 boards.css');
  log(ok.gain && ok.gain.rows > 0, 'OKX 涨幅榜有行(' + (ok.gain ? ok.gain.rows : 0) + ')');
  log(ok.lose && ok.lose.rows > 0, 'OKX 跌幅榜有行(' + (ok.lose ? ok.lose.rows : 0) + ')');
  log(ok.gain && /涨幅/.test(ok.gain.tag), 'OKX 涨幅榜标签: ' + (ok.gain ? ok.gain.tag.trim() : ''));
  log(ok.lose && /跌幅/.test(ok.lose.tag), 'OKX 跌幅榜标签: ' + (ok.lose ? ok.lose.tag.trim() : ''));
  log(ok.rowDisplay && ok.rowDisplay !== 'none', '榜单 CSS 生效(row display=' + ok.rowDisplay + ')');
  log(ok.gain && ok.gain.charts > 0, 'OKX 榜配图已渲染');
  await p.screenshot({ path: 'tools/shots/okx_rank.png' });

  log(errs.length === 0, '零 JS 错误' + (errs.length ? ' → ' + errs.slice(0, 5).join(' | ') : ''));

  await b.close();
  console.log('\n' + (fail ? '✗ 失败 ' + fail + ' 项' : '✓ 全部通过'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
