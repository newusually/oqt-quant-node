// L2 core · 时间（原 cpp/core 时间工具 1:1 转换，Asia/Shanghai 视角）
'use strict';

const WD = ['日', '一', '二', '三', '四', '五', '六'];

function pad(n, w = 2) { return String(n).padStart(w, '0'); }

// 秒级时间戳 -> "YYYY-MM-DD HH:mm:ss"
function fmt(tsSec) {
  const d = new Date(tsSec * 1000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 数据新鲜度文案
function ageText(tsSec) {
  const now = Math.floor(Date.now() / 1000);
  const g = now - tsSec;
  if (g < 60) return g + ' 秒前';
  if (g < 3600) return Math.floor(g / 60) + ' 分钟前';
  if (g < 86400) return Math.floor(g / 3600) + ' 小时前';
  return Math.floor(g / 86400) + ' 天前';
}

function weekday(tsSec) { return WD[new Date(tsSec * 1000).getDay()]; }

module.exports = { fmt, ageText, weekday, pad };
