/*
 * video-class-view.js — 视图层 / 视频课堂（2026-10-28 新增）
 * 用户诉求: 「参考哔哩哔哩多种学习教材」「直接播放里面的教学视频」
 *
 * 实现说明（重要）:
 *   播放走的是 **哔哩哔哩官方站外播放器** https://player.bilibili.com/player.html?bvid=xxx
 *   —— 官方支持 iframe 嵌入、不需要密钥、稳定合规。
 *   搜索走自己服务器的 /api/study/bili-search 代理（B站搜索接口要 wbi 签名 + 有跨域限制，
 *   浏览器直连拿不到结果）。
 *   不做「视频地址解码器」: 直链随时变、违反平台条款, 且会被风控封 IP。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});

  var SUBJECTS = [
    { id: "math", i: "🧮", t: "数学", d: "加减乘除·应用题" },
    { id: "chinese", i: "📖", t: "语文", d: "课文·识字" },
    { id: "english", i: "🔤", t: "英语", d: "单词·启蒙" },
    { id: "pinyin", i: "🔡", t: "拼音", d: "声母韵母" },
    { id: "olympic", i: "🏆", t: "奥数", d: "思维训练" },
    { id: "writing", i: "✍️", t: "看图写话", d: "作文起步" }
  ];

  function fmtDur(d) {
    var p = String(d || "").split(":");
    if (p.length !== 2) return d || "";
    var m = parseInt(p[0], 10), s = parseInt(p[1], 10);
    if (isNaN(m) || isNaN(s)) return d || "";
    if (m >= 60) return Math.floor(m / 60) + "小时" + (m % 60) + "分";
    return m + "分" + s + "秒";
  }
  function fmtPlay(n) {
    n = parseInt(n, 10) || 0;
    return n >= 10000 ? (n / 10000).toFixed(1) + "万" : String(n);
  }

  App.views = App.views || {};
  App.views.videoclass = {
    template: [
      '<site-shell title="视频课堂" sub="搜哔哩哔哩教学视频 · 官方播放器直接看" icon="🎬">',
      /* 科目快捷入口 */
      '<div class="vc-chips">',
      '<button v-for="s in subjects" :key="s.id" class="vc-chip" :class="{on: curSubject===s.id}" @click="pickSubject(s)">',
      '<span class="vc-chip-i">{{s.i}}</span><span class="vc-chip-t">{{s.t}}</span>',
      '</button>',
      '</div>',
      /* 搜索条 */
      '<div class="vc-search">',
      '<input v-model="kw" @keydown.enter="doSearch" type="search" placeholder="想学什么？比如：一年级 数学 加法" autocomplete="off">',
      '<button class="btn bigbtn" @click="doSearch" :disabled="loading">{{loading ? "搜索中…" : "🔍 搜视频"}}</button>',
      '</div>',
      /* 状态提示 */
      '<div class="vc-note" v-if="err">😢 {{err}} <button class="btn" @click="doSearch">重试</button></div>',
      '<div class="vc-note" v-if="!loading && !err && searched && !list.length">没搜到相关视频，换个词试试～</div>',
      '<div class="vc-note vc-loading" v-if="loading">📡 正在从哔哩哔哩找教学视频…</div>',
      /* 结果网格 */
      '<div class="vc-grid" v-if="list.length">',
      '<div class="vc-card" v-for="v in list" :key="v.bvid" @click="play(v)">',
      '<div class="vc-thumb"><img :src="picUrl(v.pic)" :alt="v.title" loading="lazy" referrerpolicy="no-referrer">',
      '<span class="vc-play">▶</span><span class="vc-dur">{{fmtDur(v.duration)}}</span></div>',
      '<div class="vc-meta">',
      '<div class="vc-title">{{v.title}}</div>',
      '<div class="vc-sub">UP主 {{v.author}} · {{fmtPlay(v.play)}}次播放</div>',
      '</div>',
      '</div>',
      '</div>',
      /* 播放器弹窗 */
      '<div class="vc-modal" v-if="cur" @click.self="close">',
      '<div class="vc-player">',
      '<div class="vc-phead">',
      '<span class="vc-ptitle">▶ {{cur.title}}</span>',
      '<button class="vc-x" @click="close">✕</button>',
      '</div>',
      '<div class="vc-frame">',
      '<iframe :src="playUrl(cur.bvid)" scrolling="no" frameborder="0" framespacing="0" allowfullscreen="true"',
      ' sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"></iframe>',
      '</div>',
      '<div class="vc-pfoot">',
      '<span class="vc-up">UP主：{{cur.author}}</span>',
      '<a class="btn" :href="openUrl(cur.bvid)" target="_blank" rel="noopener">🌐 在哔哩哔哩打开</a>',
      '</div>',
      '</div>',
      '</div>',
      '<style>',
      '.vc-chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px;}',
      '.vc-chip{display:flex;align-items:center;gap:5px;padding:8px 14px;border:2px solid #e0e6ed;border-radius:999px;',
      'background:#fff;color:#37474f;font-size:14px;font-weight:700;cursor:pointer;transition:all .15s;}',
      '.vc-chip:hover{border-color:#90caf9;background:#f7fbff;}',
      '.vc-chip.on{border-color:#42a5f5;background:linear-gradient(135deg,#e3f2fd,#f3e5f5);color:#1565c0;}',
      '.vc-chip-i{font-size:17px;}',
      '.vc-search{display:flex;gap:8px;margin-bottom:12px;}',
      '.vc-search input{flex:1;padding:11px 14px;font-size:15px;border:2px solid #e0e6ed;border-radius:12px;outline:none;}',
      '.vc-search input:focus{border-color:#42a5f5;}',
      '.vc-note{padding:12px 16px;background:#fff8e1;border-radius:12px;color:#795548;font-size:14px;margin-bottom:10px;}',
      '.vc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:14px;}',
      '.vc-card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 3px 10px rgba(0,0,0,.08);cursor:pointer;',
      'transition:transform .16s,box-shadow .16s;border:1px solid #f0f0f0;}',
      '.vc-card:hover{transform:translateY(-3px);box-shadow:0 8px 20px rgba(0,0,0,.14);}',
      '.vc-thumb{position:relative;width:100%;padding-top:56.3%;background:#263238;overflow:hidden;}',
      '.vc-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}',
      '.vc-play{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:44px;height:44px;border-radius:50%;',
      'background:rgba(0,0,0,.55);color:#fff;display:flex;align-items:center;justify-content:center;font-size:19px;}',
      '.vc-dur{position:absolute;right:7px;bottom:7px;background:rgba(0,0,0,.72);color:#fff;font-size:11.5px;padding:2px 7px;border-radius:5px;}',
      '.vc-meta{padding:9px 11px;}',
      '.vc-title{font-size:13.5px;font-weight:700;color:#263238;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;',
      '-webkit-box-orient:vertical;overflow:hidden;min-height:39px;}',
      '.vc-sub{font-size:11.5px;color:#78909c;margin-top:5px;}',
      '.vc-modal{position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:100000;display:flex;align-items:center;justify-content:center;padding:14px;}',
      '.vc-player{width:100%;max-width:900px;background:#fff;border-radius:14px;overflow:hidden;}',
      '.vc-phead{display:flex;justify-content:space-between;align-items:center;padding:11px 14px;background:#f5f7fa;border-bottom:1px solid #eceff1;}',
      '.vc-ptitle{font-size:14px;font-weight:700;color:#263238;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:88%;}',
      '.vc-x{background:none;border:0;font-size:19px;cursor:pointer;color:#607d8b;padding:0 4px;}',
      '.vc-frame{position:relative;width:100%;padding-top:56.3%;background:#000;}',
      '.vc-frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0;}',
      '.vc-pfoot{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;gap:10px;flex-wrap:wrap;}',
      '.vc-up{font-size:12.5px;color:#607d8b;}',
      '@media (max-width:520px){.vc-grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;}',
      '.vc-search{flex-wrap:wrap;}.vc-search input{flex:1 1 100%;}}',
      '</style>',
      '</site-shell>'
    ].join(""),
    data: function () {
      return {
        subjects: SUBJECTS,
        kw: "", curSubject: "", curPresetKw: "",
        list: [], loading: false, err: "", searched: false, cur: null
      };
    },
    mounted: function () {
      this.pickSubject(SUBJECTS[0]);   // 进来先看数学
    },
    methods: {
      fmtDur: fmtDur,
      fmtPlay: fmtPlay,
      picUrl: function (u) {
        /* B站封面可能有防盗链, 统一走 https + 不送 referer */
        if (!u) return "";
        return String(u).replace(/^http:/, "https:");
      },
      playUrl: function (bvid) {
        /* ★哔哩哔哩官方站外播放器: 不需要密钥, 稳定可用 */
        return "https://player.bilibili.com/player.html?bvid=" + bvid +
          "&high_quality=1&danmaku=0&autoplay=0";
      },
      openUrl: function (bvid) { return "https://www.bilibili.com/video/" + bvid; },
      pickSubject: function (s) {
        this.curSubject = s.id;
        this.curPresetKw = s.t;
        this.kw = "";
        this.doSearch();
      },
      /* 取 JSON：优先 fetch，老内核降级到 XHR（QQ/微信 X5 内核也要能跑） */
      jsonGet: function (url, cb) {
        if (w.fetch) {
          w.fetch(url).then(function (r) { return r.json(); })
            .then(function (d) { cb(d, null); })
            .catch(function (e) { cb(null, e); });
          return;
        }
        var x = new XMLHttpRequest();
        x.open("GET", url, true);
        x.onreadystatechange = function () {
          if (x.readyState !== 4) return;
          if (x.status === 200) {
            try { cb(JSON.parse(x.responseText), null); }
            catch (e) { cb(null, "返回内容解析失败"); }
          } else cb(null, "HTTP " + x.status);
        };
        x.onerror = function () { cb(null, "网络错误"); };
        x.send();
      },
      doSearch: function () {
        var self = this;
        this.loading = true; this.err = ""; this.searched = false;
        var url = "/api/study/bili-search?subject=" + encodeURIComponent(this.curSubject || "math") +
          (this.kw ? "&kw=" + encodeURIComponent(this.kw) : "");
        this.jsonGet(url, function (d, e) {
          self.loading = false; self.searched = true;
          if (e) { self.list = []; self.err = "网络好像有点问题：" + String(e); return; }
          if (d && d.ok) { self.list = d.list || []; }
          else {
            self.list = [];
            self.err = (d && d.err) ? ("搜索失败：" + d.err) : "暂时搜不到，稍后再试试。";
          }
        });
      },
      play: function (v) { this.cur = v; },
      close: function () { this.cur = null; }
    }
  };
})(window);
