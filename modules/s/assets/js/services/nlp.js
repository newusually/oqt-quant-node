/*
 * nlp.js — 服务层 / 中文自然语言处理（纯 JS，离线可用）
 * 能力：正向最大匹配分词、汉字注音（多音字按词校正 + 一/不变调）、按词拼读。
 * 数据：assets/js/data/hanzi.js（3799 常用字 + 全量读音）、assets/js/data/words.js（2 万常用词）。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var HZ = App.HZ, WORDS = App.WORDS;
  var CJK = /[\u4e00-\u9fff]/;
  var MAXW = 4;

  /* ---------- 常见多音词校正（词 → 每字读音，覆盖一年级课文与高频词） ---------- */
  var PY_FIX = {
    "银行": ["yín", "háng"], "长大": ["zhǎng", "dà"], "音乐": ["yīn", "yuè"], "快乐": ["kuài", "lè"],
    "重复": ["chóng", "fù"], "教室": ["jiào", "shì"], "睡觉": ["shuì", "jiào"], "首都": ["shǒu", "dū"],
    "得到": ["dé", "dào"], "爱好": ["ài", "hào"], "空白": ["kòng", "bái"], "少年": ["shào", "nián"],
    "头发": ["tóu", "fà"], "水分": ["shuǐ", "fèn"], "传记": ["zhuàn", "jì"], "上当": ["shàng", "dàng"],
    "答应": ["dā", "ying"], "还书": ["huán", "shū"], "一只": ["yì", "zhī"], "认为": ["rèn", "wéi"],
    "照相": ["zhào", "xiàng"], "高兴": ["gāo", "xìng"], "歌曲": ["gē", "qǔ"], "转动": ["zhuàn", "dòng"],
    "人参": ["rén", "shēn"], "差别": ["chā", "bié"], "种田": ["zhòng", "tián"], "数数": ["shǔ", "shù"],
    "放假": ["fàng", "jià"], "背包": ["bēi", "bāo"], "弹琴": ["tán", "qín"], "声调": ["shēng", "diào"],
    "扇风": ["shān", "fēng"], "更新": ["gēng", "xīn"], "重要": ["zhòng", "yào"], "花儿": ["huā", "ér"],
    "月亮": ["yuè", "liang"], "时候": ["shí", "hou"], "知道": ["zhī", "dao"], "朋友": ["péng", "you"],
    "蝴蝶": ["hú", "dié"], "蚂蚁": ["mǎ", "yǐ"], "蜘蛛": ["zhī", "zhū"], "鲤鱼": ["lǐ", "yú"]
  };
  // 轻声词尾（注音时不标调亦可，朗读时按轻声处理）
  var TONE4 = "àèìòùǜ";

  /* ---------- 分词：正向最大匹配 ---------- */
  function segment(text) {
    text = String(text || "");
    var out = [], i = 0, n = text.length, ch, len, hit, j;
    while (i < n) {
      ch = text.charAt(i);
      if (!CJK.test(ch)) {
        // 非汉字（标点/数字/英文）：连续同类字符为一段
        j = i;
        while (j < n && !CJK.test(text.charAt(j))) j++;
        out.push(text.slice(i, j));
        i = j;
        continue;
      }
      hit = null;
      for (len = MAXW; len >= 2; len--) {
        if (i + len > n) continue;
        var cand = text.substr(i, len);
        if (WORDS && WORDS.has(cand)) { hit = cand; break; }
      }
      if (!hit) hit = ch;
      out.push(hit);
      i += hit.length;
    }
    return out;
  }

  /* ---------- 注音：逐词定音 ---------- */
  function pinyinList(text) {
    var segs = segment(text), out = [], i, j, seg, ch, pys, fixed;
    for (i = 0; i < segs.length; i++) {
      seg = segs[i];
      if (!CJK.test(seg.charAt(0))) { out.push({ t: seg, py: "" }); continue; }
      fixed = PY_FIX[seg];
      for (j = 0; j < seg.length; j++) {
        ch = seg.charAt(j);
        if (fixed && fixed[j]) { out.push({ t: ch, py: fixed[j] }); continue; }
        out.push({ t: ch, py: HZ ? HZ.py(ch) : "" });
      }
    }
    // 一 / 不 变调
    for (i = 0; i < out.length; i++) {
      if (out[i].py === "yī" && i + 1 < out.length) {
        var nx = out[i + 1].py || "";
        if (TONE4.indexOf(nx.charAt(nx.length - 1)) >= 0) out[i].py = "yí";
      }
      if (out[i].py === "bù" && i + 1 < out.length) {
        var nx2 = out[i + 1].py || "";
        if (TONE4.indexOf(nx2.charAt(nx2.length - 1)) >= 0) out[i].py = "bú";
      }
    }
    return out;
  }

  /* ---------- 注音 HTML：<ruby>字<rt>pinyin</rt></ruby> ---------- */
  function annotate(text) {
    var list = pinyinList(text), out = "", i, it;
    for (i = 0; i < list.length; i++) {
      it = list[i];
      if (!it.py) { out += it.t; continue; }
      out += "<ruby>" + it.t + "<rt>" + it.py + "</rt></ruby>";
    }
    return out;
  }

  /* ---------- 拼读：按词断句后交给语音 ---------- */
  function readSmart(text, opt) {
    var plain = String(text || "").replace(/<[^>]+>/g, "");
    if (!plain.trim()) return;
    if (App.Speech) App.Speech.speak(plain, opt || { rate: 0.9 });
  }

  /* ---------- 组词：含指定字的常用词（频率降序，儿童词表优先） ---------- */
  var KID_WORDS = {
    "大": ["大人", "大山", "大小", "大门", "大海", "大雨", "大树", "大象", "大风", "大哥"],
    "水": ["水果", "河水", "开水", "水杯", "水车", "口水", "水彩"],
    "天": ["天空", "天气", "春天", "蓝天", "白天", "天上", "天地"],
    "人": ["大人", "人们", "人口", "好人", "人家", "工人"],
    "口": ["开口", "口水", "出口", "入口", "路口", "大口"],
    "手": ["手心", "手工", "拍手", "举手", "洗手", "双手", "大手"],
    "日": ["日出", "日子", "生日", "日光", "日记", "日月"],
    "月": ["月亮", "月儿", "月光", "日月", "十月"],
    "山": ["大山", "山上", "山水", "火山", "山羊", "山下"],
    "田": ["田地", "田野", "水田", "种田", "农田"],
    "火": ["火车", "大火", "火苗", "火光", "火山", "灯火"],
    "木": ["木头", "树木", "木马", "木耳", "木门", "积木"],
    "花": ["花朵", "花儿", "开花", "花生", "鲜花", "花草", "花园"],
    "草": ["小草", "草地", "花草", "青草", "草原"],
    "鸟": ["小鸟", "鸟儿", "飞鸟", "鸟蛋", "水鸟"],
    "虫": ["虫子", "小虫", "害虫", "昆虫", "虫牙"],
    "鱼": ["小鱼", "鱼儿", "金鱼", "钓鱼", "鱼片"],
    "马": ["小马", "马上", "木马", "马车", "河马", "马路"],
    "牛": ["小牛", "牛奶", "牛肉", "牛皮", "牛车"],
    "羊": ["小羊", "山羊", "羊毛", "羊群", "放羊"],
    "上": ["上学", "上山", "天上", "早上", "上面", "上课"],
    "下": ["下雨", "下山", "山下", "下面", "天下"],
    "云": ["白云", "云朵", "云彩", "乌云", "风云"],
    "雨": ["下雨", "雨水", "大雨", "小雨", "雨点", "雨伞"],
    "风": ["大风", "风雨", "风筝", "风车", "台风", "风向"],
    "电": ["电话", "电视", "电灯", "闪电", "发电"],
    "书": ["看书", "读书", "书本", "图书", "书包", "书法"],
    "笔": ["铅笔", "毛笔", "笔画", "笔尖", "水笔", "蜡笔"],
    "本": ["本子", "书本", "作业本", "课本", "本来"],
    "刀": ["刀子", "小刀", "铅笔刀", "刀片", "剪刀"],
    "心": ["开心", "小心", "中心", "心里", "心愿"],
    "头": ["木头", "头上", "开头", "回头", "大头"],
    "里": ["手里", "心里", "里头", "家里", "哪里"],
    "白": ["白云", "白天", "雪白", "明白", "白菜"],
    "红": ["红花", "火红", "红日", "红色", "口红"],
    "车": ["汽车", "火车", "马车", "水车", "风车", "上车", "下车"],
    "门": ["大门", "开门", "门口", "出门", "车门", "门牙"],
    "米": ["大米", "小米", "千米", "米饭", "米粒"],
    "果": ["水果", "苹果", "果子", "果实", "干果"],
    "树": ["大树", "树木", "树叶", "树皮", "树干", "植树"],
    "叶": ["树叶", "叶子", "叶片", "红叶", "落叶"],
    "衣": ["衣服", "衣裳", "大衣", "毛衣", "雨衣"],
    "生": ["生日", "学生", "生气", "出生", "花生", "生长"],
    "学": ["学生", "学校", "学习", "同学", "放学", "数学"],
    "校": ["学校", "校园", "校长", "校门", "校友"],
    "同": ["同学", "相同", "一同", "同意", "同伴"],
    "老": ["老师", "老人", "老家", "老虎", "老实"],
    "师": ["老师", "师父", "师生", "大师"],
    "朋": ["朋友", "亲朋"],
    "友": ["朋友", "友好", "好友", "友情"],
    "家": ["回家", "家人", "国家", "大家", "家长", "家庭"],
    "国": ["国家", "中国", "国旗", "国王", "爱国"],
    "中": ["中国", "中心", "中间", "中午", "中文"],
    "爱": ["爱心", "爱好", "可爱", "热爱", "喜爱", "友爱"]
  };
  function wordsWith(zi) {
    var out = [], i, wd, base = KID_WORDS[zi] || [];
    for (i = 0; i < base.length; i++) { if (out.indexOf(base[i]) < 0) out.push(base[i]); }
    if (WORDS) {
      for (i = 0; i < WORDS.list.length && out.length < 10; i++) {
        wd = WORDS.list[i];
        if (wd.length === 2 && (wd.charAt(0) === zi || wd.charAt(1) === zi) && out.indexOf(wd) < 0) out.push(wd);
      }
    }
    return out.slice(0, 10);
  }

  App.NLP = {
    segment: segment,
    pinyinList: pinyinList,
    annotate: annotate,
    readSmart: readSmart,
    wordsWith: wordsWith,
    PY_FIX: PY_FIX,
    KID_WORDS: KID_WORDS
  };
})(window);
