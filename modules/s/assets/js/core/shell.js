/*
 * shell.js — 基础层 / 全站外壳组件（Vue）
 * 顶栏 + 导航 + 页标题 + 页脚 + 星星/徽章 + 自动朗读总开关。
 * 所有页面层视图都包在 <site-shell> 里，HTML 只留 <div id="app" data-view="xxx">。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  if (!w.Vue) return;

  function cur() {
    var p = (w.location && w.location.pathname) ? w.location.pathname.split("/").pop() : "";
    return p || "主页.html";
  }

  App.Shell = {
    name: "site-shell",
    props: {
      title: { type: String, default: "" },
      sub: { type: String, default: "" },
      icon: { type: String, default: "📗" }
    },
    data: function () {
      return {
        site: (App.config && App.config.title) || "一年级趣味学习乐园",
        nav: (App.config && App.config.nav) || [],
        cur: cur(),
        st: App.Store.state,
        showBadges: false,
        showVoices: false,
        voices: [],
        clouds: (App.Speech && App.Speech.cloudVoices) ? App.Speech.cloudVoices() : [],
        styles: (App.Speech && App.Speech.styleVoices) ? App.Speech.styleVoices() : [],
        vLoading: true,
        vTry: 0,
        // 默认嗓音（台湾 HsiaoChen）这台设备装没装
        missDefault: false,
        defName: (App.Speech && App.Speech.defaultZhName) ? App.Speech.defaultZhName() : "",
        showWhy: false,
        // 声音自检：现在到底能不能出声、走的是本机还是联网
        diagTxt: "还没检测",
        diagUsing: "本机",
        testing: false,
        // 暂存草稿：点试听只改这里，点「保存」才写进 Store（全站生效）
        draft: { zh: "", en: "", cloud: "", style: "" }
      };
    },
    computed: {
      myBadges: function () {
        var out = [], i, b;
        for (i = 0; i < App.Store.BADGES.length; i++) {
          b = App.Store.BADGES[i];
          out.push({ id: b.id, i: b.i, n: b.n, d: b.d, got: this.st.badges.indexOf(b.id) >= 0 });
        }
        return out;
      },
      zhVoices: function () { return this.voices.filter(function (v) { return v.kind === "zh"; }); },
      enVoices: function () { return this.voices.filter(function (v) { return v.kind === "en"; }); },
      curZh: function () { return this.draft.zh || ""; },
      curEn: function () { return this.draft.en || ""; },
      curCloud: function () { return this.draft.cloud || ""; },
      curStyle: function () { return this.draft.style || ""; },
      // 草稿和已保存的不一样 = 还没保存
      vDirty: function () {
        return this.curZh !== (this.st.voiceZh || "")
          || this.curEn !== (this.st.voiceEn || "")
          || this.curCloud !== (this.st.voiceCloud || "")
          || this.curStyle !== (this.st.voiceStyle || "");
      },
      zhOnline: function () { return this.voices.filter(function (v) { return v.kind === "zh" && v.online; }); },
      zhLocal: function () { return this.voices.filter(function (v) { return v.kind === "zh" && !v.online; }); }
    },
    methods: {
      // ★2026-10-24: 自动朗读常开 —— 保留方法但强制为 true，界面已无开关按钮
      toggleRead: function () {
        var on = App.Store.toggleAutoRead();
        if (App.Speech) App.Speech.speak("自动朗读一直开着哦");
        return on;
      },
      goHome: function () { w.location.href = "主页.html"; },
      // ★2026-10-24 用户要求「学习乐园没有返回主页的按钮也没有okx a股等选项卡」→ 回量化主站
      goMain: function () { w.location.href = "/web/index.html"; },
      goRank: function () { w.location.href = "/web/rank.html"; },
      openVoices: function () {
        this.showVoices = true;
        this.showBadges = false;
        this.syncDraft();
        this.refreshVoices();
        this.refreshDiag();
      },
      // 🩺 声音自检：把「现在能不能出声、走的哪条通道」显示出来（★纯联网）
      refreshDiag: function () {
        var d = (App.Speech && App.Speech.diag) ? App.Speech.diag() : null;
        if (!d) { this.diagTxt = "全程联网发音（已停用本机语音与本地录音）"; this.diagUsing = "云端"; return; }
        this.diagUsing = "云端";
        this.diagTxt = d.note;
      },
      selfTestSnd: function () {
        var self = this;
        this.testing = true;
        if (App.Speech && App.Speech.selfTest) {
          App.Speech.selfTest(function () { self.testing = false; self.refreshDiag(); });
        } else { this.testing = false; }
      },
      // ★纯联网: 统一走谷歌普通话（整句都能念）
      forceCloudSnd: function () {
        this.draft.cloud = "g-zh";
        if (App.Speech) App.Speech.demoCloud("g-zh");
        this.refreshDiag();
      },
      forceLocalSnd: function () {
        this.draft.cloud = "g-zh";
        this.refreshDiag();
      },
      // 打开面板/取消时，把草稿同步回「已保存」的状态
      syncDraft: function () {
        this.draft = {
          zh: this.st.voiceZh || "",
          en: this.st.voiceEn || "",
          cloud: this.st.voiceCloud || "",
          style: this.st.voiceStyle || ""
        };
      },
      refreshVoices: function () {
        var self = this;
        if (App.Speech) {
          // 主动触发一次语音列表加载（Edge 在线语音靠它异步返回）
          try { if (w.speechSynthesis) w.speechSynthesis.getVoices(); } catch (e0) {}
          App.Speech.pickVoice();
        }
        this.voices = (App.Speech && App.Speech.listVoices) ? App.Speech.listVoices() : [];
        this.clouds = (App.Speech && App.Speech.cloudVoices) ? App.Speech.cloudVoices() : [];
        this.styles = (App.Speech && App.Speech.styleVoices) ? App.Speech.styleVoices() : [];
        this.vLoading = !this.voices.length;
        if (App.Speech && App.Speech.defaultZhMissing) {
          try { this.missDefault = App.Speech.defaultZhMissing(); } catch (e2) {}
        }
        // Edge 在线人声异步返回慢：轮询最多约 20 秒
        if (this.vLoading && this.vTry < 40) {
          this.vTry++;
          setTimeout(function () { if (self.showVoices) self.refreshVoices(); }, 500);
        }
      },
      // 本机没有台湾嗓音时：一键改用「云端台湾国语」（真的从网络拉，不依赖系统语音包）
      useCloudTW: function () {
        this.draft.cloud = "g-tw";
        if (App.Speech) App.Speech.demoCloud("g-tw");
      },
      // 注意：以下"选择/试听"都只改草稿并试听，不写入 Store；要点「保存」才全站生效
      pickV: function (v) {
        if (v.kind === "en") this.draft.en = v.name; else this.draft.zh = v.name;
        if (App.Speech) App.Speech.demoVoice(v.name, v.kind, { styleId: this.draft.style });
      },
      // 模板里不能直接写 App.Speech（作用域未定义会报错），一律走方法
      tryVoice: function (v) {
        if (v.kind === "en") this.draft.en = v.name; else this.draft.zh = v.name;
        if (App.Speech) App.Speech.demoVoice(v.name, v.kind, { styleId: this.draft.style });
      },
      // 云端嗓音：选中即试听；保存后读题/拼音/英语全部走云端，联网失败自动回退本机
      pickCloud: function (v) {
        this.draft.cloud = v.id;
        if (App.Speech) App.Speech.demoCloud(v.id);
      },
      tryCloud: function (v) {
        this.draft.cloud = v.id;
        if (App.Speech) App.Speech.demoCloud(v.id);
      },
      useLocal: function () {
        this.draft.cloud = "";
        if (App.Speech) App.Speech.speak("已换回本机声音，记得点保存");
      },
      // 本机变声风格：同一嗓音多种音色，离线可用
      pickStyle: function (s) {
        this.draft.style = s.id;
        if (App.Speech) App.Speech.demoStyle(s.id);
      },
      tryStyle: function (s) {
        this.draft.style = s.id;
        if (App.Speech) App.Speech.demoStyle(s.id);
      },
      clearStyle: function () {
        this.draft.style = "";
        if (App.Speech) App.Speech.speak("已恢复原声，记得点保存");
      },
      resetV: function () {
        this.draft = { zh: "", en: "", cloud: "", style: "" };
        if (App.Store) App.Store.setVoicePinned(false);   // 取消手动选择 → 回到默认（HsiaoChen 台湾）
        if (App.Speech) App.Speech.speak("已恢复默认声音，记得点保存");
        this.refreshVoices();
      },
      // 💾 保存：写进 Store（localStorage）→ 本站所有页面朗读都用这套声音
      saveV: function () {
        if (App.Speech) {
          App.Speech.setVoice(this.draft.zh, "zh");
          App.Speech.setVoice(this.draft.en, "en");
          App.Speech.setCloudVoice(this.draft.cloud);
          App.Speech.setStyleVoice(this.draft.style);
          App.Speech.stop();
          App.Speech.speak("声音已保存，全部页面都用这个声音啦");
        }
        if (App.Store) App.Store.setVoicePinned(true);    // 用户手动选过 → 严格保留他的选择
        this.showVoices = false;
      },
      cancelV: function () {
        if (App.Speech) App.Speech.stop();
        this.syncDraft();
        this.showVoices = false;
      }
    },
    template: [
      '<div class="wrap">',
      '<div class="topbar">',
      '<div class="brand" @click="goHome"><span class="emj">🎒</span>{{site}}</div>',
      '<div class="tb-right">',
      // ★2026-10-24: 返回量化行情主站按钮（用户要求「没有返回主页的按钮」）
      '<button class="btn tb-home" @click="goMain" title="返回 oqt 量化行情主站(总览)">🏠 返回主站</button>',
      '<span class="tb-star" title="学习星星">⭐ {{st.stars}}</span>',
      '<span class="tb-badges" @click="showBadges=!showBadges" title="我的徽章">',
      '<em v-for="b in myBadges" :key="b.id" :class="{off:!b.got}">{{b.got ? b.i : "▫️"}}</em>',
      '</span>',
      // ★2026-10-24: 自动朗读【常开、不可关闭】—— 按用户要求删掉开关按钮
      '<span class="tb-spk-on" title="本站内容会自动朗读">🔊 自动朗读</span>',
      '<button class="btn spk" @click="openVoices" title="选择朗读声音">🎙️ 声音</button>',
      '</div>',
      '</div>',
      '<div class="voice-pop" v-if="showVoices">',
      '<div class="vp-title">🎙️ 选择朗读声音 <span class="vp-close" @click="cancelV">✕</span></div>',
      '<div class="vp-note">🔔 点名字/▶试听只是<b>预览</b>，选好后点最下面的 <b>💾 保存</b>，本站每个页面都会用这个声音。</div>',
      '<div class="vp-diag">',
      '<div class="vp-diag-t">🩺 {{diagTxt}}</div>',
      '<div class="vp-diag-b">',
      '<button class="btn" @click="selfTestSnd">{{testing ? "🔊 正在念测试句…" : "🔧 念一句测试"}}</button>',
      '<button class="btn ghost" @click="forceCloudSnd">🌐 用谷歌普通话</button>',
      '</div>',
      '<div class="vp-diag-d">★全程<b>联网发音</b>（已停用本机语音与本地录音）。联网发音要能连上外网，并且先用鼠标点一下页面（浏览器规定）。</div>',
      '</div>',
      '<div class="vp-sub">☁️ 云端嗓音（联网，全程使用）</div>',
      '<div class="vlist">',
      '<div class="vitem cloud" v-for="v in clouds" :key="\'c\'+v.id" :class="{on: curCloud === v.id}" @click="pickCloud(v)">',
      '<span class="vradio">{{curCloud === v.id ? "🔘" : "⚪"}}</span>',
      '<span class="vlabel">{{v.name}}</span>',
      '<span class="vlang">{{v.tag}}</span>',
      '<button class="vtry" @click.stop="tryCloud(v)">▶ 试听</button>',
      '</div>',
      '</div>',
      '<div class="vp-sub">👤 本机人声（已停用，仅供参考）</div>',
      '<div class="vlist">',
      '<div class="vitem" v-for="v in enVoices" :key="\'e\'+v.name" :class="{on: curEn === v.name}" @click="pickV(v)">',
      '<span class="vradio">{{curEn === v.name ? "🔘" : "⚪"}}</span>',
      '<span class="vlabel">{{v.label}}</span>',
      '<span class="vlang">{{v.lang}}</span>',
      '<button class="vtry" @click.stop="tryVoice(v)">▶ 试听</button>',
      '</div>',
      '</div>',
      '<div class="vp-empty" v-if="vLoading">正在获取这台设备的声音列表…（在线人声需要等几秒）</div>',
      '<div class="vp-foot" :class="{dirty: vDirty}">',
      '<button class="btn vsave" @click="saveV">💾 保存（全部页面生效）</button>',
      '<button class="btn" @click="resetV">↩️ 恢复默认</button>',
      '<button class="btn" @click="cancelV">✖ 取消</button>',
      '<span class="vp-tip" v-if="vDirty">⚠️ 已经改了但还没保存，点「💾 保存」才会生效</span>',
      '<span class="vp-tip" v-else>✅ 当前就是已保存的声音</span>',
      '</div>',
      '</div>',
      '<div class="badge-pop" v-if="showBadges">',
      '<div class="bp-title">🏅 我的徽章</div>',
      '<div class="bp-grid">',
      '<div class="bp-item" v-for="b in myBadges" :key="b.id" :class="{off:!b.got}">',
      '<span class="bp-i">{{b.i}}</span><span class="bp-n">{{b.n}}</span><span class="bp-d">{{b.d}}</span>',
      '</div>',
      '</div>',
      '</div>',
      // ★2026-10-24: 只保留「返回主页」按钮（用户要求: 按钮太多, 只要返回主页就够了）
      '<nav class="nav">',
      '<a v-for="n in nav" :key="n.h" :href="n.h" :class="{active: n.h === cur}"><span class="emj">{{n.i}}</span>{{n.t}}</a>',
      '</nav>',
      '<div class="page-title" v-if="title">{{icon}} {{title}}</div>',
      '<div class="page-sub" v-if="sub">{{sub}}</div>',
      '<slot></slot>',
      '<div class="footer">{{site}} · 语音 + 动画 + 随机出题 · 每天进步一点点</div>',
      '</div>'
    ].join("")
  };
})(window);
