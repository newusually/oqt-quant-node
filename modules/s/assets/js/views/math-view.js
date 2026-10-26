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
      '<div class="qno" id="qno">第 {{idx+1}} 题{{q.tag ? " · " + q.tag : ""}}</div>',
      '<div class="qtext" id="qtext" v-html="q.html"></div>',
      '<div class="scene" id="scene">',
      '<div class="row" v-for="(c, i) in scene.cells" :key="i">',
      '<span class="em" :class="{gone: c.gone, hi: c.hi}" :style="{animationDelay: c.d + \'ms\'}" v-html="svg(c.e)"></span>',
      '<span class="op" v-if="c.op">{{c.op}}</span>',
      '</div>',
      '<div class="scap" v-if="scene.cap">{{scene.cap}}</div>',
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
      stars: function () { return this.score >= (this.quiz.length * 10 * 0.9) ? "🌟🌟🌟" : this.score >= (this.quiz.length * 10 * 0.6) ? "🌟🌟" : "🌟"; }
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
        if (ok) {
          this.score += 10; U.confetti(); Speech.speak(U.pick(PRAISE));
          this.vd = "✔ 答对啦！+10 分"; this.vdCls = "verdict good"; Banks.record(this.q.kp, true);
          App.Store.addStars(1); App.Store.markLearned("math:" + this.q.kp);
          if (App.Store.countLearned("math:") >= 10) App.Store.unlock("math10");
        } else {
          this.shaking = true; var self = this;
          setTimeout(function () { self.shaking = false; }, 500);
          Speech.speak(U.pick(CHEER));
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
