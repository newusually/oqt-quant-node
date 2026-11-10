'use strict';
/* ============================================================================
 * bt/indicators.js —— 全股票/期货技术指标库（纯因果，滑动窗口 O(n)）
 * ----------------------------------------------------------------------------
 * 【数据事实】OKX/CME K 线表只有 ts,d,ym,o,h,l,c,v —— 没有持仓量 OI、没有基差、
 *   没有逐笔/盘口。因此「期货特有」指标（OI 变化、基差、期限结构、量仓配合）
 *   无法真实计算，本库用价量派生族替代，面板与报告须如实标注该限制。
 *
 * 【因果】所有指标在 i 根只用 bars[0..i]（含 i 根 OHLCV 已收盘）。
 *   收益类一律 (c[i]-c[i-1])/c[i-1]，不用 c[i+1]。分档边界由样本内(IS)采样求得。
 * 【单位】统一为可比标量：bp(1e-4)、百分比或 -1..1 无量纲；分档按分位自适应。
 * ========================================================================== */

/* 60 个指标定义：id / 名称 / 类别 / 单位说明 */
const DEFS = [
  /* A 趋势 ---------------------------------------------------------------- */
  ['MA5_SLOPE',    'MA5斜率',       '趋势', 'MA5 相对前一根变化 bp'],
  ['MA20_SLOPE',   'MA20斜率',      '趋势', 'MA20 相对前一根变化 bp'],
  ['MA60_SLOPE',   'MA60斜率',      '趋势', 'MA60 相对前一根变化 bp'],
  ['MA5_20_DIST',  'MA5/MA20乖离',  '趋势', '(MA5-MA20)/MA20 bp'],
  ['MA20_60_DIST', 'MA20/MA60乖离', '趋势', '(MA20-MA60)/MA60 bp'],
  ['MA_ALIGN',     '均线多空排列',  '趋势', 'MA5>MA20>MA60 计数 (-1..3)'],
  ['MACD_DIF',     'MACD DIF',      '趋势', '(EMA12-EMA26)/close bp'],
  ['MACD_HIST',    'MACD 柱',       '趋势', '(DIF-DEA)/close bp'],
  ['TRIX',         'TRIX',          '趋势', '三重EMA 一根变化率 bp'],
  ['AROON',        'Aroon多空',     '趋势', '(AroonUp-AroonDn)/100'],
  ['DMI',          'DMI +DI−−DI',   '趋势', '+DI 与 -DI 之差'],
  ['ADX',          'ADX(14)',       '趋势', '平均趋向强度'],
  ['VHF',          'VHF趋势效率',   '趋势', '(HH-LL)/Σ|Δc| (20)'],
  ['ER',           'Kaufman ER',    '趋势', '|c[i]-c[i-20]|/Σ|Δc|'],
  ['ICHIMOKU',     '一目均衡表',    '趋势', '(转换线-基准线)/close bp'],
  ['ZSCORE20',     '价格Z分数',     '趋势', '(c-MA20)/SD20'],
  /* B 动量/摆动 ----------------------------------------------------------- */
  ['RSI6',         'RSI(6)',        '动量', 'Wilder RSI 0..100'],
  ['RSI14',        'RSI(14)',       '动量', 'Wilder RSI 0..100'],
  ['RSI24',        'RSI(24)',       '动量', 'Wilder RSI 0..100'],
  ['KDJ_K',        'KDJ %K',        '动量', 'RSV 平滑 0..100'],
  ['KDJ_D',        'KDJ %D',        '动量', '%K 平滑 0..100'],
  ['KDJ_J',        'KDJ %J',        '动量', '3K-2D'],
  ['CCI14',        'CCI(14)',       '动量', '(TP-MA)/平均绝对偏差/0.015'],
  ['ROC10',        'ROC(10)',       '动量', '(c[i]/c[i-10]-1) bp'],
  ['WILLR14',      'Williams %R',   '动量', '-100..0'],
  ['UO',           '终极波动 UO',   '动量', '7/14/28 买压加权 0..100'],
  ['TSI',          '真实强度 TSI',  '动量', '双EMA 动量比 ×100'],
  ['PPO',          'PPO',           '动量', '(EMA12-EMA26)/EMA26 ×100'],
  ['STOCHRSI',     '随机RSI',       '动量', 'RSI14 在 14 根区间位置 0..100'],
  ['MOM_ACC',      '动量加速度',    '动量', 'MOM5[i]-MOM5[i-5] bp'],
  ['TD9',          'TD九转计数',    '动量', '连续 c[i]>c[i-4] 根数(带符号)'],
  ['FIBPOS60',     '斐波回撤位',    '动量', '60 根区间内收盘位置 0..1'],
  /* C 波动 --------------------------------------------------------------- */
  ['ATR_PCT',      'ATR(14)占比',   '波动', 'ATR/close bp'],
  ['ATR_CHG',      'ATR变化率',     '波动', 'ATR14/ATR14[i-10]-1'],
  ['BOLL_B',       '布林 %B',       '波动', '(c-下轨)/(上轨-下轨)'],
  ['BOLL_W',       '布林带宽',      '波动', '(上轨-下轨)/MA20 bp'],
  ['VOL20',        '历史波动率20',  '波动', '收益标准差 bp'],
  ['VOL_CHG',      '波动率变化',    '波动', 'VOL20/VOL20[i-20]-1'],
  ['KELTNER',      'Keltner位置',   '波动', '(c-MA20)/(2ATR)'],
  ['DONCH_W',      '唐奇安通道宽',  '波动', '(HH20-LL20)/close bp'],
  ['CHAIKIN_V',    'Chaikin波动',   '波动', 'EMA10(H-L) 变化率'],
  ['SKEW20',       '收益偏度20',    '波动', '三阶标准化矩'],
  ['KURT20',       '收益峰度20',    '波动', '四阶标准化矩'],
  ['UPDN_VOL',     '上下行波动比',  '波动', '上行方差/下行方差'],
  ['TR_RATIO',     '真实波幅比',    '波动', 'TR/ATR14'],
  ['ZERO20',       '零收益占比20',  '波动', '20根内 close 不变比例'],
  ['MAXMOVE20',    '最大单根波动',  '波动', '20根内 max|ret| bp'],
  /* D 量能（无 OI，价量派生） --------------------------------------------- */
  ['VOL_RATIO',    '量比',          '量能', 'v/MA20(v)'],
  ['OBV_SLOPE',    'OBV斜率',       '量能', 'OBV[i]-OBV[i-10] 相对 MA20(v)'],
  ['MFI14',        '资金流量MFI',   '量能', '0..100'],
  ['CMF20',        '蔡金资金流',    '量能', 'Σ(CLV·v)/Σv (20)'],
  ['AD_SLOPE',     'A/D线斜率',     '量能', 'A/D[i]-A/D[i-10] 相对'],
  ['PVT_SLOPE',    'PVT斜率',       '量能', 'PVT[i]-PVT[i-10] 相对'],
  ['VOL_ROC',      '成交量ROC',     '量能', 'MA5(v)/MA20(v)-1'],
  ['VOL_DIVERG',   '量价背离',      '量能', '-sign(动量)·sign(量变化)'],
  ['VWAP_DEV',     'VWAP乖离',      '量能', '(c-VWAP20)/VWAP20 bp'],
  ['TURNOVER',     '成交额变化',    '量能', 'MA5(v·c)/MA20(v·c)-1'],
  /* E K线形态/价格结构 ---------------------------------------------------- */
  ['BODY',         'K线实体',       '形态', '(c-o)/o bp'],
  ['UPSHADOW',     '上影线',        '形态', '(h-max(o,c))/c bp'],
  ['DNSHADOW',     '下影线',        '形态', '(min(o,c)-l)/c bp'],
  ['CLV',          '收盘位置CLV',   '形态', '(2c-h-l)/(h-l) -1..1'],
  ['BREAK20',      '20根突破位',    '形态', '收盘在20根高低区间位置 0..1'],
  ['STREAK',       '连涨跌根数',    '形态', '连续同向收盘根数(带符号)'],
  ['GAP',          '跳空',          '形态', '(o-prev c)/prev c bp'],
  ['AMPLITUDE',    '振幅',          '形态', '(h-l)/c bp'],
  ['PATTERN',      'K线形态编码',   '形态', '锤子/吞没/十字星离散编码'],
  ['POS60',        '60根价格分位',  '形态', '0..1'],
  /* F 统计/时间/缠论 ------------------------------------------------------ */
  ['AUTOCORR10',   '收益自相关10',  '统计', 'lag-1 自相关(10窗)'],
  ['HURST_P',      'Hurst近似',     '统计', 'log(var20/var10)/log2'],
  ['UTC_HOUR',     'UTC时段',       '时间', '0..23'],
  ['WEEKDAY',      '星期',          '时间', '0..6'],
  ['SEG_DEG',      '缠论段角',      '缠论', '最近已确认段角度(度)'],
  ['SEG_LEN',      '缠论段长',      '缠论', '最近已确认段跨越根数'],
  ['MOM5',         '5根动量',       '动量', '(c[i]/c[i-5]-1) bp']
];
const NI = DEFS.length;
const ID = {}; DEFS.forEach((d, i) => { ID[d[0]] = i; });

/* ---------------------------------------------------------------- 基础滑动工具 */
function rollingSum(a, n, W) {
  const out = new Float64Array(n); let s = 0;
  for (let i = 0; i < n; i++) { s += a[i]; if (i >= W) s -= a[i - W]; out[i] = s; }
  return out;
}
function rollingMax(a, n, W) {
  const out = new Float64Array(n), dq = new Int32Array(n);
  let hh = 0, tt = 0;
  for (let i = 0; i < n; i++) {
    while (hh < tt && dq[hh] <= i - W) hh++;
    while (hh < tt && a[dq[tt - 1]] <= a[i]) tt--;
    dq[tt++] = i;
    out[i] = a[dq[hh]];
  }
  return out;
}
function rollingMin(a, n, W) {
  const out = new Float64Array(n), dq = new Int32Array(n);
  let hh = 0, tt = 0;
  for (let i = 0; i < n; i++) {
    while (hh < tt && dq[hh] <= i - W) hh++;
    while (hh < tt && a[dq[tt - 1]] >= a[i]) tt--;
    dq[tt++] = i;
    out[i] = a[dq[hh]];
  }
  return out;
}
function emaArr(a, n, p) {
  const out = new Float64Array(n), k = 2 / (p + 1);
  let e = a[0] || 0; out[0] = e;
  for (let i = 1; i < n; i++) { e = (a[i] - e) * k + e; out[i] = e; }
  return out;
}
function maArr(a, n, p) {
  const out = new Float64Array(n); let s = 0;
  for (let i = 0; i < n; i++) { s += a[i]; if (i >= p) s -= a[i - p]; out[i] = i >= p - 1 ? s / p : s / (i + 1); }
  return out;
}
function wilderRSI(c, n, p) {
  const out = new Float64Array(n).fill(50);
  let ag = 0, al = 0;
  for (let i = 1; i < n; i++) {
    const d = c[i] - c[i - 1], g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    if (i <= p) { ag += g / p; al += l / p; }
    else { ag = (ag * (p - 1) + g) / p; al = (al * (p - 1) + l) / p; }
    out[i] = al > 1e-12 ? 100 - 100 / (1 + ag / al) : (ag > 0 ? 100 : 50);
  }
  return out;
}
function sdOf(sum, sum2, W) { const m = sum / W; return Math.sqrt(Math.max(0, sum2 / W - m * m)); }

/* ---------------------------------------------------------------- 主计算：返回 60 条 Float64Array */
function compute(bars, ChanLun) {
  const n = bars.length;
  const c = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n),
    l = new Float64Array(n), v = new Float64Array(n), ts = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = bars[i];
    c[i] = +b.c || 0; o[i] = +b.o || 0; h[i] = +b.h || 0; l[i] = +b.l || 0;
    v[i] = +b.v || 0; ts[i] = +b.t || 0;
  }
  const ret = new Float64Array(n), absd = new Float64Array(n), zero = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    ret[i] = c[i - 1] > 0 ? (c[i] - c[i - 1]) / c[i - 1] * 10000 : 0;
    absd[i] = Math.abs(c[i] - c[i - 1]);
    zero[i] = c[i] === c[i - 1] ? 1 : 0;
  }
  const inds = []; for (let k = 0; k < NI; k++) inds.push(new Float64Array(n));

  /* --- 通用滚动量 --- */
  const ma5 = maArr(c, n, 5), ma10 = maArr(c, n, 10), ma20 = maArr(c, n, 20), ma60 = maArr(c, n, 60);
  const mv5 = maArr(v, n, 5), mv20 = maArr(v, n, 20);
  const ema12 = emaArr(c, n, 12), ema26 = emaArr(c, n, 26);
  const sRet20 = rollingSum(ret, n, 20), sRet10 = rollingSum(ret, n, 10);
  const s2Ret20 = rollingSum(
    (() => { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = ret[i] * ret[i]; return a; })(), n, 20);
  const sAbs20 = rollingSum(absd, n, 20), sZero20 = rollingSum(zero, n, 20);
  const hh9 = rollingMax(h, n, 9), ll9 = rollingMin(l, n, 9);
  const hh14 = rollingMax(h, n, 14), ll14 = rollingMin(l, n, 14);
  const hh20 = rollingMax(h, n, 20), ll20 = rollingMin(l, n, 20);
  const hh26 = rollingMax(h, n, 26), ll26 = rollingMin(l, n, 26);
  const hh60 = rollingMax(h, n, 60), ll60 = rollingMin(l, n, 60);
  const maxMove20 = rollingMax((() => { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = Math.abs(ret[i]); return a; })(), n, 20);
  const tp = new Float64Array(n);
  for (let i = 0; i < n; i++) tp[i] = (h[i] + l[i] + c[i]) / 3;
  const maTP14 = maArr(tp, n, 14);
  const tr = new Float64Array(n);
  for (let i = 1; i < n; i++) tr[i] = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
  const clv = new Float64Array(n);
  for (let i = 0; i < n; i++) clv[i] = h[i] > l[i] ? (2 * c[i] - h[i] - l[i]) / (h[i] - l[i]) : 0;
  const clvVol = new Float64Array(n); for (let i = 0; i < n; i++) clvVol[i] = clv[i] * v[i];
  const sClvVol20 = rollingSum(clvVol, n, 20), sVol20 = rollingSum(v, n, 20);
  const vc = new Float64Array(n); for (let i = 0; i < n; i++) vc[i] = v[i] * c[i];
  const mvc5 = maArr(vc, n, 5), mvc20 = maArr(vc, n, 20);
  const sVC20 = rollingSum(vc, n, 20);

  /* --- RSI / 随机 RSI --- */
  const rsi6 = wilderRSI(c, n, 6), rsi14 = wilderRSI(c, n, 14), rsi24 = wilderRSI(c, n, 24);
  const rsiHi = rollingMax(rsi14, n, 14), rsiLo = rollingMin(rsi14, n, 14);
  /* --- MACD / PPO / TRIX / TSI --- */
  const dif = new Float64Array(n), ppo = new Float64Array(n);
  for (let i = 0; i < n; i++) { dif[i] = ema12[i] - ema26[i]; ppo[i] = ema26[i] > 0 ? dif[i] / ema26[i] * 100 : 0; }
  const dea = emaArr(dif, n, 9);
  const e1 = emaArr(c, n, 12), e2 = emaArr(e1, n, 12), e3 = emaArr(e2, n, 12);
  const mom1 = new Float64Array(n); for (let i = 1; i < n; i++) mom1[i] = c[i] - c[i - 1];
  const tsiA = emaArr(mom1, n, 25), tsiB = emaArr(tsiA, n, 13);
  const tsiAbs = emaArr((() => { const a = new Float64Array(n); for (let i = 0; i < n; i++) a[i] = Math.abs(mom1[i]); return a; })(), n, 25);
  const tsiAbsB = emaArr(tsiAbs, n, 13);
  /* --- ATR / DMI / ADX (Wilder) --- */
  const atr = new Float64Array(n), pdm = new Float64Array(n), mdm = new Float64Array(n);
  let aAtr = 0, aTr = 0, aPdm = 0, aMdm = 0, aDx = 0, adx = 0;
  const pdi = new Float64Array(n), mdi = new Float64Array(n), dx = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
    if (i <= 14) { aTr += tr[i] / 14; aPdm += pdm[i] / 14; aMdm += mdm[i] / 14; }
    else {
      aTr = (aTr * 13 + tr[i]) / 14; aPdm = (aPdm * 13 + pdm[i]) / 14; aMdm = (aMdm * 13 + mdm[i]) / 14;
    }
    atr[i] = aTr;
    pdi[i] = aTr > 1e-12 ? aPdm / aTr * 100 : 0;
    mdi[i] = aTr > 1e-12 ? aMdm / aTr * 100 : 0;
    const s = pdi[i] + mdi[i];
    dx[i] = s > 1e-12 ? Math.abs(pdi[i] - mdi[i]) / s * 100 : 0;
    if (i <= 27) { aDx += dx[i] / 14; }
    else if (i === 28) { aDx += dx[i] / 14; adx = aDx; }
    else adx = (adx * 13 + dx[i]) / 14;
    inds[ID.ADX][i] = adx;
  }
  /* --- KDJ --- */
  const rsv = new Float64Array(n);
  for (let i = 0; i < n; i++) rsv[i] = hh9[i] > ll9[i] ? (c[i] - ll9[i]) / (hh9[i] - ll9[i]) * 100 : 50;
  const K = new Float64Array(n).fill(50), D = new Float64Array(n).fill(50);
  for (let i = 1; i < n; i++) { K[i] = (2 * K[i - 1] + rsv[i]) / 3; D[i] = (2 * D[i - 1] + K[i]) / 3; }
  /* --- CCI (14) --- */
  const cci = new Float64Array(n);
  for (let i = 13; i < n; i++) {
    let md = 0;
    for (let j = i - 13; j <= i; j++) md += Math.abs(tp[j] - maTP14[i]);
    md /= 14;
    cci[i] = md > 1e-12 ? (tp[i] - maTP14[i]) / (0.015 * md) : 0;
  }
  /* --- 量能累计线 --- */
  const obv = new Float64Array(n), ad = new Float64Array(n), pvt = new Float64Array(n);
  const posFlow = new Float64Array(n), negFlow = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    obv[i] = obv[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0);
    ad[i] = ad[i - 1] + clv[i] * v[i];
    pvt[i] = pvt[i - 1] + v[i] * (c[i - 1] > 0 ? ret[i] / 10000 : 0);
    const flow = tp[i] * v[i];
    if (tp[i] > tp[i - 1]) posFlow[i] = flow; else if (tp[i] < tp[i - 1]) negFlow[i] = flow;
  }
  const sPos14 = rollingSum(posFlow, n, 14), sNeg14 = rollingSum(negFlow, n, 14);
  /* --- UO: 买压 BP = c - min(l, prev c), TR = max(h, prev c) - min(l, prev c) --- */
  const bp = new Float64Array(n), trU = new Float64Array(n);
  for (let i = 1; i < n; i++) { const mn = Math.min(l[i], c[i - 1]), mx = Math.max(h[i], c[i - 1]); bp[i] = c[i] - mn; trU[i] = mx - mn; }
  const sBp7 = rollingSum(bp, n, 7), sTr7 = rollingSum(trU, n, 7);
  const sBp14 = rollingSum(bp, n, 14), sTr14 = rollingSum(trU, n, 14);
  const sBp28 = rollingSum(bp, n, 28), sTr28 = rollingSum(trU, n, 28);
  /* --- 自相关 / 上下行波动 / 高阶矩 滑动和 --- */
  const rlag = new Float64Array(n), r2 = new Float64Array(n), r3 = new Float64Array(n), r4 = new Float64Array(n);
  const r2up = new Float64Array(n), r2dn = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    rlag[i] = ret[i] * ret[i - 1];
    r2[i] = ret[i] * ret[i]; r3[i] = r2[i] * ret[i]; r4[i] = r2[i] * r2[i];
    if (ret[i] > 0) r2up[i] = r2[i]; else r2dn[i] = r2[i];
  }
  const sRLag10 = rollingSum(rlag, n, 10), sR2_10 = rollingSum(r2, n, 10);
  const sR2_20 = rollingSum(r2, n, 20), sR3_20 = rollingSum(r3, n, 20), sR4_20 = rollingSum(r4, n, 20);
  const sUp20 = rollingSum(r2up, n, 20), sDn20 = rollingSum(r2dn, n, 20);
  /* --- Chaikin 波动 (EMA10 of h-l) --- */
  const hl = new Float64Array(n); for (let i = 0; i < n; i++) hl[i] = h[i] - l[i];
  const emaHL10 = emaArr(hl, n, 10);
  /* --- 连涨跌 / TD9 / Aroon / 形态 --- */
  const streak = new Int16Array(n), td9 = new Int16Array(n);
  let pStreak = 0, pTd = 0;
  for (let i = 1; i < n; i++) {
    const d = c[i] - c[i - 1];
    if (Math.abs(d) < 1e-12) pStreak = 0;
    else if (d > 0) pStreak = pStreak > 0 ? pStreak + 1 : 1;
    else pStreak = pStreak < 0 ? pStreak - 1 : -1;
    streak[i] = pStreak;
    if (i >= 4) {
      const cmp = c[i] - c[i - 4];
      if (cmp > 0) pTd = pTd > 0 ? pTd + 1 : 1;
      else if (cmp < 0) pTd = pTd < 0 ? pTd - 1 : -1;
      else pTd = 0;
    }
    td9[i] = pTd;
  }
  /* Aroon(14): 用滚动最值对应的位置 —— 单调队列版略，改用近14根线性查找(14×n≈1.3亿可接受) */
  const arUp = new Float64Array(n), arDn = new Float64Array(n);
  for (let i = 13; i < n; i++) {
    let bi = i - 13, si = i - 13;
    for (let j = i - 12; j <= i; j++) { if (h[j] >= h[bi]) bi = j; if (l[j] <= l[si]) si = j; }
    arUp[i] = (14 - (i - bi)) / 14 * 100;
    arDn[i] = (14 - (i - si)) / 14 * 100;
  }
  /* --- 缠论段角（自递推，严格因果） ---
   * 注意：ChanLun.pivots() 会把 (n-1) 当作最后一个段终点，段角因而包含未来 bar，
   * 直接映射到历史 bar 就是前视。这里改为逐根递推：方向在 i 根收盘由
   * sign(MA5[i]-MA5[i-1]) 确认，顶点落在 i-1；每根只用最后两个「已确认」顶点算段角。
   * 角度公式与 chanlun.js / angle_strategy 一致：θ=atan(((px1-px0)/|px0|/span)*100 /100)*180/π */
  const segDeg = new Float64Array(n), segLen = new Float64Array(n);
  {
    let lastDir = 0, p0i = 0, p0x = ma5[0] || 0, p1i = 0, p1x = ma5[0] || 0;
    const RAD = 180 / Math.PI;
    for (let i = 1; i < n; i++) {
      const d = ma5[i] > ma5[i - 1] ? 1 : (ma5[i] < ma5[i - 1] ? -1 : 0);
      if (lastDir !== 0 && d !== 0 && d !== lastDir) {
        p0i = p1i; p0x = p1x; p1i = i - 1; p1x = ma5[i - 1];
      }
      if (d !== 0) lastDir = d;
      const span = Math.max(1, p1i - p0i);
      const base = Math.abs(p0x) > 1e-12 ? Math.abs(p0x) : 1;
      segDeg[i] = Math.atan((p1x - p0x) / base / span) * RAD;
      segLen[i] = span;
    }
  }

  /* --- 逐根填充 60 指标（set 提到循环外，避免每根创建闭包） --- */
  let cur = 0;
  const set = (id, val) => { inds[ID[id]][cur] = val === val && val !== Infinity && val !== -Infinity ? val : 0; };
  for (let i = 0; i < n; i++) {
    cur = i;
    const px = c[i] > 0 ? c[i] : 1;
    const sd20 = sdOf(sRet20[i], s2Ret20[i], 20);
    /* A */
    set('MA5_SLOPE', i >= 1 && ma5[i - 1] > 0 ? (ma5[i] - ma5[i - 1]) / ma5[i - 1] * 10000 : 0);
    set('MA20_SLOPE', i >= 1 && ma20[i - 1] > 0 ? (ma20[i] - ma20[i - 1]) / ma20[i - 1] * 10000 : 0);
    set('MA60_SLOPE', i >= 1 && ma60[i - 1] > 0 ? (ma60[i] - ma60[i - 1]) / ma60[i - 1] * 10000 : 0);
    set('MA5_20_DIST', ma20[i] > 0 ? (ma5[i] - ma20[i]) / ma20[i] * 10000 : 0);
    set('MA20_60_DIST', ma60[i] > 0 ? (ma20[i] - ma60[i]) / ma60[i] * 10000 : 0);
    set('MA_ALIGN', (ma5[i] > ma20[i] ? 1 : 0) + (ma20[i] > ma60[i] ? 1 : 0) + (ma5[i] > ma60[i] ? 1 : 0) - 1);
    set('MACD_DIF', dif[i] / px * 10000);
    set('MACD_HIST', (dif[i] - dea[i]) / px * 10000);
    set('TRIX', i >= 1 && e3[i - 1] > 0 ? (e3[i] - e3[i - 1]) / e3[i - 1] * 10000 : 0);
    set('AROON', (arUp[i] - arDn[i]) / 100);
    set('DMI', pdi[i] - mdi[i]);
    /* ADX 已在 Wilder 循环写入 */
    set('VHF', sAbs20[i] > 1e-12 ? (hh20[i] - ll20[i]) / sAbs20[i] : 0);
    set('ER', i >= 20 && sAbs20[i] > 1e-12 ? Math.abs(c[i] - c[i - 20]) / sAbs20[i] : 0);
    set('ICHIMOKU', ((hh9[i] + ll9[i]) / 2 - (hh26[i] + ll26[i]) / 2) / px * 10000);
    set('ZSCORE20', sd20 > 1e-12 ? (c[i] - ma20[i]) / sd20 : 0);
    /* B */
    set('RSI6', rsi6[i]); set('RSI14', rsi14[i]); set('RSI24', rsi24[i]);
    set('KDJ_K', K[i]); set('KDJ_D', D[i]); set('KDJ_J', 3 * K[i] - 2 * D[i]);
    set('CCI14', cci[i]);
    set('ROC10', i >= 10 && c[i - 10] > 0 ? (c[i] - c[i - 10]) / c[i - 10] * 10000 : 0);
    set('WILLR14', hh14[i] > ll14[i] ? (c[i] - hh14[i]) / (hh14[i] - ll14[i]) * 100 : -50);
    const a7 = sTr7[i] > 0 ? sBp7[i] / sTr7[i] : 0, a14 = sTr14[i] > 0 ? sBp14[i] / sTr14[i] : 0, a28 = sTr28[i] > 0 ? sBp28[i] / sTr28[i] : 0;
    set('UO', 100 * (4 * a7 + 2 * a14 + a28) / 7);
    set('TSI', tsiAbsB[i] > 1e-12 ? tsiB[i] / tsiAbsB[i] * 100 : 0);
    set('PPO', ppo[i]);
    set('STOCHRSI', rsiHi[i] > rsiLo[i] ? (rsi14[i] - rsiLo[i]) / (rsiHi[i] - rsiLo[i]) * 100 : 50);
    const mom5 = i >= 5 && c[i - 5] > 0 ? (c[i] - c[i - 5]) / c[i - 5] * 10000 : 0;
    const mom5p = i >= 10 && c[i - 10] > 0 && c[i - 5] > 0 ? (c[i - 5] - c[i - 10]) / c[i - 10] * 10000 : 0;
    set('MOM_ACC', mom5 - mom5p);
    set('TD9', td9[i]);
    set('FIBPOS60', hh60[i] > ll60[i] ? (c[i] - ll60[i]) / (hh60[i] - ll60[i]) : 0.5);
    /* C */
    set('ATR_PCT', atr[i] / px * 10000);
    set('ATR_CHG', i >= 10 && atr[i - 10] > 0 ? atr[i] / atr[i - 10] - 1 : 0);
    const bbUp = ma20[i] + 2 * sd20, bbDn = ma20[i] - 2 * sd20;
    set('BOLL_B', bbUp > bbDn ? (c[i] - bbDn) / (bbUp - bbDn) : 0.5);
    set('BOLL_W', ma20[i] > 0 ? (bbUp - bbDn) / ma20[i] * 10000 : 0);
    set('VOL20', sd20);
    set('VOL_CHG', i >= 20 && sR2_20[i - 20] > 0 ? sd20 / sdOf(sRet20[i - 20], s2Ret20[i - 20], 20) - 1 : 0);
    set('KELTNER', atr[i] > 1e-12 ? (c[i] - ma20[i]) / (2 * atr[i]) : 0);
    set('DONCH_W', (hh20[i] - ll20[i]) / px * 10000);
    set('CHAIKIN_V', i >= 10 && emaHL10[i - 10] > 0 ? emaHL10[i] / emaHL10[i - 10] - 1 : 0);
    const m20 = sRet20[i] / 20, sdR = Math.sqrt(Math.max(1e-12, sR2_20[i] / 20 - m20 * m20));
    set('SKEW20', sdR > 1e-9 ? (sR3_20[i] / 20 - 3 * m20 * sdR * sdR - m20 * m20 * m20) / (sdR * sdR * sdR) : 0);
    set('KURT20', sdR > 1e-9 ? (sR4_20[i] / 20) / (sdR * sdR * sdR * sdR) - 3 : 0);
    set('UPDN_VOL', sDn20[i] > 1e-12 ? sUp20[i] / sDn20[i] : 1);
    set('TR_RATIO', atr[i] > 1e-12 ? tr[i] / atr[i] : 1);
    set('ZERO20', sZero20[i] / 20);
    set('MAXMOVE20', maxMove20[i]);
    /* D */
    set('VOL_RATIO', mv20[i] > 0 ? v[i] / mv20[i] : 1);
    set('OBV_SLOPE', i >= 10 && mv20[i] > 0 ? (obv[i] - obv[i - 10]) / (10 * mv20[i]) : 0);
    set('MFI14', sNeg14[i] > 1e-12 ? 100 - 100 / (1 + sPos14[i] / sNeg14[i]) : (sPos14[i] > 0 ? 100 : 50));
    set('CMF20', sVol20[i] > 0 ? sClvVol20[i] / sVol20[i] : 0);
    set('AD_SLOPE', i >= 10 && sVol20[i] > 0 ? (ad[i] - ad[i - 10]) / (10 * sVol20[i] / 20) : 0);
    set('PVT_SLOPE', i >= 10 && mv20[i] > 0 ? (pvt[i] - pvt[i - 10]) / (10 * mv20[i]) : 0);
    set('VOL_ROC', mv20[i] > 0 ? mv5[i] / mv20[i] - 1 : 0);
    set('VOL_DIVERG', -(Math.sign(mom5) * Math.sign(mv20[i] > 0 ? mv5[i] / mv20[i] - 1 : 0)));
    const vwap = sVol20[i] > 0 ? sVC20[i] / sVol20[i] : c[i];
    set('VWAP_DEV', vwap > 0 ? (c[i] - vwap) / vwap * 10000 : 0);
    set('TURNOVER', mvc20[i] > 0 ? mvc5[i] / mvc20[i] - 1 : 0);
    /* E */
    set('BODY', o[i] > 0 ? (c[i] - o[i]) / o[i] * 10000 : 0);
    set('UPSHADOW', (h[i] - Math.max(o[i], c[i])) / px * 10000);
    set('DNSHADOW', (Math.min(o[i], c[i]) - l[i]) / px * 10000);
    set('CLV', clv[i]);
    set('BREAK20', hh20[i] > ll20[i] ? (c[i] - ll20[i]) / (hh20[i] - ll20[i]) : 0.5);
    set('STREAK', streak[i]);
    set('GAP', i >= 1 && c[i - 1] > 0 ? (o[i] - c[i - 1]) / c[i - 1] * 10000 : 0);
    set('AMPLITUDE', (h[i] - l[i]) / px * 10000);
    const rng = h[i] - l[i], bd = Math.abs(c[i] - o[i]);
    let pat = 0;
    if (rng > 1e-12 && bd / rng < 0.1) pat = 2;                          /* 十字星 */
    else if (rng > 1e-12 && (Math.min(o[i], c[i]) - l[i]) / rng > 0.6) pat = 1;  /* 锤子 */
    else if (i >= 1 && c[i] > o[i] && c[i - 1] < o[i - 1] && c[i] > o[i - 1]) pat = -1; /* 看涨吞没 */
    else if (i >= 1 && c[i] < o[i] && c[i - 1] > o[i - 1] && c[i] < o[i - 1]) pat = -2; /* 看跌吞没 */
    set('PATTERN', pat);
    set('POS60', hh60[i] > ll60[i] ? (c[i] - ll60[i]) / (hh60[i] - ll60[i]) : 0.5);
    /* F */
    const m10 = sRet10[i] / 10;
    const var10 = Math.max(1e-12, sR2_10[i] / 10 - m10 * m10);
    const cov = sRLag10[i] / 10 - m10 * m10;
    set('AUTOCORR10', var10 > 1e-12 ? cov / var10 : 0);
    const var20 = Math.max(1e-12, sdR * sdR);
    set('HURST_P', Math.log(Math.max(1e-9, var20 / Math.max(1e-9, var10))) / Math.LN2);
    set('UTC_HOUR', Math.floor((ts[i] % 86400000) / 3600000));
    set('WEEKDAY', (Math.floor(ts[i] / 86400000) + 4) % 7);
    set('SEG_DEG', segDeg[i]);
    set('SEG_LEN', segLen[i]);
    set('MOM5', mom5);
  }
  return { inds: inds, n: n, c: c, ret: ret, defs: DEFS };
}

module.exports = { DEFS: DEFS, NI: NI, ID: ID, compute: compute };
