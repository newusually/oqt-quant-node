/*
 * content-math.js — 业务层 / 数学测试卷 内置题库（生成器）
 * 覆盖：口算、比大小、看图列式、填空、解决问题、思考题、乘法初步、除法初步、混合运算。
 * 每题带 kp(知识点) 与 teach(针对性讲解)，供答错讲解与薄弱点追踪。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U, IMG = App.IMG;

  function qKouSuan() {
    if (Math.random() < 0.6) {
      var a = U.R(2, 8), b = U.R(1, 9 - a);
      if (Math.random() < 0.5)
        return { type: "n", tag: "口算", kp: "加法", teach: "按顺序加：" + a + "+" + b + "=" + (a + b) + "。",
          say: a + " 加 " + b + " 等于几？", html: "<div class='bigq'>" + a + " ＋ " + b + " ＝ ？</div>", ans: a + b, eq: a + "＋" + b + "＝" + (a + b) };
      var c = a + b;
      return { type: "n", tag: "口算", kp: "减法", teach: "从总数里减：" + c + "-" + b + "=" + a + "。",
        say: c + " 减 " + b + " 等于几？", html: "<div class='bigq'>" + c + " － " + b + " ＝ ？</div>", ans: a, eq: c + "－" + b + "＝" + a };
    }
    var x = U.R(6, 9), y = U.R(3, 9);
    return { type: "n", tag: "口算·进位", kp: "进位加法", teach: "凑十法：" + x + "+" + y + "，先把 " + y + " 分成 " + (10 - x) + " 和 " + (y - (10 - x)) + "，10+" + (y - (10 - x)) + "=" + (x + y) + "。",
      say: x + " 加 " + y + " 等于几？", html: "<div class='bigq'>" + x + " ＋ " + y + " ＝ ？</div>", ans: x + y, eq: x + "＋" + y + "＝" + (x + y) + "（凑十）" };
  }

  function qBi() {
    var a, b, mode = Math.random();
    if (mode < 0.5) { a = U.R(3, 10); b = U.R(3, 10); }
    else if (mode < 0.8) { var x = U.R(2, 5), y = U.R(1, 4); a = x + y; b = U.R(4, 10); }
    else { var m = U.R(5, 10), n = U.R(2, 4); a = m - n; b = U.R(1, 9); }
    var cmp = a > b ? ">" : (a < b ? "<" : "=");
    return { type: "cmp", tag: "比大小", kp: "比大小", teach: "先比十位，再比个位：" + a + (cmp === ">" ? " 大于 " : cmp === "<" ? " 小于 " : " 等于 ") + b + "。",
      say: "比较大小：" + a + " 和 " + b + "，填大于号、小于号还是等于号？", html: "<div class='bigq'>" + a + " <span class='circ'>？</span> " + b + "</div>", cmp: cmp, eq: a + " " + cmp + " " + b };
  }

  function qPic() {
    var e = U.pick(IMG.ids("动物").concat(IMG.ids("水果"))), add = Math.random() < 0.5;
    if (add) { var a = U.R(2, 6), b = U.R(2, 6);
      return { type: "n", tag: "看图列式", kp: "看图加法", teach: "把图上两部分合起来用加法：" + a + "+" + b + "=" + (a + b) + "。",
        say: "看图：" + a + " 加 " + b + " 等于几？", html: "<div class='bigq'>？ ＝ □ ＋ □</div>", scene: [["add", e, a, b]], ans: a + b, eq: a + "＋" + b + "＝" + (a + b) }; }
    var c = U.R(5, 10), d = U.R(2, c - 2);
    return { type: "n", tag: "看图列式", kp: "看图减法", teach: "从总数里去掉划走的用减法：" + c + "-" + d + "=" + (c - d) + "。",
      say: "看图：一共 " + c + " 个，划走 " + d + " 个，还剩几个？", html: "<div class='bigq'>？ ＝ □ － □</div>", scene: [["sub", e, c, d]], ans: c - d, eq: c + "－" + d + "＝" + (c - d) };
  }

  function qFill() {
    var kind = U.R(1, 4);
    if (kind === 1) { var n = U.R(3, 9);
      return { type: "n", tag: "填空", kp: "按顺序数数", teach: "按 1 个 1 个往后数：" + n + "、" + (n + 1) + "、" + (n + 2) + "、" + (n + 3) + "。",
        say: "按顺序填数：" + n + "、" + (n + 1) + "、几、" + (n + 3) + "？", html: "<div class='bigq'>" + n + "、" + (n + 1) + "、（ ？ ）、" + (n + 3) + "</div>", ans: n + 2, eq: n + "、" + (n + 1) + "、" + (n + 2) + "、" + (n + 3) }; }
    if (kind === 2) { var a = U.R(1, 9), b = U.R(1, 9);
      return { type: "n", tag: "填空", kp: "数的合成", teach: a + " 和 " + b + " 合起来是 " + (a + b) + "。",
        say: a + " 和 " + b + " 合起来是几？", html: "<div class='bigq'>" + a + " 和 " + b + " 合起来是（ ？ ）</div>", ans: a + b, eq: a + "＋" + b + "＝" + (a + b) }; }
    if (kind === 3) { var t = 1, o = U.R(1, 9), num = t * 10 + o;
      return { type: "n", tag: "填空", kp: "数的组成", teach: num + " 里面有 " + t + " 个十和 " + o + " 个一。",
        say: num + " 里面有 " + t + " 个十和几个一？", html: "<div class='bigq'>" + num + " 里面有 " + t + " 个十和（ ？ ）个一</div>", ans: o, eq: num + "＝" + t + "个十＋" + o + "个一" }; }
    var mm = U.R(5, 9);
    return { type: "n", tag: "填空", kp: "比大小", teach: "比 " + mm + " 大 1、比 " + (mm + 2) + " 小 1 的数是 " + (mm + 1) + "。",
      say: "比 " + mm + " 大、比 " + (mm + 2) + " 小的数是几？", html: "<div class='bigq'>比 " + mm + " 大、比 " + (mm + 2) + " 小的数是（ ？ ）</div>", ans: mm + 1, eq: mm + "＜" + (mm + 1) + "＜" + (mm + 2) };
  }

  function qWord() {
    var e = U.pick(IMG.ids("动物").concat(IMG.ids("植物")));
    var tpl = U.pick([
      { t: function (a, b) { return "树上有 " + a + " 只小鸟，飞走了 " + b + " 只，树上还剩几只？"; }, op: "-", u: "只", kp: "减法求剩余" },
      { t: function (a, b) { return "盘子里有 " + a + " 个草莓，小明吃了 " + b + " 个，还剩几个？"; }, op: "-", u: "个", kp: "减法求剩余" },
      { t: function (a, b) { return "花坛左边有 " + a + " 朵红花，右边有 " + b + " 朵黄花，一共有多少朵花？"; }, op: "+", u: "朵", kp: "加法求总数" },
      { t: function (a, b) { return "停车场有 " + a + " 辆车，又开来 " + b + " 辆，一共有多少辆？"; }, op: "+", u: "辆", kp: "加法求总数" },
      { t: function (a, b) { return "小明有 " + a + " 颗糖，小红有 " + b + " 颗，小明比小红多几颗？"; }, op: "d", u: "颗", kp: "求相差" }
    ]);
    var a, b;
    if (tpl.op === "-") { a = U.R(6, 10); b = U.R(2, a - 2); }
    else if (tpl.op === "+") { a = U.R(2, 6); b = U.R(2, 6); }
    else { a = U.R(5, 10); b = U.R(2, a - 1); }
    var ans = tpl.op === "-" ? a - b : (tpl.op === "+" ? a + b : a - b);
    var eq = a + (tpl.op === "-" ? "－" : tpl.op === "+" ? "＋" : "－") + b + "＝" + ans + "（" + tpl.u + "）";
    return { type: "n", tag: "解决问题", kp: tpl.kp,
      teach: (tpl.op === "-" ? "从总数去掉一部分用减法：" : tpl.op === "+" ? "两部分合起来用加法：" : "大数减小数求相差：") + eq + "。",
      say: tpl.t(a, b), html: "<div class='qtext' style='text-align:center'>" + tpl.t(a, b) + "</div>",
      scene: [[tpl.op === "-" ? "sub" : "add", e, a, b]], ans: ans, eq: eq };
  }

  function qThink() {
    if (Math.random() < 0.5) {
      var st = U.pick([[1, 3, 5, 7], [2, 4, 6, 8], [5, 10, 15, 20], [3, 6, 9, 12]]);
      var d = st[1] - st[0], nx1 = st[3] + d, nx2 = st[3] + 2 * d;
      return { type: "n", tag: "思考题", kp: "找规律", teach: "每次加 " + d + "：" + st.join("、") + "、接下来是 " + nx1 + "、" + nx2 + "。",
        say: "找规律填数：" + st.join("、") + "，接下来填几？", html: "<div class='bigq'>" + st.join("、") + "、（ ？ ）、（ ？ ）</div>", ans: nx1, eq: "规律：每次加 " + d + " → " + nx1 + "、" + nx2 };
    }
    var k = U.R(3, 5), m = U.R(2, 4), nn = k + m - 1;
    return { type: "n", tag: "思考题", kp: "排队问题", teach: "从前数第 " + k + "、从后数第 " + m + "，总人数 = " + k + "+" + m + "-1=" + nn + "（人），减去多算的自己一次。",
      say: "小朋友排队，从前面数小明排第 " + k + " 个，从后面数排第 " + m + " 个，一共有几人？",
      html: "<div class='qtext' style='text-align:center'>从前面数第 <b>" + k + "</b> 个，从后面数第 <b>" + m + "</b> 个，一共几人？</div>",
      scene: [["line", k, m]], ans: nn, eq: k + "＋" + m + "－1＝" + nn + "（人）" };
  }

  function qMult() {
    var a = U.R(2, 4), b = U.R(2, 4);
    return { type: "n", tag: "乘法初步", kp: "乘法初步", teach: a + " 个 " + b + " 相加，可以写成 " + a + "×" + b + "＝" + (a * b) + "。乘法是“几个几”的简便写法。",
      say: a + " 个 " + b + " 相加等于几？也可以写成 " + a + " 乘 " + b + "。", html: "<div class='bigq'>" + a + " × " + b + " ＝ ？</div>", ans: a * b, eq: a + "×" + b + "＝" + (a * b) };
  }
  function qDiv() {
    var b = U.R(2, 4), q = U.R(2, 4), a = b * q;
    return { type: "n", tag: "除法初步", kp: "除法初步", teach: "把 " + a + " 个平均分成 " + b + " 份，每份 " + q + " 个：" + a + "÷" + b + "＝" + q + "。除法是“平均分”。",
      say: a + " 个桃平均分成 " + b + " 份，每份几个？", html: "<div class='bigq'>" + a + " ÷ " + b + " ＝ ？</div>", ans: q, eq: a + "÷" + b + "＝" + q };
  }
  function qMixed() {
    var pick = U.R(0, 2);
    if (pick === 0) { var a = U.R(2, 5), b = U.R(2, 5), c = U.R(2, 5);
      return { type: "n", tag: "加减混合", kp: "加减混合", teach: "从左到右算：" + a + "+" + b + "-" + c + "=" + (a + b - c) + "。",
        say: a + " 加 " + b + " 减 " + c + " 等于几？", html: "<div class='bigq'>" + a + " ＋ " + b + " － " + c + " ＝ ？</div>", ans: a + b - c, eq: a + "＋" + b + "－" + c + "＝" + (a + b - c) }; }
    if (pick === 1) { var x = U.R(2, 4), y = U.R(2, 4);
      return { type: "n", tag: "乘除混合", kp: "混合运算", teach: "先算乘法：" + x + "×" + y + "+1=" + (x * y + 1) + "。",
        say: x + " 乘 " + y + " 加 1 等于几？", html: "<div class='bigq'>" + x + " × " + y + " ＋ 1 ＝ ？</div>", ans: x * y + 1, eq: x + "×" + y + "＋1＝" + (x * y + 1) }; }
    var p = U.R(3, 6), q2 = U.R(2, 4);
    return { type: "n", tag: "加减混合", kp: "加减混合", teach: "从左到右算：" + p + "-" + q2 + "+" + q2 + "=" + p + "。",
      say: p + " 减 " + q2 + " 加 " + q2 + " 等于几？", html: "<div class='bigq'>" + p + " － " + q2 + " ＋ " + q2 + " ＝ ？</div>", ans: p, eq: p + "－" + q2 + "＋" + q2 + "＝" + p };
  }

  App.Banks.register("math", {
    gens: [
      { gen: qKouSuan, weight: 3 }, { gen: qBi, weight: 2 }, { gen: qPic, weight: 2 },
      { gen: qFill, weight: 2 }, { gen: qWord, weight: 2 }, { gen: qThink, weight: 1 },
      { gen: qMult, weight: 1 }, { gen: qDiv, weight: 1 }, { gen: qMixed, weight: 1 }
    ]
  });
  App.MathContent = { qKouSuan: qKouSuan, qBi: qBi, qPic: qPic, qFill: qFill, qWord: qWord, qThink: qThink, qMult: qMult, qDiv: qDiv, qMixed: qMixed };
})(window);
