/*
 * english-zone-view.js — 视图层 / 英语专区
 * 标签页：字母 / 单词 / CVC 拼写 / 连词成句 / 完形填空 / 听力 / 背诵 / 记忆妙招。
 * 语音规则：英文一律 speakEn（en-US），中文提示用 speak，两者不混。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var Speech = App.Speech, U = App.U, IMG = App.IMG, EZ = App.EnglishZone;

  App.views = App.views || {};
  App.views.englishZone = {
    template: [
      '<site-shell title="英语专区" sub="字母、单词、句子，听说读写一起练" icon="🔤">',
      '<div class="ltabs">',
      '<button class="ltab" v-for="t in tabs" :key="t.k" :class="{on: tab === t.k}" @click="tab = t.k">{{t.t}}</button>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'letter\'">',
      '<div class="ez-intro">🔤 点字母卡片，听一听它的发音和例词：</div>',
      '<div class="letter-wrap">',
      '<div class="letter-card" v-for="(L, i) in letters" :key="i" @click="readLetter(i, $event)">',
      '<div class="lc-up">{{L.up}}</div><div class="lc-low">{{L.low}}</div>',
      '<div class="lc-img" v-if="L.img" v-html="svg(L.img)"></div>',
      '<div class="lc-img lc-noimg" v-else>{{L.word}}</div>',
      '<div class="lc-word">{{L.word}} {{L.zh}}</div></div>',
      '</div>',
      '<div class="ctr"><button class="btn spk" @click="readLetterAll">🔊 按顺序读 26 个字母</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'vocab\'">',
      '<div class="ez-intro">📚 点单词卡，听一听、看一看意思：</div>',
      '<div class="vocab-wrap">',
      '<div class="vocab-card" v-for="(v, i) in vocab" :key="i" @click="readVocab(i, $event)">',
      '<div class="vc-img" v-if="v.img" v-html="svg(v.img)"></div>',
      '<div class="vc-img vc-noimg" v-else>{{v.en}}</div>',
      '<div class="vc-en">{{v.en}}</div><div class="vc-zh">{{v.open ? v.zh : "？"}}</div></div>',
      '</div>',
      '<div class="ctr"><button class="btn spk" @click="readVocabAll">🔊 按顺序读所有单词</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'cvc\'">',
      '<div class="qtext">看图/提示，把下面的字母拼成单词：</div>',
      '<div class="cvc-show" v-html="cvcShow"></div>',
      '<div class="order-pool">',
      '<span class="oword" v-for="(c, i) in cvc.q.tiles" :key="i" :class="{used: cvc.used[i]}" @click="cvcPick(i)">{{c}}</span></div>',
      '<div class="order-ans"><span class="ph" v-if="!cvc.picked.length">点字母，拼到这里 →</span>',
      '<span class="oword in" v-for="(c, i) in cvc.picked" :key="i">{{c}}</span></div>',
      '<div class="ctr">',
      '<button class="btn" @click="cvcCheck">✅ 检查</button>',
      '<button class="btn" @click="cvcClear">↺ 重拼</button>',
      '<button class="btn next" @click="newCvc">换一个 ▶</button></div>',
      '<div class="gfb" :class="cvc.fbCls" v-html="cvc.fb"></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'sent\'">',
      '<div class="qtext">把词排成一句通顺的英文（点词排顺序）：</div>',
      '<div class="order-pool">',
      '<span class="oword" v-for="(wd, i) in sent.q.shuffled" :key="i" :class="{used: sent.used[i]}" @click="sentPick(i)">{{wd}}</span></div>',
      '<div class="order-ans"><span class="ph" v-if="!sent.picked.length">点上面的词，排到这里 →</span>',
      '<span class="oword in" v-for="(wd, i) in sent.picked" :key="i">{{wd}}</span></div>',
      '<div class="ctr">',
      '<button class="btn" @click="sentCheck">✅ 检查</button>',
      '<button class="btn" @click="sentClear">↺ 重排</button>',
      '<button class="btn next" @click="newSent">换一题 ▶</button></div>',
      '<div class="gfb" :class="sent.fbCls" v-html="sent.fb"></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'cloze\'">',
      '<div class="qtext">选一个词，把句子补充完整：</div>',
      '<div class="cloze-show" v-html="clozeShow"></div>',
      '<div class="opts"><div class="opt" v-for="(o, i) in cloze.q.opts" :key="i" :class="quizCls(cloze, i)" @click="answerQuiz(cloze, i)">{{o}}</div></div>',
      '<div class="gfb" :class="cloze.fbCls" v-html="cloze.fb"></div>',
      '<div class="ctr"><button class="btn next" @click="newCloze">下一题 ▶</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'listen\'">',
      '<div class="qtext">👂 仔细听，选出你听到的词：</div>',
      '<div class="ctr"><button class="bigbtn spk" @click="playListen">🔊 听一听</button>',
      '<button class="btn" @click="playListen">🔁 再听一次</button></div>',
      '<div class="opts"><div class="opt" v-for="(o, i) in listen.q.opts" :key="i" :class="quizCls(listen, i)" @click="answerQuiz(listen, i)">{{o}}</div></div>',
      '<div class="gfb" :class="listen.fbCls" v-html="listen.fb"></div>',
      '<div class="ctr"><button class="btn next" @click="newListen">下一题 ▶</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'recite\'">',
      '<div class="ez-intro">📜 跟着读一读、背一背：</div>',
      '<div class="recite-list">',
      '<div class="recite-card" v-for="(r, i) in recite" :key="i">',
      '<div class="rc-title">{{r.title}}</div><div class="rc-text">{{r.text}}</div>',
      '<button class="btn spk" @click="readEn(r.text)">🔊 跟我读</button></div>',
      '</div>',
      '<div class="ctr"><button class="btn spk" @click="readReciteAll">🔊 按顺序读全部</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'tips\'">',
      '<div class="ez-intro">💡 记英语单词的小妙招：</div>',
      '<div class="tips-wrap">',
      '<div class="tip-card" v-for="(t, i) in tips" :key="i">',
      '<div class="tip-t">{{t.t}}</div><div class="tip-d">{{t.d}}</div></div>',
      '</div>',
      '<div class="ctr"><button class="btn spk" @click="readTipsAll">🔊 读全部妙招</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'reading\'">',
      '<div class="ez-intro">📖 读短文，做后面的小题（点选项作答）：</div>',
      '<div class="read-passage">',
      '<div class="rp-head"><b>{{rd.title}}</b>',
      '<button class="btn spk" @click="readEn(rd.passage, 0.8)">🔊 朗读短文</button></div>',
      '<p class="rp-text">{{rd.passage}}</p>',
      '<p class="rp-cn" v-if="rd.cn">{{rd.cn}}</p>',
      '</div>',
      '<div class="qtext">{{rd.q.q}}</div>',
      '<div class="opts"><div class="opt" v-for="(o, i) in rd.q.opts" :key="i" :class="quizCls(rd, i)" @click="answerQuiz(rd, i)">{{o}}</div></div>',
      '<div class="gfb" :class="rd.fbCls" v-html="rd.fb"></div>',
      '<div class="ctr"><button class="btn next" @click="newReading">下一篇 ▶</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'phonics\'">',
      '<div class="ez-intro">🔤 自然拼读：字母和组合怎么读，点卡片听发音：</div>',
      '<div class="ph-wrap">',
      '<div class="ph-card" v-for="(p, i) in phonicsList" :key="i" @click="readPhonics(p, $event)">',
      '<div class="ph-t">{{p.t}}</div><div class="ph-s">{{p.s}}</div>',
      '<div class="ph-w">{{p.w.join(" · ")}}</div></div>',
      '</div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'dict\'">',
      '<div class="ez-intro">📖 英语词典：4600 个常用词（开源 ECDICT 数据），点单词听发音：</div>',
      '<div class="dl-bar">',
      '<input class="dl-search" v-model="dkw" placeholder="搜英文单词或中文意思" @keyup.enter="dictSearch">',
      '<button class="btn spk" @click="dictSearch">🔍 搜索</button>',
      '<button class="btn" v-if="dkw" @click="dkw = \'\'">✕ 清除</button></div>',
      '<div class="dict-wrap">',
      '<div class="dict-card" v-for="(d, i) in dictShow" :key="i" @click="readEn(d.en, 0.8, $event)">',
      '<b>{{d.en}}</b><span class="d-ph">{{d.ph}}</span><span class="d-cn">{{d.cn}}</span>',
      '<span class="d-tag" v-if="d.g">一年级</span><span class="d-tag2" v-if="d.tag">{{d.tag}}</span></div>',
      '</div>',
      '<div class="hint" v-if="!dictShow.length">没有找到，换个词试试～</div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'methods\'">',
      '<div class="ez-intro">🧭 英语学习方法：兴趣、单词、拼读、听力、阅读，一步一步来：</div>',
      '<div class="me-wrap">',
      '<div class="me-card" v-for="(m, i) in methodsList" :key="i">',
      '<div class="me-t">{{m.t}}</div><div class="me-d">{{m.d}}</div>',
      '<div class="me-steps"><span v-for="(s, j) in m.steps" :key="j">{{j+1}}. {{s}}</span></div>',
      '<button class="btn spk" @click="readMethod(m)">🔊 听方法</button></div>',
      '</div>',
      '</div>',
      '</site-shell>'
    ].join(""),
    data: function () {
      var RD = (App.DATA.english && App.DATA.english.reading) || { pages: [] };
      var PH = (App.DATA.english && App.DATA.english.phonics) || { pages: [] };
      var ME = (App.DATA.english && App.DATA.english.methods) || { pages: [] };
      var DC = (App.DATA.english && App.DATA.english.wordsDict) || { pages: [] };
      return {
        tabs: [
          { k: "letter", t: "🔤 字母" }, { k: "vocab", t: "📚 单词" }, { k: "cvc", t: "🧩 拼写" },
          { k: "sent", t: "💬 句子" }, { k: "cloze", t: "✏️ 填空" }, { k: "listen", t: "🎧 听力" },
          { k: "reading", t: "📖 阅读" }, { k: "phonics", t: "🔤 拼读" }, { k: "dict", t: "📖 词典" },
          { k: "methods", t: "🧭 方法" }, { k: "recite", t: "📜 背诵" }, { k: "tips", t: "💡 妙招" }
        ],
        tab: "letter",
        letters: EZ.LETTERS,
        vocab: EZ.VOCAB.map(function (v) { return { en: v.en, zh: v.zh, img: v.img, open: false }; }),
        recite: EZ.RECITE,
        tips: EZ.TIPS,
        cvc: mkOrder(EZ.cvcQuiz()),
        sent: mkOrder(EZ.sentenceQuiz()),
        cloze: blank(EZ.clozeQuiz()),
        listen: blank(EZ.listenQuiz()),
        rd: blank(rdQuiz(RD)),
        phonicsList: flatItems(PH),
        methodsList: flatItems(ME),
        dictAll: flatItems(DC),
        dkw: ""
      };
    },
    computed: {
      clozeShow: function () {
        return String(this.cloze.q.text).replace("___", '<span class="blank">(　　)</span>');
      },
      cvcShow: function () {
        var q = this.cvc.q;
        if (q.img) return IMG.svg(q.img) || "";
        return '<span class="cvc-hint">' + q.word.length + " 个字母</span>";
      },
      dictShow: function () {
        var kw = this.dkw.trim().toLowerCase();
        if (!kw) {
          return this.dictAll.filter(function (d) { return d.g; }).slice(0, 150);
        }
        return this.dictAll.filter(function (d) {
          return d.en.indexOf(kw) >= 0 || (d.cn || "").indexOf(kw) >= 0;
        }).slice(0, 100);
      }
    },
    mounted: function () {
      var self = this;
      Speech.autoRead("英语专区，点一点就能听到标准的英语发音！");
      // 欢迎语念完再念第一道题（题目 + 选项），避免两句话互相掐断
      setTimeout(function () { self.sayQuiz(self.listen.q, "listen"); }, 2800);
    },
    methods: {
      svg: function (id) { return IMG.svg(id) || ""; },
      readEn: function (t, r, ev) { Speech.speakEn(t, { rate: r || 0.85, el: ev && (ev.currentTarget || ev.target) }); },
      readLetter: function (i, ev) {
        var L = this.letters[i];
        Speech.speakEn(L.low, { rate: 0.8, el: ev && (ev.currentTarget || ev.target) });
        var self = this;
        setTimeout(function () { Speech.speakEn(L.word, { rate: 0.8 }); }, 700);
      },
      readLetterAll: function () {
        Speech.seq(this.letters.map(function (L) { return { t: L.low, en: true }; }));
      },
      readVocab: function (i, ev) {
        var v = this.vocab[i];
        v.open = true;
        Speech.speakEn(v.en, { rate: 0.85, el: ev && (ev.currentTarget || ev.target) });
      },
      readVocabAll: function () {
        var self = this;
        this.vocab.forEach(function (v) { v.open = true; });
        Speech.seq(this.vocab.map(function (v) { return { t: v.en, en: true }; }));
      },
      readReciteAll: function () {
        Speech.seq(this.recite.map(function (r) { return { t: r.text, en: true }; }));
      },
      readTipsAll: function () {
        Speech.seq(this.tips.map(function (t) { return t.t + "。" + t.d; }));
      },
      blank: blank,
      mkOrder: mkOrder,
      quizCls: function (box, i) {
        if (!box.done) return {};
        var ok = i === box.q.ans;
        return { x: true, ok: ok, no: !ok };
      },
      newCvc: function () { this.cvc = mkOrder(EZ.cvcQuiz()); this.sayQuiz(this.cvc.q, "cvc"); },
      newSent: function () { this.sent = mkOrder(EZ.sentenceQuiz()); this.sayQuiz(this.sent.q, "sent"); },
      newCloze: function () { this.cloze = blank(EZ.clozeQuiz()); this.sayQuiz(this.cloze.q, "cloze"); },
      newListen: function () { this.listen = blank(EZ.listenQuiz()); this.sayQuiz(this.listen.q, "listen"); },
      newReading: function () {
        var RD = (App.DATA.english && App.DATA.english.reading) || { pages: [] };
        this.rd = blank(rdQuiz(RD));
        this.sayQuiz(this.rd.q, "reading");
      },
      // 英语出题统一播报：先念题目，再把选项一个个念出来（顺序播报不掐断）
      sayQuiz: function (q, mode) {
        if (!q || !App.Speech) return;
        var t = "", os = null;
        if (mode === "cloze") { t = q.text || ""; os = q.opts; }
        else if (mode === "listen") { t = q.say || ""; os = q.opts; }
        else if (mode === "cvc") { t = "Spell the word, " + (q.word || "") + "."; os = q.tiles; }
        else if (mode === "sent") { t = "Put the words in order. " + (q.words || []).join(" "); os = q.shuffled; }
        else if (mode === "reading") { t = q.passage || q.q || q.text || ""; os = q.opts; }
        if (App.ReadQ) App.ReadQ.readText(t, os, { en: true, force: true });
        else if (t) App.Speech.speakEn(t, { rate: 0.85 });
      },
      readPhonics: function (p, ev) {
        Speech.speak(p.t + "，" + p.s, { el: ev && (ev.currentTarget || ev.target) });
        var self = this;
        setTimeout(function () { Speech.speakEn(p.w.join(", "), { rate: 0.75 }); }, 900);
      },
      readMethod: function (m) {
        Speech.speak(m.t + "。" + m.d + "。" + (m.steps || []).join("，"));
      },
      dictSearch: function () { /* v-model 已实时过滤，此按钮供触屏 */ },
      cvcPick: function (i) {
        if (this.cvc.used[i]) return;
        this.cvc.used[i] = true;
        this.cvc.picked.push(this.cvc.q.tiles[i]);
      },
      cvcClear: function () {
        var i;
        for (i = 0; i < this.cvc.used.length; i++) this.cvc.used[i] = false;
        this.cvc.picked = [];
      },
      cvcCheck: function () {
        var q = this.cvc.q, got = this.cvc.picked.join("");
        if (got === q.word) {
          this.cvc.fb = "✔ 拼对啦：" + q.word; this.cvc.fbCls = "gfb good";
          U.confetti(14); Speech.sfx.right(); Speech.speakEn(q.word, { rate: 0.85 });
          App.Store.addStars(1);
        } else {
          this.cvc.fb = "✘ 再拼拼：正确答案是 <span class='gexplain'>" + q.word + "</span>";
          this.cvc.fbCls = "gfb bad"; Speech.sfx.wrong();
        }
      },
      sentPick: function (i) {
        if (this.sent.used[i]) return;
        this.sent.used[i] = true;
        this.sent.picked.push(this.sent.q.shuffled[i]);
      },
      sentClear: function () {
        var i;
        for (i = 0; i < this.sent.used.length; i++) this.sent.used[i] = false;
        this.sent.picked = [];
      },
      sentCheck: function () {
        var q = this.sent.q, right = q.words.join(" "), got = this.sent.picked.join(" ");
        if (got === right) {
          this.sent.fb = "✔ 真棒！" + right; this.sent.fbCls = "gfb good";
          U.confetti(14); Speech.sfx.right(); Speech.speakEn(right, { rate: 0.8 });
          App.Store.addStars(1);
        } else {
          this.sent.fb = "✘ 再试试：正确是 <span class='gexplain'>" + right + "</span>";
          this.sent.fbCls = "gfb bad"; Speech.sfx.wrong();
        }
      },
      playListen: function () { Speech.speakEn(this.listen.q.say, { rate: 0.8 }); },
      answerQuiz: function (box, i) {
        var q = box.q;
        if (box.done) return;
        box.done = true; box.picked = i;
        var ok = i === q.ans;
        box.fb = (ok ? "✔ 真棒！" : "✘ 再想想：") + "<span class='gexplain'>" + (ok ? "" : q.opts[q.ans]) + "</span>";
        box.fbCls = "gfb " + (ok ? "good" : "bad");
        if (ok) {
          U.confetti(12); Speech.sfx.right(); App.Store.addStars(1);
          if (box === this.cloze) Speech.speakEn(String(q.text).replace("___", q.opts[q.ans]), { rate: 0.8 });
          else Speech.speakEn(q.opts[q.ans], { rate: 0.8 });
        } else { Speech.sfx.wrong(); }
      }
    }
  };

  function blank(q) { return { q: q, done: false, picked: -1, fb: "", fbCls: "" }; }
  function flatItems(ds) {
    var out = [];
    (ds.pages || []).forEach(function (p) {
      (p.items || []).forEach(function (it) { out.push(it); });
    });
    return out;
  }
  function rdQuiz(RD) {
    var pg = U.pick(RD.pages || []);
    var it = pg && pg.items ? U.pick(pg.items) : null;
    if (!it || !it.qs || !it.qs.length) return { title: "", passage: "", cn: "", q: { q: "（暂无短文）", opts: ["—", "—", "—"], ans: 0 } };
    var q = U.pick(it.qs);
    var opts = U.shuffled(q.opts.slice());
    return {
      title: it.t, passage: it.passage, cn: it.cn || "",
      q: { q: q.q, opts: opts, ans: opts.indexOf(q.opts[q.ans]), why: q.why }
    };
  }
  function mkOrder(q) {
    var list = q.tiles || q.shuffled || [];
    return { q: q, used: list.map(function () { return false; }), picked: [], fb: "", fbCls: "" };
  }
})(window);
