/*
 * exam-center-view.js — 视图层 / 试卷中心
 * 1080 套小学试卷（语数英 1-6 年级）：筛选 → 答题 → 批改 → 成绩。
 * 题型渲染：单选/多选/判断/填空/计算/排序/连线/简答/完形/看拼音写词。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  App.views = App.views || {};
  if (!w.Vue) return;

  var E = App.Exam;
  var U = App.Utils;

  /* 工具：把 cloze 题干按 ___{n} 占位拆成段 */
  function clozeParts(stem) {
    var s = String(stem || "");
    var m = s.match(/___\{\d+\}/);
    if (!m) return { pre: s, post: "" };
    var i = s.indexOf(m[0]);
    return { pre: s.slice(0, i), post: s.slice(i + m[0].length) };
  }
  function shuffledArr(a) { return U.shuffled(a.slice()); }

  App.views.examCenter = {
    name: "exam-center",
    data: function () {
      return {
        view: "list",            // list | do | result
        grade: 1,
        subject: "chinese",
        type: "",
        kw: "",
        pageNo: 1,
        grades: [1, 2, 3, 4, 5, 6],
        subjects: [
          { k: "chinese", t: "📖 语文" }, { k: "math", t: "🧮 数学" }, { k: "english", t: "🔤 英语" }
        ],
        types: [
          { k: "", t: "全部" }, { k: "unit", t: "📘 单元" }, { k: "mid", t: "📗 期中" },
          { k: "final", t: "📕 期末" }, { k: "kp", t: "🎯 专项" }, { k: "review", t: "🔄 综合" },
          { k: "hard", t: "🚀 提升" }, { k: "wrong", t: "⚠️ 易错" }, { k: "speed", t: "⏱️ 限时" }
        ],
        // 答题状态
        paper: null, qs: [], idx: 0,
        answers: {},               // 题下标 -> 用户答案
        sortOrder: {},             // 题下标 -> 选项索引顺序
        pairSel: {},               // 题下标 -> 当前选中的左项
        pairMap: {},               // 题下标 -> {左idx: 右值}
        rightOrder: {},            // 题下标 -> 右列顺序（固定）
        submitted: false,
        result: null,              // {score, total, detail:[{q, ok, ans}]}
        st: App.Store.state
      };
    },
    computed: {
      st_stats: function () { return E.stats(); },
      filtered: function () {
        return E.list({ grade: this.grade, subject: this.subject, type: this.type, kw: this.kw });
      },
      paged: function () { return E.page(this.filtered, this.pageNo, 12); },
      cur: function () { return this.qs[this.idx] || null; },
      curTypeName: function () { return this.cur ? (E.QTYPE_NAME[this.cur.t] || "题目") : ""; },
      progress: function () { return this.qs.length ? Math.round((this.idx + 1) / this.qs.length * 100) : 0; },
      answeredCount: function () {
        var n = 0, i;
        for (i = 0; i < this.qs.length; i++) { if (this.isAnswered(i)) n++; }
        return n;
      },
      curRightList: function () {
        var q = this.cur, i;
        if (!q || q.t !== "matching" || !q.o || !q.o.right) return [];
        var key = this.idx;
        if (!this.rightOrder[key]) {
          this.rightOrder[key] = shuffledArr(q.o.right);
        }
        return this.rightOrder[key];
      },
      curSortList: function () {
        var q = this.cur, i;
        if (!q || q.t !== "sorting" || !q.o) return [];
        var key = this.idx;
        if (!this.sortOrder[key]) {
          var idxs = [], j;
          for (j = 0; j < q.o.length; j++) idxs.push(j);
          this.sortOrder[key] = shuffledArr(idxs);
        }
        return this.sortOrder[key];
      }
    },
    watch: {
      grade: function () { this.pageNo = 1; },
      subject: function () { this.pageNo = 1; },
      type: function () { this.pageNo = 1; },
      kw: function () { this.pageNo = 1; }
    },
    mounted: function () {
      if (App.Speech) App.Speech.autoRead("试卷中心，一千零八十套试卷，按年级选一份开始做题吧！");
    },
    methods: {
      /* ---------- 列表 ---------- */
      typeName: function (ty) { return E.TYPE_NAME[ty] || ty; },
      typeIcon: function (ty) { return E.TYPE_ICON[ty] || "📄"; },
      paperResult: function (id) { return E.results()[id] || null; },
      openPaper: function (p) {
        var qs = E.loadQuestions(p);
        if (!qs.length) { alert("这份试卷的题目还没下载好，请刷新再试"); return; }
        this.paper = p;
        this.qs = qs;
        this.idx = 0;
        this.answers = {};
        this.sortOrder = {};
        this.pairSel = {};
        this.pairMap = {};
        this.rightOrder = {};
        this.submitted = false;
        this.result = null;
        this.view = "do";
        this.readCur();
      },
      back: function () { this.view = "list"; this.paper = null; },
      paperTi: function () { return this.paper ? this.paper.ti : ""; },
      rScore: function () { return this.result ? this.result.score : 0; },
      rTotal: function () { return this.result ? this.result.total : 0; },
      rCls: function () {
        if (!this.result || !this.result.total) return "";
        var r = this.result.score / this.result.total;
        return { good: r >= 0.9, mid: r >= 0.6 && r < 0.9 };
      },
      rText: function () {
        if (!this.result) return "";
        var r = this.result.total ? this.result.score / this.result.total : 0;
        return this.result.score === this.result.total ? "满分！太厉害了！" : (r >= 0.6 ? "不错，再检查一下错题" : "加油，多练几遍");
      },
      goPage: function (n) {
        var t = this.paged.total;
        this.pageNo = Math.min(Math.max(1, n), t);
      },

      /* ---------- 答题 ---------- */
      // force=1（点「🔊读题」按钮）时强制念；切题自动念时尊重「自动朗读」开关
      readCur: function (force) {
        var q = this.cur;
        if (!q || !App.Speech) return;
        if (!force && App.Store && App.Store.state && !App.Store.state.autoRead) return;
        var R = App.ReadQ;
        var list = [];
        if (R) {
          var st = R.stem(q);
          if (q.t === "pinyin_word" && q.o && q.o.words && q.o.words[0]) {
            st = "看拼音写词语：" + (q.o.words[0].pinyin || []).join(" ");
          }
          if (st) list.push({ t: st });
          var ot = R.optText(R.optsOf(q), false);
          if (ot) list.push({ t: ot });
          else if (q.t === "fill" || q.t === "calculation" || q.t === "short_answer") list.push({ t: "请写出答案。" });
          else if (q.t === "cloze") list.push({ t: "请把空填上。" });
          else if (q.t === "judge") list.push({ t: "请判断对错。" });
        } else {
          var txt = q.s;
          if (q.t === "single" || q.t === "multiple") txt += "。" + (q.o || []).join("，");
          else if (q.t === "judge") txt += "。请判断对错。";
          else if (q.t === "fill" || q.t === "calculation") txt += "。请写出答案。";
          else if (q.t === "sorting") txt += "。" + (q.o || []).join("，");
          else if (q.t === "matching") txt += "。" + (q.o && q.o.left || []).join("，");
          else if (q.t === "pinyin_word" && q.o && q.o.words) txt = "看拼音写词语：" + (q.o.words[0] && q.o.words[0].pinyin || []).join(" ");
          list.push({ t: txt });
        }
        if (list.length) App.Speech.seq(list);
      },
      isAnswered: function (i) {
        var q = this.qs[i];
        if (!q) return false;
        var a = this.answers[i];
        if (q.t === "sorting") return !!this.sortOrder[i];
        if (q.t === "matching") {
          var m = this.pairMap[i] || {};
          return Object.keys(m).length >= (q.o && q.o.left ? q.o.left.length : 0);
        }
        if (q.t === "multiple") return Array.isArray(a) && a.length > 0;
        return a !== undefined && a !== null && a !== "";
      },
      pick: function (i, opt) {
        if (this.submitted) return;
        var q = this.cur;
        if (q.t === "multiple") {
          var arr = (this.answers[this.idx] || []).slice();
          var at = arr.indexOf(opt);
          if (at >= 0) arr.splice(at, 1); else arr.push(opt);
          arr.sort();
          this.answers[this.idx] = arr;
        } else {
          this.answers[this.idx] = opt;
        }
        if (App.Speech && App.Speech.sfx) App.Speech.sfx.pop();
      },
      pickedCls: function (i, opt) {
        var q = this.cur;
        if (!q) return "";
        var a = this.answers[this.idx];
        if (q.t === "multiple") {
          return (Array.isArray(a) && a.indexOf(opt) >= 0) ? "opt on" : "opt";
        }
        return a === opt ? "opt on" : "opt";
      },
      /* 排序：点两次交换 */
      sortClick: function (pos) {
        if (this.submitted) return;
        var key = this.idx;
        var so = (this.sortOrder[key] || []).slice();
        var sel = this.pairSel["sort" + key];
        if (sel === undefined || sel === null) {
          this.pairSel["sort" + key] = pos;
        } else if (sel === pos) {
          this.pairSel["sort" + key] = null;
        } else {
          var tmp = so[sel]; so[sel] = so[pos]; so[pos] = tmp;
          this.sortOrder[key] = so;
          this.pairSel["sort" + key] = null;
        }
        if (App.Speech && App.Speech.sfx) App.Speech.sfx.pop();
      },
      sortSel: function (pos) {
        return this.pairSel["sort" + this.idx] === pos;
      },
      sortItemText: function (pos) {
        var q = this.cur;
        if (!q || !q.o) return "";
        var so = this.sortOrder[this.idx] || [];
        return q.o[so[pos]] || "";
      },
      /* 连线：先点左，再点右 */
      pairClickLeft: function (li) {
        if (this.submitted) return;
        this.pairSel[this.idx] = li;
      },
      pairClickRight: function (rv) {
        if (this.submitted) return;
        var key = this.idx;
        var li = this.pairSel[key];
        if (li === undefined || li === null) return;
        if (!this.pairMap[key]) this.pairMap[key] = {};
        this.pairMap[key][li] = rv;
        this.pairSel[key] = null;
        if (App.Speech && App.Speech.sfx) App.Speech.sfx.pop();
      },
      pairLeftCls: function (li) {
        var m = this.pairMap[this.idx] || {};
        return m[li] !== undefined ? "ml-item on" : (this.pairSel[this.idx] === li ? "ml-item sel" : "ml-item");
      },
      pairRightCls: function (rv) {
        var m = this.pairMap[this.idx] || {}, k;
        for (k in m) { if (m[k] === rv) return "mr-item on"; }
        return "mr-item";
      },
      pairPairedText: function (li) {
        var m = this.pairMap[this.idx] || {};
        return m[li] !== undefined ? m[li] : "";
      },
      /* 填答 input */
      setAns: function (v) { this.answers[this.idx] = v; },
      ansText: function () {
        var a = this.answers[this.idx];
        return a === undefined || a === null ? "" : String(a);
      },
      clozePre: function () { return clozeParts(this.cur ? this.cur.s : "").pre; },
      clozePost: function () { return clozeParts(this.cur ? this.cur.s : "").post; },
      pyPinyin: function () {
        var q = this.cur;
        if (q && q.o && q.o.words && q.o.words[0]) return q.o.words[0].pinyin.join(" ");
        return "";
      },
      prev: function () { if (this.idx > 0) { this.idx--; this.readCur(); } },
      next: function () {
        if (this.idx < this.qs.length - 1) { this.idx++; this.readCur(); }
      },
      jump: function (i) { this.idx = i; this.readCur(); },

      /* ---------- 交卷批改 ---------- */
      submit: function () {
        var i, q, ans, ok, detail = [], score = 0, total = 0;
        for (i = 0; i < this.qs.length; i++) {
          q = this.qs[i];
          if (q.t === "sorting") ans = this.sortOrder[i] ? this.sortOrder[i].map(function (p) { return q.o[p]; }) : null;
          else if (q.t === "matching") ans = this.pairMap[i] || null;
          else ans = this.answers[i];
          ok = E.judge(q, ans);
          total++;
          if (ok) score++;
          detail.push({ q: q, ok: ok, ans: ans });
        }
        this.result = { score: score, total: total, detail: detail };
        this.submitted = true;
        this.view = "result";
        E.saveResult(this.paper.id, score, total);
        if (App.Speech) {
          App.Speech.speak("试卷完成，你得了" + score + "分，满分" + total + "分。" + (score === total ? "太棒了，全部正确！" : "加油，看看错在哪里。"));
        }
        if (App.Store && App.Store.addStars) App.Store.addStars(score * 2);
      },
      /* 结果页 */
      resultDetail: function () { return this.result ? this.result.detail : []; },
      ansTextOf: function (d) {
        var a = d.ans;
        if (a === null || a === undefined) return "（未作答）";
        if (Array.isArray(a)) return a.join("、");
        if (typeof a === "object") {
          var out = [], k;
          for (k in a) { out.push(k + "→" + a[k]); }
          return out.join("，");
        }
        return String(a);
      },
      rightText: function (d) {
        var a = d.q.a;
        if (a === null || a === undefined) return "";
        if (Array.isArray(a)) return String(a[0]).split("|").join(" 或 ");
        if (typeof a === "object") {
          var out = [], k;
          for (k in a) { out.push(k + "→" + a[k]); }
          return out.join("，");
        }
        return String(a);
      },
      readWrong: function () {
        if (!App.Speech || !this.result) return;
        var list = this.result.detail.filter(function (d) { return !d.ok; });
        if (!list.length) { App.Speech.speak("全部正确，没有错题"); return; }
        App.Speech.seq(list.map(function (d) {
          return { t: d.q.s + "。正确答案是：" + (d.q.t === "single" || d.q.t === "multiple" ? (d.q.o[d.q.a] || "") : (Array.isArray(d.q.a) ? String(d.q.a[0]).split("|")[0] : d.q.a)) };
        }));
      }
    },
    template: [
      '<site-shell :title="\'试卷中心\'" sub="1080 套试卷 · 语数英 1-6 年级" icon="📝">',

      /* ===== 列表 ===== */
      '<div v-show="view === \'list\'">',
      '<div class="ex-stats">',
      '<span>📄 试卷 <b>{{st_stats.papers}}</b> 套</span>',
      '<span>📚 题目 <b>{{st_stats.questions}}</b> 道</span>',
      '<span>🎯 覆盖 1-6 年级 · 语数英</span>',
      '</div>',

      '<div class="ex-filters">',
      '<div class="ex-row"><span class="ex-lab">年级</span>',
      '<span class="ex-chip" v-for="g in grades" :key="g" :class="{on: grade === g}" @click="grade = g">{{g}} 年级</span></div>',
      '<div class="ex-row"><span class="ex-lab">学科</span>',
      '<span class="ex-chip" v-for="s in subjects" :key="s.k" :class="{on: subject === s.k}" @click="subject = s.k">{{s.t}}</span></div>',
      '<div class="ex-row"><span class="ex-lab">类型</span>',
      '<span class="ex-chip" v-for="t in types" :key="t.k" :class="{on: type === t.k}" @click="type = t.k">{{t.t}}</span></div>',
      '<div class="ex-row"><span class="ex-lab">搜索</span>',
      '<input class="ex-search" v-model="kw" placeholder="输入关键词，如：期末 / 拼音 / 计算"></div>',
      '</div>',

      '<div class="ex-count">共 <b>{{filtered.length}}</b> 套（第 {{paged.no}}/{{paged.total}} 页）</div>',
      '<div class="ex-grid">',
      '<div class="ex-card" v-for="p in paged.items" :key="p.id" @click="openPaper(p)">',
      '<div class="ex-card-t">{{typeIcon(p.ty)}} {{p.ti}}</div>',
      '<div class="ex-card-m">{{typeName(p.ty)}} · {{p.n}} 题 · {{p.du}} 分钟</div>',
      '<div class="ex-card-r" v-if="paperResult(p.id)">',
      '<span class="ex-score" :class="{good: paperResult(p.id).best >= p.n * 0.9}">最好 {{paperResult(p.id).best}}/{{p.n}}</span>',
      '<span class="ex-times">做过 {{paperResult(p.id).times}} 次</span>',
      '</div>',
      '<div class="ex-card-r" v-else><span class="ex-new">未做过</span></div>',
      '</div>',
      '</div>',
      '<div class="ex-pager" v-if="paged.total > 1">',
      '<button class="btn" @click="goPage(paged.no - 1)" :disabled="paged.no <= 1">‹ 上一页</button>',
      '<span class="ex-pageno">{{paged.no}} / {{paged.total}}</span>',
      '<button class="btn" @click="goPage(paged.no + 1)" :disabled="paged.no >= paged.total">下一页 ›</button>',
      '</div>',
      '</div>',

      /* ===== 答题 ===== */
      '<div v-show="view === \'do\' && paper">',
      '<div class="ex-dohead">',
      '<button class="btn" @click="back">‹ 退出</button>',
      '<span class="ex-dotitle">{{paperTi()}}</span>',
      '<span class="ex-doprogress">第 {{idx+1}}/{{qs.length}} 题 · 已答 {{answeredCount}}</span>',
      '</div>',
      '<div class="ex-progress"><i :style="{width: progress + \'%\'}"></i></div>',

      '<div class="card ex-qcard">',
      '<div class="ex-qmeta"><span class="ex-qno">第 {{idx+1}} 题</span>',
      '<span class="ex-qtype">{{curTypeName}}</span>',
      '<button class="btn spk" @click="readCur(1)">🔊 读题</button></div>',

      /* 题干 */
      '<div class="ex-qtext" v-if="cur && cur.t !== \'cloze\' && cur.t !== \'pinyin_word\'">{{cur.s}}</div>',
      '<div class="ex-qtext" v-if="cur && cur.t === \'cloze\'"><span>{{clozePre()}}</span><input class="ex-blank" v-model="answers[idx]"><span>{{clozePost()}}</span></div>',
      '<div class="ex-qtext ex-py" v-if="cur && cur.t === \'pinyin_word\'"><span class="ex-py-pinyin">{{pyPinyin()}}</span><input class="ex-blank" v-model="answers[idx]" placeholder="写出词语"></div>',

      /* 选择类 */
      '<div class="opts" v-if="cur && (cur.t === \'single\' || cur.t === \'judge\' || cur.t === \'multiple\')">',
      '<div v-for="(o, i) in cur.o" :key="i" :class="pickedCls(i, o)" @click="pick(i, o)">',
      '<em class="opt-idx">{{["A","B","C","D","E","F"][i]}}</em>{{o}}',
      '<span class="opt-mark" v-if="cur.t === \'multiple\' && Array.isArray(answers[idx]) && answers[idx].indexOf(o) >= 0">✓</span>',
      '</div>',
      '</div>',

      /* 填空/计算/简答 */
      '<div class="ex-input-wrap" v-if="cur && (cur.t === \'fill\' || cur.t === \'calculation\' || cur.t === \'short_answer\')">',
      '<input class="ex-input" :value="ansText()" @input="setAns($event.target.value)" :placeholder="cur.t === \'calculation\' ? \'写出得数\' : \'写出答案\'">',
      '</div>',

      /* 排序 */
      '<div class="ex-sort" v-if="cur && cur.t === \'sorting\'">',
      '<div class="ex-sort-tip">💡 先点一个，再点另一个，可以交换位置</div>',
      '<div class="ex-sort-item" v-for="(oi, pos) in curSortList" :key="pos" :class="{sel: sortSel(pos)}" @click="sortClick(pos)">',
      '<em>{{pos + 1}}</em><span>{{sortItemText(pos)}}</span></div>',
      '</div>',

      /* 连线 */
      '<div class="ex-match" v-if="cur && cur.t === \'matching\'">',
      '<div class="ex-sort-tip">💡 先点左边，再点右边配对</div>',
      '<div class="ex-match-cols">',
      '<div class="ex-match-col">',
      '<div v-for="(l, li) in cur.o.left" :key="li" :class="pairLeftCls(li)" @click="pairClickLeft(li)">{{l}}</div>',
      '</div>',
      '<div class="ex-match-col">',
      '<div v-for="(r, ri) in curRightList" :key="ri" :class="pairRightCls(r)" @click="pairClickRight(r)">{{r}}</div>',
      '</div>',
      '</div>',
      '<div class="ex-match-now" v-if="pairSel[idx] !== undefined && pairSel[idx] !== null">已选左边「{{cur.o.left[pairSel[idx]]}}」，请点右边</div>',
      '</div>',

      /* 导航 */
      '<div class="ex-nav">',
      '<button class="btn" @click="prev" :disabled="idx <= 0">‹ 上一题</button>',
      '<div class="ex-dots">',
      '<span v-for="(q, i) in qs" :key="i" :class="{on: i === idx, done: isAnswered(i)}" @click="jump(i)">{{i + 1}}</span>',
      '</div>',
      '<button class="btn next" v-if="idx < qs.length - 1" @click="next">下一题 ›</button>',
      '<button class="btn submit" v-else @click="submit">✔ 交卷</button>',
      '</div>',
      '</div>',
      '</div>',

      /* ===== 结果 ===== */
      '<div v-show="view === \'result\' && result">',
      '<div class="card ex-result">',
      '<div class="ex-rscore" :class="rCls()">',
      '{{rScore()}}<i>/{{rTotal()}}</i></div>',
      '<div class="ex-rtext">{{rText()}}</div>',
      '<div class="ctr">',
      '<button class="btn spk" @click="readWrong">🔊 听错题讲解</button>',
      '<button class="btn" @click="back">📄 再选一套</button>',
      '<button class="btn next" @click="openPaper(paper)">🔁 重做一遍</button>',
      '</div>',
      '</div>',
      '<div class="ex-wrong-list">',
      '<div class="ex-wcard" v-for="(d, i) in resultDetail()" :key="i" :class="{bad: !d.ok}">',
      '<div class="ex-whead"><span class="ex-qno">第 {{i+1}} 题</span><span class="ex-wverdict">{{d.ok ? "✔ 正确" : "✘ 错误"}}</span></div>',
      '<div class="ex-wq">{{d.q.s}}</div>',
      '<div class="ex-wans"><span>你的答案：{{ansTextOf(d)}}</span><span v-if="!d.ok">正确答案：{{rightText(d)}}</span></div>',
      '<div class="ex-wsol" v-if="d.q.x">💡 {{d.q.x}}</div>',
      '</div>',
      '</div>',
      '</div>',

      '</site-shell>'
    ].join("")
  };
})(window);
