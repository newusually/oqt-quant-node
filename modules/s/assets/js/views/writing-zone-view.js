/*
 * writing-zone-view.js — 视图层 / 写作专区
 * 标签页：看图写话 / 句子仿写 / 连词成句 / 量词搭配 / 标点练习。
 * 每个板块都配图片 + “读一读”按钮，并随题目自动朗读。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var Speech = App.Speech, U = App.U, IMG = App.IMG, WZ = App.WritingZone;

  App.views = App.views || {};
  App.views.writingZone = {
    template: [
      '<site-shell title="写作专区" sub="看图写话、仿写句子、连词成句" icon="✍️">',
      '<div class="ltabs">',
      '<button class="ltab" v-for="t in tabs" :key="t.k" :class="{on: tab === t.k}" @click="tab = t.k">{{t.t}}</button>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'pic\'">',
      '<div class="pic-wrap">',
      '<div class="pic-img" v-html="svg(pic.img)"></div>',
      '<div class="pic-words">提示词：<span class="pw" v-for="(x, i) in pic.words" :key="i">{{x}}</span></div>',
      '</div>',
      '<div class="qtext">用上面的词，写一句话吧：</div>',
      '<textarea class="wt-area" v-model="myText" placeholder="在这里写一句话…"></textarea>',
      '<div class="ctr">',
      '<button class="btn" @click="showModel">👀 看范例</button>',
      '<button class="btn spk" @click="readModel">🔊 读范例</button>',
      '<button class="btn spk" @click="readWords">🔊 读提示词</button>',
      '<button class="btn next" @click="newPic">换一张 ▶</button></div>',
      '<div class="gfb" :class="pic.fbCls" v-html="pic.fb"></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'imit\'">',
      '<div class="imit-pic" v-html="svg(imit.q.img)"></div>',
      '<div class="qtext">范例：<b>{{imit.q.model}}</b></div>',
      '<div class="qtext">照样子写：<b>{{imit.q.tmpl}}</b></div>',
      '<div class="opts"><div class="opt" v-for="(o, i) in imit.q.opts" :key="i" :class="quizCls(imit, i)" @click="answerQuiz(imit, i, imit.q.model)">{{o}}</div></div>',
      '<div class="gfb" :class="imit.fbCls" v-html="imit.fb"></div>',
      '<div class="ctr"><button class="btn spk" @click="readZh(imit.q.model)">🔊 读范例</button>',
      '<button class="btn next" @click="newImit">下一题 ▶</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'order\'">',
      '<div class="imit-pic" v-html="svg(order.q.img)"></div>',
      '<div class="qtext">把这些词排成一句通顺的话（点词排顺序）：</div>',
      '<div class="order-pool">',
      '<span class="oword" v-for="(wd, i) in order.q.shuffled" :key="i" :class="{used: order.used[i]}" @click="orderPick(i)">{{wd}}</span></div>',
      '<div class="order-ans"><span class="ph" v-if="!order.picked.length">点上面的词，排到这里 →</span>',
      '<span class="oword in" v-for="(wd, i) in order.picked" :key="i">{{wd}}</span></div>',
      '<div class="ctr">',
      '<button class="btn" @click="orderCheck">✅ 检查</button>',
      '<button class="btn" @click="orderClear">↺ 重排</button>',
      '<button class="btn spk" @click="readZh(order.q.words.join(\'\'))">🔊 读正确句子</button>',
      '<button class="btn next" @click="newOrder">换一题 ▶</button></div>',
      '<div class="gfb" :class="order.fbCls" v-html="order.fb"></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'meas\'">',
      '<div class="imit-pic" v-html="svg(meas.q.img)"></div>',
      '<div class="qtext">一（ <b>？</b> ）{{meas.q.noun}} —— 选哪个量词？</div>',
      '<div class="opts"><div class="opt" v-for="(o, i) in meas.q.opts" :key="i" :class="quizCls(meas, i)" @click="answerQuiz(meas, i, measSay())">{{o}}</div></div>',
      '<div class="gfb" :class="meas.fbCls" v-html="meas.fb"></div>',
      '<div class="ctr"><button class="btn spk" @click="readZh(measSay())">🔊 听正确答案</button>',
      '<button class="btn next" @click="newMeas">下一题 ▶</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'punct\'">',
      '<div class="imit-pic" v-html="svg(punct.q.img)"></div>',
      '<div class="qtext">这句话末尾应该用什么标点？</div>',
      '<div class="punct-show">{{punct.q.sent}}（　　）</div>',
      '<div class="opts"><div class="opt" v-for="(o, i) in punct.q.opts" :key="i" :class="quizCls(punct, i)" @click="answerQuiz(punct, i, punctSay())">{{o}}</div></div>',
      '<div class="gfb" :class="punct.fbCls" v-html="punct.fb"></div>',
      '<div class="ctr"><button class="btn spk" @click="readZh(punctSay())">🔊 读整句</button>',
      '<button class="btn next" @click="newPunct">下一题 ▶</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'essay\'">',
      '<div class="ez-intro">✍️ 一年级作文范文库：按类别选一篇，读一读、学一学：</div>',
      '<div class="essay-cats">',
      '<button class="ec-chip" v-for="c in essayCats" :key="c" :class="{on: essayCat === c}" @click="essayCat = c">{{c}}</button>',
      '</div>',
      '<div class="essay-wrap">',
      '<div class="essay-card" v-for="(e, i) in essayList" :key="i">',
      '<div class="es-t">{{e.t}}<span class="es-chip">{{e.cat}}</span></div>',
      '<div class="es-words">{{e.words}}</div>',
      '<div class="es-good">🌟 好词：<span v-for="(g, j) in e.good" :key="j">{{g}}</span></div>',
      '<div class="es-tip">💡 写法要点：{{e.tip}}</div>',
      '<button class="btn spk" @click="readEssay(e)">🔊 读范文</button></div>',
      '</div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'howto\'">',
      '<div class="ez-intro">🧭 语文学习方法：拼音、识字、阅读、写作，一步一步来：</div>',
      '<div class="me-wrap">',
      '<div class="me-card" v-for="(m, i) in cnMethods" :key="i">',
      '<div class="me-t">{{m.t}}</div><div class="me-d">{{m.d}}</div>',
      '<div class="me-steps"><span v-for="(s, j) in m.steps" :key="j">{{j+1}}. {{s}}</span></div>',
      '<button class="btn spk" @click="readMethod(m)">🔊 听方法</button></div>',
      '</div>',
      '</div>',
      '</site-shell>'
    ].join(""),
    data: function () {
      var ES = (App.DATA.chinese && App.DATA.chinese.essay) || { pages: [] };
      var ME = (App.DATA.chinese && App.DATA.chinese.methods) || { pages: [] };
      var essays = [];
      (ES.pages || []).forEach(function (p) {
        (p.items || []).forEach(function (it) { essays.push(it); });
      });
      var methods = [];
      (ME.pages || []).forEach(function (p) {
        (p.items || []).forEach(function (it) { methods.push(it); });
      });
      return {
        tabs: [
          { k: "pic", t: "🖼️ 看图写话" }, { k: "imit", t: "📋 句子仿写" }, { k: "order", t: "🔗 连词成句" },
          { k: "meas", t: "📏 量词搭配" }, { k: "punct", t: "❗ 标点练习" },
          { k: "essay", t: "📚 范文库" }, { k: "howto", t: "🧭 学习方法" }
        ],
        tab: "pic",
        myText: "",
        pic: mkPic(WZ.pictureWrite()),
        imit: blank(WZ.imitateQuiz()),
        order: mkOrder(WZ.orderQuiz()),
        meas: blank(WZ.measureQuiz()),
        punct: blank(WZ.punctQuiz()),
        essays: essays,
        essayCats: ["写人", "记事", "写景", "状物", "想象", "日记"],
        essayCat: "写人",
        cnMethods: methods
      };
    },
    computed: {
      essayList: function () {
        var c = this.essayCat;
        return this.essays.filter(function (e) { return e.cat === c; });
      }
    },
    mounted: function () {
      // 欢迎语和第一道题排队念（不再互相掐断）
      var on = !(App.Store && App.Store.state && App.Store.state.autoRead === false);
      if (!on || !App.Speech) return;
      App.Speech.seq([
        { t: "写作专区，看图写话，还能练量词和标点！" },
        { t: "看图写话。提示词：" + this.pic.words.join("、") + "。请用这些词写一句话。" }
      ]);
    },
    methods: {
      svg: function (id) { return IMG.svg(id) || ""; },
      readZh: function (t) { Speech.speak(t); },
      measSay: function () { return "一" + this.meas.q.opts[this.meas.q.ans] + this.meas.q.noun; },
      punctSay: function () { return this.punct.q.sent + this.punct.q.opts[this.punct.q.ans]; },
      orderSay: function () { return this.order.q.words.join(""); },
      readPic: function () { Speech.speak("看图写话。提示词：" + this.pic.words.join("、") + "。请用这些词写一句话。"); },
      readModel: function () { Speech.speak(this.pic.t.model); },
      readEssay: function (e) {
        Speech.speak(e.t + "。" + String(e.words || "").split("\n").join(""), { rate: 0.85 });
      },
      readMethod: function (m) {
        Speech.speak(m.t + "。" + m.d + "。" + (m.steps || []).join("，"));
      },
      readWords: function () { Speech.speak(this.pic.words.join("、")); },
      showModel: function () {
        this.pic.fb = "范例：" + this.pic.t.model;
        this.pic.fbCls = "gfb good";
      },
      newPic: function () { this.pic = mkPic(WZ.pictureWrite()); this.myText = ""; this.readPic(); },
      quizCls: function (box, i) {
        if (!box.done) return {};
        var ok = i === box.q.ans;
        return { x: true, ok: ok, no: !ok };
      },
      answerQuiz: function (box, i, sayTxt) {
        var q = box.q;
        if (box.done) return;
        box.done = true; box.picked = i;
        var ok = i === q.ans;
        box.fb = (ok ? "✔ 真棒！" : "✘ 再想想：") + "<span class='gexplain'>" + (ok ? "" : q.opts[q.ans]) + "</span>";
        box.fbCls = "gfb " + (ok ? "good" : "bad");
        if (ok) {
          U.confetti(12); Speech.sfx.right(); App.Store.addStars(1);
          if (sayTxt) Speech.speak(sayTxt);
        } else { Speech.sfx.wrong(); }
      },
      newImit: function () { this.imit = blank(WZ.imitateQuiz()); this.sayQuiz(this.imit.q, "imit"); },
      newOrder: function () { this.order = mkOrder(WZ.orderQuiz()); this.sayQuiz(this.order.q, "order"); },
      newMeas: function () { this.meas = blank(WZ.measureQuiz()); this.sayQuiz(this.meas.q, "meas"); },
      newPunct: function () { this.punct = blank(WZ.punctQuiz()); this.sayQuiz(this.punct.q, "punct"); },
      // 出题后先念题目，再把选项一个个念出来
      sayQuiz: function (q, mode) {
        if (!q || !App.Speech) return;
        var t = "", os = null;
        if (mode === "imit") { t = "请把句子补充完整：" + String(q.tmpl || "").replace(/_+/g, "什么"); os = q.opts; }
        else if (mode === "order") { t = "请把词语排成一句话。"; os = q.shuffled; }
        else if (mode === "meas") { t = "请选一个量词：一什么" + (q.noun || "") + "？"; os = q.opts; }
        else if (mode === "punct") { t = "请给句子加上标点：" + (q.sent || ""); os = q.opts; }
        else { t = q.t || q.q || q.text || ""; os = q.opts; }
        if (App.ReadQ) App.ReadQ.readText(t, os, { force: true });
        else if (t) App.Speech.speak(t);
      },
      orderPick: function (i) {
        if (this.order.used[i]) return;
        this.order.used[i] = true;
        this.order.picked.push(this.order.q.shuffled[i]);
      },
      orderClear: function () {
        var i;
        for (i = 0; i < this.order.used.length; i++) this.order.used[i] = false;
        this.order.picked = [];
      },
      orderCheck: function () {
        var q = this.order.q, right = q.words.join(""), got = this.order.picked.join("");
        if (got === right) {
          this.order.fb = "✔ 真棒！" + right; this.order.fbCls = "gfb good";
          U.confetti(14); Speech.sfx.right(); Speech.speak(right); App.Store.addStars(1);
        } else {
          this.order.fb = "✘ 再试试：正确是 <span class='gexplain'>" + right + "</span>";
          this.order.fbCls = "gfb bad"; Speech.sfx.wrong();
        }
      }
    }
  };

  function mkPic(t) { return { t: t, img: t.img, words: t.words, fb: "", fbCls: "" }; }
  function blank(q) { return { q: q, done: false, picked: -1, fb: "", fbCls: "" }; }
  function mkOrder(q) {
    return { q: q, used: q.shuffled.map(function () { return false; }), picked: [], fb: "", fbCls: "" };
  }
})(window);
