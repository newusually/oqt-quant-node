/*
 * growth-view.js — 视图层 / 成长小课堂
 * 渲染 App.Social.topics：故事 + 好方法 + 互动自测，每条都配动画小剧场，可整篇朗读。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var Speech = App.Speech, U = App.U;

  var CAST = {
    bully: ["boy", "bear"], friend: ["girl", "rabbit"], study: ["kid", "cat"], manners: ["teacher", "panda"],
    sharing: ["girl", "monkey"], calm: ["boy", "frog"], body: ["girl", "rabbit"], respect: ["teacher", "bear"], sos: ["kid", "dog"]
  };

  App.views = App.views || {};
  App.views.growth = {
    template: [
      '<site-shell title="成长小课堂" sub="小故事教会我们保护自己、友好待人" icon="🛡️">',
      '<div class="gbar"><button class="btn spk" @click="readAll">🔊 按顺序读所有故事</button>',
      '<span class="hint">共 {{topics.length}} 个小课堂</span></div>',
      '<div class="gcard" v-for="(t, i) in topics" :key="i">',
      '<div class="ghead"><span class="gicon">{{t.icon}}</span>',
      '<div><div class="gcat">{{t.cat}}</div><div class="gtitle">{{t.title}}</div></div>',
      '<button class="btn spk" @click="read(i)">🔊 读给我听</button></div>',
      '<div class="gcast" :ref="\'cast\' + i" v-html="stageHtml(t.id)"></div>',
      '<div class="gstory" v-html="storyHtml(t)"></div>',
      '<div class="gtip"><b>✅ 好方法</b><ul><li v-for="(x, j) in t.tips" :key="j">{{x}}</li></ul></div>',
      '<div class="gquiz">',
      '<div class="qtext">{{t.quiz.q}}</div>',
      '<div class="opts"><div class="opt" v-for="(o, k) in t.quiz.opts" :key="k" :class="quizCls(t, k)" @click="answer(t, k)">{{o}}</div></div>',
      '<div class="gfb" :class="t.fbCls" v-html="t.fb"></div>',
      '</div>',
      '</div>',
      '</site-shell>'
    ].join(""),
    data: function () {
      var list = (App.Social && App.Social.topics) || [];
      return { topics: list.map(function (t) { t.fb = ""; t.fbCls = ""; t.done = false; t.picked = -1; return t; }) };
    },
    mounted: function () {
      Speech.autoRead("成长小课堂，听小故事，学会保护自己、友好待人！");
    },
    methods: {
      storyHtml: function (t) { return App.NLP ? App.NLP.annotate(t.story) : t.story; },
      stageHtml: function (id) {
        if (!App.Anim) return "";
        var cast = CAST[id] || ["kid", "cat"];
        return App.Anim.stage({ people: [cast[0]], animals: [cast[1]] });
      },
      quizCls: function (t, i) {
        if (!t.done) return {};
        var ok = i === t.quiz.a;
        return { x: true, ok: ok, no: !ok };
      },
      read: function (i) {
        var t = this.topics[i];
        var el = this.$refs["cast" + i];
        if (App.Anim && el) App.Anim.celebrate(Array.isArray(el) ? el[0] : el);
        Speech.speak(t.title + "。" + t.story + "。" + t.tips.join("。") + "。");
      },
      readAll: function () {
        var self = this;
        Speech.seq(this.topics.map(function (t) { return t.title + "。" + t.story + "。" + t.tips.join("。") + "。"; }));
      },
      answer: function (t, i) {
        if (t.done) return;
        t.done = true; t.picked = i;
        var ok = i === t.quiz.a;
        t.fb = (ok ? "✔ 你真棒！" : "✘ 再想想：") + "<span class='gexplain'>" + t.quiz.explain + "</span>";
        t.fbCls = "gfb " + (ok ? "good" : "bad");
        if (ok) { U.confetti(14); Speech.speak("你真棒！"); App.Store.addStars(1); }
        else Speech.speak(t.quiz.explain);
      }
    }
  };
})(window);
