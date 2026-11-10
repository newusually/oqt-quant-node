/*
 * problems-view.js — 视图层 / 看图学应用
 * 题目数据来自服务层 Banks.draw("problems")；场景用响应式数据描述，模板只负责渲染。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U, IMG = App.IMG, Speech = App.Speech, Banks = App.Banks;
  var PRAISE = ["答对啦，真棒！", "太厉害了！", "你真是数学小天才！", "完全正确！", "好聪明呀！"];
  var CHEER = ["没关系，再想一想哦。", "差一点点，加油！", "再仔细看看图哦。"];

  function cell(e, i, d) { return { e: e, i: i, d: d, gone: false, lit: false }; }
  function segC(cells, d) { return { t: "c", cells: cells, d: d || 0 }; }
  function segO(t, d) { return { t: "o", t2: t, d: d || 0 }; }

  App.views = App.views || {};
  App.views.problems = {
    template: [
      '<site-shell title="看图学应用" sub="看清图意，选出正确的算式" icon="🍎">',
      '<div class="lvbar">',
      '<span class="lv" v-for="l in [1,2,3]" :key="l" :class="{on: lv === l}" @click="restart(l)">难度 {{l}}</span>',
      '</div>',
      '<div class="scorebar"><span class="score">⭐ 得分 {{score}}</span>',
      '<div class="card" id="card" :class="{shake: shaking}">',
      '<div class="qno" id="qno">第 {{idx+1}} 题</div>',
      '<div class="qtext" id="qtext" v-html="hl(q.text)"></div>',
      '<div class="scene" id="scene">',
      '<div class="row" v-for="(r, ri) in scene.rows" :key="ri">',
      '<span class="rlabel" v-if="r.label">{{r.label}}</span>',
      '<template v-for="(s, si) in r.segs" :key="si">',
      '<span class="op" v-if="s.t === \'o\'" :style="{animationDelay: s.d + \'ms\'}">{{s.t2}}</span>',
      '<span class="em idle" v-else v-for="c in s.cells" :key="c.i" :class="{gone: c.gone, lit: c.lit}" :style="{animationDelay: c.d + \'ms, \' + (c.d + 500) + \'ms\'}" v-html="svg(c.e)"></span>',
      '</template>',
      '</div>',
      '<brace-box v-if="scene.brace" :label="scene.cap" span-sel=".row"></brace-box>',
      '<div class="cap" v-if="!scene.brace" :class="{q: scene.isQ}">{{scene.cap}}</div>',
      '</div>',
      '<div class="answer">',
      '<input ref="inp" type="text" inputmode="numeric" placeholder="？" autocomplete="off" v-model="answer" @keydown.enter="answered ? next() : check()">',
      '<button class="btn bigbtn" @click="check">✔ 检查</button>',
      '<button class="btn bigbtn next" v-if="answered" @click="next">{{idx === quiz.length-1 ? "看成绩 🏁" : "下一题 ▶"}}</button>',
      '</div>',
      '<div class="eqshow" :class="{show: !!eq}">{{eq}}</div>',
      '<div class="verdict" :class="vdCls">{{vd}}</div>',
      '<div class="teach" v-if="teach">💡 {{teach}}</div>',
      '</div>',
      '<div v-if="done" class="card"><div class="done"><div class="medal">🏅</div>',
      '<h2>闯关完成！得分 {{score}} 分</h2><div class="stars">{{stars}}</div>',
      '<p>答对 {{score/10}} / {{quiz.length}} 题 · 换个难度再来挑战吧！</p>',
      '<button class="btn bigbtn" @click="restart(lv)">🔄 再来一轮</button> ',
      '<a class="btn bigbtn next" href="巩固练习.html">🎯 薄弱点巩固</a> ',
      '<a class="btn bigbtn next" href="口算动画课堂.html">🏠 返回动画课堂</a></div></div>',
      '</site-shell>'
    ].join(""),
    data: function () {
      return {
        lv: 1, quiz: [], idx: 0, score: 0, answered: false, done: false,
        q: {}, scene: { rows: [], ops: [], cap: "", brace: false, isQ: false },
        answer: "", eq: "", vd: "", vdCls: "", teach: "", shaking: false
      };
    },
    computed: {
      stars: function () { return this.score >= 90 ? "🌟🌟🌟" : this.score >= 60 ? "🌟🌟" : "🌟"; }
    },
    mounted: function () {
      var self = this;
      Banks.loadExternal().then(function () { self.restart(1); });
      setTimeout(function () { if (!self.quiz.length) self.restart(1); }, 1500);
    },
    methods: {
      svg: function (id) { return IMG.svg(id) || "⭐"; },
      hl: function (t) { return U.hlNums(t || ""); },
      restart: function (lv) {
        this.lv = lv || this.lv; this.score = 0; this.idx = 0; this.done = false;
        this.quiz = Banks.draw("problems", App.config.counts.problems || 15);
        this.loadQ();
      },
      mkRow: function (label, segs) { return { label: label, segs: segs }; },
      buildScene: function (q) {
        var rows = [], cap = "", brace = false, isQ = false, d, i;
        if (q.kind === "add") {
          d = 120; var s1 = [];
          for (i = 0; i < q.a; i++) { s1.push(cell(q.e, i, d)); d += 130; }
          var s2 = []; d = 240 + q.a * 130;
          for (i = 0; i < q.b; i++) { s2.push(cell(q.e, q.a + i, d)); d += 130; }
          rows.push(this.mkRow("", [segC(s1), segO("＋", 120 + q.a * 130), segC(s2)]));
          cap = "？" + q.u; brace = true; isQ = true;
        } else if (q.kind === "add2") {
          d = 100; var g1 = [], g2 = [], g3 = [];
          for (i = 0; i < q.a; i++) { g1.push(cell(q.e, i, d)); d += 130; }
          var o1 = d; d += 120;
          for (i = 0; i < q.b; i++) { g2.push(cell(q.e, 100 + i, d)); d += 130; }
          var o2 = d; d += 120;
          for (i = 0; i < q.c; i++) { g3.push(cell(q.e, 200 + i, d)); d += 130; }
          rows.push(this.mkRow("", [segC(g1), segO("＋", o1), segC(g2), segO("＋", o2), segC(g3)]));
          cap = "？" + q.u; brace = true; isQ = true;
        } else if (q.kind === "sub" || q.kind === "sub2") {
          d = 80; var s3 = [];
          for (i = 0; i < q.a; i++) { s3.push(cell(q.e, i, d)); d += 90; }
          rows.push(this.mkRow("", [segC(s3)]));
          cap = q.a + " " + q.u; brace = true;
        } else if (q.kind === "diff") {
          var rA = [], rB = [];
          for (i = 0; i < q.a; i++) rA.push(cell(q.e, i, 100 + i * 90));
          for (i = 0; i < q.b; i++) rB.push(cell(q.e, 100 + i, 100 + i * 90));
          rows.push(this.mkRow("👦 ", [segC(rA)]));
          rows.push(this.mkRow("👧 ", [segC(rB)]));
        } else if (q.kind === "ord") {
          var ro = [];
          q.row.forEach(function (f, i2) { ro.push(cell(f, i2, 120 + i2 * 150)); });
          rows.push(this.mkRow("", [segC(ro)]));
        }
        return { rows: rows, cap: cap, brace: brace, isQ: isQ };
      },
      allCells: function () {
        var out = [], r, s;
        for (r = 0; r < this.scene.rows.length; r++) {
          for (s = 0; s < this.scene.rows[r].segs.length; s++) {
            if (this.scene.rows[r].segs[s].t === "c") out = out.concat(this.scene.rows[r].segs[s].cells);
          }
        }
        return out;
      },
      loadQ: function () {
        var q = this.quiz[this.idx];
        this.answered = false; this.q = q; this.answer = ""; this.eq = ""; this.vd = ""; this.vdCls = ""; this.teach = "";
        this.scene = this.buildScene(q);
        var self = this;
        this.$nextTick(function () {
          if (q.kind !== "ord" && self.$refs.inp) self.$refs.inp.focus();
        });
        App.ReadQ.read(q);
      },
      goGone: function (from, n) {
        var cells = this.allCells(), t = 400, self = this;
        for (var i = from; i < from + n; i++) {
          (function (i) {
            setTimeout(function () { if (cells[i]) cells[i].gone = true; }, t);
          })(i);
          t += 260;
        }
      },
      check: function () {
        if (this.answered) return;
        var q = this.q, v = String(this.answer).trim();
        if (v === "") { if (this.$refs.inp) this.$refs.inp.focus(); return; }
        this.answered = true;
        if (q.kind === "ord") { this.finishOrd(v === q.textAns || v === String(q.k)); return; }
        var ok = parseInt(v, 10) === q.ans;
        if (q.kind === "sub" || q.kind === "sub2") {
          var from = q.kind === "sub" ? (q.a - q.b) : (q.a - q.b);
          this.goGone(from, q.b);
          if (q.kind === "sub2") this.goGone(q.a - q.b + q.b, q.c);
        }
        this.eq = q.eq;
        if (ok) {
          this.score += 10; U.confetti(); Speech.speak(U.pick(PRAISE));
          this.vd = "✔ 答对啦！+10 分"; this.vdCls = "verdict good"; Banks.record(q.kp, true);
          App.Store.addStars(1); App.Store.markLearned("math:" + q.kp);
          if (App.Store.countLearned("math:") >= 10) App.Store.unlock("math10");
        } else {
          this.shaking = true; var self = this;
          setTimeout(function () { self.shaking = false; }, 500);
          Speech.speak(U.pick(CHEER));
          this.vd = "✘ 正确答案：" + U.ansText(q); this.vdCls = "verdict bad";
          if (q.teach) this.teach = q.teach;
          Banks.record(q.kp, false);
        }
      },
      finishOrd: function (ok) {
        this.eq = ok ? this.q.textAns : "正确答案：" + this.q.textAns;
        if (ok) {
          this.score += 10; U.confetti(); Speech.speak(U.pick(PRAISE));
          this.vd = "✔ 答对啦！+10 分"; this.vdCls = "verdict good"; Banks.record(this.q.kp, true);
          App.Store.addStars(1);
        } else {
          this.shaking = true; var self = this;
          setTimeout(function () { self.shaking = false; }, 500);
          Speech.speak(this.q.textAns);
          this.vd = "✘ 再看看哦"; this.vdCls = "verdict bad"; Banks.record(this.q.kp, false);
        }
      },
      next: function () {
        this.idx++;
        if (this.idx >= this.quiz.length) {
          this.done = true; U.confetti(40);
          Speech.speak("闯关完成！你得了" + this.score + "分，真棒！");
          return;
        }
        this.loadQ();
      }
    }
  };
})(window);
