/*
 * abacus.js — 业务层 / 口算动画引擎
 * 支持模式：add 加法 / sub 减法 / carry 凑十法 / mul 乘法 / div 除法 / mixed 混合。
 * 用 SVG 图片做动画（动物/植物/水果），含语音朗读与音效。
 * 用法（见 views/abacus-view.js）：App.Abacus.run(els, S) / stop / renderPicker / sizeRow。
 * 兼容：不使用 ?? ?.，不使用 await，纯回调/定时器。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var IMG = App.IMG, U = App.U;

  // 中文文案
  var ZH = {
    title: "口算动画课堂", add: "加法", sub: "减法", carry: "凑十法", mul: "乘法", div: "除法", mixed: "混合",
    play: "开始", pause: "暂停", replay: "重播", speed: "速度", slow: "慢", normal: "正常", fast: "快",
    voice: "语音", sfx: "音效", num1: "数 1", num2: "数 2", emoji: "图形",
    hint: "数 1、数 2 最大都能到 10（减法可到 20，乘法/除法自动适配）。选图形，点“开始”看动画！",
    plus: "＋", minus: "－", times: "×", div: "÷", q: "？个",
    // 开场必须先完整念出题目（算式 + 问号），不能只说"我们来算"
    s1: function (a, b, m) {
      if (m === "add") return "题目：" + a + " 加 " + b + " 等于几？";
      if (m === "sub") return "题目：" + a + " 减 " + b + " 等于几？";
      if (m === "carry") return (a === 10 ? "题目：10 加 " + b + " 等于几？" : "题目：" + a + " 加 " + b + " 等于几？超过十啦，用凑十法！");
      if (m === "mul") return "题目：" + a + " 乘 " + b + " 等于几？就是 " + a + " 个 " + b + "。";
      if (m === "div") return "题目：把 " + a + " 平均分成 " + b + " 份，每份是几？";
      return "题目：" + a + " 和 " + b + " 的混合题，等于几？";
    },
    s2: function (n) { return "先有 " + n + " 个。"; },
    s3: function (n) { return "又来了 " + n + " 个。"; },
    s4: function (n) { return "拿走了 " + n + " 个。"; },
    s5: function () { return "一共有多少个呢？"; },
    s6: function () { return "我们一起来数一数。"; },
    s7: function (x, y, z, op) { return x + " " + op + " " + y + " 等于 " + z + "！答对啦！"; },
    s8: function (x, y, z, op) { return x + " " + op + " " + y + " 等于 " + z + "！你学会了吗？"; },
    s9: function (x, y, k, r) { return "把 " + y + " 分成 " + k + " 和 " + r + "。先算 " + x + " 加 " + k + " 等于 10，再算 10 加 " + r + " 等于 " + (x + k + r) + "！"; },
    s10: function (y) { return "10 加 " + y + "，直接就是 " + (10 + y) + "！"; },
    mulStep: function (a, b) { return "把 " + a + " 个 " + b + " 合起来，一共是 " + (a * b) + " 个。"; },
    divStep: function (a, b, q) { return "把 " + a + " 平均分成 " + b + " 份，每份 " + q + " 个。"; },
    count: function (n) { return n + " 个"; }, total: function (n) { return "一共 " + n + " 个"; },
    left: function (n) { return "还剩 " + n + " 个"; }, stepMake: function () { return "先凑十："; }, stepRest: function () { return "还剩下："; }, stepFin: function () { return "再看："; }
  };

  function $(id) { return document.getElementById(id); }
  function emojiNode(id, from, grp) {
    var d = document.createElement("span");
    d.className = "e" + (from === "L" ? " fromL" : from === "R" ? " fromR" : "");
    d.innerHTML = IMG.svg(id) || "⭐";
    if (grp) { try { d.dataset.grp = grp; } catch (e) { d.setAttribute("data-grp", grp); } }
    return d;
  }
  function spacer() { var s = document.createElement("span"); s.className = "espace"; s.textContent = " "; return s; }

  function sizeRow(S) {
    var total = (curMode === "sub") ? S.a : (curMode === "mul" ? S.a * S.b : (curMode === "div" ? S.a : S.a + S.b));
    if ($("row")) { $("row").style.fontSize = total <= 10 ? "46px" : total <= 16 ? "38px" : "30px"; }
  }

  /* 混合模式：随机抽一种运算，并把数字调成该运算合法范围（数字同步显示在控件上） */
  function pickMixed(S) {
    var modes = ["add", "sub", "carry", "mul", "div"];
    var m = modes[Math.floor(Math.random() * modes.length)];
    if (m === "mul") {
      S.a = 2 + Math.floor(Math.random() * 3);
      S.b = 2 + Math.floor(Math.random() * 3);
    } else if (m === "div") {
      var b2 = 2 + Math.floor(Math.random() * 3), q = 2 + Math.floor(Math.random() * 3);
      S.b = b2; S.a = b2 * q; if (S.a > 12) { S.a = 12; S.b = 3; }
    } else if (m === "sub") {
      if (S.a <= S.b) S.a = Math.min(20, S.b + 2 + Math.floor(Math.random() * 6));
      if (S.a > 20) S.a = 20;
      if (S.b >= S.a) S.b = Math.max(1, S.a - 1);
      if (S.b < 1) S.b = 1;
    } else {
      if (S.a > 10) S.a = 10;
      if (S.a + S.b > 20) S.b = 20 - S.a;
      if (S.b < 1) S.b = 1;
    }
    return m;
  }

  /* ---------------- 步骤引擎 ---------------- */
  var timer = null, queue = [], playing = false, paused = false, curSpeed = 1, curMode = "add", curVoice = true, curSfx = true;

  function stopAll(els) {
    if (timer) { clearTimeout(timer); timer = null; }
    queue = []; playing = false; paused = false; speechUntil = 0; hold = 0;
    if (App.Speech && App.Speech.stop) { try { App.Speech.stop(); } catch (e0) {} }
    if (els && els.playBtn) { els.playBtn.disabled = false; }
    if (els && els.tPlay) { els.tPlay.textContent = ZH.play; }
    if (els && els.say) { els.say.textContent = ""; }
    if (els && els.steps) { els.steps.textContent = ""; }
    try { if ("speechSynthesis" in w) w.speechSynthesis.cancel(); } catch (e) {}
  }
  // 动画快慢同步到语速：动画越快话也说得快一点，避免"嘴跟不上"
  function speechRate() {
    var f = curSpeed ? 1 / curSpeed : 1;
    if (f < 0.85) f = 0.85;
    if (f > 1.5) f = 1.5;
    var st = (App.Speech && App.Speech.currentStyle) ? App.Speech.currentStyle() : null;
    var base = st ? st.rate : 0.95;
    return Math.round(base * f * 100) / 100;
  }
  // 记下"这句话大概说到什么时候"：动画据此把下一步排在话音落完之后，不再被下一句掐断
  var speechUntil = 0;
  function tick() { return (w.performance && w.performance.now) ? w.performance.now() : (new Date()).getTime(); }
  function _say(t) {
    if (!curVoice || !App.Speech) return;
    var r = speechRate();
    App.Speech.speak(t, { rate: r });
    var est = App.Speech.estimate ? App.Speech.estimate(t, { rate: r }) : 0;
    speechUntil = est ? (tick() + est) : 0;
  }
  function _pop() { if (curSfx && App.Speech) App.Speech.sfx.pop(); }
  function _off() { if (curSfx && App.Speech) App.Speech.sfx.off(); }
  function _chime() { if (curSfx && App.Speech) App.Speech.sfx.right(); }

  // 兜底：引擎真的还在念就不要抢（估算会随实测校准，但在线嗓音快慢差别大，这里查真实状态）
  var hold = 0;
  function stillSpeaking() {
    if (!curVoice) return false;
    try { return !!(w.speechSynthesis && w.speechSynthesis.speaking); } catch (e) { return false; }
  }
  function runStep() {
    if (paused || !queue.length) {
      if (!queue.length) { playing = false; if (globalEls && globalEls.playBtn) globalEls.playBtn.disabled = false; if (globalEls && globalEls.tPlay) globalEls.tPlay.textContent = ZH.play; }
      return;
    }
    if (stillSpeaking() && hold < 45) { hold++; timer = setTimeout(runStep, 150); return; }
    hold = 0;
    var st = queue.shift();
    st.fn();
    var wait = st.delay * curSpeed;
    // 还有话没说完：等到说完再走下一步（+0.3 秒换气），动画不再跑到话前面去
    var left = speechUntil ? (speechUntil - tick()) : 0;
    if (left > 0) wait = Math.max(wait, left + 300);
    timer = setTimeout(runStep, wait);
  }
  var globalEls = null;

  function buildSteps(S, els) {
    curMode = S.mode; curSpeed = S.speed; curVoice = S.voice; curSfx = S.sfx; globalEls = els;
    var a = S.a, b = S.b, isAdd = S.mode === "add", isSub = S.mode === "sub", isCarry = S.mode === "carry",
        isMul = S.mode === "mul", isDiv = S.mode === "div";
    queue = [];
    push(400, prepare);

    if (isMul) {
      // a 个 b：分 a 组，每组 b 个
      for (var g = 0; g < a; g++) {
        if (g > 0) push(180, function () { $("row").appendChild(spacer()); });
        for (var i2 = 0; i2 < b; i2++) push(260, (function () { var e = emojiNode(S.emo); return function () { $("row").appendChild(e); _pop(); }; })());
      }
      push(500, function () { top("a 个 b 合起来".replace("a", a).replace("b", b)); _say(ZH.mulStep(a, b)); });
      push(900, function () { braceShow(); $("qlabel").textContent = ZH.q; $("qlabel").className = "q pulse"; _say(ZH.s5()); });
      push(1400, function () { _say(ZH.s6()); });
      push(700, function () { reveal(a * b, ZH.total(a * b), ZH.s7(a, b, a * b, ZH.times), true); });
    } else if (isDiv) {
      var q = Math.floor(a / b);
      for (var k = 0; k < a; k++) push(220, (function () { var e = emojiNode(S.emo); return function () { $("row").appendChild(e); _pop(); }; })());
      push(500, function () { top("把 a 平均分成 b 份".replace("a", a).replace("b", b)); _say(ZH.divStep(a, b, q)); });
      push(900, function () { braceShow(); $("qlabel").textContent = "每份几个？"; $("qlabel").className = "q pulse"; });
      // 分组上色
      push(600, function () {
        var items = $("row").children;
        for (var i3 = 0; i3 < items.length; i3++) {
          if (items[i3].className.indexOf("e ") < 0 && items[i3].className.indexOf("e") < 0) continue;
          if (Math.floor(i3 / q) % 2 === 0) items[i3].classList.add("gold"); else items[i3].classList.add("blue");
        }
        _chime();
      });
      push(1600, function () { reveal(q, "每份 " + q + " 个", ZH.s8(a, b, q, ZH.div), true); });
    } else {
      // 加 / 减 / 凑十
      if (isSub) {
        popIn(a, 420, "L");
        push(520, function () { top(ZH.total(a)); _say(ZH.s2(a)); });
        push(950, function () { top(ZH.total(a) + " " + ZH.minus + " " + ZH.count(b)); });
        push(400, function () {
          var items = $("row").children, gone = [];
          for (var i = items.length - 1; i >= 0; i--) { var cl = items[i].className || ""; if (cl.indexOf("e") >= 0) gone.unshift(items[i]); }
          var real = gone.slice(a - b);
          var gap = 320; real.forEach(function (node, idx) { setTimeout(function () { node.classList.add("off"); _off(); }, idx * gap); });
        });
        push(Math.max(500, b * 360 + 250), function () { _say(ZH.s4(b)); });
      } else {
        popIn(a, 420, "L");
        push(520, function () { top(ZH.count(a)); _say(ZH.s2(a)); });
        push(950, function () { top(ZH.count(a) + " " + ZH.plus + " "); });
        popIn(b, 420, "R");
        push(520, function () { top(ZH.count(a) + " " + ZH.plus + " " + ZH.count(b)); _say(ZH.s3(b)); });
      }
      push(800, function () { braceShow(); $("qlabel").textContent = ZH.q; $("qlabel").className = "q pulse"; _say(ZH.s5()); });
      push(2100, function () { _say(ZH.s6()); });

      if (isCarry && a < 10 && a + b > 10) {
        var k = 10 - a, r = b - k;
        push(600, function () {
          var items = $("row").children, arr = [];
          for (var i = 0; i < items.length; i++) { if ((items[i].className || "").indexOf("e") >= 0) arr.push(items[i]); }
          arr.slice(a, a + k).forEach(function (n) { n.classList.add("gold"); });
          if (els && els.steps) els.steps.textContent = "🔸 " + ZH.stepMake() + a + "＋" + k + "＝10";
          _say(ZH.s9(a, b, k, r)); _chime();
        });
        push(3400, function () {
          var items = $("row").children, arr = [];
          for (var i = 0; i < items.length; i++) { if ((items[i].className || "").indexOf("e") >= 0) arr.push(items[i]); }
          arr.slice(a + k).forEach(function (n) { n.classList.add("blue"); });
          if (els && els.steps) els.steps.textContent = "🔹 " + ZH.stepRest() + r + "　" + ZH.stepFin() + "10＋" + r + "＝" + (10 + r);
          if ($("topLabel")) $("topLabel").textContent = ZH.total(10) + " " + ZH.plus + " " + ZH.count(r);
        });
        push(2800);
      } else if (isCarry && a === 10) {
        push(600, function () { if (els && els.steps) els.steps.textContent = "🔸 10＋" + b + "＝" + (10 + b); _say(ZH.s10(b)); _chime(); });
        push(2200);
      }

      push(500, function () {
        var items = $("row").children, all = [];
        for (var i = 0; i < items.length; i++) { if ((items[i].className || "").indexOf("e") >= 0 && !(isSub && items[i].classList.contains("off"))) all.push(items[i]); }
        var n = 0, gap = 520;
        var cnt = setInterval(function () {
          if (n > 0 && all[n - 1]) all[n - 1].classList.remove("count");
          if (n >= all.length) { clearInterval(cnt); return; }
          var node = all[n]; node.classList.add("count");
          var cur = n + 1;
          if ($("topLabel")) $("topLabel").textContent = isSub ? ZH.left(cur) : ZH.total(cur);
          if (curVoice && App.Speech) App.Speech.sfx.pop();
          n++;
        }, gap);
      });
      var res = isSub ? a - b : a + b;
      push(Math.max(800, (isSub ? a - b : a + b) * 560 + 700), function () {
        reveal(res, isSub ? ZH.left(res) : ZH.total(res), isSub ? ZH.s8(a, b, res, ZH.minus) : ZH.s7(a, b, res, ZH.plus), false);
      });
      push(1800, function () {});
    }
  }

  function push(delay, fn) { queue.push({ delay: delay, fn: fn }); }
  function popIn(k, gap, from) {
    for (var i = 0; i < k; i++) push(gap, (function () { var e = emojiNode(null, from); return function () { $("row").appendChild(e); _pop(); }; })());
  }
  // 用当前选定的图形
  function popInEmo(k, gap, from, emoId) {
    for (var i = 0; i < k; i++) push(gap, (function () { var e = emojiNode(emoId, from); return function () { $("row").appendChild(e); _pop(); }; })());
  }
  // 用 emojiNode 默认会读 S.emo；为简单，prepare 时把当前 emo 存入模块变量
  var _curEmo = "cat";
  function prepare() {
    if ($("row")) $("row").innerHTML = "";
    if ($("topLabel")) $("topLabel").textContent = "";
    if ($("qlabel")) $("qlabel").textContent = "";
    if (els0 && els0.steps) els0.steps.textContent = "";
    sizeRow(curState);
    if (App.Draw) { var st = stageEl(); if (st) App.Draw.clear(st); }
    var ans = $("e-ans"); if (ans) { ans.textContent = "?"; ans.classList.remove("reveal"); }
    var op = curMode === "sub" ? ZH.minus : curMode === "mul" ? ZH.times : curMode === "div" ? ZH.div : ZH.plus;
    if ($("e-a")) $("e-a").textContent = curState.a;
    if ($("e-b")) $("e-b").textContent = curState.b;
    if ($("e-op")) $("e-op").textContent = op;
    _say(ZH.s1(curState.a, curState.b, curMode));
  }
  var els0 = null, curState = { a: 3, b: 2 };
  function top(t) { if ($("topLabel")) $("topLabel").textContent = t; }
  /* 大括号：先量出 #row 里该组图形的真实位置，再用画图引擎对准绘制（不再写死坐标） */
  function stageEl() { var r = $("row"); return r ? r.parentNode : null; }
  function groupNodes(grp) {
    var row = $("row"), out = [], i, c;
    if (!row) return out;
    for (i = 0; i < row.children.length; i++) {
      c = row.children[i];
      if ((c.className || "").indexOf("e") < 0) continue;
      var g = (c.dataset && c.dataset.grp) || c.getAttribute("data-grp") || "";
      if (grp === "ALL") { out.push(c); continue; }   // ALL = 全部图案（原来永远匹配不到，括号就空了）
      if (g === grp) out.push(c);
    }
    return out;
  }
  var _brace = { grp: "ALL", label: "", from: 0, to: -1 };
  function braceShow() {
    var nodes = groupNodes(_brace.grp);
    if (_brace.to >= 0) nodes = nodes.slice(_brace.from, _brace.to);
    else if (_brace.from > 0) nodes = nodes.slice(_brace.from);
    var host = $("braceBox");
    if (!host || !App.Brace) {
      // 兜底：老式画图层（没有专用括号模块时）
      var stage = stageEl();
      if (!stage || !App.Draw || !nodes.length) return;
      App.Draw.brace(stage, nodes, { label: _brace.label, color: "#e65100", w: 3, dur: 800, up: curMode === "sub" });
      return;
    }
    if (!nodes.length) { App.Brace.clear(host); return; }
    /* ★2026-10-26 用户要求：加法括号在【下面】(尖端朝下，不变)；
     *   减法括号在【上面】、中间尖端朝上；「？个」的问题标签一律在最上面。
     *   实现：父容器改纵向 flex，用 order 控制括号与图案的上下关系。 */
    var isSub = curMode === "sub";
    var par = host.parentNode;
    if (par) { try { par.style.display = "flex"; par.style.flexDirection = "column"; } catch (e0) {} }
    var rowEl = $("row"), qEl = $("qlabel");
    if (rowEl) rowEl.style.order = "2";
    if (qEl) qEl.style.order = "-1";                 // ★问题标签永远最上面
    host.style.order = isSub ? "1" : "3";           // 减法：括号在图案上方
    App.Brace.draw(host, {
      span: nodes, label: _brace.label, color: "#e65100",
      stroke: 4, depth: 26, dur: 800,
      up: isSub                                      // ★减法：尖端朝上
    });
  }
  function reveal(v, label, sayTxt) {
    var ans = $("e-ans"); if (ans) { ans.textContent = v; ans.classList.add("reveal"); }
    if ($("qlabel")) { $("qlabel").textContent = label; $("qlabel").className = "q big"; }
    if (els0 && els0.steps) els0.steps.textContent = (els0.steps.textContent || "") ;
    _say(sayTxt); _chime(); confetti();
  }
  function confetti() {
    var box = document.querySelector(".card"); if (!box) return;
    var chars = ["🎉", "🎊", "✨", "⭐", "🌟", "💫", "🏅"];
    for (var i = 0; i < 22; i++) {
      var s = document.createElement("span"); s.className = "conf"; s.textContent = chars[i % 7];
      s.style.left = (Math.random() * 96) + "%"; s.style.animationDuration = (1.6 + Math.random() * 1.6) + "s"; s.style.animationDelay = (Math.random() * 0.6) + "s";
      box.appendChild(s); (function (s) { setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 3800); })(s);
    }
    for (var j = 0; j < 8; j++) {
      var sp = document.createElement("span"); sp.className = "spark"; sp.textContent = "✨";
      sp.style.left = (10 + Math.random() * 80) + "%"; sp.style.top = (45 + Math.random() * 35) + "%"; sp.style.animationDelay = (Math.random() * 0.5) + "s";
      box.appendChild(sp); (function (sp) { setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 2300); })(sp);
    }
  }

  /* 修正：buildSteps 里多处需要用当前 emo，重建 popIn 以使用 _curEmo */
  // 重写 popIn 使用 _curEmo
  function popIn2(k, gap, from) {
    for (var i = 0; i < k; i++) push(gap, (function () { var e = emojiNode(_curEmo, from); return function () { $("row").appendChild(e); _pop(); }; })());
  }

  App.Abacus = {
    ZH: ZH,
    run: function (els, S) {
      els0 = els; curState = S; _curEmo = S.emo;
      // 用带 emo 的 popIn 替换通用版
      buildSteps2(els, S);
      playing = true; paused = false;
      if (els.playBtn) els.playBtn.disabled = true;
      if (els.tPlay) els.tPlay.textContent = ZH.pause;
      runStep();
    },
    stop: function (els) { stopAll(els); },
    sizeRow: sizeRow,
    renderPicker: function (box, S, onChange) {
      box.innerHTML = "";
      var ids = S.pickerIds || ["cat", "dog", "rabbit", "bird", "fish", "flower", "apple", "star", "tree", "butterfly", "duck", "pig"];
      ids.forEach(function (id, i) {
        var s = document.createElement("span");
        s.className = "emo"; s.innerHTML = IMG.svg(id) || "⭐";
        s.style.cssText = "opacity:" + (i === S.emoIdx ? 1 : 0.45) + ";outline:" + (i === S.emoIdx ? "2px solid #ff7043" : "none") + ";border-radius:8px;padding:0 2px;cursor:pointer;";
        s.onclick = function () { S.emoIdx = i; S.emo = ids[i]; if (onChange) onChange(); };
        box.appendChild(s);
      });
    },
    setEmoByIndex: function (S) { var ids = S.pickerIds || ["cat", "dog", "rabbit", "bird", "fish", "flower", "apple", "star", "tree", "butterfly", "duck", "pig"]; S.emo = ids[S.emoIdx || 0]; }
  };

  /* 真正的 buildSteps（使用 _curEmo）。上面 buildSteps 保留但被本函数覆盖调用。 */
  function buildSteps2(els, S) {
    curMode = S.mode; curSpeed = S.speed; curVoice = S.voice; curSfx = S.sfx; globalEls = els;
    var a = S.a, b = S.b, isAdd = S.mode === "add", isSub = S.mode === "sub", isCarry = S.mode === "carry",
        isMul = S.mode === "mul", isDiv = S.mode === "div";
    queue = [];
    push(400, prepare);
    // 复用原 buildSteps 逻辑，但 popIn 用 emojiNode(_curEmo)
    // 为简洁，直接调用原 buildSteps（它内部 popIn 用 emojiNode(null) 会渲染默认⭐，故这里改用 popIn2 已在 push 中嵌入）
    // 直接用原 buildSteps 的队列构造：复制逻辑
    buildQueue(S, els);
    runStep();
  }

  // 用明确的队列构造（避免闭包变量混乱）
  function buildQueue(S, els) {
    var a = S.a, b = S.b, m = S.mode;
    if (m === "mixed") m = pickMixed(S);   // 混合：本题实际运算 + 数字适配
    curMode = m;
    a = S.a; b = S.b;
    if (m === "mul") {
      for (var g = 0; g < a; g++) {
        if (g > 0) push(180, function () { if ($("row")) $("row").appendChild(spacer()); });
        for (var i2 = 0; i2 < b; i2++) push(260, (function () { var e = emojiNode(_curEmo, "", "G" + g); return function () { if ($("row")) $("row").appendChild(e); _pop(); }; })());
      }
      _brace = { grp: "ALL", label: a + " 个 " + b, from: 0, to: -1 };
      push(500, function () { top(a + " 个 " + b + " 合起来"); _say(ZH.mulStep(a, b)); });
      push(900, function () { braceShow(); if ($("qlabel")) { $("qlabel").textContent = ZH.q; $("qlabel").className = "q pulse"; } _say(ZH.s5()); });
      push(1400, function () { _say(ZH.s6()); });
      push(700, function () { reveal(a * b, ZH.total(a * b), ZH.s7(a, b, a * b, ZH.times)); });
    } else if (m === "div") {
      var q = Math.floor(a / b);
      for (var k = 0; k < a; k++) push(220, (function () { var e = emojiNode(_curEmo, "", "ALL"); return function () { if ($("row")) $("row").appendChild(e); _pop(); }; })());
      _brace = { grp: "ALL", label: "平均分成 " + b + " 份", from: 0, to: -1 };
      push(500, function () { top("把 " + a + " 平均分成 " + b + " 份"); _say(ZH.divStep(a, b, q)); });
      push(900, function () { braceShow(); if ($("qlabel")) { $("qlabel").textContent = "每份几个？"; $("qlabel").className = "q pulse"; } });
      push(600, function () {
        var items = $("row") ? $("row").children : [];
        for (var i3 = 0; i3 < items.length; i3++) {
          var cl = items[i3].className || ""; if (cl.indexOf("e") < 0) continue;
          if (Math.floor(i3 / q) % 2 === 0) items[i3].classList.add("gold"); else items[i3].classList.add("blue");
        }
        _chime();
      });
      push(1600, function () { reveal(q, "每份 " + q + " 个", ZH.s8(a, b, q, ZH.div)); });
    } else {
      if (m === "sub") {
        for (var s1 = 0; s1 < a; s1++) push(420, (function () { var e = emojiNode(_curEmo, "L", "ALL"); return function () { if ($("row")) $("row").appendChild(e); _pop(); }; })());
        _brace = { grp: "ALL", label: "还剩 " + (a - b) + " 个", from: 0, to: a - b };
        push(520, function () { top(ZH.total(a)); _say(ZH.s2(a)); });
        push(950, function () { top(ZH.total(a) + " " + ZH.minus + " " + ZH.count(b)); });
        push(400, function () {
          var items = $("row") ? $("row").children : [], real = [];
          for (var i = 0; i < items.length; i++) { if ((items[i].className || "").indexOf("e") >= 0) real.push(items[i]); }
          var gone = real.slice(a - b);
          var gap = 320; gone.forEach(function (node, idx) { setTimeout(function () { node.classList.add("off"); _off(); }, idx * gap); });
        });
        push(Math.max(500, b * 360 + 250), function () { _say(ZH.s4(b)); });
      } else {
        for (var s2 = 0; s2 < a; s2++) push(420, (function () { var e = emojiNode(_curEmo, "L", "A"); return function () { if ($("row")) $("row").appendChild(e); _pop(); }; })());
        push(520, function () { top(ZH.count(a)); _say(ZH.s2(a)); });
        push(950, function () { top(ZH.count(a) + " " + ZH.plus + " "); });
        for (var s3 = 0; s3 < b; s3++) push(420, (function () { var e = emojiNode(_curEmo, "R", "B"); return function () { if ($("row")) $("row").appendChild(e); _pop(); }; })());
        _brace = { grp: "ALL", label: "？个", from: 0, to: -1 };
        push(520, function () { top(ZH.count(a) + " " + ZH.plus + " " + ZH.count(b)); _say(ZH.s3(b)); });
      }
      push(800, function () { braceShow(); if ($("qlabel")) { $("qlabel").textContent = ZH.q; $("qlabel").className = "q pulse"; } _say(ZH.s5()); });
      push(2100, function () { _say(ZH.s6()); });
      if (m === "carry" && a < 10 && a + b > 10) {
        var k = 10 - a, r = b - k;
        push(600, function () {
          var items = $("row") ? $("row").children : [], arr = [];
          for (var i = 0; i < items.length; i++) { if ((items[i].className || "").indexOf("e") >= 0) arr.push(items[i]); }
          arr.slice(a, a + k).forEach(function (n) { n.classList.add("gold"); });
          if (els && els.steps) els.steps.textContent = "🔸 " + ZH.stepMake() + a + "＋" + k + "＝10";
          _say(ZH.s9(a, b, k, r)); _chime();
        });
        push(3400, function () {
          var items = $("row") ? $("row").children : [], arr = [];
          for (var i = 0; i < items.length; i++) { if ((items[i].className || "").indexOf("e") >= 0) arr.push(items[i]); }
          arr.slice(a + k).forEach(function (n) { n.classList.add("blue"); });
          if (els && els.steps) els.steps.textContent = "🔹 " + ZH.stepRest() + r + "　" + ZH.stepFin() + "10＋" + r + "＝" + (10 + r);
          if ($("topLabel")) $("topLabel").textContent = ZH.total(10) + " " + ZH.plus + " " + ZH.count(r);
        });
        push(2800);
      } else if (m === "carry" && a === 10) {
        push(600, function () { if (els && els.steps) els.steps.textContent = "🔸 10＋" + b + "＝" + (10 + b); _say(ZH.s10(b)); _chime(); });
        push(2200);
      }
      push(500, function () {
        var items = $("row") ? $("row").children : [], all = [];
        for (var i = 0; i < items.length; i++) { if ((items[i].className || "").indexOf("e") >= 0 && !(m === "sub" && items[i].classList.contains("off"))) all.push(items[i]); }
        var n = 0, gap = 520;
        var cnt = setInterval(function () {
          if (n > 0 && all[n - 1]) all[n - 1].classList.remove("count");
          if (n >= all.length) { clearInterval(cnt); return; }
          var node = all[n]; if (node) node.classList.add("count");
          var cur = n + 1;
          if ($("topLabel")) $("topLabel").textContent = m === "sub" ? ZH.left(cur) : ZH.total(cur);
          if (curVoice && App.Speech) App.Speech.sfx.pop();
          n++;
        }, gap);
      });
      var res = m === "sub" ? a - b : a + b;
      push(Math.max(800, (m === "sub" ? a - b : a + b) * 560 + 700), function () {
        reveal(res, m === "sub" ? ZH.left(res) : ZH.total(res), m === "sub" ? ZH.s8(a, b, res, ZH.minus) : ZH.s7(a, b, res, ZH.plus));
      });
      push(1800, function () {});
    }
  }
})(window);
