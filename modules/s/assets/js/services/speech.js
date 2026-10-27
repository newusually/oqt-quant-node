/*
 * speech.js — 服务层 / 语音与音效
 * 负责：中文/英文/拼音三类朗读、WebAudio 音效、移动端音频解锁、"读整篇文档"顺序播报。
 * 兼容要点：
 *   1) 老内核/无语音环境：静默降级，不报错；
 *   2) 手机端语音列表异步返回：先入待读队列，拿到中文语音或用户首次手势后自动补读；
 *   3) 拼音绝不用英文读法：统一走 speakPinyin（呼读音），英文走 speakEn，两者不混。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var voice = null, enVoice = null;
  var pendZh = [], pendEn = [], flushing = false;
  var PYD = App.PY_SYL || { SYL: {}, NEU: {} };
  var PYSYL = PYD.SYL || {}, PYNEU = PYD.NEU || {};

  function zhList() {
    try {
      return (w.speechSynthesis.getVoices() || []).filter(function (v) { return v.lang && v.lang.toLowerCase().indexOf("zh") === 0; });
    } catch (e) { return []; }
  }
  function enList() {
    try {
      return (w.speechSynthesis.getVoices() || []).filter(function (v) { return v.lang && /^en/i.test(v.lang); });
    } catch (e) { return []; }
  }
  // 默认嗓音：优先 Microsoft HsiaoChen Online (Natural) - Chinese (Taiwan)，没有就依次回退
  var ZH_DEFAULT = [
    "Microsoft HsiaoChen Online (Natural) - Chinese (Taiwan)",
    "Microsoft HsiaoChen Online (Natural) - Chinese (Hong Kong)",
    "Microsoft HsiaoChen Online (Natural) - Chinese (Taiwan Mandarin)",
    "Microsoft Yunxi Online (Natural) - Chinese (Mainland)",
    "Microsoft Xiaoxiao Online (Natural) - Chinese (Mainland)"
  ];
  var ZH_DEFAULT_RE = [
    /HsiaoChen.*Chinese \(Taiwan\)/i, /HsiaoChen.*Taiwan/i, /HsiaoChen/i,
    /Yunxi.*Chinese \(Mainland\)/i, /Xiaoxiao.*Chinese \(Mainland\)/i
  ];
  // 中文嗓音偏好：微软小晓/云希等童声/青年声优先（适合小朋友）
  var ZH_FAVOR = /Xiaoxiao|Yunxi|Xiaoyi|Yunjian|Yaoyao|Tingting|Huihui|Xiaomeng|Female|Sinji|Meijia/i;
  function byName(list, name) {
    for (var i = 0; i < list.length; i++) { if (list[i].name === name) return list[i]; }
    return null;
  }
  // 这台设备上有没有某个中文嗓音（用于判断"默认嗓音装没装"）
  function hasZhVoice(name) {
    if (!name || !("speechSynthesis" in w)) return false;
    try { return !!byName(zhList(), name); } catch (e) { return false; }
  }
  // 默认嗓音（HsiaoChen 台湾）在这台设备是否缺失
  function defaultZhMissing() { return !hasZhVoice(ZH_DEFAULT[0]); }
  // 按默认清单挑一个（用户没手动选过声音时才用）
  // 重要：优先挑「离线嗓音」（localService=true）。标着 Online 的嗓音合成在微软云端做，
  // 一旦网络不通就整段静音，所以离线能响的排在最前面。
  function pickFrom(L, names, res, favor) {
    var i, j, v;
    for (i = 0; i < names.length; i++) { v = byName(L, names[i]); if (v) return v; }
    for (j = 0; j < res.length; j++) {
      for (i = 0; i < L.length; i++) { if (res[j].test(L[i].name || "")) return L[i]; }
    }
    var f = L.filter(function (x) { return favor.test(x.name || ""); })[0];
    return f || null;
  }
  function defaultZh(zs) {
    // 1) 默认清单（HsiaoChen 台湾在最前）优先，从【完整列表】里直接找。
    //    HsiaoChen 是 Online（云端合成）嗓音，localService=false，但用户就是要它，
    //    本机装了就一定能播出来；万一播不出，看门狗会自动转联网发音兜底，
    //    所以绝不能因为 localService!==true 就把它排掉（之前那一版就是这么排掉的）。
    var v = pickFrom(zs, ZH_DEFAULT, ZH_DEFAULT_RE, ZH_FAVOR);
    if (v) return v;
    // 2) 默认清单这台设备真没有（比如没装 HsiaoChen）→ 退而求其次挑「离线嗓音」（断网也响），
    //    再不行就用列表里任意一个中文嗓音。
    var loc = zs.filter(function (x) { return x.localService === true; });
    var f = (loc.length ? pickFrom(loc, [], [], ZH_FAVOR) : null) || zs[0] || null;
    return f;
  }
  function pickVoice() {
    if (!("speechSynthesis" in w)) return;
    var pinned = !!(App.Store && App.Store.state && App.Store.state.voicePinned);
    var want = (App.Store && App.Store.state && App.Store.state.voiceZh) || "";
    try {
      var zs = zhList();
      var fav = zs.filter(function (v) { return ZH_FAVOR.test(v.name); })[0] || null;
      var hit = want ? byName(zs, want) : null;
      if (pinned && want && hit) {
        voice = hit;                       // 用户在声音面板手动选过 → 严格用他选的，不覆盖
      } else {
        // 没手动选过（或存档被旧版污染成了别的嗓音）→ 用默认清单（HsiaoChen 台湾优先），
        // 并把真实嗓音写回 Store，让面板显示正确；这样能从被污染的存档自动恢复。
        voice = defaultZh(zs) || fav || zs[0] || null;
        if (voice && App.Store && App.Store.state) {
          try { App.Store.state.voiceZh = voice.name; App.Store.save(); } catch (e1) {}
        }
      }
      var es = enList();
      var wantEn = (App.Store && App.Store.state && App.Store.state.voiceEn) || "";
      enVoice = wantEn ? (es.filter(function (v) { return v.name === wantEn; })[0] || null) : (es[0] || null);
    } catch (e) { voice = null; enVoice = null; }
    pump();
  }
  try { pickVoice(); if (w.speechSynthesis) w.speechSynthesis.onvoiceschanged = pickVoice; } catch (e) {}

  /* ---------- 声音选择（像导航一样挑人声） ---------- */
  var VNAME = [
    [/Xiaoxiao/i, "晓晓 · 女声"], [/Xiaoyi/i, "晓伊 · 女声"], [/Xiaomeng/i, "晓梦 · 女声"], [/Xiaohan/i, "晓涵 · 女声"],
    [/Xiaomo/i, "晓墨 · 女声"], [/Xiaoxuan/i, "晓萱 · 女声"], [/Xiaoyue/i, "晓月 · 女声"], [/Xiaobei/i, "小贝 · 女声"],
    [/Yunxi/i, "云希 · 男声"], [/Yunjian/i, "云健 · 男声"], [/Yunxia/i, "云夏 · 男声"], [/Yunyang/i, "云扬 · 男声"],
    [/Yunze/i, "云泽 · 男声"], [/Huihui/i, "慧慧 · 女声"], [/Yaoyao/i, "瑶瑶 · 女声"], [/Tingting/i, "婷婷 · 女声"],
    [/Sinji/i, "新姬 · 女声"], [/Meijia/i, "美佳 · 女声"], [/Lili/i, "莉莉 · 女声"],
    [/Google.*(中国|Chinese|Mandarin|普通话)/i, "谷歌普通话 · 女声"], [/普通话/i, "普通话 · 女声"],
    [/female/i, "女声"], [/male/i, "男声"]
  ];
  function voiceLabel(v) {
    var i, t, online = /online|natural/i.test(v.name || "");
    for (i = 0; i < VNAME.length; i++) { if (VNAME[i][0].test(v.name || "")) return VNAME[i][1] + (online ? " · 在线" : ""); }
    t = (v.lang || "").toLowerCase().indexOf("zh") === 0 ? "中文语音" : "英文语音";
    return (v.name || "未知语音") + " · " + t + (online ? " · 在线" : "");
  }
  function listVoices() {
    // ★纯联网: 面板只列云端嗓音（本机 speechSynthesis 全部不再使用）
    var out = [], i, v;
    var cs = cloudVoices();
    for (i = 0; i < cs.length; i++) {
      v = cs[i];
      out.push({ name: v.name, lang: v.lang, kind: v.tl === "en" ? "en" : "zh", online: true, label: v.name, id: v.id, tag: "云端" });
    }
    return out;
  }
  function setVoice(name, kind) {
    if (!App.Store || !App.Store.state) return;
    if (kind === "en") App.Store.state.voiceEn = name || ""; else App.Store.state.voiceZh = name || "";
    App.Store.save();
    pickVoice();
  }
  // 试听：opt.styleId 显式指定变声风格（面板里还没保存的暂存风格靠它预览）
  function demoVoice(name, kind, opt) {
    opt = opt || {};
    var stD = (typeof opt.styleId !== "undefined") ? styleGet(opt.styleId) : currentStyle();
    // 走队列（不 cancel），本机不可用时引擎自动改联网发音，试听永远有声
    push({
      t: kind === "en" ? "Hello! I am your English voice." : "你好，我是你的朗读小老师，我们一起来学拼音吧！",
      en: kind === "en", vname: name,
      opt: { rate: 0.9, pitch: stD ? stD.pitch : (kind === "en" ? 1.0 : 1.15) }
    });
  }

  /* =====================================================
   * 云端嗓音（联网）：谷歌翻译 TTS + 有道词典音
   * ★2026-10-24 用户要求「直接联网, 去掉本地所有连接」→ 全部走这里。
   *   实测(本机 2026-10-24):
   *     · 谷歌 translate_tts  → 长中文/英文都返回 audio/mpeg, 稳定可用 ★推荐
   *     · 有道 dictvoice     → 是【词典】接口, 只认单词/短语;
   *                            整句(如"你好，我是你的朗读小老师…")直接 500 → 必静默
   *     · 搜狗 revoiceonduty → 返回 HTML 反爬页, 不可用
   *     · 微软 Edge TTS      → 该免鉴权端点已 404
   *   所以默认嗓音 = 谷歌普通话; 有道只用于短词, 整句自动改用谷歌。
   * ===================================================== */
  var CLOUD = [
    { id: "g-zh",   name: "谷歌普通话 · 女声（推荐）",       lang: "zh-CN", tl: "zh-CN", spd: 1,   src: "g",  tag: "云端" },
    { id: "g-zh-s", name: "谷歌慢速 · 教学音",              lang: "zh-CN", tl: "zh-CN", spd: 0.4, src: "g",  tag: "云端" },
    { id: "g-tw",   name: "谷歌台湾国语 · 女声",            lang: "zh-TW", tl: "zh-TW", spd: 1,   src: "g",  tag: "云端" },
    { id: "g-hk",   name: "谷歌粤语 · 女声",                lang: "zh-HK", tl: "zh-HK", spd: 1,   src: "g",  tag: "云端" },
    { id: "yd-zh",  name: "有道词典 · 普通话（只适合单词/短语）", lang: "zh-CN", tl: "zh-CN", spd: 1, src: "yd", tag: "云端" },
    { id: "g-en",   name: "谷歌英语 · 女声（推荐）",         lang: "en-US", tl: "en",    spd: 1,   src: "g",  tag: "云端" },
    { id: "g-en-s", name: "谷歌英语 · 慢速",                lang: "en-US", tl: "en",    spd: 0.5, src: "g",  tag: "云端" },
    { id: "yd-en",  name: "有道词典 · 英语（只适合单词）",   lang: "en-US", tl: "en",    spd: 1,   src: "yd", tag: "云端" }
  ];
  function cloudVoices() { return CLOUD.slice(); }
  function cloudGet(id) {
    for (var i = 0; i < CLOUD.length; i++) { if (CLOUD[i].id === id) return CLOUD[i]; }
    return null;
  }
  // 当前选中的云端嗓音（★纯联网: 未选时默认谷歌普通话 g-zh）
  function currentCloud() {
    var id = (App.Store && App.Store.state && App.Store.state.voiceCloud) || "";
    return id ? cloudGet(id) : cloudGet("g-zh");
  }
  function setCloudVoice(id) {
    if (!App.Store || !App.Store.state) return;
    App.Store.state.voiceCloud = id || "";
    App.Store.save();
    stopCloud();
  }
  // 切句：接口单条上限约 200 字符，按标点切成短句顺序播放
  function cloudSplit(text, max) {
    max = max || 170;
    var s = String(text || "").replace(/<[^>]+>/g, "").trim();
    if (!s) return [];
    var BREAK = { "。": 1, "！": 1, "？": 1, "；": 1, "!": 1, "?": 1, ";": 1, "\n": 1 };
    var out = [], buf = "", i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      buf += ch;
      if (BREAK[ch] && buf.length >= 12) { out.push(buf); buf = ""; }
      else if (buf.length >= max) { out.push(buf); buf = ""; }
    }
    if (buf) out.push(buf);
    return out;
  }
  function cloudUrl(v, text) {
    var t = String(text || "").slice(0, 180);
    // ★2026-10-24 改为走本站代理(浏览器直连会被 Chrome ORB 拦掉 → 完全没声音):
    //   · node 部署(oqt-quant-node) → /api/s/tts  (Node 端转发, 带 CORS 头)
    //   · latest 部署(PHP/Apache)   → tts.php     (同目录相对路径, 服务端转发)
    var path = String((w.location && w.location.pathname) || "");
    var proxy = (path.indexOf("/modules/s/") >= 0) ? "/api/s/tts" : "tts.php";
    return proxy + "?text=" + encodeURIComponent(t) + "&voice=" + encodeURIComponent(v.id || "g-zh");
  }
  var cloudQ = [], cloudBusy = false, cloudCur = null, cloudCb = null;
  function stopCloud() {
    cloudQ = [];
    if (cloudCur) { try { cloudCur.pause(); } catch (e) {} cloudCur = null; }
    cloudBusy = false;
  }
  function cloudNext() {
    if (!cloudQ.length) { cloudBusy = false; cloudCur = null; if (cloudCb) { var c = cloudCb; cloudCb = null; c(); } return; }
    cloudBusy = true;
    var job = cloudQ.shift();
    var a = null;
    try { a = new Audio(); } catch (e) { a = null; }
    if (!a) { stopCloud(); if (job.fallback) job.fallback(); return; }
    cloudCur = a;
    var done = false;
    function fin(fallback) {
      if (done) return;
      done = true;
      if (fallback && job.fallback) { job.fallback(); }
      if (a === cloudCur) cloudCur = null;
      cloudNext();
    }
    var t0 = nowMs();
    a.onended = function () { calibrate(job.t, nowMs() - t0, 1, isEnText(job.t)); fin(false); };
    a.onerror = function () { fin(true); };
    try { a.src = cloudUrl(job.v, job.t); var p = a.play(); if (p && p.catch) p.catch(function () { fin(true); }); } catch (e) { fin(true); }
    // 兜底：5 秒还没结束就跳过（网络卡住）
    setTimeout(function () { if (!done) fin(true); }, 5000);
  }
  // 云端播放（队列）：fallback 在失败时调用（通常回退本机嗓音）
  function playCloud(text, v, opt, fallback) {
    opt = opt || {};
    if (!v || !text) { if (fallback) fallback(); return; }
    stopCloud();
    var segs = cloudSplit(text);
    if (!segs.length) { if (fallback) fallback(); return; }
    for (var i = 0; i < segs.length; i++) cloudQ.push({ v: v, t: segs[i], fallback: i === 0 ? fallback : null });
    cloudNext();
  }
  function demoCloud(id) {
    var v = cloudGet(id);
    if (!v) return;
    push({
      t: v.tl === "en" ? "Hello! I am your English voice." : "你好，我是你的朗读小老师，我们一起来学拼音吧！",
      en: v.tl === "en", cloudId: id, opt: { rate: 0.9 }
    });
  }

  /* ---------- 本机嗓音变声风格（离线：同一嗓音衍生多种音色） ---------- */
  var STYLES = [
    { id: "st-baby",  name: "🍼 萌娃音 · 又萌又甜", kind: "zh", rate: 0.92, pitch: 1.9 },
    { id: "st-clear", name: "🌟 清脆童声 · 读题",   kind: "zh", rate: 1.0,  pitch: 1.45 },
    { id: "st-soft",  name: "🌙 温柔女声 · 讲故事", kind: "zh", rate: 0.95, pitch: 1.25 },
    { id: "st-calm",  name: "🎩 沉稳男声 · 慢讲课", kind: "zh", rate: 0.92, pitch: 0.75 },
    { id: "st-slow",  name: "🐢 慢速教学 · 听得清", kind: "zh", rate: 0.68, pitch: 1.1 },
    { id: "st-en-b",  name: "🇬🇧 英语清晰 · 朗读", kind: "en", rate: 0.9,  pitch: 1.05 },
    { id: "st-en-s",  name: "🐢 英语慢速 · 教学",   kind: "en", rate: 0.6,  pitch: 1.0 }
  ];
  function styleVoices() { return STYLES.slice(); }
  function styleGet(id) {
    for (var i = 0; i < STYLES.length; i++) { if (STYLES[i].id === id) return STYLES[i]; }
    return null;
  }
  function currentStyle() {
    var id = (App.Store && App.Store.state && App.Store.state.voiceStyle) || "";
    return id ? styleGet(id) : null;
  }
  function setStyleVoice(id) {
    if (!App.Store || !App.Store.state) return;
    App.Store.state.voiceStyle = id || "";
    App.Store.save();
  }
  // 风格试听：本机嗓音 + 变声参数
  function demoStyle(id) {
    var st = styleGet(id);
    if (!st) return;
    push({
      t: st.kind === "en" ? "Hello! I am your English voice." : "你好，我是你的朗读小老师，我们一起来学拼音吧！",
      en: st.kind === "en", opt: { rate: st.rate, pitch: st.pitch }
    });
  }

  // 统一进串行队列（真正的播放在引擎里做，见文末「播放引擎 v2」）
  function speakEn(text, opt) { push({ t: text, en: true, opt: opt }); }
  function speakEnLocal(text, opt) { push({ t: text, en: true, opt: opt, local: true }); }

  /* ---------- 拼音朗读：按中文自然语言读，绝不被读成英文字母 ---------- */
  /* ★呼读音按小学教材标准：n=讷(nè)、c=雌(cī)（原写成“呢/刺”，声调与教材不一致 → 听着不对） */
  var PY_INIT = { b: "波", p: "坡", m: "摸", f: "佛", d: "得", t: "特", n: "讷", l: "勒", g: "哥", k: "科", h: "喝", j: "基", q: "欺", x: "希", zh: "知", ch: "吃", sh: "诗", z: "资", c: "雌", s: "思", r: "日", y: "衣", w: "乌" };
  var PY_WHOLE = { zhi: "知", chi: "吃", shi: "诗", ri: "日", zi: "资", ci: "雌", si: "思", yi: "衣", wu: "乌", yu: "迂", ye: "耶", yue: "月", yuan: "元", yin: "音", yun: "云", ying: "英", zhei: "这", shei: "谁" };
  var PY_FIN = {
    a: "啊", o: "喔", e: "鹅", i: "衣", u: "乌", "ü": "迂", ai: "爱", ei: "欸", ui: "威", ao: "熬", ou: "欧", iu: "优",
    ie: "耶", "üe": "约", ue: "约", er: "儿", an: "安", en: "恩", in: "音", un: "温", "ün": "晕", ang: "昂", eng: "鞥", ing: "英", ong: "翁",
    ia: "呀", iao: "腰", ian: "烟", iang: "央", iong: "拥", ua: "蛙", uo: "窝", uai: "外", uan: "弯", uang: "汪", ueng: "翁"
  };
  var PY_EXTRA = { ng: "嗯", hm: "噷", hng: "嗯", "ê": "欸", yo: "哟", o: "喔" };
  // 声母表（长的放前面，保证 zh/ch/sh 优先匹配）
  var PY_INIT_KEYS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "z", "c", "s", "r", "y", "w"];
  // 声调符号 → 无声调字母
  var PY_TONE = { "ā": "a", "á": "a", "ǎ": "a", "à": "a", "ē": "e", "é": "e", "ě": "e", "è": "e", "ī": "i", "í": "i", "ǐ": "i", "ì": "i", "ō": "o", "ó": "o", "ǒ": "o", "ò": "o", "ū": "u", "ú": "u", "ǔ": "u", "ù": "u", "ǖ": "ü", "ǘ": "ü", "ǚ": "ü", "ǜ": "ü", "ń": "n", "ň": "n", "ḿ": "m" };
  var TONE_ORDER = "āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńň";
  // 取声调：带调符号或数字（ma3）→ 1~4；无声调 → 0
  function pyTone(tok) {
    var i, ch, s = String(tok);
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (PY_TONE[ch]) { return TONE_ORDER.indexOf(ch) % 4 + 1; }
    }
    var m = s.match(/([1-4])\s*$/);
    return m ? parseInt(m[1], 10) : 0;
  }
  function pyNorm(t) {
    var s = String(t).toLowerCase().replace(/[0-9]/g, "").replace(/u:/g, "ü"), out = "", i, ch;
    for (i = 0; i < s.length; i++) {
      ch = s.charAt(i);
      if (PY_TONE[ch]) { out += PY_TONE[ch]; continue; }
      if (ch === "v") { out += "ü"; continue; }
      out += ch;
    }
    return out;
  }
  // 完整音节 → 同音汉字（带调用对应声调的字；无声调用轻声代表字，没有则用一声字）
  function sylChar(low, tone) {
    var four = PYSYL[low];
    if (!four) return null;
    if (tone >= 1 && tone <= 4) return four.charAt(tone - 1);
    return PYNEU[low] || four.charAt(0);
  }
  // 把一个无声调音节拆成「声母呼读音 + 韵母汉字」（保底：表里没有的生僻音节）
  function pySyllable(low) {
    var i, init = "", fin, a, b;
    for (i = 0; i < PY_INIT_KEYS.length; i++) {
      var k = PY_INIT_KEYS[i];
      if (low.indexOf(k) === 0 && low.length > k.length) { init = k; break; }
    }
    fin = init ? low.slice(init.length) : low;
    if (fin === "ê") fin = "e";
    a = PY_INIT[init] || "";
    b = PY_FIN[fin];
    if (!b) return null;
    return a ? (a + " " + b) : b;
  }
  function pyText(py) {                      /* 拼音→呼读音文本(不发声), 供 seq/字幕复用 */
    var tokens = String(py || "").trim().split(/[\s,，、]+/), out = [], i, t, low, tone, piece, c;
    for (i = 0; i < tokens.length; i++) {
      t = tokens[i]; if (!t) continue;
      tone = pyTone(t); low = pyNorm(t);
      if (!low) continue;
      if (PY_EXTRA[low]) { out.push(PY_EXTRA[low]); continue; }
      if (tone) { piece = sylChar(low, tone); if (piece) { out.push(piece); continue; } }
      if (PY_INIT[low]) { out.push(PY_INIT[low]); continue; }
      if (PY_WHOLE[low]) { out.push(PY_WHOLE[low]); continue; }
      if (PY_FIN[low]) { out.push(PY_FIN[low]); continue; }
      if (!tone) { piece = sylChar(low, 0); if (piece) { out.push(piece); continue; } }
      if (/^[bpmfdtnlgkhjqxzcsryw]+$/.test(low)) {
        var cs = low.split("");
        for (c = 0; c < cs.length; c++) { if (PY_INIT[cs[c]]) out.push(PY_INIT[cs[c]]); }
        continue;
      }
      piece = pySyllable(low);
      if (piece) { out.push(piece); continue; }
      out.push(t);
    }
    return out.join(" ");
  }
  function speakPinyin(py, opt) {
    var converted = pyText(py);
    if (!converted) return;
    speak(converted, opt);
  }

  /* ---------- 朗读时长估算（给动画配节奏用） ----------
   * 初始值：中文约 5 字/秒、英文约 13 词/秒（rate=1 时）；每次真读完用实测值校准，
   * 这样在线嗓音慢、本机嗓音快都能自动对上，不用写死。 */
  var CPS = { zh: 5.0, en: 13.0 };
  function nowMs() { return (w.performance && w.performance.now) ? w.performance.now() : (new Date()).getTime(); }
  function plainText(t) { return String((t === null || t === undefined) ? "" : t).replace(/<[^>]+>/g, ""); }
  function isEnText(s) { return !/[\u4e00-\u9fa5]/.test(s); }
  function currentRate(opt) {
    var st1 = currentStyle();
    if (opt && typeof opt.rate === "number" && opt.rate > 0) return opt.rate;
    return st1 ? st1.rate : 0.95;
  }
  // 用实测时长反推字速（归一化到 rate=1），滚动平均
  function calibrate(text, durMs, rate, en) {
    var s = plainText(text).replace(/\s/g, "");
    var len = en ? (plainText(text).split(/\s+/).length || 1) : s.length;
    if (!len || durMs < 350) return;
    var eff = Math.max(140, durMs - 260);          // 扣掉起播延迟
    var cps = (len / (eff / 1000)) * (rate || 1);
    if (cps < 2) cps = 2;
    if (cps > 14) cps = 14;
    var k = en ? "en" : "zh";
    CPS[k] = Math.round((CPS[k] * 0.65 + cps * 0.35) * 100) / 100;
  }
  // 估算这段话读完要多少毫秒（动画据此决定下一步等多久）
  function estimate(text, opt) {
    opt = opt || {};
    var s = plainText(text).trim();
    if (!s) return 0;
    var en = isEnText(s);
    var rate = currentRate(opt);
    var len = en ? (s.split(/\s+/).length || 1) : s.replace(/\s/g, "").length;
    var pauses = (s.match(/[，。！？；、：,.!?;:]/g) || []).length;
    var ms = (len / (CPS[en ? "en" : "zh"] * rate)) * 1000 + pauses * 140 + 260;
    var cv = currentCloud();
    if (cv && cv.tl !== "en") ms += 600;            // 云端要下载音频，多留一点
    return Math.round(ms);
  }

  /* =====================================================
   * 播放引擎 v2：串行队列 / 不乱 cancel / 叫不醒就自动联网发音
   * -----------------------------------------------------
   * 「点了没声音」的根因：Chromium 内核（Edge、搜狗、360、QQ 浏览器）
   * 在 cancel() 之后立刻 speak() 会把整段话吞掉，旧代码每一句都
   * 先 cancel 再 speak，于是全站静音。新引擎三条铁律：
   *   ① 全程串行排队，只有 stop() 才 cancel，cancel 后留 200ms 静默期；
   *   ② 每句话带看门狗：750ms 还没 onstart 视为被吞 → 重试一次，
   *      再失败就判定本机语音不可用，自动改走联网发音（<audio> 播放）；
   *   ③ 浏览器根本没语音引擎 / 没装这门语言的语音包 → 直接走联网发音。
   * ===================================================== */
  function supported() {
    return !!("speechSynthesis" in w) && typeof w.SpeechSynthesisUtterance === "function";
  }
  var Q = [], busy = false, gate = 0, unlocked = false;
  var localFail = 0, localDead = false, cloudFail = 0, cloudOK = false;
  var CA = null;

  // 预生成音频清单：文本 → 相对路径（由 assets/audio/manifest.js 注入 window.__AUDIO_MANIFEST__）
  var MANIFEST = (w.__AUDIO_MANIFEST__) || null;

  function cloudAudio() { if (!CA) { try { CA = new Audio(); } catch (e) { CA = null; } } return CA; }

  // 移动端（QQ/微信/钉钉 X5 内核）解锁媒体播放用：一段极短静音 WAV，首次手势里 play() 一下即可解锁 <audio> 自动播放
  var SILENT_WAV = "data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

  // 播放预生成 MP3（同源文件，无需本机语音包，台湾女声 HsiaoChen）
  // 移动端（QQ/微信 X5 内核）的坑：<audio>.play() 必须在「用户手势内」且音频已加载完才放行，
  // 远程 MP3 加载完时早已脱离手势，常被静默拦截 → 全站没声音。治本办法是 WebAudio：
  //   fetch(MP3) → decodeAudioData → AudioBufferSourceNode.start()
  // 只要 AudioContext 在首次手势里被 resume 过一次，之后任何时刻 start() 都不再受自动播放策略限制。
  // cb(true)=成功；cb(false)=失败（调用方应回退语音合成 / <audio> 兜底）。
  var AE = null, mp3Done = null, audioCache = {};
  function audioEl() { if (!AE) { try { AE = new Audio(); } catch (e) { AE = null; } } return AE; }
  function playMp3Web(url, cb) {
    var ctx = ac();                       // 复用全局单例 AudioContext（首次手势里已 resume 解锁）
    if (!ctx) { cb(false); return; }
    if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) {} }
    function start(buf) {
      try {
        var src = ctx.createBufferSource();
        src.buffer = buf; src.connect(ctx.destination);
        var done = false;
        src.onended = function () { if (!done) { done = true; cb(true); } };
        src.start(0);
      } catch (e) { cb(false); }
    }
    var c = audioCache[url];
    if (c && c.buffer) { start(c.buffer); return; }              // 已解码 → 直接播（最快）
    if (c && c.state === "loading") { c.waiters.push(start); return; }
    audioCache[url] = { state: "loading", buffer: null, waiters: [start] };
    try {
      fetch(url).then(function (r) {
        if (!r.ok) { audioCache[url].state = "error"; cb(false); return null; }
        return r.arrayBuffer();
      }).then(function (ab) {
        if (!ab) return;
        ctx.decodeAudioData(ab, function (buf) {
          var it = audioCache[url];
          it.buffer = buf; it.state = "ready";
          it.waiters.forEach(function (fn) { try { fn(buf); } catch (e2) {} });
          it.waiters = [];
        }, function () { audioCache[url].state = "error"; cb(false); });
      }).catch(function () { audioCache[url].state = "error"; cb(false); });
    } catch (e) { audioCache[url].state = "error"; cb(false); }
  }
  function playMp3(url, cb) {
    // 优先 WebAudio（移动端最稳，绕开自动播放限制）；不可用再回退 <audio>
    playMp3Web(url, function (ok) {
      if (ok) { if (cb) cb(true); return; }
      var a = audioEl();
      if (!a) { if (cb) cb(false); return; }
      var reported = false;
      function done(success) {
        if (reported) return; reported = true; mp3Done = null;
        try { a.onended = null; a.onerror = null; } catch (e) {}
        if (cb) cb(success);
      }
      mp3Done = done;
      a.onended = function () { done(true); };
      a.onerror = function () { done(false); };
      try {
        a.src = url;
        var p = a.play();
        if (p && p.catch) p.catch(function () { done(false); });
      } catch (e) { done(false); }
    });
  }

  function push(job) {
    if (!job || ((job.t === null || job.t === undefined) && !job.fn)) return;
    Q.push(job);
    if (Q.length > 40) Q.splice(0, Q.length - 40);   // 防止狂点堆积
    // 只能走联网发音、而用户还没点过页面 → 浏览器会挡住，给个「点我开启声音」的小提示
    if (!unlocked && !localUsable(job.en)) setTimeout(unlockTip, 400);
    pump();
  }
  // 兜底提示条：只在「本机发不出声、只能联网念」且用户还没点过页面时出现
  // 两条路都试过还是没响 → 明说，别让用户干等
  var silent = 0, failTipShown = false;
  function failTip() {
    if (failTipShown || !w.document || !w.document.body) return;
    failTipShown = true;
    var d = w.document, el;
    try { el = d.createElement("div"); } catch (e) { return; }
    el.setAttribute("style", "position:fixed;left:50%;bottom:18px;-webkit-transform:translateX(-50%);transform:translateX(-50%);z-index:99999;max-width:92%;background:#fff;border:2px solid #90a4ae;border-radius:14px;padding:9px 16px;font-size:13px;line-height:1.5;color:#37474f;box-shadow:0 6px 18px rgba(0,0,0,.18);cursor:pointer");
    el.textContent = "🔇 这台设备现在发不出声音：本机语音没响应，联网发音也没成功。请检查系统音量、网络，或换 Edge / Chrome 打开；点我关掉这条提示。";
    el.onclick = function () { try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e1) {} };
    d.body.appendChild(el);
  }
  var tipShown = false;
  function unlockTip() {
    if (tipShown || unlocked || !w.document || !w.document.body) return;
    tipShown = true;
    var d = w.document, el;
    try { el = d.createElement("div"); } catch (e) { return; }
    el.setAttribute("style", "position:fixed;left:50%;bottom:18px;-webkit-transform:translateX(-50%);transform:translateX(-50%);z-index:99999;background:#fff;border:2px solid #ff7043;border-radius:999px;padding:8px 16px;font-size:14px;color:#d84315;box-shadow:0 6px 18px rgba(0,0,0,.18);cursor:pointer");
    el.textContent = "🔊 点一下这里，开启朗读声音";
    el.onclick = function () {
      unlocked = true;
      try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e1) {}
      pump();
    };
    d.body.appendChild(el);
    setTimeout(function () { try { if (el.parentNode) el.parentNode.removeChild(el); } catch (e2) {} }, 20000);
  }
  function pump() {
    if (busy || !Q.length) return;
    if (nowMs() < gate) { setTimeout(pump, 60); return; }
    // 用户还没点过页面：联网发音会被浏览器挡掉，先攒着，一点页面立刻念
    if (!unlocked && !localUsable(Q[0].en)) return;
    busy = true;
    var job = Q.shift();
    runJob(job, function () {
      busy = false;
      setTimeout(pump, 90);
    });
  }
  function runJob(job, next) {
    var over = false;
    function fin() { if (over) return; over = true; if (job.cb) { try { job.cb(); } catch (e1) {} } next(); }
    if (job.fn) { try { job.fn(fin); } catch (e0) { fin(); } return; }
    var txt = String((job.t === null || job.t === undefined) ? "" : job.t).replace(/<[^>]+>/g, "").trim();
    if (!txt) { fin(); return; }
    // ★2026-10-24 用户要求「直接联网, 去掉本地所有连接」:
    //   本地预生成 MP3(assets/audio/manifest.js) 与本机 speechSynthesis 全部不再使用,
    //   一律走云端发音(有道 yd-zh / yd-en, 谷歌备用)。
    synthPath(job, fin);
  }
  // 走【云端发音】链路（不再回退本机）
  function synthPath(job, fin) {
    var txt = String((job.t === null || job.t === undefined) ? "" : job.t).replace(/<[^>]+>/g, "").trim();
    if (!txt) { fin(); return; }
    var cv = job.cloudId ? cloudGet(job.cloudId) : currentCloud();
    // 语言要对上：英文文本用英文嗓音，中文用中文嗓音
    if (job.en && cv && cv.tl !== "en") cv = cloudGet("g-en") || cv;
    if (!job.en && cv && cv.tl === "en") cv = cloudGet("g-zh") || cv;
    // ★有道是【词典】接口: 只认真实单词, 整句/非词组一律 500 静默
    //   → 只有"4字以内且无标点"的短词才用有道, 其余一律走谷歌(整句都能念)
    if (cv && cv.src === "yd" && !isShortWord(txt)) cv = cloudGet(job.en ? "g-en" : "g-zh") || cv;
    if (!cv) cv = autoCloudOf(!!job.en);
    if (!cv) { fin(); return; }
    cloudSeq(txt, cv, fin);
  }
  // 短词判定: ≤4 字且不含标点/空格
  function isShortWord(t) {
    t = String(t || "").trim();
    if (!t || t.length > 4) return false;
    return !/[\s,，。！？、；：""''（）()《》…—\-]/.test(t);
  }
  // ★纯联网: 本机嗓音一律视为"不可用"（只用于判断是否需要等用户手势）
  function localUsable(en) {
    return false;
  }
  // 兜底的联网嗓音（只用于本次，不写进 Store）
  function autoCloudOf(en) { return cloudGet(en ? "g-en" : "g-zh"); }
  function cloudAuto(txt, job, fin) {
    job.cloudDone = true;                       // 记一下：这条路已经试过，别来回兜圈子
    var v = autoCloudOf(!!job.en);
    // ★纯联网: 联网也不通就放弃，绝不回退本机 TTS
    if (!v) { fin(); return; }
    var before = cloudFail;
    cloudSeq(txt, v, function () {
      if (cloudFail > before) {
        silent++;
        if (silent >= 3) failTip();
      }
      fin();
    });
  }
  function cloudSeq(text, v, done) {
    var segs = cloudSplit(text), i = 0;
    if (!segs.length) { done(); return; }
    (function nx() {
      if (i >= segs.length) { done(); return; }
      var seg = segs[i++];
      /* ★中英混排: 该段若是英文(或含英文且当前是中文嗓音), 自动换英文嗓音; 反之亦然 */
      var vv = v;
      try {
        if (v && v.tl !== "en" && isEnText(seg)) vv = cloudGet("g-en") || v;
        else if (v && v.tl === "en" && !isEnText(seg)) vv = cloudGet("g-zh") || v;
      } catch (eL) {}
      var a = cloudAudio();
      if (!a) { done(); return; }
      var over = false, tries = 0;
      function go() { if (over) return; over = true; setTimeout(nx, 80); }
      var t0 = nowMs();
      a.onended = function () { cloudOK = true; calibrate(seg, nowMs() - t0, 1, isEnText(seg)); go(); };
      a.onerror = function () { cloudFail++; go(); };
      // 联网发音需要用户先点过页面（浏览器自动播放策略）：没点过就隔 0.6 秒重试，直到用户点一下
      function fire() {
        try {
          a.src = cloudUrl(vv, seg);
          var p = a.play();
          if (p && p.catch) p.catch(function () {
            cloudFail++;
            if (!unlocked && tries++ < 10) { setTimeout(fire, 600); return; }
            go();
          });
        } catch (e2) { cloudFail++; go(); }
      }
      fire();
      setTimeout(go, 12000);            // 网络卡住兜底
    })();
  }
  function localSpeak(txt, job, fin) {
    if (!supported()) { cloudAuto(txt, job, fin); return; }
    if (!voice && !job.en) pickVoice();
    if (!enVoice && job.en) pickVoice();
    var vs = job.en ? enVoice : voice;
    if (job.vname) { var vv = byName(job.en ? enList() : zhList(), job.vname); if (vv) vs = vv; }
    if (!vs) {                          // 嗓音列表异步返回，等一会儿
      var n = 0;
      (function wait() {
        pickVoice();
        vs = job.en ? enVoice : voice;
        if (job.vname) { var vv2 = byName(job.en ? enList() : zhList(), job.vname); if (vv2) vs = vv2; }
        if (vs) { localSpeak(txt, job, fin); return; }
        if (++n > 40) { cloudAuto(txt, job, fin); return; }
        setTimeout(wait, 100);
      })();
      return;
    }
    var u;
    try { u = new w.SpeechSynthesisUtterance(txt); } catch (e) { cloudAuto(txt, job, fin); return; }
    u.lang = job.en ? "en-US" : "zh-CN";
    u.voice = vs;
    var st1 = currentStyle();
    var rate = (job.opt && typeof job.opt.rate === "number") ? job.opt.rate : (st1 ? st1.rate : (job.en ? 0.85 : 0.95));
    var pitch = (job.opt && typeof job.opt.pitch === "number") ? job.opt.pitch : (st1 ? st1.pitch : (job.en ? 1.0 : 1.15));
    u.rate = rate; u.pitch = pitch;
    var started = false, t0 = nowMs();
    u.onstart = function () { started = true; localFail = 0; };
    u.onend = function () { calibrate(txt, nowMs() - t0, rate, job.en); fin(); };
    u.onerror = function () { fin(); };
    // ★Chrome 已知坑: 调过 speechSynthesis.cancel() 之后, 引擎可能停在 paused 状态,
    //   此后 speak() 不会触发 onstart 也不出声(整段静默)。这里先 resume 一下兜住。
    try { if (w.speechSynthesis.paused) w.speechSynthesis.resume(); } catch (e1b) {}
    try { w.speechSynthesis.speak(u); } catch (e2) { cloudAuto(txt, job, fin); return; }
    // 看门狗①：被吞（既没 onstart 也没在说）→ 重试一次，再失败转联网发音
    setTimeout(function () {
      if (started) return;
      var sp = false;
      try { sp = w.speechSynthesis.speaking || w.speechSynthesis.pending; } catch (e3) {}
      if (sp) return;
      localFail++;
      job.retry = (job.retry || 0) + 1;
      try { w.speechSynthesis.cancel(); } catch (e4) {}
      // ★cancel 之后立刻 resume, 否则重试也会被 paused 状态吞掉
      try { if (w.speechSynthesis.paused) w.speechSynthesis.resume(); } catch (e5) {}
      gate = nowMs() + 200;
      if (job.cloudDone) { fin(); return; }      // 本机+联网都试过了，放弃，别死循环
      if (job.retry === 1 && !localDead) {
        setTimeout(function () { localSpeak(txt, job, fin); }, 280);
      } else {
        localDead = true;
        cloudAuto(txt, job, fin);
      }
    }, 1500);
    // 看门狗②：最长保护时间（老内核不触发 onend 也不至于卡死队列）
    setTimeout(fin, Math.max(9000, estimate(txt, { rate: rate }) * 2.5 + 5000));
  }

  function speak(text, opt) { push({ t: text, en: false, opt: opt }); }
  function speakLocal(text, opt) { push({ t: text, en: false, opt: opt, local: true }); }

  /* ---------- 补读（手机端语音延迟 / 需要手势解锁） ---------- */
  function flush() { pickVoice(); pump(); }
  function flushAll() { pickVoice(); pump(); }

  /* ---------- 顺序播报：题干 → 选项，一句接一句，绝不互相掐断 ---------- */
  function seq(list) {
    if (!list || !list.length) return;
    stopAll();                                  // 新的一轮开始，旧的让位
    var i, it, t, en;
    for (i = 0; i < list.length; i++) {
      it = list[i];
      if (typeof it === "function") { Q.push({ fn: it }); continue; }
      t = (it && typeof it === "object") ? it.t : it;
      en = (it && typeof it === "object") ? !!it.en : false;
      Q.push({ t: t, en: en, opt: null });
    }
    pump();
  }

  /* ---------- 自动读题（受全站「自动朗读」开关控制） ---------- */
  function autoRead(text, opt) {
    if (!App.Store || !App.Store.state || !App.Store.state.autoRead) return;
    if (!text) return;
    setTimeout(function () { push({ t: text, en: false, opt: opt }); }, 250);
  }

  /* ---------- 声音自检：告诉用户「现在到底能不能出声」 ---------- */
  function diag() {
    var sp = supported(), cvv = currentCloud();
    var note = cvv
      ? "全程联网发音（当前「" + cvv.name + "」）；已停用本机语音与本地录音"
      : "全程联网发音；已停用本机语音与本地录音";
    return {
      supported: true,
      voices: cloudVoices().length,
      zh: cloudVoices().filter(function (v) { return v.tl !== "en"; }).length,
      en: cloudVoices().filter(function (v) { return v.tl === "en"; }).length,
      zhVoice: cvv ? cvv.name : "", enVoice: "",
      localDead: true, cloudOk: cloudOK, cloudFail: cloudFail,
      cloud: cvv ? cvv.id : "", using: "云端", note: note, cloudOnly: true
    };
  }
  // 自检发声：念一句测试话，念完把结果回传给面板
  function selfTest(cb) {
    push({
      t: "声音自检开始，一二三，你听到了吗？", en: false, opt: null,
      cb: function () { if (cb) { try { cb(diag()); } catch (e) {} } }
    });
  }
  // 面板用：强制回到本机语音（并把「本机失效」标记清掉）
  function useLocal() {
    if (App.Store && App.Store.state) { App.Store.state.voiceCloud = ""; App.Store.save(); }
    localFail = 0; localDead = false;
  }
  // 面板用：一键改用联网发音
  function useCloud(id) {
    if (App.Store && App.Store.state) { App.Store.state.voiceCloud = id || "yd-zh"; App.Store.save(); }
  }


  /* ---------- WebAudio 音效（无需外部文件） ---------- */
  var AC = null;
  function ac() {
    if (!AC) { try { AC = new (w.AudioContext || w.webkitAudioContext)(); } catch (e) { AC = null; } }
    return AC;
  }
  // 移动端（微信/QQ/钉钉 X5 内核）自动播放限制极严：<audio>.play() 必须发生在「用户手势」里，
  // 且首次播放前必须先用一次手势真正 play() 过（哪怕静音）才能解锁媒体引擎。这里用捕获阶段监听，
  // 保证在任何业务点击之前先完成解锁；解锁后立刻补读待读队列。
  (function unlock() {
    var done = false;
    function fn() {
      if (done) return;
      done = true;
      unlocked = true;                 // 标记已解锁：pump 不再拦截
      // 1) 解锁 WebAudio（音效）
      var c = ac(); if (c && c.state === "suspended") { try { c.resume(); } catch (e) {} }
      // 1b) ★解锁 TTS: Chrome 在 cancel() 之后可能把 speechSynthesis 停在 paused,
      //     手势里 resume 一下, 之后所有朗读才真的出声
      try { if (w.speechSynthesis && w.speechSynthesis.paused) w.speechSynthesis.resume(); } catch (e0) {}
      // 2) 关键：用一段静音真正 play() 一次，解锁 <audio> 媒体引擎（否则手机端 play() 会被静默拦截）
      try {
        var s = new Audio();
        s.src = SILENT_WAV;
        var pr = s.play();
        if (pr && pr.catch) pr.catch(function () {});
      } catch (e) {}
      flushAll();                      // 解锁后补读队列里积压的朗读
      ["touchstart", "pointerdown", "mousedown", "click", "keydown"].forEach(function (ev) {
        try { w.document.removeEventListener(ev, fn, true); } catch (e1) {}
        try { w.document.removeEventListener(ev, fn, false); } catch (e2) {}
      });
    }
    // 捕获阶段：在按钮自身的 click 处理之前先解锁，确保同一手势内后续 play() 已解锁
    ["touchstart", "pointerdown", "mousedown", "click", "keydown"].forEach(function (ev) {
      w.document.addEventListener(ev, fn, true);
    });
  })();

  function tone(freq, dur, type, vol) {
    var c = ac(); if (!c) return;
    try {
      var o = c.createOscillator(), g = c.createGain();
      o.type = type || "triangle"; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.12, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
      o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + dur);
    } catch (e) {}
  }
  var sfx = {
    pop: function () { tone(560 + Math.random() * 320, 0.12, "triangle", 0.10); },
    off: function () { tone(300, 0.16, "sawtooth", 0.07); },
    right: function () { tone(523, 0.18, "sine", 0.14); setTimeout(function () { tone(659, 0.18, "sine", 0.14); }, 140); setTimeout(function () { tone(784, 0.3, "sine", 0.15); }, 280); },
    wrong: function () { tone(220, 0.25, "square", 0.08); }
  };

  // 立刻停掉正在播放的一切（本机朗读 + 云端队列）
  // 真正要打断时才 cancel：cancel 后留 200ms 静默期，避免下一条被吞
  function stopAll() {
    Q = [];
    try { if (mp3Done) { var d = mp3Done; mp3Done = null; d(true); } } catch (e0) {}
    try { if ("speechSynthesis" in w) w.speechSynthesis.cancel(); } catch (e) {}
    try { if (CA) CA.pause(); } catch (e2) {}
    try { if (AE) { AE.pause(); AE.onended = null; AE.onerror = null; } } catch (e3) {}
    gate = nowMs() + 200;
    stopCloud();
    busy = false;   // 确保队列不会因中断卡死
  }
  function speaking() { return busy || Q.length > 0; }

  App.Speech = {
    stop: stopAll,
    speaking: speaking,
    diag: diag,
    selfTest: selfTest,
    useLocal: useLocal,
    useCloud: useCloud,
    hasZhVoice: hasZhVoice,
    defaultZhMissing: defaultZhMissing,
    defaultZhName: function () { return ZH_DEFAULT[0]; },
    speak: speak,
    estimate: estimate,
    cps: function () { return { zh: CPS.zh, en: CPS.en }; },
    speakLocal: speakLocal,
    speakEn: speakEn,
    speakEnLocal: speakEnLocal,
    speakPinyin: speakPinyin, pyText: pyText,
    seq: seq,
    autoRead: autoRead,
    flushAll: flushAll,
    pickVoice: pickVoice,
    listVoices: listVoices,
    setVoice: setVoice,
    demoVoice: demoVoice,
    cloudVoices: cloudVoices,
    currentCloud: currentCloud,
    setCloudVoice: setCloudVoice,
    demoCloud: demoCloud,
    playCloud: playCloud,
    stopCloud: stopCloud,
    styleVoices: styleVoices,
    currentStyle: currentStyle,
    setStyleVoice: setStyleVoice,
    demoStyle: demoStyle,
    sfx: sfx
  };
})(window);
