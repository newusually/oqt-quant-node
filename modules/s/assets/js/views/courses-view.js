/* courses-view.js — 视图层 / 课程中心 (2026-10-27)
 * 对标猿辅导素养课/核桃编程启蒙课大纲, 全部自研内容, 免费+离线可用。
 * 分类: 🧩 编程启蒙(Scratch概念) / 🧠 思维训练 / 🎵 素养启蒙
 * 每课: 星级难度 + 学习目标 + 图解步骤 + 随堂小测(即时批改+彩带) + 朗读跟读高亮 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U, Speech = App.Speech;
  if (!w.Vue) return;

  var COURSES = App.COURSES

  App.views = App.views || {};
  App.views.courses = {
    name: "courses",
    template: [
      '<site-shell title="课程中心" sub="对标名课大纲 · 全部免费 · 离线可学" icon="🎓">',
      '<div class="ltabs">',
      '<button class="ltab" v-for="c in cats" :key="c.k" :class="{on: cat===c.k}" @click="cat=c.k">{{c.i}} {{c.t}}</button>',
      '</div>',
      '<div class="card lpanel">',
      '<div class="cs-hero">{{catObj.hero}}</div>',
      '<div class="cs-list">',
      '<div class="cs-card" v-for="(c, i) in list" :key="c.id" :class="{open: openId===c.id}">',
      '<div class="cs-head" @click="toggle(c, $event)">',
      '<span class="cs-star">{{"★".repeat(c.star)}}<i>{{"☆".repeat(5-c.star)}}</i></span>',
      '<b>{{c.t}}</b>',
      '<span class="cs-min">⏱ {{c.min}}分钟</span>',
      '</div>',
      '<div class="cs-body" v-show="openId===c.id">',
      '<div class="cs-why" @click="speakWhy(c, $event)"><span class="fx-hl">💡 {{c.why}}</span> <button class="btn spk">🔊 跟我读</button></div>',
      /* ★课堂剧场: 老师+学生+黑板动画公开课, 取代纯文字步骤列表 */
      '<div class="cr-host" v-if="openId===c.id" :ref="\'cr_\' + c.id"></div>',
      '<div class="cs-quiz" v-if="qz.length">',
      '<div class="cs-qt" v-for="(q, j) in qz" :key="j">',
      '<div class="cs-q">{{j+1}}. {{q.q}}</div>',
      '<div class="cs-opts">',
      '<button class="cs-opt" v-for="(o, k) in q.o" :key="k" :class="{ok: ans[j]===k && q.a===k, bad: ans[j]===k && q.a!==k}" @click="pick(j, k)">{{o}}</button>',
      '</div>',
      '</div>',
      '<div class="cs-done" v-if="allDone">🎉 全部答对！奖励一颗星，去学下一课吧！</div>',
      '</div>',
      '</div>',
      '</div>',
      '</div>',
      '</div>',
      '</site-shell>'
    ].join("\n"),
    data: function () {
      return {
        cat: "chinese",
        cats: [
          { k: "chinese", i: "📖", t: "语文乐园", hero: "认字·拼音·成语·反义词，语文其实很好玩" },
          { k: "math", i: "🔢", t: "数学思维", hero: "加减乘除全部画出来，一看就懂" },
          { k: "english", i: "🔤", t: "英语启蒙", hero: "字母·拼读·颜色·口语，开口说英语" },
          { k: "code", i: "🧩", t: "编程启蒙", hero: "像玩游戏一样学编程思维（对标核桃编程启蒙大纲：指令·循环·条件·变量·克隆·算法）" },
          { k: "mind", i: "🧠", t: "思维训练", hero: "小侦探式思维课（对标素养课：找规律·逻辑推理·数独）" },
          { k: "art", i: "🎵", t: "素养启蒙", hero: "音乐·美术·科学，全英文包激发好奇心（对标素养启蒙课）" }
        ],
        openId: "",
        ans: {}
      };
    },
    computed: {
      catObj: function () { var self = this; return this.cats.filter(function (c) { return c.k === self.cat; })[0] || {}; },
      list: function () { return COURSES[this.cat] || []; },
      qz: function () { var self = this; return (COURSES[this.cat] || []).filter(function (c) { return c.id === self.openId; }).map(function (c) { return c.quiz; })[0] || []; },
      allDone: function () { var q = this.qz, a = this.ans; return q.length && q.every(function (x, j) { return a[j] === x.a; }); }
    },
    methods: {
      toggle: function (c, ev) {
        this.openId = this.openId === c.id ? "" : c.id;
        this.ans = {};
        this.teardownCr();
        if (this.openId) {
          var self = this;
          this.$nextTick(function () { self.mountCr(c); });
        } else if (ev) Speech.speak(c.t, { el: ev && (ev.currentTarget || ev.target) });
      },
      /* ★课堂剧场挂载/销毁 */
      teardownCr: function () { if (this._cr) { try { this._cr.destroy(); } catch (e) {} this._cr = null; } },
      mountCr: function (c) {
        if (!App.Classroom) return;
        var host = this.$refs["cr_" + c.id];
        host = Array.isArray(host) ? host[0] : host;
        if (!host) return;
        var self = this;
        this._cr = App.Classroom.mount(host, App.Classroom.toScript(c, { demoFor: function (cc, i, tx) { return self.demoFor(cc, i, tx); } }), { course: c, doneTip: "🎓 课堂结束！下面做随堂小测检验一下吧" });
      },
      demoFor: function (course, i) {
        var D = App.COURSE_DEMO || {};
        var fn = D[course.id];
        return fn ? fn(course, i) : null;
      },
      pick: function (j, k) {
        this.ans = Object.assign({}, this.ans, (function (o) { o[j] = k; return o; })({}));
        var q = this.qz[j];
        if (q.a === k) { try { U.confetti(); } catch (e) {} Speech.speak("答对啦"); }
        else Speech.speak("再想一想哦");
      },
      speakWhy: function (c, ev) { Speech.speak(c.why, { el: ev && (ev.currentTarget || ev.target) }); },
      speakStep: function (c, j, ev) { Speech.speak(c.steps[j], { el: ev && (ev.currentTarget || ev.target) }); }
    }
  };
})(window);
