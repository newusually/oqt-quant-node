/*
 * animals.js — 服务层 / 动物叫声（WebAudio 实时合成，无需任何音频文件）
 * 为什么合成而不下载录音：真实 mp3 有版权、体积大（十几只动物就几 MB）、格式兼容麻烦；
 * 合成音效零依赖、秒开、离线可用，儿童站的动物叫声用合成完全够用。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var AC = null;
  function ac() {
    if (!AC) { try { AC = new (w.AudioContext || w.webkitAudioContext)(); } catch (e) { AC = null; } }
    if (AC && AC.state === "suspended") { try { AC.resume(); } catch (e) {} }
    return AC;
  }
  // 基础音：类型/频率/时长/音量，可选滑音和目标频率
  function beep(type, f0, f1, dur, vol, when) {
    var c = ac(); if (!c) return;
    var t0 = c.currentTime + (when || 0);
    var o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  // 噪声（狗叫/马嘶用）
  function noise(dur, vol, freq, when) {
    var c = ac(); if (!c) return;
    var t0 = c.currentTime + (when || 0);
    var n = Math.floor(c.sampleRate * dur);
    var buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0), i;
    for (i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = c.createBufferSource(); src.buffer = buf;
    var f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = freq || 900; f.Q.value = 0.8;
    var g = c.createGain(); g.gain.value = vol || 0.2;
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t0);
  }
  // 颤音（猫/羊用）
  function vib(type, f0, dur, vol, rate, when) {
    var c = ac(); if (!c) return;
    var t0 = c.currentTime + (when || 0);
    var o = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
    o.type = type; o.frequency.value = f0;
    lfo.frequency.value = rate || 12; lg.gain.value = f0 * 0.12;
    lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.16, t0 + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); lfo.start(t0); o.stop(t0 + dur); lfo.stop(t0 + dur);
  }

  var VOICES = {
    cat:     { n: "小猫", s: "喵～",   play: function () { vib("sine", 520, 0.35, 0.2, 11); vib("sine", 760, 0.4, 0.18, 9, 0.3); vib("sine", 480, 0.3, 0.14, 8, 0.62); } },
    dog:     { n: "小狗", s: "汪！",   play: function () { noise(0.09, 0.25, 700); beep("sawtooth", 220, 150, 0.1, 0.16, 0.02); noise(0.09, 0.22, 650, 0.24); beep("sawtooth", 200, 140, 0.1, 0.14, 0.26); noise(0.08, 0.2, 600, 0.46); beep("sawtooth", 190, 130, 0.09, 0.13, 0.48); } },
    cow:     { n: "奶牛", s: "哞～",   play: function () { beep("sawtooth", 150, 105, 0.75, 0.22); vib("sawtooth", 120, 0.7, 0.12, 5, 0.05); } },
    sheep:   { n: "小羊", s: "咩～",   play: function () { vib("square", 400, 0.55, 0.1, 15); vib("square", 380, 0.4, 0.09, 13, 0.5); } },
    duck:    { n: "鸭子", s: "嘎嘎",   play: function () { beep("square", 320, 260, 0.12, 0.16); beep("square", 300, 250, 0.12, 0.15, 0.18); beep("square", 280, 230, 0.14, 0.14, 0.36); } },
    rooster: { n: "公鸡", s: "喔喔喔", play: function () { beep("sine", 520, 860, 0.14, 0.18); beep("sine", 700, 900, 0.12, 0.16, 0.2); beep("sine", 820, 700, 0.22, 0.15, 0.38); } },
    bird:    { n: "小鸟", s: "啾啾",   play: function () { beep("sine", 2400, 3200, 0.07, 0.12); beep("sine", 2800, 2200, 0.06, 0.11, 0.12); beep("sine", 2600, 3400, 0.07, 0.1, 0.22); } },
    frog:    { n: "青蛙", s: "呱呱",   play: function () { vib("sawtooth", 140, 0.1, 0.2, 26); vib("sawtooth", 130, 0.1, 0.19, 24, 0.16); vib("sawtooth", 120, 0.12, 0.18, 22, 0.32); } },
    pig:     { n: "小猪", s: "哼哼",   play: function () { vib("sawtooth", 190, 0.35, 0.16, 8); vib("sawtooth", 170, 0.3, 0.14, 7, 0.3); } },
    horse:   { n: "马", s: "嘶～",     play: function () { vib("sawtooth", 750, 0.55, 0.14, 20); beep("sawtooth", 700, 320, 0.5, 0.12, 0.05); } },
    bee:     { n: "蜜蜂", s: "嗡～～", play: function () { vib("sawtooth", 200, 0.8, 0.12, 30); vib("sawtooth", 210, 0.6, 0.1, 32, 0.7); } },
    chick:   { n: "小鸡", s: "叽叽",   play: function () { beep("sine", 1800, 2400, 0.06, 0.12); beep("sine", 2000, 1600, 0.05, 0.11, 0.1); beep("sine", 1900, 2500, 0.06, 0.1, 0.18); } },
    rabbit:  { n: "小兔", s: "咕咕",   play: function () { vib("sine", 620, 0.12, 0.12, 18); vib("sine", 580, 0.1, 0.11, 16, 0.16); } },
    monkey:  { n: "猴子", s: "吱吱",   play: function () { beep("square", 900, 1300, 0.06, 0.1); beep("square", 1100, 800, 0.05, 0.09, 0.1); beep("square", 1000, 1400, 0.06, 0.09, 0.18); } },
    elephant:{ n: "大象", s: "嗷～",   play: function () { beep("sawtooth", 110, 70, 0.9, 0.24); vib("sawtooth", 90, 0.8, 0.14, 4, 0.1); } },
    lion:    { n: "狮子", s: "吼～",   play: function () { beep("sawtooth", 130, 90, 0.7, 0.26); noise(0.6, 0.14, 300, 0.05); vib("sawtooth", 100, 0.6, 0.16, 7, 0.1); } }
  };

  function say(id) {
    var v = VOICES[id];
    if (!v) return false;
    v.play();
    return true;
  }
  function label(id) { var v = VOICES[id]; return v ? (v.n + " " + v.s) : ""; }
  function list() {
    var out = [], k;
    for (k in VOICES) { if (VOICES.hasOwnProperty(k)) out.push({ id: k, n: VOICES[k].n, s: VOICES[k].s }); }
    return out;
  }

  // 首次手势解锁音频（与 speech.js 同一策略）
  (function unlock() {
    function fn() { ac(); }
    w.document.addEventListener("touchstart", fn, { passive: true });
    w.document.addEventListener("pointerdown", fn);
    w.document.addEventListener("click", fn);
    w.document.addEventListener("keydown", fn);
  })();

  App.Animals = { say: say, label: label, list: list };
})(window);
