/*
 * content-problems.js — 业务层 / 看图应用题 内置题库（生成器）
 * 特点：每道题都带图片（动物/植物/水果），生成器每次调用重新随机 → 题目无限变种。
 * 题型：add 求和 / sub 求剩余 / add2 连加 / sub2 连减 / ord 序数 / diff 求相差。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U, IMG = App.IMG;

  function ani() { return U.pick(IMG.ids("动物")); }
  function pla() { return U.pick(IMG.ids("植物").concat(IMG.ids("水果"))); }

  // 上下文模板：返回 {ctx, subj, unit} ；e 由调用方给
  var ADD_CTX = [
    { c: "树上", s: "只", w: "小鸟" }, { c: "盘子里", s: "个", w: "苹果" },
    { c: "花坛里", s: "朵", w: "花" }, { c: "草地上", s: "只", w: "小兔" },
    { c: "池塘里", s: "条", w: "小鱼" }, { c: "停车场", s: "辆", w: "汽车" },
    { c: "树上", s: "只", w: "猴子" }, { c: "篮子里", s: "个", w: "桃子" }
  ];
  var SUB_CTX = [
    { c: "树上", s: "只", w: "小鸟", v: "飞走" }, { c: "盘子里", s: "个", w: "草莓", v: "吃掉" },
    { c: "停车场", s: "辆", w: "汽车", v: "开走" }, { c: "小明有", s: "支", w: "铅笔", v: "用去" },
    { c: "池塘里", s: "条", w: "小鱼", v: "游走" }, { c: "小明有", s: "颗", w: "糖", v: "吃掉" }
  ];

  function gAdd(lv) {
    var t = U.pick(ADD_CTX), e = ani();
    var a, b;
    if (lv === 1) { a = U.R(2, 8); b = U.R(2, 8); if (a + b > 10) return null; }
    else if (lv === 2) { a = U.R(10, 15); b = U.R(2, 9 - (a % 10)); }
    else { a = U.R(4, 9); b = U.R(4, 9); if (a + b < 11 || a + b > 19) return null; }
    return {
      kind: "add", text: t.c + "有 " + a + " " + t.s + t.w + "，又来了 " + b + " " + t.s + t.w + "，现在一共有多少" + t.s + "？",
      a: a, b: b, e: e, u: t.s, ans: a + b, eq: a + "＋" + b + "＝" + (a + b),
      kp: "加法求总数", teach: "把两部分合起来用加法：" + a + "+" + b + "=" + (a + b) + "（" + t.s + "）。"
    };
  }
  function gSub(lv) {
    var t = U.pick(SUB_CTX), e = ani();
    var a, b;
    if (lv === 1) { a = U.R(4, 10); b = U.R(2, a - 2); }
    else if (lv === 2) { a = U.R(12, 18); b = U.R(2, a % 10); if (a - b < 2) return null; }
    else { a = U.R(11, 18); b = U.R(a % 10 + 1, 9); if (a - b < 2 || a - b > 9) return null; }
    return {
      kind: "sub", text: t.c + " " + a + " " + t.s + t.w + "，" + t.v + " " + b + " " + t.s + t.w + "，还剩几" + t.s + "？",
      a: a, b: b, e: e, u: t.s, ans: a - b, eq: a + "－" + b + "＝" + (a - b),
      kp: "减法求剩余", teach: "从总数里去掉一部分用减法：" + a + "-" + b + "=" + (a - b) + "（" + t.s + "）。"
    };
  }
  function gAdd2(lv) {
    var e = pla();
    var a = U.R(3, 6), b = U.R(2, 4), c = U.R(2, 4);
    if (lv <= 1 && a + b + c > 10) return null;
    var names = ["小红", "小刚", "小明", "小丽", "小华"];
    var n1 = U.pick(names), n2 = U.pick(names), n3 = U.pick(names);
    return {
      kind: "add2", text: n1 + "跳了 " + a + " 下， " + n2 + "跳 " + b + " 下，" + n3 + "跳 " + c + " 下，三人一共跳多少下？",
      a: a, b: b, c: c, e: e, u: "下", ans: a + b + c, eq: a + "＋" + b + "＋" + c + "＝" + (a + b + c),
      kp: "连加", teach: "把三个数依次相加：" + a + "+" + b + "+" + c + "=" + (a + b + c) + "（下）。"
    };
  }
  function gSub2(lv) {
    var e = ani();
    var a, b, c;
    if (lv <= 1) { a = U.R(8, 10); b = U.R(2, 3); c = U.R(2, Math.max(2, a - b - 2)); if (a - b - c < 1) return null; }
    else { a = U.R(14, 18); b = U.R(3, 5); c = U.R(2, 5); if (a - b - c < 2) return null; }
    return {
      kind: "sub2", text: "停车场有 " + a + " 辆车，先开走 " + b + " 辆，又开走 " + c + " 辆，还剩几辆？",
      a: a, b: b, c: c, e: e, u: "辆", ans: a - b - c, eq: a + "－" + b + "－" + c + "＝" + (a - b - c),
      kp: "连减", teach: "总数里连续减去两次：" + a + "-" + b + "-" + c + "=" + (a - b - c) + "（辆）。"
    };
  }
  function gOrd() {
    var pool = IMG.ids("水果").concat(IMG.ids("动物"));
    var n = U.R(5, 7), row = U.sample(pool, n);
    var k = U.R(2, n);
    return {
      kind: "ord", text: "上面一排图片，从左往右数，第 " + k + " 个是什么？它前面有几个？",
      ans: null, textAns: "第 " + k + " 个是" + IMG.get(row[k - 1]).name + "，前面有 " + (k - 1) + " 个",
      k: k, row: row,
      kp: "序数", teach: "从左数第几个，就是排在第几位；前面有“第几个减 1”个。"
    };
  }
  function gDiff() {
    var e = ani();
    var a = U.R(4, 10), b = U.R(2, a - 1);
    var n1 = U.pick(["小明", "小红", "小刚"]), n2 = U.pick(["妹妹", "弟弟", "小华"]);
    return {
      kind: "diff", text: n1 + "有 " + a + " 颗糖，" + n2 + "有 " + b + " 颗糖，" + n1 + "比" + n2 + "多几颗？",
      a: a, b: b, e: e, u: "颗", ans: a - b, eq: a + "－" + b + "＝" + (a - b) + "（颗）",
      kp: "求相差", teach: "求“多几、少几”用大数减小数：" + a + "-" + b + "=" + (a - b) + "（颗）。"
    };
  }

  // 注册到题库池（生成器 → 每次抽题自动变种）
  App.Banks.register("problems", {
    gens: [
      { gen: gAdd, weight: 3 }, { gen: gSub, weight: 3 },
      { gen: gAdd2, weight: 2 }, { gen: gSub2, weight: 2 },
      { gen: gDiff, weight: 2 }, { gen: gOrd, weight: 1 }
    ]
  });
  App.Problems = { gAdd: gAdd, gSub: gSub, gAdd2: gAdd2, gSub2: gSub2, gOrd: gOrd, gDiff: gDiff };
})(window);
