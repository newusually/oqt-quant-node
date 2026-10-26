/* ============================================================
 * curve-panel.js — 「信号盈利曲线」面板组件
 *   1:1 移植 latest astock/web/assets/page_btcurve.js（2026-10-21）
 *
 * 【口径】只统计【买入】信号 → 每笔按固定金额模拟
 *        信号后第一根【开盘价】入场 → 逐根判止盈/止损(同根双触按保守止损)
 *        → 未触发按最后一根收盘平仓
 *   曲线: X=出场时间, Y=累计盈亏(带填充 + 逐点圆点)
 *   统计: 笔数/胜率/净盈亏/总盈/总亏/盈亏比/最大回撤
 *   交互: 鼠标移到曲线上 → 浮窗显示 时间/标的/入场→出场价/盈亏(额+%)/结果·持仓根数/累计
 *        并【自动弹出该笔的K线小窗】(带入场/出场标记与盈利区间);
 *        点击曲线 → 同样弹出
 * ============================================================ */
'use strict';
(function (global) {
  var seq = 0;

  function esc(s) {
    return String((s === null || s === undefined) ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmtT(ms) {
    var n = +ms;
    if (!isFinite(n) || n <= 0) return '-';
    if (n < 1e11) n = n * 1000;                 // 秒 → 毫秒
    var d = new Date(n), p = function (x) { return x < 10 ? '0' + x : '' + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function money(v) {
    var s = Math.abs(v) >= 10000 ? (v / 10000).toFixed(2) + '万'
      : (Math.abs(v) >= 1000 ? (v / 1000).toFixed(2) + 'k' : v.toFixed(2));
    return (v > 0 ? '+' : '') + s;
  }
  function px(v) {
    v = Number(v);
    if (!isFinite(v)) return '-';
    var a = Math.abs(v);
    if (a >= 1) return v.toFixed(2);
    if (a >= 0.01) return v.toFixed(4);
    if (a >= 0.0001) return v.toFixed(6);
    return v.toFixed(8);
  }

  /* ---------------- 单个面板实例 ---------------- */
  function Panel(box, opt) {
    opt = opt || {};
    this.box = box;
    this.inst = opt.inst || '';
    this.name = opt.name || opt.inst || '';
    this.tf = opt.tf || '5m';
    this.tp = (opt.tp === null || opt.tp === undefined) ? 0 : opt.tp;      // 0 = 自动(后端按周期给默认档位)
    this.sl = (opt.sl === null || opt.sl === undefined) ? 0 : opt.sl;
    this.amt = (opt.amt === null || opt.amt === undefined) ? 100 : opt.amt;
    this.maxHold = (opt.maxHold === null || opt.maxHold === undefined) ? 0 : opt.maxHold;   // 0 = 自动(后端按周期给)
    this.days = (opt.days === null || opt.days === undefined) ? 30 : +opt.days;          // 回测窗口(天), 默认 30 = 一个月
    this.tfs = opt.tfs || [];
    this.unit = opt.unit || 'USDT';
    this.uid = 'cp' + (++seq);
    this.pts = []; this.stats = null;
    this.fetch = opt.fetch;                      // 外部注入取数
    this.onPop = opt.onPop;                      // 外部注入弹K线窗
    this.build();
    this.load();
  }

  Panel.prototype.build = function () {
    var u = this.uid;
    this.box.innerHTML =
      '<div class="btc-bar" id="' + u + '-bar"></div>' +
      '<div class="btc-stat" id="' + u + '-stat"><div style="color:#8b94ad">加载中…</div></div>' +
      '<div class="btc-wrap"><canvas id="' + u + '-cv" class="btc-cv"></canvas>' +
      '<div class="btc-tip" id="' + u + '-tip"></div></div>';
    this.cv = document.getElementById(u + '-cv');
    this.tip = document.getElementById(u + '-tip');
    this.ctx = this.cv ? this.cv.getContext('2d') : null;
    var self = this;
    if (this.cv) {
      this.cv.addEventListener('mousemove', function (e) { self.onMove(e); });
      this.cv.addEventListener('mouseleave', function () {
        self.tip.style.display = 'none';
        self._popIdx = -1;
        if (self.onPop) self.onPop.leave();
      });
      this.cv.addEventListener('click', function (e) { self.onClick(e); });
      window.addEventListener('resize', function () { self.resize(); });
    }
    this.bar();
  };

  /* 工具条: 周期 + 止盈/止损/每笔/持仓上限（对齐 latest 的 周期/窗口 选择器） */
  Panel.prototype.bar = function () {
    var self = this, h = '';
    // ① 周期选择器(1:1 latest TFS: 1h/2h/4h/6h/1d/1w/1m)
    var tfs = this.tfs || [];
    if (tfs.length) {
      for (var i = 0; i < tfs.length; i++) {
        h += '<a href="javascript:void(0)" data-tf="' + tfs[i][0] + '" class="' + (tfs[i][0] === this.tf ? 'on' : '') + '">' + tfs[i][1] + '</a>';
      }
      h += '<span style="width:12px"></span>';
    }
    h += '<span style="color:#6d7690;font-size:11px">止盈</span>';
    h += '<input id="' + this.uid + '-tp" class="btc-inp" type="number" step="0.5" min="0.1" max="200" value="' + (this.tp * 100).toFixed(1) + '"><span style="color:#6d7690;font-size:11px">%</span>';
    h += '<span style="color:#6d7690;font-size:11px;margin-left:6px">止损</span>';
    h += '<input id="' + this.uid + '-sl" class="btc-inp" type="number" step="0.5" min="0.1" max="200" value="' + (this.sl * 100).toFixed(1) + '"><span style="color:#6d7690;font-size:11px">%</span>';
    h += '<span style="color:#6d7690;font-size:11px;margin-left:6px">每笔</span>';
    h += '<input id="' + this.uid + '-amt" class="btc-inp" type="number" step="10" min="1" value="' + this.amt + '"><span style="color:#6d7690;font-size:11px">' + esc(this.unit) + '</span>';
    h += '<span style="color:#6d7690;font-size:11px;margin-left:6px">持仓上限</span>';
    h += '<input id="' + this.uid + '-mh" class="btc-inp" type="number" step="20" min="10" value="' + this.maxHold + '"><span style="color:#6d7690;font-size:11px">根</span>';
    h += '<span style="color:#6d7690;font-size:11px;margin-left:6px">回测窗口</span>';
    h += '<input id="' + this.uid + '-days" class="btc-inp" type="number" step="5" min="1" max="365" value="' + this.days + '" title="回测多少天的数据(默认30=一个月)"><span style="color:#6d7690;font-size:11px">天</span>';
    h += '<button class="btc-btn" id="' + this.uid + '-go">重新计算</button>';
    h += '<span style="margin-left:auto;color:#6d7690;font-size:11px" id="' + this.uid + '-note">只统计买入信号 · 成交后逐根判止盈止损</span>';
    var bar = document.getElementById(this.uid + '-bar');
    bar.innerHTML = h;
    // 周期切换
    var as = bar.getElementsByTagName('a');
    for (var k = 0; k < as.length; k++) {
      (function (a) {
        a.onclick = function () {
          var tf = a.getAttribute('data-tf');
          if (!tf) return;
          self.tf = tf;
          self.load();
          if (self.onTf) self.onTf(tf);
        };
      })(as[k]);
    }
    document.getElementById(this.uid + '-go').onclick = function () {
      self.tp = (+document.getElementById(self.uid + '-tp').value || 20) / 100;
      self.sl = (+document.getElementById(self.uid + '-sl').value || 20) / 100;
      self.amt = +document.getElementById(self.uid + '-amt').value || 100;
      self.maxHold = +document.getElementById(self.uid + '-mh').value || 200;
      var dEl = document.getElementById(self.uid + '-days');
      if (dEl) self.days = Math.max(1, Math.min(365, +dEl.value || 30));
      self.load();
    };
  };

  Panel.prototype.stat = function () {
    var s = this.stats || {}, up = (s.net || 0) >= 0 ? 'u' : 'd';
    var el = document.getElementById(this.uid + '-stat');
    if (!el) return;
    el.innerHTML =
      '<div>笔数<b>' + (s.n || 0) + '</b></div>' +
      '<div>胜率<b>' + (s.wr || 0) + '%</b></div>' +
      '<div>净盈亏(' + esc(this.unit) + ')<b class="' + up + '">' + money(s.net || 0) + '</b></div>' +
      '<div>总盈<b class="u">' + money(s.gain || 0) + '</b></div>' +
      '<div>总亏<b class="d">' + money(s.loss || 0) + '</b></div>' +
      '<div>盈亏比<b>' + (s.pf === 999 ? '∞' : (s.pf || 0)) + '</b></div>' +
      '<div>最大回撤<b class="d">' + money(s.mdd || 0) + '</b></div>';
  };

  Panel.prototype.resize = function () {
    if (!this.cv || !this.ctx) return;
    var r = global.devicePixelRatio || 1;
    this.W = this.cv.clientWidth; this.H = this.cv.clientHeight;
    if (!this.W) return;
    this.cv.width = Math.round(this.W * r); this.cv.height = Math.round(this.H * r);
    this.ctx.setTransform(r, 0, 0, r, 0, 0);
    this.draw();
  };

  Panel.prototype.geom = function () {
    var padL = 58, padR = 12;
    var pts = this.pts, t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    if (t1 === t0) t1 = t0 + 1;
    var W = this.W;
    return {
      padL: padL, padR: padR, t0: t0, t1: t1,
      X: function (t) { return padL + (t - t0) / (t1 - t0) * (W - padL - padR); }
    };
  };

  Panel.prototype.draw = function () {
    var ctx = this.ctx, W = this.W, H = this.H;
    if (!ctx || !W) return;
    ctx.clearRect(0, 0, W, H);
    if (!this.pts.length) {
      ctx.fillStyle = '#8b94ad'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('该周期暂无缠论买入信号', W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }
    var padL = 58, padR = 12, padT = 12, padB = 22, pts = this.pts;
    var lo = 0, hi = 0;
    for (var i = 0; i < pts.length; i++) { if (pts[i].cum < lo) lo = pts[i].cum; if (pts[i].cum > hi) hi = pts[i].cum; }
    if (hi === lo) hi = lo + 1;
    var rg = (hi - lo) * 0.12; lo -= rg; hi += rg;
    if (lo > 0) lo = 0;
    var g = this.geom();
    var Y = function (v) { return padT + (hi - v) / (hi - lo) * (H - padT - padB); };

    ctx.strokeStyle = '#1e2740'; ctx.lineWidth = 1; ctx.font = '10px sans-serif';
    for (var k = 0; k <= 4; k++) {
      var v = lo + (hi - lo) * k / 4, y = Y(v);
      ctx.fillStyle = '#8b94ad';
      ctx.fillText(money(v), 4, y + 3);
      ctx.beginPath(); ctx.moveTo(padL, y + .5); ctx.lineTo(W - padR, y + .5); ctx.stroke();
    }
    if (0 >= lo && 0 <= hi) {
      ctx.strokeStyle = '#3a4664'; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(padL, Y(0) + .5); ctx.lineTo(W - padR, Y(0) + .5); ctx.stroke();
      ctx.setLineDash([]);
    }
    // 面积填充
    ctx.beginPath(); ctx.moveTo(g.X(pts[0].t), Y(0));
    for (var i = 0; i < pts.length; i++) ctx.lineTo(g.X(pts[i].t), Y(pts[i].cum));
    ctx.lineTo(g.X(pts[pts.length - 1].t), Y(0)); ctx.closePath();
    ctx.fillStyle = 'rgba(240,160,32,.13)'; ctx.fill();
    // 曲线
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var x = g.X(pts[i].t), y = Y(pts[i].cum);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#f0a020'; ctx.lineWidth = 2; ctx.stroke();
    // 逐笔圆点(红=盈/绿=亏)
    for (var i = 0; i < pts.length; i++) {
      ctx.fillStyle = pts[i].amt >= 0 ? '#f0334b' : '#0bbf7a';
      ctx.beginPath(); ctx.arc(g.X(pts[i].t), Y(pts[i].cum), 2.4, 0, 6.284); ctx.fill();
    }
    // X 轴时间
    ctx.fillStyle = '#8b94ad'; ctx.font = '10px sans-serif';
    ctx.fillText(fmtT(g.t0), padL, H - 6);
    ctx.textAlign = 'right'; ctx.fillText(fmtT(g.t1), W - padR, H - 6); ctx.textAlign = 'left';
    if (pts.length > 2) {
      ctx.textAlign = 'center';
      ctx.fillText(fmtT(pts[Math.floor(pts.length / 2)].t), (padL + W - padR) / 2, H - 6);
      ctx.textAlign = 'left';
    }
  };

  /* 命中最接近的曲线点（30px 容差，与 latest 一致） */
  Panel.prototype.hit = function (mx) {
    if (!this.pts.length) return -1;
    var g = this.geom(), best = -1, bd = Infinity;
    for (var i = 0; i < this.pts.length; i++) {
      var d = Math.abs(g.X(this.pts[i].t) - mx);
      if (d < bd) { bd = d; best = i; }
    }
    return (best >= 0 && bd <= 30) ? best : -1;
  };

  /* ★联动K线悬浮窗：带入场/出场标记 + 盈利区间 */
  Panel.prototype.popK = function (p) {
    if (!this.onPop || !p) return;
    this.onPop.open({
      inst: p.inst, name: p.name, tf: this.tf,
      t: p.t, px: p.xp, label: p.name || p.inst,
      entryT: p.et, exitT: p.t, entryPx: p.ep, exitPx: p.xp,
      why: p.why, amt: p.amt, ret: p.ret, cum: p.cum
    });
  };

  Panel.prototype.onMove = function (e) {
    if (!this.pts.length || !this.cv) return;
    var r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left, g = this.geom();
    var best = this.hit(mx);
    if (best < 0) {
      this.tip.style.display = 'none';
      if (this.onPop) this.onPop.leave();
      this._popIdx = -1;
      return;
    }
    var p = this.pts[best];
    var u = this.unit;
    this.tip.innerHTML =
      '<div><span class="k">出场时间</span>' + fmtT(p.t) + '</div>' +
      '<div><span class="k">入场时间</span>' + fmtT(p.et) + '</div>' +
      (p.name ? '<div><span class="k">标的</span>' + esc(p.name) + '</div>' : '') +
      '<div><span class="k">入场→出场</span>' + px(p.ep) + ' → ' + px(p.xp) + '</div>' +
      '<div><span class="k">盈亏</span><b style="color:' + (p.amt >= 0 ? '#f0334b' : '#0bbf7a') + '">' +
      (p.amt >= 0 ? '+' : '') + p.amt.toFixed(2) + ' ' + esc(u) + ' (' + (p.ret >= 0 ? '+' : '') + p.ret.toFixed(2) + '%)</b></div>' +
      '<div><span class="k">结果</span>' + esc(p.why) + ' · 持仓 ' + p.bars + ' 根' +
      ((p.sigAng !== null && p.sigAng !== undefined) ? ' · 夹角 ' + p.sigAng.toFixed(0) + '°' : '') + '</div>' +
      '<div><span class="k">累计</span>' + (p.cum >= 0 ? '+' : '') + p.cum.toFixed(2) + ' ' + esc(u) + '</div>' +
      '<div style="color:#6d7690;margin-top:2px">▸ 悬停/点击查看该笔K线(盈利区间)</div>';
    this.tip.style.display = 'block';
    var tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
    this.tip.style.left = Math.min(this.W - tw - 4, Math.max(4, g.X(p.t) + 12)) + 'px';
    this.tip.style.top = Math.min(this.H - th - 4, Math.max(4, e.clientY - r.top - th / 2)) + 'px';
    if (best !== this._popIdx) { this._popIdx = best; this.popK(p); }   // ★鼠标移到曲线 → 自动弹出该笔K线
  };

  Panel.prototype.onClick = function (e) {
    if (!this.pts.length || !this.cv) return;
    var r = this.cv.getBoundingClientRect(), mx = e.clientX - r.left;
    var best = this.hit(mx);
    if (best < 0) return;
    this._popIdx = best;
    this.popK(this.pts[best]);
  };

  Panel.prototype.load = function () {
    var self = this;
    this.bar();
    var el = document.getElementById(this.uid + '-stat');
    if (el) el.innerHTML = '<div style="color:#8b94ad">回测计算中…</div>';
    if (!this.fetch) return;
    var q = { inst: this.inst, tf: this.tf, amt: this.amt, days: this.days };
    if (this.tp > 0) q.tp = this.tp;            // 0 = 不指定, 用后端按周期的默认档位
    if (this.sl > 0) q.sl = this.sl;
    if (this.maxHold > 0) q.maxHold = this.maxHold;
    this.fetch(q)
      .then(function (d) {
        if (!d || !d.ok) {
          if (el) el.innerHTML = '<div style="color:#f0334b">回测失败: ' + esc(d && d.err) + '</div>';
          self.pts = []; self.stats = {}; self.stat(); self.resize(); return;
        }
        self.pts = d.pts || []; self.stats = d.stats || {};
        // 回填后端实际用的档位(自动模式时显示真实值)
        if (self.stats) {
          var iTP = document.getElementById(self.uid + '-tp'), iSL = document.getElementById(self.uid + '-sl'), iMH = document.getElementById(self.uid + '-mh');
          if ((self.stats.tp !== null && self.stats.tp !== undefined)) {
            self.tp = self.stats.tp; self.sl = self.stats.sl;
            if (iTP) iTP.value = (self.tp * 100).toFixed(1);
            if (iSL) iSL.value = (self.sl * 100).toFixed(1);
          }
          if ((self.stats.maxHold !== null && self.stats.maxHold !== undefined)) {
            self.maxHold = self.stats.maxHold;
            if (iMH) iMH.value = self.maxHold;
          }
        }
        self.stat(); self.resize();
        // 回测窗口信息(实际覆盖天数/根数)
        var note = document.getElementById(self.uid + '-note');
        if (note && self.stats) {
          note.textContent = '回测窗口 ' + ((self.stats.days !== null && self.stats.days !== undefined) ? self.stats.days : self.days) + ' 天 · 实际覆盖 ' +
            ((self.stats.covered !== null && self.stats.covered !== undefined) ? self.stats.covered : '?') + ' 天 · ' + (self.stats.bars || 0) +
            ' 根K线 · 只统计买入信号 · 成交后逐根判止盈止损';
        }
      })
      .catch(function (e) {
        if (el) el.innerHTML = '<div style="color:#f0334b">回测失败: ' + esc(e.message) + '</div>';
      });
  };

  var made = {};
  global.CurvePanel = {
    mount: function (boxId, opt) {
      var box = document.getElementById(boxId);
      if (!box || made[boxId]) return null;         // 幂等
      made[boxId] = 1;
      var p = new Panel(box, opt);
      made[boxId] = p;                              // 便于外部 reload
      return p;
    },
    get: function (boxId) { return made[boxId] || null; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
