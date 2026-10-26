/*
 * content-pinyin.js — 业务层 / 拼音专区 内容
 * 模块：写法（四线三格）、组成（声韵调拼合）、拼读、形象记忆、四声朗读、组词填字。
 * 复用 App.ChineseLearn.pinyin 的声母/韵母/整体认读数据，避免重复。
 * 数据驱动：视图（views/pinyin-zone-view.js）负责渲染与交互。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U;
  var PY = (App.ChineseLearn && App.ChineseLearn.pinyin) || { shengmu: [], yunmu: [], zhengti: [], examples: {} };

  // 四线三格占位：中格 / 上中格 / 中下格 / 上中下格
  var POS = {
    b: "上中格", p: "中下格", m: "中格", f: "上中格", d: "上中格", t: "上中格", n: "中格", l: "上中格",
    g: "中下格", k: "上中格", h: "上中格", j: "上中下格", q: "中下格", x: "上中格", zh: "上中格", ch: "上中格",
    sh: "上中格", z: "中格", c: "中格", s: "中格", y: "中下格", w: "中格",
    a: "中格", o: "中格", e: "中格", i: "上中格", u: "中格", "ü": "上中格",
    ai: "中格", ei: "中格", ui: "中格", ao: "中格", ou: "中格", iu: "中格", ie: "中格", "üe": "中格",
    er: "中格", an: "中格", en: "中格", in: "中格", un: "中格", "ün": "中格", ang: "中格", eng: "中格",
    ing: "中格", ong: "中格"
  };
  function posOf(s) { return POS[s] || "中格"; }

  // 形象记忆口诀（声母/单韵母）
  var MEM = {
    b: "b 像广播听广播，右下半圆 b b b", p: "p 像气球向上飘，右上半圆 p p p",
    m: "两个门洞 m m m，蒙眼摸人捉迷藏", f: "爷爷拐杖 f f f，一尊大佛 f f f",
    d: "马蹄声声 d d d，左下半圆 d d d", t: "小伞把儿 t t t，小鱼跳水 t t t",
    n: "一个门洞 n n n，哪吒闹海 n n n", l: "一根小棍 l l l，乐得拍手 l l l",
    g: "9 字加弯 g g g，一只白鸽 g g g", k: "一挺机枪 k k k，蝌蚪戏草 k k k",
    h: "一把椅子 h h h，喝水喝水 h h h", j: "鸡叫 j j j，母鸡捉虫 j j j",
    q: "气球气球 q q q，左上半圆 q q q", x: "西瓜西瓜 x x x，刀切西瓜 x x x",
    z: "平头 2 字 z z z，小熊写字 z z z", c: "刺猬满身 c c c，半个圆圈 c c c",
    s: "蚕儿吐丝 s s s，半个 8 字 s s s", zh: "z 加小椅 zh zh zh，蜘蛛织网 zh zh zh",
    ch: "c 加小椅 ch ch ch，吃鱼吃肉 ch ch ch", sh: "s 加小椅 sh sh sh，狮子大声 sh sh sh",
    r: "种子发芽 r r r，红日东升 r r r", y: "树杈树杈 y y y，衣服衣服 y y y",
    w: "屋顶屋顶 w w w，乌鸦乌鸦 w w w",
    a: "张大嘴巴 a a a，阿姨头发 a a a", o: "圆圆嘴巴 o o o，公鸡打鸣 o o o",
    e: "扁扁嘴巴 e e e，白鹅倒影 e e e", i: "一件衣服 i i i，牙齿对齐 i i i",
    u: "突出嘴巴 u u u，乌龟乌龟 u u u", "ü": "小鱼吐泡 ü ü ü，吹起泡泡 ü ü ü"
  };

  // 有效两拼组合（声母+韵母->示例词）
  var BLEND2 = [
    { sm: "b", ym: "a", word: "bà ba 爸爸" }, { sm: "p", ym: "a", word: "pá 爬" },
    { sm: "m", ym: "a", word: "mā ma 妈妈" }, { sm: "f", ym: "a", word: "fà 头发" },
    { sm: "d", ym: "a", word: "dà 大" }, { sm: "t", ym: "a", word: "tā 他" },
    { sm: "n", ym: "a", word: "nà 那" }, { sm: "l", ym: "a", word: "là 辣" },
    { sm: "g", ym: "e", word: "gē 哥" }, { sm: "k", ym: "e", word: "kē 棵" },
    { sm: "h", ym: "e", word: "hé 河" }, { sm: "m", ym: "i", word: "mǐ 米" },
    { sm: "n", ym: "i", word: "nǐ 你" }, { sm: "l", ym: "i", word: "lí 梨" },
    { sm: "j", ym: "i", word: "jī 鸡" }, { sm: "q", ym: "i", word: "qí 旗" },
    { sm: "x", ym: "i", word: "xǐ 洗" }, { sm: "b", ym: "o", word: "bō 波" },
    { sm: "p", ym: "o", word: "pō 坡" }, { sm: "m", ym: "o", word: "mō 摸" },
    { sm: "h", ym: "u", word: "hú 湖" }, { sm: "g", ym: "u", word: "gǔ 谷" },
    { sm: "k", ym: "u", word: "kù 裤" }, { sm: "sh", ym: "u", word: "shū 书" },
    { sm: "zh", ym: "u", word: "zhú 竹" }, { sm: "ch", ym: "u", word: "chū 出" }
  ];
  // 三拼音节（声母+介母+韵母）
  var BLEND3 = [
    { sm: "j", mid: "i", ym: "a", word: "jiā 家" }, { sm: "q", mid: "i", ym: "a", word: "qiā 掐" },
    { sm: "x", mid: "i", ym: "a", word: "xià 下" }, { sm: "g", mid: "u", ym: "a", word: "guā 瓜" },
    { sm: "k", mid: "u", ym: "a", word: "kuā 夸" }, { sm: "h", mid: "u", ym: "a", word: "huā 花" },
    { sm: "x", mid: "i", ym: "ang", word: "xiāng 香" }, { sm: "l", mid: "i", ym: "ang", word: "liáng 凉" }
  ];

  // 四声示例（带声调字母 + 汉字）
  var TONES = [
    { syl: "mā", zi: "妈", note: "一声平，高高平又平" },
    { syl: "má", zi: "麻", note: "二声扬，从中往上升" },
    { syl: "mǎ", zi: "马", note: "三声拐弯，先降后升" },
    { syl: "mà", zi: "骂", note: "四声降，从高往下落" },
    { syl: "bā", zi: "八", note: "一声平" }, { syl: "bá", zi: "拔", note: "二声扬" },
    { syl: "bǎ", zi: "把", note: "三声拐弯" }, { syl: "bà", zi: "爸", note: "四声降" },
    { syl: "huā", zi: "花", note: "一声平" }, { syl: "huá", zi: "滑", note: "二声扬" },
    { syl: "huǒ", zi: "火", note: "三声拐弯" }, { syl: "huà", zi: "画", note: "四声降" }
  ];

  // 组词填字：给拼音，选正确的字
  var FILL = [
    { py: "bà ba", ans: "爸", dist: ["妈", "哥", "弟"] },
    { py: "mā ma", ans: "妈", dist: ["爸", "姐", "妹"] },
    { py: "dà mǐ", ans: "米", dist: ["来", "木", "水"] },
    { py: "huā duǒ", ans: "花", dist: ["草", "树", "鸟"] },
    { py: "shān shàng", ans: "山", dist: ["石", "田", "水"] },
    { py: "xiǎo niǎo", ans: "鸟", dist: ["虫", "鱼", "马"] },
    { py: "rì yuè", ans: "月", dist: ["日", "星", "云"] },
    { py: "kāi mén", ans: "门", dist: ["口", "手", "耳"] },
    { py: "shù yè", ans: "叶", dist: ["花", "草", "根"] },
    { py: "tián dì", ans: "田", dist: ["山", "石", "土"] }
  ];

  // ---- 生成器 ----
  function writeCards() {
    var letters = PY.shengmu.concat(PY.yunmu);
    return letters.map(function (s) { return { s: s, pos: posOf(s) }; });
  }

  function composeQuiz() {
    var t = U.pick(BLEND2);
    var parts = [t.sm, t.ym];
    var blended = t.sm + t.ym;
    var wrong = U.shuffled(BLEND2.filter(function (x) { return x.sm + x.ym !== blended; })
      .map(function (x) { return x.sm + x.ym; })).slice(0, 3);
    var opts = U.shuffled([blended].concat(wrong));
    return { parts: parts, blended: blended, word: t.word, opts: opts, ans: opts.indexOf(blended) };
  }

  function blendQuiz() {
    var three = Math.random() < 0.4;
    var base = three ? U.pick(BLEND3) : U.pick(BLEND2);
    var full = three ? (base.sm + base.mid + base.ym) : (base.sm + base.ym);
    var ans = base.word;
    var pool = (three ? BLEND3 : BLEND2).filter(function (x) {
      return (three ? (x.sm + x.mid + x.ym) : (x.sm + x.ym)) !== full;
    }).map(function (x) { return x.word; });
    var wrong = U.shuffled(pool).slice(0, 3);
    var opts = U.shuffled([ans].concat(wrong));
    return {
      three: three,
      show: three ? (base.sm + " + " + base.mid + " + " + base.ym) : (base.sm + " + " + base.ym),
      full: full, ansWord: ans, opts: opts, ans: opts.indexOf(ans)
    };
  }

  function memoryCards() {
    // 随机取 6 个有口诀的声母/单韵母
    var keys = Object.keys(MEM);
    return U.shuffled(keys).slice(0, 6).map(function (k) { return { k: k, tip: MEM[k] }; });
  }

  function toneQuiz() {
    var t = U.pick(TONES);
    var mark = t.syl.match(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/);
    var toneNum = mark ? "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ".indexOf(mark[0]) % 4 + 1 : 1;
    var opts = ["一声 平", "二声 扬", "三声 拐弯", "四声 降"];
    return { syl: t.syl, zi: t.zi, note: t.note, opts: opts, ans: toneNum - 1 };
  }

  function fillQuiz() {
    var t = U.pick(FILL);
    var opts = U.shuffled([t.ans].concat(t.dist));
    return { py: t.py, opts: opts, ans: opts.indexOf(t.ans) };
  }

  App.PinyinZone = {
    pinyin: PY, posOf: posOf, MEM: MEM,
    writeCards: writeCards, composeQuiz: composeQuiz, blendQuiz: blendQuiz,
    memoryCards: memoryCards, toneQuiz: toneQuiz, fillQuiz: fillQuiz
  };
})(window);
