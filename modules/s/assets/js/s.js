/* ==================================================================
   s.js — 一年级学习乐园 · 第 3 层 AJAX(无框架, Vue 禁用)
   数据全部来自 C++ 引擎 /sapi/* (JSON/XML 文件层, 零数据库)
   ================================================================== */
(function () {
'use strict';
var $ = function (s, r) { return (r || document).querySelector(s); };
var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
var API = '/sapi/';
var STUDENT = localStorage.getItem('s.student') || 'default';
var score = +(localStorage.getItem('s.score') || 0);

/* ---------------- 基础 ---------------- */
function api(path, opt) {
  opt = opt || {};
  return fetch(API + path, {
    method: opt.method || 'GET',
    headers: opt.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opt.body ? JSON.stringify(opt.body) : undefined,
    cache: 'no-store'
  }).then(function (r) { return r.json(); });
}
function esc(s) {
  return String((s === null || s === undefined) ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function addScore(n) {
  score += n;
  localStorage.setItem('s.score', score);
  $('#scoreBox').textContent = '🏆 ' + score + ' 分';
}
function reward(txt) {
  $('#rwTxt').textContent = txt;
  $('#reward').classList.add('on');
  setTimeout(function () { $('#reward').classList.remove('on'); }, 1800);
}
function say(text) {                       // 语音朗读(浏览器内置, 兼容失败静默)
  try {
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN'; u.rate = .85;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch (e) {}
}
function tick() {
  var d = new Date();
  $('#clock').textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
}
setInterval(tick, 1000); tick();
$('#scoreBox').textContent = '🏆 ' + score + ' 分';

/* ---------------- 路由 ---------------- */
var VIEWS = ['home', 'practice', 'exam', 'pinyin', 'draw', 'ai'];
function route() {
  var v = (location.hash || '#/home').replace('#/', '').split('?')[0];
  if (VIEWS.indexOf(v) < 0) v = 'home';
  $$('.view').forEach(function (el) { el.classList.remove('on'); });
  $('#v-' + v).classList.add('on');
  $$('#nav a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-v') === v); });
  if (v === 'home') loadHome();
  if (v === 'pinyin') loadPinyin();
  if (v === 'draw') initDraw();
  if (v === 'ai') loadAi();
  if (v === 'practice' && !PR.subjects) loadPrSubjects();
}
window.addEventListener('hashchange', route);

/* ================= 首页 ================= */
var SUBJ_STYLE = {
  math:    { e: '🔢', c: '#60a5fa' },
  chinese: { e: '📖', c: '#f472b6' },
  english: { e: '🔤', c: '#fbbf24' },
  pinyin:  { e: '🗣️', c: '#2dd4bf' },
  problems:{ e: '🧩', c: '#a78bfa' }
};
function loadHome() {
  api('index').then(function (j) {
    if (!j.ok) return;
    var g = $('#subjGrid'); g.innerHTML = '';
    var names = j.subjects || [];
    $('#subjCount').textContent = '共 ' + (j.total || 0) + ' 题';
    names.forEach(function (s) {
      var st = SUBJ_STYLE[s.key] || { e: '📚', c: '#f0b90b' };
      var grades = Object.keys(s.grades || {}).map(function (x) { return x + '年级'; }).join(' · ');
      var d = document.createElement('div');
      d.className = 'subj-card';
      d.style.setProperty('--c', st.c);
      d.innerHTML = '<div class="subj-emoji">' + st.e + '</div>' +
        '<div class="subj-name">' + esc(s.name) + '</div>' +
        '<div class="subj-count">' + s.count + ' 道题</div>' +
        '<div class="subj-grades"><span class="g-chip">' + esc(grades) + '</span></div>';
      d.onclick = function () {
        $('#prSubj').value = s.key;
        location.hash = '#/practice';
        setTimeout(drawQuestion, 60);
      };
      g.appendChild(d);
    });
    // 知识点热度
    var tabs = $('#kpTabs'); tabs.innerHTML = '';
    names.forEach(function (s, i) {
      var b = document.createElement('button');
      b.className = 'kp-tab' + (i === 0 ? ' on' : '');
      b.textContent = s.name;
      b.onclick = function () {
        $$('.kp-tab').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        renderKp(s.key);
      };
      tabs.appendChild(b);
      if (i === 0) renderKp(s.key);
    });
    var heroMsgs = ['今天也要元气满满哦 ~', '错题不可怕, 弄懂它就是进步!', '每天进步一点点, 就是大进步!', '认真思考的小朋友最棒!'];
    $('#heroSub').textContent = heroMsgs[Math.floor(Math.random() * heroMsgs.length)];
  });
}
function renderKp(subj) {
  api('index').then(function (j) {
    var list = (j.kp_top || {})[subj] || [];
    var max = list.reduce(function (m, x) { return Math.max(m, x[1]); }, 1);
    var box = $('#kpList'); box.innerHTML = '';
    list.slice(0, 12).forEach(function (x) {
      var d = document.createElement('div');
      d.className = 'kp-item';
      d.innerHTML = '<span class="kp-name">' + esc(x[0]) + '</span>' +
        '<span class="kp-bar"><i style="width:' + (x[1] / max * 100) + '%"></i></span>' +
        '<span class="kp-n">' + x[1] + '</span>';
      d.title = '点击练习「' + x[0] + '」';
      d.onclick = function () {
        $('#prSubj').value = subj;
        location.hash = '#/practice';
        PR.kpFilter = x[0];
        setTimeout(drawQuestion, 60);
      };
      box.appendChild(d);
    });
  });
}

/* ================= 练习 ================= */
var PR = { subj: 'math', cur: null, answered: false, kpFilter: '' };
function loadPrSubjects() {
  api('index').then(function (j) {
    var sel = $('#prSubj'); sel.innerHTML = '';
    var esel = $('#exSubj'); esel.innerHTML = '';
    (j.subjects || []).forEach(function (s) {
      var o = document.createElement('option');
      o.value = s.key; o.textContent = s.name + ' (' + s.count + ')';
      sel.appendChild(o);
      esel.appendChild(o.cloneNode(true));
    });
    var gs = {};
    (j.subjects || []).forEach(function (s) { Object.keys(s.grades || {}).forEach(function (x) { gs[x] = 1; }); });
    [['#prGrade', true], ['#exGrade', false]].forEach(function (pair) {
      var gsel = $(pair[0]); if (!gsel) return;
      gsel.innerHTML = pair[1] ? '<option value="">全部年级</option>' : '<option value="">不分年级</option>';
      Object.keys(gs).sort().forEach(function (x) {
        var o = document.createElement('option');
        o.value = x; o.textContent = x + ' 年级';
        gsel.appendChild(o);
      });
    });
    PR.subjects = j.subjects;
  });
}
function drawQuestion() {
  PR.answered = false;
  var subj = $('#prSubj').value || 'math';
  var grade = $('#prGrade').value;
  api('exam?subject=' + encodeURIComponent(subj) + '&n=40&grade=' + (grade || 0) + '&seed=' + Date.now()).then(function (j) {
    if (!j.ok || !j.items.length) { $('#qEmpty').textContent = '这个学科还没有题目哦'; return; }
    var items = j.items;
    if (grade) items = items.filter(function (x) { return String(x.grade) === grade; });
    if (PR.kpFilter) {
      var f = items.filter(function (x) { return x.kp === PR.kpFilter; });
      if (f.length) items = f;
    }
    PR.kpFilter = '';
    PR.cur = items[Math.floor(Math.random() * items.length)];
    renderQuestion(PR.cur, 1);
  });
}
function renderQuestion(q, no) {
  $('#qEmpty').style.display = 'none';
  $('#qCard').style.display = 'block';
  $('#qExplain').style.display = 'none';
  $('#qNo').textContent = '第 ' + no + ' 题';
  $('#qKp').textContent = q.kp || '';
  $('#qSrc').textContent = q.src || '';
  $('#qStem').innerHTML = q.stem || esc(q.say || '');
  var opts = $('#qOpts'); opts.innerHTML = '';
  $('#qFill').style.display = 'none';
  if (q.type === 'choice' && q.opts) {
    q.opts.forEach(function (o, i) {
      var b = document.createElement('button');
      b.className = 'q-opt';
      b.innerHTML = 'ABCD'[i] + '. ' + esc(o);
      b.onclick = function () { answer(i, b); };
      opts.appendChild(b);
    });
  } else {
    $('#qFill').style.display = 'flex';
    $('#qInput').value = '';
    setTimeout(function () { $('#qInput').focus(); }, 50);
    $('#qInput').onkeydown = function (e) { if (e.key === 'Enter') submitFill(); };
    $('#qSubmitFill').onclick = submitFill;
  }
}
function submitFill() {
  var v = $('#qInput').value.trim();
  if (v === '') return;
  answer(isNaN(+v) ? v : +v, null);
}
function answer(ans, btn) {
  if (PR.answered) return;
  PR.answered = true;
  var q = PR.cur;
  var ok = String(ans) === String(q.ans);
  if (btn) {
    btn.classList.add('sel');
    $$('#qOpts .q-opt').forEach(function (b, i) {
      if (i === q.ans) b.classList.add('ok');
      else if (b === btn && !ok) b.classList.add('no');
    });
  }
  gradeOne(q, ans, function (j) {
    var ex = $('#qExplain');
    ex.style.display = 'block';
    var d = (j.detail || [])[0] || {};
    var right = (d.ok !== null && d.ok !== undefined) ? d.ok : ok;
    $('#exIcon').textContent = right ? '🎉' : '💡';
    $('#exTitle').textContent = right ? '答对啦, 真棒!' : '没关系, 学会它就赚了 ~';
    $('#exTitle').style.color = right ? 'var(--up)' : 'var(--gold)';
    var body = '';
    if (d.explain) body += '<div>📚 <b>讲解:</b> ' + esc(d.explain) + '</div>';
    if (q.say) body += '<div style="margin-top:6px">🔊 <b>读题:</b> ' + esc(q.say) + '</div>';
    if (q.eq) body += '<div style="margin-top:6px">🧮 <b>算式:</b> ' + esc(q.eq) + '</div>';
    body += '<div style="margin-top:6px">✅ <b>正确答案:</b> ' + esc(q.ans) + '</div>';
    $('#exBody').innerHTML = body;
    if (right) { addScore(10); if (Math.random() < .3) reward('答对啦! +10 分'); }
    else addScore(1);
    say((q.say || '') + '。' + (d.explain || ''));
  });
}
function gradeOne(q, ans, cb) {
  api('grade', { method: 'POST', body: { student: STUDENT, items: [q], answers: [{ id: q.id, ans: ans }] } }).then(cb);
}
$('#prStart').onclick = drawQuestion;
$('#qNext').onclick = function () { drawQuestion(); };
$('#qSay').onclick = function () { say(($('#qStem').textContent || '').slice(0, 80)); };

/* ================= 考试 ================= */
var EX = { items: [], ans: [], i: 0, subj: 'math' };
$('#exStart').onclick = function () {
  var subj = $('#exSubj').value || 'math', n = +$('#exN').value;
  var gEl = $('#exGrade'), grade = gEl ? (gEl.value || 0) : 0;
  EX.subj = subj;
  api('exam?subject=' + encodeURIComponent(subj) + '&n=' + n + '&grade=' + grade).then(function (j) {
    if (!j.ok || !j.items.length) { alert('抽卷失败: ' + (j.err || '无题目')); return; }
    EX.items = j.items;
    EX.ans = EX.items.map(function () { return null; });
    EX.i = 0;
    $('#exSet').style.display = 'none';
    $('#exReport').style.display = 'none';
    $('#exIng').style.display = 'block';
    renderEx();
  });
};
function renderEx() {
  var q = EX.items[EX.i], no = EX.i + 1;
  $('#exPgBar').style.width = (no / EX.items.length * 100) + '%';
  $('#exPgTxt').textContent = '第 ' + no + ' / ' + EX.items.length + ' 题';
  var card = $('#exCard');
  card.innerHTML = '<div class="q-head"><span class="q-no">第 ' + no + ' 题</span>' +
    '<span class="q-kp">' + esc(q.kp || '') + '</span></div>' +
    '<div class="q-stem">' + (q.stem || esc(q.say || '')) + '</div>' +
    '<div class="q-opts" id="exOpts"></div>' +
    '<div class="q-fill" id="exFill" style="display:none">' +
    '<input class="ipt ipt-big" id="exInput" type="text" placeholder="答案" autocomplete="off">' +
    '<button class="btn btn-gold" id="exOk">确定</button></div>';
  var opts = $('#exOpts'), fill = $('#exFill');
  if (q.type === 'choice' && q.opts) {
    q.opts.forEach(function (o, i) {
      var b = document.createElement('button');
      b.className = 'q-opt' + (EX.ans[EX.i] === i ? ' sel' : '');
      b.innerHTML = 'ABCD'[i] + '. ' + esc(o);
      b.onclick = function () {
        EX.ans[EX.i] = i;
        $$('#exOpts .q-opt').forEach(function (x, k) { x.classList.toggle('sel', k === i); });
      };
      opts.appendChild(b);
    });
  } else {
    fill.style.display = 'flex';
    var inp = $('#exInput');
    inp.value = (EX.ans[EX.i] === null || EX.ans[EX.i] === undefined) ? '' : EX.ans[EX.i];
    setTimeout(function () { inp.focus(); }, 50);
    inp.onkeydown = function (e) { if (e.key === 'Enter') $('#exOk').click(); };
    $('#exOk').onclick = function () {
      var v = inp.value.trim();
      EX.ans[EX.i] = v === '' ? null : (isNaN(+v) ? v : +v);
      if (EX.i < EX.items.length - 1) { EX.i++; renderEx(); } else submitEx();
    };
  }
  $('#exPrev').disabled = EX.i === 0;
  $('#exNext').disabled = EX.i === EX.items.length - 1;
}
$('#exPrev').onclick = function () { if (EX.i > 0) { EX.i--; renderEx(); } };
$('#exNext').onclick = function () { if (EX.i < EX.items.length - 1) { EX.i++; renderEx(); } };
$('#exSubmit').onclick = submitEx;
function submitEx() {
  var answers = EX.items.map(function (q, i) { return { id: q.id, ans: EX.ans[i] }; });
  api('grade', { method: 'POST', body: { student: STUDENT, items: EX.items, answers: answers } }).then(function (j) {
    if (!j.ok) { alert('批改失败'); return; }
    $('#exIng').style.display = 'none';
    var r = $('#exReport'); r.style.display = 'block';
    var pct = j.pct || 0;
    var msg = pct >= 90 ? '太厉害啦, 小学霸!' : pct >= 60 ? '不错哦, 继续加油!' : '别灰心, 看看解析再战!';
    var html = '<div class="rp-hero"><div class="rp-score">' + pct + ' 分</div>' +
      '<div class="rp-msg">答对 ' + j.score + ' / ' + j.total + ' 题 · ' + msg + '</div></div><div class="rp-rows">';
    var det = {};
    (j.detail || []).forEach(function (d) { det[d.id] = d; });
    EX.items.forEach(function (q, i) {
      var d = det[q.id] || {};
      html += '<div class="rp-row ' + (d.ok ? 'ok' : 'no') + '">' +
        '<div class="rp-q">' + (i + 1) + '. ' + (q.stem || esc(q.say || '')).replace(/<[^>]+>/g, ' ').slice(0, 90) + '</div>' +
        '<div class="rp-a">你的答案: <b>' + esc((EX.ans[i] === null || EX.ans[i] === undefined) ? '(空)' : EX.ans[i]) + '</b>' +
        (d.ok ? ' ✅' : ' · 正确答案: <b>' + esc(q.ans) + '</b>') +
        (d.explain ? ' · ' + esc(d.explain) : '') + '</div></div>';
    });
    html += '</div><div style="text-align:center;margin-top:18px"><button class="btn btn-gold btn-big" onclick="location.hash=\'#/exam\'">再考一次 🔁</button></div>';
    r.innerHTML = html;
    addScore(pct >= 60 ? 50 : 10);
    if (pct >= 90) reward('🎓 满分小学霸! +50 分');
  });
}

/* ================= 拼音(打开即教) ================= */
var PY = { items: [] };
function loadPinyin() {
  api('pinyin').then(function (j) {
    PY.items = j.items || [];
    renderPy('');
  });
}
function renderPy(key) {
  var items = PY.items;
  if (key) {
    items = items.filter(function (x) {
      return (x.stem || '').indexOf(key) >= 0 || x.dump && x.dump.indexOf(key) >= 0 ||
        (x.say || '').indexOf(key) >= 0;
    });
  }
  var g = $('#pyGrid'); g.innerHTML = '';
  items.forEach(function (x, i) {
    var m = /["'""](.)["'""]/.exec(x.stem || '');
    var hz = m ? m[1] : (x.stem || '').replace(/[^一-龥]/g, '').slice(0, 1) || '字';
    var d = document.createElement('div');
    d.className = 'py-cell';
    d.innerHTML = '<div class="py-hz">' + esc(hz) + '</div><div class="py-py">' + esc(x.say || '') + '</div>';
    d.onclick = function () {
      $$('#pyGrid .py-cell').forEach(function (c) { c.classList.remove('on'); });
      d.classList.add('on');
      $('#pyDetail').style.display = 'block';
      $('#pyBig').textContent = hz;
      $('#pySay').textContent = x.say || '';
      say(hz + ', ' + (x.say || ''));
      traceHz(hz);
      $('#pyPlay').onclick = function () { say(hz + ', ' + (x.say || '')); };
    };
    g.appendChild(d);
    if (i === 0 && !key) d.click();
  });
  if (!items.length) g.innerHTML = '<div class="ai-empty" style="grid-column:1/-1">没有找到相关拼音, 换个词试试 ~</div>';
}
$('#pySearch').oninput = function () { renderPy(this.value.trim()); };
function traceHz(hz) {                     // 笔画描红(逐笔画放大字 + 引导圈)
  var cv = $('#pyCanvas'), g = cv.getContext('2d');
  var W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.04)';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.1)';
  g.setLineDash([4, 4]);
  g.beginPath(); g.moveTo(W / 2, 8); g.lineTo(W / 2, H - 8); g.moveTo(8, H / 2); g.lineTo(W - 8, H / 2); g.stroke();
  g.setLineDash([]);
  g.fillStyle = 'rgba(240,185,11,.85)';
  g.font = '700 190px "PingFang SC","Microsoft YaHei",sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(hz, W / 2, H / 2 + 6);
  g.fillStyle = 'rgba(255,255,255,.75)';
  g.font = '13px sans-serif';
  g.fillText('用手指/鼠标在上面描红吧 ✍️', W / 2, H - 18);
  // 触摸/鼠标描红
  var drawing = false;
  function pos(e) {
    var r = cv.getBoundingClientRect();
    var t = e.touches ? e.touches[0] : e;
    return [(t.clientX - r.left) * (cv.width / r.width), (t.clientY - r.top) * (cv.height / r.height)];
  }
  cv.onmousedown = cv.ontouchstart = function (e) { drawing = true; var p = pos(e); g.beginPath(); g.moveTo(p[0], p[1]); };
  cv.onmousemove = cv.ontouchmove = function (e) {
    if (!drawing) return; e.preventDefault();
    var p = pos(e);
    g.strokeStyle = 'rgba(45,212,191,.9)'; g.lineWidth = 10; g.lineCap = 'round'; g.lineJoin = 'round';
    g.lineTo(p[0], p[1]); g.stroke();
  };
  cv.onmouseup = cv.onmouseleave = cv.ontouchend = function () { drawing = false; };
}
$('#pyTrace').onclick = function () {
  var hz = $('#pyBig').textContent;
  if (hz) { traceHz(hz); say(hz); }
};

/* ================= 画图(几何教学) ================= */
var DR = { tool: 'pen', color: '#f0b90b', drawing: false, x0: 0, y0: 0, snapshot: null, steps: [], step: -1, inited: false };
var drCv, drG;
function initDraw() {
  if (DR.inited) return;
  DR.inited = true;
  drCv = $('#drCanvas'); drG = drCv.getContext('2d');
  drG.fillStyle = '#0d1220'; drG.fillRect(0, 0, drCv.width, drCv.height);
  $$('.dr-tools .tbtn[data-t]').forEach(function (b) {
    b.onclick = function () {
      $$('.dr-tools .tbtn[data-t]').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); DR.tool = b.getAttribute('data-t');
      $('#drHint').textContent = { pen: '铅笔: 自由涂鸦', line: '直线: 按住拖动画直线', rect: '矩形: 按住拖出方框', circle: '圆: 按住拖出圆', eraser: '橡皮: 按住擦除' }[DR.tool];
    };
  });
  var COLORS = ['#f0b90b', '#ff4d4f', '#60a5fa', '#2dd4bf', '#a78bfa', '#ffffff'];
  var cb = $('#drColors'); cb.innerHTML = '';
  COLORS.forEach(function (c, i) {
    var s = document.createElement('span');
    s.className = 'dr-c' + (i === 0 ? ' on' : '');
    s.style.background = c;
    s.onclick = function () {
      $$('.dr-c').forEach(function (x) { x.classList.remove('on'); });
      s.classList.add('on'); DR.color = c;
    };
    cb.appendChild(s);
  });
  $('#drClear').onclick = function () { drG.fillStyle = '#0d1220'; drG.fillRect(0, 0, drCv.width, drCv.height); DR.step = -1; markStep(); };
  $('#drUndo').onclick = function () {
    if (DR.snapshot) { drG.putImageData(DR.snapshot, 0, 0); DR.snapshot = null; }
  };
  function pos(e) {
    var r = drCv.getBoundingClientRect();
    var t = e.touches ? e.touches[0] : e;
    return [(t.clientX - r.left) * (drCv.width / r.width), (t.clientY - r.top) * (drCv.height / r.height)];
  }
  drCv.addEventListener('mousedown', start);
  drCv.addEventListener('touchstart', start, { passive: false });
  drCv.addEventListener('mousemove', move);
  drCv.addEventListener('touchmove', move, { passive: false });
  drCv.addEventListener('mouseup', end);
  drCv.addEventListener('mouseleave', end);
  drCv.addEventListener('touchend', end);
  function start(e) {
    e.preventDefault();
    DR.drawing = true;
    var p = pos(e); DR.x0 = p[0]; DR.y0 = p[1];
    DR.snapshot = drG.getImageData(0, 0, drCv.width, drCv.height);
    if (DR.tool === 'pen' || DR.tool === 'eraser') {
      drG.beginPath(); drG.moveTo(p[0], p[1]);
      drG.strokeStyle = DR.tool === 'eraser' ? '#0d1220' : DR.color;
      drG.lineWidth = DR.tool === 'eraser' ? 26 : 3;
      drG.lineCap = 'round'; drG.lineJoin = 'round';
    }
  }
  function move(e) {
    if (!DR.drawing) return;
    e.preventDefault();
    var p = pos(e);
    if (DR.tool === 'pen' || DR.tool === 'eraser') { drG.lineTo(p[0], p[1]); drG.stroke(); return; }
    drG.putImageData(DR.snapshot, 0, 0);
    drG.strokeStyle = DR.color; drG.lineWidth = 3; drG.setLineDash([]);
    drG.beginPath();
    if (DR.tool === 'line') { drG.moveTo(DR.x0, DR.y0); drG.lineTo(p[0], p[1]); }
    else if (DR.tool === 'rect') { drG.rect(DR.x0, DR.y0, p[0] - DR.x0, p[1] - DR.y0); }
    else if (DR.tool === 'circle') {
      var rx = Math.abs(p[0] - DR.x0) / 2, ry = Math.abs(p[1] - DR.y0) / 2;
      drG.ellipse((DR.x0 + p[0]) / 2, (DR.y0 + p[1]) / 2, rx, ry, 0, 0, Math.PI * 2);
    }
    drG.stroke();
  }
  function end() { DR.drawing = false; }
  loadDrawSteps('triangle');
}
var DR_KINDS = [
  ['triangle', '三角形'], ['angle', '角'], ['circle', '圆'],
  ['rectangle', '长方形'], ['parallel', '平行线'], ['perpendicular', '垂线']
];
function loadDrawSteps(kind) {
  api('draw?kind=' + encodeURIComponent(kind)).then(function (j) {
    DR.steps = j.steps || [];
    DR.step = -1;
    var t = $('#drTabs'); t.innerHTML = '';
    DR_KINDS.forEach(function (k) {
      var b = document.createElement('button');
      b.className = 'kp-tab' + (k[0] === kind ? ' on' : '');
      b.textContent = k[1];
      b.onclick = function () { loadDrawSteps(k[0]); };
      t.appendChild(b);
    });
    renderSteps();
    say('我们来学画' + (DR_KINDS.filter(function (k) { return k[0] === kind; })[0] || [kind])[1] + ', 一共' + DR.steps.length + '步');
  });
}
function renderSteps() {
  var ol = $('#drList'); ol.innerHTML = '';
  DR.steps.forEach(function (s, i) {
    var li = document.createElement('li');
    li.innerHTML = '<b>' + esc(s.do) + '</b><i>' + esc(s.tip || '') + '</i>';
    li.onclick = function () { DR.step = i; markStep(); say(s.do + '。' + (s.tip || '')); };
    ol.appendChild(li);
  });
  markStep();
}
function markStep() {
  $$('#drList li').forEach(function (li, i) { li.classList.toggle('on', i === DR.step); });
  if (DR.step >= 0) $('#drHint').textContent = '第 ' + (DR.step + 1) + ' 步: ' + DR.steps[DR.step].do + ' — ' + (DR.steps[DR.step].tip || '');
}

/* ================= AI 工具 ================= */
function loadAi() { loadWeak(); }
$('#aiGo').onclick = aiSearch;
$('#aiQ').onkeydown = function (e) { if (e.key === 'Enter') aiSearch(); };
function aiSearch() {
  var q = $('#aiQ').value.trim();
  if (!q) return;
  api('nlp?q=' + encodeURIComponent(q)).then(function (j) {
    var box = $('#aiHits'); box.innerHTML = '';
    var hits = j.hits || [];
    if (!hits.length) { box.innerHTML = '<div class="ai-empty">没找到相关题目, 换个说法试试 ~</div>'; return; }
    hits.slice(0, 12).forEach(function (h) {
      var d = document.createElement('div');
      d.className = 'ai-hit';
      d.innerHTML = '<div class="h-kp">' + esc(h.kp || '') + ' · ' + esc(h.src || '') + '</div>' +
        '<div class="h-stem">' + (h.stem || esc(h.say || '')).slice(0, 160) + '</div>' +
        (h.explain ? '<div class="h-ex">💡 ' + esc(h.explain) + '</div>' : '');
      d.onclick = function () { say((h.say || '') + '。' + (h.explain || '')); };
      box.appendChild(d);
    });
  });
}
function loadWeak() {
  api('weak?student=' + encodeURIComponent(STUDENT)).then(function (j) {
    var box = $('#aiWeak'); box.innerHTML = '';
    var w = j.weak || [];
    if (!w.length) { box.innerHTML = '<div class="ai-empty">还没有学习记录, 去做几道练习再来看看吧 ~</div>'; }
    else w.forEach(function (x) {
      var d = document.createElement('div');
      d.className = 'weak-row';
      d.innerHTML = '<b>' + esc(x.kp) + '</b><span class="kp-bar"><i style="width:' + (x.acc || 0) + '%"></i></span><span>' + x.ok + '/' + x.n + ' (' + (x.acc || 0) + '%)</span>';
      box.appendChild(d);
    });
    var rec = $('#aiRec'); rec.innerHTML = '';
    var rs = j.recommend || [];
    if (rs.length) {
      rs.forEach(function (q) {
        var d = document.createElement('div');
        d.className = 'rec-item';
        d.innerHTML = '🎁 ' + (q.stem || esc(q.say || '')).replace(/<[^>]+>/g, ' ').slice(0, 70);
        d.onclick = function () {
          PR.cur = q; PR.kpFilter = ''; PR.answered = false;
          location.hash = '#/practice';
          setTimeout(function () { renderQuestion(q, 1); }, 60);
        };
        rec.appendChild(d);
      });
    } else rec.innerHTML = '<div class="ai-empty">多做练习, AI 就能给你定制推荐啦 ~</div>';
  });
}
$('#aiRefresh').onclick = loadWeak;

/* ---------------- 启动 ---------------- */
loadPrSubjects();          // 预填练习/考试学科下拉
route();
})();
