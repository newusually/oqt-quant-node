/*
 * images.js — 业务层 / SVG 图库
 * 提供：小动物、植物、水果、日常物品等大量 SVG 图标。
 * 特点：纯内联 SVG，离线可用，兼容所有浏览器（含 X5 老内核）。
 * 用法：
 *   App.IMG.svg('cat')              -> '<svg ...>...</svg>' 字符串
 *   App.IMG.el('cat', 'em')        -> <span class="em"><svg.../></span> DOM
 *   App.IMG.pick('动物')            -> {id,name,cat,svg}
 *   App.IMG.byCat('动物')           -> [{...}]
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});

  // 每个条目：{id, name, cat, svg}
  var RAW = [
    /* ============ 动物 ============ */
    { id: "cat", name: "小猫", cat: "动物", svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="38" r="19" fill="#f6a04d"/><polygon points="15,22 13,6 30,19" fill="#f6a04d"/><polygon points="49,22 51,6 34,19" fill="#f6a04d"/><circle cx="25" cy="36" r="3" fill="#333"/><circle cx="39" cy="36" r="3" fill="#333"/><path d="M32 42 l-3 3 h6 z" fill="#e2607a"/><path d="M18 46 q14 7 28 0" stroke="#9c5a1e" stroke-width="1.5" fill="none"/></svg>' },
    { id: "dog", name: "小狗", cat: "动物", svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="38" r="18" fill="#c9925e"/><ellipse cx="13" cy="34" rx="7" ry="12" fill="#a9743f"/><ellipse cx="51" cy="34" rx="7" ry="12" fill="#a9743f"/><circle cx="26" cy="36" r="3" fill="#333"/><circle cx="38" cy="36" r="3" fill="#333"/><ellipse cx="32" cy="44" rx="4" ry="3" fill="#5a3a1e"/></svg>' },
    { id: "rabbit", name: "兔子", cat: "动物", svg: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="42" rx="16" ry="14" fill="#f3eef0"/><ellipse cx="24" cy="14" rx="5" ry="14" fill="#f3eef0"/><ellipse cx="40" cy="14" rx="5" ry="14" fill="#f3eef0"/><circle cx="26" cy="40" r="2.5" fill="#333"/><circle cx="38" cy="40" r="2.5" fill="#333"/><circle cx="32" cy="46" r="2.5" fill="#e2607a"/><circle cx="20" cy="18" r="3" fill="#ffb6c1" opacity=".7"/></svg>' },
    { id: "bear", name: "小熊", cat: "动物", svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="40" r="18" fill="#9c6b3f"/><circle cx="14" cy="20" r="7" fill="#9c6b3f"/><circle cx="50" cy="20" r="7" fill="#9c6b3f"/><circle cx="32" cy="40" r="11" fill="#c9986a"/><circle cx="26" cy="36" r="2.5" fill="#333"/><circle cx="38" cy="36" r="2.5" fill="#333"/><ellipse cx="32" cy="44" rx="3" ry="2" fill="#5a3a1e"/></svg>' },
    { id: "bird", name: "小鸟", cat: "动物", svg: '<svg viewBox="0 0 64 64"><circle cx="30" cy="36" r="15" fill="#5ec8e8"/><circle cx="40" cy="22" r="9" fill="#5ec8e8"/><circle cx="42" cy="20" r="2.5" fill="#333"/><polygon points="49,22 58,25 49,28" fill="#f5a623"/><path d="M16 40 q-6 4 -2 9" stroke="#3a9ec2" stroke-width="3" fill="none"/><path d="M22 50 q8 6 18 2" stroke="#3a9ec2" stroke-width="3" fill="none"/></svg>' },
    { id: "fish", name: "小鱼", cat: "动物", svg: '<svg viewBox="0 0 64 64"><path d="M8 32 q14 -16 34 0 q-14 16 -34 0z" fill="#ff9a76"/><polygon points="42,32 58,22 58,42" fill="#ff7a4d"/><circle cx="20" cy="28" r="2.5" fill="#333"/><path d="M16 32 q10 0 20 0" stroke="#e2607a" stroke-width="1.5" fill="none"/></svg>' },
    { id: "frog", name: "青蛙", cat: "动物", svg: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="42" rx="20" ry="16" fill="#7cc643"/><circle cx="20" cy="22" r="8" fill="#7cc643"/><circle cx="44" cy="22" r="8" fill="#7cc643"/><circle cx="20" cy="22" r="3" fill="#fff"/><circle cx="44" cy="22" r="3" fill="#fff"/><circle cx="20" cy="22" r="1.5" fill="#333"/><circle cx="44" cy="22" r="1.5" fill="#333"/><path d="M24 44 q8 6 16 0" stroke="#3f7a1e" stroke-width="2" fill="none"/></svg>' },
    { id: "duck", name: "鸭子", cat: "动物", svg: '<svg viewBox="0 0 64 64"><circle cx="28" cy="38" r="16" fill="#ffd84d"/><circle cx="42" cy="24" r="10" fill="#ffd84d"/><polygon points="50,24 62,27 50,30" fill="#f5862a"/><circle cx="44" cy="22" r="2.5" fill="#333"/></svg>' },
    { id: "pig", name: "小猪", cat: "动物", svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="38" r="18" fill="#f7a8c4"/><circle cx="16" cy="24" r="6" fill="#f48bb0"/><circle cx="48" cy="24" r="6" fill="#f48bb0"/><ellipse cx="32" cy="42" rx="9" ry="7" fill="#ef83a8"/><circle cx="32" cy="42" r="3" fill="#b3557e"/><circle cx="25" cy="34" r="2.5" fill="#333"/><circle cx="39" cy="34" r="2.5" fill="#333"/></svg>' },
    { id: "turtle", name: "乌龟", cat: "动物", svg: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="40" rx="20" ry="13" fill="#5aa469"/><path d="M14 40 a18 11 0 0 1 36 0z" fill="#3f8a52"/><circle cx="12" cy="36" r="6" fill="#5aa469"/><circle cx="12" cy="36" r="2" fill="#333"/><rect x="20" y="52" width="5" height="8" rx="2" fill="#3f8a52"/><rect x="39" y="52" width="5" height="8" rx="2" fill="#3f8a52"/></svg>' },
    { id: "butterfly", name: "蝴蝶", cat: "动物", svg: '<svg viewBox="0 0 64 64"><ellipse cx="22" cy="26" rx="13" ry="11" fill="#ff8ec2"/><ellipse cx="42" cy="26" rx="13" ry="11" fill="#ff8ec2"/><ellipse cx="24" cy="44" rx="10" ry="9" fill="#a98bf0"/><ellipse cx="40" cy="44" rx="10" ry="9" fill="#a98bf0"/><rect x="30" y="18" width="4" height="32" rx="2" fill="#5a3a1e"/></svg>' },
    { id: "bee", name: "蜜蜂", cat: "动物", svg: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="38" rx="14" ry="12" fill="#f5c542"/><rect x="20" y="32" width="24" height="5" fill="#333"/><rect x="20" y="42" width="24" height="5" fill="#333"/><circle cx="44" cy="26" r="8" fill="#fff" opacity=".85"/><circle cx="46" cy="24" r="2" fill="#333"/></svg>' },
    { id: "panda", name: "熊猫", cat: "动物", svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="38" r="18" fill="#fff"/><circle cx="14" cy="18" r="7" fill="#222"/><circle cx="50" cy="18" r="7" fill="#222"/><circle cx="25" cy="36" r="5" fill="#222"/><circle cx="39" cy="36" r="5" fill="#222"/><ellipse cx="32" cy="44" rx="3" ry="2" fill="#222"/><circle cx="23" cy="44" r="2" fill="#222"/><circle cx="41" cy="44" r="2" fill="#222"/></svg>' },
    { id: "monkey", name: "猴子", cat: "动物", svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="38" r="17" fill="#b07a47"/><circle cx="32" cy="40" r="11" fill="#e3c39a"/><circle cx="14" cy="20" r="7" fill="#b07a47"/><circle cx="50" cy="20" r="7" fill="#b07a47"/><circle cx="26" cy="36" r="2.5" fill="#333"/><circle cx="38" cy="36" r="2.5" fill="#333"/><path d="M28 44 q4 4 8 0" stroke="#5a3a1e" stroke-width="2" fill="none"/></svg>' },
    { id: "elephant", name: "大象", cat: "动物", svg: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="38" rx="19" ry="16" fill="#9fb4c7"/><circle cx="16" cy="22" r="7" fill="#9fb4c7"/><path d="M16 28 q-8 8 -2 18 q6 4 10 -2" stroke="#9fb4c7" stroke-width="6" fill="none"/><circle cx="26" cy="36" r="2.5" fill="#333"/><circle cx="38" cy="36" r="2.5" fill="#333"/></svg>' },
    { id: "chick", name: "小鸡", cat: "动物", svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="38" r="16" fill="#ffe14d"/><circle cx="32" cy="22" r="11" fill="#ffe14d"/><polygon points="30,18 34,18 32,12" fill="#f5862a"/><circle cx="28" cy="20" r="2" fill="#333"/><circle cx="36" cy="20" r="2" fill="#333"/><path d="M24 46 q8 5 16 0" stroke="#e0a800" stroke-width="2" fill="none"/></svg>' },
    { id: "cow", name: "奶牛", cat: "动物", svg: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="38" rx="20" ry="15" fill="#fff"/><g fill="#333"><ellipse cx="24" cy="32" rx="5" ry="4"/><ellipse cx="40" cy="42" rx="6" ry="4"/><ellipse cx="30" cy="46" rx="4" ry="3"/></g><circle cx="14" cy="22" r="6" fill="#fff"/><circle cx="50" cy="22" r="6" fill="#fff"/><path d="M12 18 l-3 -8 M16 18 l3 -8 M48 18 l-3 -8 M52 18 l3 -8" stroke="#fff" stroke-width="3"/><ellipse cx="32" cy="42" rx="9" ry="7" fill="#ffb6c1"/><circle cx="28" cy="41" r="1.6" fill="#333"/><circle cx="36" cy="41" r="1.6" fill="#333"/></svg>' },
    { id: "horse", name: "小马", cat: "动物", svg: '<svg viewBox="0 0 64 64"><ellipse cx="34" cy="40" rx="18" ry="12" fill="#b07a47"/><rect x="24" y="48" width="5" height="12" rx="2" fill="#8a5a2e"/><rect x="40" y="48" width="5" height="12" rx="2" fill="#8a5a2e"/><path d="M50 30 q10 -8 6 -18 q-2 8 -10 10z" fill="#b07a47"/><circle cx="56" cy="14" r="5" fill="#b07a47"/><circle cx="58" cy="13" r="1.4" fill="#333"/><path d="M18 40 q-8 -6 -2 -14 q6 6 8 8z" fill="#8a5a2e"/><path d="M30 26 q6 -8 14 -4" stroke="#5a3a1e" stroke-width="3" fill="none"/></svg>' },

    /* ============ 植物 ============ */
    { id: "flower", name: "花朵", cat: "植物", svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="26" r="7" fill="#ffd84d"/><g fill="#ff8ec2"><circle cx="32" cy="12" r="8"/><circle cx="46" cy="26" r="8"/><circle cx="32" cy="40" r="8"/><circle cx="18" cy="26" r="8"/></g><rect x="29" y="40" width="6" height="22" fill="#5aa469"/></svg>' },
    { id: "tree", name: "大树", cat: "植物", svg: '<svg viewBox="0 0 64 64"><rect x="28" y="40" width="8" height="22" fill="#9c6b3f"/><circle cx="32" cy="28" r="18" fill="#5aa469"/><circle cx="22" cy="32" r="11" fill="#69b87a"/><circle cx="42" cy="32" r="11" fill="#69b87a"/></svg>' },
    { id: "grass", name: "小草", cat: "植物", svg: '<svg viewBox="0 0 64 64"><rect x="0" y="50" width="64" height="14" fill="#7cc643"/><path d="M14 52 q-4 -16 0 -26 q5 10 0 26z" fill="#5aa469"/><path d="M32 52 q-4 -18 0 -30 q5 12 0 30z" fill="#69b87a"/><path d="M50 52 q-4 -16 0 -26 q5 10 0 26z" fill="#5aa469"/></svg>' },
    { id: "mushroom", name: "蘑菇", cat: "植物", svg: '<svg viewBox="0 0 64 64"><path d="M12 32 a20 18 0 0 1 40 0z" fill="#e8503a"/><circle cx="24" cy="24" r="4" fill="#fff"/><circle cx="40" cy="26" r="3" fill="#fff"/><rect x="27" y="32" width="10" height="20" rx="4" fill="#f3e7d0"/></svg>' },
    { id: "leaf", name: "树叶", cat: "植物", svg: '<svg viewBox="0 0 64 64"><path d="M14 50 q4 -34 36 -40 q-2 34 -36 40z" fill="#5aa469"/><path d="M18 46 q14 -14 28 -28" stroke="#3f8a52" stroke-width="2" fill="none"/></svg>' },
    { id: "sunflower", name: "向日葵", cat: "植物", svg: '<svg viewBox="0 0 64 64"><g fill="#f5a623"><circle cx="32" cy="26" r="9"/><circle cx="32" cy="9" r="6"/><circle cx="32" cy="43" r="6"/><circle cx="15" cy="26" r="6"/><circle cx="49" cy="26" r="6"/><circle cx="20" cy="14" r="5"/><circle cx="44" cy="14" r="5"/></g><circle cx="32" cy="26" r="10" fill="#6b4423"/><rect x="30" y="40" width="4" height="22" fill="#5aa469"/></svg>' },
    { id: "cactus", name: "仙人掌", cat: "植物", svg: '<svg viewBox="0 0 64 64"><rect x="28" y="20" width="10" height="42" rx="5" fill="#5aa469"/><rect x="16" y="30" width="8" height="18" rx="4" fill="#5aa469"/><rect x="40" y="28" width="8" height="16" rx="4" fill="#5aa469"/><rect x="0" y="58" width="64" height="6" fill="#c9925e"/></svg>' },

    /* ============ 水果 ============ */
    { id: "apple", name: "苹果", cat: "水果", svg: '<svg viewBox="0 0 64 64"><path d="M32 22 q-4 -8 -12 -6 q-6 8 4 16 q8 8 8 18 q0 -10 8 -18 q10 -8 4 -16 q-8 -2 -12 6z" fill="#e8503a"/><rect x="30" y="12" width="4" height="10" fill="#7a4a1e"/><circle cx="22" cy="34" r="2.5" fill="#ff9a8a" opacity=".6"/></svg>' },
    { id: "pear", name: "梨", cat: "水果", svg: '<svg viewBox="0 0 64 64"><path d="M32 18 q-3 -6 -8 -4 q-5 6 0 14 q-8 10 -3 22 q8 12 22 6 q12 -8 4 -22 q-6 -10 -3 -16 q-6 -2 -12 0z" fill="#cfe04a"/><rect x="30" y="10" width="4" height="9" fill="#7a4a1e"/></svg>' },
    { id: "banana", name: "香蕉", cat: "水果", svg: '<svg viewBox="0 0 64 64"><path d="M12 16 q6 30 38 36 q10 -2 6 -10 q-22 -6 -28 -28 q-6 -2 -16 2z" fill="#f5c542"/><path d="M14 16 q4 26 30 34" stroke="#e0a800" stroke-width="2" fill="none"/></svg>' },
    { id: "grape", name: "葡萄", cat: "水果", svg: '<svg viewBox="0 0 64 64"><g fill="#9b59b6"><circle cx="32" cy="24" r="7"/><circle cx="22" cy="32" r="7"/><circle cx="42" cy="32" r="7"/><circle cx="28" cy="42" r="7"/><circle cx="38" cy="42" r="7"/><circle cx="32" cy="52" r="7"/></g><rect x="30" y="12" width="4" height="10" fill="#5aa469"/></svg>' },
    { id: "strawberry", name: "草莓", cat: "水果", svg: '<svg viewBox="0 0 64 64"><path d="M32 22 q-14 6 -14 22 q14 12 28 0 q0 -16 -14 -22z" fill="#e8503a"/><g fill="#ffe14d"><circle cx="26" cy="36" r="1.6"/><circle cx="38" cy="34" r="1.6"/><circle cx="32" cy="44" r="1.6"/><circle cx="28" cy="48" r="1.6"/><circle cx="40" cy="46" r="1.6"/></g><path d="M22 22 l4 -6 l6 6 l6 -6 l4 6z" fill="#5aa469"/></svg>' },
    { id: "peach", name: "桃子", cat: "水果", svg: '<svg viewBox="0 0 64 64"><path d="M32 20 q-16 4 -14 22 q4 16 14 18 q10 -2 14 -18 q2 -18 -14 -22z" fill="#ffae9e"/><path d="M32 22 q0 18 0 36" stroke="#e8856f" stroke-width="2" fill="none"/><path d="M30 16 q2 -8 6 -2 q-4 2 -6 2z" fill="#5aa469"/></svg>' },
    { id: "watermelon", name: "西瓜", cat: "水果", svg: '<svg viewBox="0 0 64 64"><path d="M10 22 a30 30 0 0 0 44 0z" fill="#5aa469"/><path d="M14 22 a26 26 0 0 0 36 0z" fill="#e8503a"/><path d="M18 22 a22 22 0 0 0 28 0z" fill="#ffd1d1"/><g fill="#3f8a52"><circle cx="28" cy="20" r="1.5"/><circle cx="36" cy="22" r="1.5"/><circle cx="32" cy="16" r="1.5"/></g></svg>' },
    { id: "orange", name: "橘子", cat: "水果", svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="34" r="20" fill="#f5a623"/><circle cx="32" cy="34" r="20" fill="none" stroke="#e08900" stroke-width="2"/><rect x="30" y="10" width="4" height="8" fill="#5aa469"/><circle cx="25" cy="28" r="3" fill="#ffd08a" opacity=".6"/></svg>' },
    { id: "cherry", name: "樱桃", cat: "水果", svg: '<svg viewBox="0 0 64 64"><circle cx="24" cy="44" r="9" fill="#e8503a"/><circle cx="42" cy="46" r="9" fill="#e8503a"/><path d="M24 36 q8 -20 18 -24" stroke="#5aa469" stroke-width="3" fill="none"/><path d="M42 38 q-2 -12 -10 -18" stroke="#5aa469" stroke-width="3" fill="none"/></svg>' },

    /* ============ 日常物品 ============ */
    { id: "pencil", name: "铅笔", cat: "日常", svg: '<svg viewBox="0 0 64 64"><polygon points="14,54 26,42 46,22 52,28 32,48 20,60" fill="#f5c542"/><polygon points="14,54 20,60 10,58" fill="#333"/><polygon points="46,22 52,28 44,30" fill="#ff9a8a"/><rect x="28" y="40" width="20" height="6" transform="rotate(45 38 43)" fill="#5aa469"/></svg>' },
    { id: "book", name: "书本", cat: "日常", svg: '<svg viewBox="0 0 64 64"><rect x="12" y="16" width="40" height="34" rx="3" fill="#5b8def"/><rect x="12" y="16" width="20" height="34" rx="3" fill="#7ba3f5"/><path d="M32 16 v34" stroke="#fff" stroke-width="2"/><line x1="18" y1="26" x2="28" y2="26" stroke="#fff" stroke-width="2"/><line x1="38" y1="26" x2="48" y2="26" stroke="#fff" stroke-width="2"/></svg>' },
    { id: "star", name: "星星", cat: "日常", svg: '<svg viewBox="0 0 64 64"><polygon points="32,6 40,24 60,24 44,38 50,58 32,46 14,58 20,38 4,24 24,24" fill="#ffd84d" stroke="#f5c542" stroke-width="2"/></svg>' },
    { id: "balloon", name: "气球", cat: "日常", svg: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="24" rx="16" ry="20" fill="#ff8ec2"/><polygon points="28,42 36,42 32,48" fill="#ff8ec2"/><path d="M32 48 q4 8 0 14 q-4 -6 0 -14" stroke="#888" stroke-width="1.5" fill="none"/></svg>' },
    { id: "car", name: "小汽车", cat: "日常", svg: '<svg viewBox="0 0 64 64"><path d="M8 40 h48 v8 h-48z" fill="#ff6b6b"/><path d="M16 40 l6 -12 h20 l6 12z" fill="#ff9a9a"/><circle cx="20" cy="48" r="6" fill="#333"/><circle cx="44" cy="48" r="6" fill="#333"/><circle cx="20" cy="48" r="2.5" fill="#aaa"/><circle cx="44" cy="48" r="2.5" fill="#aaa"/></svg>' },
    { id: "heart", name: "爱心", cat: "日常", svg: '<svg viewBox="0 0 64 64"><path d="M32 54 q-20 -14 -20 -28 q0 -10 10 -10 q7 0 10 7 q3 -7 10 -7 q10 0 10 10 q0 14 -20 28z" fill="#ff5e8a"/></svg>' },
    { id: "gift", name: "礼物", cat: "日常", svg: '<svg viewBox="0 0 64 64"><rect x="14" y="28" width="36" height="26" fill="#5b8def"/><rect x="10" y="20" width="44" height="10" fill="#7ba3f5"/><rect x="28" y="20" width="8" height="34" fill="#ffd84d"/><path d="M32 20 q-12 -12 -4 -2 q4 -6 4 2z" fill="#ffd84d"/><path d="M32 20 q12 -12 4 -2 q-4 -6 -4 2z" fill="#ffd84d"/></svg>' },
    { id: "sun", name: "太阳", cat: "日常", svg: '<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="14" fill="#ffcf3f"/><g stroke="#ffcf3f" stroke-width="4"><line x1="32" y1="4" x2="32" y2="14"/><line x1="32" y1="50" x2="32" y2="60"/><line x1="4" y1="32" x2="14" y2="32"/><line x1="50" y1="32" x2="60" y2="32"/><line x1="12" y1="12" x2="20" y2="20"/><line x1="44" y1="44" x2="52" y2="52"/><line x1="52" y1="12" x2="44" y2="20"/><line x1="20" y1="44" x2="12" y2="52"/></g></svg>' },

    /* ============ 人物 ============ */
    { id: "kid", name: "小朋友", cat: "人物", svg: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="59" rx="15" ry="4" fill="#000" opacity=".08"/><rect x="25" y="44" width="6" height="12" rx="3" fill="#3f7a1e"/><rect x="33" y="44" width="6" height="12" rx="3" fill="#3f7a1e"/><rect x="23" y="55" width="10" height="4" rx="2" fill="#333"/><rect x="31" y="55" width="10" height="4" rx="2" fill="#333"/><rect x="21" y="30" width="22" height="17" rx="6" fill="#7cc643"/><rect x="12" y="32" width="8" height="15" rx="4" fill="#f6c9a0"/><rect x="44" y="32" width="8" height="15" rx="4" fill="#f6c9a0"/><circle cx="32" cy="21" r="13" fill="#f6c9a0"/><path d="M20 18 q0 -12 12 -12 q12 0 12 12 q-4 -7 -12 -7 q-8 0 -12 7z" fill="#5a3a1e"/><circle cx="27" cy="22" r="1.8" fill="#333"/><circle cx="37" cy="22" r="1.8" fill="#333"/><path d="M28 27 q4 4 8 0" stroke="#c66" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="23" cy="25" r="2" fill="#ff9aa2" opacity=".5"/><circle cx="41" cy="25" r="2" fill="#ff9aa2" opacity=".5"/></svg>' },
    { id: "boy", name: "小男孩", cat: "人物", svg: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="59" rx="15" ry="4" fill="#000" opacity=".08"/><rect x="25" y="44" width="6" height="12" rx="3" fill="#2f4f8f"/><rect x="33" y="44" width="6" height="12" rx="3" fill="#2f4f8f"/><rect x="23" y="55" width="10" height="4" rx="2" fill="#333"/><rect x="31" y="55" width="10" height="4" rx="2" fill="#333"/><rect x="21" y="30" width="22" height="17" rx="6" fill="#5b8def"/><rect x="12" y="32" width="8" height="15" rx="4" fill="#f6c9a0"/><rect x="44" y="32" width="8" height="15" rx="4" fill="#f6c9a0"/><circle cx="32" cy="21" r="13" fill="#f6c9a0"/><path d="M20 18 q0 -12 12 -12 q12 0 12 12 q-4 -7 -12 -7 q-8 0 -12 7z" fill="#3a2a18"/><circle cx="27" cy="22" r="1.8" fill="#333"/><circle cx="37" cy="22" r="1.8" fill="#333"/><path d="M28 27 q4 4 8 0" stroke="#c66" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="23" cy="25" r="2" fill="#ff9aa2" opacity=".5"/><circle cx="41" cy="25" r="2" fill="#ff9aa2" opacity=".5"/></svg>' },
    { id: "girl", name: "小女孩", cat: "人物", svg: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="59" rx="15" ry="4" fill="#000" opacity=".08"/><rect x="25" y="44" width="6" height="12" rx="3" fill="#c2517f"/><rect x="33" y="44" width="6" height="12" rx="3" fill="#c2517f"/><rect x="23" y="55" width="10" height="4" rx="2" fill="#333"/><rect x="31" y="55" width="10" height="4" rx="2" fill="#333"/><rect x="21" y="30" width="22" height="17" rx="6" fill="#ff8ec2"/><rect x="12" y="32" width="8" height="15" rx="4" fill="#f6c9a0"/><rect x="44" y="32" width="8" height="15" rx="4" fill="#f6c9a0"/><circle cx="32" cy="21" r="13" fill="#f6c9a0"/><circle cx="17" cy="21" r="5" fill="#5a3a1e"/><path d="M14 24 q-3 9 -7 13 q10 -3 12 -12z" fill="#5a3a1e"/><path d="M21 17 q0 -12 11 -12 q11 0 11 12 q-4 -7 -11 -7 q-7 0 -11 7z" fill="#5a3a1e"/><circle cx="27" cy="22" r="1.8" fill="#333"/><circle cx="37" cy="22" r="1.8" fill="#333"/><path d="M28 27 q4 4 8 0" stroke="#c66" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="23" cy="25" r="2" fill="#ff9aa2" opacity=".5"/><circle cx="41" cy="25" r="2" fill="#ff9aa2" opacity=".5"/></svg>' },
    { id: "teacher", name: "老师", cat: "人物", svg: '<svg viewBox="0 0 64 64"><ellipse cx="32" cy="59" rx="15" ry="4" fill="#000" opacity=".08"/><rect x="25" y="44" width="6" height="12" rx="3" fill="#5e3a75"/><rect x="33" y="44" width="6" height="12" rx="3" fill="#5e3a75"/><rect x="23" y="55" width="10" height="4" rx="2" fill="#333"/><rect x="31" y="55" width="10" height="4" rx="2" fill="#333"/><rect x="21" y="30" width="22" height="17" rx="6" fill="#9b59b6"/><rect x="12" y="32" width="8" height="15" rx="4" fill="#f6c9a0"/><rect x="44" y="32" width="8" height="15" rx="4" fill="#f6c9a0"/><circle cx="32" cy="21" r="13" fill="#f6c9a0"/><path d="M20 18 q0 -12 12 -12 q12 0 12 12 q-4 -7 -12 -7 q-8 0 -12 7z" fill="#4a3320"/><circle cx="27" cy="22" r="1.8" fill="#333"/><circle cx="37" cy="22" r="1.8" fill="#333"/><g stroke="#333" stroke-width="1.4" fill="none"><circle cx="27" cy="22" r="4"/><circle cx="37" cy="22" r="4"/><line x1="31" y1="22" x2="33" y2="22"/></g><path d="M28 27 q4 4 8 0" stroke="#c66" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>' }
  ];

  var MAP = {};
  RAW.forEach(function (it) { MAP[it.id] = it; });
  var CATS = ["动物", "植物", "水果", "日常", "人物"];

  function byCat(cat) {
    if (!cat) return RAW.slice();
    return RAW.filter(function (it) { return it.cat === cat; });
  }
  function get(id) { return MAP[id] || null; }
  function svg(id) { return MAP[id] ? MAP[id].svg : ""; }
  function ids(cat) { return byCat(cat).map(function (it) { return it.id; }); }
  function pick(cat) {
    var a = byCat(cat);
    return a[Math.floor(Math.random() * a.length)];
  }
  // 生成一个包裹 svg 的 DOM 元素（可带 class 用于动画）
  function el(id, cls) {
    var d = document.createElement("span");
    d.className = (cls || "imgspan");
    var s = svg(id);
    if (s) d.innerHTML = s;
    return d;
  }
  // 返回可直接塞进 innerHTML 的标签
  function tag(id, cls, extra) {
    var s = svg(id);
    if (!s) return "";
    return '<span class="' + (cls || "imgspan") + '"' + (extra ? " " + extra : "") + ">" + s + "</span>";
  }

  App.IMG = {
    raw: RAW, map: MAP, cats: CATS,
    byCat: byCat, get: get, svg: svg, ids: ids, pick: pick, el: el, tag: tag
  };
})(window);
