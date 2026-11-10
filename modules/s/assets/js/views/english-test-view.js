/*
 * english-test-view.js — 视图层 / 英语测试
 * 题型：choice(选词) / listen(听力) / spell(拼写) / cloze(完形填空)。
 * 语音规则：题干、单词、句子全部 speakEn；鼓励语用中文 speak，不混读。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U, Speech = App.Speech, Banks = App.Banks;
  var PRAISE = ["Great job!", "太棒啦！", "完全正确！", "你真是英语小达人！"];
  var CHEER = ["再想一想哦。", "差一点点，加油！", "再听/读一遍试试！"];

  function mkSpell(q) {
    if (!q || q.type !== "spell" || !q.word) return { word: "", tiles: [], used: [], slots: [] };
    var slots = [], i;
    for (i = 0; i < q.word.length; i++) slots.push(null);
    return { word: q.word, tiles: q.tiles || [], used: (q.tiles || []).map(function () { return false; }), slots: slots };
  }

  App.views = App.views || {};
  App.views.englishTest = {
    template: [
      '<site-shell title="英语测试" sub="听一听、选一选、拼一拼" icon="🎧">',
      '<div class="scorebar"><span class="score">⭐ 得分 {{score}}</span>',
      '<button class="btn spk" @click="readQ">🔊 再听一次</button></div>',
      '<div class="card" id="card" :class="{shake: shaking}">',
      '<div class="qno" id="qno">第 {{idx+1}} 题{{q.kp ? " · " + q.kp : ""}}</div>',
      '<div class="read-passage" v-if="q.type === \'reading\'">',
      '<div class="rp-head"><b>{{q.title}}</b>',
      '<button class="btn spk" @click="readEn(q.passage)">🔊 朗读短文</button></div>',
      '<p class="rp-text">{{q.passage}}</p>',
      '<p class="rp-cn" v-if="q.cn">{{q.cn}}</p>',
      '</div>',
      '<div class="qtext" id="qtext">{{qText}}</div>',
      '<div class="spell-hint" v-if="q.type === \'spell\'">把字母按顺序拼成单词：<b>{{q.word}}</b></div>',
      '<div class="slots" v-if="q.type === \'spell\'">',
      '<div class="sbox" v-for="(s, j) in spell.slots" :key="j" :class="{filled: !!s}" @click="unsetSlot(j)">{{s ? s.ch : ""}}</div>',
      '</div>',
      '<div class="tiles" v-if="q.type === \'spell\'">',
      '<div class="tile" v-for="(c, i) in spell.tiles" :key="i" :class="{used: spell.used[i]}" @click="setTile(i)">{{c}}</div>',
      '</div>',
      '<div class="opts" v-else-if="q.opts" :class="{c1: q.opts.length <= 2}">',
      '<div class="opt" v-for="(o, i) in q.opts" :key="i" :class="optCls(i)" @click="doOpt(i)">{{o}}</div>',
      '</div>',
      '<div class="ctr" v-if="q.type === \'spell\'">',
      '<button class="btn bigbtn" @click="checkSpell">✔ 检查</button>',
      '<button class="btn spk" @click="readEn(q.word)">🔊 听单词</button></div>',
      '<div class="ctr" v-else-if="q.type === \'listen\'">',
      '<button class="bigbtn spk" @click="readEn(q.say)">🔊 再听一次</button></div>',
      '<div class="eqshow" :class="{show: !!eq}">{{eq}}</div>',
      '<div class="verdict" :class="vdCls">{{vd}}</div>',
      '<div class="teach" v-if="teach">{{teach}}</div>',
      '<div class="ctr" v-if="answered">',
      '<button class="btn bigbtn next" @click="next">{{idx === quiz.length-1 ? "看成绩 🏁" : "下一题 ▶"}}</button></div>',
      '</div>',
      '<div v-if="done" class="card"><div class="done"><div class="medal">🎓</div>',
      '<h2>测试完成！得分 {{score}} 分</h2><div class="stars">{{stars}}</div>',
      '<p>共 {{quiz.length}} 题，答对 {{score/10}} 题 · 英语小达人就是你！</p>',
      '<button class="btn bigbtn" @click="restart">🔄 再测一次</button> ',
      '<a class="btn bigbtn next" href="巩固练习.html">🎯 薄弱点巩固</a> ',
      '<a class="btn bigbtn next" href="英语专区.html">🔡 去英语专区</a></div></div>',
      '</site-shell>'
    ].join(""),
    data: function () {
      return {
        quiz: [], idx: 0, score: 0, answered: false, done: false,
        q: {}, spell: { word: "", tiles: [], used: [], slots: [] },
        eq: "", vd: "", vdCls: "", teach: "", shaking: false
      };
    },
    computed: {
      stars: function () { return this.score >= (this.quiz.length * 10 * 0.9) ? "🌟🌟🌟" : this.score >= (this.quiz.length * 10 * 0.6) ? "🌟🌟" : "🌟"; },
      qText: function () {
        if (this.q.type === "listen") return "🔊 听一听，选出你听到的单词：";
        return this.q.q || this.q.text || "";
      }
    },
    mounted: function () {
      var self = this;
      Banks.loadExternal().then(function () { self.restart(); });
      setTimeout(function () { if (!self.quiz.length) self.restart(); }, 1500);
    },
    methods: {
      readEn: function (t) { Speech.speakEn(t, { rate: 0.85 }); },
      readQ: function () {
        var q = this.q;
        if (q.type === "listen") Speech.speakEn(q.say);
        else if (q.type === "spell") Speech.speakEn(q.word);
        else if (q.type === "reading") Speech.speakEn(q.passage, { rate: 0.8 });
        else if (q.speak) Speech.speakEn(q.speak);
        else Speech.speakEn(q.q || q.text || "");
      },
      restart: function () {
        this.score = 0; this.idx = 0; this.done = false;
        this.quiz = Banks.draw("english", App.config.counts.english || 14);
        this.loadQ();
      },
      loadQ: function () {
        var q = this.quiz[this.idx];
        if (!q) return;
        if (q.type === "choice" || q.type === "cloze" || q.type === "listen" || q.type === "reading" || q.type === "phonics") {
          if (!q._raw) q._raw = { opts: q.opts.slice(), ans: q.ans };
          q.opts = U.shuffled(q._raw.opts);
          q.ans = q.opts.indexOf(q._raw.opts[q._raw.ans]);
        }
        if (q.type === "spell") { if (!q._tiles) q._tiles = U.shuffled(q.tiles.slice()); q.tiles = q._tiles; }
        this.answered = false; this.q = q; this.eq = ""; this.vd = ""; this.vdCls = ""; this.teach = "";
        this.spell = mkSpell(q);
        var self = this;
        setTimeout(function () {
          // 先念题目，再把选项一个个念出来（顺序播报，不会被下一句掐断）
          var t = "";
          if (q.type === "listen") t = q.say || "";
          else if (q.type === "spell") t = q.word || "";
          else if (q.type === "reading") t = q.passage || "";
          else if (q.speak) t = q.speak;
          else t = q.q || q.text || "";
          var os = (q.opts && q.opts.length) ? q.opts : null;
          if (App.ReadQ) App.ReadQ.readText(t, os, { en: true, force: true });
          else Speech.speakEn(t, { rate: 0.85 });
        }, 600);
      },
      optCls: function (i) {
        if (!this.answered) return {};
        var ok = i === this.q.ans;
        return { x: true, ok: ok, no: !ok };
      },
      setTile: function (i) {
        if (this.answered || this.spell.used[i]) return;
        var empty = -1, k;
        for (k = 0; k < this.q.word.length; k++) { if (!this.spell.slots[k]) { empty = k; break; } }
        if (empty < 0) return;
        this.spell.slots[empty] = { ch: this.spell.tiles[i], from: i };
        this.spell.used[i] = true;
      },
      unsetSlot: function (j) {
        if (this.answered) return;
        var s = this.spell.slots[j];
        if (!s) return;
        this.spell.used[s.from] = false;
        this.spell.slots[j] = null;
      },
      checkSpell: function () {
        if (this.answered) return;
        var guess = this.spell.slots.map(function (s) { return s ? s.ch : ""; }).join("");
        this.answered = true;
        var ok = guess === this.q.word;
        if (ok) {
          this.score += 10; U.confetti(); Speech.speakEn(this.q.word); Speech.speak("拼对啦！");
          this.vd = "✔ 拼写正确：" + this.q.word + " +10 分"; this.vdCls = "verdict good";
          Banks.record(this.q.kp, true); App.Store.addStars(1);
          App.Store.markLearned("en:" + this.q.kp);
          if (App.Store.countLearned("en:") >= 10) App.Store.unlock("en10");
        } else {
          this.shaking = true; var self = this;
          setTimeout(function () { self.shaking = false; }, 500);
          Speech.speak("再试试"); Banks.record(this.q.kp, false);
          this.vd = "✘ 正确拼写：" + this.q.word; this.vdCls = "verdict bad";
          this.teach = "💡 提示：按顺序把字母排好，再听一听 " + this.q.word;
        }
      },
      doOpt: function (i) {
        if (this.answered) return;
        this.answered = true;
        var ok = i === this.q.ans;
        if (ok) {
          this.score += 10; U.confetti(); Speech.speak(U.pick(PRAISE));
          this.vd = "✔ 答对啦！+10 分"; this.vdCls = "verdict good"; Banks.record(this.q.kp, true);
          App.Store.addStars(1); App.Store.markLearned("en:" + this.q.kp);
          if (App.Store.countLearned("en:") >= 10) App.Store.unlock("en10");
        } else {
          this.shaking = true; var self = this;
          setTimeout(function () { self.shaking = false; }, 500);
          Speech.speak(U.pick(CHEER)); Banks.record(this.q.kp, false);
          this.vd = "✘ 正确答案：" + this.q.opts[this.q.ans]; this.vdCls = "verdict bad";
          if (this.q.teach) this.teach = "💡 " + this.q.teach;
          else if (this.q.why) this.teach = "💡 " + this.q.why;
        }
      },
      next: function () {
        this.idx++;
        if (this.idx >= this.quiz.length) {
          this.done = true; U.confetti(40);
          Speech.speak("测试完成！你得了" + this.score + "分，你真是英语小达人！");
          return;
        }
        this.loadQ();
      }
    }
  };
})(window);
