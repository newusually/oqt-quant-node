/*
 * chinese-view.js — 视图层 / 语文测试卷
 * 题型：选择 / 反义词连线(match) / 跟说(speak)。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U, Speech = App.Speech, Banks = App.Banks;
  var PRAISE = ["答对啦，真棒！", "太厉害了！", "完全正确！", "你真是语文小达人！"];
  var CHEER = ["没关系，再想一想哦。", "差一点点，加油！", "再读一读，试一次！"];

  App.views = App.views || {};
  App.views.chinese = {
    template: [
      '<site-shell title="语文测试卷" sub="拼音、字词、句子，一起闯关" icon="🔤">',
      '<div class="scorebar"><span class="score">⭐ 得分 {{score}}</span>',
      '<div class="card" id="card" :class="{shake: shaking}">',
      '<div class="qno" id="qno">第 {{idx+1}} 题{{q.tag ? " · " + q.tag : ""}}</div>',
      '<div class="passage" v-if="q.passage" v-html="passageHtml"></div>',
      '<div class="qtext" id="qtext" v-html="q.html"></div>',
      '<div class="match" v-if="q.type === \'match\'">',
      '<div class="col"><div class="mi" v-for="(wd, i) in q.left" :key="\'L\'+i" :class="miCls(i, \'L\')" @click="pick(\'L\', i)">{{wd}}</div></div>',
      '<div class="col"><div class="mi" v-for="(wd, i) in q.right" :key="\'R\'+i" :class="miCls(i, \'R\')" @click="pick(\'R\', i)">{{wd}}</div></div>',
      '</div>',
      '<div class="hint" v-if="q.type === \'match\'">👆 先点左边的字，再点右边它的反义词</div>',
      '<div class="ctr" v-if="q.type === \'speak\' && !answered">',
      '<button class="btn bigbtn" @click="sayDone">🎤 说好啦</button></div>',
      '<div class="opts" v-else-if="q.type !== \'match\'" :class="{c1: q.opts && q.opts.length <= 2}">',
      '<div class="opt" v-for="(o, i) in q.opts" :key="i" :class="optCls(i)" @click="doOpt(i)">{{o}}</div>',
      '</div>',
      '<div class="eqshow" :class="{show: !!eq}">{{eq}}</div>',
      '<div class="verdict" :class="vdCls">{{vd}}</div>',
      '<div class="teach" v-if="teach">💡 {{teach}}</div>',
      '<div class="ctr" v-if="answered">',
      '<button class="btn bigbtn next" @click="next">{{idx === quiz.length-1 ? "看成绩 🏁" : "下一题 ▶"}}</button></div>',
      '</div>',
      '<div v-if="done" class="card"><div class="done"><div class="medal">🎓</div>',
      '<h2>测试完成！得分 {{score}} 分</h2><div class="stars">{{stars}}</div>',
      '<p>共 {{quiz.length}} 题，答对 {{score/10}} 题 · 语文小达人就是你！</p>',
      '<button class="btn bigbtn" @click="restart">🔄 再测一次</button> ',
      '<a class="btn bigbtn next" href="巩固练习.html">🎯 薄弱点巩固</a> ',
      '<a class="btn bigbtn next" href="口算动画课堂.html">🏠 返回动画课堂</a></div></div>',
      '</site-shell>'
    ].join(""),
    data: function () {
      return {
        quiz: [], idx: 0, score: 0, answered: false, done: false,
        q: {}, eq: "", vd: "", vdCls: "", teach: "", shaking: false,
        selL: -1, selR: -1, matched: 0, doneL: [], doneR: []
      };
    },
    computed: {
      passageHtml: function () {
        var t = this.q && this.q.passage;
        if (!t) return "";
        return App.NLP ? App.NLP.annotate(t) : t;
      },
      stars: function () { return this.score >= (this.quiz.length * 10 * 0.9) ? "🌟🌟🌟" : this.score >= (this.quiz.length * 10 * 0.6) ? "🌟🌟" : "🌟"; }
    },
    mounted: function () {
      var self = this;
      Banks.loadExternal().then(function () { self.restart(); });
      setTimeout(function () { if (!self.quiz.length) self.restart(); }, 1500);
    },
    methods: {
      restart: function () {
        this.score = 0; this.idx = 0; this.done = false;
        this.quiz = Banks.draw("chinese", App.config.counts.chinese || 16);
        this.loadQ();
      },
      loadQ: function () {
        var q = this.quiz[this.idx];
        if (q._raw && q._raw.opts) { q.opts = U.shuffled(q._raw.opts); q.ans = q.opts.indexOf(q._raw.ans); }
        this.answered = false; this.q = q; this.eq = ""; this.vd = ""; this.vdCls = ""; this.teach = "";
        this.selL = -1; this.selR = -1; this.matched = 0;
        this.doneL = []; this.doneR = [];
        var i;
        for (i = 0; i < (q.left || []).length; i++) this.doneL.push(false);
        for (i = 0; i < (q.right || []).length; i++) this.doneR.push(false);
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
            Banks.record(q.kp, true); App.Store.addStars(1);

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
        Banks.record(this.q.kp, true); App.Store.addStars(1); App.Store.markLearned("cn:" + this.q.kp);
      },
      doOpt: function (i) {
        if (this.answered) return;
        this.answered = true;
        var ok = U.isCorrect(this.q, i);
        if (ok) {
          this.score += 10; U.confetti(); Speech.speak(U.pick(PRAISE));
          this.vd = "✔ 答对啦！+10 分"; this.vdCls = "verdict good"; Banks.record(this.q.kp, true);
          App.Store.addStars(1); App.Store.markLearned("cn:" + this.q.kp);
          if (App.Store.countLearned("cn:") >= 10) App.Store.unlock("cn10");
        } else {
          this.shaking = true; var self = this;
          setTimeout(function () { self.shaking = false; }, 500);
          Speech.speak(U.pick(CHEER)); Banks.record(this.q.kp, false);
          this.vd = "✘ 正确答案：" + U.ansText(this.q); this.vdCls = "verdict bad";
          if (this.q.teach) this.teach = this.q.teach;
        }
      },
      next: function () {
        this.idx++;
        if (this.idx >= this.quiz.length) {
          this.done = true; U.confetti(40);
          Speech.speak("测试完成！你得了" + this.score + "分，你真是语文小达人！");
          return;
        }
        this.loadQ();
      }
    }
  };
})(window);
