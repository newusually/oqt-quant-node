/*
 * store.js — 基础层 / 全局状态 store（localStorage 持久化）
 * 统一管理：自动朗读开关、学习星星、徽章、学习足迹、访问次数。
 * 依赖 Vue 的响应式（vue.global.prod.js 已在 app.js 之前加载），页面层直接读 App.Store.state。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var KEY = "yg.learn.v1";
  // 中文默认嗓音：Microsoft HsiaoChen Online (Natural) - Chinese (Taiwan)
  // （设备上没有这个嗓音时，speech.js 会自动回退到同类型的在线嗓音/本机嗓音）
  var DEFAULT_VOICE_ZH = "Microsoft HsiaoChen Online (Natural) - Chinese (Taiwan)";
  var def = { autoRead: true, stars: 0, badges: [], learned: {}, visits: 0, lastVisit: "", voiceZh: DEFAULT_VOICE_ZH, voiceEn: "", voiceCloud: "", voiceStyle: "", voicePinned: false };

  function read() {
    try {
      var raw = w.localStorage.getItem(KEY);
      if (!raw) return JSON.parse(JSON.stringify(def));
      var o = JSON.parse(raw);
      for (var k in def) { if (def.hasOwnProperty(k) && typeof o[k] === "undefined") o[k] = def[k]; }
      // ★2026-10-24: 自动朗读【常开不可关】—— 即便 localStorage 里存了 false 也强制回 true
      o.autoRead = true;
      return o;
    } catch (e) { return JSON.parse(JSON.stringify(def)); }
  }
  function save() {
    try { w.localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  var raw0 = read();
  raw0.visits = (raw0.visits || 0) + 1;
  var state = (w.Vue && w.Vue.reactive) ? w.Vue.reactive(raw0) : raw0;
  save();

  var BADGES = [
    { id: "first", n: "初次闯关", i: "🌱", d: "第一次打开学习乐园" },
    { id: "math10", n: "口算小能手", i: "🧮", d: "数学类题目答对 10 题" },
    { id: "cn10", n: "语文小达人", i: "📖", d: "语文类题目答对 10 题" },
    { id: "en10", n: "英语小明星", i: "🔤", d: "英语类题目答对 10 题" },
    { id: "star60", n: "六十颗星", i: "⭐", d: "累计获得 60 颗学习星星" },
    { id: "allpage", n: "全站探索", i: "🧭", d: "逛遍 8 个学习页面" }
  ];

  function has(id) { return state.badges.indexOf(id) >= 0; }
  function unlock(id) {
    if (has(id)) return false;
    state.badges.push(id); save();
    if (App.Speech) App.Speech.speak("获得新徽章！");
    return true;
  }
  function addStars(n) {
    state.stars = (state.stars || 0) + (n || 0);
    if (state.stars >= 60) unlock("star60");
    save();
  }
  function markLearned(key) {
    state.learned[key] = (state.learned[key] || 0) + 1;
    save();
  }
  function countLearned(prefix) {
    var n = 0, k;
    for (k in state.learned) { if (state.learned.hasOwnProperty(k) && k.indexOf(prefix) === 0) n += state.learned[k]; }
    return n;
  }
  // ★2026-10-24: 自动朗读常开 —— toggleAutoRead 不再能关掉它（永远返回 true）
  function toggleAutoRead() { state.autoRead = true; save(); return true; }
  function reset() {
    try { w.localStorage.removeItem(KEY); } catch (e) {}
    state.autoRead = true; state.stars = 0; state.badges = []; state.learned = {};
    save();
  }

  App.Store = {
    state: state,
    KEY: KEY,
    BADGES: BADGES,
    save: save,
    has: has,
    unlock: unlock,
    addStars: addStars,
    markLearned: markLearned,
    countLearned: countLearned,
    toggleAutoRead: toggleAutoRead,
    reset: reset,
    // 用户是否在「声音面板」里手动选过嗓音。手动选过 → 严格用他选的；
    // 没选过（默认）→ 按默认清单（HsiaoChen 台湾优先）自动挑，可自动从被污染的存档里恢复。
    setVoicePinned: function (v) { state.voicePinned = !!v; save(); }
  };
  unlock("first");
})(window);
