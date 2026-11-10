/*
 * seo.js — 基础层 / 搜索引擎优化（JS 动态 SEO）
 * 页面是 Vue 动态渲染的，HTML 很瘦；本模块在挂载时补齐：
 *   title / description / keywords / OG / Twitter Card / canonical / JSON-LD 结构化数据。
 * 再配合仓库根的 robots.txt + sitemap.xml，Google/百度可正常收录动态页面。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var SITE = "一年级趣味学习乐园";
  var BASE = "https://newusually.github.io/first-grade-learning-land/";

  function setMeta(name, content, attr) {
    if (!content) return;
    var sel = "meta[" + (attr || "name") + "=\"" + name + "\"]";
    var el = document.head.querySelector(sel);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attr || "name", name);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }
  function setLink(rel, href) {
    if (!href) return;
    var el = document.head.querySelector("link[rel=\"" + rel + "\"]");
    if (!el) {
      el = document.createElement("link");
      el.setAttribute("rel", rel);
      document.head.appendChild(el);
    }
    el.setAttribute("href", href);
  }
  function setJsonLd(obj) {
    var old = document.getElementById("seo-jsonld");
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var s = document.createElement("script");
    s.type = "application/ld+json";
    s.id = "seo-jsonld";
    s.textContent = JSON.stringify(obj);
    document.head.appendChild(s);
  }

  /*
   * 页面 SEO 表：key = data-view，desc/keywords 供搜索引擎，title 供标题栏
   * 新增页面只需在这里加一行。
   */
  var PAGES = {
    home:         { title: SITE + " - 人教版语文数学英语同步学习", desc: "一年级趣味学习乐园：人教版语文、数学、英语同步学习，口算动画、拼音四线三格、看图应用题、英语单词、成长故事，全部自动语音读题。", kw: "一年级,语文,数学,英语,人教版,口算,拼音,学习乐园" },
    abacus:       { title: "口算动画课堂 - 加减乘除混合运算动画演示", desc: "10以内加减法、凑十法、乘除法、混合运算，用小动物动画一步步演示，还有动物叫声和语音讲解。", kw: "口算,一年级数学,凑十法,加减法,动画课堂" },
    problems:     { title: "看图学应用题 - 一年级数学看图列式", desc: "看图列式学应用题：含量词的正确表达、加减法情境题，自动读题配图讲解。", kw: "看图应用题,一年级数学,列式,看图学数学" },
    math:         { title: "数学测试卷 - 一年级上册随机出题", desc: "一年级数学上册测试卷：随机出题、自动读题、错题讲解、薄弱点巩固。", kw: "数学测试卷,一年级上册,练习题,随机出题" },
    chinese:      { title: "语文测试卷 - 拼音字词句子练习", desc: "一年级语文测试卷：拼音、组词、反义词、造句、连词成句，自动读题，答错有讲解。", kw: "语文测试卷,一年级语文,组词,拼音,造句" },
    chineseLearn: { title: "语文学习小课堂 - 拼音认读认字背课文", desc: "拼音跟读（标准呼读音）、认字卡片、组词造句、一年级上册课文跟读背诵。", kw: "拼音跟读,认字,课文背诵,一年级语文" },
    pinyinZone:   { title: "拼音专区 - 四线三格写法与拼读练习", desc: "拼音专区：四线三格规范写法（每个字母的占格）、声母韵母、两拼三拼、四声朗读、组词填字。", kw: "拼音,四线三格,声母,韵母,拼读,一年级拼音" },
    writingZone:  { title: "写作专区 - 看图写话量词标点练习", desc: "写作专区：仿写句子、连词成句、量词运用、标点符号，每题配图并自动朗读。", kw: "看图写话,量词,标点,造句,一年级语文" },
    englishZone:  { title: "英语专区 - 字母单词自然拼读", desc: "英语专区：26 个字母、常用单词、自然拼读 CVC、句子跟读，标准英语发音。", kw: "英语启蒙,字母,单词,自然拼读,一年级英语" },
    englishTest:  { title: "英语测试 - 字母单词听力与拼写", desc: "英语测试：听音选图、单词拼写、选词填空，标准英语发音自动播放。", kw: "英语测试,英语听力,单词拼写,一年级英语" },
    growth:       { title: "成长小课堂 - 安全与好习惯小故事", desc: "成长小课堂：身体红绿灯、尊重他人、遇到危险会求助等安全与好习惯故事，配音动画。", kw: "成长故事,安全教育,好习惯,一年级" },
    review:       { title: "巩固练习 - 数学语文英语薄弱点专练", desc: "巩固练习：自动收集数学、语文、英语的薄弱知识点，针对性出题巩固。", kw: "巩固练习,薄弱点,复习,一年级" },
    lessons:      { title: "教案中心 - 1-6年级人教版语文数学英语教案", desc: "教案中心：1到6年级人教版语文、数学、英语分年级教案，含教学目标、重难点、教学过程。", kw: "教案,人教版,一年级到六年级,语文教案,数学教案,英语教案" },
    dataLib:      { title: "数据宝库 - 常用字词语乘法口诀单位换算英语单词", desc: "数据宝库：3799 常用字拼音、2万常用词、乘法口诀、单位换算、图形认识、英语单词，分类分页查询。", kw: "常用字,词语,乘法口诀,单位换算,英语单词,数据" },
    examCenter:   { title: "试卷中心 - 1080套小学试卷语文数学英语", desc: "试卷中心：1080 套小学试卷，覆盖 1-6 年级语文、数学、英语，74115 道题目在线练习，自动批改，单元测试、期中期末、专项练习、提升挑战。", kw: "小学试卷,单元测试,期中试卷,期末试卷,练习题,语文,数学,英语,自动批改" }
  };

  function apply(view) {
    var p = PAGES[view] || PAGES.home;
    document.title = p.title;
    setMeta("description", p.desc);
    setMeta("keywords", p.kw);
    setMeta("author", SITE);
    setMeta("robots", "index, follow");
    setMeta("og:type", "website", "property");
    setMeta("og:title", p.title, "property");
    setMeta("og:description", p.desc, "property");
    setMeta("og:url", BASE + location.pathname.split("/").pop(), "property");
    setMeta("og:site_name", SITE, "property");
    setMeta("og:locale", "zh_CN", "property");
    setMeta("twitter:card", "summary", "name");
    setMeta("twitter:title", p.title, "name");
    setMeta("twitter:description", p.desc, "name");
    setLink("canonical", BASE + location.pathname.split("/").pop());
    setJsonLd({
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": SITE,
      "url": BASE,
      "inLanguage": "zh-CN",
      "description": PAGES.home.desc,
      "publisher": { "@type": "Organization", "name": SITE }
    });
  }

  // 运行时改标题/描述（如筛选年级后）
  function set(title, desc) {
    if (title) document.title = title;
    if (desc) setMeta("description", desc);
  }

  App.SEO = { apply: apply, set: set, PAGES: PAGES, BASE: BASE };
})(window);
