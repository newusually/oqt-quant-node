/*
 * content-chinese.js — 业务层 / 语文测试卷 内置题库（生成器）
 * 题型：看拼音写词、选读音(多音字)、数笔画、量词、课文填空、阅读理解、反义词连线、看图说话。
 * 每题带 kp(知识点) 与 teach(讲解)。生成器每次重抽 → 题目无限变种。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U;

  var PINYIN = [
    { py: "tiān shàng", w: "天上" }, { py: "bái yún", w: "白云" }, { py: "xiǎo niǎo", w: "小鸟" },
    { py: "dà xiǎo", w: "大小" }, { py: "ér zi", w: "儿子" }, { py: "xià yǔ", w: "下雨" },
    { py: "shuǐ niú", w: "水牛" }, { py: "mù mǎ", w: "木马" }, { py: "rì yuè", w: "日月" },
    { py: "xiǎo shān", w: "小山" }, { py: "dà huǒ", w: "大火" }, { py: "shàng xià", w: "上下" },
    { py: "péng yǒu", w: "朋友" }, { py: "kuài lè", w: "快乐" }, { py: "xiě zì", w: "写字" }, { py: "gāo xìng", w: "高兴" }
  ];
  var DUOYIN = [
    { w: "长（　）大", opts: ["zhǎng", "cháng"], a: 0, teach: "“长大”的“长”读 zhǎng（生长）。" },
    { w: "数（　）一数", opts: ["shǔ", "shù"], a: 0, teach: "“数一数”的“数”读 shǔ（动词）。" },
    { w: "一（　）只鸟", opts: ["yī", "yì"], a: 1, teach: "“一只鸟”的“一”在第四声前读 yì。" },
    { w: "朋（　）友", opts: ["péng", "pén"], a: 0, teach: "“朋友”的“朋”读 péng。" },
    { w: "水（　）牛", opts: ["shuǐ", "suǐ"], a: 0, teach: "“水牛”的“水”读 shuǐ。" }
  ];
  var STROKES = [
    { w: "月", n: 4 }, { w: "水", n: 4 }, { w: "书", n: 4 }, { w: "鸟", n: 5 }, { w: "火", n: 4 },
    { w: "山", n: 3 }, { w: "田", n: 5 }, { w: "木", n: 4 }, { w: "五", n: 4 }, { w: "风", n: 4 }
  ];
  var LIANGCI = [
    { w: "一（　）小鸟", opts: ["只", "头", "本"], a: 0 }, { w: "一（　）黄牛", opts: ["个", "头", "条"], a: 1 },
    { w: "一（　）书", opts: ["本", "朵", "只"], a: 0 }, { w: "一（　）花", opts: ["朵", "头", "本"], a: 0 },
    { w: "一（　）鱼", opts: ["条", "个", "本"], a: 0 }, { w: "一（　）叶子", opts: ["片", "只", "本"], a: 0 },
    { w: "一（　）人", opts: ["个", "朵", "头"], a: 0 }, { w: "一（　）白云", opts: ["朵", "个", "本"], a: 0 }
  ];
  var KEWEN = [
    { q: "一去二三里，烟村（　）（　）家。", opts: ["四五", "六七", "二三"], a: 0, teach: "课文：一去二三里，烟村四五家。" },
    { q: "弯弯的月儿（　　）的船。", opts: ["小小", "大大", "圆圆"], a: 0, teach: "课文：弯弯的月儿小小的船。" },
    { q: "春去（　）还在，人来鸟不惊。", opts: ["花", "草", "山"], a: 0, teach: "课文：春去花还在，人来鸟不惊。" },
    { q: "床前明月（　），疑是地上霜。", opts: ["光", "亮", "白"], a: 0, teach: "课文：床前明月光，疑是地上霜。" },
    { q: "谁知盘（　）餐，粒粒皆辛苦。", opts: ["中", "上", "下"], a: 0, teach: "课文：谁知盘中餐，粒粒皆辛苦。" }
  ];
  var READING = [
    { passage: "小白兔和小灰兔去采蘑菇。天上<b>下</b>起了小雨，它们<b>躲</b>到大树下。小白兔把自己的<b>伞</b>给小灰兔，两只小兔都没有<b>淋</b>湿。",
      qs: [{ q: "下雨了，它们躲到了什么下面？", opts: ["大树下", "屋子里", "山上"], a: 0 },
           { q: "谁把伞给了小灰兔？", opts: ["小白兔", "小灰兔", "小鸟"], a: 0 },
           { q: "两只小兔淋湿了吗？", opts: ["没有淋湿", "都淋湿了", "只有一只淋湿"], a: 0 }] },
    { passage: "羊妈妈带着小羊到菜园收菜。羊妈妈说：“萝卜的根最好吃。”走到白菜地：“白菜的叶子才好吃呢！”走到西红柿地：“要吃西红柿的果实呀！”",
      qs: [{ q: "它们到了哪些地方？", opts: ["萝卜地、白菜地、西红柿地", "果园、田野、山坡", "超市、厨房、餐厅"], a: 0 },
           { q: "西红柿的什么最好吃？", opts: ["果实", "叶子", "根"], a: 0 },
           { q: "萝卜的什么最好吃？", opts: ["根", "叶子", "花"], a: 0 }] }
  ];
  var ANTONYM = [["大", "小"], ["多", "少"], ["上", "下"], ["来", "去"], ["男", "女"], ["远", "近"], ["黑", "白"], ["前", "后"], ["出", "入"], ["老", "少"], ["开", "关"], ["高", "矮"]];
  var SHUOXIE = [
    { scene: "☀️ 🌳 🐰 🥕 🐢", say: "看图说话：太阳出来了，草地上有小兔子和小乌龟。说一说：图上有谁？在做什么？心情怎么样？", teach: "说清楚“谁、在哪里、做什么”就很棒。" },
    { scene: "🌧️ 🐦 🌂 🏠", say: "看图说话：下雨了，小鸟没有伞。说一说：小鸟怎么了？谁能帮帮它？", teach: "先说看到的，再说想法，句子就完整了。" },
    { scene: "🌳 🐵 🍌 🍌 🍌", say: "看图说话：树上有小猴子，还有三根香蕉。说一说：小猴子在做什么？它开心吗？", teach: "加上“有…有…”和“开心/高兴”会更生动。" }
  ];

  function qPinyin() {
    var t = U.pick(PINYIN);
    var wrong = U.shuffled(PINYIN.filter(function (x) { return x.w !== t.w; })).slice(0, 3);
    var opts = U.shuffled([t].concat(wrong)).map(function (x) { return x.w; });
    return { type: "choice", tag: "看拼音写词", kp: "拼音", teach: t.py + " 对应的词是“" + t.w + "”。",
      say: "看拼音，选词语：" + t.py + "。", html: "<div class='py' style='text-align:center'>" + t.py + "</div><div class='hint'>👆 选出和拼音对应的词语</div>",
      opts: opts, ans: opts.indexOf(t.w), speakAns: t.w };
  }
  function qDuoyin() {
    var t = U.pick(DUOYIN);
    return { type: "choice", tag: "选读音", kp: "多音字", teach: t.teach,
      say: t.w.replace("（　）", "什么读音") + " 选 " + t.opts[0] + " 还是 " + t.opts[1] + "？",
      html: "<div class='bigword' style='font-size:32px'>" + t.w + "</div><div class='hint'>👆 选出正确的读音</div>",
      opts: t.opts, ans: t.a, speakAns: t.opts[t.a] };
  }
  function qStrokes() {
    var t = U.pick(STROKES);
    var opts = U.shuffled([t.n, t.n + 1, t.n - 1]).filter(function (v, i, a) { return a.indexOf(v) === i; }).map(String);
    return { type: "choice", tag: "数笔画", kp: "汉字笔画", teach: "“" + t.w + "”字共 " + t.n + " 画。",
      say: "“" + t.w + "”字共有几画？", html: "<div class='bigword' style='font-size:48px'>" + t.w + "</div><div class='hint'>👆 数一数，选笔画数</div>",
      opts: opts, ans: opts.indexOf(String(t.n)), speakAns: t.w + "字共" + t.n + "画" };
  }
  function qLiangci() {
    var t = U.pick(LIANGCI);
    return { type: "choice", tag: "量词", kp: "量词", teach: t.w.replace("（　）", "括号里填“" + t.opts[t.a] + "”") + "。",
      say: t.w.replace("（　）", "什么量词") + "？", html: "<div class='bigword' style='font-size:30px'>" + t.w + "</div>",
      opts: t.opts, ans: t.a, speakAns: t.opts[t.a] };
  }
  function qKewen() {
    var t = U.pick(KEWEN);
    return { type: "choice", tag: "课文填空", kp: "课文积累", teach: t.teach,
      say: t.say || ("按课文填空：" + t.q), html: "<div style='font-size:24px;text-align:center;line-height:2'>" + t.q + "</div>",
      opts: t.opts, ans: t.a, speakAns: t.opts[t.a] };
  }
  function qReading() {
    var r = U.pick(READING);
    var qq = U.pick(r.qs);
    return { type: "choice", tag: "阅读理解", kp: "阅读理解", teach: "答案在短文里找：" + qq.opts[qq.a] + "。",
      say: qq.q, passage: r.passage,
      html: "<div style='font-size:16px;line-height:2;text-indent:2em;border:1px solid #e3d6f7;border-radius:12px;padding:10px 14px;background:#faf7ff'>" + r.passage + "</div><div style='margin-top:10px;text-align:center'>" + qq.q + "</div>",
      opts: U.shuffled(qq.opts), ans: -1, _raw: qq, speakAns: null };
  }
  function qAntonym() {
    var pairs = U.shuffled(ANTONYM).slice(0, 4);
    var left = pairs.map(function (p) { return p[0]; });
    var right = U.shuffled(pairs.map(function (p) { return p[1]; }));
    return { type: "match", tag: "反义词连线", kp: "反义词", teach: "反义词意思相反，如：大—小、多—少、上—下。",
      say: "把意思相反的词连起来。", pairs: pairs.slice(), left: left, right: right, speakAns: null };
  }
  function qShuoxie() {
    var t = U.pick(SHUOXIE);
    return { type: "speak", tag: "看图说话", kp: "表达", teach: t.teach,
      say: t.say, html: "<div style='font-size:52px;text-align:center;letter-spacing:10px;margin:14px 0'>" + t.scene + "</div><div class='hint'>👆 大声说一说，说完点「说好啦」</div>" };
  }

  // 组词：给一个字，选出含有这个字的词语（词典驱动：多个选项都可能正确）
  // 词库来自 services/nlp.js（KID_WORDS 儿童词表 + 2 万常用词表），不是写死的单个答案
  var ZUCI_ZI = ["大", "水", "天", "人", "口", "手", "日", "月", "山", "田", "火", "木", "花", "草", "鸟", "虫", "鱼", "马", "牛", "羊", "上", "下", "云", "雨", "风", "电", "书", "笔", "本", "心", "白", "红", "车", "门", "米", "果", "树", "叶", "衣", "生", "学", "校", "同", "老", "师", "家", "国", "中", "爱"];
  function qZuci() {
    var zi = U.pick(ZUCI_ZI);
    var good = (App.NLP ? App.NLP.wordsWith(zi) : []).slice(0, 4);
    if (good.length < 2) good = ["大人", "大山", "大小", "大门"];
    // 干扰项：别字的常用词（一定不含本字）
    var others = [], i, k, zi2, ws;
    var pool = U.shuffled(ZUCI_ZI.filter(function (x) { return x !== zi; })).slice(0, 6);
    for (i = 0; i < pool.length; i++) {
      zi2 = pool[i];
      ws = App.NLP ? App.NLP.wordsWith(zi2) : [];
      if (ws.length) others.push(ws[0]);
    }
    var bad = U.shuffled(others).slice(0, 2);
    var opts = U.shuffled(good.concat(bad));
    return { type: "choice", tag: "组词", kp: "组词",
      say: "用“" + zi + "”字组词，选出含有“" + zi + "”字的词语。",
      html: "<div class='bigword' style='font-size:40px'>" + zi + " ——（ ？ ）</div><div class='hint'>👆 选出含有“" + zi + "”的词语（可能有多个都对）</div>",
      opts: opts, accept: good, ans: opts.indexOf(good[0]), speakAns: good[0],
      teach: "“" + zi + "”可以组成：" + good.join("、") + " 等。" };
  }

  // 造句：选出哪一句最通顺
  var ZAOJU = [
    { word: "高兴", good: "我今天很高兴。", bad: ["高兴我。", "很高兴天。"] },
    { word: "学校", good: "我去学校上学。", bad: ["学校我。", "去学校我上。"] },
    { word: "朋友", good: "他是我的好朋友。", bad: ["朋友他。", "好我的朋友。"] },
    { word: "春天", good: "春天花开了。", bad: ["春天我。", "开花春天。"] },
    { word: "读书", good: "我爱读书。", bad: ["读书我。", "爱读书我。"] }
  ];
  function qZaoju() {
    var t = U.pick(ZAOJU);
    var opts = U.shuffled([t.good].concat(t.bad));
    return { type: "choice", tag: "造句", kp: "造句", teach: "用“" + t.word + "”造句，通顺的一句是：" + t.good,
      say: "用“" + t.word + "”造句，哪一句最通顺？", html: "<div style='font-size:20px;text-align:center;line-height:1.8'>用“<b>" + t.word + "</b>”造句，选最通顺的一句：</div>",
      opts: opts, ans: opts.indexOf(t.good), speakAns: t.good };
  }

  // 连词成句：把乱序的词排成一句
  var LIANCI = [
    { words: ["我", "爱", "妈妈"], ans: "我爱妈妈。" },
    { words: ["小鸟", "在", "飞"], ans: "小鸟在飞。" },
    { words: ["春天", "花开", "了"], ans: "春天开花了。" },
    { words: ["我们", "去", "学校"], ans: "我们去学校。" },
    { words: ["太阳", "升", "起来"], ans: "太阳升起来。" }
  ];
  function qLianci() {
    var t = U.pick(LIANCI);
    var shuffled = U.shuffled(t.words);
    var rawOpts = [t.ans, t.words.slice().reverse().join("") + "。", t.words.join("") + "。"];
    return { type: "choice", tag: "连词成句", kp: "连词成句", teach: "正确的句子是：" + t.ans,
      say: "把这几个词连成一句通顺的话。", html: "<div style='font-size:22px;text-align:center;line-height:2'>把这些词排成一句话：<br><b>" + shuffled.join("　") + "</b></div>",
      opts: U.shuffled(rawOpts.slice()), ans: -1, _raw: { ans: t.ans, opts: rawOpts }, speakAns: t.ans };
  }

  App.Banks.register("chinese", {
    gens: [
      { gen: qPinyin, weight: 2 }, { gen: qDuoyin, weight: 1 }, { gen: qStrokes, weight: 1 },
      { gen: qLiangci, weight: 1 }, { gen: qKewen, weight: 1 }, { gen: qReading, weight: 1 },
      { gen: qAntonym, weight: 1 }, { gen: qShuoxie, weight: 1 },
      { gen: qZuci, weight: 1 }, { gen: qZaoju, weight: 1 }, { gen: qLianci, weight: 1 }
    ]
  });
  App.ChineseContent = { qPinyin: qPinyin, qDuoyin: qDuoyin, qStrokes: qStrokes, qLiangci: qLiangci, qKewen: qKewen, qReading: qReading, qAntonym: qAntonym, qShuoxie: qShuoxie };
})(window);
