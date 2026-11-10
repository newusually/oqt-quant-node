/*
 * classroom.js — 服务层 / 课堂剧场引擎 3.0 (2026-10-27 晚)
 * =========================================================
 * 本版升级（回应用户：音画不同步 / 动画单调 / 人物动作单一 / 背景单一 / 嗓音无差异）：
 *  1) 背景场景库 10 种(教室/草地/森林/海底/太空/星夜/雪原/书院/操场/农场)，
 *     按课程学科+关键词自动挑场景，开场淡入 —— 不再永远一个教室。
 *  2) 角色 5 个(猫头鹰老师/豆豆/米粒/皮皮/球球)，动作 8 种
 *     (挥手/写字/指点/欢呼/举手/思考/跳跃/朗读)，说话跳动+嘴型，其余角色轻微摇摆。
 *  3) 嗓音分角色：云端 TTS 同嗓底 + Audio.playbackRate 差异化
 *     (皮皮 1.25 童声尖 / 豆豆 1.12 / 老师 1.0 / 米粒 0.94 / 球球 0.86 低沉)，英文自动切 g-en。
 *  4) ★音画同步：台词按标点切段，逐段真朗读；每段开始时字幕才逐字打出该段、
 *     板书对应行同步浮现 —— 读到哪亮到哪，语音文字严格对齐。
 *  5) 演示动画 19 种，改为「想象浮层」大窗(600x240)播放，弹出动画更醒目：
 *     象形字演变(图→古文字→楷书)/笔顺描红/古诗画面/钟表/钱币/图形/统计条形图/
 *     英语情景对话/自然拼读/量词配对/反义词天平 + 原机器人/星星/红绿灯/盒子/
 *     田字格/四则画图/拼音拼读/字母掉落/卡片。
 * 用法: App.Classroom.mount(el, script, opt) → {destroy}
 * 剧本步骤: {who, t:台词, board:[标题,行...], act, demo:{kind...}}
 * App.Classroom.toScript(course, {demoFor}) 把大纲单元变成丰富互动剧本。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  if (!w.Vue) return;
  var V = w.Vue;

  /* ================= 角色（5 人，各具嗓音/造型） ================= */
  var WHO = {
    t:  { name: "猫头鹰老师", badge: "🦉 猫头鹰老师", rate: 1.0 },
    s1: { name: "豆豆", badge: "🙋 豆豆", rate: 1.12 },
    s2: { name: "米粒", badge: "💁 米粒", rate: 0.94 },
    s3: { name: "皮皮", badge: "🐵 皮皮", rate: 1.25 },
    s4: { name: "球球", badge: "🐻 球球", rate: 0.86 }
  };
  var STUDENTS = ["s1", "s2", "s3", "s4"];

  /* ================= 场景库（10 种背景） ================= */
  /* 每个场景: 渐变天空 + 地面 + 景物(太阳/云/树/鱼/星...)，全部 SVG 静态字符串 */
  function cloud(x, y, s, o) {
    return '<g opacity="' + (o || .9) + '"><ellipse cx="' + x + '" cy="' + y + '" rx="' + (26 * s) + '" ry="' + (12 * s) + '" fill="#fff"/>'
      + '<ellipse cx="' + (x + 20 * s) + '" cy="' + (y - 6 * s) + '" rx="' + (18 * s) + '" ry="' + (10 * s) + '" fill="#fff"/>'
      + '<ellipse cx="' + (x - 20 * s) + '" cy="' + (y - 3 * s) + '" rx="' + (15 * s) + '" ry="' + (9 * s) + '" fill="#fff"/></g>';
  }
  function sun(x, y, r) {
    var rays = "", i;
    for (i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      rays += '<line x1="' + (x + Math.cos(a) * (r + 5)) + '" y1="' + (y + Math.sin(a) * (r + 5)) + '" x2="' + (x + Math.cos(a) * (r + 14)) + '" y2="' + (y + Math.sin(a) * (r + 14)) + '" stroke="#ffd54f" stroke-width="3" stroke-linecap="round"/>';
    }
    return rays + '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#ffd93d" class="cr-sun"/>';
  }
  function tree(x, y, s, leaf) {
    return '<g><rect x="' + (x - 4 * s) + '" y="' + y + '" width="' + (8 * s) + '" height="' + (34 * s) + '" rx="3" fill="#8d6e63"/>'
      + '<circle cx="' + x + '" cy="' + (y - 14 * s) + '" r="' + (20 * s) + '" fill="' + (leaf || "#66bb6a") + '"/>'
      + '<circle cx="' + (x - 13 * s) + '" cy="' + (y - 4 * s) + '" r="' + (13 * s) + '" fill="' + (leaf || "#66bb6a") + '"/>'
      + '<circle cx="' + (x + 13 * s) + '" cy="' + (y - 4 * s) + '" r="' + (13 * s) + '" fill="' + (leaf || "#66bb6a") + '"/></g>';
  }
  function star5(x, y, r) {
    return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="#fffef5" class="cr-twinkle"/>';
  }
  function fish(x, y, c) {
    return '<g class="cr-fish"><ellipse cx="' + x + '" cy="' + y + '" rx="16" ry="9" fill="' + c + '"/>'
      + '<path d="M' + (x + 14) + ' ' + y + ' L' + (x + 26) + ' ' + (y - 8) + ' L' + (x + 26) + ' ' + (y + 8) + ' Z" fill="' + c + '"/>'
      + '<circle cx="' + (x - 7) + '" cy="' + (y - 2) + '" r="2" fill="#023"/></g>';
  }
  function bubble(x, y, r) { return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="none" stroke="rgba(255,255,255,.55)" stroke-width="1.6" class="cr-bub"/>'; }

  var SCENES = {
    classroom: {
      sky: ["#fdf3d8", "#f6e2ae"], ground: "#c8a06a",
      draw: function () {
        return ''
          + '<rect x="0" y="0" width="680" height="330" fill="url(#gSky)"/>'
          + '<rect x="18" y="30" width="66" height="80" rx="8" fill="#bde3f7" stroke="#8d6e63" stroke-width="5"/>'
          + '<line x1="51" y1="32" x2="51" y2="108" stroke="#8d6e63" stroke-width="4"/>'
          + '<circle cx="36" cy="54" r="8" fill="#ffd54f"/>' + cloud(58, 96, .5)
          + '<rect x="18" y="228" width="66" height="80" rx="8" fill="#bde3f7" stroke="#8d6e63" stroke-width="5"/>'
          + '<line x1="51" y1="230" x2="51" y2="306" stroke="#8d6e63" stroke-width="4"/>'
          + '<path d="M24 292 q12 -14 26 0" stroke="#81c784" stroke-width="4" fill="none"/>'
          + '<rect x="0" y="330" width="680" height="90" fill="url(#gFloor)"/><rect x="0" y="330" width="680" height="8" fill="#b08950"/>';
      }
    },
    meadow: {
      sky: ["#aee3ff", "#e8f7ff"], ground: "#7ec96f",
      draw: function () {
        return sun(74, 64, 22) + cloud(180, 56, .8) + cloud(520, 44, 1.05) + cloud(380, 84, .55)
          + '<rect x="0" y="0" width="680" height="330" fill="url(#gSky)"/>'
          + '<ellipse cx="620" cy="352" rx="180" ry="60" fill="#a5d6a7"/>'
          + tree(626, 292, 1.1) + tree(34, 300, .8, "#81c784")
          + '<rect x="0" y="330" width="680" height="90" fill="url(#gFloor)"/>'
          + '<path d="M60 366 q6 -14 12 0 M300 384 q6 -14 12 0 M560 372 q6 -14 12 0" stroke="#4caf50" stroke-width="3" fill="none" stroke-linecap="round"/>'
          + '<circle cx="140" cy="392" r="4" fill="#f06292"/><circle cx="466" cy="398" r="4" fill="#ffd54f"/>';
      }
    },
    forest: {
      sky: ["#b2dfdb", "#e0f2f1"], ground: "#5d8a4e",
      draw: function () {
        var o = '<rect x="0" y="0" width="680" height="330" fill="url(#gSky)"/>' + cloud(420, 48, .7, .7);
        o += tree(52, 268, 1.7) + tree(640, 258, 1.9, "#4caf50") + tree(560, 300, 1.1, "#81c784");
        o += '<path d="M120 340 q60 -18 120 0 q60 18 120 0 q60 -18 120 0 q60 18 120 0 L680 420 L0 420 Z" fill="#4e7a42"/>';
        o += '<path d="M300 356 a9 9 0 0 1 18 0 v8 a9 9 0 0 1 -18 0 Z" fill="#ef5350"/><circle cx="305" cy="356" r="2" fill="#fff"/><circle cx="313" cy="356" r="2" fill="#fff"/>';
        o += '<path d="M420 368 a7 7 0 0 1 14 0 v6 a7 7 0 0 1 -14 0 Z" fill="#ffca28"/>';
        return o;
      }
    },
    sea: {
      sky: ["#0d47a1", "#42a5f5"], ground: "#1565c0",
      draw: function () {
        return '<rect x="0" y="0" width="680" height="420" fill="url(#gSky)"/>'
          + bubble(90, 90, 7) + bubble(120, 150, 5) + bubble(560, 100, 8) + bubble(600, 190, 5) + bubble(520, 250, 4)
          + fish(120, 120, "#ffca28") + fish(540, 160, "#ef5350") + fish(90, 300, "#ab47bc") + fish(560, 320, "#4dd0e1")
          + '<path d="M40 420 q6 -60 -8 -84 M46 420 q10 -50 24 -66 M600 420 q-6 -56 8 -80 M596 420 q-10 -46 -26 -60" stroke="#2e7d32" stroke-width="7" fill="none" stroke-linecap="round" class="cr-weed"/>'
          + '<ellipse cx="340" cy="424" rx="360" ry="70" fill="#b3e5fc" opacity=".22"/>';
      }
    },
    space: {
      sky: ["#0b0b2a", "#283593"], ground: "#1a237e",
      draw: function () {
        var o = '<rect x="0" y="0" width="680" height="420" fill="url(#gSky)"/>', i;
        for (i = 0; i < 26; i++) {
          o += star5(20 + (i * 97) % 650, 18 + (i * 61) % 280, 1.4 + (i % 3));
        }
        o += '<circle cx="600" cy="70" r="34" fill="#ffb74d"/><ellipse cx="600" cy="70" rx="52" ry="12" fill="none" stroke="#ffe0b2" stroke-width="4" transform="rotate(-16 600 70)"/>'
          + '<circle cx="80" cy="250" r="20" fill="#90caf9"/><path d="M80 230 a20 20 0 0 1 0 40 a14 14 0 0 0 0 -40" fill="#64b5f6"/>';
        o += '<ellipse cx="340" cy="430" rx="380" ry="60" fill="#311b92"/>';
        return o;
      }
    },
    night: {
      sky: ["#1a237e", "#3949ab"], ground: "#283593",
      draw: function () {
        var o = '<rect x="0" y="0" width="680" height="330" fill="url(#gSky)"/>', i;
        for (i = 0; i < 18; i++) o += star5(24 + (i * 113) % 640, 20 + (i * 53) % 240, 1.3 + (i % 3));
        o += '<circle cx="96" cy="72" r="30" fill="#fff59d"/><circle cx="84" cy="64" r="26" fill="url(#gSky)" opacity=".92"/>'
          + '<path d="M180 120 q10 -20 26 0 q-6 16 -26 0" fill="#cfd8dc" opacity=".8"/>'
          + '<rect x="0" y="330" width="680" height="90" fill="url(#gFloor)"/>'
          + '<path d="M0 330 q170 -44 340 0 q170 44 340 0 L680 420 L0 420 Z" fill="#1b2a6b"/>';
        return o;
      }
    },
    snow: {
      sky: ["#b3e5fc", "#eceff1"], ground: "#e3f2fd",
      draw: function () {
        var o = '<rect x="0" y="0" width="680" height="330" fill="url(#gSky)"/>', i;
        for (i = 0; i < 20; i++) o += '<circle cx="' + (14 + (i * 83) % 660) + '" cy="' + (14 + (i * 47) % 300) + '" r="' + (2 + i % 3) + '" fill="#fff" class="cr-snowfall"/>';
        o += '<path d="M0 330 L120 220 L240 330 Z" fill="#d7e7f5"/><path d="M160 330 L320 190 L480 330 Z" fill="#cfddee"/><path d="M420 330 L560 230 L680 330 Z" fill="#dbe9f7"/>'
          + '<rect x="0" y="330" width="680" height="90" fill="url(#gFloor)"/>'
          + '<circle cx="600" cy="330" r="26" fill="#fff"/><circle cx="600" cy="300" r="19" fill="#fff"/><circle cx="600" cy="276" r="14" fill="#fff"/>'
          + '<circle cx="595" cy="298" r="2" fill="#333"/><circle cx="605" cy="298" r="2" fill="#333"/><rect x="592" y="304" width="16" height="3" rx="1.5" fill="#ef6c00"/>';
        return o;
      }
    },
    ancient: {
      sky: ["#f7e6c5", "#efdbb2"], ground: "#a1663a",
      draw: function () {
        return '<rect x="0" y="0" width="680" height="330" fill="url(#gSky)"/>'
          + '<rect x="0" y="18" width="680" height="14" fill="#8d6e63"/>'
          + '<rect x="60" y="32" width="18" height="298" fill="#a1887f"/><rect x="602" y="32" width="18" height="298" fill="#a1887f"/>'
          + '<rect x="60" y="32" width="18" height="60" fill="#8d6e63"/><rect x="602" y="32" width="18" height="60" fill="#8d6e63"/>'
          + '<path d="M280 40 l60 -14 l60 14 l-6 12 l-108 0 Z" fill="#ef5350"/><rect x="334" y="52" width="12" height="26" rx="4" fill="#ffd54f"/><line x1="340" y1="78" x2="340" y2="96" stroke="#ffca28" stroke-width="3"/>'
          + '<rect x="120" y="60" width="70" height="170" rx="6" fill="#d7ccc8" stroke="#a1887f" stroke-width="3" transform="rotate(6 155 145)"/>'
          + '<line x1="136" y1="86" x2="182" y2="92" stroke="#795548" stroke-width="3"/><line x1="133" y1="110" x2="180" y2="116" stroke="#795548" stroke-width="3"/><line x1="131" y1="134" x2="178" y2="140" stroke="#795548" stroke-width="3"/>'
          + '<rect x="0" y="330" width="680" height="90" fill="url(#gFloor)"/><rect x="0" y="330" width="680" height="8" fill="#8d5b32"/>';
      }
    },
    playground: {
      sky: ["#90caf9", "#e3f2fd"], ground: "#d96f4e",
      draw: function () {
        return sun(614, 60, 20) + cloud(120, 60, .9) + cloud(360, 42, .6)
          + '<rect x="0" y="0" width="680" height="330" fill="url(#gSky)"/>'
          + '<rect x="0" y="330" width="680" height="90" fill="#e07856"/><rect x="0" y="330" width="680" height="8" fill="#c9603f"/>'
          + '<line x1="0" y1="372" x2="680" y2="372" stroke="#fff" stroke-width="4" stroke-dasharray="26 18"/>'
          + '<rect x="40" y="252" width="110" height="8" rx="4" fill="#90a4ae"/><rect x="46" y="260" width="6" height="70" fill="#78909c"/><rect x="138" y="260" width="6" height="70" fill="#78909c"/>'
          + '<circle cx="200" cy="316" r="13" fill="#fff" stroke="#e53935" stroke-width="4" class="cr-ball"/>'
          + '<path d="M540 330 v-52 M588 330 v-52 M540 286 h48 M540 306 h48" stroke="#eceff1" stroke-width="5" fill="none"/>';
      }
    },
    farm: {
      sky: ["#aee3ff", "#e8f7ff"], ground: "#8bc34a",
      draw: function () {
        return sun(70, 62, 20) + cloud(240, 52, .8)
          + '<rect x="0" y="0" width="680" height="330" fill="url(#gSky)"/>'
          + '<rect x="0" y="330" width="680" height="90" fill="#8bc34a"/><rect x="0" y="330" width="680" height="6" fill="#689f38"/>'
          + '<path d="M0 336 h680" stroke="#795548" stroke-width="4"/>'
          + '<g><rect x="30" y="322" width="10" height="16" fill="#a1887f"/><rect x="70" y="322" width="10" height="16" fill="#a1887f"/><rect x="110" y="322" width="10" height="16" fill="#a1887f"/></g>'
          + '<circle cx="210" cy="318" r="16" fill="#ffd54f"/><circle cx="210" cy="296" r="10" fill="#ffd54f"/><path d="M204 288 l-4 -6 M216 288 l4 -6" stroke="#ef6c00" stroke-width="3"/><circle cx="207" cy="296" r="1.6" fill="#333"/><circle cx="213" cy="296" r="1.6" fill="#333"/><path d="M206 300 q4 3 8 0" stroke="#ef6c00" stroke-width="2" fill="none"/>'
          + tree(620, 296, 1.2, "#aed581")
          + '<g><circle cx="500" cy="300" r="14" fill="#ffca28"/><rect x="496" y="312" width="8" height="20" fill="#689f38"/><path d="M486 296 l-8 -6 M514 296 l8 -6" stroke="#689f38" stroke-width="4"/></g>';
      }
    }
  };
  /* 关键词 → 场景选择（未命中按学科默认） */
  function pickScene(course) {
    var s = ((course && (course.t || "") + (course.words || []).join("")) || "");
    if (/夜|月|星|静夜|古朗|夜书/.test(s)) return "night";
    if (/雪|冬/.test(s)) return "snow";
    if (/古诗|诗|咏|鹅|悯农|江|池|舟|山|村|草/.test(s)) return course && course.subj === "math" ? "meadow" : "meadow";
    if (/象形|甲骨|汉字|仓颉|造字|书法|对韵|声律/.test(s)) return "ancient";
    if (/海洋|鱼|水|海/.test(s) && course && course.subj !== "chinese") return "sea";
    if (/太空|宇宙|星球|地球|月亮|太阳|宇宙里/.test(s)) return "space";
    if (/动物|农场|鸡|鸭|牛|羊|农业|四季|春天|秋天|植物|树叶/.test(s)) return "farm";
    if (/体育|运动|跑|球|操场|跳/.test(s)) return "playground";
    if (/森林|树|鸟/.test(s)) return "forest";
    if (course && course.subj === "english") return ["meadow", "sea", "playground", "farm"][ (course._i || 0) % 4 ];
    if (course && course.subj === "math") return ["classroom", "playground", "meadow", "farm"][(course._i || 0) % 4];
    return ["classroom", "meadow", "ancient", "forest", "farm"][(course && course._i || 0) % 5];
  }
  function sceneDefs(id) {
    var sc = SCENES[id] || SCENES.classroom;
    return '<linearGradient id="gSky" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="' + sc.sky[0] + '"/><stop offset="1" stop-color="' + sc.sky[1] + '"/></linearGradient>'
      + '<linearGradient id="gFloor" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="' + sc.ground + '"/><stop offset="1" stop-color="' + sc.ground + '" stop-opacity=".8"/></linearGradient>';
  }

  /* ================= 角色 SVG（模板拼接，含 Vue 绑定） ================= */
  /* 老师：猫头鹰；学生统一圆头娃娃，参数化 */
  function teacherSVG() {
    return '<g :class="actorCls(\'t\')"><g transform="translate(318,150)">'
      + '<path class="cr-body" d="M-30 104 Q0 70 30 104 L36 150 L-36 150 Z" fill="#ff8a65"/>'
      + '<path d="M-18 118 q18 10 36 0" stroke="#ffccbc" stroke-width="4" fill="none"/>'
      + '<circle cx="0" cy="34" r="34" fill="#8d6e63"/>'
      + '<circle cx="0" cy="40" r="24" fill="#ffe0b2"/>'
      + '<path d="M-34 16 L-24 -10 L-8 12 Z" fill="#8d6e63" stroke="#6d4c41" stroke-width="2"/>'
      + '<path d="M34 16 L24 -10 L8 12 Z" fill="#8d6e63" stroke="#6d4c41" stroke-width="2"/>'
      + '<path d="M-30 14 q30 -18 60 0" stroke="#5d4037" stroke-width="3" fill="none"/>'
      + '<circle cx="-12" cy="36" r="9" fill="#fffde7" stroke="#4e342e" stroke-width="2.5"/>'
      + '<circle cx="12" cy="36" r="9" fill="#fffde7" stroke="#4e342e" stroke-width="2.5"/>'
      + '<line x1="-3" y1="36" x2="3" y2="36" stroke="#4e342e" stroke-width="2.5"/>'
      + '<circle cx="-12" cy="37.5" r="3" fill="#33691e" class="cr-eye"/><circle cx="12" cy="37.5" r="3" fill="#33691e" class="cr-eye"/>'
      + '<path d="M-4 22 q4 -5 8 0" stroke="#5d4037" stroke-width="2" fill="none"/>'
      + '<ellipse :class="mouthCls(\'t\')" cx="0" cy="54" rx="8" ry="5" fill="#e07b54"/>'
      + '<path d="M-28 92 L-52 122" stroke="#ff8a65" stroke-width="12" stroke-linecap="round"/>'
      + '<g class="cr-arm-r cr-arm-t"><path d="M28 92 L54 118" stroke="#ff8a65" stroke-width="12" stroke-linecap="round"/><circle cx="56" cy="120" r="7.5" fill="#ffe0b2"/></g>'
      + '<rect x="-26" y="146" width="52" height="8" rx="4" fill="#6d4c41"/>'
      + '</g></g>';
  }
  function studentSVG(who, x, y, cfg) {
    return '<g :class="actorCls(\'' + who + '\')"><g transform="translate(' + x + ',' + y + ')">'
      + '<rect x="-30" y="66" width="60" height="10" rx="5" fill="#a1887f"/>'
      + '<rect x="-24" y="76" width="48" height="30" rx="6" fill="#8d6e63"/>'
      + (cfg.tail ? '<path d="M22 52 q16 6 10 22" stroke="' + cfg.body + '" stroke-width="7" fill="none" stroke-linecap="round"/>' : '')
      + '<path d="M-20 30 Q0 20 20 30 L24 68 L-24 68 Z" fill="' + cfg.body + '"/>'
      + (cfg.patch ? '<rect x="-24" y="46" width="48" height="7" fill="' + cfg.patch + '" opacity=".85"/>' : '')
      + '<circle cx="0" cy="4" r="23" fill="' + cfg.skin + '"/>'
      + (cfg.ears === "round"
        ? '<circle cx="-21" cy="-8" r="7" fill="' + cfg.skin + '"/><circle cx="21" cy="-8" r="7" fill="' + cfg.skin + '"/><circle cx="-21" cy="-8" r="3.4" fill="#e0b090"/><circle cx="21" cy="-8" r="3.4" fill="#e0b090"/>'
        : cfg.ears === "monkey"
          ? '<circle cx="-22" cy="-6" r="8" fill="' + cfg.skin + '"/><circle cx="22" cy="-6" r="8" fill="' + cfg.skin + '"/>'
          : "")
      + (cfg.hair === "buns"
        ? '<circle cx="-16" cy="-18" r="7.5" fill="' + cfg.hairC + '"/><circle cx="16" cy="-18" r="7.5" fill="' + cfg.hairC + '"/><path d="M-22 0 Q-20 -14 0 -14 Q20 -14 22 0 Q10 -6 0 -5 Q-10 -6 -22 0" fill="' + cfg.hairC + '"/>'
        : cfg.hair === "long"
          ? '<path d="M-22 2 Q-24 -16 0 -16 Q24 -16 22 2 L22 12 Q14 -2 0 -2 Q-14 -2 -22 12 Z" fill="' + cfg.hairC + '"/>'
          : cfg.hair === "spiky"
            ? '<path d="M-21 -4 L-17 -14 L-11 -6 L-6 -16 L0 -7 L7 -16 L12 -6 L18 -13 L21 -4 Q10 -12 0 -12 Q-10 -12 -21 -4" fill="' + cfg.hairC + '"/>'
            : '<path d="M-22 0 Q-18 -15 0 -15 Q18 -15 22 0 Q10 -7 0 -6 Q-10 -7 -22 0" fill="' + cfg.hairC + '"/>')
      + '<circle cx="-8" cy="6" r="2.6" fill="#4a3b2a" class="cr-eye"/><circle cx="8" cy="6" r="2.6" fill="#4a3b2a" class="cr-eye"/>'
      + '<text x="24" y="-14" font-size="17" fill="#ffca28" font-weight="bold" class="cr-ask">?</text>'
      + '<circle cx="-13" cy="12" r="3" fill="#ff8a80" opacity=".55"/><circle cx="13" cy="12" r="3" fill="#ff8a80" opacity=".55"/>'
      + '<ellipse :class="mouthCls(\'' + who + '\')" cx="0" cy="15" rx="5.5" ry="3.6" fill="#d84343"/>'
      + '<path d="M-19 36 L-33 50" stroke="' + cfg.body + '" stroke-width="9" stroke-linecap="round"/>'
      + '<g class="cr-arm-r"><path d="M19 36 L35 22" stroke="' + cfg.body + '" stroke-width="9" stroke-linecap="round"/><circle cx="37" cy="20" r="5.5" fill="' + cfg.skin + '"/></g>'
      + '</g></g>';
  }
  var CAST = {
    s1: { x: 96,  y: 244, cfg: { skin: "#ffe0bd", hair: "spiky", hairC: "#4e342e", body: "#42a5f5", patch: "#1e88e5" } },
    s2: { x: 190, y: 248, cfg: { skin: "#ffe3c1", hair: "buns",  hairC: "#3e2723", body: "#ab47bc" } },
    s3: { x: 428, y: 250, cfg: { skin: "#d7a86e", hair: "none",  hairC: "#5d4037", body: "#ffa726", ears: "monkey", tail: true } },
    s4: { x: 522, y: 246, cfg: { skin: "#e8c39e", hair: "none",  hairC: "#5d4037", body: "#8d6e63", ears: "round", patch: "#6d4c41" } }
  };
  function castSVG() {
    return teacherSVG()
      + studentSVG("s1", CAST.s1.x, CAST.s1.y, CAST.s1.cfg)
      + studentSVG("s2", CAST.s2.x, CAST.s2.y, CAST.s2.cfg)
      + studentSVG("s3", CAST.s3.x, CAST.s3.y, CAST.s3.cfg)
      + studentSVG("s4", CAST.s4.x, CAST.s4.y, CAST.s4.cfg);
  }

  /* ================= 演示动画库（19 种，局部坐标 600x240） ================= */
  function frameTxt(x, y, txt, size, color, delay) {
    return '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-size="' + (size || 20) + '" fill="' + (color || "#fff8e1") + '" font-weight="bold" class="cr-pop" style="animation-delay:' + (delay || 0) + 'ms">' + txt + '</text>';
  }
  function chip(x, y, wd, ht, fill, stroke) {
    return '<rect x="' + x + '" y="' + y + '" width="' + wd + '" height="' + ht + '" rx="10" fill="' + (fill || "rgba(255,255,255,.13)") + '" stroke="' + (stroke || "#ffe082") + '" stroke-width="2" class="cr-pop"/>';
  }
  /* --- 象形字演变: 简笔画 → 古文字(描边) → 楷书 --- */
  var PICT = {
    "日": '<circle cx="0" cy="0" r="24" fill="#ffca28"/><line x1="-24" y1="0" x2="24" y2="0" stroke="#ff8f00" stroke-width="2"/>',
    "月": '<path d="M10 -24 a26 26 0 1 0 0 48 a20 20 0 1 1 0 -48" fill="#fff59d"/>',
    "水": '<path d="M-24 -18 q10 10 0 20 q-10 10 0 18 M0 -22 q12 12 0 24 q-12 12 0 24 M24 -18 q-10 10 0 20 q10 10 0 18" stroke="#4fc3f7" stroke-width="5" fill="none" stroke-linecap="round"/>',
    "火": '<path d="M0 -26 q14 14 6 26 q12 -2 10 12 q-2 14 -16 14 q-16 0 -18 -14 q-2 -12 8 -16 q-4 -12 10 -22" fill="#ff7043"/><path d="M0 -8 q6 6 2 12 q-6 4 -8 -2 q-2 -6 6 -10" fill="#ffd54f"/>',
    "山": '<path d="M-30 22 L-8 -20 L6 4 L18 -14 L34 22 Z" fill="#81c784"/><path d="M-8 -20 L2 -4 L-14 -4 Z" fill="#fff" opacity=".8"/>',
    "石": '<path d="M-22 16 q-4 -20 14 -28 q22 -8 30 12 q6 16 -8 22 q-24 6 -36 -6" fill="#b0bec5"/><path d="M-10 -6 q10 -6 18 0" stroke="#78909c" stroke-width="3" fill="none"/>',
    "田": '<rect x="-22" y="-22" width="44" height="44" rx="3" fill="#aed581" stroke="#558b2f" stroke-width="3"/><line x1="0" y1="-22" x2="0" y2="22" stroke="#558b2f" stroke-width="3"/><line x1="-22" y1="0" x2="22" y2="0" stroke="#558b2f" stroke-width="3"/>',
    "木": '<rect x="-4" y="-2" width="8" height="30" rx="3" fill="#8d6e63"/><circle cx="0" cy="-12" r="16" fill="#66bb6a"/><path d="M-2 -26 q3 -8 8 -10" stroke="#5d4037" stroke-width="3" fill="none"/>',
    "人": '<circle cx="0" cy="-14" r="9" fill="#ffcc80"/><path d="M0 -5 q-12 4 -14 26 M0 -5 q12 4 14 26" stroke="#42a5f5" stroke-width="7" fill="none" stroke-linecap="round"/>',
    "口": '<rect x="-16" y="-14" width="32" height="28" rx="4" fill="#ffab91" stroke="#d84315" stroke-width="4"/>',
    "云": '<ellipse cx="-8" cy="4" rx="16" ry="10" fill="#eceff1"/><ellipse cx="8" cy="-2" rx="14" ry="11" fill="#eceff1"/><ellipse cx="0" cy="8" rx="18" ry="8" fill="#e0e0e0"/>',
    "雨": '<path d="M-14 -16 a10 10 0 0 1 20 -2 a8 8 0 0 1 6 14 l-34 0 a9 9 0 0 1 8 -12" fill="#cfd8dc"/><line x1="-8" y1="4" x2="-11" y2="14" stroke="#4fc3f7" stroke-width="3.5" stroke-linecap="round"/><line x1="2" y1="4" x2="-1" y2="14" stroke="#4fc3f7" stroke-width="3.5" stroke-linecap="round"/><line x1="12" y1="4" x2="9" y2="14" stroke="#4fc3f7" stroke-width="3.5" stroke-linecap="round"/>',
    "耳": '<path d="M-12 -16 q16 -8 22 6 q4 12 -8 18 q-10 6 -4 14" stroke="#ffab91" stroke-width="6" fill="none" stroke-linecap="round"/><circle cx="2" cy="0" r="4" fill="#ff8a65"/>',
    "目": '<ellipse cx="0" cy="0" rx="18" ry="12" fill="#fff" stroke="#6d4c41" stroke-width="3"/><circle cx="0" cy="0" r="6" fill="#5d4037"/><circle cx="2" cy="-2" r="2" fill="#fff"/>',
    "禾": '<path d="M0 26 L0 -6" stroke="#8d6e63" stroke-width="5" stroke-linecap="round"/><path d="M0 -6 q-14 -4 -18 -18 q14 0 18 10 M0 -6 q14 -4 18 -18 q-14 0 -18 10" fill="#aed581"/><path d="M-2 4 q-10 -2 -14 -10 M2 4 q10 -2 14 -10" stroke="#aed581" stroke-width="4" fill="none" stroke-linecap="round"/>'
  };
  function xiangCol(ch, shown, x) {
    /* 每列: 简笔画(8帧内) → 古文字(描边字) → 楷书红字 */
    var o = "";
    o += '<g transform="translate(' + x + ',58)" class="cr-pop">' + (PICT[ch] || "") + '</g>';
    if (shown >= 1) o += '<text x="' + x + '" y="138" text-anchor="middle" font-size="44" fill="none" stroke="#fff59d" stroke-width="2.4" class="cr-pop">' + ch + '</text>';
    if (shown >= 2) {
      o += '<text x="' + x + '" y="146" text-anchor="middle" font-size="46" fill="#ef5350" class="cr-pop" style="animation-delay:120ms">' + ch + '</text>';
      o += '<rect x="' + (x - 26) + '" y="106" width="52" height="52" rx="8" fill="none" stroke="rgba(255,255,255,.25)" stroke-dasharray="4 4"/>';
    }
    o += '<line x1="' + x + '" y1="70" x2="' + x + '" y2="' + (shown >= 2 ? 102 : 80) + '" stroke="rgba(255,255,255,.3)" stroke-dasharray="3 4"/>';
    o += '<text x="' + x + '" y="212" text-anchor="middle" font-size="15" fill="#ffe0b2">' + ch + (shown >= 2 ? " · 会写啦" : shown >= 1 ? " · 像线条" : " · 像图画") + '</text>';
    return o;
  }
  function demoXiang(d, f) {
    var chars = (d.chars || ["日", "月", "火"]).slice(0, 4), o = "";
    var GAP = 600 / chars.length;
    for (var i = 0; i < chars.length; i++) {
      var shown = Math.max(0, Math.min(2, f - i * 2));
      o += '<g transform="translate(' + Math.round(GAP * i + GAP / 2) + ',0)">' + xiangCol(chars[i], shown, 0) + '</g>';
    }
    if (f >= chars.length * 2 + 1 && d.tip) o += frameTxt(300, 36, d.tip, 17, "#a5d6a7");
    return o;
  }
  /* --- 笔顺描红 --- */
  var STROKES = {
    "日": ["M30 12 L30 88", "M30 12 L78 12 L78 88", "M30 50 L78 50", "M30 88 L78 88"],
    "口": ["M28 14 L28 86", "M28 14 L76 14 L76 86", "M28 86 L76 86"],
    "人": ["M56 12 Q40 48 24 84", "M52 40 Q70 62 88 84"],
    "火": ["M44 20 L50 32", "M56 14 Q44 40 32 58", "M52 46 Q40 66 26 86", "M58 46 Q74 66 88 84"],
    "山": ["M54 10 L54 88", "M24 50 L24 88 L54 88", "M84 50 L84 88"],
    "木": ["M14 46 L92 46", "M53 10 L53 92", "M48 52 Q38 68 24 84", "M58 52 Q70 68 84 84"],
    "田": ["M26 12 L26 88", "M26 12 L78 12 L78 88", "M26 50 L78 50", "M52 12 L52 88", "M26 88 L78 88"],
    "月": ["M40 12 Q28 50 26 86", "M40 12 L72 12 Q78 12 76 22 L70 74 Q68 88 54 88", "M42 46 L62 46", "M40 66 L60 66"],
    "水": ["M52 10 L52 88", "M46 30 L28 30 Q22 30 26 38 L36 50", "M36 58 Q26 74 16 84", "M62 34 L82 58 Q88 66 78 70", "M60 56 Q72 74 86 86"],
    "云": ["M22 34 L84 34", "M30 60 L78 60", "M56 66 Q42 84 30 90", "M68 78 L70 80"]
  };
  function demoStroke(d, f) {
    var ch = d.char || "日", arr = STROKES[ch] || STROKES["日"], o = "";
    o += '<g transform="translate(196,10)"><rect x="-46" y="-34" width="208" height="208" rx="10" fill="rgba(255,255,255,.06)"/>';
    o += '<line x1="54" y1="-28" x2="54" y2="168" stroke="rgba(255,255,255,.14)" stroke-width="2"/>'
      + '<line x1="0" y1="70" x2="108" y2="70" stroke="rgba(255,255,255,.14)" stroke-width="2"/>'
      + '<line x1="6" y1="-22" x2="102" y2="162" stroke="rgba(255,255,255,.09)" stroke-width="2"/>'
      + '<line x1="102" y1="-22" x2="6" y2="162" stroke="rgba(255,255,255,.09)" stroke-width="2"/>';
    o += '<g transform="translate(1,19)">';
    for (var i = 0; i < arr.length; i++) {
      var done = i < f;
      o += '<path d="' + arr[i] + '" fill="none" stroke="' + (done ? "#ff7043" : "rgba(255,255,255,.22)") + '" stroke-width="' + (done ? 9 : 7) + '" stroke-linecap="round" ' + (done ? 'class="cr-pop" style="animation-delay:60ms"' : "") + '/>';
    }
    o += '</g>';
    o += '<text x="54" y="192" text-anchor="middle" font-size="14" fill="#ffe0b2">第 ' + Math.min(f, arr.length) + ' / ' + arr.length + ' 笔</text></g>';
    /* 右侧笔顺提示 */
    o += '<g transform="translate(380,26)">' + chip(0, 0, 190, 34, "rgba(255,255,255,.1)", "#80cbc4") + frameTxt(95, 23, "笔顺规则：从上到下，从左到右", 13, "#b2dfdb") + '</g>';
    o += '<g transform="translate(380,74)">' + chip(0, 0, 190, 58) + frameTxt(95, 24, "先写「" + (arr.length > 1 ? "外" : "中") + "」再写里", 14, "#fff8e1") + frameTxt(95, 46, "红笔是老师写的，灰笔等你描", 12, "#ffe0b2") + '</g>';
    o += '<g transform="translate(430,150)"><text x="0" y="0" font-size="64" fill="' + (f >= arr.length ? "#a5d6a7" : "rgba(255,255,255,.35)") + '" font-weight="bold" class="' + (f >= arr.length ? "cr-pop" : "") + '">' + ch + '</text></g>';
    return o;
  }
  /* --- 古诗画面 --- */
  function demoPoem(d, f) {
    var lines = d.lines || ["床前明月光", "疑是地上霜"], o = "";
    o += '<circle cx="500" cy="52" r="26" fill="#fff59d" class="cr-twinkle"/>';
    o += '<path d="M0 208 q80 -26 160 0 q80 26 160 0 q80 -26 160 0 q70 22 120 4 L600 240 L0 240 Z" fill="rgba(255,255,255,.10)"/>';
    for (var i = 0; i < lines.length; i++) {
      if (f < i + 1) continue;
      var chars = lines[i].split(""), x0 = 300 - (chars.length - 1) * 24;
      for (var c = 0; c < chars.length; c++) {
        o += '<text x="' + (x0 + c * 48) + '" y="' + (56 + i * 56) + '" text-anchor="middle" font-size="30" fill="#fff8e1" font-weight="bold" class="cr-pop" style="animation-delay:' + (c * 130) + 'ms">' + chars[c] + '</text>';
      }
    }
    if (d.title && f >= 1) o += frameTxt(96, 40, "《" + d.title + "》", 18, "#ffe082");
    if (f > lines.length && d.zh) o += frameTxt(300, 224, d.zh, 14, "#b2dfdb");
    return o;
  }
  /* --- 钟表 --- */
  function demoClock(d, f) {
    var h = d.h || 3, m = d.m || 0, o = "", cx = 150, cy = 110, R = 84;
    o += '<circle cx="' + cx + '" cy="' + cy + '" r="' + (R + 10) + '" fill="#fff3e0" stroke="#8d6e63" stroke-width="7"/>';
    for (var i = 0; i < 12; i++) {
      var a = i * 30 * Math.PI / 180, r1 = R - 2, r2 = R - (i % 3 === 0 ? 14 : 8);
      o += '<line x1="' + (cx + Math.sin(a) * r1) + '" y1="' + (cy - Math.cos(a) * r1) + '" x2="' + (cx + Math.sin(a) * r2) + '" y2="' + (cy - Math.cos(a) * r2) + '" stroke="#6d4c41" stroke-width="' + (i % 3 === 0 ? 4 : 2.4) + '"/>';
      if (i % 3 === 0) {
        var nx = cx + Math.sin(a) * (R - 26), ny = cy - Math.cos(a) * (R - 26);
        o += '<text x="' + nx + '" y="' + (ny + 5) + '" text-anchor="middle" font-size="15" fill="#5d4037" font-weight="bold">' + (i === 0 ? 12 : i) + '</text>';
      }
    }
    var step = Math.min(f, 4);
    if (step >= 1) o += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + Math.sin(h % 12 * 30 * Math.PI / 180) * 42) + '" y2="' + (cy - Math.cos(h % 12 * 30 * Math.PI / 180) * 42) + '" stroke="#33691e" stroke-width="7" stroke-linecap="round" class="cr-pop"/>';
    if (step >= 2) o += '<line x1="' + cx + '" y1="' + cy + '" x2="' + (cx + Math.sin(m * 6 * Math.PI / 180) * 62) + '" y2="' + (cy - Math.cos(m * 6 * Math.PI / 180) * 62) + '" stroke="#e53935" stroke-width="4.5" stroke-linecap="round" class="cr-pop" style="animation-delay:150ms"/>';
    if (step >= 3) o += '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="#5d4037"/>';
    var hh = ((h % 12) + 12) % 12 === 0 ? 12 : (h % 12);
    if (step >= 4) o += frameTxt(150, 226, "是 " + hh + " 点" + (m ? m + " 分" : "整"), 20, "#a5d6a7");
    o += '<g transform="translate(320,20)">' + chip(0, 0, 250, 56) + frameTxt(125, 24, "短针是【时针】，长针是【分针】", 14) + frameTxt(125, 46, "分针指 12 是整点，指 6 是半点", 13, "#ffe0b2") + '</g>';
    o += '<g transform="translate(320,96)">' + chip(0, 0, 250, 46) + frameTxt(125, 20, "时针刚走过 " + hh + "，分针指 " + (m === 30 ? "6" : "12"), 14, "#b2dfdb") + frameTxt(125, 40, m === 30 ? "→ 读作 " + hh + " 点半" : "→ 读作 " + hh + " 点整", 15, "#fff59d") + '</g>';
    return o;
  }
  /* --- 钱币 --- */
  function demoMoney(d, f) {
    var o = "", i;
    o += '<g transform="translate(60,30)">';
    for (i = 0; i < 10; i++) {
      var on = i < Math.min(f * 2, 10);
      o += '<g transform="translate(' + (i % 5 * 52) + ',' + (Math.floor(i / 5) * 52) + ')" class="' + (on ? "cr-pop" : "") + '" style="animation-delay:' + (i * 70) + 'ms" opacity="' + (on ? 1 : .22) + '">'
        + '<circle cx="18" cy="18" r="17" fill="' + (on ? "#ffd54f" : "#cfd8dc") + '" stroke="#f9a825" stroke-width="2.5"/>'
        + '<text x="18" y="24" text-anchor="middle" font-size="15" fill="' + (on ? "#795548" : "#9e9e9e") + '" font-weight="bold">1角</text></g>';
    }
    o += '</g>';
    if (f >= 5) o += '<path d="M300 108 q28 -30 60 0" stroke="#ffe082" stroke-width="3.5" fill="none" marker-end="url(#arr)" class="cr-pop"/>';
    if (f >= 6) {
      o += '<g transform="translate(380,66)" class="cr-pop" style="animation-delay:150ms"><circle cx="34" cy="34" r="32" fill="#ffd54f" stroke="#f9a825" stroke-width="4"/><text x="34" y="42" text-anchor="middle" font-size="24" fill="#795548" font-weight="bold">1元</text></g>';
      o += frameTxt(300, 190, "10 个 1 角 = 1 元", 20, "#a5d6a7");
    }
    if (f >= 7) o += frameTxt(300, 220, d.tip || "1 元 = 10 角，元比角大", 14, "#ffe0b2");
    return o;
  }
  /* --- 图形 --- */
  function demoShape(d, f) {
    var o = "";
    o += '<g transform="translate(70,30)">';
    if (f >= 1) o += '<rect x="0" y="0" width="90" height="90" rx="6" fill="#80cbc4" stroke="#00695c" stroke-width="3" class="cr-pop"/><text x="45" y="116" text-anchor="middle" font-size="15" fill="#b2dfdb">正方形 · 四边一样长</text>';
    if (f >= 2) o += '<rect x="120" y="20" width="140" height="70" rx="6" fill="#90caf9" stroke="#1565c0" stroke-width="3" class="cr-pop" style="animation-delay:120ms"/><text x="190" y="116" text-anchor="middle" font-size="15" fill="#b2dfdb">长方形 · 对边一样长</text>';
    if (f >= 3) o += '<path d="M330 90 L375 10 L420 90 Z" fill="#ffab91" stroke="#d84315" stroke-width="3" class="cr-pop" style="animation-delay:240ms"/><text x="375" y="116" text-anchor="middle" font-size="15" fill="#ffe0b2">三角形 · 三条边</text>';
    if (f >= 4) o += '<circle cx="500" cy="45" r="45" fill="#ffe082" stroke="#ff8f00" stroke-width="3" class="cr-pop" style="animation-delay:360ms"/><text x="500" y="116" text-anchor="middle" font-size="15" fill="#ffe0b2">圆形 · 滚滚滚</text>';
    o += '</g>';
    if (f >= 5) o += frameTxt(300, 168, "找一找：教室里哪些东西是这些形状？", 16, "#a5d6a7");
    if (f >= 6) o += frameTxt(300, 200, d.tip || "三角形最难倒，圆滚得最远", 14, "#ffe0b2");
    return o;
  }
  /* --- 统计条形图 --- */
  function demoChart(d, f) {
    var bars = d.bars || [["猫", 5], ["狗", 3], ["鱼", 7]], o = "";
    var max = 1, i;
    for (i = 0; i < bars.length; i++) max = Math.max(max, bars[i][1]);
    var X0 = 150, Y0 = 190, W = 70, GAPB = 44;
    o += '<line x1="' + (X0 - 20) + '" y1="' + Y0 + '" x2="' + (X0 + bars.length * (W + GAPB)) + '" y2="' + Y0 + '" stroke="rgba(255,255,255,.4)" stroke-width="2.5"/>';
    for (i = 0; i < bars.length; i++) {
      if (f < i + 1) continue;
      var h = Math.round(bars[i][1] / max * 120), x = X0 + i * (W + GAPB);
      o += '<g class="cr-bar" style="animation-delay:' + (i * 150) + 'ms"><rect x="' + x + '" y="' + (Y0 - h) + '" width="' + W + '" height="' + h + '" rx="6" fill="' + ["#4dd0e1", "#ffb74d", "#aed581", "#ce93d8"][i % 4] + '"/>'
        + '<text x="' + (x + W / 2) + '" y="' + (Y0 - h - 8) + '" text-anchor="middle" font-size="15" fill="#fff" font-weight="bold">' + bars[i][1] + '</text>'
        + '<text x="' + (x + W / 2) + '" y="' + (Y0 + 20) + '" text-anchor="middle" font-size="15" fill="#ffe0b2">' + bars[i][0] + '</text></g>';
    }
    if (f > bars.length) {
      o += frameTxt(300, 226, "最多的是【" + bars[0][1] + "】？比一比最高的柱子 → " + (bars.slice().sort(function (a, b) { return b[1] - a[1]; })[0][0]), 15, "#a5d6a7");
    }
    return o;
  }
  /* --- 英语情景对话 --- */
  function demoDialog(d, f) {
    var lines = d.lines || [["A", "Hello! I'm Sam."], ["B", "Hi, Sam! I'm Amy."]], o = "";
    for (var i = 0; i < lines.length; i++) {
      if (f < i + 1) continue;
      var left = i % 2 === 0, x = left ? 60 : 320, w = 240;
      o += '<g class="cr-pop" style="animation-delay:' + (i * 120) + 'ms">'
        + '<rect x="' + x + '" y="' + (18 + i * 66) + '" width="' + w + '" height="50" rx="16" fill="' + (left ? "rgba(128,222,234,.25)" : "rgba(255,171,145,.25)") + '" stroke="' + (left ? "#80deea" : "#ffab91") + '" stroke-width="2"/>'
        + (left ? '<path d="M' + (x + w) + ' ' + (34 + i * 66) + ' l16 6 l-16 6" fill="none" stroke="' + (left ? "#80deea" : "#ffab91") + '" stroke-width="2"/>'
                : '<path d="M' + x + ' ' + (34 + i * 66) + ' l-16 6 l16 6" fill="none" stroke="#ffab91" stroke-width="2"/>')
        + '<text x="' + (x + 14) + '" y="' + (44 + i * 66) + '" font-size="16" fill="#fff" font-weight="bold">' + lines[i][0] + ': ' + lines[i][1] + '</text></g>';
    }
    if (f > lines.length && d.zh) o += frameTxt(300, 220, d.zh, 14, "#b2dfdb");
    return o;
  }
  /* --- 自然拼读 --- */
  function demoPhonics(d, f) {
    var letters = d.letters || ["c", "a", "t"], o = "", i;
    for (i = 0; i < letters.length; i++) {
      if (f < i + 1) continue;
      o += '<text x="' + (180 + i * 84) + '" y="84" text-anchor="middle" font-size="56" fill="#fff" font-weight="bold" class="cr-pop" style="animation-delay:' + (i * 130) + 'ms">' + letters[i] + '</text>';
      if (f >= i + 1) o += frameTxt(180 + i * 84, 112, "/" + letters[i] + "/", 15, "#80deea");
    }
    if (f > letters.length) o += frameTxt(300, 158, letters.join("") + (d.zh ? "  " + d.zh : ""), 26, "#ffe082");
    if (f > letters.length + 1) o += frameTxt(300, 192, "连起来读: " + letters.join("-") + " → " + letters.join(""), 16, "#a5d6a7");
    if (f > letters.length + 2 && d.pic) o += frameTxt(300, 224, d.pic, 18, "#fff8e1");
    return o;
  }
  /* --- 量词配对 --- */
  function demoLiangci(d, f) {
    var pairs = d.pairs || [["只", "鸟"], ["头", "牛"], ["条", "鱼"]], o = "";
    for (var i = 0; i < pairs.length; i++) {
      if (f < i + 1) continue;
      var y = 30 + i * 64;
      o += '<g class="cr-pop" style="animation-delay:' + (i * 110) + 'ms">'
        + '<rect x="90" y="' + y + '" width="120" height="48" rx="12" fill="rgba(128,222,234,.2)" stroke="#80deea" stroke-width="2"/><text x="150" y="' + (y + 31) + '" text-anchor="middle" font-size="22" fill="#fff" font-weight="bold">一 ' + pairs[i][0] + '</text>'
        + '<line x1="210" y1="' + (y + 24) + '" x2="330" y2="' + (y + 24) + '" stroke="#ffe082" stroke-width="2.5" stroke-dasharray="5 5"/>'
        + '<rect x="330" y="' + y + '" width="160" height="48" rx="12" fill="rgba(255,171,145,.2)" stroke="#ffab91" stroke-width="2"/><text x="410" y="' + (y + 31) + '" text-anchor="middle" font-size="22" fill="#fff" font-weight="bold">' + pairs[i][1] + '</text></g>';
    }
    if (f > pairs.length) o += frameTxt(300, 228, d.tip || "量词要配对，用错了会闹笑话哦", 14, "#a5d6a7");
    return o;
  }
  /* --- 反义词天平 --- */
  function demoFanyi(d, f) {
    var pairs = d.pairs || [["大", "小"], ["多", "少"]], o = "";
    o += '<path d="M300 30 L300 66" stroke="#ffe082" stroke-width="5"/><circle cx="300" cy="26" r="9" fill="#ffe082"/>'
      + '<path d="M300 66 L' + (300 - 150) + ' ' + (66 + (f % 2 ? 16 : 8)) + ' M300 66 L' + (300 + 150) + ' ' + (66 + (f % 2 ? 8 : 16)) + '" stroke="#ffe082" stroke-width="4" fill="none"/>';
    for (var i = 0; i < pairs.length; i++) {
      if (f < i + 1) continue;
      o += '<g class="cr-pop" style="animation-delay:' + (i * 130) + 'ms">'
        + '<rect x="' + (96 + i * 150) + '" y="' + (92 + i * 60) + '" width="110" height="46" rx="12" fill="rgba(128,222,234,.22)" stroke="#80deea" stroke-width="2"/>'
        + '<text x="' + (151 + i * 150) + '" y="' + (123 + i * 60) + '" text-anchor="middle" font-size="26" fill="#fff" font-weight="bold">' + pairs[i][0] + '</text>'
        + '<rect x="' + (250 + i * 150) + '" y="' + (92 + i * 60) + '" width="110" height="46" rx="12" fill="rgba(255,171,145,.22)" stroke="#ffab91" stroke-width="2"/>'
        + '<text x="' + (305 + i * 150) + '" y="' + (123 + i * 60) + '" text-anchor="middle" font-size="26" fill="#fff" font-weight="bold">' + pairs[i][1] + '</text></g>';
    }
    if (f > pairs.length) o += frameTxt(300, 226, d.tip || "它们意思相反，是一对反义词", 14, "#a5d6a7");
    return o;
  }
  /* --- 以下为 1.x 经典 demo（重排到 600x240 局部坐标） --- */
  function apple(x, y, dim) {
    return '<g opacity="' + (dim ? .22 : 1) + '" class="cr-pop"><circle cx="' + x + '" cy="' + y + '" r="11" fill="#ef5350" stroke="#b71c1c" stroke-width="1.5"/>'
      + '<path d="M' + x + ' ' + (y - 10) + ' q2 -6 6 -8" stroke="#5d4037" stroke-width="2" fill="none"/>'
      + '<path d="M' + x + ' ' + (y - 16) + ' q8 -4 10 2 q-8 4 -10 -2" fill="#66bb6a"/></g>';
  }
  function brace(x1, x2, y, label, up) {
    var mx = (x1 + x2) / 2, dy = up ? -1 : 1;
    return '<path d="M' + x1 + ' ' + y + ' Q' + mx + ' ' + (y + 14 * dy) + ' ' + mx + ' ' + (y + 12 * dy) + ' L' + mx + ' ' + (y + 26 * dy)
      + ' L' + mx + ' ' + (y + 12 * dy) + ' Q' + mx + ' ' + (y + 14 * dy) + ' ' + x2 + ' ' + y + '" fill="none" stroke="#ffe082" stroke-width="2.5"/>'
      + '<text x="' + mx + '" y="' + (y + (up ? -34 : 44)) + '" text-anchor="middle" font-size="17" fill="#ffe082" font-weight="bold">' + label + '</text>';
  }
  function demoMath(d, f) {
    var a = d.a || 3, b = d.b || 2, out = "";
    if (d.op === "add") {
      var total = a + b, X0 = 130, Y1 = 70, Y2 = 104;
      var show = Math.min(f, total);
      for (var i = 0; i < show; i++) out += apple(X0 + i * 34 + (i >= a ? 17 : 0), i < a ? Y1 : Y2, false);
      if (f >= 1) out += '<text x="' + (X0 + a * 17 - 15) + '" y="' + (Y1 - 20) + '" text-anchor="middle" font-size="14" fill="#fff8dc">' + a + '个</text>';
      if (f >= 2 && b > 0) out += '<text x="' + (X0 + a * 34 + b * 17) + '" y="' + (Y2 - 20) + '" text-anchor="middle" font-size="14" fill="#fff8dc">' + b + '个</text>';
      if (f >= 3) out += brace(X0 - 15, X0 + total * 34 - 8, 122, f >= 4 ? (a + b) + "个" : "?个", false);
      if (f >= 4) out += frameTxt(300, 214, a + " + " + b + " = " + (a + b), 22, "#a5d6a7");
    } else if (d.op === "sub") {
      var X0 = 110, Y = 92, gone = f >= 2 ? b : 0;
      for (var i2 = 0; i2 < a; i2++) {
        var x = X0 + i2 * 40, isGone = i2 >= a - b;
        out += apple(x, Y, isGone && f >= 2);
        if (isGone && f >= 2) out += '<line x1="' + (x - 13) + '" y1="' + (Y - 13) + '" x2="' + (x + 13) + '" y2="' + (Y + 13) + '" stroke="#ff8a80" stroke-width="3" stroke-linecap="round"/>';
      }
      if (f >= 1) out += frameTxt(300, 44, "原来有 " + a + " 个", 15, "#fff8dc");
      if (f >= 2) out += '<text x="' + (X0 + (a - b / 2) * 40 - 6) + '" y="' + (Y + 42) + '" text-anchor="middle" font-size="14" fill="#ff8a80">划掉 ' + b + ' 个</text>';
      if (f >= 3) out += brace(X0 - 15, X0 + (a - b) * 40 - 12, Y - 24, f >= 4 ? "剩下 " + (a - b) + " 个" : "?个", true);
      if (f >= 4) out += frameTxt(300, 214, a + " - " + b + " = " + (a - b), 22, "#a5d6a7");
    } else if (d.op === "mul") {
      var X0 = 150, Y0 = 36, CW = 44, CH = 40;
      var rows = Math.min(f, a);
      for (var r = 0; r < rows; r++) for (var c = 0; c < b; c++) out += apple(X0 + c * CW, Y0 + r * CH, false);
      if (f >= 1) out += '<text x="' + (X0 - 22) + '" y="' + (Y0 + (a - 1) * CH / 2 + 5) + '" text-anchor="end" font-size="14" fill="#fff8dc">' + a + '行</text>';
      if (f >= 2) out += '<text x="' + (X0 + (b - 1) * CW / 2) + '" y="' + (Y0 + a * CH + 18) + '" text-anchor="middle" font-size="14" fill="#fff8dc">' + b + '列</text>';
      if (f >= a + 1) out += frameTxt(300, 214, a + " × " + b + " = " + (a * b) + "（" + a + " 个 " + b + " 相加）", 20, "#a5d6a7");
    } else if (d.op === "div") {
      var tot = a * b, X0 = 80, Y0 = 60;
      var plates = Math.min(f - 1, a);
      for (var p = 0; p < a; p++) {
        var px = X0 + p * 92;
        out += '<ellipse cx="' + (px + 20) + '" cy="' + (Y0 + 66) + '" rx="36" ry="14" fill="none" stroke="#ffe082" stroke-width="2" opacity="' + (f >= 1 ? 1 : .25) + '"/>';
        var inPlate = f >= 2 ? Math.min(plates, p + 1) * b : 0;
        var here = Math.max(0, Math.min(inPlate - p * b, b));
        for (var k = 0; k < here; k++) out += apple(px + 4 + k * 17, Y0 + 60, false);
        if (f >= 2 && inPlate >= (p + 1) * b) out += '<text x="' + (px + 20) + '" y="' + (Y0 + 98) + '" text-anchor="middle" font-size="13" fill="#a5d6a7">' + b + '个</text>';
      }
      if (f >= 1) out += frameTxt(300, 34, tot + " 个平均分到 " + a + " 个盘子", 15, "#fff8dc");
      if (f >= a + 2) out += frameTxt(300, 214, tot + " ÷ " + a + " = " + b, 22, "#a5d6a7");
    }
    return out;
  }
  function demoPinyin(d, f) {
    var sm = d.parts[0], ym = d.parts[1], out = d.out || (sm + ym), hz = d.hanzi || "", o = "";
    if (f >= 1) o += '<text x="120" y="92" text-anchor="middle" font-size="52" fill="#fff" font-weight="bold" class="cr-pop">' + sm + '</text><text x="120" y="122" text-anchor="middle" font-size="13" fill="#ffe0b2">声母</text>';
    if (f >= 2) o += '<text x="480" y="92" text-anchor="middle" font-size="52" fill="#80deea" font-weight="bold" class="cr-pop" style="animation-delay:120ms">' + ym + '</text><text x="480" y="122" text-anchor="middle" font-size="13" fill="#ffe0b2">韵母</text>';
    if (f >= 3) {
      o += '<path d="M160 82 Q210 58 258 74" stroke="#ffe082" stroke-width="2.5" fill="none"/><path d="M440 82 Q390 58 342 74" stroke="#ffe082" stroke-width="2.5" fill="none"/>';
      o += '<text x="300" y="96" text-anchor="middle" font-size="60" fill="#ffe082" font-weight="bold" class="cr-pop">' + out + '</text>';
    }
    if (f >= 4) o += frameTxt(300, 160, "「" + out + "」" + (hz ? "就是 " + hz + " 的读音" : ""), 20, "#fff8e1");
    if (f >= 5 && hz) o += frameTxt(300, 208, "组词: " + hz, 16, "#a5d6a7");
    return o;
  }
  function demoABC(d, f) {
    var letters = (d.word || "cat").split(""), zh = d.zh || "", pic = d.pic || "", o = "", n = Math.min(f, letters.length);
    for (var i = 0; i < n; i++) {
      o += '<text x="' + (170 + i * 92) + '" y="96" text-anchor="middle" font-size="54" fill="#fff" font-weight="bold" class="cr-pop" style="animation-delay:' + (i * 90) + 'ms">' + letters[i] + '</text>';
    }
    if (f > letters.length) o += frameTxt(300, 148, d.word + (pic ? " " + pic : "") + (zh ? " · " + zh : ""), 22, "#ffe082");
    if (f > letters.length + 1 && d.sent) o += frameTxt(300, 186, d.sent, 15, "#80deea");
    if (f > letters.length + 2) o += frameTxt(300, 216, d.zh2 || "大声读三遍，单词就住进你脑袋啦", 13, "#ffe0b2");
    return o;
  }
  function demoCards(d, f) {
    var items = d.items || [], o = "";
    var W = Math.min(136, 560 / Math.max(1, items.length) - 14), GAP = 16;
    var X0 = 300 - (items.length * W + (items.length - 1) * GAP) / 2, Y = 40, H = Math.max(70, W * 0.66);
    for (var i = 0; i < items.length; i++) {
      if (f < i + 1) continue;
      var x = X0 + i * (W + GAP);
      o += '<g class="cr-pop" style="animation-delay:' + (i * 120) + 'ms">'
        + '<rect x="' + x + '" y="' + Y + '" width="' + W + '" height="' + H + '" rx="12" fill="rgba(255,255,255,.14)" stroke="#ffe082" stroke-width="2"/>'
        + '<text x="' + (x + W / 2) + '" y="' + (Y + H * 0.44) + '" text-anchor="middle" font-size="' + Math.min(21, W / 5.4) + '" fill="#fff" font-weight="bold">' + items[i][0] + '</text>'
        + '<text x="' + (x + W / 2) + '" y="' + (Y + H * 0.8) + '" text-anchor="middle" font-size="' + Math.min(14, W / 8) + '" fill="#ffe0b2">' + items[i][1] + '</text></g>';
    }
    if (f > items.length && d.tip) o += frameTxt(300, 200, d.tip, 15, "#a5d6a7");
    return o;
  }
  function demoZi(d, f) {
    var ch = d.char || "火", o = "";
    o += '<g transform="translate(210,14)">'
      + '<rect class="cr-tz-border" x="0" y="0" width="150" height="150" rx="8"/>'
      + '<line class="cr-tz-line" x1="75" y1="5" x2="75" y2="145"/><line class="cr-tz-line" x1="5" y1="75" x2="145" y2="75"/>'
      + '<line x1="10" y1="10" x2="140" y2="140" stroke="rgba(255,255,255,.08)" stroke-width="1.5"/>'
      + '<line x1="140" y1="10" x2="10" y2="140" stroke="rgba(255,255,255,.08)" stroke-width="1.5"/>'
      + '<text x="75" y="118" text-anchor="middle" font-size="104" class="cr-zi-ghost">' + ch + '</text>';
    if (f >= 1) o += '<text x="75" y="118" text-anchor="middle" font-size="104" fill="#ef5350" class="cr-pop">' + ch + '</text>';
    o += '</g>';
    o += '<g transform="translate(408,30)">' + chip(0, 0, 164, 120)
      + frameTxt(82, 34, "田字格写「" + ch + "」", 17, "#fff8e1")
      + frameTxt(82, 64, "先描一描", 15, "#80deea")
      + frameTxt(82, 90, "再自己写两遍", 15, "#ffe0b2")
      + frameTxt(82, 112, (d.tip || "横平竖直才漂亮"), 13, "#a5d6a7") + '</g>';
    return o;
  }
  function demoStars(d) {
    var o = "", n = 9, i;
    for (i = 0; i < n; i++) o += '<circle cx="' + (90 + (i % 5) * 105) + '" cy="' + (70 + Math.floor(i / 5) * 74) + '" r="13" fill="#ffd54f" stroke="#ffb300" stroke-width="2" class="cr-twinkle" style="animation-delay:' + (i * 180) + 'ms"/>';
    o += frameTxt(300, 214, "你就像这些星星一样闪亮 ✨", 15, "#ffe082");
    return o;
  }
  function demoIf(d, light) {
    var redOn = light === "red";
    return ''
      + '<g transform="translate(392,18)"><rect x="0" y="0" width="46" height="104" rx="10" fill="#546e7a"/>'
      + '<circle cx="23" cy="26" r="14" fill="#ef5350" opacity="' + (redOn ? 1 : .22) + '" class="' + (redOn ? "cr-pop" : "") + '"/>'
      + '<circle cx="23" cy="78" r="14" fill="#66bb6a" opacity="' + (redOn ? .22 : 1) + '" class="' + (redOn ? "" : "cr-pop") + '"/></g>'
      + '<g class="' + (redOn ? "cr-walker-stop" : "cr-walker-go") + '"><g transform="translate(110,96)">'
      + '<circle cx="0" cy="0" r="13" fill="#ffe0bd"/><path d="M-13 15 Q0 8 13 15 L15 44 L-15 44 Z" fill="#5c6bc0"/>'
      + '<path d="M-9 44 L-13 60 M9 44 L13 60" stroke="#3949ab" stroke-width="6" stroke-linecap="round"/></g></g>'
      + '<text x="415" y="156" text-anchor="middle" font-size="18" fill="#fff8e1" font-weight="bold">' + (redOn ? "红灯停" : "绿灯行") + '</text>'
      + frameTxt(300, 214, redOn ? "小人在等：红灯亮了不能走" : "绿灯亮了，看左右再出发", 14, "#ffe0b2");
  }
  function demoBox(d, boxVal) {
    return ''
      + '<g class="cr-pop"><rect x="380" y="52" width="120" height="84" rx="12" fill="#ffcc80" stroke="#ef6c00" stroke-width="3"/>'
      + '<text x="440" y="108" text-anchor="middle" class="cr-box-num" font-size="40" fill="#5d4037" font-weight="bold">' + boxVal + '</text></g>'
      + '<text x="440" y="164" text-anchor="middle" font-size="15" fill="#fff8e1">盒子里现在装着 ' + boxVal + '</text>'
      + '<g>' + [0, 1, 2, 3].map(function (n) {
        return '<circle cx="' + (120 + n * 40) + '" cy="96" r="13" fill="' + (n < boxVal ? "#ff7043" : "rgba(255,255,255,.18)") + '" stroke="#fff" stroke-width="1.5" class="' + (n < boxVal ? "cr-pop" : "") + '" style="animation-delay:' + (n * 90) + 'ms"/>';
      }).join("") + '</g>'
      + '<text x="180" y="164" text-anchor="middle" font-size="15" fill="#fff8e1">苹果数 x</text>'
      + frameTxt(300, 214, "未知数 x 就像一个会变的小盒子", 14, "#ffe0b2");
  }
  function demoRobot(d, shown) {
    var CW = 76, CH = 56, X0 = 90, Y0 = 34, r = [0, 1], i, c;
    var cells = "";
    for (var gy = 0; gy < 3; gy++) for (var gx = 0; gx < 5; gx++) {
      var isGoal = d.goal && d.goal[0] === gx && d.goal[1] === gy;
      cells += '<rect class="cr-grid-cell' + (isGoal ? " goal" : "") + '" x="' + (X0 + gx * CW) + '" y="' + (Y0 + gy * CH) + '" width="' + (CW - 6) + '" height="' + (CH - 6) + '" rx="7"/>';
    }
    var trail = "";
    for (i = 0; i < shown && i < (d.path || []).length; i++) {
      c = d.path[i];
      if (c === "R") r[0]++; else if (c === "L") r[0]--; else if (c === "U") r[1]--; else if (c === "D") r[1]++;
      r[0] = Math.max(0, Math.min(4, r[0])); r[1] = Math.max(0, Math.min(2, r[1]));
      trail += '<circle cx="' + (X0 + r[0] * CW + CW / 2 - 3) + '" cy="' + (Y0 + r[1] * CH + CH / 2 - 3) + '" r="4.5" fill="#80cbc4" opacity=".85"/>';
    }
    var rx = X0 + r[0] * CW + CW / 2 - 3, ry = Y0 + r[1] * CH + CH / 2 - 3;
    var starAt = "";
    if (d.goal && r[0] === d.goal[0] && r[1] === d.goal[1]) starAt = '<text x="' + rx + '" y="' + (ry - 18) + '" text-anchor="middle" font-size="18" fill="#ffd54f" class="cr-pop">⭐</text>';
    return trail + cells
      + '<g class="cr-robot"><rect x="' + (rx - 14) + '" y="' + (ry - 13) + '" width="28" height="26" rx="7" fill="#26c6da" stroke="#00838f" stroke-width="2.5"/>'
      + '<circle cx="' + (rx - 5) + '" cy="' + (ry - 3) + '" r="2.8" fill="#00363a"/><circle cx="' + (rx + 5) + '" cy="' + (ry - 3) + '" r="2.8" fill="#00363a"/>'
      + '<rect x="' + (rx - 5) + '" y="' + (ry + 4) + '" width="10" height="3" rx="1.5" fill="#006064"/>'
      + '<line x1="' + rx + '" y1="' + (ry - 13) + '" x2="' + rx + '" y2="' + (ry - 19) + '" stroke="#00838f" stroke-width="2.5"/><circle cx="' + rx + '" cy="' + (ry - 21) + '" r="3" fill="#ff7043"/></g>'
      + starAt
      + '<text x="510" y="220" text-anchor="middle" font-size="14" fill="#ffe0b2">走到 ⭐ 格子就赢</text>';
  }

  function demoHTML(demo, st) {
    if (!demo) return "";
    switch (demo.kind) {
      case "robot": return demoRobot(demo, st.rStep);
      case "stars": return demoStars(demo);
      case "if": return demoIf(demo, st.light);
      case "box": return demoBox(demo, st.boxVal);
      case "zi": return demoZi(demo, st.f);
      case "math": return demoMath(demo, st.f);
      case "pinyin": return demoPinyin(demo, st.f);
      case "abc": return demoABC(demo, st.f);
      case "cards": return demoCards(demo, st.f);
      case "xiang": return demoXiang(demo, st.f);
      case "stroke": return demoStroke(demo, st.f);
      case "poem": return demoPoem(demo, st.f);
      case "clock": return demoClock(demo, st.f);
      case "money": return demoMoney(demo, st.f);
      case "shape": return demoShape(demo, st.f);
      case "chart": return demoChart(demo, st.f);
      case "dialog": return demoDialog(demo, st.f);
      case "phonics": return demoPhonics(demo, st.f);
      case "liangci": return demoLiangci(demo, st.f);
      case "fanyi": return demoFanyi(demo, st.f);
      default: return "";
    }
  }
  function demoTitle(demo) {
    if (!demo) return "";
    return demo.title || "";
  }
  function demoFrames(d) {
    if (!d) return 0;
    switch (d.kind) {
      case "robot": return (d.path || []).length;
      case "box": return (d.to || 3) - (d.from || 0);
      case "zi": return 2;
      case "stars": return 1;
      case "if": return 0;
      case "math": return d.op === "mul" ? (d.a || 3) + 2 : d.op === "div" ? (d.a || 3) + 3 : 4;
      case "pinyin": return 5;
      case "abc": return (d.word || "cat").length + 3;
      case "cards": return (d.items || []).length + 1;
      case "xiang": return Math.min(4, (d.chars || ["日"]).length) * 2 + 1;
      case "stroke": return (STROKES[d.char || "日"] || STROKES["日"]).length + 1;
      case "poem": return (d.lines || [""]).length + 1;
      case "clock": return 4;
      case "money": return 7;
      case "shape": return 6;
      case "chart": return (d.bars || []).length + 1;
      case "dialog": return (d.lines || []).length + 1;
      case "phonics": return (d.letters || ["c"]).length + 3;
      case "liangci": return (d.pairs || []).length + 1;
      case "fanyi": return (d.pairs || []).length + 1;
      default: return 0;
    }
  }

  /* ================= 朗读分段（音画同步核心） ================= */
  function segsOf(text) {
    var s = String(text || "").replace(/<[^>]+>/g, "").trim();
    if (!s) return [];
    var out = [], buf = "", i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i); buf += ch;
      if ("。！？；，、：!?,;:".indexOf(ch) >= 0 && buf.length >= 4) { out.push(buf); buf = ""; }
      else if (buf.length >= 60) { out.push(buf); buf = ""; }
    }
    if (buf) { if (buf.length <= 3 && out.length) out[out.length - 1] += buf; else out.push(buf); }
    return out;
  }
  function isEnText(s) {
    s = String(s || "").replace(/[0-9\s\.\,\!\?\;\:\'\"\(\)\-—…，。！？；：""''（）]/g, "");
    if (!s.length) return false;
    var en = (s.match(/[a-zA-Z]/g) || []).length;
    return en * 2 > s.length;
  }
  function ttsUrl(text, en) {
    var path = String((w.location && w.location.pathname) || "");
    var proxy = path.indexOf("/modules/s/") >= 0 ? "/api/s/tts" : "tts.php";
    return proxy + "?text=" + encodeURIComponent(String(text || "").slice(0, 180)) + "&voice=" + encodeURIComponent(en ? "g-en" : "g-zh");
  }
  function estimateMs(text) {
    var segs = segsOf(text), n = 0, i;
    for (i = 0; i < segs.length; i++) n += segs[i].length;
    return n * 235 + segs.length * 260 + 500;
  }

  /* ================= 挂载 ================= */
  function mount(el, script, opt) {
    opt = opt || {};
    if (!el || !script || !script.length) return { destroy: function () { } };
    var sceneId = opt.scene || pickScene(opt.course || {});
    var sc = SCENES[sceneId] || SCENES.classroom;

    var app = V.createApp({
      data: function () {
        return {
          script: script,
          idx: 0, playing: false, auto: !!opt.auto,
          sceneId: sceneId,
          boardTitle: "", boardLines: [],
          bgSvg: sc.draw(),
          actor: "", act: "", hands: {},
          imagOn: false, imagSvg: "", imagTitle: "",
          rStep: 0, light: "red", boxVal: 0, f: 0,
          capText: "", capWho: "", capSeg: 0, capAll: 0, capTyping: false,
          timers: [], typeTimers: []
        };
      },
      computed: {
        step: function () { return this.idx < script.length ? script[this.idx] : null; },
        curWho: function () { return this.step ? this.step.who : "t"; },
        capBadge: function () { return (WHO[this.curWho] || WHO.t).badge; },
        sceneName: function () {
          var NAMES = { classroom: "教室", meadow: "草地", forest: "森林", sea: "海底", space: "太空", night: "星夜", snow: "雪原", ancient: "古代书院", playground: "操场", farm: "农场" };
          return NAMES[this.sceneId] || "";
        }
      },
      methods: {
        actorCls: function (who) {
          var c = "cr-actor";
          if (this.actor === who) { c += " cr-speaking"; if (this.act) c += " cr-act-" + this.act; }
          if (this.hands[who]) c += " cr-hand-up";
          return c;
        },
        mouthCls: function (who) { return this.actor === who ? "cr-mouth-on" : ""; },
        clearTimers: function () { this.timers.forEach(clearTimeout); this.timers = []; },
        clearTypeTimers: function () { this.typeTimers.forEach(clearTimeout); this.typeTimers = []; },
        later: function (fn, ms) { this.timers.push(setTimeout(fn, ms)); },
        typeAt: function (fn, ms) { this.typeTimers.push(setTimeout(fn, ms)); },
        stopVoice: function () {
          this._stopped = true;
          if (this._audio) { try { this._audio.pause(); } catch (e) { } this._audio = null; }
          if (App.Speech && App.Speech.stop) { try { App.Speech.stop(); } catch (e1) { } }
        },

        /* ★音画同步：逐段朗读 → 每段开始才打字/板书 */
        goto: function (i) {
          if (i < 0 || i >= script.length) return;
          this.clearTimers(); this.clearTypeTimers();
          this.stopVoice();
          this._stopped = false;
          this.idx = i;
          var st = script[i], v = this;
          /* 角色与动作 */
          this.actor = st.who || "t";
          this.act = st.act || (st.who === "t" ? "point" : "");
          this.hands = {};
          if (st.who === "t" && st.act === "cheer") { this.hands.s1 = true; this.hands.s2 = true; }
          if (st.act === "raise") this.hands[st.who] = true;
          /* 板书(每步重置, 标题立即出现, 行随朗读浮现) */
          var bd = st.board || [];
          this.boardLines = [];
          this.boardTitle = Array.isArray(bd) ? (bd[0] || "") : String(bd);
          /* 分段朗读+打字 */
          var txt = st.t || "";
          var segs = segsOf(txt);
          this.capText = ""; this.capTyping = !!segs.length; this.capWho = txt;
          this.capSeg = 0; this.capAll = segs.length;
          this.playSegs(st.who, segs, {
            onSeg: function (k, seg) {
              /* 该段开始：打字机打这段 + 对应板书行浮现 */
              v.typeSeg(seg);
              var lineIdx = k; /* 板书行 j 在段 j 出现 */
              if (lineIdx >= 0 && lineIdx < bd.length - 1) {
                var ln = bd[lineIdx + 1];
                if (ln && v.boardLines.indexOf(ln) < 0) v.boardLines.push(ln);
              }
            },
            onDone: function () { v.capTyping = false; }
          });
          /* demo 浮层 */
          this.rStep = 0; this.light = "red"; this.boxVal = st.demo && st.demo.from || 0; this.f = 0;
          this.imagTitle = demoTitle(st.demo);
          if (st.demo) { this.imagSvg = demoHTML(st.demo, this); this.imagOn = true; this.runDemo(st.demo); }
          else { this.imagSvg = ""; this.imagOn = false; }
          /* fallback: 若 9 秒一段都没读完(断网/无手势)，自动把字幕补完，不卡课堂 */
          this.later(function () { if (v.capSeg === 0 && v.capTyping) { v.capText = txt; v.capTyping = false; } }, 9000);
        },
        typeSeg: function (seg) {
          var v = this, i;
          this.clearTypeTimers();
          var base = this.capText;
          var speed = isEnText(seg) ? 70 : 88;
          for (i = 0; i < seg.length; i++) {
            (function (n) {
              v.typeAt(function () { v.capText = base + seg.slice(0, n + 1); if (n === seg.length - 1) v.capSeg++; }, speed * n);
            })(i);
          }
        },
        playSegs: function (who, segs, hooks) {
          var v = this, k = 0, en = isEnText(segs.join("") || "");
          var rate = (WHO[who] || WHO.t).rate || 1;
          if (!segs.length) { hooks.onDone && hooks.onDone(); return; }
          function playNext() {
            if (v._stopped) return;
            if (k >= segs.length) { hooks.onDone && hooks.onDone(); return; }
            var seg = segs[k];
            hooks.onSeg && hooks.onSeg(k, seg);
            var a = null;
            try { a = new Audio(ttsUrl(seg, en)); } catch (e) { a = null; }
            if (!a) { k++; v.later(playNext, 700); return; }
            v._audio = a;
            try { a.playbackRate = rate; } catch (e2) { }
            a.onended = function () { if (v._audio === a) v._audio = null; k++; setTimeout(playNext, 90); };
            a.onerror = function () { if (v._audio === a) v._audio = null; k++; v.later(playNext, Math.max(700, seg.length * 200)); };
            var pr = a.play && a.play();
            if (pr && pr.catch) pr.catch(function () { k++; v.later(playNext, 700); });
          }
          playNext();
        },
        runDemo: function (d) {
          var v = this;
          function paint() { v.imagSvg = demoHTML(d, v); }
          if (d.kind === "robot") {
            var steps = (d.path || []).length;
            for (var i = 1; i <= steps; i++) (function (n) { v.later(function () { v.rStep = n; paint(); }, 800 + n * 900); })(i);
          } else if (d.kind === "if") {
            var flip = function () {
              if (v.idx < script.length && script[v.idx].demo !== d) return;
              v.light = v.light === "red" ? "green" : "red"; paint();
              v.timers.push(setTimeout(flip, 2600));
            };
            v.timers.push(setTimeout(flip, 2600));
          } else if (d.kind === "box") {
            var to = d.to || 3, from = d.from || 0, k2 = from;
            var tick = function () {
              if (k2 >= to) return;
              k2++; v.boxVal = k2; paint();
              v.timers.push(setTimeout(tick, 950));
            };
            v.timers.push(setTimeout(tick, 950));
          } else if (d.kind === "stars") {
            paint();
          } else {
            var total = demoFrames(d);
            for (var fi = 1; fi <= total; fi++) (function (n) { v.later(function () { v.f = n; paint(); }, 700 + n * 900); })(fi);
          }
        },
        next: function () { this.stopAuto(); this.goto(this.idx + 1); },
        prev: function () { this.stopAuto(); this.goto(this.idx - 1); },
        replay: function () { this.stopAuto(); this.goto(this.idx); },
        stepMs: function () {
          var st = this.step;
          var base = estimateMs(st && st.t) + 600;
          if (st && st.demo) {
            var dm;
            if (st.demo.kind === "robot") dm = 1200 + (st.demo.path || []).length * 900;
            else if (st.demo.kind === "stars" || st.demo.kind === "if") dm = 3000;
            else dm = 1200 + demoFrames(st.demo) * 900;
            base = Math.max(base, dm + 800);
          }
          return base;
        },
        playAuto: function () {
          var v = this;
          this.auto = true;
          var adv = function () {
            if (!v.auto) return;
            if (v.idx >= script.length - 1) { v.auto = false; return; }
            v.idx++;
            v.goto(v.idx);
            v.timers.push(setTimeout(adv, v.stepMs()));
          };
          this.timers.push(setTimeout(adv, this.stepMs()));
        },
        stopAuto: function () { this.auto = false; this.clearTimers(); this.capTyping = false; }
      },
      mounted: function () { this.goto(0); if (this.auto) this.playAuto(); },
      beforeUnmount: function () { this.stopAuto(); this.clearTimers(); this.clearTypeTimers(); },
      template: ''
        + '<div class="cr-wrap">'
        + '<div class="cr-scene">'
        + '<svg viewBox="0 0 680 420" xmlns="http://www.w3.org/2000/svg" class="cr-svg">'
        + '<defs>' + sceneDefs(sceneId) + '</defs>'
        + '<g class="cr-bg-fade"><g v-html="bgSvg"></g></g>'
        /* 石板(板书) */
        + '<g class="cr-slate">'
        + '<rect x="452" y="16" width="212" height="148" rx="12" fill="#6d4c41"/>'
        + '<rect x="459" y="23" width="198" height="134" rx="8" fill="#2f5d4e"/>'
        + '<rect x="459" y="23" width="198" height="134" rx="8" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="4"/>'
        + '<text x="558" y="48" text-anchor="middle" class="cr-board-txt chalkIn" font-size="17">{{boardTitle}}</text>'
        + '<text v-for="(ln, li) in boardLines" :key="\'bl\'+li" x="470" :y="74 + li*30" class="cr-board-line" font-size="14">{{ln}}</text>'
        + '<text x="558" y="150" text-anchor="middle" font-size="11" fill="rgba(255,255,255,.4)">{{sceneName}} · 第{{idx+1}}/{{script.length}}步</text>'
        + '</g>'
        /* 角色 */
        + castSVG()
        /* 想象浮层 */
        + '<g v-if="imagOn" class="cr-imag">'
        + '<rect x="28" y="106" width="624" height="264" rx="18" fill="rgba(16,34,52,.93)" stroke="#ffe082" stroke-width="2.5"/>'
        + '<rect x="28" y="106" width="624" height="34" rx="18" fill="rgba(255,224,130,.14)"/>'
        + '<text x="46" y="129" font-size="15" fill="#ffe082" font-weight="bold">💡 {{imagTitle}}</text>'
        + '<text x="636" y="129" text-anchor="end" font-size="12" fill="rgba(255,224,130,.5)">想象画面</text>'
        + '<g transform="translate(40,146)"><g v-html="imagSvg"></g></g>'
        + '</g>'
        + '</svg>'
        + '</div>'
        /* 字幕条(朗读驱动) */
        + '<div class="cr-caption">'
        + '<span class="cr-cap-badge">{{capBadge}}</span>'
        + '<div class="cr-cap-main">'
        + '<div class="cr-cap-meta">{{capBadge}} · 正在读第 {{Math.min(capSeg+1, capAll||1)}}/{{capAll||1}} 段</div>'
        + '<div class="cr-cap-text">{{capText}}<span v-if="capTyping" class="cr-caret">▌</span></div>'
        + '</div>'
        + '</div>'
        /* 控制条 */
        + '<div class="cr-ctrl">'
        + '<button class="btn" @click="prev" :disabled="idx<=0">‹ 上一步</button>'
        + '<button class="btn spk" @click="replay">↺ 重播本步</button>'
        + '<button class="btn" @click="auto ? stopAuto() : playAuto()">{{auto ? "⏸ 暂停" : "▶ 自动上课"}}</button>'
        + '<div class="cr-dots"><span v-for="(s,di) in script" :key="di" class="cr-dot" :class="{on: di===idx, done: di<idx}" @click="stopAuto(); goto(di)"></span></div>'
        + '<button class="btn next" @click="next" :disabled="idx>=script.length-1">下一步 ›</button>'
        + '</div>'
        + (opt.doneTip ? '<div class="cr-done-tip" v-if="idx>=script.length-1">' + opt.doneTip + '</div>' : '')
        + '</div>'
    });
    app.mount(el);
    return {
      destroy: function () { try { app.unmount(); } catch (e) { } }
    };
  }

  /* ================= 剧本自动生成（丰富互动版） ================= */
  var OPEN_LINES = [
    "同学们好！欢迎来到魔法课堂，今天我们一起学《{T}》！",
    "叮铃铃~上课啦！今天这节《{T}》，保证精彩！",
    "嗨，小朋友们！准备好了吗？今天的主角是《{T}》！"
  ];
  var END_LINES = [
    "今天学得真棒！去「同步练习」闯关检验一下吧！",
    "课堂到这里，小脑袋里记住多少啦？去做几道题试试！",
    "下课啦！别忘了做「同步练习」，看看你能拿几颗星！"
  ];
  var S3_ASKS = ["老师，为什么要学这个呀？", "这个有什么用呢？我想知道！", "皮皮有疑问：学它难不难呀？"];
  var CHEERS = ["哦——原来是这样，我懂啦！", "太神奇了吧！我记住啦！", "耶！这个我会了会了！"];
  var THINKS = ["让我想一想……嗯！", "球球在想：和我知道的一样吗？", "好像有点意思，我再想想……"];

  function pick(arr, seed) { return arr[Math.abs(seed || 0) % arr.length]; }

  function toScript(course, opt) {
    opt = opt || {};
    var seed = (course.t || "").length + (course._i || 0);
    var s = [];
    s.push({ who: "t", act: "wave", t: pick(OPEN_LINES, seed).replace("{T}", course.t), board: [course.t] });
    s.push({ who: "t", act: "point", t: "先说说为什么学它：" + course.why + "。学会它，你就又前进一大步！", board: ["为什么要学？", (course.why || "").slice(0, 15)] });
    s.push({ who: "s3", act: "raise", t: pick(S3_ASKS, seed + 1) });
    s.push({ who: "s1", act: "cheer", t: "我准备好啦，老师快开始吧！" });
    var steps = course.steps || [];
    steps.forEach(function (txt, i) {
      s.push({
        who: "t", act: i % 2 ? "write" : "point",
        t: txt,
        board: ["第" + (i + 1) + "步", txt.length <= 14 ? txt : txt.slice(0, 13) + "…"],
        demo: opt.demoFor ? opt.demoFor(course, i, txt) : null
      });
      if (i === 1) s.push({ who: pick(STUDENTS, seed + i), act: "cheer", t: pick(CHEERS, seed + i) });
      if (i === 3) s.push({ who: pick(STUDENTS, seed + i + 2), act: "think", t: pick(THINKS, seed + i) });
      if (i === Math.floor(steps.length / 2) && i > 1 && i !== 1 && i !== 3) s.push({ who: pick(STUDENTS, seed * 3 + i), t: "老师，我会了！让我来说一遍：" + txt.slice(0, 18) });
    });
    s.push({ who: "t", act: "cheer", t: pick(END_LINES, seed + 5), board: ["随堂练习", "Go Go Go!"] });
    return s;
  }

  App.Classroom = {
    mount: mount,
    toScript: toScript,
    WHO: WHO,
    SCENES: SCENES,
    pickScene: pickScene,
    PICT: PICT,
    STROKES: STROKES
  };
})(window);
