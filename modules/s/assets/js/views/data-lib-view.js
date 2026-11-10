/*
 * data-lib-view.js — 视图层 / 数据宝库（数据引擎的调用示范）
 * 数据全部来自 assets/js/data/** 的 JSON 文件（分文件/分科目/分页），这里只负责翻页、搜索、朗读。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var Speech = App.Speech, U = App.U;

  App.views = App.views || {};
  App.views.dataLib = {
    template: [
      '<site-shell title="数据宝库" sub="常用字 · 词语 · 乘法口诀 · 单位换算 · 英语单词，分类分页查" icon="📚">',
      '<div class="card dlp">',
      '<div class="dl-stats">',
      '<span class="dl-stat"><b>{{st.hanzi}}</b> 常用字</span>',
      '<span class="dl-stat"><b>{{st.words}}</b> 常用词</span>',
      '<span class="dl-stat"><b>{{st.totalItems}}</b> 条数据</span>',
      '<span class="dl-stat"><b>{{st.sets.length}}</b> 个数据集</span>',
      '</div>',
      '<div class="ltabs">',
      '<button class="ltab" v-for="t in cats" :key="t.k" :class="{on: cat === t.k}" @click="switchCat(t.k)">{{t.t}}</button>',
      '</div>',
      '<div class="dl-sets">',
      '<button class="dl-set" v-for="s in sets" :key="s.cat + s.id" :class="{on: cur === s.cat + \'|\' + s.id}" @click="pickSet(s)">',
      '<span class="dl-ic">{{s.icon}}</span><span class="dl-nm">{{s.name}}</span><span class="dl-pg">{{s.pages}} 页</span>',
      '</button>',
      '</div>',
      '<div class="dl-bar">',
      '<input class="dl-search" v-model="kw" placeholder="搜一搜（中文/英文/拼音都可以）" @keyup.enter="doSearch">',
      '<button class="btn spk" @click="doSearch">🔍 搜索</button>',
      '<button class="btn" v-if="searched" @click="clearSearch">✕ 清除</button>',
      '</div>',
      '<div class="dl-pagebar" v-if="!searched">',
      '<button class="btn" :disabled="!pg.hasPrev" @click="go(pg.no - 1)">◀ 上一页</button>',
      '<span class="dl-pginfo">第 <b>{{pg.no}}</b> / {{pg.total}} 页 · {{curTitle}}</span>',
      '<button class="btn" :disabled="!pg.hasNext" @click="go(pg.no + 1)">▶ 下一页</button>',
      '</div>',
      '<div class="dl-jump" v-if="!searched && pg.total > 1">',
      '<span>跳到</span>',
      '<button class="dl-jp" v-for="n in jumpList" :key="n" :class="{on: n === pg.no}" @click="go(n)">{{n}}</button>',
      '</div>',
      '<div class="dl-items">',
      '<div class="dl-item" v-for="(it, i) in showItems" :key="i" @click="readItem(it)" v-html="itemHtml(it)"></div>',
      '</div>',
      '<div class="dl-empty" v-if="!showItems.length">没有找到相关内容，换个词试试～</div>',
      '<div class="hint">👆 点一条就能听：汉字读拼音、英语读原声；数据来自 data/ 目录的 JSON 文件，由数据引擎统一调用。</div>',
      '</div>',
      '</site-shell>'
    ].join(""),
    data: function () {
      return {
        cats: [{ k: "cn", t: "🀄 语文" }, { k: "math", t: "🧮 数学" }, { k: "english", t: "🔤 英语" }],
        cat: "cn",
        cur: "cn|hanzi",
        allSets: [],
        sets: [],
        no: 1,
        kw: "",
        searched: false,
        results: [],
        pg: { no: 1, total: 1, hasPrev: false, hasNext: false, items: [] },
        curTitle: "",
        st: { hanzi: 0, words: 0, totalItems: 0, sets: [] }
      };
    },
    computed: {
      showItems: function () {
        return this.searched ? this.results.map(function (r) { return r.item; }) : this.pg.items;
      },
      jumpList: function () {
        var out = [], i, t = this.pg.total;
        for (i = 1; i <= Math.min(t, 12); i++) out.push(i);
        if (t > 12) out.push(t);
        return out;
      }
    },
    mounted: function () {
      var self = this;
      this.allSets = App.Data.registry().map(function (s) {
        // dict（成语/古诗/蒙学）与 chinese（作文/方法）归到“语文”标签
        var cat = s.cat;
        if (cat === "dict" || cat === "chinese") cat = "cn";
        return { cat: cat, id: s.id, name: s.name, icon: s.icon, pages: s.pages, virtual: false };
      });
      // 语文两类（常用字/常用词）也放进集合列表
      this.allSets.unshift({ cat: "cn", id: "hanzi", name: "常用字拼音（3799）", icon: "🀄", pages: 38, virtual: true });
      this.allSets.unshift({ cat: "cn", id: "words", name: "常用词语（20000）", icon: "💬", pages: 200, virtual: true });
      this.st = App.Data.stats();
      this.switchCat("cn");
      Speech.autoRead("数据宝库，常用字、词语、成语、古诗、口诀、单位和单词，分类分页随便查！");
    },
    methods: {
      switchCat: function (k) {
        this.cat = k;
        this.sets = this.allSets.filter(function (s) { return s.cat === k; });
        var first = this.sets[0];
        if (first) this.pickSet(first);
      },
      pickSet: function (s) {
        this.cur = s.cat + "|" + s.id;
        this.no = 1;
        this.clearSearch();
        this.load();
      },
      load: function () {
        var parts = this.cur.split("|"), cat = parts[0], id = parts[1], pg;
        if (cat === "cn" && id === "hanzi") {
          pg = App.Data.hanziPage(this.no, 100);
          this.pg = pg; this.curTitle = "常用字第 " + pg.no + " 页";
        } else if (cat === "cn" && id === "words") {
          pg = App.Data.wordPage(this.no, 100);
          this.pg = pg; this.curTitle = "常用词第 " + pg.no + " 页";
        } else {
          pg = App.Data.page(cat, id, this.no);
          if (!pg) { this.pg = { no: 1, total: 1, hasPrev: false, hasNext: false, items: [] }; this.curTitle = ""; return; }
          this.pg = pg;
          this.curTitle = pg.page.title;
        }
      },
      go: function (n) {
        if (n < 1 || n > this.pg.total) return;
        this.no = n;
        this.load();
      },
      doSearch: function () {
        var kw = this.kw.trim();
        if (!kw) { this.clearSearch(); return; }
        var parts = this.cur.split("|"), cat = parts[0], id = parts[1], out = [];
        if (cat === "cn" && id === "hanzi") {
          var chars = App.HZ.commonChars();
          for (var i = 0; i < chars.length; i++) {
            if (chars[i] === kw || (App.HZ.py(chars[i]) || "").indexOf(kw) === 0) out.push({ ch: chars[i], py: App.HZ.py(chars[i]) });
          }
        } else if (cat === "cn" && id === "words") {
          var list = App.WORDS.list;
          for (var j = 0; j < list.length; j++) { if (list[j].indexOf(kw) === 0) out.push({ wd: list[j] }); }
        } else {
          out = App.Data.search(cat, id, kw).map(function (r) { return r.item; });
        }
        this.results = out;
        this.searched = true;
        if (out.length) Speech.speak("找到 " + out.length + " 条");
      },
      clearSearch: function () { this.kw = ""; this.searched = false; this.results = []; },
      itemHtml: function (it) {
        if (!it) return "";
        if (it.ch !== undefined) {
          return '<div class="dl-hz">' + it.ch + '<span class="dl-py">' + (it.py || "") + '</span></div>';
        }
        if (it.wd !== undefined) {
          return '<div class="dl-wd">' + it.wd + '</div>';
        }
        if (typeof it.w === "string") {                                   // 成语
          return '<div class="dl-idiom"><b>' + it.w + '</b><span class="dl-py">' + (it.py || "") + '</span><span>' + (it.ex || "") + '</span></div>';
        }
        if (it.ps !== undefined) {                                        // 古诗
          var g1 = it.g ? '<span class="dl-g1">一年级必背</span>' : "";
          return '<div class="dl-poem">' + g1 + '<b>' + (it.t || "") + '</b><span class="dl-au">' + (it.a || "") + ' · ' + (it.ty || "") + '</span><p>' + (it.ps || []).join("<br>") + '</p></div>';
        }
        if (it.txt !== undefined) {                                       // 蒙学
          return '<div class="dl-meng"><b>' + (it.t || "") + '</b><span>' + (it.txt || "") + '</span>' + (it.py ? '<span class="dl-py">' + it.py + '</span>' : "") + '</div>';
        }
        if (it.cat !== undefined) {                                       // 作文范文
          return '<div class="dl-essay"><b>' + (it.t || "") + '<span class="dl-chip">' + (it.cat || "") + '</span></b><span>' + (it.words || "").split("\n")[0].slice(0, 60) + '…</span></div>';
        }
        if (it.steps !== undefined) {                                     // 学习方法
          return '<div class="dl-method"><b>' + (it.t || "") + '</b><span>' + (it.d || "") + '</span></div>';
        }
        if (it.s !== undefined) {                                         // 自然拼读
          return '<div class="dl-phonics"><b>' + (it.t || "") + '</b><span class="dl-s">' + (it.s || "") + '</span><span>' + (it.w || []).join(" · ") + '</span></div>';
        }
        if (it.eg !== undefined) {                                        // 数学口诀
          return '<div class="dl-formula"><b>' + (it.t || "") + '</b><span>' + (it.d || "") + '</span><span class="dl-eg">例：' + (it.eg || "") + '</span></div>';
        }
        if (it.a !== undefined && it.b !== undefined) {
          return '<div class="dl-mul"><b>' + it.a + " × " + it.b + ' = ' + it.r + '</b><span>' + (it.text || "") + '</span></div>';
        }
        if (it.rel !== undefined) {
          return '<div class="dl-unit"><b>' + (it.name || "") + '</b><span class="dl-sym">' + (it.sym || "") + '</span><span>' + (it.rel || "") + '</span><span class="dl-eg">' + (it.eg || "") + '</span></div>';
        }
        if (it.f !== undefined) {
          return '<div class="dl-shape"><b>' + (it.name || "") + '</b><span class="dl-en2">' + (it.en || "") + '</span><span>' + (it.f || "") + '</span><span class="dl-eg">' + (it.eg || "") + '</span></div>';
        }
        if (it.en !== undefined) {
          return '<div class="dl-en"><span class="dl-emoji">' + (it.img || "🔤") + '</span><b>' + it.en + '</b><span class="dl-ph">' + (it.ph || "") + '</span><span class="dl-cn">' + (it.cn || "") + '</span></div>';
        }
        if (it.n !== undefined) {
          return '<div class="dl-num"><b>' + it.n + '</b><span>' + (it.cn || "") + '</span><span class="dl-py">' + (it.py || "") + '</span></div>';
        }
        return '<div class="dl-row">' + U.esc(JSON.stringify(it)) + '</div>';
      },
      readItem: function (it) {
        if (!it) return;
        if (it.ch !== undefined) { Speech.speakPinyin(it.py || it.ch, { rate: 0.7 }); return; }
        if (it.wd !== undefined) { Speech.speak(it.wd); return; }                             // 词语
        if (typeof it.w === "string") { Speech.speak(it.w); return; }                       // 成语
        if (it.ps !== undefined) { Speech.speak(it.ps.join(""), { rate: 0.8 }); return; }   // 古诗
        if (it.txt !== undefined) { Speech.speak(it.txt); return; }                         // 蒙学
        if (it.cat !== undefined) { Speech.speak(it.t + "。" + String(it.words || "").split("\n").slice(0, 2).join("")); return; } // 作文
        if (it.steps !== undefined) { Speech.speak(it.t + "。" + it.d + "。" + (it.steps || []).join("，")); return; }           // 方法
        if (it.s !== undefined) { Speech.speak(it.t + " " + it.s); Speech.speakEn((it.w || []).join(", "), { rate: 0.8 }); return; } // 拼读
        if (it.eg !== undefined) { Speech.speak(it.t + "。" + it.d + "。例如：" + it.eg); return; }                              // 口诀
        if (it.a !== undefined && it.b !== undefined) { Speech.speak(it.text); return; }
        if (it.rel !== undefined) { Speech.speak((it.name || "") + " " + it.rel + " " + (it.eg || "")); return; }
        if (it.f !== undefined) { Speech.speak((it.name || "") + "，" + it.f + "，" + (it.eg || "")); return; }
        if (it.en !== undefined) { Speech.speakEn(it.en, { rate: 0.8 }); return; }
        if (it.n !== undefined) { Speech.speak(it.cn); return; }
        Speech.speak(JSON.stringify(it));
      }
    }
  };
})(window);
