/* ============================================================
 * dock.js — 自由布局层（1:1 移植 latest web/src/js/view/dock.js 的核心能力）
 *
 *  用户要求(2026-10-24):「面板功能也不全 不是拥有flex功能 可以移动拖拽 缩小放大
 *   悬浮 还有 可以隐藏删除面板 重置面板吗」→ 这里全部补上:
 *   · 开启后所有面板变成 flex 容器里的 flex 项(磁贴式自动排布)
 *   · 拖面板标题 → 排序/插入到任意位置
 *   · 八方向手柄 → 改宽高(放大缩小)
 *   · 双击标题 → 切「悬浮模式」(position:fixed 任意 XY 摆放)
 *   · 面板工具条 → 👁 隐藏 / ✕ 删除 / ⧉ 悬浮
 *   · 工具条按钮 → 开启/关闭自由布局 / 复位面板
 *   · 布局(顺序/宽高/悬浮坐标/隐藏状态)全部存 localStorage
 *   · 关闭自由布局 → 完全还原原始 DOM 位置与顺序(零残留)
 * ============================================================ */
'use strict';
(function (global) {
  var KEY = 'oqt.dock.v2';
  var MIN_W = 220, MIN_H = 120;
  var on = false;
  var panels = [];                 // {el, home, next, id, hidden}
  var space = null;
  var state = {};                  // {id: {w,h,float,x,y,hidden,order}}

  function load() {
    try { var raw = localStorage.getItem(KEY); if (raw) state = JSON.parse(raw) || {}; } catch (e) { state = {}; }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { }
  }
  function idOf(el, i) {
    var t = el.querySelector('h3,h2,.card-t,.panel-t');
    var s = (t ? t.textContent : '') || ('panel' + i);
    var h = 0;
    for (var k = 0; k < s.length; k++) { h = ((h << 5) - h + s.charCodeAt(k)) | 0; }
    return 'p' + Math.abs(h);
  }
  function head(el) {
    return el.querySelector(':scope > h3') || el.querySelector(':scope > h2') || el.querySelector(':scope > .card-h') || el.firstElementChild;
  }

  /* ---------- 手柄 ---------- */
  function mkHandles(el) {
    var dirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
    dirs.forEach(function (d) {
      var h = document.createElement('div');
      h.className = 'dock-h dock-h-' + d;
      h.setAttribute('data-dock-h', d);
      el.appendChild(h);
    });
  }
  function rmHandles(el) {
    var hs = el.querySelectorAll('[data-dock-h]');
    for (var i = 0; i < hs.length; i++) hs[i].parentNode.removeChild(hs[i]);
  }

  /* ---------- 面板工具条(隐藏/删除/悬浮) ---------- */
  function mkToolbar(rec) {
    var el = rec.el;
    var bar = document.createElement('div');
    bar.className = 'dock-tb';
    bar.innerHTML =
      '<span class="dock-tb-t" title="拖我移动面板"></span>' +
      '<button class="dock-tb-b" data-dk="float" title="悬浮/还原">⧉</button>' +
      '<button class="dock-tb-b" data-dk="hide" title="隐藏">👁</button>' +
      '<button class="dock-tb-b" data-dk="del" title="删除面板">✕</button>';
    el.appendChild(bar);
    var self = this;
    bar.addEventListener('mousedown', function (e) {
      if (e.target.closest && e.target.closest('button')) return;
      startDrag(e, rec);
    });
    bar.addEventListener('dblclick', function (e) {
      if (e.target.closest && e.target.closest('button')) return;
      toggleFloat(rec);
    });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      e.stopPropagation();
      var k = b.getAttribute('data-dk');
      if (k === 'float') toggleFloat(rec);
      else if (k === 'hide') hidePanel(rec, true);
      else if (k === 'del') delPanel(rec);
    });
  }
  function rmToolbar(rec) {
    var t = rec.el.querySelector('.dock-tb');
    if (t && t.parentNode) t.parentNode.removeChild(t);
  }

  /* ---------- 拖动(排序/插入) ---------- */
  function startDrag(e, rec) {
    if (e.button !== 0) return;
    var el = rec.el;
    var floatMode = el.classList.contains('dock-float');
    var r = el.getBoundingClientRect();
    var offX = e.clientX - r.left, offY = e.clientY - r.top;
    var moved = false;
    document.body.classList.add('dock-dragging');
    e.preventDefault();

    function move(ev) {
      var dx = ev.clientX - e.clientX, dy = ev.clientY - e.clientY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      if (floatMode) {
        var st = state[rec.id] || (state[rec.id] = {});
        st.float = true;
        st.x = Math.max(0, ev.clientX - offX);
        st.y = Math.max(0, ev.clientY - offY);
        el.style.left = st.x + 'px'; el.style.top = st.y + 'px';
        return;
      }
      // 非浮动 → 拖到别的面板前后(嵌入排序)
      var t = targetAt(ev.clientX, ev.clientY, el);
      if (t) {
        var tr = t.el.getBoundingClientRect();
        var after = ev.clientY > tr.top + tr.height / 2;
        var ref = after ? t.el.nextSibling : t.el;
        if (ref !== el) space.insertBefore(el, ref);
      }
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('dock-dragging');
      if (moved) { saveOrder(); save(); }
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }
  function targetAt(x, y, self) {
    for (var i = 0; i < panels.length; i++) {
      var rec = panels[i];
      if (rec.el === self) continue;
      var r = rec.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return rec;
    }
    return null;
  }
  function saveOrder() {
    var order = [];
    for (var i = 0; i < panels.length; i++) {
      var rec = panels[i];
      var st = state[rec.id] || (state[rec.id] = {});
      st.order = i;
      order.push(rec.id);
    }
  }

  /* ---------- 缩放(八方向) ---------- */
  function startResize(e, rec, dir) {
    if (e.button !== 0) return;
    var el = rec.el;
    var rr = el.getBoundingClientRect();
    var fx = (e.clientX - rr.left) / rr.width, fy = (e.clientY - rr.top) / rr.height;
    e.preventDefault(); e.stopPropagation();
    document.body.classList.add('dock-dragging');
    function move(ev) {
      var st = state[rec.id] || (state[rec.id] = {});
      var w = rr.width, h = rr.height;
      if (dir.indexOf('e') >= 0) w = (ev.clientX - rr.left) / (1 - fx);
      if (dir.indexOf('s') >= 0) h = (ev.clientY - rr.top) / (1 - fy);
      if (dir.indexOf('w') >= 0) w = rr.right - ev.clientX;
      if (dir.indexOf('n') >= 0) h = rr.bottom - ev.clientY;
      w = Math.max(MIN_W, w); h = Math.max(MIN_H, h);
      st.w = Math.round(w); st.h = Math.round(h);
      el.style.width = st.w + 'px'; el.style.height = st.h + 'px';
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.body.classList.remove('dock-dragging');
      save();
      window.dispatchEvent(new Event('resize'));
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  /* ---------- 悬浮 / 隐藏 / 删除 ---------- */
  function toggleFloat(rec) {
    var el = rec.el, st = state[rec.id] || (state[rec.id] = {});
    if (el.classList.contains('dock-float')) {
      el.classList.remove('dock-float');
      el.style.left = ''; el.style.top = ''; el.style.zIndex = '';
      st.float = false;
    } else {
      var r = el.getBoundingClientRect();
      el.classList.add('dock-float');
      st.float = true;
      st.x = (st.x !== null && st.x !== undefined) ? st.x : Math.max(0, r.left);
      st.y = (st.y !== null && st.y !== undefined) ? st.y : Math.max(0, r.top);
      el.style.left = st.x + 'px'; el.style.top = st.y + 'px';
    }
    save();
  }
  function hidePanel(rec, hide) {
    var st = state[rec.id] || (state[rec.id] = {});
    st.hidden = hide === undefined ? !st.hidden : hide;
    rec.el.style.display = st.hidden ? 'none' : '';
    rec.hidden = st.hidden;
    save();
  }
  function delPanel(rec) {
    hidePanel(rec, true);
  }

  /* ---------- 开关 ---------- */
  function enable() {
    if (on) return;
    load();
    // 收集面板(页面里所有 .panel)
    var els = document.querySelectorAll('.panel');
    if (!els.length) return;
    panels = [];
    var i = 0;
    for (var k = 0; k < els.length; k++) {
      var el = els[k];
      panels.push({ el: el, home: el.parentNode, next: el.nextSibling, id: idOf(el, i++), hidden: false });
    }
    // 建空间容器
    space = document.createElement('div');
    space.id = 'dockSpace';
    var first = panels[0];
    first.home.insertBefore(space, first.el);
    panels.forEach(function (rec) {
      space.appendChild(rec.el);
      rec.el.classList.add('dock-panel');
      mkHandles(rec.el);
      mkToolbar(rec);
      var st = state[rec.id] || {};
      if (st.w) rec.el.style.width = st.w + 'px';
      if (st.h) rec.el.style.height = st.h + 'px';
      if (st.hidden) { rec.el.style.display = 'none'; rec.hidden = true; }
      // 手柄拖拽
      var hs = rec.el.querySelectorAll('[data-dock-h]');
      for (var q = 0; q < hs.length; q++) {
        (function (h, r2) {
          h.addEventListener('mousedown', function (e) { startResize(e, r2, h.getAttribute('data-dock-h')); });
        })(hs[q], rec);
      }
      // 标题拖动
      var hd = head(rec.el);
      if (hd) {
        hd.style.cursor = 'grab';
        hd.addEventListener('mousedown', function (e) { startDrag(e, rec); });
        hd.addEventListener('dblclick', function () { toggleFloat(rec); });
      }
    });
    // 浮动面板还原坐标
    panels.forEach(function (rec) {
      var st = state[rec.id];
      if (st && st.float) {
        rec.el.classList.add('dock-float');
        rec.el.style.left = (st.x || 0) + 'px';
        rec.el.style.top = (st.y || 0) + 'px';
      }
    });
    // 顺序还原
    var ordered = panels.slice().sort(function (a, b) {
      return ((state[a.id] || {}).order || 0) - ((state[b.id] || {}).order || 0);
    });
    ordered.forEach(function (rec) { space.appendChild(rec.el); });
    document.body.classList.add('dock-on');
    on = true;
    saveOrder(); save();
  }
  function disable() {
    if (!on) return;
    panels.forEach(function (rec) {
      rmToolbar(rec); rmHandles(rec.el);
      rec.el.classList.remove('dock-panel', 'dock-float');
      rec.el.style.width = ''; rec.el.style.height = '';
      rec.el.style.left = ''; rec.el.style.top = ''; rec.el.style.zIndex = '';
      rec.el.style.display = '';
      if (rec.home) {
        if (rec.next && rec.next.parentNode === rec.home) rec.home.insertBefore(rec.el, rec.next);
        else rec.home.appendChild(rec.el);
      }
    });
    if (space && space.parentNode) space.parentNode.removeChild(space);
    space = null; panels = [];
    document.body.classList.remove('dock-on', 'dock-dragging');
    on = false;
  }
  function reset() {
    state = {}; save();
    if (on) { disable(); enable(); }
    window.dispatchEvent(new Event('resize'));
  }

  global.Dock = {
    init: function () { load(); },
    enable: enable, disable: disable, reset: reset,
    isOn: function () { return on; },
    toggle: function () { if (on) disable(); else enable(); }
  };
})(window);
