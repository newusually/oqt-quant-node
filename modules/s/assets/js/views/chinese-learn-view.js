/*
 * chinese-learn-view.js — 视图层 / 语文学习小课堂
 * 标签页：拼音跟读 / 认字卡片 / 组词造句 / 课文背诵 / 知识点总结。
 * 语音规则：拼音一律 speakPinyin（呼读音），汉字/句子用 speak，绝不读成英文。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var Speech = App.Speech, U = App.U, IMG = App.IMG, CL = App.ChineseLearn;

  var TABS = [
    { k: "py", t: "🔤 拼音跟读" },
    { k: "char", t: "🃏 认字卡片" },
    { k: "prac", t: "✍️ 组词造句" },
    { k: "text", t: "📖 课文背诵" },
    { k: "kp", t: "🧠 知识点" }
  ];

  App.views = App.views || {};
  App.views.chineseLearn = {
    template: [
      '<site-shell title="语文学习小课堂" sub="拼音、识字、组词、造句、背课文" icon="📚">',
      '<div class="ltabs">',
      '<button class="ltab" v-for="t in tabs" :key="t.k" :class="{on: tab === t.k}" @click="tab = t.k">{{t.t}}</button>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'py\'">',
      '<div class="pyh">声母</div>',
      '<div class="pyrow"><span class="pychip" v-for="s in py.shengmu" :key="s" @click="readPy(s)">{{s}}<i>{{py.examples[s]}}</i></span></div>',
      '<div class="pyh">韵母</div>',
      '<div class="pyrow"><span class="pychip" v-for="s in py.yunmu" :key="s" @click="readPy(s)">{{s}}<i>{{py.examples[s]}}</i></span></div>',
      '<div class="pyh">整体认读</div>',
      '<div class="pyrow"><span class="pychip" v-for="s in py.zhengti" :key="s" @click="readPy(s)">{{s}}<i>{{py.examples[s]}}</i></span></div>',
      '<div class="ctr"><button class="btn spk" @click="readAllPy">🔊 按顺序读全部拼音</button></div>',
      '<div class="hint">👆 点一个拼音，听一听该怎么读（声母读呼读音：b→波）</div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'char\'">',
      '<div class="chargrid">',
      '<div class="charcard" v-for="(c, i) in chars" :key="i" @click="flipChar(i)">',
      '<div class="charbig">{{c.zi}}</div>',
      '<div class="charpy">{{c.open ? c.py : "？？"}}</div>',
      '<div class="charimg" v-html="c.open ? svg(c.img) : \'\'"></div>',
      '</div></div>',
      '<div class="ctr"><button class="btn spk" @click="readAllChar">🔊 按顺序读所有字</button></div>',
      '<div class="hint">👆 点一张字卡，翻出拼音和图片</div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'prac\'">',
      '<div class="qtext" v-if="prac.kind === \'zuci\'">用“<b>{{prac.zi}}</b>”组词，选出正确的：</div>',
      '<div class="qtext" v-else>用“<b>{{prac.word}}</b>”造句，选最通顺的一句：<br><span style="color:#888">{{prac.tmpl}}</span></div>',
      '<div class="opts"><div class="opt" v-for="(o, i) in prac.opts" :key="i" :class="pracCls(i)" @click="answerPrac(i)">{{o}}</div></div>',
      '<div class="gfb" :class="prac.fbCls" v-html="prac.fb"></div>',
      '<div class="ctr"><button class="btn next" @click="nextPrac">下一题 ▶</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'text\'">',
      '<div class="textlist">',
      '<div class="textitem" v-for="(t, i) in texts" :key="i">',
      '<div class="ttitle" @click="t.open = !t.open">{{t.title}}</div>',
      '<div class="tbody" v-show="t.open"><span v-html="bodyHtml(t)"></span><div class="hint">{{t.tip}}</div>',
      '<button class="btn spk" @click="say(t.body)">🔊 跟读/背诵</button></div>',
      '</div></div>',
      '<div class="ctr"><button class="btn spk" @click="readAllText">🔊 按顺序读所有课文</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'kp\'">',
      '<div class="kpwrap">',
      '<div class="kpcol" v-for="(s, i) in summary" :key="i">',
      '<div class="kphead">{{s.cat}}</div><ul><li v-for="(p, j) in s.points" :key="j">{{p}}</li></ul>',
      '</div></div>',
      '<div class="ctr"><button class="btn spk" @click="readAllKp">🔊 读全部知识点</button></div>',
      '</div>',
      '</site-shell>'
    ].join(""),
    data: function () {
      return {
        tabs: TABS, tab: "py",
        py: CL.pinyin,
        chars: CL.characters.map(function (c) { return { zi: c.zi, py: c.py, img: c.img, open: false }; }),
        texts: CL.texts.map(function (t) { return { title: t.title, body: t.body, tip: t.tip, open: false }; }),
        summary: CL.summary,
        pracIdx: 0,
        prac: { kind: "zuci", zi: "", word: "", tmpl: "", opts: [], ans: 0, done: false, picked: -1, fb: "", fbCls: "" }
      };
    },
    mounted: function () {
      this.nextPrac();
      Speech.autoRead("语文学习小课堂，快来学拼音、认字、背课文吧！");
    },
    methods: {
      svg: function (id) { return IMG.svg(id) || "⭐"; },
      bodyHtml: function (t) { return App.NLP ? App.NLP.annotate(t.body) : t.body; },
      say: function (t) { Speech.speak(t); },
      readPy: function (s) { Speech.speakPinyin(s, { rate: 0.7 }); },
      readAllPy: function () {
        var all = this.py.shengmu.concat(this.py.yunmu).concat(this.py.zhengti);
        Speech.seq(all.slice());
      },
      flipChar: function (i) {
        var c = this.chars[i];
        c.open = true;
        Speech.speak(c.zi + "，" + c.py);
      },
      readAllChar: function () {
        var self = this;
        this.chars.forEach(function (c) { c.open = true; });
        Speech.seq(this.chars.map(function (c) { return c.zi + "，" + c.py; }));
      },
      readAllText: function () {
        var self = this;
        this.texts.forEach(function (t) { t.open = true; });
        Speech.seq(this.texts.map(function (t) { return t.title + "。" + t.body; }));
      },
      readAllKp: function () {
        var list = [];
        this.summary.forEach(function (s) { list.push(s.cat + "：" + s.points.join("，")); });
        Speech.seq(list);
      },
      nextPrac: function () {
        var self = this;
        if (this.pracIdx % 2 === 0) {
          var z = CL.guidedZuci();
          this.prac = { kind: "zuci", zi: z.zi, word: "", tmpl: "", opts: z.opts, ans: z.ans, done: false, picked: -1, fb: "", fbCls: "",
            explain: "“" + z.zi + "”可以组成：" + z.words.join("、") };
        } else {
          var j = CL.guidedZaoju();
          this.prac = { kind: "zaoju", zi: "", word: j.word, tmpl: j.tmpl, opts: j.opts, ans: j.ans, done: false, picked: -1, fb: "", fbCls: "",
            explain: "通顺的句子是：" + j.tmpl.replace("____", j.opts[j.ans]) };
        }
        this.pracIdx++;
        // 出题后先念题目，再把选项一个个念出来
        var p = this.prac;
        if (p && App.Speech) {
          var t = p.kind === "zuci"
            ? "请给“" + p.zi + "”组一个词。"
            : "请把句子补充完整：" + String(p.tmpl || "").replace(/_+/g, "什么");
          if (App.ReadQ) App.ReadQ.readText(t, p.opts, { force: true });
          else App.Speech.speak(t);
        }
      },
      pracCls: function (i) {
        if (!this.prac.done) return {};
        var ok = i === this.prac.ans;
        return { x: true, ok: ok, no: !ok };
      },
      answerPrac: function (i) {
        var p = this.prac;
        if (p.done) return;
        p.done = true; p.picked = i;
        var ok = i === p.ans;
        p.fb = (ok ? "✔ 很棒！" : "✘ 再想想：") + "<span class='gexplain'>" + (ok ? "" : p.explain) + "</span>";
        p.fbCls = "gfb " + (ok ? "good" : "bad");
        if (ok) { U.confetti(12); Speech.speak("很棒！"); App.Store.addStars(1); }
        else Speech.speak(p.explain);
      }
    }
  };
})(window);
