/*
 * anim.js — 业务层 / 动画角色系统
 * 提供：人物 SVG（kid/boy/girl/teacher）与动物组合的“小舞台”，
 *       配合 anim.css 的关键帧（跳动 jbounce / 挥手 jwave / 心跳 jpulse）与语音音效。
 * 用途：成长小课堂、教案中心及各学科页面复用的“人和动物”动画。
 * 兼容：纯内联 SVG + transform/opacity 动画，带 -webkit- 前缀，无 ?? / ?.。
 */
(function (w) {
  "use strict";
  var App = (w.App = w.App || {});

  // 用参数拼一个友好卡通人物 SVG
  function mkPerson(o) {
    o = o || {};
    var skin = o.skin || "#f6c9a0", hair = o.hair || "#5a3a1e";
    var shirt = o.shirt || "#5b8def", pants = o.pants || "#3a5a8c";
    var hairTop = o.pony
      ? '<circle cx="17" cy="21" r="5" fill="' + hair + '"/>' +
        '<path d="M14 24 q-3 9 -7 13 q10 -3 12 -12z" fill="' + hair + '"/>' +
        '<path d="M21 17 q0 -12 11 -12 q11 0 11 12 q-4 -7 -11 -7 q-7 0 -11 7z" fill="' + hair + '"/>'
      : '<path d="M20 18 q0 -12 12 -12 q12 0 12 12 q-4 -7 -12 -7 q-8 0 -12 7z" fill="' + hair + '"/>';
    var glasses = o.glasses
      ? '<g stroke="#333" stroke-width="1.4" fill="none"><circle cx="27" cy="22" r="4"/><circle cx="37" cy="22" r="4"/><line x1="31" y1="22" x2="33" y2="22"/></g>'
      : "";
    return '<svg viewBox="0 0 64 64">' +
      '<ellipse cx="32" cy="59" rx="15" ry="4" fill="#000" opacity=".08"/>' +
      '<rect x="25" y="44" width="6" height="12" rx="3" fill="' + pants + '"/>' +
      '<rect x="33" y="44" width="6" height="12" rx="3" fill="' + pants + '"/>' +
      '<rect x="23" y="55" width="10" height="4" rx="2" fill="#333"/>' +
      '<rect x="31" y="55" width="10" height="4" rx="2" fill="#333"/>' +
      '<rect x="21" y="30" width="22" height="17" rx="6" fill="' + shirt + '"/>' +
      '<rect x="12" y="32" width="8" height="15" rx="4" fill="' + skin + '"/>' +
      '<rect x="44" y="32" width="8" height="15" rx="4" fill="' + skin + '"/>' +
      '<circle cx="32" cy="21" r="13" fill="' + skin + '"/>' +
      hairTop +
      '<circle cx="27" cy="22" r="1.8" fill="#333"/><circle cx="37" cy="22" r="1.8" fill="#333"/>' +
      glasses +
      '<path d="M28 27 q4 4 8 0" stroke="#c66" stroke-width="1.6" fill="none" stroke-linecap="round"/>' +
      '<circle cx="23" cy="25" r="2" fill="#ff9aa2" opacity=".5"/><circle cx="41" cy="25" r="2" fill="#ff9aa2" opacity=".5"/>' +
      '</svg>';
  }

  var PEOPLE = {
    kid: mkPerson({ shirt: "#7cc643", pants: "#3f7a1e" }),
    boy: mkPerson({ shirt: "#5b8def", pants: "#2f4f8f" }),
    girl: mkPerson({ shirt: "#ff8ec2", pants: "#c2517f", pony: true }),
    teacher: mkPerson({ shirt: "#9b59b6", pants: "#5e3a75", glasses: true })
  };

  function tag(id, cls, extra) {
    var s = PEOPLE[id] || "";
    if (!s) return "";
    return '<span class="' + (cls || "imgspan") + '"' + (extra ? " " + extra : "") + ">" + s + "</span>";
  }
  function el(id, cls) {
    var d = document.createElement("span");
    d.className = cls || "imgspan";
    d.innerHTML = PEOPLE[id] || "";
    return d;
  }
  // 组合一个“小舞台”：人物 + 动物，全部带跳动动画
  function stage(opts) {
    opts = opts || {};
    var html = '<div class="anim-stage">', i, m;
    var people = opts.people || [];
    for (i = 0; i < people.length; i++) { m = (i % 4) + 1; html += tag(people[i], "mascot m" + m); }
    var animals = opts.animals || [];
    for (i = 0; i < animals.length; i++) {
      m = ((i + 1) % 4) + 1;
      html += '<span class="mascot m' + m + '">' + (App.IMG ? App.IMG.tag(animals[i], "imgspan") : "") + "</span>";
    }
    return html + "</div>";
  }
  // 让舞台里的角色挥手 + 播放成功音效
  function celebrate(container) {
    if (!container) return;
    var nodes = container.querySelectorAll(".mascot");
    for (var i = 0; i < nodes.length; i++) {
      (function (n) { n.classList.add("jwave"); setTimeout(function () { n.classList.remove("jwave"); }, 1800); })(nodes[i]);
    }
    if (App.Speech && App.Speech.sfx) App.Speech.sfx.right();
  }

  App.Anim = { people: PEOPLE, mkPerson: mkPerson, tag: tag, el: el, stage: stage, celebrate: celebrate };
})(window);
