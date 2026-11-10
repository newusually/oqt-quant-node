/* ==================================================================
 * safety-art.js — 「孩子保命有妙招108招」动漫场景生成器
 * Q版大头角色 + 12类场景背景 + 道具 → 组合出每一招的专属漫画画面
 *
 * 用法: App.SafetyArt.svg({ bg:'road', danger:true, roles:['an'], props:['car','light'] })
 *   bg    场景: road路/fire火/water水/home家/plug电/food食/street街/school校
 *               /quake震/net网/aid救/outdoor野
 *   danger true=危险场景(红色警示氛围) false=安全做法演示
 *   roles  角色: an安安(男) kang康康(女) bao豹警长 pol警察 fire消防员
 *               mum妈妈 tea老师 str陌生人(坏人) doc医生
 *   props  道具: car/light/bike/extinguisher/socket/pot/candy/phone/knife
 *               /dog/stairs/tree/screen/mask/bag/bus/sofa/window/match
 * ================================================================== */
(function (w) {
  'use strict';

  /* ── 角色外观表：皮肤/发色/衣服/特征 ── */
  var AVATAR = {
    an:   { skin: '#ffcc9c', hair: '#5d4037', cloth: '#4a90d9', sub: '#2c5f9e', acc: 'boy' },   // 安安
    kang: { skin: '#ffd3b6', hair: '#3e2723', cloth: '#ef5da8', sub: '#c2185b', acc: 'girl' },  // 康康
    bao:  { skin: '#ffe0b2', hair: '#ffb300', cloth: '#37474f', sub: '#ff7043', acc: 'police' },// 豹警长
    pol:  { skin: '#ffcc9c', hair: '#212121', cloth: '#1976d2', sub: '#0d47a1', acc: 'cop' },
    fire: { skin: '#ffcc9c', hair: '#212121', cloth: '#e65100', sub: '#ff8f00', acc: 'fire' },
    mum:  { skin: '#ffd3b6', hair: '#6d4c41', cloth: '#7cb342', sub: '#558b2f', acc: 'woman' },
    tea:  { skin: '#ffe0b2', hair: '#4e342e', cloth: '#8e24aa', sub: '#6a1b9a', acc: 'woman' },
    str:  { skin: '#e0d3c0', hair: '#263238', cloth: '#455a64', sub: '#263238', acc: 'bad' },   // 陌生人(灰暗)
    doc:  { skin: '#ffcc9c', hair: '#212121', cloth: '#ffffff', sub: '#26c6da', acc: 'doc' }
  };

  /* ── Q版人物：大头小身，表情区分情绪 ── */
  function drawRole(id, x, mood) {
    var a = AVATAR[id] || AVATAR.an;
    var s = [];
    var cy = 96;                                    // 头部中心
    s.push('<g transform="translate(' + x + ',0)">');
    // 腿
    s.push('<rect x="-13" y="150" width="9" height="30" rx="4" fill="' + a.sub + '"/>');
    s.push('<rect x="4" y="150" width="9" height="30" rx="4" fill="' + a.sub + '"/>');
    s.push('<ellipse cx="-8.5" cy="181" rx="7.5" ry="4" fill="#3e2723"/>');
    s.push('<ellipse cx="8.5" cy="181" rx="7.5" ry="4" fill="#3e2723"/>');
    // 身体
    s.push('<path d="M-19,150 L-16,124 Q0,115 16,124 L19,150 Z" fill="' + a.cloth + '"/>');
    // 手(惊恐时上举, 正常下垂)
    if (mood === 'scared') {
      s.push('<path d="M-17,127 Q-30,112 -26,96" stroke="' + a.cloth + '" stroke-width="8" fill="none" stroke-linecap="round"/>');
      s.push('<path d="M17,127 Q30,112 26,96" stroke="' + a.cloth + '" stroke-width="8" fill="none" stroke-linecap="round"/>');
    } else {
      s.push('<path d="M-17,128 Q-27,142 -22,152" stroke="' + a.cloth + '" stroke-width="8" fill="none" stroke-linecap="round"/>');
      s.push('<path d="M17,128 Q27,142 22,152" stroke="' + a.cloth + '" stroke-width="8" fill="none" stroke-linecap="round"/>');
    }
    s.push('<circle cx="-26" cy="153" r="5.5" fill="' + a.skin + '"/>');
    s.push('<circle cx="26" cy="153" r="5.5" fill="' + a.skin + '"/>');
    // 脖子 + 头
    s.push('<rect x="-5" y="112" width="10" height="10" fill="' + a.skin + '"/>');
    s.push('<circle cx="0" cy="' + cy + '" r="26" fill="' + a.skin + '"/>');
    // 发型
    if (a.acc === 'girl' || a.acc === 'woman') {
      s.push('<path d="M-27,92 Q-30,58 0,58 Q30,58 27,92 Q30,74 22,70 L-22,70 Q-30,74 -27,92 Z" fill="' + a.hair + '"/>');
      s.push('<circle cx="-24" cy="100" r="8" fill="' + a.hair + '"/><circle cx="24" cy="100" r="8" fill="' + a.hair + '"/>');
    } else if (a.acc === 'police') {
      s.push('<path d="M-26,92 Q-26,62 0,62 Q26,62 26,92 Z" fill="' + a.hair + '"/>');
      s.push('<circle cx="-19" cy="62" r="7" fill="' + a.hair + '"/><circle cx="19" cy="62" r="7" fill="' + a.hair + '"/>');
    } else if (a.acc === 'bad') {
      s.push('<path d="M-27,90 Q-24,60 0,60 Q24,60 27,90 L18,76 L-18,76 Z" fill="' + a.hair + '"/>');
    } else {
      s.push('<path d="M-26,92 Q-26,60 0,60 Q26,60 26,92 L14,74 Q0,66 -14,74 Z" fill="' + a.hair + '"/>');
    }
    // 职业配件帽子
    if (a.acc === 'cop' || a.acc === 'police') {
      s.push('<path d="M-25,74 Q0,58 25,74 L25,78 Q0,64 -25,78 Z" fill="#1565c0"/>');
      s.push('<circle cx="0" cy="66" r="4" fill="#ffd54f"/>');
    } else if (a.acc === 'fire') {
      s.push('<path d="M-27,76 Q0,56 27,76 L27,80 Q0,62 -27,80 Z" fill="#d84315"/>');
    } else if (a.acc === 'doc') {
      s.push('<rect x="-14" y="60" width="28" height="6" rx="2" fill="#e3f2fd"/>');
    }
    // 眼睛
    if (mood === 'scared') {
      s.push('<ellipse cx="-9" cy="94" rx="5.5" ry="7" fill="#fff"/><ellipse cx="9" cy="94" rx="5.5" ry="7" fill="#fff"/>');
      s.push('<circle cx="-9" cy="96" r="2.6" fill="#212121"/><circle cx="9" cy="96" r="2.6" fill="#212121"/>');
    } else if (mood === 'cry') {
      s.push('<path d="M-14,92 Q-9,86 -4,92" stroke="#212121" stroke-width="2.4" fill="none" stroke-linecap="round"/>');
      s.push('<path d="M4,92 Q9,86 14,92" stroke="#212121" stroke-width="2.4" fill="none" stroke-linecap="round"/>');
      s.push('<path d="M-9,104 Q-6,116 -11,120" stroke="#4fc3f7" stroke-width="3" fill="none" stroke-linecap="round"/>');
    } else if (a.acc === 'bad') {
      s.push('<path d="M-14,92 L-4,96 L-14,98 Z" fill="#212121"/><path d="M14,92 L4,96 L14,98 Z" fill="#212121"/>');
    } else {
      s.push('<circle cx="-9" cy="95" r="3.4" fill="#212121"/><circle cx="9" cy="95" r="3.4" fill="#212121"/>');
      s.push('<circle cx="-10.2" cy="93.8" r="1.2" fill="#fff"/><circle cx="7.8" cy="93.8" r="1.2" fill="#fff"/>');
    }
    // 嘴
    if (mood === 'happy') s.push('<path d="M-8,107 Q0,117 8,107" stroke="#c62828" stroke-width="2.4" fill="none" stroke-linecap="round"/>');
    else if (mood === 'scared') s.push('<ellipse cx="0" cy="110" rx="6" ry="7" fill="#c62828"/>');
    else if (mood === 'cry') s.push('<path d="M-7,112 Q0,105 7,112" stroke="#c62828" stroke-width="2.4" fill="none" stroke-linecap="round"/>');
    else if (a.acc === 'bad') s.push('<path d="M-9,108 Q0,102 9,108" stroke="#212121" stroke-width="2.4" fill="none" stroke-linecap="round"/>');
    else s.push('<path d="M-5,108 Q0,112 5,108" stroke="#c62828" stroke-width="2.2" fill="none" stroke-linecap="round"/>');
    // 腮红
    if (a.acc !== 'bad') s.push('<ellipse cx="-16" cy="104" rx="5" ry="3.2" fill="#ff8a80" opacity=".55"/><ellipse cx="16" cy="104" rx="5" ry="3.2" fill="#ff8a80" opacity=".55"/>');
    s.push('</g>');
    return s.join('');
  }

  /* ── 场景背景 ── */
  function drawBg(bg, danger) {
    var s = [];
    var sky = danger ? '#ffdcd6' : '#e3f2fd';
    var ground = danger ? '#e0b3ab' : '#c8e6c9';
    s.push('<rect x="0" y="0" width="320" height="200" fill="' + sky + '"/>');
    s.push('<path d="M0,150 L320,150 L320,200 L0,200 Z" fill="' + ground + '"/>');
    var B = {
      road: '<rect x="0" y="150" width="320" height="50" fill="#78909c"/>' +
            '<rect x="0" y="172" width="34" height="7" fill="#fff"/><rect x="70" y="172" width="34" height="7" fill="#fff"/>' +
            '<rect x="140" y="172" width="34" height="7" fill="#fff"/><rect x="210" y="172" width="34" height="7" fill="#fff"/>' +
            '<rect x="280" y="172" width="34" height="7" fill="#fff"/>' +
            '<rect x="292" y="46" width="22" height="60" rx="3" fill="#455a64"/>' +
            '<circle cx="303" cy="60" r="7" fill="' + (danger ? '#d32f2f' : '#43a047') + '"/>' +
            '<circle cx="303" cy="80" r="7" fill="#cfd8dc"/><circle cx="303" cy="96" r="7" fill="#cfd8dc"/>',
      fire: '<rect x="24" y="60" width="60" height="90" fill="#8d6e63"/><rect x="210" y="70" width="70" height="80" fill="#a1887f"/>' +
            '<path d="M150,150 Q140,90 165,64 Q152,92 172,84 Q160,120 150,150 Z" fill="' + (danger ? '#ff3d00' : '#ffb74d') + '"/>' +
            '<path d="M152,150 Q150,100 168,80 Q160,110 158,150 Z" fill="#ffee58"/>',
      water: '<path d="M0,168 Q40,158 80,168 T160,168 T240,168 T320,168 L320,200 L0,200 Z" fill="#4fc3f7"/>' +
             '<path d="M0,182 Q40,172 80,182 T160,182 T240,182 T320,182 L320,200 L0,200 Z" fill="#29b6f6"/>' +
             '<rect x="236" y="150" width="72" height="6" rx="3" fill="#8d6e63"/>' +
             '<text x="250" y="146" font-size="13" font-weight="bold" fill="#c62828">危险 禁止游泳</text>',
      home: '<rect x="30" y="56" width="150" height="96" fill="#ffe0b2"/><rect x="30" y="56" width="150" height="14" fill="#e65100"/>' +
            '<rect x="56" y="86" width="40" height="36" fill="#81d4fa"/><rect x="120" y="86" width="40" height="66" fill="#8d6e63"/>' +
            '<rect x="220" y="120" width="80" height="32" rx="6" fill="#c62828"/><rect x="220" y="108" width="80" height="16" rx="6" fill="#e53935"/>',
      plug: '<rect x="46" y="60" width="130" height="90" fill="#fff3e0"/>' +
            '<rect x="92" y="96" width="44" height="44" rx="6" fill="#fff" stroke="#bcaaa4" stroke-width="2"/>' +
            '<circle cx="106" cy="112" r="4.5" fill="#455a64"/><circle cx="124" cy="112" r="4.5" fill="#455a64"/>' +
            '<circle cx="115" cy="128" r="4.5" fill="#455a64"/>' +
            '<path d="' + (danger ? 'M136,112 L188,150' : 'M136,112 L188,150') + '" stroke="' + (danger ? '#ff3d00' : '#66bb6a') + '" stroke-width="6" stroke-linecap="round"/>' +
            '<g>' + (danger ? '<path d="M185,146 l10,-14 l-3,8 l9,-2 l-14,16 l3,-9 Z" fill="#ffd54f"/>' : '') + '</g>',
      food: '<rect x="40" y="110" width="150" height="12" rx="4" fill="#a1887f"/><rect x="52" y="122" width="10" height="30" fill="#8d6e63"/><rect x="168" y="122" width="10" height="30" fill="#8d6e63"/>' +
            '<ellipse cx="100" cy="106" rx="30" ry="9" fill="#fff"/><ellipse cx="100" cy="102" rx="20" ry="7" fill="#ffcc80"/>' +
            '<rect x="216" y="86" width="52" height="72" rx="5" fill="#ffe0b2"/><rect x="216" y="86" width="52" height="14" rx="4" fill="#43a047"/>',
      street: '<rect x="18" y="52" width="80" height="100" fill="#cfd8dc"/><rect x="230" y="62" width="76" height="90" fill="#b0bec5"/>' +
              '<rect x="100" y="120" width="30" height="32" rx="4" fill="#8d6e63"/><circle cx="115" cy="112" r="13" fill="#37474f"/>' +
              '<path d="M150,152 L200,152" stroke="#90a4ae" stroke-width="4"/>',
      school: '<rect x="20" y="50" width="160" height="100" fill="#fff8e1"/><rect x="20" y="50" width="160" height="16" fill="#1565c0"/>' +
              '<rect x="40" y="80" width="34" height="34" fill="#bbdefb"/><rect x="86" y="80" width="34" height="34" fill="#bbdefb"/><rect x="132" y="80" width="34" height="34" fill="#bbdefb"/>' +
              '<rect x="86" y="120" width="34" height="30" fill="#8d6e63"/>' +
              '<rect x="232" y="112" width="60" height="40" rx="4" fill="#a5d6a7"/>',
      quake: '<path d="M0,150 L60,150 L96,200 L24,200 Z" fill="#bcaaa4"/><path d="M180,150 L320,150 L320,200 L172,200 Z" fill="#bcaaa4"/>' +
             '<path d="M96,150 L172,150 L178,178 L88,178 Z" fill="#8d6e63"/>' +
             '<rect x="40" y="96" width="70" height="54" fill="#d7ccc8"/><path d="M40,96 L75,70 L110,96 Z" fill="#a1887f"/>',
      net: '<rect x="34" y="44" width="252" height="106" rx="8" fill="#263238"/><rect x="42" y="52" width="236" height="90" rx="4" fill="#eceff1"/>' +
           '<rect x="52" y="62" width="90" height="14" rx="3" fill="#90caf9"/><rect x="52" y="84" width="140" height="10" rx="3" fill="#cfd8dc"/>' +
           '<rect x="52" y="102" width="110" height="10" rx="3" fill="#cfd8dc"/>' +
           '<circle cx="230" cy="92" r="26" fill="' + (danger ? '#ef9a9a' : '#c8e6c9') + '"/>' +
           '<circle cx="222" cy="86" r="3.4" fill="#455a64"/><circle cx="238" cy="86" r="3.4" fill="#455a64"/>' +
           '<path d="M222,100 Q230,' + (danger ? '94' : '108') + ' 238,100" stroke="#455a64" stroke-width="2.4" fill="none" stroke-linecap="round"/>',
      aid: '<rect x="30" y="112" width="150" height="10" rx="3" fill="#cfd8dc"/>' +
           '<rect x="196" y="88" width="86" height="64" rx="6" fill="#fff"/><rect x="196" y="88" width="86" height="16" rx="6" fill="#e53935"/>' +
           '<rect x="234" y="80" width="10" height="30" rx="2" fill="#e53935"/><rect x="224" y="94" width="30" height="10" rx="2" fill="#e53935"/>',
      outdoor: '<path d="M0,150 L320,150 L320,200 L0,200 Z" fill="#a5d6a7"/>' +
               '<rect x="40" y="96" width="16" height="56" fill="#795548"/><circle cx="48" cy="82" r="34" fill="#66bb6a"/><circle cx="48" cy="70" r="26" fill="#43a047"/>' +
               '<rect x="228" y="102" width="14" height="50" fill="#795548"/><circle cx="235" cy="92" r="28" fill="#81c784"/>' +
               '<rect x="110" y="140" width="86" height="12" rx="4" fill="#8d6e63"/>'
    };
    s.push(B[bg] || B.home);
    return s.join('');
  }

  /* ── 道具层（画在人物周围） ── */
  function drawProp(id, danger) {
    var P = {
      car: '<g transform="translate(196,116)"><rect x="0" y="10" width="76" height="34" rx="8" fill="' + (danger ? '#d32f2f' : '#42a5f5') + '"/><rect x="12" y="0" width="42" height="18" rx="7" fill="' + (danger ? '#b71c1c' : '#1e88e5') + '"/><circle cx="18" cy="46" r="10" fill="#37474f"/><circle cx="58" cy="46" r="10" fill="#37474f"/></g>',
      bus: '<g transform="translate(196,112)"><rect x="0" y="8" width="88" height="40" rx="6" fill="#ffb300"/><rect x="8" y="14" width="18" height="14" fill="#fff8e1"/><rect x="32" y="14" width="18" height="14" fill="#fff8e1"/><rect x="56" y="14" width="18" height="14" fill="#fff8e1"/><circle cx="20" cy="50" r="9" fill="#37474f"/><circle cx="66" cy="50" r="9" fill="#37474f"/></g>',
      bike: '<g transform="translate(214,136)"><circle cx="0" cy="0" r="16" fill="none" stroke="#37474f" stroke-width="3"/><circle cx="44" cy="0" r="16" fill="none" stroke="#37474f" stroke-width="3"/><path d="M0,0 L20,-18 L44,0 M20,-18 L34,-18" stroke="#1976d2" stroke-width="3" fill="none"/></g>',
      extinguisher: '<g transform="translate(240,110)"><rect x="0" y="14" width="20" height="42" rx="8" fill="#d32f2f"/><rect x="6" y="6" width="10" height="10" rx="2" fill="#37474f"/><path d="M20,20 L44,10" stroke="#37474f" stroke-width="4" stroke-linecap="round"/></g>',
      socket: '<g transform="translate(238,124)"><rect x="0" y="0" width="40" height="34" rx="5" fill="#fff" stroke="#bcaaa4" stroke-width="2"/><circle cx="13" cy="13" r="4" fill="#455a64"/><circle cx="27" cy="13" r="4" fill="#455a64"/><circle cx="20" cy="25" r="4" fill="#455a64"/></g>',
      candy: '<g transform="translate(236,128)"><circle cx="14" cy="14" r="14" fill="' + (danger ? '#ec407a' : '#81c784') + '"/><path d="M0,14 L28,14 M14,0 L14,28" stroke="#fff" stroke-width="3"/><rect x="-10" y="10" width="12" height="8" fill="#fff"/><rect x="26" y="10" width="12" height="8" fill="#fff"/></g>',
      phone: '<g transform="translate(238,112)"><rect x="0" y="0" width="30" height="50" rx="6" fill="#37474f"/><rect x="3" y="4" width="24" height="40" rx="3" fill="#4fc3f7"/></g>',
      knife: '<g transform="translate(236,126)"><path d="M0,20 L34,4 L38,10 L4,26 Z" fill="#cfd8dc"/><rect x="-14" y="18" width="16" height="9" rx="3" fill="#795548"/></g>',
      pot: '<g transform="translate(230,118)"><ellipse cx="20" cy="28" rx="26" ry="10" fill="#546e7a"/><path d="M-6,28 Q-6,6 20,6 Q46,6 46,28 Z" fill="#78909c"/><path d="M46,16 L64,10" stroke="#546e7a" stroke-width="5" stroke-linecap="round"/></g>',
      match: '<g transform="translate(238,116)"><rect x="0" y="16" width="34" height="9" rx="3" fill="#8d6e63"/><rect x="0" y="4" width="34" height="14" rx="3" fill="#d32f2f"/><circle cx="30" cy="0" r="10" fill="#ff7043"/><circle cx="30" cy="0" r="5" fill="#ffee58"/></g>',
      dog: '<g transform="translate(230,126)"><ellipse cx="20" cy="18" rx="26" ry="17" fill="#a1887f"/><circle cx="0" cy="10" r="15" fill="#8d6e63"/><circle cx="-6" cy="6" r="2.6" fill="#3e2723"/><circle cx="6" cy="6" r="2.6" fill="#3e2723"/><ellipse cx="0" cy="15" rx="4" ry="3" fill="#3e2723"/><path d="M46,18 Q58,10 54,22" stroke="#8d6e63" stroke-width="5" fill="none" stroke-linecap="round"/></g>',
      stairs: '<g transform="translate(214,120)"><rect x="0" y="30" width="80" height="10" fill="#a1887f"/><rect x="0" y="20" width="60" height="10" fill="#bcaaa4"/><rect x="0" y="10" width="40" height="10" fill="#a1887f"/><rect x="0" y="0" width="20" height="10" fill="#bcaaa4"/></g>',
      window: '<g transform="translate(232,80)"><rect x="0" y="0" width="64" height="60" rx="4" fill="#e3f2fd" stroke="#8d6e63" stroke-width="4"/><path d="M32,0 L32,60 M0,30 L64,30" stroke="#8d6e63" stroke-width="3"/></g>',
      mask: '<g transform="translate(232,116)"><path d="M0,10 Q22,-4 46,10 Q46,32 22,40 Q0,32 0,10 Z" fill="#bbdefb" stroke="#1976d2" stroke-width="2"/><path d="M0,12 L-16,22 M46,12 L62,22" stroke="#1976d2" stroke-width="2.4"/></g>',
      screen: '', bag: '', rope: '', trap: ''
    };
    return P[id] || '';
  }

  /* ── 主入口 ── */
  function svg(o) {
    o = o || {};
    var danger = !!o.danger;
    var roles = o.roles || ['an'];
    var props = o.props || [];
    var s = ['<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" class="sf-art">'];
    s.push(drawBg(o.bg || 'home', danger));
    // 人物默认表情：危险时惊恐、安全时开心
    for (var i = 0; i < roles.length; i++) {
      var r = roles[i];
      var id = typeof r === 'string' ? r : r.id;
      var mood = (typeof r === 'object' && r.mood) ? r.mood : (danger ? 'scared' : 'happy');
      var xs = [64, 150, 236];
      s.push(drawRole(id, xs[i % 3], mood));
    }
    for (var j = 0; j < props.length; j++) s.push(drawProp(props[j], danger));
    // 危险氛围：红色警示角标
    if (danger) {
      s.push('<path d="M0,0 L58,0 L0,58 Z" fill="#d32f2f" opacity=".9"/>');
      s.push('<text x="5" y="20" font-size="15" fill="#fff" font-weight="bold" transform="rotate(-45 12 12)">危险</text>');
    } else {
      s.push('<path d="M0,0 L54,0 L0,54 Z" fill="#43a047" opacity=".9"/>');
      s.push('<text x="4" y="19" font-size="13" fill="#fff" font-weight="bold" transform="rotate(-45 12 12)">安全</text>');
    }
    s.push('</svg>');
    return s.join('');
  }

  w.App = w.App || {};
  w.App.SafetyArt = { svg: svg, AVATAR: AVATAR };
})(window);
