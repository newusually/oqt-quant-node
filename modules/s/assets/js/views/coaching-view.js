/* coaching-view.js — 视图层 / 针对性辅导 (2026-10-27)
 * 弱项诊断(基于 Banks.weakList 答题记录) → 知识点名称映射 → 推荐对应星级练习卷
 * 注意力模式设置(与 fx/speakfx 联动) + 学习建议 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var U = App.U, Banks = App.Banks, Exam = App.Exam, FX = App.FX;
  if (!w.Vue) return;

  /* 跨学科知识点名称表: kp数字 -> {语文名, 数学名, 英语名}
   * ★2026-10-27 懒加载: 题库按需注入, KP_MAP 改为可重建函数 —— 全部题库
   *   后台渐进载完(App.Bank.loadAllBanksSlow)后重建一次, 名称/推荐自动升级。 */
  var KP_MAP = {};
  function buildKpMap() {
    try {
      var ex = App.DATA && App.DATA.exam;
      var SUBJ = { chinese: "语文", math: "数学", english: "英语" };
      for (var k in ex) {
        if (k === "papers" || !ex[k].kps) continue;
        var meta = ex[k].meta || {};
        var sn = SUBJ[meta.subject] || "";
        for (var id in ex[k].kps) {
          KP_MAP[id] = KP_MAP[id] || {};
          if (sn && KP_MAP[id].indexOf(ex[k].kps[id]) < 0) KP_MAP[id].push(sn + "·" + ex[k].kps[id]);
        }
      }
    } catch (e) {}
  }
  buildKpMap();

  App.views = App.views || {};
  App.views.coaching = {
    name: "coaching",
    template: [
      '<site-shell title="针对性辅导" sub="哪里薄弱练哪里，智能推荐练习" icon="🩺">',
      '<div class="ltabs">',
      '<button class="ltab" :class="{on: tab===\'diag\'}" @click="tab=\'diag\'">🔍 薄弱点诊断</button>',
      '<button class="ltab" :class="{on: tab===\'plan\'}" @click="tab=\'plan\'">📋 每日辅导计划</button>',
      '<button class="ltab" :class="{on: tab===\'focus\'}" @click="tab=\'focus\'">👁 学习专注设置</button>',
      '</div>',

      /* 1. 薄弱点诊断 */
      '<div class="card lpanel" v-show="tab===\'diag\'">',
      '<div class="co-hint" v-if="!items.length">🎉 太棒了！还没有发现薄弱点。<br>去做几套题，我会帮你找出需要加强的知识点～</div>',
      '<div v-for="(it, i) in items" :key="i" class="co-item">',
      '<div class="co-kp">',
      '<span class="co-rank" :class="\'r\' + it.level">{{it.n}}次</span>',
      '<b>{{it.name}}</b>',
      '<button class="btn spk" @click="speakIt(it.name, $event)">🔊</button>',
      '</div>',
      '<div class="co-recs">',
      '<div class="co-rec" v-for="(r, j) in it.recs" :key="j">',
      '<span class="co-paper">{{r.ti}}</span>',
      '<span class="co-go" @click="go(r)">去练习 →</span>',
      '</div>',
      '</div>',
      '</div>',
      '<div class="co-hint" v-if="items.length">💡 练对之后错误次数会自动减少，练熟的知识点会从列表消失。</div>',
      '</div>',

      /* 2. 每日辅导计划 */
      '<div class="card lpanel" v-show="tab===\'plan\'">',
      '<div class="co-plan" v-for="(p, i) in plan" :key="i">',
      '<div class="co-step"><span class="fx-num">{{i+1}}</span> <b>{{p.t}}</b> <span class="co-why">{{p.why}}</span></div>',
      '<div class="co-recs">',
      '<div class="co-rec" v-for="(r, j) in p.recs" :key="j"><span class="co-paper">{{r.ti}}</span><span class="co-go" @click="go(r)">去练习 →</span></div>',
      '</div>',
      '</div>',
      '</div>',

      /* 3. 专注设置 */
      '<div class="card lpanel" v-show="tab===\'focus\'">',
      '<div class="co-hint">根据学习习惯调整跟读高亮的强度和节奏（全站生效）：</div>',
      '<div class="co-att">',
      '<button class="btn" :class="{on: att===\'calm\'}" @click="setAtt(\'calm\')">🌙 舒缓模式<small>高亮柔和、停留更久</small></button>',
      '<button class="btn" :class="{on: att===\'normal\'}" @click="setAtt(\'normal\')">☀️ 标准模式<small>适合大多数同学</small></button>',
      '<button class="btn" :class="{on: att===\'focus\'}" @click="setAtt(\'focus\')">🎯 专注模式<small>高亮更强、节奏更快</small></button>',
      '</div>',
      '<div class="co-hint">试一试（点下面的字，看高亮效果）：</div>',
      '<div class="co-demo">',
      '<span class="co-w" @click="demo(\'拼音\', $event)">拼音</span>',
      '<span class="co-w" @click="speakEnDemo(\'English\', $event)">English</span>',
      '<span class="co-w" @click="demo(\'五加三等于八\', $event)">5+3=8</span>',
      '</div>',
      '</div>',
      '</site-shell>'
    ].join("\n"),
    data: function () {
      return {
        tab: "diag",
        items: [],
        plan: [],
        att: (FX && FX.attention()) || "normal"
      };
    },
    created: function () {
      this.refresh();
      /* ★懒加载: 推荐算法需要全部题库, 但后台渐进注入(并发2), 不阻塞首屏 */
      var self = this;
      if (App.Bank && App.Bank.loadAllBanksSlow) {
        App.Bank.loadAllBanksSlow().then(function () {
          buildKpMap();
          self.refresh();
        });
      }
    },
    methods: {
      refresh: function () {
        var list = (Banks && Banks.weakList ? Banks.weakList() : []) || [];
        list.sort(function (a, b) { return b.n - a.n; });
        this.items = list.slice(0, 12).map(function (x) {
          var names = KP_MAP[x.kp] || [("知识点" + x.kp)];
          var recs = this.recommend(x.kp);
          return { kp: x.kp, n: x.n, level: x.n >= 3 ? 3 : x.n, name: names.slice(0, 2).join(" / "), recs: recs };
        }, this);
        /* 每日计划: 拼音必练 + 最弱两项 + 一套综合 */
        var plan = [
          { t: "拼音拼读 10 分钟", why: "拼读是一年级语文的地基", recs: this.byType("pinyin").slice(0, 3) }
        ];
        this.items.slice(0, 2).forEach(function (it) {
          plan.push({ t: "专项补弱：" + it.name, why: "已错 " + it.n + " 次，优先攻克", recs: it.recs.slice(0, 3) });
        });
        plan.push({ t: "综合卷一份", why: "检验今天的学习成果", recs: (Exam && Exam.list ? Exam.list({ type: "final" }) : []).slice(0, 3) });
        this.plan = plan.filter(function (p) { return p.recs && p.recs.length; });
      },
      recommend: function (kp) {
        /* 从 13230+150 套里按知识点挑卷: 含该 kp 题目最多的卷 */
        if (!App.DATA || !App.DATA.exam) return [];
        var out = [];
        try {
          var banks = App.DATA.exam, papers = banks.papers.papers;
          /* 找包含该 kp 的年级库 */
          var keys = [];
          for (var k in banks) { if (k === "papers") continue; var d = banks[k]; if (d.kps && d.kps[kp]) keys.push(k); }
          var idset = {};
          keys.forEach(function (key) { banks[key].qs.forEach(function (q) { if (q.k === kp) idset[q.i] = 1; }); });
          /* 拼音kp优先推拼音星级卷 */
          var kpName = (KP_MAP[kp] || [""])[0];
          if (/拼音/.test(kpName)) {
            out = papers.filter(function (p) { return p.ty === "pinyin"; }).slice(0, 4);
          }
          if (!out.length) {
            /* 通用: 按命中题数排序取前4 */
            var scored = papers.map(function (p) {
              var hit = 0; for (var i = 0; i < p.qs.length; i++) if (idset[p.qs[i]]) hit++;
              return { p: p, hit: hit };
            }).filter(function (x) { return x.hit >= 3; });
            scored.sort(function (a, b) { return b.hit - a.hit; });
            out = scored.slice(0, 4).map(function (x) { return x.p; });
          }
        } catch (e) {}
        return out;
      },
      byType: function (ty) {
        try { return App.DATA.exam.papers.papers.filter(function (p) { return p.ty === ty; }).slice(0, 4); } catch (e) { return []; }
      },
      go: function (p) { w.location.href = "试卷中心.html"; },
      setAtt: function (m) { this.att = m; if (FX) FX.setAttention(m); },
      speakIt: function (t, ev) { App.Speech.speak(t, { el: ev && (ev.currentTarget || ev.target) }); },
      demo: function (t, ev) { App.Speech.speak(t, { el: ev && (ev.currentTarget || ev.target) }); },
      speakEnDemo: function (t, ev) { App.Speech.speakEn(t, { el: ev && (ev.currentTarget || ev.target) }); }
    }
  };
})(window);
