/*
 * lessons-view.js — 视图层 / 教案中心
 * 1-6 年级 × 语文/数学/英语（人教版）单元教案，可整册朗读。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var Speech = App.Speech, IMG = App.IMG;

  var SUBJ_ICON = { "语文": "book", "数学": "star", "英语": "cat" };
  var MASCOTS = ["cat", "rabbit", "bear", "bird"];

  App.views = App.views || {};
  App.views.lessons = {
    template: [
      '<site-shell title="教案中心" sub="1-6 年级 · 语文 / 数学 / 英语 · 人教版教材结构" icon="📖">',
      '<div class="mascot-row">',
      '<span class="mascot" v-for="(m, i) in mascots" :key="i" :class="\'m\' + (i+1)" v-html="tag(m)"></span>',
      '</div>',
      '<div class="lp-grades">',
      '<span class="gbtn" v-for="g in grades" :key="g" :class="{on: grade === g}" @click="grade = g">{{g}}年级</span>',
      '</div>',
      '<div class="lp-subjects">',
      '<span class="sbtn" v-for="s in subjects" :key="s" :class="{on: subject === s}" @click="subject = s">{{s}}</span>',
      '</div>',
      '<div class="lp-note">{{note}}</div>',
      '<div class="lp-actions">',
      '<button class="btn spk" @click="readAll">🔊 按顺序读全册教案</button>',
      '</div>',
      '<div class="lp-list">',
      '<div class="lpcard" v-for="(u, i) in units" :key="i">',
      '<div class="lpu"><span class="uicon" v-html="tag(icon)"></span>{{u.u}}</div>',
      '<div class="lprow"><b>教学目标</b><span class="v">{{u.goal}}</span></div>',
      '<div class="lprow"><b>教学重难点</b><span class="v">重点：{{u.key}}；难点：{{u.hard}}</span></div>',
      '<div class="lprow"><b>教学过程</b><span class="v">{{u.proc}}</span></div>',
      '<div class="lprow"><b>板书设计</b><span class="v">{{u.board}}</span></div>',
      '<div class="lprow"><b>课后作业</b><span class="v">{{u.hw}}</span></div>',
      '<div class="lpactions"><button class="btn spk" @click="read(u)">🔊 读教案</button></div>',
      '</div>',
      '<div class="lp-note" v-if="!units.length">该年级暂无教案。</div>',
      '</div>',
      '</site-shell>'
    ].join(""),
    data: function () {
      var L = App.Lessons || { grades: [], subjects: [], data: {}, note: "" };
      return { L: L, grade: (L.grades && L.grades[0]) || 1, subject: (L.subjects && L.subjects[0]) || "语文", mascots: MASCOTS };
    },
    computed: {
      subjects: function () { return this.L.subjects || []; },
      units: function () {
        var d = this.L.data || {};
        return (d[this.subject] && d[this.subject][this.grade]) || [];
      },
      icon: function () { return SUBJ_ICON[this.subject] || "book"; },
      note: function () {
        if (this.subject === "英语") return "📝 " + (this.L.note || "");
        if (this.subject === "语文") return "📝 语文依据人民教育出版社（统编版/部编版）教材单元结构整理。";
        return "📝 数学依据人教版（人民教育出版社）教材单元结构整理。";
      }
    },
    mounted: function () {
      Speech.autoRead("教案中心，1到6年级语文、数学、英语教案都在这里！");
    },
    methods: {
      tag: function (id) { return IMG.tag(id, "imgspan") || ""; },
      read: function (u) {
        Speech.sfx.pop();
        Speech.speak(u.u + "。" + u.goal + " 重点：" + u.key + "。");
      },
      readAll: function () {
        var self = this;
        Speech.seq(this.units.map(function (u) { return u.u + "。" + u.goal + " 重点：" + u.key + "。"; }));
      }
    }
  };
})(window);
