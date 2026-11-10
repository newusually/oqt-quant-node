/*
 * content-chinese-learn.js — 业务层 / 语文学习小课堂 内容
 * 模块：拼音认读跟读、认字卡片、组词造句引导、课文背诵、知识点总结（分类整理）。
 * 数据驱动，视图（views/chinese-learn-view.js）负责渲染与交互。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U;

  // 声母 / 韵母 / 整体认读
  var pinyin = {
    shengmu: ["b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "zh", "ch", "sh", "z", "c", "s", "y", "w"],
    yunmu: ["a", "o", "e", "i", "u", "ü", "ai", "ei", "ui", "ao", "ou", "iu", "ie", "üe", "er", "an", "en", "in", "un", "ün", "ang", "eng", "ing", "ong"],
    zhengti: ["zhi", "chi", "shi", "ri", "zi", "ci", "si", "yi", "wu", "yu", "ye", "yue", "yuan", "yin", "yun", "ying"],
    examples: { "b": "bà ba 爸爸", "m": "mā ma 妈妈", "h": "huā 花", "x": "xiǎo 小", "sh": "shù 树", "a": "à 啊", "o": "ō 喔", "e": "é 鹅", "ai": "ài 爱", "an": "ān 安", "ang": "áng 昂" }
  };

  // 认字卡（字 + 拼音 + 配图）
  var characters = [
    { zi: "日", py: "rì", cat: "自然", img: "sun" }, { zi: "月", py: "yuè", cat: "自然", img: "star" },
    { zi: "水", py: "shuǐ", cat: "自然", img: "fish" }, { zi: "火", py: "huǒ", cat: "自然", img: "flower" },
    { zi: "木", py: "mù", cat: "植物", img: "tree" }, { zi: "山", py: "shān", cat: "自然", img: "tree" },
    { zi: "石", py: "shí", cat: "自然", img: "star" }, { zi: "田", py: "tián", cat: "自然", img: "grass" },
    { zi: "人", py: "rén", cat: "人", img: "rabbit" }, { zi: "口", py: "kǒu", cat: "人", img: "pig" },
    { zi: "手", py: "shǒu", cat: "人", img: "monkey" }, { zi: "耳", py: "ěr", cat: "人", img: "cat" },
    { zi: "鸟", py: "niǎo", cat: "动物", img: "bird" }, { zi: "虫", py: "chóng", cat: "动物", img: "bee" },
    { zi: "花", py: "huā", cat: "植物", img: "flower" }, { zi: "草", py: "cǎo", cat: "植物", img: "grass" },
    { zi: "大", py: "dà", cat: "反义", img: "elephant" }, { zi: "小", py: "xiǎo", cat: "反义", img: "chick" },
    { zi: "上", py: "shàng", cat: "方位", img: "star" }, { zi: "下", py: "xià", cat: "方位", img: "leaf" }
  ];

  // 一年级上册课文（节选，可跟读/背诵）
  var texts = [
    { title: "《天地人》", body: "天地人，你我他。", tip: "认识“天、地、人、你、我、他”六个字。" },
    { title: "《金木水火土》", body: "一二三四五，金木水火土。天地分上下，日月照今古。", tip: "背诵五行与方位词。" },
    { title: "《对韵歌》", body: "云对雨，雪对风。花对树，鸟对虫。山清对水秀，柳绿对桃红。", tip: "对对子：字数一样、意思相对。" },
    { title: "《秋天》", body: "天气凉了，树叶黄了。一片片叶子从树上落下来。", tip: "注意“一”的变调：yí piàn。" },
    { title: "《小小的船》", body: "弯弯的月儿小小的船，小小的船儿两头尖。", tip: "背诵比喻句：月儿像小船。" },
    { title: "《江南》", body: "江南可采莲，莲叶何田田。鱼戏莲叶间。", tip: "背诵并想象采莲的画面。" },
    { title: "《四季》", body: "草芽尖尖，他对小鸟说：“我是春天。”", tip: "背诵拟人句，认识四季。" },
    { title: "《画》", body: "远看山有色，近听水无声。春去花还在，人来鸟不惊。", tip: "背诵谜语诗，理解反义词。" }
  ];

  // 知识点总结（分类整理）
  var summary = [
    { cat: "拼音", points: ["23 个声母、24 个韵母、16 个整体认读音节", "j、q、x 和 ü 相拼，ü 要去掉两点", "“一”的变调：yí 个、yì 起", "标调口诀：有 a 不放过，没 a 找 o、e"] },
    { cat: "识字", points: ["象形字：日、月、水、火、木、山像图画", "会写基本笔顺：先横后竖、先撇后捺", "区分形近字：人/入、木/本、大/天"] },
    { cat: "词语", points: ["量词：只、条、朵、本、个、片", "反义词：大—小、多—少、上—下、男—女", "AABB 词：开开心心、快快乐乐"] },
    { cat: "句子", points: ["把词连成通顺的话：谁+在哪里+做什么", "用“像”写比喻：弯弯的月儿像小船", "用“因为…所以…”说原因"] },
    { cat: "背诵", points: ["《金木水火土》《对韵歌》《小小的船》《江南》", "背诵时声音响亮、不添字不掉字", "先理解意思再背，记得更牢"] }
  ];

  // 组词引导练习
  var ZUCI = [
    { zi: "水", words: ["水果", "河水", "开水"] }, { zi: "大", words: ["大人", "大门", "大山"] },
    { zi: "木", words: ["木头", "树木", "木马"] }, { zi: "天", words: ["天空", "天气", "春天"] },
    { zi: "风", words: ["大风", "风雨", "风筝"] }, { zi: "火", words: ["火苗", "火山", "火光"] },
    { zi: "口", words: ["门口", "开口", "口水"] }, { zi: "土", words: ["土地", "泥土", "土豆"] }
  ];
  function guidedZuci() {
    var t = U.pick(ZUCI);
    var opts = U.shuffled(t.words.concat(["大风", "开心", "雨水"])).slice(0, 3);
    return { zi: t.zi, words: t.words, opts: opts, ans: opts.indexOf(t.words[0]) >= 0 ? opts.indexOf(t.words[0]) : 0 };
  }
  // 造句引导：给词，提供主语/谓语模板选项
  var ZAOJU = [
    { word: "高兴", tmpl: ["我今天很____。", ["高兴", "大班", "山水"]] },
    { word: "朋友", tmpl: ["他是我的好____。", ["朋友", "大门", "风雨"]] },
    { word: "春天", tmpl: ["____花开了。", ["春天", "大风", "山水"]] },
    { word: "读书", tmpl: ["我爱____。", ["读书", "开门", "风雨"]] },
    { word: "学校", tmpl: ["我去____上学。", ["学校", "山水", "开口"]] }
  ];
  function guidedZaoju() {
    var t = U.pick(ZAOJU);
    return { word: t.word, tmpl: t.tmpl[0], opts: t.tmpl[1], ans: 0 };
  }

  App.ChineseLearn = {
    pinyin: pinyin, characters: characters, texts: texts, summary: summary,
    guidedZuci: guidedZuci, guidedZaoju: guidedZaoju
  };
})(window);
