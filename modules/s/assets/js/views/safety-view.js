/*
 * safety-view.js — 视图层 / 「孩子保命有妙招108招」动漫版 (2026-10-28 新增)
 *
 * 用户诉求: 「孩子保命有妙招108招 动漫版」
 * 结构: 12 大类 × 每类 9 招 = 108 招
 *   每招 = 动漫情景漫画(SVG) + 口诀 + 危险原理 + 正确做法 + 千万别做 + 情景测验
 *
 * 关键约定:
 *   - 动漫画面由 services/safety-art.js 生成(Q版角色+12类场景+道具), 每招一幅
 *   - 语音朗读走 App.Speech(已带数学符号归一化/音色轮换), 整招一次读完
 *   - 学习进度存 localStorage key=safety_learned
 */
(function (w) {
  'use strict';
  var App = (w.App = w.App || {});

  /* 本地存取学习进度 */
  var KEY = 'safety_learned';
  function loadLearned() {
    try {
      var s = localStorage.getItem(KEY);
      var arr = s ? JSON.parse(s) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function saveLearned(a) {
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) { }
  }

  var T = [];
  /* ═══ ① 分类总览 ═══ */
  T.push(
    '<site-shell icon="🛡️" title="孩子保命有妙招108招" sub="12大类·108条保命技能·漫画+口诀+情景测验">',
    '<style>',
    '/* ── 卡通容器 ── */',
    '.sf-wrap{max-width:1000px;margin:0 auto;}',
    '.sf-art{width:100%;height:auto;display:block;border-radius:14px;}',
    '.sf-bg-total{background:#fff8e1;border:2px solid #ffcc80;border-radius:16px;padding:12px 14px;margin-bottom:12px;text-align:center;}',
    '.sf-bg-total b{color:#e65100;font-size:19px;}',
    '.sf-total-bar{height:12px;background:#ffe0b2;border-radius:99px;overflow:hidden;margin-top:8px;}',
    '.sf-total-in{height:100%;background:linear-gradient(90deg,#ffb74d,#ff7043);transition:width .4s;}',
    /* ── 分类卡片 ── */
    '.sf-cats{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;margin:0 -5px;}',
    '.sf-cat{-webkit-flex:1 1 200px;flex:1 1 200px;margin:6px 5px;padding:14px 12px;border-radius:16px;',
    '  text-align:center;color:#fff;cursor:pointer;box-shadow:0 4px 0 rgba(0,0,0,.14);transition:transform .1s;}',
    '.sf-cat:active{-webkit-transform:translateY(3px);transform:translateY(3px);}',
    '.sf-cat .sf-ce{font-size:36px;display:block;line-height:1.1;}',
    '.sf-cat .sf-ct{font-size:17px;font-weight:bold;display:block;margin-top:3px;}',
    '.sf-cat .sf-cd{font-size:12px;opacity:.95;display:block;margin-top:2px;}',
    '.sf-cat .sf-cp{font-size:11.5px;display:block;margin-top:6px;background:rgba(0,0,0,.22);border-radius:99px;padding:2px 0;}',
    /* ── 招数列表 ── */
    '.sf-back{display:inline-block;margin-bottom:10px;}',
    '.sf-list{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;margin:0 -5px;}',
    '.sf-item{-webkit-flex:1 1 280px;flex:1 1 280px;margin:6px 5px;background:#fff;border:2px solid #ffe0b2;',
    '  border-radius:14px;overflow:hidden;cursor:pointer;transition:transform .1s;}',
    '.sf-item:active{-webkit-transform:translateY(2px);transform:translateY(2px);}',
    '.sf-item .sf-ipic{background:#f5f5f5;}',
    '.sf-item .sf-ib{padding:9px 11px;}',
    '.sf-item .sf-it{font-size:15.5px;font-weight:bold;color:#37474f;}',
    '.sf-item .sf-itip{font-size:12.5px;color:#6d4c41;margin-top:3px;line-height:1.5;}',
    '.sf-item.done{border-color:#81c784;}',
    '.sf-done{float:right;font-size:11.5px;background:#e8f5e9;color:#2e7d32;border-radius:99px;padding:1px 7px;font-weight:bold;}',
    /* ── 详情页 ── */
    '.sf-detail{background:#fff;border:2px solid #ffe0b2;border-radius:16px;padding:12px;margin-bottom:12px;}',
    '.sf-head{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;-webkit-flex-wrap:wrap;flex-wrap:wrap;}',
    '.sf-no{background:#e65100;color:#fff;font-size:13px;font-weight:bold;border-radius:99px;padding:3px 12px;margin-right:8px;}',
    '.sf-ctype{font-size:13px;color:#795548;}',
    '.sf-title{font-size:23px;font-weight:bold;color:#212121;margin:8px 0 2px;}',
    '.sf-pic{border-radius:14px;overflow:hidden;margin:10px 0;border:2px solid #eee;}',
    /* 信息卡: 全部浅底深字, 保证小字也满足 4.5:1 */
    '.sf-card{border-radius:12px;padding:10px 12px;margin-top:9px;font-size:14px;line-height:1.75;}',
    '.sf-card b{display:block;margin-bottom:3px;font-size:14.5px;}',
    '.sf-tip{background:#fff8e1;color:#5d4037;border:1.5px dashed #ffb74d;}',
    '.sf-tip b{color:#e65100;}',
    '.sf-why{background:#fff3e0;color:#6d4c00;border:1.5px solid #ffcc80;}',
    '.sf-why b{color:#bf360c;}',
    '.sf-do{background:#f1f8e9;color:#33691e;border:1.5px solid #c5e1a5;}',
    '.sf-do b{color:#33691e;}',
    '.sf-do ol{margin:0;padding-left:20px;}',
    '.sf-do li{margin:3px 0;}',
    '.sf-no-do{background:#ffebee;color:#b71c1c;border:1.5px solid #ef9a9a;}',
    '.sf-no-do b{color:#b71c1c;}',
    /* ── 测验 ── */
    '.sf-quiz{background:#e8eaf6;border-radius:12px;padding:11px 12px;margin-top:10px;}',
    '.sf-quiz b{color:#283593;display:block;margin-bottom:6px;font-size:14.5px;}',
    '.sf-opt{display:block;width:100%;text-align:left;background:#fff;color:#263238;border:1.5px solid #c5cae9;',
    '  border-radius:10px;padding:8px 11px;margin:5px 0;font-size:14px;cursor:pointer;}',
    '.sf-opt.right{background:#e8f5e9;border-color:#66bb6a;color:#1b5e20;font-weight:bold;}',
    '.sf-opt.wrong{background:#ffebee;border-color:#ef9a9a;color:#b71c1c;}',
    '.sf-expo{margin-top:7px;font-size:13px;line-height:1.7;color:#37474f;background:#fff;border-radius:9px;padding:8px 10px;}',
    '.sf-expo b{color:#c62828;}',
    /* ── 操作条 ── */
    '.sf-bar{display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;-webkit-justify-content:center;justify-content:center;gap:8px;margin:10px 0;}',
    '.sf-bar .sfa-btn{margin:3px;}',
    '.sfa-btn{border:none;border-radius:22px;padding:9px 16px;font-size:14.5px;font-weight:bold;color:#fff;cursor:pointer;',
    '  background:-webkit-linear-gradient(180deg,#d84315,#bf360c);background:linear-gradient(180deg,#d84315,#bf360c);',
    '  box-shadow:0 3px 0 #8e2a08;}',
    '.sfa-btn:active{-webkit-transform:translateY(2px);transform:translateY(2px);}',
    '.sfa-btn.ghost{background:#fff;color:#37474f;border:2px solid #cfd8dc;box-shadow:none;}',
    '.sfa-btn:disabled{opacity:.5;}',
    /* ── 动漫入场动画 ── */
    '@keyframes sfFloat{0%,100%{transform:translateY(0);}50%{transform:translateY(-5px);}}',
    '.sf-pic{animation:sfFloat 3.4s ease-in-out infinite;}',
    '@keyframes sfPop{from{transform:scale(.94);opacity:0;}to{transform:scale(1);opacity:1;}}',
    '.sf-detail{animation:sfPop .28s ease both;}',
    '</style>'
  );
  /* 总览模式 */
  T.push(
    '<div class="sf-wrap" v-if="mode===\'cats\'">',
    '<div class="sf-bg-total">🛡️ 一共 <b>108</b> 条保命妙招，已学 <b>{{learned.length}}</b> 条',
    '<div class="sf-total-bar"><div class="sf-total-in" :style="{width: (learned.length/108*100)+ \'%\'}"></div></div>',
    '<div style="font-size:12px;color:#8d6e63;margin-top:6px;">点开一个大类，看漫画、学口诀、考考自己</div>',
    '</div>',
    '<div class="sf-cats">',
    '<div class="sf-cat" v-for="c in cats" :key="c.id" :style="{background:c.bg}" @click="openCat(c)">',
    '<span class="sf-ce">{{c.i}}</span><span class="sf-ct">{{c.t}}</span><span class="sf-cd">{{c.d}}</span>',
    '<span class="sf-cp">已学 {{countIn(c.id)}} / 9</span>',
    '</div></div>',
    '<div class="sf-bar"><button class="sfa-btn" @click="randAll">🎲 随机学一招</button></div>',
    '</div>'
  );
  /* 列表模式 */
  T.push(
    '<div class="sf-wrap" v-if="mode===\'list\'">',
    '<div class="sf-bar"><button class="sfa-btn ghost" @click="mode=\'cats\'">← 返回大类</button>',
    '<button class="sfa-btn" @click="speakCat">🔊 朗读本类九招口诀</button></div>',
    '<div class="sf-bg-total" :style="{background: curCat.bg, color:\'#fff\', borderColor: curCat.bg}">',
    '<span style="font-size:30px">{{curCat.i}}</span> <b style="color:#fff">{{curCat.t}}</b>',
    '<div style="font-size:13px;margin-top:3px;">{{curCat.d}} · 共 9 招 · 点开看漫画</div></div>',
    '<div class="sf-list">',
    '<div class="sf-item" :class="{done: isDone(r.i)}" v-for="r in list" :key="r.i" @click="open(r)">',
    '<div class="sf-ipic" v-html="art(r)"></div>',
    '<div class="sf-ib"><span class="sf-done" v-if="isDone(r.i)">✓ 已学</span>',
    '<div class="sf-it">第{{r.i}}招 · {{r.t}}</div><div class="sf-itip">{{r.tip}}</div></div>',
    '</div></div></div>'
  );
  /* 详情模式 */
  T.push(
    '<div class="sf-wrap" v-if="mode===\'detail\' && item">',
    '<div class="sf-bar">',
    '<button class="sfa-btn ghost" @click="mode=\'list\'">← 返回列表</button>',
    '<button class="sfa-btn ghost" :disabled="pos<=0" @click="prev">◀ 上一招</button>',
    '<span class="sf-no">{{item.i}} / 108</span>',
    '<button class="sfa-btn" @click="next">下一招 ▶</button>',
    '<button class="sfa-btn ghost" @click="randAll">🎲 随机</button>',
    '</div>',
    '<div class="sf-detail">',
    '<div class="sf-head"><span class="sf-ctype">{{catOf.t}} {{catOf.i}}</span></div>',
    '<div class="sf-title">{{item.t}}</div>',
    '<div class="sf-pic" v-html="art(item)"></div>',
    '<div class="sf-card sf-tip"><b>🧠 保命口诀</b>{{item.tip}}</div>',
    '<div class="sf-card sf-why"><b>⚠️ 为什么会危险</b>{{item.why}}</div>',
    '<div class="sf-card sf-do"><b>✅ 正确做法</b><ol><li v-for="(s,n) in item.do" :key="n">{{s}}</li></ol></div>',
    '<div class="sf-card sf-no-do"><b>⛔ 千万别做</b>{{item.no}}</div>',
    '<div class="sf-bar">',
    '<button class="sfa-btn" @click="readItem">🔊 朗读整招</button>',
    '<button class="sfa-btn ghost" @click="readOnly(\'tip\')">📣 只读口诀</button>',
    '</div>',
    /* 情景测验 */
    '<div class="sf-quiz">',
    '<b>🎯 情景考一考：{{item.q.q}}</b>',
    '<button class="sf-opt" v-for="(o,n) in item.q.o" :key="n"',
    '  :class="{right: answered && n===item.q.a, wrong: answered && picked===n && n!==item.q.a}"',
    '  :disabled="answered" @click="pick(n)">{{"ABCD".charAt(n)}}. {{o}}</button>',
    '<div class="sf-expo" v-if="answered">',
    '<b>{{picked===item.q.a ? "✔ 答对啦！" : "✘ 再想想～"}}</b><br>{{item.q.why}}</div>',
    '<button class="sfa-btn ghost" v-if="answered" @click="again" style="margin-top:8px">🔄 再考一次</button>',
    '</div>',
    '</div></div>'
  );
  T.push('</site-shell>');

  /* ★Vue 3: 视图必须注册到 App.views[data-view], 由 app.js 启动器挂载 */
  App.views = App.views || {};
  App.views.safety = {
    template: T.join(''),
    data: function () {
      return { mode: 'cats', cat: null, idx: 0, picked: -1, answered: false, learned: loadLearned() };
    },
    computed: {
      cats: function () { return App.SAFETY_CATS || []; },
      catOf: function () { return (App.SAFETY_CAT_MAP && this.item && App.SAFETY_CAT_MAP[this.item.c]) || { t: '', i: '' }; },
      list: function () {
        var c = this.cat;
        if (!c) return [];
        return (App.SAFETY || []).filter(function (r) { return r.c === c.id; });
      },
      curCat: function () { return this.cat || { i: '', t: '', d: '', bg: '#795548' }; },
      item: function () { return this.list[this.idx] || null; },
      pos: function () { return this.idx; }
    },
    methods: {
      countIn: function (cid) {
        var self = this;
        return (App.SAFETY || []).filter(function (r) {
          return r.c === cid && self.learned.indexOf(r.i) >= 0;
        }).length;
      },
      isDone: function (i) { return this.learned.indexOf(i) >= 0; },
      /* 动漫场景图 */
      art: function (r) {
        try {
          if (!r || !App.SafetyArt) return '';
          return App.SafetyArt.svg(r.art || {});
        } catch (e) { return ''; }
      },
      openCat: function (c) { this.cat = c; this.idx = 0; this.reset(); this.mode = 'list'; },
      open: function (r) {
        this.idx = this.list.indexOf(r);
        if (this.idx < 0) this.idx = 0;
        this.reset(); this.mode = 'detail';
      },
      reset: function () { this.picked = -1; this.answered = false; },
      again: function () { this.reset(); },
      prev: function () { if (this.idx > 0) { this.idx--; this.reset(); } },
      next: function () {
        if (this.idx < this.list.length - 1) { this.idx++; this.reset(); }
        else { App.Speech && App.Speech.speak('这一类九招都学完啦，换下一个大类继续吧！'); this.mode = 'list'; }
      },
      randAll: function () {
        var all = App.SAFETY || [];
        if (!all.length) return;
        var r = all[Math.floor(Math.random() * all.length)];
        var c = App.SAFETY_CAT_MAP && App.SAFETY_CAT_MAP[r.c];
        if (!c) return;
        this.cat = c;
        this.idx = this.list.indexOf(r);
        this.reset(); this.mode = 'detail';
      },
      pick: function (n) {
        if (this.answered) return;
        this.picked = n; this.answered = true;
        var it = this.item, self = this;
        if (!it) return;
        if (n === it.q.a) {
          if (App.Speech) App.Speech.speak('答对啦！' + it.q.why);
          if (App.Store && App.Store.addStars) App.Store.addStars(1);
        } else {
          if (App.Speech) App.Speech.speak('再想一想，正确答案是' + it.q.o[it.q.a] + '。' + it.q.why);
        }
        /* 答对即记为本招已学 */
        if (this.learned.indexOf(it.i) < 0) {
          this.learned.push(it.i); saveLearned(this.learned);
        }
      },
      readItem: function () {
        var it = this.item; if (!it || !App.Speech) return;
        var steps = (it.do || []).map(function (s, n) { return '第' + (n + 1) + '步，' + s; }).join('；');
        App.Speech.speak(
          '第' + it.i + '招，' + it.t + '。口诀是：' + it.tip +
          '。为什么会危险呢，' + it.why +
          '。正确做法是：' + steps +
          '。千万不能这样做：' + it.no
        );
      },
      readOnly: function () {
        var it = this.item; if (!it || !App.Speech) return;
        App.Speech.speak(it.tip);
      },
      speakCat: function () {
        if (!App.Speech) return;
        App.Speech.speak('这一类是' + this.curCat.t + '，一共九招，我们一招一招来学。');
      }
    },
    mounted: function () {
      var self = this;
      setTimeout(function () {
        if (App.Speech) App.Speech.speak('欢迎来到保命妙招一百零八招，这里有一百零八条能保护自己的本事，点开一个大类开始学吧！');
      }, 800);
    }
  };
})(window);
