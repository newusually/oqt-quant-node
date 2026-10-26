/*
 * content-english.js — 业务层 / 英语专区 内容
 * 模块：字母、单词、组词(CVC拼写)、句子、完形填空、听力、背诵、记忆妙招。
 * 英文朗读使用 App.Speech.speakEn（需设备支持英文语音，无则静默）。
 * 数据驱动：视图（views/english-zone-view.js）负责渲染与交互。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U;

  // 字母表：大写 / 小写 / 例词 / 中文 / 配图（部分有图）
  var LETTERS = [
    { up: "A", low: "a", word: "apple", zh: "苹果", img: "apple" },
    { up: "B", low: "b", word: "banana", zh: "香蕉", img: "banana" },
    { up: "C", low: "c", word: "cat", zh: "猫", img: "cat" },
    { up: "D", low: "d", word: "dog", zh: "狗", img: "dog" },
    { up: "E", low: "e", word: "elephant", zh: "大象", img: "elephant" },
    { up: "F", low: "f", word: "fish", zh: "鱼", img: "fish" },
    { up: "G", low: "g", word: "gift", zh: "礼物", img: "gift" },
    { up: "H", low: "h", word: "heart", zh: "爱心", img: "heart" },
    { up: "I", low: "i", word: "bee", zh: "蜜蜂", img: "bee" },
    { up: "L", low: "l", word: "leaf", zh: "树叶", img: "leaf" },
    { up: "M", low: "m", word: "monkey", zh: "猴子", img: "monkey" },
    { up: "O", low: "o", word: "orange", zh: "橘子", img: "orange" },
    { up: "P", low: "p", word: "pig", zh: "猪", img: "pig" },
    { up: "R", low: "r", word: "rabbit", zh: "兔子", img: "rabbit" },
    { up: "S", low: "s", word: "sun", zh: "太阳", img: "sun" },
    { up: "T", low: "t", word: "tree", zh: "树", img: "tree" },
    { up: "W", low: "w", word: "watermelon", zh: "西瓜", img: "watermelon" },
    { up: "X", low: "x", word: "fox", zh: "狐狸", img: "" },
    { up: "Y", low: "y", word: "yellow", zh: "黄色", img: "star" },
    { up: "Z", low: "z", word: "zebra", zh: "斑马", img: "" }
  ];

  // 单词卡
  var VOCAB = [
    { en: "cat", zh: "猫", img: "cat" }, { en: "dog", zh: "狗", img: "dog" },
    { en: "sun", zh: "太阳", img: "sun" }, { en: "tree", zh: "树", img: "tree" },
    { en: "flower", zh: "花", img: "flower" }, { en: "fish", zh: "鱼", img: "fish" },
    { en: "bird", zh: "鸟", img: "bird" }, { en: "book", zh: "书", img: "book" },
    { en: "star", zh: "星星", img: "star" }, { en: "apple", zh: "苹果", img: "apple" },
    { en: "red", zh: "红色", img: "" }, { en: "blue", zh: "蓝色", img: "" },
    { en: "happy", zh: "开心", img: "heart" }, { en: "big", zh: "大的", img: "elephant" },
    { en: "small", zh: "小的", img: "chick" }, { en: "one", zh: "一", img: "" },
    { en: "two", zh: "二", img: "" }, { en: "I", zh: "我", img: "" }
  ];

  // 组词（CVC 拼写）：用配图提示，把字母拼成单词
  var CVC = [
    { word: "cat", img: "cat" }, { word: "dog", img: "dog" }, { word: "sun", img: "sun" },
    { word: "pig", img: "pig" }, { word: "duck", img: "duck" }, { word: "bee", img: "bee" },
    { word: "book", img: "book" }, { word: "tree", img: "tree" }, { word: "star", img: "star" },
    { word: "fish", img: "fish" }, { word: "bird", img: "bird" }, { word: "red", img: "" }
  ];
  var EXTRA_LETTERS = ["x", "z", "m", "k", "p", "b", "t", "n", "w", "g"];
  function cvcQuiz() {
    var t = U.pick(CVC);
    var letters = t.word.split("");
    var pool = EXTRA_LETTERS.filter(function (l) { return letters.indexOf(l) < 0; });
    var extra = U.shuffled(pool).slice(0, Math.min(2, pool.length));
    var tiles = U.shuffled(letters.concat(extra));
    return { word: t.word, img: t.img, tiles: tiles };
  }

  // 句子（连词成句，英文）
  var SENTENCES = [
    { words: ["I", "like", "cats", "."], correct: [0, 1, 2, 3] },
    { words: ["The", "sun", "is", "red", "."], correct: [0, 1, 2, 3, 4] },
    { words: ["A", "dog", "is", "big", "."], correct: [0, 1, 2, 3, 4] },
    { words: ["I", "see", "a", "bird", "."], correct: [0, 1, 2, 3, 4] },
    { words: ["We", "go", "to", "school", "."], correct: [0, 1, 2, 3, 4] },
    { words: ["I", "am", "happy", "."], correct: [0, 1, 2, 3] }
  ];
  function sentenceQuiz() {
    var t = U.pick(SENTENCES);
    return { words: t.words, correct: t.correct, shuffled: U.shuffled(t.words) };
  }

  // 完形填空（一句一空）
  var CLOZE = [
    { text: "The ___ is red.", opts: ["apple", "cat", "sun"], ans: 0 },
    { text: "I see a ___ .", opts: ["dog", "book", "tree"], ans: 0 },
    { text: "A ___ can swim.", opts: ["fish", "bird", "star"], ans: 0 },
    { text: "The ___ is green.", opts: ["tree", "flower", "pig"], ans: 0 },
    { text: "I like ___ .", opts: ["cats", "sun", "red"], ans: 0 },
    { text: "A ___ is in the sky.", opts: ["star", "dog", "book"], ans: 0 }
  ];
  function clozeQuiz() { return U.pick(CLOZE); }

  // 听力：听英文，选听到的词
  var LISTEN = [
    { say: "cat", opts: ["cat", "cap", "cup"], ans: 0 },
    { say: "sun", opts: ["sun", "son", "soon"], ans: 0 },
    { say: "book", opts: ["book", "look", "cook"], ans: 0 },
    { say: "red", opts: ["red", "bed", "led"], ans: 0 },
    { say: "tree", opts: ["tree", "three", "free"], ans: 0 },
    { say: "fish", opts: ["fish", "dish", "wish"], ans: 0 },
    { say: "dog", opts: ["dog", "log", "fog"], ans: 0 },
    { say: "I like apples", opts: ["I like apples", "I like cats", "I like red"], ans: 0 }
  ];
  function listenQuiz() {
    var t = U.pick(LISTEN);
    var opts = U.shuffled(t.opts);           // 先洗牌
    return { say: t.say, opts: opts, ans: opts.indexOf(t.opts[0]) };  // ans 必须按洗牌后的位置算
  }

  // 背诵（英文儿歌 / chant）
  var RECITE = [
    { title: "ABC Song", text: "A B C D E F G, H I J K L M N O P, Q R S, T U V, W X Y and Z." },
    { title: "Twinkle Twinkle", text: "Twinkle twinkle little star, how I wonder what you are." },
    { title: "One Two", text: "One two three four five, once I caught a fish alive." },
    { title: "Happy Song", text: "If you're happy and you know it, clap your hands." }
  ];

  // 如何好记（记忆妙招）
  var TIPS = [
    { t: "🖼️ 联想记忆", d: "把单词和画面连起来：cat 想到小猫，sun 想到太阳，记住更快。" },
    { t: "🗂️ 分类记忆", d: "把词分堆：动物(cat/dog/fish)、颜色(red/blue)、数字(one/two)。" },
    { t: "🔤 自然拼读", d: "c-a-t 读 /k/ /æ/ /t/，会拼就会读，读多了就记住。" },
    { t: "🃏 卡片记忆", d: "正面写英文，反面写中文，随时抽一张考考自己。" },
    { t: "👂 多听多读", d: "每天听一听、跟着读，嘴巴和耳朵一起记，最牢固。" },
    { t: "✍️ 边写边记", d: "手写单词三遍，眼睛看、手在写、嘴在念，三重记忆。" }
  ];

  // 阅读理解：从 data/english/reading.js 抽一篇一个问题
  function readingQuiz() {
    var rd = App.DATA && App.DATA.english && App.DATA.english.reading;
    if (!rd || !rd.pages) return null;
    var it = U.pick(U.pick(rd.pages).items);
    var q = U.pick(it.qs);
    var opts = U.shuffled(q.opts.slice());
    return {
      type: "reading", title: it.t, passage: it.passage, cn: it.cn || "",
      q: q.q, opts: opts, ans: opts.indexOf(q.opts[q.ans]), why: q.why, kp: "阅读理解"
    };
  }

  // 自然拼读：判断字母/组合的发音
  function phonicsQuiz() {
    var ph = App.DATA && App.DATA.english && App.DATA.english.phonics;
    if (!ph || !ph.pages) return null;
    var pages = ph.pages.filter(function (p) { return p.id !== "ph6" && p.id !== "ph7"; });
    var it = U.pick(U.pick(pages).items);
    if (!it.w || !it.w.length || !it.s) return null;
    var snd = it.s.split("；")[0].split(" ")[0];
    var all = [];
    pages.forEach(function (p) {
      p.items.forEach(function (x) {
        if (x.s) all.push(x.s.split("；")[0].split(" ")[0]);
      });
    });
    var others = U.shuffled(all.filter(function (x) { return x !== snd; })).slice(0, 2);
    var opts = U.shuffled([snd].concat(others));
    return {
      type: "phonics", q: "“" + it.t + "”发什么音？（例词：" + U.pick(it.w) + "）",
      opts: opts, ans: opts.indexOf(snd), kp: "自然拼读"
    };
  }

  // 注册到题库（供英语测试随机抽题，与真题融合）
  App.Banks.register("english", {
    gens: [
      { gen: function () { var t = cvcQuiz(); return { type: "spell", word: t.word, tiles: t.tiles, kp: "拼写" }; }, weight: 1 },
      { gen: function () { var t = listenQuiz(); return { type: "listen", say: t.say, opts: t.opts, ans: t.ans, kp: "听力" }; }, weight: 1 },
      { gen: function () { var t = clozeQuiz(); return { type: "cloze", text: t.text, opts: t.opts, ans: t.ans, kp: "完形填空" }; }, weight: 1 },
      { gen: function () {
          var v = U.pick(VOCAB);
          var others = U.shuffled(VOCAB.filter(function (x) { return x.en !== v.en; })).slice(0, 2).map(function (x) { return x.en; });
          var opts = U.shuffled([v.en].concat(others));
          return { type: "choice", q: "选出正确的单词：" + v.zh, opts: opts, ans: opts.indexOf(v.en), speak: v.en, kp: "单词" };
        }, weight: 1 },
      { gen: readingQuiz, weight: 2 },
      { gen: phonicsQuiz, weight: 2 }
    ]
  });

  App.EnglishZone = {
    LETTERS: LETTERS, VOCAB: VOCAB, CVC: CVC, SENTENCES: SENTENCES,
    CLOZE: CLOZE, LISTEN: LISTEN, RECITE: RECITE, TIPS: TIPS,
    cvcQuiz: cvcQuiz, sentenceQuiz: sentenceQuiz, clozeQuiz: clozeQuiz, listenQuiz: listenQuiz,
    readingQuiz: readingQuiz, phonicsQuiz: phonicsQuiz
  };
})(window);
