/* ============================================================================
 * olympiad-view.js —— 奥数三十六计（学习乐园·单独一类）
 * 目录：36 计卡片（口诀+题数+动画课堂/刷题入口）
 * 刷题：一题一屏；先出题→「检查」判答案→「解答」逐步展开公式→
 *       多解法 tab、重难点卡、变形卡；上一题/下一题按钮；朗读
 * 题库：oly-index.js + oly-c01~c36.js 分片按需注入
 * ========================================================================== */
(function () {
  'use strict';
  var App = window.App = window.App || {};
  App.views = App.views || {};

  App.views.olympiad = {
    template: [
      '<div class="oly-wrap">',
      '  <div class="oly-hero">🏆 奥数三十六计<span class="oly-sub">经典竞赛题型 · 题目+分步解法+多解法+重难点 · 共 {{total}} 题</span></div>',

      /* ---------- 目录 ---------- */
      '  <div v-if="!catId">',
      '    <div class="oly-searchbar"><input v-model.trim="kw" placeholder="🔍 搜计名，如：裂项 / 牛吃草 / 换元" /><select v-model="fav"><option value="">全部 36 计</option><option value="calc">计算类</option><option value="apply">应用类</option><option value="geo">几何类</option><option value="num">数论类</option></select></div>',
      '    <div class="oly-grid">',
      '      <div class="oly-card" v-for="c in shown" :key="c.id" @click="openCat(c)">',
      '        <div class="oly-card-ic">{{c.icon}}</div>',
      '        <div class="oly-card-name">{{c.name}}</div>',
      '        <div class="oly-card-motto">{{c.motto}}</div>',
      '        <div class="oly-card-meta">{{c.n}} 题 · 来源含 {{c.src1}}</div>',
      '        <div class="oly-card-btns"><button class="btn" @click.stop="playTheater(c)">🎬 动画课堂</button><button class="btn primary" @click.stop="openCat(c)">📝 开始刷题</button></div>',
      '      </div>',
      '    </div>',
      '  </div>',

      /* ---------- 动画课堂 ---------- */
      '  <div v-if="theater" class="oly-theater">',
      '    <div class="oly-back" @click="theater=null">← 返回目录</div>',
      '    <div class="sy-stage" ref="stage"></div>',
      '  </div>',

      /* ---------- 刷题 ---------- */
      '  <div v-if="catId && !theater">',
      '    <div class="oly-back" @click="closeCat">← 返回目录</div>',
      '    <div class="oly-head"><span class="oly-head-ic">{{cat.icon}}</span><b>{{cat.name}}</b><span class="oly-head-motto">{{cat.motto}}</span><button class="btn" @click="playTheater(cat)">🎬 动画课堂</button></div>',
      '    <div class="oly-progress"><div class="oly-progress-bar" :style="{width: (pos/qs.length*100)+\'%\'}"></div></div>',
      '    <div class="oly-progress-txt">第 {{pos}} / {{qs.length}} 题</div>',

      '    <div class="oly-q" v-if="q">',
      '      <div class="oly-tags"><span class="tag src">{{q.g}}</span><span class="tag tp">{{q.n}}</span></div>',
      '      <div class="oly-qtext" @click="readQ">{{q.t}} <span class="oly-speak">🔊 点读</span></div>',

      '      <div class="oly-answer">',
      '        <input class="oly-input" v-model.trim="myAns" :disabled="answered" placeholder="先自己算，把答案写在这里（选填）" @keyup.enter="check" />',
      '        <button class="btn" v-if="!answered" @click="check">检查</button>',
      '        <span v-if="answered" class="oly-verdict" :class="verdictCls">{{verdict}}</span>',
      '      </div>',

      '      <div class="oly-btns">',
      '        <button class="btn prev" :disabled="pos<=1" @click="prevQ">← 上一题</button>',
      '        <button class="btn primary big" v-if="!showSol" @click="showSol=true">💡 解答</button>',
      '        <button class="btn next" :disabled="pos>=qs.length" @click="nextQ">下一题 →</button>',
      '      </div>',

      '      <div class="oly-sol" v-if="showSol">',
      '        <div class="oly-sol-title">✅ 答案：{{q.a}}</div>',
      '        <div class="oly-steps">',
      '          <div class="oly-step" v-for="(st,k) in visSteps" :key="k">',
      '            <div class="oly-step-f">{{st.f}}</div>',
      '            <div class="oly-step-e" v-if="st.e">{{st.e}}</div>',
      '          </div>',
      '        </div>',
      '        <button class="btn ghost" v-if="visSteps.length < q.s.length" @click="stepN+=2">继续展开 ▼（还剩 {{q.s.length - visSteps.length}} 步）</button>',
      '        <div v-if="q.m && q.m.length" class="oly-alt">',
      '          <button class="btn ghost" @click="showAlt=!showAlt">{{ showAlt ? \'收起\' : \'🔄 另一种解法（\' + q.m.length + \' 种）\' }}</button>',
      '          <div v-if="showAlt" class="oly-alt-body">',
      '            <div v-for="(alt,ai) in q.m" :key="ai" class="oly-alt-item">',
      '              <div class="oly-alt-name">解法 {{ai+2}}</div>',
      '              <div class="oly-step" v-for="(st,k) in alt" :key="k"><div class="oly-step-f">{{st.f}}</div><div class="oly-step-e" v-if="st.e">{{st.e}}</div></div>',
      '            </div>',
      '          </div>',
      '        </div>',
      '        <div class="oly-hard" v-if="q.h"><b>⚠️ 重难点提醒</b><div>{{q.h}}</div></div>',
      '        <div class="oly-bian" v-if="q.b"><b>🔀 变形题方向</b><div>{{q.b}}</div></div>',
      '      </div>',
      '    </div>',

      '    <div class="oly-btns oly-bottom">',
      '      <button class="btn prev" :disabled="pos<=1" @click="prevQ">← 上一题</button>',
      '      <button class="btn next" :disabled="pos>=qs.length" @click="nextQ">下一题 →</button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n'),

    data: function () {
      return {
        kw: '', fav: '', catId: '', theater: null,
        qs: [], pos: 1, q: null,
        myAns: '', answered: false, verdict: '', verdictCls: '',
        showSol: false, stepN: 99, showAlt: false,
        _cr: null
      };
    },
    computed: {
      total: function () { return (App.OLY && App.OLY.cats) ? App.OLY.cats.reduce(function (s, c) { return s + c.n; }, 0) : 10080; },
      cat: function () { var id = this.catId; return (App.OLY.cats || []).find(function (c) { return c.id === id; }) || {}; },
      shown: function () {
        var kw = this.kw, fav = this.fav, GT = { c01: 'calc', c02: 'calc', c23: 'num', c24: 'num', c25: 'num', c26: 'num', c27: 'calc', c28: 'calc', c29: 'calc', c30: 'num', c31: 'num', c32: 'num', c33: 'apply', c03: 'apply', c04: 'apply', c05: 'apply', c06: 'apply', c07: 'apply', c08: 'apply', c09: 'apply', c10: 'apply', c11: 'apply', c12: 'apply', c13: 'apply', c14: 'apply', c15: 'apply', c16: 'apply', c17: 'geo', c18: 'geo', c19: 'geo', c20: 'geo', c21: 'geo', c22: 'geo', c34: 'apply', c35: 'apply', c36: 'apply' };
        return (App.OLY.cats || []).filter(function (c) {
          if (fav && GT[c.id] !== fav) return false;
          if (kw && c.name.indexOf(kw) < 0 && c.motto.indexOf(kw) < 0) return false;
          return true;
        });
      },
      visSteps: function () { return this.q ? this.q.s.slice(0, this.stepN) : []; }
    },
    mounted: function () {
      if (App.Speech && App.Speech.autoRead) App.Speech.autoRead('奥数三十六计，一万道经典竞赛题，先自己算，再点解答看分步公式！');
    },
    beforeDestroy: function () { this.teardownCr(); },
    methods: {
      /* ---------- 分片按需加载 ---------- */
      ensureBank: function (cat) {
        if (App.OLY.bank && App.OLY.bank[cat.id]) return true;
        var s = document.createElement('script');
        s.src = 'assets/js/data/olympiad/' + cat.file;
        document.head.appendChild(s);
        return !!(App.OLY.bank && App.OLY.bank[cat.id]);
      },
      openCat: function (c) {
        var self = this;
        this.theater = null; this.catId = c.id;
        var ok = this.ensureBank(c);
        var bank = (App.OLY.bank || {})[c.id] || [];
        if (!bank.length && ok !== true) { setTimeout(function () { self.qs = (App.OLY.bank[c.id] || []).slice(); self.applyQ(); }, 250); }
        this.qs = bank.slice(); this.pos = 1; this.applyQ();
        if (App.Speech && App.Speech.speak) App.Speech.speak('进入' + c.name + '，口诀：' + c.motto, {});
      },
      closeCat: function () { this.catId = ''; this.qs = []; this.q = null; this.showSol = false; },
      applyQ: function () {
        this.q = this.qs[this.pos - 1] || null;
        this.myAns = ''; this.answered = false; this.verdict = '';
        this.showSol = false; this.stepN = 99; this.showAlt = false;
        window.scrollTo(0, 0);
      },
      nextQ: function () { if (this.pos < this.qs.length) { this.pos++; this.applyQ(); if (App.Speech && App.Speech.speak) App.Speech.speak('第 ' + this.pos + ' 题', {}); } },
      prevQ: function () { if (this.pos > 1) { this.pos--; this.applyQ(); if (App.Speech && App.Speech.speak) App.Speech.speak('回到第 ' + this.pos + ' 题', {}); } },
      check: function () {
        if (!this.q || !this.myAns) { this.showSol = true; return; }
        this.answered = true;
        var mine = this.norm(this.myAns), right = this.norm(this.q.a);
        var hit = right.indexOf(mine) >= 0 || mine === right;
        if (hit) { this.verdict = '🎉 答对了！看看解答里的巧思吧'; this.verdictCls = 'ok'; if (App.U && App.U.confetti) App.U.confetti(); }
        else { this.verdict = '❌ 再想想，或点开解答看分步公式'; this.verdictCls = 'no'; }
        this.showSol = true;
        if (App.Speech && App.Speech.speak) App.Speech.speak(hit ? '答对了，真棒！' : '再想想，看解答的分步公式', {});
      },
      norm: function (s) {
        return String(s).replace(/\s|，|。|（|）|\(|\)|约等于|即/g, '').replace(/x/g, '×').replace(/÷/g, '/').toLowerCase();
      },
      readQ: function () { if (this.q && App.Speech && App.Speech.speak) App.Speech.speak(this.q.t, {}); },

      /* ---------- 动画课堂 ---------- */
      teardownCr: function () { if (this._cr && this._cr.stop) { try { this._cr.stop(); } catch (e) { } } this._cr = null; },
      playTheater: function (c) {
        var self = this;
        if (!App.Classroom) return;
        this.teardownCr();
        this.theater = c.id; this.catId = this.catId || '';
        this.$nextTick(function () {
          var host = self.$refs.stage; host = Array.isArray(host) ? host[0] : host;
          if (!host) return;
          var sc = [
            { who: 't', act: 'wave', t: '同学们好！今天学奥数第' + c.name + '计！', board: [c.name, '奥数三十六计'] },
            { who: 't', act: 'write', t: '先记口诀：' + c.motto, board: ['口诀', c.motto.slice(0, 16)] },
            { who: 's1', act: 'cheer', t: '口诀好顺口！可是怎么用呢？', demo: c.id === 'c01' ? { kind: 'fraction', a: '3/5+6/7+5/6+7/12+9/20+11/30+13/42', tip: '裂项魔法：拆开→相消→凑整' } : null },
            { who: 't', act: 'point', t: '别急，看一道经典题，跟着一步步算！', board: ['经典题', '先自己试'] },
            { who: 's2', act: 'think', t: '我想先自己算一遍！' },
            { who: 't', act: 'cheer', t: '好！点「📝 开始刷题」，先自己算，再点解答看公式。记住：一计一计练，奥数就不难！', board: ['去刷题', '一计一练'] }
          ];
          self._cr = App.Classroom.mount(host, sc, { course: { subject: 'math', kind: 'aoshu' }, doneTip: '🎓 课堂结束！去刷题吧' });
        });
      }
    }
  };
})();
