/*
 * review-view.js — 视图层 / 薄弱点巩固练习
 * 读取 App.Banks.weakList() 里的薄弱知识点，针对性抽题（数学/语文/应用题三库融合）练习。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U, IMG = App.IMG, Speech = App.Speech, Banks = App.Banks;
  var PRAISE = ["答对啦，真棒！", "太厉害了！", "完全正确！", "你真是学习小能手！"];
  var CHEER = ["没关系，再想一想哦。", "差一点点，加油！", "再仔细看看哦。"];

  function cell(e, i, d) { return { e: e, i: i, d: d, gone: false }; }
  function segC(cells) { return { t: "c", cells: cells }; }
  function segO(t, d) { return { t: "o", t2: t, d: d }; }

  App.views = App.views || {};
  App.views.review = {
    template: [
      '<site-shell title="薄弱点巩固" sub="哪里不会练哪里，越练越扎实" icon="🎯">',
      '<div v-if="!started">',
      '<div class="card">',
      '<div class="weakTitle">📌 需要巩固的知识点（点击可单独练习）：</div>',
      '<div class="weakChips" v-if="weakList.length">',
      '<span class="wchip" v-for="(wk, i) in weakList" :key="i" @click="startWith([wk.kp])">{{wk.kp}} <b>×{{wk.n}}</b></span>',
      '</div>',
      '<div class="weakEmpty" v-else>🌈 太棒了，现在还没有薄弱点！来做一套综合练习吧～</div>',
      '<div class="ctr">',
      '<button class="btn bigbtn" @click="startWith(null)">🚀 开始综合练习</button>',
      '<button class="btn" @click="clearWeak">🧹 清空薄弱点</button></div>',
      '</div>',
      '</div>',
      '<div v-else>',
      '<div class="scorebar"><span class="score">⭐ 得分 {{score}}</span>',
      '<div class="card" id="card" :class="{shake: shaking}">',
      '<div class="qno">第 {{idx+1}} 题{{q.tag ? " · " + q.tag : (q.kp ? " · " + q.kp : "")}}</div>',
      '<div class="passage" v-if="q.passage" v-html="q.passage"></div>',
      '<div class="qtext" v-html="qText"></div>',
      '<div class="scene" id="scene" v-if="scene.rows.length">',
      '<div class="row" v-for="(r, ri) in scene.rows" :key="ri">',
      '<span class="rlabel" v-if="r.label">{{r.label}}</span>',
      '<template v-for="(s, si) in r.segs" :key="si">',
      '<span class="op" v-if="s.t === \'o\'">{{s.t2}}</span>',
      '<span class="em idle" v-else v-for="c in s.cells" :key="c.i" :class="{gone: c.gone}" :style="{animationDelay: c.d + \'ms, \' + (c.d + 500) + \'ms\'}" v-html="svg(c.e)"></span>',
      '</template>',
      '</div>',
      '<brace-box v-if="scene.brace" :label="scene.cap" span-sel=".row"></brace-box>',
      '<div class="cap" v-if="!scene.brace" :class="{q: scene.isQ}">{{scene.cap}}</div>',
      '</div>',
      '<div class="match" v-else-if="q.type === \'match\'">',
      '<div class="col"><div class="mi" v-for="(wd, i) in q.left" :key="\'L\'+i" :class="miCls(i, \'L\')" @click="pick(\'L\', i)">{{wd}}</div></div>',
      '<div class="col"><div class="mi" v-for="(wd, i) in q.right" :key="\'R\'+i" :class="miCls(i, \'R\')" @click="pick(\'R\', i)">{{wd}}</div></div>',
      '</div>',
      '<div class="hint" v-if="q.type === \'match\'">👆 先点左边的字，再点右边它的反义词</div>',
      '<div class="answer" v-if="needInput">',
      '<input ref="inp" :type="isOrd ? \'text\' : \'number\'" inputmode="numeric" placeholder="？" autocomplete="off" v-model="answer" @keydown.enter="check()">',
      '<button class="btn bigbtn" @click="check">✔ 检查</button></div>',
      '<div class="answer" v-else-if="q.type === \'cmp\'">',
      '<div class="cmpbtns"><button v-for="v in cmps" :key="v" @click="doCmp(v)">{{v}}</button></div></div>',
      '<div class="opts" v-else-if="q.opts">',
      '<div class="opt" v-for="(o, i) in q.opts" :key="i" :class="optCls(i)" @click="doOpt(i)">{{o}}</div></div>',
      '<div class="ctr" v-else-if="q.type === \'speak\'">',
      '<button class="btn bigbtn" @click="sayDone">🎤 说好啦</button></div>',
      '<div class="eqshow" :class="{show: !!eq}">{{eq}}</div>',
      '<div class="verdict" :class="vdCls">{{vd}}</div>',
      '<div class="teach" v-if="teach">💡 {{teach}}</div>',
      '<div class="ctr" v-if="answered">',
      '<button class="btn bigbtn next" @click="next">{{idx === quiz.length-1 ? "看成绩 🏁" : "下一题 ▶"}}</button></div>',
      '</div>',
      '</div>',
      '<div v-if="done" class="card"><div class="done"><div class="medal">🏅</div>',
      '<h2>巩固完成！得分 {{score}} 分</h2><div class="stars">{{stars}}</div>',
      '<p>共 {{quiz.length}} 题，答对 {{score/10}} 题 · 薄弱点一点点变少啦！</p>',
      '<button class="btn bigbtn" @click="restart">🔄 再练一次</button> ',
      '<a class="btn bigbtn next" href="主页.html">🏠 返回主页</a></div></div>',
      '</site-shell>'
    ].join(""),
    data: function () {
      return {
        cmps: [">", "<", "="],
        started: false, done: false,
        weakList: [], quiz: [], idx: 0, score: 0, answered: false,
        q: {}, scene: { rows: [], cap: "", brace: false, isQ: false },
        answer: "", eq: "", vd: "", vdCls: "", teach: "", shaking: false,
        selL: -1, selR: -1, matched: 0, doneL: [], doneR: []
      };
    },
    computed: {
      stars: function () { return this.score >= (this.quiz.length * 10 * 0.9) ? "🌟🌟🌟" : this.score >= (this.quiz.length * 10 * 0.6) ? "🌟🌟" : "🌟"; },
      isProblem: function () { return !!this.q.kind; },
      isMath: function () { var q = this.q; return q.type === "n" || q.type === "cmp" || (!!q.scene && !q.opts); },
      isOrd: function () { return this.q.kind === "ord"; },
      needInput: function () {
        if (this.q.type === "match" || this.q.type === "speak" || this.q.type === "cmp") return false;
        if (this.q.opts) return false;
        return this.isProblem || this.isMath;
      },
      qText: function () {
        var q = this.q;
        return q.html ? q.html : U.hlNums(q.text || "");
      }
    },
    mounted: function () {
      this.renderWeak();
      Banks.loadExternal();
    },
    methods: {
      svg: function (id) { return IMG.svg(id) || "⭐"; },
      renderWeak: function () {
        this.weakList = Banks.weakList();
      },
      clearWeak: function () { Banks.clearWeak(); this.renderWeak(); Speech.speak("已清空薄弱点记录"); },
      restart: function () { this.started = false; this.done = false; this.score = 0; this.idx = 0; },
      startWith: function (kps) {
        var quiz = [];
        ["problems", "math", "chinese"].forEach(function (t) {
          quiz = quiz.concat(Banks.draw(t, 6, { kps: kps || [] }));
        });
        if (!quiz.length) {
          quiz = quiz.concat(Banks.draw("problems", 5)).concat(Banks.draw("math", 5)).concat(Banks.draw("chinese", 5));
        }
        this.quiz = U.shuffled(quiz).slice(0, Math.min(15, quiz.length));
        this.idx = 0; this.score = 0; this.started = true; this.done = false;
        this.loadQ();
      },
      buildScene: function (q) {
        var rows = [], cap = "", brace = false, isQ = false, d, i;
        if (!q.kind) return { rows: rows, cap: cap, brace: brace, isQ: isQ };
        if (q.kind === "add" || q.kind === "add2") {
          var groups = q.kind === "add" ? [q.a, q.b] : [q.a, q.b, q.c];
          var segs = [], d2 = 100;
          for (i = 0; i < groups.length; i++) {
            var cs = [];
            for (var k = 0; k < groups[i]; k++) { cs.push(cell(q.e, i * 100 + k, d2)); d2 += 130; }
            segs.push(segC(cs));
            if (i < groups.length - 1) { segs.push(segO("＋", d2)); d2 += 120; }
          }
          rows.push({ label: "", segs: segs });
          cap = "？" + q.u; brace = true; isQ = true;
        } else if (q.kind === "sub" || q.kind === "sub2") {
          d = 80; var s3 = [];
          for (i = 0; i < q.a; i++) { s3.push(cell(q.e, i, d)); d += 90; }
          rows.push({ label: "", segs: [segC(s3)] });
          cap = q.a + " " + q.u; brace = true;
        } else if (q.kind === "diff") {
          var rA = [], rB = [];
          for (i = 0; i < q.a; i++) rA.push(cell(q.e, i, 100 + i * 90));
          for (i = 0; i < q.b; i++) rB.push(cell(q.e, 100 + i, 100 + i * 90));
          rows.push({ label: "👦 ", segs: [segC(rA)] });
          rows.push({ label: "👧 ", segs: [segC(rB)] });
        } else if (q.kind === "ord") {
          var ro = [];
          q.row.forEach(function (f, i2) { ro.push(cell(f, i2, 120 + i2 * 150)); });
          rows.push({ label: "", segs: [segC(ro)] });
        } else if (q.kind === "add3") {
          d = 100; var m1 = [], m2 = [];
          for (i = 0; i < q.a; i++) { m1.push(cell(q.e, i, d)); d += 120; }
          var mo = d; d += 120;
          for (i = 0; i < q.b; i++) { m2.push(cell(q.e, 100 + i, d)); d += 120; }
          rows.push({ label: "", segs: [segC(m1), segO("＋", mo), segC(m2)] });
          cap = "？" + q.u; brace = true; isQ = true;
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
        if (q._raw && q._raw.opts) { q.opts = U.shuffled(q._raw.opts); q.ans = q.opts.indexOf(q._raw.ans); }
        this.answered = false; this.q = q; this.answer = ""; this.eq = ""; this.vd = ""; this.vdCls = ""; this.teach = "";
        this.selL = -1; this.selR = -1; this.matched = 0;
        this.doneL = []; this.doneR = [];
        var i;
        for (i = 0; i < (q.left || []).length; i++) this.doneL.push(false);
        for (i = 0; i < (q.right || []).length; i++) this.doneR.push(false);
        this.scene = this.buildScene(q);
        var self = this;
        this.$nextTick(function () { if (self.needInput && !self.isOrd && self.$refs.inp) self.$refs.inp.focus(); });
        App.ReadQ.read(q);
      },
      miCls: function (i, side) {
        var sel = side === "L" ? this.selL === i : this.selR === i;
        var dn = side === "L" ? this.doneL[i] : this.doneR[i];
        return { sel: sel, done: dn };
      },
      optCls: function (i) {
        if (!this.answered) return {};
        var ok = U.isCorrect(this.q, i);
        return { x: true, ok: ok, no: !ok };
      },
      pick: function (side, i) {
        if (this.answered || this.q.type !== "match") return;
        if (side === "L") { if (this.doneL[i]) return; this.selL = i; } else { if (this.doneR[i]) return; this.selR = i; }
        this.tryMatch();
      },
      tryMatch: function () {
        if (this.selL < 0 || this.selR < 0) return;
        var q = this.q, lw = q.left[this.selL], rw = q.right[this.selR];
        var ok = q.pairs.some(function (p) { return (p[0] === lw && p[1] === rw) || (p[1] === lw && p[0] === rw); });
        if (ok) {
          this.doneL[this.selL] = true; this.doneR[this.selR] = true;
          this.matched++; Speech.speak(lw + "对" + rw);
          this.selL = -1; this.selR = -1;
          if (this.matched === q.pairs.length) {
            this.answered = true; this.score += 10; U.confetti();
            Speech.speak("全部连对啦！"); this.vd = "✔ 全部连对！+10 分"; this.vdCls = "verdict good";
            Banks.record(q.kp || q.tag || "综合", true); App.Store.addStars(1);
          }
        } else {
          Speech.speak("不对哦，再想想");
          this.selL = -1; this.selR = -1;
        }
      },
      sayDone: function () {
        if (this.answered) return;
        this.answered = true; this.score += 10; U.confetti();
        Speech.speak("说得真好！"); this.vd = "✔ 说得真好！+10 分"; this.vdCls = "verdict good";
        Banks.record(this.q.kp || this.q.tag || "综合", true); App.Store.addStars(1);
      },
      doOpt: function (i) {
        if (this.answered) return;
        this.answered = true;
        this.finish(U.isCorrect(this.q, i), U.ansText(this.q));
      },
      doCmp: function (v) {
        if (this.answered) return;
        this.finish(v === this.q.cmp, this.q.cmp);
      },
      goGone: function (from, n) {
        var cells = this.allCells(), t = 400;
        for (var i = from; i < from + n; i++) {
          (function (i) { setTimeout(function () { if (cells[i]) cells[i].gone = true; }, t); })(i);
          t += 260;
        }
      },
      finish: function (ok, extra) {
        this.answered = true; this.eq = this.q.eq || "";
        if (ok) {
          this.score += 10; U.confetti(); Speech.speak(U.pick(PRAISE));
          this.vd = "✔ 答对啦！+10 分"; this.vdCls = "verdict good";
          Banks.record(this.q.kp || this.q.tag || "综合", true); App.Store.addStars(1);
        } else {
          this.shaking = true; var self = this;
          setTimeout(function () { self.shaking = false; }, 500);
          Speech.speak(U.pick(CHEER));
          this.vd = "✘ 正确答案：" + extra; this.vdCls = "verdict bad";
          if (this.q.teach) this.teach = this.q.teach;
          Banks.record(this.q.kp || this.q.tag || "综合", false);
        }
      },
      check: function () {
        if (this.answered) return;
        var q = this.q, v = String(this.answer).trim();
        if (v === "") { if (this.$refs.inp) this.$refs.inp.focus(); return; }
        if (q.kind === "ord") {
          var ok = (v === q.textAns || v === String(q.k));
          this.answered = true;
          this.eq = ok ? q.textAns : "正确答案：" + q.textAns;
          if (ok) {
            this.score += 10; U.confetti(); Speech.speak(U.pick(PRAISE));
            this.vd = "✔ 答对啦！+10 分"; this.vdCls = "verdict good"; Banks.record(q.kp, true); App.Store.addStars(1);
          } else {
            this.shaking = true; var s = this;
            setTimeout(function () { s.shaking = false; }, 500);
            Speech.speak(q.textAns); this.vd = "✘ 再看看哦"; this.vdCls = "verdict bad"; Banks.record(q.kp, false);
          }
          return;
        }
        if (q.kind === "sub" || q.kind === "sub2") {
          this.goGone(q.a - q.b, q.b);
          if (q.kind === "sub2") this.goGone(q.a, q.c);
        }
        this.finish(parseInt(v, 10) === q.ans, q.ans);
      },
      next: function () {
        this.idx++;
        if (this.idx >= this.quiz.length) {
          this.done = true; U.confetti(40);
          Speech.speak("巩固完成！你得了" + this.score + "分，真棒！");
          return;
        }
        this.loadQ();
      }
    }
  };
})(window);
