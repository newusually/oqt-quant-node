/* ============================================================================
 * views/theater-view.js —— 🎬 课堂剧场（2026-10-27）
 * ----------------------------------------------------------------------------
 * 用户: "课堂剧场 我没有看到啊" → 原入口藏在课程中心展开课程后, 不直观。
 *   现版: 独立页面(课堂剧场.html) + 主页入口卡 + 导航项, 一眼可见。
 *   课程数据单一来源: assets/js/data/courses.js (App.COURSES / App.COURSE_DEMO),
 *   与课程中心共用, 不再各存一份。
 * 用法: 选分类 → 点课程卡「▶ 开演」→ 猫老师课堂剧场开演。
 * ========================================================================== */
(function (w) {
  "use strict";
  var App = w.App = w.App || {};
  if (!w.Vue) return;
  App.views = App.views || {};
  var U = App.U, Speech = App.Speech;

  App.views.theater = {
    name: "TheaterView",
    template: [
      '<site-shell>',
      '<div class="wrap">',
      '<div class="th-hero">🎬 课堂剧场<span class="th-sub">猫老师的动画公开课 · 点一下就开演</span></div>',
      '<div class="ltabs">',
      '<button class="ltab" v-for="c in cats" :key="c.k" :class="{on: cat===c.k}" @click="pickCat(c.k)">{{c.i}} {{c.t}}</button>',
      '</div>',
      '<div class="th-tip" @click="speakTip($event)"><span class="fx-hl">{{catObj.hero}}</span> <button class="btn spk">🔊</button></div>',
      '<div class="th-grid">',
      '<div class="th-card" v-for="c in list" :key="c.id" :class="{playing: openId===c.id}">',
      '<div class="th-star">{{"⭐".repeat(c.star)}}</div>',
      '<div class="th-card-t">{{c.t}}</div>',
      '<div class="th-card-meta">⏱ 约 {{c.min}} 分钟 · {{c.steps.length}} 个知识点</div>',
      '<div class="th-card-why">{{c.why}}</div>',
      '<button class="btn th-play" @click="play(c, $event)">▶ 开演</button>',
      '</div>',
      '</div>',
      '<div class="th-stage-wrap" v-show="openId">',
      '<div class="th-stage-head">',
      '<span class="th-live">● 正在上演</span><span class="th-title">{{openCourse.t}}</span>',
      '<button class="btn th-stop" @click="stop($event)">■ 下课</button>',
      '</div>',
      '<div ref="stage" class="th-stage"></div>',
      '<div class="th-after">🎓 下课啦 → 去 <a href="课程中心.html">课程中心</a> 做随堂小测，检验学到了多少吧！</div>',
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
          { k: "code", i: "🧩", t: "编程启蒙", hero: "像玩游戏一样学编程思维（指令·循环·条件·变量·克隆·算法）" },
          { k: "mind", i: "🧠", t: "思维训练", hero: "小侦探式思维课（找规律·逻辑推理·数独）" },
          { k: "art", i: "🎵", t: "素养启蒙", hero: "音乐·美术·科学，激发好奇心" }
        ],
        openId: ""
      };
    },
    computed: {
      catObj: function () {
        var self = this;
        return this.cats.filter(function (c) { return c.k === self.cat; })[0] || {};
      },
      list: function () { return (App.COURSES || {})[this.cat] || []; },
      openCourse: function () {
        var self = this;
        var all = App.COURSES || {};
        for (var k in all) {
          var hit = (all[k] || []).filter(function (c) { return c.id === self.openId; })[0];
          if (hit) return hit;
        }
        return { t: "" };
      }
    },
    methods: {
      pickCat: function (k) {
        var self = this;
        this.cat = k;
        this.stop();
        this.$nextTick(function () {
          var c = self.catObj;
          if (c && Speech && Speech.speak) Speech.speak((c.t || "") + "课堂", {});
        });
      },
      speakTip: function (ev) {
        if (Speech) Speech.speak(this.catObj.hero || "", { el: ev && (ev.currentTarget || ev.target) });
      },
      play: function (c, ev) {
        this.teardownCr();
        this.openId = c.id;
        var self = this;
        this.$nextTick(function () {
          if (!App.Classroom) return;
          var host = self.$refs.stage;
          host = Array.isArray(host) ? host[0] : host;
          if (!host) return;
          /* 滚到舞台 */
          try { host.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) { }
          self._cr = App.Classroom.mount(host, App.Classroom.toScript(c, {
            demoFor: function (cc, i) { return self.demoFor(cc, i); }
          }), { course: c, doneTip: "🎓 课堂结束！去 课程中心 做随堂小测吧" });
        });
        if (Speech) Speech.speak("欢迎来到课堂剧场，" + c.t, { el: ev && (ev.currentTarget || ev.target) });
      },
      stop: function (ev) {
        this.teardownCr();
        this.openId = "";
        if (ev && Speech) Speech.speak("下课啦", { el: ev.currentTarget || ev.target });
      },
      teardownCr: function () { if (this._cr) { try { this._cr.destroy(); } catch (e) { } this._cr = null; } },
      demoFor: function (course, i) {
        var D = App.COURSE_DEMO || {};
        var fn = D[course.id];
        return fn ? fn(course, i) : null;
      }
    },
    beforeUnmount: function () { this.teardownCr(); }
  };
})(window);
