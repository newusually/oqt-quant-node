/* ============================================================================
 * views/syllabus-view.js —— 📚 同步课堂（2026-10-27）
 * ----------------------------------------------------------------------------
 * 完全对齐小学 1-6 年级大纲(部编语文/人教数学/PEP英语), 341 单元一课不跳。
 * 学科→年级→学期→单元列表; 每单元: ▶剧场开演 + 📝题库抽题即答即判 + 💡学习方法。
 * 数据: assets/js/data/syllabus.js (App.SYLLABUS)
 * 做题: 从 App.DATA.exam[examKey] 按 kws 关键词抽题, 不足随机补, 5题/组。
 * ========================================================================== */
(function (w) {
  "use strict";
  var App = w.App = w.App || {};
  if (!w.Vue) return;
  App.views = App.views || {};
  var U = App.U, Speech = App.Speech, ReadQ = App.ReadQ;

  var KT_LABEL = {
    shizi: "识字", pinyin: "拼音", kewen: "课文", gushi: "古诗词", xiezuo: "习作",
    wenyan: "文言文", kouyu: "口语", yuandi: "园地",
    js: "计算", gainian: "概念", xing: "图形", yingy: "应用", tongji: "统计", guangjiao: "广角",
    words: "单词", sent: "句型", phonics: "拼读", review: "复习"
  };
  var KT_CLS = {
    shizi: "sy-t-shizi", pinyin: "sy-t-pinyin", kewen: "sy-t-kewen", gushi: "sy-t-gushi",
    js: "sy-t-js", xing: "sy-t-xing", words: "sy-t-words", sent: "sy-t-sent"
  };

  /* B站式通用学习方法宝典 */
  var METHODS = {
    chinese: [
      ["🌅 晨读打卡", "每天早晨朗读 10 分钟课文/古诗，语感是读出来的"],
      ["✍️ 字词过关", "每天听写 5 个生字，错字圈出来第二天重写"],
      ["📖 朗读三遍法", "一读准字音、二读通句子、三读出感情"],
      ["💡 复述检查", "读完课文用「谁+做什么+结果怎样」讲给家人听"],
      ["📚 积累本", "好词好句分类抄（写景/写人/写心情），作文有存粮"],
      ["🎞️ 古诗画面法", "把诗想象成动画片，画面记忆比死背牢 10 倍"]
    ],
    math: [
      ["⏱️ 口算天天练", "每天 10 分钟限时口算，先求全对再求速度"],
      ["📕 错题本三件套", "原题+错因（抄错/进位忘/概念不清）+正确解法，周末重做"],
      ["📈 画图解题", "应用题画线段图，倍数问题画点阵，一看就懂"],
      ["🗣️ 费曼讲题法", "把题讲给爸妈听，讲不明白的地方就是没懂的地方"],
      ["🧱 实物操作", "用积木/小棒理解概念：摆一摆胜过看十遍"],
      ["母题吃透法", "课本例题反复做 3 遍，考试题都是例题变出来的"]
    ],
    english: [
      ["🎧 磨耳朵", "每天听 10 分钟英文儿歌/动画音频，先听懂再会说"],
      ["🗣️ 跟读模仿", "听一句→模仿一句→录音对比，语音进步最快"],
      ["🃏 单词卡片法", "正面英文背面中文，每天过 10 张，会的放右边"],
      ["🔤 自然拼读", "见词能读、听音能写，拼读规律本天天攒"],
      ["📝 句型周计划", "每周 3-5 个句型，每句自己造 2 个新句子"],
      ["📚 分级阅读", "每天读一本分级读物（牛津树/RAZ），词在故事里活起来"]
    ],
    common: [
      ["🍅 番茄钟", "25 分钟专注学习+5 分钟休息，低年级 20+5"],
      ["🔁 先复习后作业", "写作业前先花 5 分钟回顾当天知识点，效率翻倍"],
      ["❓ 预习三问法", "明天学什么？哪里看不懂？想问老师什么？"],
      ["🌙 睡前 5 分钟", "回顾今天学的内容，记忆翻倍"],
      ["🎨 四色笔记法", "黑笔做题、红笔改错、蓝笔标难点、绿笔补充"],
      ["📅 艾宾浩斯复习", "当天小复习、周末周复习、月末大复习"]
    ]
  };

  App.views.syllabus = {
    name: "SyllabusView",
    template: [
      '<site-shell>',
      '<div class="wrap">',
      '<div class="sy-hero">📚 同步课堂<span class="th-sub">小学 1-6 年级大纲全覆盖 · {{totalUnits}} 课一节不跳 · 每课配动画+练习+方法</span></div>',

      /* 学科 tab */
      '<div class="ltabs">',
      '<button class="ltab" v-for="s in subjects" :key="s.k" :class="{on: subj===s.k}" @click="pickSubj(s.k)">{{s.i}} {{s.t}}</button>',
      '<button class="ltab" :class="{on: showMethods}" @click="showMethods=!showMethods">💡 学习方法宝典</button>',
      '</div>',

      /* 方法宝典 */
      '<div class="sy-methods" v-if="showMethods">',
      '<div class="card lpanel sy-mcard" v-for="mg in methodGroups" :key="mg.t">',
      '<div class="sy-mtitle">{{mg.t}}</div>',
      '<div class="sy-mrow" v-for="m in mg.list" :key="m[0]"><b>{{m[0]}}</b><span>{{m[1]}}</span></div>',
      '</div>',
      '</div>',

      /* 年级+学期 tab */
      '<div class="ltabs" v-if="!showMethods">',
      '<button class="ltab sm" v-for="g in grades" :key="g.k" :class="{on: grade===g.k}" @click="grade=g.k">{{g.t}}</button>',
      '</div>',
      '<div class="ltabs" v-if="!showMethods">',
      '<button class="ltab sm" :class="{on: sem===\'s1\'}" @click="sem=\'s1\'">上学期</button>',
      '<button class="ltab sm" :class="{on: sem===\'s2\'}" @click="sem=\'s2\'">下学期</button>',
      '</div>',

      /* 大纲统计 + 单元列表 */
      '<div class="sy-count" v-if="!showMethods">{{subjObj.t}} {{gradeObj.t}}{{sem===\'s1\'?\'上\':\'下\'}}册 · 共 {{units.length}} 课（对齐课本目录）</div>',
      '<div class="sy-grid" v-if="!showMethods">',
      '<div class="sy-item" v-for="(u, i) in units" :key="u.id" :class="{open: openIdx===i}">',
      '<div class="sy-item-main" @click="openUnit(i)">',
      '<span class="sy-no">{{i+1}}</span>',
      '<span class="sy-t">{{u.t}}</span>',
      '<span class="sy-tag" :class="u.cls">{{u.kLabel}}</span>',
      '</div>',
      '</div>',
      '</div>',

      /* 学习面板 */
      '<div class="card lpanel sy-panel" v-if="cur && !showMethods">',
      '<div class="sy-panel-head">',
      '<span class="sy-panel-t">{{cur.t}}</span>',
      '<button class="btn" @click="closePanel">✕ 收起</button>',
      '</div>',
      '<div class="ltabs">',
      '<button class="ltab sm" :class="{on: tab===\'theater\'}" @click="tab=\'theater\'">🎬 动画课堂</button>',
      '<button class="ltab sm" :class="{on: tab===\'quiz\'}" @click="tab=\'quiz\'">📝 同步练习</button>',
      '<button class="ltab sm" :class="{on: tab===\'method\'}" @click="tab=\'method\'">💡 学习方法</button>',
      '</div>',

      /* 剧场 */
      '<div v-show="tab===\'theater\'">',
      '<div class="sy-stage" ref="stage"></div>',
      '<div class="sy-tip" v-if="!playing">点上方「🎬 动画课堂」开始上课（本课自动配剧本+板书+演示动画）</div>',
      '</div>',

      /* 练习 */
      '<div v-show="tab===\'quiz\'">',
      '<div class="sy-quiz-head" v-if="q.length">',
      '<span>第 {{qi+1}}/{{q.length}} 题</span>',
      '<span class="sy-score">✔ {{right}} 错 {{wrong}}</span>',
      '<button class="btn sm" @click="speakQ($event)">🔊 读题</button>',
      '</div>',
      '<div class="sy-qstem" v-if="q.length" @click="speakQ($event)">{{q[qi].stem}}<span class="fx-hl"></span></div>',
      '<div class="opts" v-if="q.length && q[qi].opts">',
      '<div class="opt" v-for="(o, oi) in q[qi].opts" :key="oi" :class="optCls(oi)" @click="pickQ(oi)">',
      '<span class="opt-idx">{{"ABCD"[oi]}}</span>{{o}}',
      '</div>',
      '</div>',
      '<div class="sy-fb" :class="fb.ok ? \'ok\' : \'bad\'" v-if="fb">',
      '<div class="ex-fb-head">{{fb.ok ? "🎉 答对啦！" : "💪 再想想～ 正确答案：" + fb.ans}}</div>',
      '<div class="ex-fb-exp" v-if="fb.exp">{{fb.exp}}</div>',
      '<button class="btn ctr" @click="nextQ">{{qi < q.length-1 ? "下一题 ›" : "看成绩 🏁"}}</button>',
      '</div>',
      '<div class="sy-self" v-if="q.length && !q[qi].opts && !fb">',
      '<div class="sy-self-btns"><button class="btn" @click="reveal">👁 看答案</button></div>',
      '</div>',
      '<div class="sy-fb" v-if="q.length && !q[qi].opts && fb && !fb.scored">',
      '<div class="ex-fb-head">✅ 答案：{{fb.ans}}</div>',
      '<div class="ex-fb-exp" v-if="fb.exp">{{fb.exp}}</div>',
      '<div class="sy-self-btns"><button class="btn" @click="selfJudge(true)">😆 我做对了</button><button class="btn" @click="selfJudge(false)">😅 做错了</button></div>',
      '</div>',
      '<div class="sy-result" v-if="done">🏁 完成！答对 {{right}}/{{q.length}} —— {{scoreTip}} <button class="btn sm" @click="startQuiz">↺ 再练一轮</button></div>',
      '<div class="sy-tip" v-if="!q.length">题库加载中或本题库暂无题…</div>',
      '</div>',

      /* 方法 */
      '<div v-show="tab===\'method\'" class="sy-methods">',
      '<div class="card lpanel sy-mcard"><div class="sy-mtitle">本课学习法</div>',
      '<div class="sy-mrow" v-for="(m, mi) in cur.method" :key="mi"><b>💡</b><span>{{m}}</span></div></div>',
      '<div class="card lpanel sy-mcard"><div class="sy-mtitle">{{subjObj.t}}通用方法</div>',
      '<div class="sy-mrow" v-for="m in M[subj]" :key="m[0]"><b>{{m[0]}}</b><span>{{m[1]}}</span></div></div>',
      '<div class="card lpanel sy-mcard"><div class="sy-mtitle">通用好习惯</div>',
      '<div class="sy-mrow" v-for="m in M.common" :key="m[0]"><b>{{m[0]}}</b><span>{{m[1]}}</span></div></div>',
      '</div>',

      '</div>',
      '</div>',
      '</site-shell>'
    ].join("\n"),
    data: function () {
      return {
        M: METHODS,
        showMethods: false,
        subj: "chinese",
        subjects: [
          { k: "chinese", i: "📖", t: "语文" },
          { k: "math", i: "🔢", t: "数学" },
          { k: "english", i: "🔤", t: "英语" }
        ],
        grade: "g1",
        grades: [
          { k: "g1", t: "一年级" }, { k: "g2", t: "二年级" }, { k: "g3", t: "三年级" },
          { k: "g4", t: "四年级" }, { k: "g5", t: "五年级" }, { k: "g6", t: "六年级" }
        ],
        sem: "s1",
        openIdx: -1,
        tab: "theater",
        playing: false,
        q: [], qi: 0, right: 0, wrong: 0, fb: null, done: false,
        picked: null
      };
    },
    computed: {
      subjObj: function () {
        var self = this;
        return this.subjects.filter(function (s) { return s.k === self.subj; })[0] || {};
      },
      gradeObj: function () {
        var self = this;
        return this.grades.filter(function (g) { return g.k === self.grade; })[0] || {};
      },
      units: function () {
        var S = App.SYLLABUS || {};
        var list = ((S[this.subj] || {})[this.grade] || {})[this.sem] || [];
        return list.map(function (u, i) {
          return {
            id: u.id, t: u.t, k: u.k, words: u.words, steps: u.steps, demo: u.demo,
            method: u.method || [], examKey: u.examKey, kws: u.kws || [], _i: i,
            kLabel: KT_LABEL[u.k] || u.k, cls: KT_CLS[u.k] || ""
          };
        });
      },
      totalUnits: function () {
        var S = App.SYLLABUS || {}, n = 0;
        Object.keys(S).forEach(function (sub) {
          Object.keys(S[sub] || {}).forEach(function (g) {
            Object.keys(S[sub][g] || {}).forEach(function (sem) {
              n += (S[sub][g][sem] || []).length;
            });
          });
        });
        return n;
      },
      cur: function () { return this.openIdx >= 0 ? this.units[this.openIdx] : null; },
      scoreTip: function () {
        var r = this.right, n = this.q.length || 1;
        if (r === n) return "满分！你太棒啦🎉";
        if (r >= n * 0.8) return "很棒！错题再看一遍讲解～";
        if (r >= n * 0.6) return "不错哦，把错题记到错题本！";
        return "别灰心，回动画课堂再学一遍，然后重练！";
      },
      methodGroups: function () {
        var self = this;
        return [
          { t: "📖 语文", list: METHODS.chinese },
          { t: "🔢 数学", list: METHODS.math },
          { t: "🔤 英语", list: METHODS.english },
          { t: "⏰ 通用习惯", list: METHODS.common }
        ].map(function (g) {
          return { t: g.t, list: g.list.filter(function (m) { return self.subj === "chinese" || g.t.indexOf("通用") >= 0 || true; }) };
        });
      }
    },
    methods: {
      pickSubj: function (k) {
        this.subj = k;
        this.closePanel();
        if (Speech && Speech.speak) Speech.speak(k === "chinese" ? "语文" : k === "math" ? "数学" : "英语" + "同步课堂", {});
      },
      openUnit: function (i) {
        var self = this;
        if (this.openIdx === i) { this.closePanel(); return; }
        this.closePanel();
        this.openIdx = i;
        this.tab = "theater";
        this.playTheater(); /* ★直接启动(tab 本就是 theater, watch 不会触发) */
        this.$nextTick(function () {
          if (Speech && Speech.speak) Speech.speak("打开课程：" + self.cur.t, {});
        });
      },
      closePanel: function () {
        this.teardownCr();
        this.openIdx = -1;
        this.playing = false;
        this.q = []; this.qi = 0; this.right = 0; this.wrong = 0; this.fb = null; this.done = false;
      },
      teardownCr: function () { if (this._cr) { try { this._cr.destroy(); } catch (e) { } this._cr = null; } },

      /* ---------- 剧场(3.0: 多场景+5角色+分角嗓音+音画同步) ---------- */
      playTheater: function () {
        var self = this;
        if (!App.Classroom || !this.cur) return;
        this.teardownCr();
        this.$nextTick(function () {
          var host = self.$refs.stage;
          host = Array.isArray(host) ? host[0] : host;
          if (!host) return;
          var script = App.Classroom.toScript(self.cur, { demoFor: function (course, i, txt) { return self.demoFor(course, i, txt); } });
          self._cr = App.Classroom.mount(host, script, { course: self.cur, doneTip: "🎓 课堂结束！做做同步练习吧" });
          self.playing = true;
        });
      },

      /* ---------- 课型 → 演示动画(19 种映射) ---------- */
      demoFor: function (course, i, txt) {
        var k = course.k || "", words = (course.words || []).join(""), t = course.t || "";
        var P = (App.Classroom && App.Classroom.PICT) || {}, ST = (App.Classroom && App.Classroom.STROKES) || {};
        var pictChars = (words + t).split("").filter(function (c) { return P[c]; });
        pictChars = pictChars.filter(function (c, ix) { return pictChars.indexOf(c) === ix; }).slice(0, 4);
        var strokeChar = (words + t).split("").filter(function (c) { return ST[c]; })[0];
        var m = String(txt).match(/(\d+)\s*([+\-×÷*])\s*(\d+)/);
        /* 1) 识字课: 象形字演变(第1步) + 笔顺描红(第3步) */
        if (k === "shizi") {
          if (i === 0 && pictChars.length) {
            return { kind: "xiang", chars: pictChars, title: "象形字魔法：字是从画变来的", tip: "看！图画 → 线条 → 汉字，就是这么变出来的" };
          }
          if (i === 2 && strokeChar) {
            return { kind: "stroke", char: strokeChar, title: "笔顺魔法：一笔一画写好「" + strokeChar + "」" };
          }
          if (course.demo) { course.demo.title = course.demo.title || "生字宝宝「" + (course.demo.char || "") + "」"; return course.demo; }
        }
        /* 2) 古诗: 诗句逐行浮现画面 */
        if (k === "gushi" || /《.*》/.test(t)) {
          var lines = (course.words && course.words.length > 1) ? course.words.slice(0, 4) : [t];
          return { kind: "poem", lines: lines, title: t, zh: "跟着画面背古诗，一句一句来" };
        }
        /* 3) 拼音: 声母+韵母拼读 */
        if (k === "pinyin" && course.demo) { course.demo.title = course.demo.title || "拼音魔法屋"; return course.demo; }
        /* 4) 数学计算: 算式画图 */
        if (m) {
          var op = m[2] === "+" ? "add" : m[2] === "-" ? "sub" : (m[2] === "×" || m[2] === "*") ? "mul" : "div";
          return { kind: "math", op: op, a: +m[1], b: +m[3], title: "画图解题" };
        }
        if (course.demo && (course.demo.kind === "math" || course.demo.kind === "clock" || course.demo.kind === "money" || course.demo.kind === "shape" || course.demo.kind === "chart")) {
          course.demo.title = course.demo.title || "数学演示"; return course.demo;
        }
        /* 5) 英语单词/拼读 */
        if (k === "words" || k === "phonics") {
          var en = (course.words || []).filter(function (w) { return /^[a-zA-Z]/.test(w); })[0] || "";
          if (en) {
            var zhMap = (course.words || []).filter(function (w) { return !/^[a-zA-Z0-9\s.'?]/.test(w); })[0] || "";
            return { kind: i % 2 ? "abc" : "phonics", word: en, letters: en.split(""), zh: zhMap, title: "单词魔法: " + en, pic: "🔤" };
          }
        }
        /* 6) 英语句型: 情景对话 */
        if (k === "sent") {
          return { kind: "dialog", lines: [["Sam", "Hello! " + (course.words || ["Hi!"])[0]], ["Amy", "Hi! Nice to meet you!"]], title: "情景小剧场", zh: "和同学分角色读一读吧" };
        }
        /* 7) 单元自带 demo(旧 9 种引擎 3.0 全兼容) */
        if (course.demo) { course.demo.title = course.demo.title || "课堂演示"; return course.demo; }
        /* 8) 兜底: 关键词卡片 */
        var kws = (course.kws && course.kws.length ? course.kws : (course.words || [])).slice(0, 4).map(function (w) { return [w, "本课关键词"]; });
        if (kws.length) return { kind: "cards", items: kws, title: "关键词卡片" };
        return { kind: "stars", title: "继续加油" };
      },

      /* ---------- 抽题 ---------- */
      startQuiz: function () {
        var self = this;
        var lib = (App.DATA && App.DATA.exam && App.DATA.exam[this.cur.examKey]) || null;
        var qs = lib && lib.qs ? lib.qs.slice() : [];
        var pool = [];
        var kws = this.cur.kws.filter(function (k) { return k && k.length >= 2; });
        if (kws.length) {
          pool = qs.filter(function (q) {
            var s = q.s || "";
            return kws.some(function (k) { return s.indexOf(k) >= 0; });
          });
        }
        /* 优先抽"有选项"的题(即答即判体验最好), 无选项题(写字/填空)放最后 */
        var withOpts = pool.filter(function (q) {
          return q.t === "single" || q.t === "judge" || q.t === "multiple";
        });
        var pick = this.shuffled(withOpts).slice(0, 4);
        var noOpts = pool.filter(function (q) { return pick.indexOf(q) < 0; });
        pick = pick.concat(this.shuffled(noOpts).slice(0, 1));
        if (pick.length < 5) {
          var rest = qs.filter(function (q) { return pick.indexOf(q) < 0; });
          pick = pick.concat(this.shuffled(rest).slice(0, 5 - pick.length));
        }
        this.q = pick.slice(0, 5).map(function (q) { return self.normQ(q); });
        this.qi = 0; this.right = 0; this.wrong = 0; this.fb = null; this.done = false; this.picked = null;
        if (!this.q.length) return;
        this.$nextTick(function () { self.speakQ(); });
      },
      normQ: function (q) {
        var opts = null, ci = -1, ans = "";
        if (q.o && Array.isArray(q.o) && q.o.length && typeof q.o[0] === "string") {
          opts = q.o;
          if (typeof q.a === "number") ci = q.a;
          else { ci = q.o.indexOf(q.a); }
          ans = ci >= 0 ? q.o[ci] : String(q.a);
        } else if (q.t === "judge") {
          opts = ["正确", "错误"];
          if (typeof q.a === "number") ci = q.a;
          else ci = q.o ? q.o.indexOf(q.a) : opts.indexOf(q.a);
          ans = opts[ci] || String(q.a);
        } else {
          ans = q.a !== undefined && q.a !== null ? String(q.a) : "";
          if (typeof q.a === "object" && q.a) ans = JSON.stringify(q.a);
        }
        var stem = q.s || "";
        if (ReadQ && ReadQ.stem) { try { stem = ReadQ.stem(q) || stem; } catch (e) { } }
        return { stem: stem, opts: opts, ci: ci, ans: ans, exp: q.x || "", t: q.t };
      },
      shuffled: function (a) { var r = a.slice(); for (var i = r.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = r[i]; r[i] = r[j]; r[j] = t; } return r; },

      optCls: function (oi) {
        if (!this.fb) { return this.picked === oi ? "opt on" : "opt"; }
        if (oi === this.q[this.qi].ci) return "opt right";
        if (oi === this.picked && oi !== this.q[this.qi].ci) return "opt wrong";
        return "opt dim";
      },
      pickQ: function (oi) {
        if (this.fb) return;
        this.picked = oi;
        var q = this.q[this.qi];
        var ok = oi === q.ci;
        this.fb = { ok: ok, ans: q.ans, exp: q.exp || (ok ? "完全正确，继续保持！" : "正确答案是「" + q.ans + "」") };
        if (ok) { this.right++; if (U && U.confetti) { try { U.confetti(); } catch (e) { } } }
        else this.wrong++;
        if (Speech && Speech.speak) Speech.speak(ok ? "答对啦！" : "答错了，正确答案是" + q.ans, {});
      },
      reveal: function () {
        var q = this.q[this.qi];
        this.fb = { ok: null, ans: q.ans, exp: q.exp || "" };
      },
      selfJudge: function (ok) {
        if (ok) { this.right++; if (U && U.confetti) { try { U.confetti(); } catch (e) { } } }
        else this.wrong++;
        this.fb = { ok: ok, ans: this.q[this.qi].ans, exp: this.q[this.qi].exp, scored: true };
        if (Speech && Speech.speak) Speech.speak(ok ? "真棒！" : "没关系，记住这道题", {});
      },
      nextQ: function () {
        if (this.qi < this.q.length - 1) {
          var self = this;
          this.qi++; this.fb = null; this.picked = null;
          this.$nextTick(function () { self.speakQ(); });
        } else {
          this.done = true;
          this.fb = null;
        }
      },
      speakQ: function (ev) {
        if (!this.q.length) return;
        var q = this.q[this.qi];
        var txt = q.stem || "";
        if (q.opts) txt += "。选项：" + q.opts.map(function (o, i) { return "ABCD"[i] + "、" + o; }).join("，");
        if (Speech && Speech.speak) Speech.speak(txt, { el: ev && (ev.currentTarget || ev.target) });
      },

      /* 切 tab 时懒启动剧场/练习 */
      onTab: function (t) {
        this.tab = t;
        var self = this;
        if (t === "theater") this.$nextTick(function () { if (!self._cr && self.playing === false) self.playTheater(); });
        if (t === "quiz" && !this.q.length) this.startQuiz();
      }
    },
    watch: {
      tab: function (t) {
        var self = this;
        if (t === "theater" && !this._cr) this.$nextTick(function () { self.playTheater(); });
        if (t === "quiz" && !this.q.length) this.startQuiz();
      }
    },
    beforeUnmount: function () { this.teardownCr(); }
  };
})(window);
