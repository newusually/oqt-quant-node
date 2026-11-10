/*
 * data-engine.js — 服务层 / 数据引擎（统一调用 assets/js/data/** 的 JSON 数据文件）
 * 原则：数据全在 data/ 目录的纯 JSON 文件里（分文件、分科目、分页），这里只提供调用接口。
 * 能力：注册表 / 分类分页读取 / 关键词搜索 / 汉字词语表翻页 / 统计。
 * 优化：扁平结果缓存、搜索索引懒建、排序数字用整数比较，不反复 split。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});
  var cache = {};        // "cat|id" -> 扁平化后的全部条目
  var indexCache = {};   // "cat|id" -> 小写搜索索引

  /* 注册表：自动收集 App.DATA 下所有学科的数据集 */
  function registry() {
    var out = [], cats = ["math", "english", "dict", "chinese"], ci, id;
    for (ci = 0; ci < cats.length; ci++) {
      var cat = App.DATA && App.DATA[cats[ci]];
      if (!cat) continue;
      for (id in cat) {
        if (!cat.hasOwnProperty(id) || !cat[id] || !cat[id].pages) continue;
        out.push({ cat: cats[ci], id: id, name: (cat[id].meta && cat[id].meta.name) || id, icon: (cat[id].meta && cat[id].meta.icon) || "📦", pages: cat[id].pages.length });
      }
    }
    return out;
  }

  function get(cat, id) {
    return (App.DATA && App.DATA[cat] && App.DATA[cat][id]) || null;
  }

  /* 分页读取：pageNo 从 1 开始 */
  function page(cat, id, pageNo) {
    var ds = get(cat, id);
    if (!ds) return null;
    var total = ds.pages.length;
    var no = Math.max(1, Math.min(total, parseInt(pageNo, 10) || 1));
    var p = ds.pages[no - 1];
    return {
      cat: cat, id: id, meta: ds.meta,
      no: no, total: total,
      page: p, items: p.items || [],
      hasPrev: no > 1, hasNext: no < total
    };
  }
  function pageTitles(cat, id) {
    var ds = get(cat, id);
    if (!ds) return [];
    return ds.pages.map(function (p) { return p.title; });
  }

  /* 扁平化全部条目（带缓存） */
  function flatten(cat, id) {
    var key = cat + "|" + id;
    if (cache[key]) return cache[key];
    var ds = get(cat, id), out = [];
    if (ds) {
      ds.pages.forEach(function (p) {
        (p.items || []).forEach(function (it) { out.push({ page: p.title, item: it }); });
      });
    }
    cache[key] = out;
    return out;
  }
  function count(cat, id) { return flatten(cat, id).length; }

  /* 搜索：中英文都能搜（索引懒建），完全匹配排在前面 */
  function search(cat, id, kw) {
    kw = String(kw || "").trim().toLowerCase();
    if (!kw) return [];
    var key = cat + "|" + id;
    var all = flatten(cat, id);
    if (!indexCache[key]) {
      indexCache[key] = all.map(function (r) {
        return JSON.stringify(r.item).toLowerCase();
      });
    }
    var idx = indexCache[key], out = [], i, r;
    for (i = 0; i < idx.length; i++) {
      if (idx[i].indexOf(kw) >= 0) out.push(all[i]);
    }
    out.sort(function (a, b) {
      var ea = String((a.item.w || a.item.en || a.item.t || "")).toLowerCase() === kw ? 0 : 1;
      var eb = String((b.item.w || b.item.en || b.item.t || "")).toLowerCase() === kw ? 0 : 1;
      return ea - eb;
    });
    return out;
  }

  /* 语文数据翻页（常用字 / 词语， App.HZ + App.WORDS） */
  function hanziPage(no, size) {
    size = size || 100;
    var chars = (App.HZ && App.HZ.commonChars && App.HZ.commonChars()) || [];
    var total = Math.max(1, Math.ceil(chars.length / size));
    no = Math.max(1, Math.min(total, parseInt(no, 10) || 1));
    var slice = chars.slice((no - 1) * size, no * size);
    return {
      no: no, total: total, size: size,
      items: slice.map(function (ch) { return { ch: ch, py: App.HZ.py(ch), all: App.HZ.all(ch) }; }),
      hasPrev: no > 1, hasNext: no < total
    };
  }
  function wordPage(no, size) {
    size = size || 100;
    var list = (App.WORDS && App.WORDS.list) || [];
    var total = Math.max(1, Math.ceil(list.length / size));
    no = Math.max(1, Math.min(total, parseInt(no, 10) || 1));
    return {
      no: no, total: total, size: size,
      items: list.slice((no - 1) * size, no * size).map(function (wd) { return { wd: wd }; }),
      hasPrev: no > 1, hasNext: no < total
    };
  }

  function stats() {
    var reg = registry(), out = [], i;
    for (i = 0; i < reg.length; i++) {
      out.push({ name: reg[i].name, cat: reg[i].cat, id: reg[i].id, items: count(reg[i].cat, reg[i].id), pages: reg[i].pages });
    }
    return {
      sets: out,
      hanzi: (App.HZ && App.HZ.size && App.HZ.size()) || 0,
      words: (App.WORDS && App.WORDS.list && App.WORDS.list.length) || 0,
      totalItems: out.reduce(function (s, r) { return s + r.items; }, 0)
    };
  }

  App.Data = {
    registry: registry,
    get: get,
    page: page,
    pageTitles: pageTitles,
    flatten: flatten,
    count: count,
    search: search,
    hanziPage: hanziPage,
    wordPage: wordPage,
    stats: stats
  };
})(window);
