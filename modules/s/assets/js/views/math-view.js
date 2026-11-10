/*
 * math-view.js — 视图层 / 数学测试卷
 * 题型：数字填空(n) / 比大小(cmp)；场景：加减图示 / 排队(line)。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U, IMG = App.IMG, Speech = App.Speech, Banks = App.Banks;
  var PRAISE = ["答对啦，真棒！", "太厉害了！", "完全正确！", "你真是数学小能手！"];
  var CHEER = ["没关系，再想一想哦。", "差一点点，加油！"];

  App.views = App.views || {};
  App.views.math = {
    template: [
      '<site-shell title="数学测试卷" sub="认真读题，看图列式" icon="📝">',
      '<div class="scorebar"><span class="score">⭐ 得分 {{score}}</span>',
      '<div class="card" id="card" :class="{shake: shaking}">',
      '<div class="qbar">',
      '<span class="qno" id="qno">第 {{idx+1}} 题 / 共 {{quiz.length}} 题{{q.tag ? " · " + q.tag : ""}}</span>',
      // ★2026-10-28 用户反馈「考试的时候不能返回上一题，没有这个按钮」
      //   → 任何时候都能翻（不要求先作答），顶部常驻 上一题/下一题
      '<span class="qnav">',
      '<button class="btn qbtn" @click="prev" :disabled="idx <= 0">◀ 上一题</button>',
      '<button class="btn qbtn" @click="next" :disabled="idx >= quiz.length-1">下一题 ▶</button>',
      '</span>',
      '</div>',
      '<div class="qtext" id="qtext" v-html="q.html"></div>',
      '<div class="scene" id="scene">',
      // ★有 MathViz 教学图时不重复画简单排列图 —— 旧版两套图叠着显示, 用户反馈「多画好几个」
      '<template v-if="!mvizHtml">',
      '<div class="row" v-for="(c, i) in scene.cells" :key="i">',
      '<span class="em" :class="{gone: c.gone, hi: c.hi}" :style="{animationDelay: c.d + \'ms\'}" v-html="svg(c.e)"></span>',
      '<span class="op" v-if="c.op">{{c.op}}</span>',
      '</div>',
      '</template>',
      '<div class="scap" v-if="scene.cap">{{scene.cap}}</div>',
      '<div class="mviz-slot" v-html="mvizHtml"></div>',
      '</div>',
      '<div class="answer" v-if="q.type === \'n\'">',
      '<input ref="inp" type="number" inputmode="numeric" placeholder="？" autocomplete="off" v-model="answer" @keydown.enter="check()">',
      '<button class="btn bigbtn" @click="check">✔ 检查</button>',
      '</div>',
      '<div class="answer" v-else>',
      '<div class="cmpbtns">',
      '<button v-for="v in cmps" :key="v" :data-v="v" @click="doCmp(v)">{{v}}</button>',
      '</div>',
      '</div>',
      '<div class="eqshow" :class="{show: !!eq}">{{eq}}</div>',
      '<div class="verdict" :class="vdCls">{{vd}}</div>',
      '<div class="teach" v-if="teach">💡 {{teach}}</div>',
      '<div class="ctr" v-if="answered"><button class="btn bigbtn next" @click="next">{{idx === quiz.length-1 ? "看成绩 🏁" : "下一题 ▶"}}</button></div>',
      '</div>',
      '<div v-if="done" class="card"><div class="done"><div class="medal">🏆</div>',
      '<h2>测试完成！得分 {{score}} 分</h2><div class="stars">{{stars}}</div>',
      '<p>共 {{quiz.length}} 题，答对 {{score/10}} 题 · 再来一轮换个新卷子！</p>',
      '<button class="btn bigbtn" @click="restart">🔄 再测一次</button> ',
      '<a class="btn bigbtn next" href="巩固练习.html">🎯 薄弱点巩固</a> ',
      '<a class="btn bigbtn next" href="口算动画课堂.html">🏠 返回动画课堂</a></div></div>',
      /* ★2026-10-28 题·导航条样式(上一题/下一题常驻) */
      '<style>',
      '.qbar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin:2px 0 8px;}',
      '.qbar .qno{margin:0;font-size:14px;font-weight:700;color:#6d4c41;}',
      '.qnav{display:flex;gap:7px;flex:0 0 auto;}',
      '.qbtn{padding:7px 14px;font-size:13px;font-weight:700;border-radius:999px;cursor:pointer;',
      'white-space:nowrap;touch-action:manipulation;-webkit-tap-highlight-color:transparent;}',
      '.qbtn:disabled{opacity:.42;cursor:not-allowed;}',
      '@media (max-width:520px){.qbar{flex-direction:column;align-items:flex-start;}.qnav{width:100%;}.qbtn{flex:1;}}',
      '</style>',
      '</site-shell>'
    ].join(""),
    data: function () {
      return {
        cmps: [">", "<", "="],
        quiz: [], idx: 0, score: 0, answered: false, done: false,
        q: {}, scene: { cells: [], cap: "" }, answer: "", eq: "", vd: "", vdCls: "", teach: "", shaking: false
      };
    },
    computed: {
      stars: function () { return this.score >= (this.quiz.length * 10 * 0.9) ? "🌟🌟🌟" : this.score >= (this.quiz.length * 10 * 0.6) ? "🌟🌟" : "🌟"; },
      /* ★MathViz 图形化(computed, v-html 正确解引用; 曾放 methods 导致渲染函数源码)
       *   ★2026-10-28: 传 icon —— 用题干同一个图形 id(兔子就画兔子、苹果就画苹果),
       *     旧版不传 icon 导致教学图永远画苹果, 而题干是别的东西 → 用户反馈「颜色/图形和题目不对应」 */
      mvizHtml: function () {
        try {
          var sc = this.q && this.q.scene && this.q.scene[0];
          if (!sc || !App.MathViz) return "";
          var kind = sc[0], ent = sc[1], a = sc[2], b = sc[3];
          if (kind !== "add" && kind !== "sub") return "";
          if (typeof a !== "number" || typeof b !== "number") return "";
          if (a > 24 || b > 24) return "";
          return App.MathViz.svg({ op: kind, a: a, b: b, icon: ent || "apple" });
        } catch (e) { return ""; }
      }
    },
    mounted: function () {
      var self = this;
      Banks.loadExternal().then(function () { self.restart(); });
      setTimeout(function () { if (!self.quiz.length) self.restart(); }, 1500);
    },
    methods: {
      svg: function (id) { return IMG.svg(id) || "⭐"; },
      restart: function () {
        this.score = 0; this.idx = 0; this.done = false;
        this.quiz = Banks.draw("math", App.config.counts.math || 18);
        this.loadQ();
      },
      buildScene: function (q) {
        var cells = [], cap = "";
        if (!q.scene) return { cells: cells, cap: cap };
        var kind = q.scene[0][0], e = q.scene[0][1], a = q.scene[0][2], b = q.scene[0][3], i;
        if (kind === "add") {
          for (i = 0; i < a; i++) cells.push({ e: e, d: i * 120, gone: false, hi: false, op: "" });
          cells.push({ e: "", d: a * 120, gone: false, hi: false, op: "＋" });
          for (i = 0; i < b; i++) cells.push({ e: e, d: (a + i) * 120, gone: false, hi: false, op: "" });
        } else if (kind === "sub") {
          for (i = 0; i < a; i++) cells.push({ e: e, d: i * 110, gone: i >= a - b, hi: false, op: "" });
        } else if (kind === "line") {
          var n = a + b - 1;
          for (i = 1; i <= n; i++) cells.push({ e: (i === a ? "rabbit" : "chick"), d: i * 120, gone: false, hi: (i === a), op: "" });
          cap = "👆 红圈里是小明";
        }
        return { cells: cells, cap: cap };
      },
      loadQ: function () {
        var q = this.quiz[this.idx];
        this.answered = false; this.q = q; this.answer = ""; this.eq = ""; this.vd = ""; this.vdCls = ""; this.teach = "";
        this.scene = this.buildScene(q);
        var self = this;
        this.$nextTick(function () { if (q.type === "n" && self.$refs.inp) self.$refs.inp.focus(); });
        App.ReadQ.read(q);
      },
      finish: function (ok, extra) {
        this.answered = true; this.eq = this.q.eq;
        /* ★2026-10-28 用户反馈「解题思路也不读」:
         *   旧版只在答错时念一句安慰话, teach(解题思路)只显示在屏幕上从没念出来。
         *   现在答对答错都把【正确答案 + 解题思路】完整念一遍, 讲题才完整。 */
        var teach = this.q.teach || "";
        var why = this.q.why || "";
        var steps = [teach, why].filter(Boolean).join("。");
        if (ok) {
          this.score += 10; U.confetti();
          Speech.speak(U.pick(PRAISE) + "。" + (steps ? "解题思路：" + steps : ""));
          this.vd = "✔ 答对啦！+10 分"; this.vdCls = "verdict good"; Banks.record(this.q.kp, true);
          App.Store.addStars(1); App.Store.markLearned("math:" + this.q.kp);
          if (App.Store.countLearned("math:") >= 10) App.Store.unlock("math10");
        } else {
          this.shaking = true; var self = this;
          setTimeout(function () { self.shaking = false; }, 500);
          /* 答错：安慰 + 正确答案 + 完整解题思路 */
          Speech.speak(U.pick(CHEER) + "正确答案是 " + extra + "。" + (steps ? "解题思路：" + steps : ""));
          this.vd = "✘ 正确答案：" + extra; this.vdCls = "verdict bad";
          if (this.q.teach) this.teach = this.q.teach;
          Banks.record(this.q.kp, false);
        }
      },
      check: function () {
        if (this.answered) return;
        var v = String(this.answer).trim(); if (v === "") return;
        this.finish(parseInt(v, 10) === this.q.ans, this.q.ans);
      },
      doCmp: function (v) {
        if (this.answered) return;
        this.finish(v === this.q.cmp, this.q.cmp);
      },
      /* ★2026-10-28 上一题(旧版只有 next, 数学测试卷不能回头看题) */
      prev: function () {
        if (this.idx <= 0) return;
        this.idx--; this.loadQ();
      },
      next: function () {
        this.idx++;
        if (this.idx >= this.quiz.length) {
          this.done = true; U.confetti(40);
          Speech.speak("测试完成！你得了" + this.score + "分，真棒！");
          return;
        }
        this.loadQ();
      }
    }
  };
})(window);
