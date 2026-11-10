<?php
// ==================================================================
//  s/index.php — 一年级学习乐园 (三层架构 · PHP 页面壳)
// ------------------------------------------------------------------
//  第 1 层 C++ 引擎(jhub.exe :8091): /sapi/* 全部数据 JSON/XML
//  第 2 层 PHP 本文件: 页面骨架 + 配置注入(零计算零数据库)
//  第 3 层 AJAX(s/assets/js/s.js): 全部交互, 无框架(Vue 禁用)
//  风格: 与主站 opt 一致 —— 暗色 ink + 金色强调 + 毛玻璃顶栏
// ==================================================================
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
$ver = '1.0.0';
?><!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<title>一年级学习乐园 · 语文数学英语</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext y='26' font-size='26'%3E%F0%9F%8E%93%3C/text%3E%3C/svg%3E">
<link rel="stylesheet" href="assets/css/s.css?v=<?= $ver ?>">
</head>
<body class="bg-ink-900">

<!-- ═══ 背景卡通层(纯 CSS/SVG 动画, 无图片依赖) ═══ -->
<div class="bg-deco" aria-hidden="true">
  <div class="cloud c1"></div><div class="cloud c2"></div><div class="cloud c3"></div>
  <div class="star s1">⭐</div><div class="star s2">🌟</div><div class="star s3">✨</div>
  <div class="critter a1">🐱</div><div class="critter a2">🐶</div><div class="critter a3">🐰</div>
  <div class="critter a4">🦊</div><div class="critter a5">🐼</div><div class="critter a6">🦁</div>
</div>

<!-- ═══ 顶栏(毛玻璃, 与主站同风格) ═══ -->
<header class="topbar">
  <div class="tb-logo">
    <span class="tb-cap">🎓</span>
    <div class="tb-title">
      <b>一年级学习乐园</b>
      <small>语文 · 数学 · 英语 · 拼音</small>
    </div>
  </div>
  <nav class="tb-nav" id="nav">
    <a href="#/home"    data-v="home"    class="on">🏠 首页</a>
    <a href="#/practice" data-v="practice">✏️ 练习</a>
    <a href="#/exam"    data-v="exam">📝 考试</a>
    <a href="#/pinyin"  data-v="pinyin">🗣️ 拼音</a>
    <a href="#/draw"    data-v="draw">📐 画图</a>
    <a href="#/ai"      data-v="ai">🤖 AI 工具</a>
  </nav>
  <div class="tb-right">
    <span class="tb-clock" id="clock">--:--:--</span>
    <span class="tb-score" id="scoreBox" title="本次会话得分">🏆 0 分</span>
  </div>
</header>

<main class="wrap">

  <!-- ═══════════ 视图: 首页 ═══════════ -->
  <section class="view on" id="v-home">
    <div class="hero">
      <div class="hero-mascot">🐯</div>
      <div class="hero-text">
        <h1>加油, 小小学习家!</h1>
        <p id="heroSub">选择一门学科开始今天的学习吧 ~</p>
      </div>
    </div>
    <h2 class="sec-t">📚 学科乐园 <span class="sec-sub" id="subjCount"></span></h2>
    <div class="grid-subj" id="subjGrid"><!-- JS 渲染学科卡片 --></div>
    <h2 class="sec-t">🎯 知识点热度 <span class="sec-sub">点击直接练这一项</span></h2>
    <div class="kp-tabs" id="kpTabs"></div>
    <div class="kp-list" id="kpList"></div>
  </section>

  <!-- ═══════════ 视图: 练习 ═══════════ -->
  <section class="view" id="v-practice">
    <div class="pr-bar">
      <select id="prSubj" class="ipt"></select>
      <select id="prGrade" class="ipt"><option value="">全部年级</option></select>
      <button class="btn btn-gold" id="prStart">🎲 抽一题</button>
      <span class="pr-tip" id="prTip">选好学科, 点「抽一题」开始; 答错也没关系, AI 老师会讲懂你 ~</span>
    </div>
    <div class="qcard" id="qCard" style="display:none">
      <div class="q-head">
        <span class="q-no" id="qNo">第 1 题</span>
        <span class="q-kp" id="qKp"></span>
        <span class="q-src" id="qSrc"></span>
      </div>
      <div class="q-stem" id="qStem"></div>
      <div class="q-opts" id="qOpts"></div>
      <div class="q-fill" id="qFill" style="display:none">
        <input class="ipt ipt-big" id="qInput" type="text" placeholder="输入答案, 回车提交" autocomplete="off">
        <button class="btn btn-gold" id="qSubmitFill">提交</button>
      </div>
      <div class="q-explain" id="qExplain" style="display:none">
        <div class="ex-head"><span id="exIcon"></span><b id="exTitle"></b></div>
        <div class="ex-body" id="exBody"></div>
        <div class="ex-acts">
          <button class="btn" id="qSay">🔊 读一遍</button>
          <button class="btn btn-gold" id="qNext">下一题 →</button>
        </div>
      </div>
    </div>
    <div class="q-empty" id="qEmpty">👆 先点上面的「抽一题」吧!</div>
  </section>

  <!-- ═══════════ 视图: 考试 ═══════════ -->
  <section class="view" id="v-exam">
    <div class="ex-set" id="exSet">
      <h2 class="sec-t">📝 小小考试 <span class="sec-sub">AI 自动批改, 秒出成绩</span></h2>
      <div class="ex-form">
        <label>学科 <select id="exSubj" class="ipt"></select></label>
        <label>年级 <select id="exGrade" class="ipt"></select></label>
        <label>题数 <select id="exN" class="ipt">
          <option value="5">5 题</option><option value="10" selected>10 题</option>
          <option value="20">20 题</option></select></label>
        <button class="btn btn-gold btn-big" id="exStart">开始考试 🚀</button>
      </div>
      <div class="ex-rules">规则: 全做完点「交卷」; 老师按对错给分, 错题会讲明白。</div>
    </div>
    <div class="ex-ing" id="exIng" style="display:none">
      <div class="ex-progress"><div class="ex-pg-bar" id="exPgBar"></div><span id="exPgTxt"></span></div>
      <div class="qcard" id="exCard"></div>
      <div class="ex-acts">
        <button class="btn" id="exPrev">← 上一题</button>
        <button class="btn btn-gold" id="exNext">下一题 →</button>
        <button class="btn btn-up" id="exSubmit">交卷 ✅</button>
      </div>
    </div>
    <div class="ex-report" id="exReport" style="display:none"></div>
  </section>

  <!-- ═══════════ 视图: 拼音(打开即教) ═══════════ -->
  <section class="view" id="v-pinyin">
    <div class="pr-bar">
      <h2 class="sec-t" style="margin:0">🗣️ 拼音小课堂 <span class="sec-sub">打开就教 · 点格子听发音 · 跟着写</span></h2>
      <input class="ipt" id="pySearch" placeholder="搜汉字 / 拼音, 如: 妈 / mā">
    </div>
    <div class="py-grid" id="pyGrid"></div>
    <div class="py-detail" id="pyDetail" style="display:none">
      <div class="py-big" id="pyBig">妈</div>
      <div class="py-say" id="pySay">mā ma</div>
      <div class="py-acts">
        <button class="btn btn-gold" id="pyPlay">🔊 发音</button>
        <button class="btn" id="pyTrace">✍️ 笔顺描写</button>
      </div>
      <canvas class="py-canvas" id="pyCanvas" width="320" height="320"></canvas>
    </div>
  </section>

  <!-- ═══════════ 视图: 画图(几何教学) ═══════════ -->
  <section class="view" id="v-draw">
    <h2 class="sec-t">📐 画图小课堂 <span class="sec-sub">几何 / 三角 / 辅助线 · 一步一步教</span></h2>
    <div class="dr-lay">
      <div class="dr-board">
        <div class="dr-tools">
          <button class="tbtn on" data-t="pen">✏️ 铅笔</button>
          <button class="tbtn" data-t="line">📏 直线</button>
          <button class="tbtn" data-t="rect">▭ 矩形</button>
          <button class="tbtn" data-t="circle">⭕ 圆</button>
          <button class="tbtn" data-t="eraser">🧽 橡皮</button>
          <span class="dr-colors" id="drColors"></span>
          <button class="tbtn" id="drClear">🗑 清空</button>
          <button class="tbtn" id="drUndo">↩ 撤销</button>
        </div>
        <canvas class="dr-canvas" id="drCanvas" width="860" height="480"></canvas>
        <div class="dr-hint" id="drHint">选好工具, 在黑板上画画吧 ~</div>
      </div>
      <div class="dr-steps">
        <h3>🧑‍🏫 分步教学</h3>
        <div class="dr-tabs" id="drTabs"></div>
        <ol class="dr-list" id="drList"></ol>
      </div>
    </div>
  </section>

  <!-- ═══════════ 视图: AI 工具 ═══════════ -->
  <section class="view" id="v-ai">
    <h2 class="sec-t">🤖 AI 学习助手 <span class="sec-sub">自动批改 · 薄弱分析 · 自动推荐</span></h2>
    <div class="ai-lay">
      <div class="ai-card">
        <h3>💬 问一问</h3>
        <div class="ai-search">
          <input class="ipt" id="aiQ" placeholder="输入问题或关键词, 如: 作文怎么写 / 拼音怎么学 / 20以内加法">
          <button class="btn btn-gold" id="aiGo">搜索</button>
        </div>
        <div class="ai-hits" id="aiHits"><div class="ai-empty">输入关键词, AI 从题库里找最相关的题目讲给你听 ~</div></div>
      </div>
      <div class="ai-card">
        <h3>📊 薄弱点分析</h3>
        <div class="ai-weak" id="aiWeak"><div class="ai-empty">还没有学习记录, 去做几道练习再来看看吧 ~</div></div>
        <h3 style="margin-top:18px">🎁 自动推荐</h3>
        <div class="ai-rec" id="aiRec"></div>
        <button class="btn" id="aiRefresh" style="margin-top:12px">🔄 刷新分析</button>
      </div>
    </div>
  </section>

</main>

<footer class="foot">
  数据由 C++ jhub 引擎实时提供 · JSON/XML 文件层 · 零数据库零 SQL &nbsp;|&nbsp; 一年级学习乐园 v<?= $ver ?>
</footer>

<!-- 奖励弹层 -->
<div class="reward" id="reward"><div class="rw-box"><div class="rw-emoji">🎉</div><div class="rw-txt" id="rwTxt"></div></div></div>

<script src="assets/js/s.js?v=<?= $ver ?>"></script>
</body>
</html>
