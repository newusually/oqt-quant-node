/*
 * content-writing.js — 业务层 / 写作专区 内容
 * 模块：看图写话、句子仿写、连词成句、量词搭配、标点练习。
 * 数据驱动：视图（views/writing-zone-view.js）负责渲染与交互。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U;

  // 看图写话：图片 + 提示词 + 范例句
  var PICTURE = [
    { img: "sun", words: ["太阳", "红红", "天上"], model: "红红的太阳挂在天上。" },
    { img: "cat", words: ["小猫", "可爱", "吃鱼"], model: "可爱的小猫在吃鱼。" },
    { img: "flower", words: ["花朵", "美丽", "公园"], model: "公园里的花朵真美丽。" },
    { img: "bird", words: ["小鸟", "飞", "天上"], model: "小鸟在天上飞来飞去。" },
    { img: "tree", words: ["大树", "绿绿", "风"], model: "风一吹，大树绿绿的叶子沙沙响。" },
    { img: "fish", words: ["小鱼", "游", "水里"], model: "小鱼在水里快活地游。" },
    { img: "rabbit", words: ["兔子", "长耳朵", "跳"], model: "长耳朵的兔子蹦蹦跳跳。" },
    { img: "apple", words: ["苹果", "红", "吃"], model: "红红的苹果真好吃。" },
    { img: "dog", words: ["小狗", "摇尾巴", "高兴"], model: "小狗高兴地摇尾巴。" },
    { img: "star", words: ["星星", "夜空", "亮"], model: "夜空中的星星亮晶晶。" }
  ];

  // 句子仿写：给范例 + 模板（带空）+ 选项
  var IMITATE = [
    { img: "boy", model: "妈妈爱我。", tmpl: "____ 爱我。", opts: ["爸爸", "石头", "白云"], ans: 0 },
    { img: "fish", model: "小鸟在天上飞。", tmpl: "小鱼在 ____。", opts: ["水里游", "天上飞", "树上跳"], ans: 0 },
    { img: "sun", model: "弯弯的月儿像小船。", tmpl: "红红的 ____ 像火球。", opts: ["太阳", "小草", "石头"], ans: 0 },
    { img: "girl", model: "妹妹在画画。", tmpl: "哥哥在 ____。", opts: ["写字", "开花", "下雨"], ans: 0 },
    { img: "apple", model: "花儿真美丽！", tmpl: "____ 真好吃！", opts: ["苹果", "书本", "大山"], ans: 0 }
  ];

  // 连词成句：正确顺序的词串
  var ORDER = [
    { img: "heart", words: ["我", "爱", "妈妈", "。"], correct: [0, 1, 2, 3] },
    { img: "bird", words: ["小鸟", "在", "天上", "飞", "。"], correct: [0, 1, 2, 3, 4] },
    { img: "sun", words: ["太阳", "从", "东边", "升起来", "。"], correct: [0, 1, 2, 3, 4] },
    { img: "book", words: ["我们", "去", "上学", "。"], correct: [0, 1, 2, 3] },
    { img: "flower", words: ["花儿", "真", "美丽", "。"], correct: [0, 1, 2, 3] },
    { img: "girl", words: ["妹妹", "在", "画画", "。"], correct: [0, 1, 2, 3] },
    { img: "sunflower", words: ["春天", "来了", "，", "花儿", "开了", "。"], correct: [0, 1, 2, 3, 4, 5] }
  ];

  // 量词搭配
  var MEASURE = [
    { img: "cow", noun: "牛", opts: ["头", "朵", "条"], ans: 0 },
    { img: "flower", noun: "花", opts: ["朵", "本", "只"], ans: 0 },
    { img: "fish", noun: "鱼", opts: ["条", "头", "个"], ans: 0 },
    { img: "book", noun: "书", opts: ["本", "片", "匹"], ans: 0 },
    { img: "bird", noun: "鸟", opts: ["只", "朵", "棵"], ans: 0 },
    { img: "kid", noun: "人", opts: ["个", "匹", "条"], ans: 0 },
    { img: "leaf", noun: "树叶", opts: ["片", "本", "头"], ans: 0 },
    { img: "horse", noun: "马", opts: ["匹", "只", "朵"], ans: 0 }
  ];

  // 标点练习
  var PUNCT = [
    { img: "kid", sent: "你吃饭了吗", opts: ["。", "？", "！", "，"], ans: 1 },
    { img: "sun", sent: "今天天气真好", opts: ["。", "？", "！", "，"], ans: 0 },
    { img: "flower", sent: "春天来了花儿开了", opts: ["。", "？", "！", "，"], ans: 0 },
    { img: "star", sent: "这是什么", opts: ["。", "？", "！", "，"], ans: 1 },
    { img: "bird", sent: "小鸟飞得真高啊", opts: ["。", "？", "！", "，"], ans: 2 },
    { img: "balloon", sent: "我们一起去玩吧", opts: ["。", "？", "！", "，"], ans: 2 },
    { img: "heart", sent: "妈妈在厨房做饭", opts: ["。", "？", "！", "，"], ans: 0 },
    { img: "teacher", sent: "你是小学生吗", opts: ["。", "？", "！", "，"], ans: 1 }
  ];

  function pictureWrite() { return U.pick(PICTURE); }
  function imitateQuiz() { return U.pick(IMITATE); }
  function orderQuiz() {
    var t = U.pick(ORDER);
    return { words: t.words, correct: t.correct, shuffled: U.shuffled(t.words) };
  }
  function measureQuiz() { return U.pick(MEASURE); }
  function punctQuiz() { return U.pick(PUNCT); }

  App.WritingZone = {
    PICTURE: PICTURE, IMITATE: IMITATE, ORDER: ORDER, MEASURE: MEASURE, PUNCT: PUNCT,
    pictureWrite: pictureWrite, imitateQuiz: imitateQuiz, orderQuiz: orderQuiz,
    measureQuiz: measureQuiz, punctQuiz: punctQuiz
  };
})(window);
