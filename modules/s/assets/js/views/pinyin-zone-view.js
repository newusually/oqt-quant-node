/*
 * pinyin-zone-view.js — 视图层 / 拼音专区
 * 标签页：写法 / 组成 / 拼读 / 记忆 / 四声朗读 / 组词填字。
 * 语音规则：所有拼音都走 speakPinyin（中文呼读音），绝不读成英文字母。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var Speech = App.Speech, U = App.U, PZ = App.PinyinZone;

  function blank(q) { return { q: q, done: false, picked: -1, fb: "", fbCls: "", res: "" }; }

  App.views = App.views || {};
  App.views.pinyinZone = {
    template: [
      '<site-shell title="拼音专区" sub="四线三格、声母韵母、拼读练习" icon="🔡">',
      '<div class="ltabs">',
      '<button class="ltab" v-for="t in tabs" :key="t.k" :class="{on: tab === t.k}" @click="tab = t.k">{{t.t}}</button>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'write\'">',
      '<div class="pz-intro">📝 拼音写在<b>四线三格</b>里，每个字母都有自己住的地方：</div>',
      '<div class="sxs-hero">',
      '<svg class="hero-svg" viewBox="0 0 340 240" xmlns="http://www.w3.org/2000/svg">',
      '<defs>',
      '<linearGradient id="skyG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cdeffd"/><stop offset="1" stop-color="#fef6e4"/></linearGradient>',
      '<linearGradient id="grassG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8e986"/><stop offset="1" stop-color="#8fd06a"/></linearGradient>',
      '</defs>',
      '<rect x="0" y="0" width="340" height="240" rx="18" fill="url(#skyG)"/>',
      '<circle cx="48" cy="42" r="27" fill="#ffd54f" opacity=".35"/><circle cx="48" cy="42" r="17" fill="#ffd54f"/>',
      '<g fill="#ffffff" opacity=".92"><ellipse cx="252" cy="48" rx="27" ry="13"/><ellipse cx="270" cy="42" rx="18" ry="11"/><ellipse cx="234" cy="44" rx="15" ry="9"/></g>',
      '<g fill="#ffffff" opacity=".7"><ellipse cx="84" cy="72" rx="18" ry="9"/><ellipse cx="98" cy="68" rx="12" ry="7"/></g>',
      '<path d="M0 202 Q60 170 120 202 T240 202 T340 198 L340 240 L0 240 Z" fill="url(#grassG)"/>',
      '<g>',
      '<rect x="40" y="70" width="240" height="30" fill="#fff8e1" opacity=".9"/>',
      '<rect x="40" y="130" width="240" height="30" fill="#e8f4fd" opacity=".9"/>',
      '<line x1="40" y1="70" x2="280" y2="70" stroke="#b08948" stroke-width="2.5" stroke-linecap="round"/>',
      '<line x1="40" y1="100" x2="280" y2="100" stroke="#e8a33d" stroke-width="1.6" stroke-dasharray="7 5"/>',
      '<line x1="40" y1="130" x2="280" y2="130" stroke="#e8a33d" stroke-width="1.6" stroke-dasharray="7 5"/>',
      '<line x1="40" y1="160" x2="280" y2="160" stroke="#b08948" stroke-width="2.5" stroke-linecap="round"/>',
      '<line x1="40" y1="70" x2="40" y2="160" stroke="#b08948" stroke-width="2.5" stroke-linecap="round"/>',
      '<line x1="280" y1="70" x2="280" y2="160" stroke="#b08948" stroke-width="2.5" stroke-linecap="round"/>',
      '</g>',
      '<text class="hero-letter" :class="{writing: heroAnim}" :key="heroN" x="160" :y="heroY" text-anchor="middle" dominant-baseline="central" :font-size="heroFs" fill="#e65100" font-weight="bold" font-family="KaiTi,STKaiti,SimKai,serif">{{hero.s}}</text>',
      '<text x="160" y="196" text-anchor="middle" font-size="13" fill="#5d4037">{{hero.pos}}｜{{hero.tip}}</text>',
      '</svg>',
      '<div class="hero-side">',
      '<div class="hero-name">{{hero.s}}</div>',
      '<div class="hero-poschip" :class="posCls(hero.pos)">{{hero.pos}}</div>',
      '<button class="btn spk" @click="readPy(hero.s)">🔊 听读音</button>',
      '<button class="btn" @click="shuffleWrite">🔀 换一批</button>',
      '</div>',
      '</div>',
      '<div class="sxs-wrap">',
      '<div class="sxscard" v-for="(c, i) in writeCards" :key="c.s" :class="[posCls(c.pos), {on: hero.s === c.s, reading: readIdx === i}]" @click="pickWrite(c)">',
      '<div class="sxs" :class="posCls(c.pos)"><span class="sxs-letter">{{c.s}}</span></div>',
      '<div class="sxs-pos">{{c.pos}}</div><div class="sxs-name">{{c.s}}</div>',
      '</div>',
      '</div>',
      '<div class="ctr"><button class="btn spk" @click="readWriteAll">🔊 按顺序读全部字母</button></div>',
      '<div class="hint">👆 点一点字母卡，大字格教你把字母写在对的地方（占格：中格 / 上中格 / 中下格 / 上中下格）</div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'compose\'">',
      '<div class="pz-intro">🧩 一个音节 = <b>声母</b> + <b>韵母</b>（再加声调）。把它们拼起来：</div>',
      '<div class="compose">',
      '<div class="cpart"><span class="clab">声母</span><span class="cval">{{compose.q.parts[0]}}</span></div>',
      '<span class="cplus">+</span>',
      '<div class="cpart"><span class="clab">韵母</span><span class="cval">{{compose.q.parts[1]}}</span></div>',
      '<span class="cplus">=</span>',
      '<div class="cpart cres"><span class="clab">拼出来</span><span class="cval">{{compose.res || "？"}}</span></div>',
      '</div>',
      '<div class="ctr">',
      '<button class="btn spk" @click="pinCompose">🔊 拼一拼</button>',
      '<button class="btn next" @click="newCompose">下一组 ▶</button></div>',
      '<div class="gfb" :class="compose.fbCls" v-html="compose.fb"></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'blend\'">',
      '<div class="qtext">把下面两部分<b>拼</b>起来，是哪个音节？</div>',
      '<div class="blend-show">{{blend.q.show}}</div>',
      '<div class="opts"><div class="opt" v-for="(o, i) in blend.q.opts" :key="i" :class="blendCls(i)" @click="answerBlend(i)">{{o}}</div></div>',
      '<div class="gfb" :class="blend.fbCls" v-html="blend.fb"></div>',
      '<div class="ctr"><button class="btn spk" @click="readPy(blend.q.full)">🔊 听一听</button>',
      '<button class="btn next" @click="newBlend">下一题 ▶</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'mem\'">',
      '<div class="pz-intro">🧠 用口诀记住拼音长什么样：</div>',
      '<div class="mem-wrap">',
      '<div class="memcard" v-for="(c, i) in memCards" :key="i" :class="{reading: memIdx === i}" @click="readPy(c.k)">',
      '<div class="mem-k">{{c.k}}</div><div class="mem-tip">{{c.tip}}</div></div>',
      '</div>',
      '<div class="ctr"><button class="btn spk" @click="readMemAll">🔊 按顺序读全部</button></div>',
      '<div class="hint">👆 点一张，读一读这个拼音</div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'tone\'">',
      '<div class="qtext">这个拼音是 <b>{{tone.q.syl}}</b>（{{tone.q.zi}}），它读第几声？</div>',
      '<div class="tone-show">{{tone.q.syl}}</div>',
      '<div class="opts"><div class="opt" v-for="(o, i) in tone.q.opts" :key="i" :class="quizCls(tone, i)" @click="answerQuiz(tone, i)">{{o}}</div></div>',
      '<div class="gfb" :class="tone.fbCls" v-html="tone.fb"></div>',
      '<div class="ctr"><button class="btn spk" @click="readPy(tone.q.syl)">🔊 听一听</button>',
      '<button class="btn next" @click="newTone">下一题 ▶</button></div>',
      '</div>',
      '<div class="card lpanel" v-show="tab === \'fill\'">',
      '<div class="qtext">下面的拼音是 <b>{{fill.q.py}}</b>，应该写哪个字？</div>',
      '<div class="fill-show">{{fill.q.py}}</div>',
      '<div class="opts"><div class="opt" v-for="(o, i) in fill.q.opts" :key="i" :class="quizCls(fill, i)" @click="answerQuiz(fill, i)">{{o}}</div></div>',
      '<div class="gfb" :class="fill.fbCls" v-html="fill.fb"></div>',
      '<div class="ctr"><button class="btn next" @click="newFill">下一题 ▶</button></div>',
      '</div>',
      '</site-shell>'
    ].join(""),
    data: function () {
      return {
        tabs: [
          { k: "write", t: "📝 写法" }, { k: "compose", t: "🧩 组成" }, { k: "blend", t: "🔗 拼读" },
          { k: "mem", t: "🧠 记忆" }, { k: "tone", t: "🎵 四声" }, { k: "fill", t: "✏️ 填字" }
        ],
        tab: "write",
        writeCards: U.shuffled(PZ.writeCards()),
        hero: { s: "b", pos: "上中格", tip: "" },
        heroN: 0, heroAnim: true,
        memCards: PZ.memoryCards(),
        /* ★2026-10-26 按顺序朗读时，当前正在读的卡片高亮（金黄色边框） */
        readIdx: -1,
        memIdx: -1,
        compose: blank(PZ.composeQuiz()),
        blend: blank(PZ.blendQuiz()),
        tone: blank(PZ.toneQuiz()),
        fill: blank(PZ.fillQuiz())
      };
    },
    mounted: function () {
      Speech.autoRead("拼音专区，先学写法，再练拼读！");
      var first = this.writeCards[0];
      if (first) this.hero = { s: first.s, pos: first.pos, tip: PZ.MEM[first.s] || "" };
      // 进页面就把第一道题念出来（题目 + 选项），等欢迎语念完再接上
      var self = this;
      setTimeout(function () { self.sayQuiz(self.tone.q, "tone"); }, 2800);
    },
    computed: {
      heroY: function () {
        return this.hero.pos === "上中格" ? 85 : this.hero.pos === "中下格" ? 145 : 115;
      },
      heroFs: function () { return this.hero.pos === "上中下格" ? 68 : 58; }
    },
    methods: {
      posCls: function (pos) {
        return pos === "上中格" ? "p-upmid" : pos === "中下格" ? "p-middown" : pos === "上中下格" ? "p-all" : "p-mid";
      },
      pickWrite: function (c) {
        this.hero = { s: c.s, pos: c.pos, tip: PZ.MEM[c.s] || "" };
        this.heroN++; this.heroAnim = true;
        Speech.speakPinyin(c.s, { rate: 0.7 });
      },
      shuffleWrite: function () { this.writeCards = U.shuffled(PZ.writeCards()); },
      readPy: function (s) { Speech.speakPinyin(s, { rate: 0.7 }); },
      /* ★2026-10-26 用户要求：按顺序读时，先把方框高亮成金黄色+显示边框，再念 */
      readWriteAll: function () {
        var self = this, arr = [];
        (this.writeCards || []).forEach(function (c, i) {
          arr.push(function () { self.readIdx = i; self.hero = { s: c.s, pos: c.pos, tip: PZ.MEM[c.s] || "" }; });
          arr.push(c.s);
        });
        arr.push(function () { self.readIdx = -1; });
        Speech.seq(arr);
      },
      readMemAll: function () {
        var self = this, arr = [];
        (this.memCards || []).forEach(function (c, i) {
          arr.push(function () { self.memIdx = i; });
          arr.push(c.k);
        });
        arr.push(function () { self.memIdx = -1; });
        Speech.seq(arr);
      },
      quizCls: function (box, i) {
        if (!box.done) return {};
        var ok = i === box.q.ans;
        return { x: true, ok: ok, no: !ok };
      },
      blendCls: function (i) { return this.quizCls(this.blend, i); },
      newCompose: function () { this.compose = blank(PZ.composeQuiz()); },
      newBlend: function () { this.blend = blank(PZ.blendQuiz()); },
      newTone: function () { this.tone = blank(PZ.toneQuiz()); this.sayQuiz(this.tone.q, "tone"); },
      newFill: function () { this.fill = blank(PZ.fillQuiz()); this.sayQuiz(this.fill.q, "fill"); },
      // 出题后先念题目，再把选项一个个念出来
      sayQuiz: function (q, mode) {
        if (!q || !App.Speech) return;
        var t = "";
        if (mode === "tone") t = "这个拼音是" + (q.syl || "") + "，" + (q.zi || "") + "。它读第几声？";
        else if (mode === "fill") t = "看拼音" + (q.py || "") + "，请选出正确的字。";
        else t = q.q || q.t || q.text || "";
        if (App.ReadQ) App.ReadQ.readText(t, q.opts, { force: true });
        else App.Speech.speak(t);
      },
      pinCompose: function () {
        var q = this.compose.q;
        this.compose.res = q.blended;
        this.compose.fb = "拼出来是 <b>" + q.blended + "</b> → " + q.word;
        this.compose.fbCls = "gfb good";
        Speech.speakPinyin(q.blended, { rate: 0.7 });
        var self = this;
        setTimeout(function () { Speech.speak(q.word); }, 900);
      },
      answerBlend: function (i) {
        var box = this.blend, q = box.q;
        if (box.done) return;
        box.done = true; box.picked = i;
        var ok = i === q.ans;
        box.fb = (ok ? "✔ 真棒！" : "✘ 再想想：正确答案是 ") + "<span class='gexplain'>" + (ok ? "" : (q.ansWord || q.opts[q.ans])) + "</span>";
        box.fbCls = "gfb " + (ok ? "good" : "bad");
        if (ok) {
          U.confetti(12); Speech.sfx.right();
          Speech.speakPinyin(q.full, { rate: 0.7 });
          var self = this;
          setTimeout(function () { Speech.speak(q.ansWord); }, 900);
          App.Store.addStars(1);
        } else { Speech.sfx.wrong(); }
      },
      answerQuiz: function (box, i) {
        var q = box.q;
        if (box.done) return;
        box.done = true; box.picked = i;
        var ok = i === q.ans;
        box.fb = (ok ? "✔ 真棒！" : "✘ 再想想：正确答案是 ") + "<span class='gexplain'>" + (ok ? "" : (q.ansWord || q.opts[q.ans])) + "</span>";
        box.fbCls = "gfb " + (ok ? "good" : "bad");
        if (ok) {
          U.confetti(12); Speech.sfx.right(); App.Store.addStars(1);
          if (box === this.tone) Speech.speak(q.note); else Speech.speakPinyin(q.py);
        } else { Speech.sfx.wrong(); }
      }
    }
  };
})(window);
