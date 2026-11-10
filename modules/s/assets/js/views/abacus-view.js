/*
 * abacus-view.js — 视图层 / 口算动画课堂
 * 只负责"控件 + 舞台"的响应式渲染；动画与播报交给服务层 App.Abacus。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var PICKER = ["cat", "dog", "rabbit", "bird", "fish", "flower", "apple", "star", "tree", "butterfly", "duck", "pig", "bear", "frog", "monkey", "grape", "leaf", "sun", "heart", "balloon", "kid", "boy", "girl", "teacher"];
  var MODES = [
    { k: "add", t: "加法" }, { k: "sub", t: "减法" }, { k: "carry", t: "凑十法" },
    { k: "mul", t: "乘法" }, { k: "div", t: "除法" }, { k: "mixed", t: "混合" }
  ];
  var LABELS = { add: "加法", sub: "减法", carry: "凑十法", mul: "乘法", div: "除法", mixed: "混合" };
  var SPEEDS = [{ v: "1.6", t: "慢" }, { v: "1", t: "正常" }, { v: "0.6", t: "快" }];

  App.views = App.views || {};
  App.views.abacus = {
    template: [
      '<site-shell title="口算动画课堂" sub="选一选，点“开始”，看小动物帮你算！" icon="🧮">',
      '<div class="card ab-stage">',
      '<div class="ab-controls">',
      '<div class="ab-group">',
      '<span class="lab">选择运算</span>',
      '<div class="modebar">',
      '<button class="mbtn" v-for="m in modes" :key="m.k" :class="{on: S.mode === m.k}" @click="setMode(m.k)">{{m.t}}</button>',
      '</div></div>',
      '<div class="ab-group">',
      '<span class="lab">数字（数1 / 数2）</span>',
      '<div class="numctrl"><button @click="bump(\'a\',-1,false)">－</button><span class="val">{{S.a}}</span><button @click="bump(\'a\',1,false)">＋</button></div>',
      '<div class="numctrl"><button @click="bump(\'b\',-1,true)">－</button><span class="val">{{S.b}}</span><button @click="bump(\'b\',1,true)">＋</button></div>',
      '</div>',
      '<div class="ab-group">',
      '<span class="lab">图形</span>',
      '<div class="emo-row" id="emo"></div>',
      '</div>',
      '<div class="ab-group">',
      '<span class="lab">播放</span>',
      '<div class="playbar">',
      '<button class="btn bigbtn" id="btn-play" @click="play"><span id="t-play">开始</span></button>',
      '<button class="btn" @click="replay">🔄 重播</button>',
      '<button class="btn spk" :class="{on: S.voice}" @click="S.voice = !S.voice">{{S.voice ? "🔊 语音" : "🔇 静音"}}</button>',
      '<button class="btn spk" :class="{on: S.sfx}" @click="S.sfx = !S.sfx">{{S.sfx ? "🎵 音效" : "🎵 已关"}}</button>',
      '<button class="btn spk" @click="animalSay">🐾 动物叫</button>',
      '<select class="speedsel" :value="String(S.speed)" @change="S.speed = parseFloat($event.target.value)">',
      '<option v-for="sp in speeds" :key="sp.v" :value="sp.v">{{sp.t}}</option>',
      '</select>',
      '</div></div>',
      '<div class="hint">选“{{label}}”：数 1 最大到 {{maxA}}（乘除法自动适配），点“开始”看动画！</div>',
      '</div>',
      '<div v-once>',
      '<div id="say"></div><div id="steps"></div><div id="topLabel"></div><div id="row"></div>',
      '<div id="braceBox" class="yb-brace"></div>',
      '<div id="qlabel" class="q"></div>',
      '<div class="eqbar">',
      '<span class="e-a" id="e-a">3</span><span class="e-op" id="e-op">＋</span><span class="e-b" id="e-b">2</span><span>=</span><span class="e-ans" id="e-ans">?</span>',
      '</div>',
      '</div>',
      '</div>',
      '<div class="card gd-panel">',
      '<div class="gd-head">🧮 画图小工具<span class="gd-sub">开源画图库（SVG.js + Rough.js + anime.js）驱动，点一个看它画出来</span></div>',
      '<div class="gd-tools">',
      '<button class="gd-btn" v-for="t in tools" :key="t.k" :class="{on: tool === t.k}" @click="doTool(t.k)">{{t.t}}</button>',
      '</div>',
      '<div class="gd-stage" id="gd-stage"></div>',
      '<div class="gd-tip">💡 {{toolTip}}</div>',
      '</div>',
      '<div class="hint">加法·减法·凑十法·乘法·除法·混合，全部用可爱动画演示</div>',
      '</site-shell>'
    ].join(""),
    data: function () {
      return {
        modes: MODES, speeds: SPEEDS,
        S: { mode: "add", a: 3, b: 2, emoIdx: 0, emo: PICKER[0], voice: true, sfx: true, speed: 1, pickerIds: PICKER },
        tools: [
          { k: "seg", t: "📏 线段" }, { k: "angle", t: "📐 角" }, { k: "triangle", t: "🔺 三角形" },
          { k: "square", t: "🟦 正方形" }, { k: "rect", t: "▭ 长方形" }, { k: "circle", t: "⭕ 圆" }
        ],
        tool: "seg",
        toolTip: "尺子上的每一小格是 1 厘米，线段有两个端点。"
      };
    },
    computed: {
      label: function () { return LABELS[this.S.mode] || ""; },
      maxA: function () { return this.S.mode === "sub" ? 20 : 10; }
    },
    mounted: function () {
      var self = this, Abacus = App.Abacus;
      Abacus.setEmoByIndex(this.S);
      this.els = { playBtn: document.getElementById("btn-play"), tPlay: document.getElementById("t-play"), steps: document.getElementById("steps"), say: document.getElementById("say") };
      this.renderPicker();
      this.clamp();
      this.doTool("seg");
      if (App.Speech) App.Speech.speak("口算动画课堂，选一个运算，点开始！");
    },
    methods: {
      doTool: function (k) {
        this.tool = k;
        var G = App.Guide, box = document.getElementById("gd-stage");
        if (!G || !box) return;
        var TIPS = {
          seg: "尺子上的每一小格是 1 厘米，线段有两个端点，不能向两边伸长。",
          angle: "从一点引出两条射线就组成角，开口大的角大，开口小的角小。",
          triangle: "三角形有 3 条边、3 个角和 3 个顶点，像小山的形状。",
          square: "正方形 4 条边一样长，4 个角都是直角，方方正正。",
          rect: "长方形对边相等，也有 4 个直角，课本封面就是长方形。",
          circle: "圆没有角，中心到边上每一处都一样远，像太阳和硬币。"
        };
        this.toolTip = TIPS[k] || "";
        var NAMES = { triangle: "三角形", square: "正方形", rect: "长方形", circle: "圆", angle: "角" };
        if (k === "seg") G.segment(box, { label: "这是一条线段 AB" });
        else G.shape(box, k, { name: NAMES[k] || "" });
        if (App.Speech) App.Speech.speak(this.toolTip);
      },
      renderPicker: function () {
        var box = document.getElementById("emo");
        if (box && App.Abacus) App.Abacus.renderPicker(box, this.S, this.renderPicker);
      },
      animalSay: function () {
        var ok = App.Animals && App.Animals.say(this.S.emo);
        if (!ok && App.Speech) App.Speech.speak("这个没有叫声，换个小动物试试吧");
      },
      opSym: function () {
        return this.S.mode === "sub" ? "－" : this.S.mode === "mul" ? "×" : this.S.mode === "div" ? "÷" : "＋";
      },
      resetStage: function () {
        var $ = function (i) { return document.getElementById(i); };
        if ($("row")) $("row").innerHTML = "";
        if ($("topLabel")) $("topLabel").textContent = "";
        if ($("qlabel")) $("qlabel").textContent = "";
        if ($("steps")) $("steps").textContent = "";
        var bboxEl = $("braceBox");
        if (bboxEl) { if (App.Brace) App.Brace.clear(bboxEl); else bboxEl.innerHTML = ""; }
        if ($("e-a")) $("e-a").textContent = this.S.a;
        if ($("e-b")) $("e-b").textContent = this.S.b;
        if ($("e-op")) $("e-op").textContent = this.opSym();
        var ans = $("e-ans"); if (ans) { ans.textContent = "?"; ans.classList.remove("reveal"); }
      },
      clamp: function () {
        var S = this.S;
        if (S.mode === "sub") { if (S.a > 20) S.a = 20; if (S.b >= S.a) S.b = Math.max(1, S.a - 1); }
        else if (S.mode === "carry") { if (S.a < 10 && S.a + S.b <= 10) S.b = Math.min(10, 11 - S.a); if (S.a > 10) S.a = 10; }
        else if (S.mode === "mul" || S.mode === "div") { S.a = Math.min(6, S.a); S.b = Math.min(6, S.b); }
        else { if (S.a > 10) S.a = 10; if (S.a + S.b > 20) S.b = 20 - S.a; }
        this.resetStage();
      },
      setMode: function (m) {
        this.S.mode = m;
        App.Abacus.stop(this.els);
        this.clamp();
      },
      bump: function (key, d, isB) {
        var S = this.S;
        if (key === "a") S.a = Math.min(this.maxA, S.a + d); else S.b = Math.min(S.mode === "mul" || S.mode === "div" ? 6 : 10, S.b + d);
        if (isB && S.mode === "sub" && S.b >= S.a) S.b = Math.max(1, S.a - 1);
        if (!isB && S.mode === "sub" && S.a <= S.b) S.a = S.b + 1;
        if (S.mode !== "sub" && S.a + S.b > 20) { if (isB) S.b = 20 - S.a; else S.a = 20 - S.b; }
        if (S.mode === "carry" && S.a < 10 && S.a + S.b <= 10 && isB) S.b = Math.min(10, 11 - S.a);
        if (S.a < 1) S.a = 1; if (S.b < 1) S.b = 1;
        this.clamp();
      },
      play: function () {
        if (!App.Abacus) return;
        App.Abacus.stop(this.els);
        App.Abacus.run(this.els, this.S);
      },
      replay: function () {
        App.Abacus.stop(this.els);
        var self = this;
        setTimeout(function () { self.play(); }, 120);
      }
    },
    watch: {
      "S.voice": function (v) { if (!v) { try { w.speechSynthesis.cancel(); } catch (e) {} } },
      "S.emo": function (v) { if (App.Animals) App.Animals.say(v); }
    }
  };
})(window);
