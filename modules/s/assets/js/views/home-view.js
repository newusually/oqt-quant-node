/*
 * home-view.js — 视图层 / 主页
 * 顶部寄语（banner.txt，失败用内置）+ 功能入口 + 学习档案（星星/徽章）。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var Speech = App.Speech;

  var ENTRIES = [
    { c: "c1", h: "口算动画课堂.html", i: "🧮", t: "口算动画课堂", d: "小动物来帮忙算加减乘除" },
    { c: "c2", h: "看图学应用.html", i: "🍎", t: "看图学应用", d: "看图列式，解决生活小问题" },
    { c: "c3", h: "数学测试卷.html", i: "📝", t: "数学测试卷", d: "口算·比大小·填空·找规律" },
    { c: "c4", h: "语文测试卷.html", i: "🔤", t: "语文测试卷", d: "拼音·笔画·量词·反义词" },
    { c: "c5", h: "成长小课堂.html", i: "🛡️", t: "成长小课堂", d: "霸凌应对·交往·学习·处事" },
    { c: "c6", h: "语文学习.html", i: "📚", t: "语文学习", d: "拼音跟读·认字·组词造句" },
    { c: "c9", h: "课程中心.html", i: "🎓", t: "课程中心", d: "编程·思维·素养，免费名课大纲" },
    { c: "c12", h: "课堂剧场.html", i: "🎬", t: "课堂剧场", d: "猫老师动画公开课，点一下就开演" },
    { c: "c13", h: "同步课堂.html", i: "📚", t: "同步课堂", d: "1-6年级大纲全覆盖，一课不跳" },
    { c: "c14", h: "奥数三十六计.html", i: "🏆", t: "奥数三十六计", d: "10080道竞赛题·分步解法·多解法" },
    { c: "c10", h: "针对辅导.html", i: "🩺", t: "针对性辅导", d: "哪里薄弱练哪里，智能推卷" },
    { c: "c7", h: "巩固练习.html", i: "🎯", t: "薄弱点巩固", d: "针对错题，再来练一练" },
    { c: "c8", h: "拼音专区.html", i: "🔡", t: "拼音专区", d: "写法·拼读·四声·组词填字" },
    { c: "c9", h: "写作专区.html", i: "✍️", t: "写作专区", d: "看图写话·仿写·连词成句" },
    { c: "c10", h: "英语专区.html", i: "🔤", t: "英语专区", d: "字母·单词·句子·听力背诵" },
    { c: "c11", h: "教案中心.html", i: "📖", t: "教案中心", d: "1-6年级·语文数学英语·人教版" }
  ];
  var FALLBACK = ["今天也要加油哦！", "学习使我最快乐！", "每天进步一点点！", "我是识字小达人！", "口算大王就是我！", "答对了有彩带哦！", "棒棒的一天开始啦！"];

  App.views = App.views || {};
  App.views.home = {
    template: [
      '<site-shell title="一年级学习乐园" sub="点一点下面的小天地，边玩边学真开心！" icon="🌈">',
      '<div class="banner">{{banner}}</div>',
      '<div class="hero"><h1>👧 一年级学习乐园 👦</h1><p>语音 + 动画 + 随机出题，越玩越聪明！</p></div>',
      '<div class="entry-grid">',
      '<a class="entry-card" v-for="e in entries" :key="e.h" :class="e.c" :href="e.h">',
      '<span class="emj">{{e.i}}</span><span class="t">{{e.t}}</span><span class="d">{{e.d}}</span></a>',
      '</div>',
      '<div class="home-tools">',
      '<a class="btn" href="巩固练习.html">🎯 去巩固练习</a>',
      '<a class="btn" href="拼音专区.html">🔡 拼音专区</a>',
      '<a class="btn" href="写作专区.html">✍️ 写作专区</a>',
      '<a class="btn" href="英语专区.html">🔤 英语专区</a>',
      '<a class="btn" href="教案中心.html">📖 教案中心</a>',
      '</div>',
      '<div class="card home-stat">',
      '<div class="hs-title">🏅 我的学习档案</div>',
      '<div class="hs-row"><span>⭐ 学习星星</span><b>{{st.stars}} 颗</b></div>',
      '<div class="hs-row"><span>🚪 来过乐园</span><b>{{st.visits}} 次</b></div>',
      '<div class="hs-row"><span>🏅 获得徽章</span><b>{{st.badges.length}} / {{badges.length}}</b></div>',
      '<div class="hs-badges"><span v-for="b in badges" :key="b.id" :class="{off: !got(b.id)}" :title="badgeTitle(b)">{{got(b.id) ? b.i : "▫️"}}</span></div>',
      '<div class="ctr"><button class="btn spk" @click="hello">🔊 听一句鼓励</button></div>',
      '</div>',
      '</site-shell>'
    ].join(""),
    data: function () {
      return { entries: ENTRIES, banner: "🌟 今天也要加油哦！🌟", st: App.Store.state, badges: App.Store.BADGES };
    },
    mounted: function () {
      var self = this;
      try {
        App.ajax("banner.txt").then(function (t) {
          var s = (t && t.trim()) ? t.trim().split("\n")[0] : FALLBACK[new Date().getDate() % FALLBACK.length];
          self.banner = "🌟 " + s + " 🌟";
        }).catch(function () {
          self.banner = "🌟 " + FALLBACK[new Date().getDate() % FALLBACK.length] + " 🌟";
        });
      } catch (e) {
        self.banner = "🌟 " + FALLBACK[0] + " 🌟";
      }
      // ★2026-10-24 用户要求「打开就播报 + 不要一直重复播报标题」：
      //   页面打开后只播报【一次】欢迎语（删掉此前 pointerdown/click 各一遍 → 三遍的 bug）；
      //   浏览器若因自动播放策略拦下首次播放，则由 announcer 的统一手势解锁兜底补播。
      try { Speech.speak("欢迎来到一年级趣味学习乐园，开始学习吧！", { rate: 0.9 }); } catch (e) {}
      App.Store.unlock("first");
    },
    methods: {
      got: function (id) { return this.st.badges.indexOf(id) >= 0; },
      badgeTitle: function (b) { return b.n + "：" + b.d; },
      hello: function () { Speech.speak("欢迎来到一年级趣味学习乐园，开始学习吧！", { rate: 0.9 }); }
    }
  };
})(window);
