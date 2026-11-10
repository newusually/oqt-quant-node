#!/usr/bin/env bash
# ai_daily.sh — 每小时：交易快照（累计复盘）→ CodeBuddy/Hy4 分析 → 校验 → 写 data/ai_strategy.json
# 图表数据由快照生成，AI 只产出精简文字结论；额度耗尽自动切下一个候选模型。
# 快照读取自 2026-11-01 起全部历史（永久保留），因此每次都是基于全量数据的累计复盘。
set -u
ROOT=/home/ubuntu/oqt-quant-node
DATA="$ROOT/data/ai_strategy.json"
DB="$ROOT/data/flowtrack/flowtrack.sqlite"
LOG="$ROOT/logs/ai_daily.log"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
export HOME=/root
export CODEBUDDY_CONFIG_DIR=/root/.codebuddy
MODELS="${AI_MODELS:-hy4-preview hy3 deepseek-v4.1-flash default-model}"

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" >> "$LOG"; }
log '===== 每小时 AI 分析（累计复盘）开始 ====='

node "$ROOT/scripts/ai_snapshot.js" "$DB" > "$TMP/snapshot.json" 2>>"$LOG" || { log '快照生成失败，终止'; exit 1; }

cat > "$TMP/prompt_head.txt" <<'PROMPT'
你是量化策略复盘分析师。下面是 OKX 马丁格尔金字塔【模拟盘】的真实运行快照（JSON）。
只输出一个 JSON 对象，不要解释文字、不要 Markdown 代码块以外的内容。

【硬性格式】
{
 "verdict": "一句话总体结论，≤80 字，用 **...** 标出最关键的 1-2 个词",
 "highlights": [
   {"level":"danger","text":"最严重的风险/问题，≤45 字，用 **...** 标出重点"},
   {"level":"warn","text":"次要风险或数据口径提醒，≤45 字"},
   {"level":"ok","text":"表现正常或正确的点，≤45 字"},
   {"level":"info","text":"下一步最该做的事，≤45 字"}
 ],
 "steps": [
   {"title":"数据口径","detail":"≤70 字"},
   {"title":"入场信号","detail":"≤70 字"},
   {"title":"加仓行为","detail":"≤70 字"},
   {"title":"止盈表现","detail":"≤70 字"},
   {"title":"风险点","detail":"≤70 字"},
   {"title":"改进优先级","detail":"≤70 字"}
 ],
 "profitAnalysis": [
   {"pid":"轮次ID或'归类'","inst":"合约","why":"**为什么盈利**：结合入场零轴翻转信号、加仓摊薄成本、趋势延续、止盈触发等机制，≤120 字"}
 ],
 "lossAnalysis": [
   {"pid":"轮次ID或'归类'","inst":"合约","why":"**为什么亏损**：结合浮亏加仓后继续反向、横盘消耗、信号失效、未触止盈等，≤120 字"}
 ],
 "floatingLossAnalysis": [
   {"pid":"持仓轮次ID","inst":"合约","dir":"多/空","floatPct":"当前浮亏百分比(负数,来自openPositions)","why":"**每小时浮亏原因**：该仓位此刻为何浮亏（反向趋势/加仓摊薄中/横盘等待信号/入场点差等），≤100 字"}
 ],
 "signalReport": [
   {"ev":"buy/sell/add/close","inst":"合约","pnl":"该信号对应USD盈亏(平仓写net，其余写成本或—)","why":"≤80 字"}
 ],
 "backtest": {
   "summary": "基于快照 backtest 字段的全量回测结论，≤150 字，必须引用 wins/losses/winRate/netUsd/byDirection 等真实数字",
   "byDirection": "多/空方向各自的净盈亏结论，≤80 字",
   "note": "样本不足/极端合约/异常提示，≤80 字"
 },
 "rootCause": "**强制根因**：综合所有历史数据，系统性解释本策略为何整体盈利/亏损（趋势市/震荡市、马丁格尔加仓有效性、止盈与加仓阈值、信号质量、费率侵蚀等），≤250 字，必须给出可验证机制，不得空泛",
 "metrics": [{"k":"指标名","v":"数值"}],
 "conclusions": ["可执行结论，≤50 字，最多 6 条"],
 "params": {"tpPct":5,"addLossPct":0,"addIntervalMs":3600000},
 "codeChanges": [
   {"title":"改动点","file":"modules/okx/engines/flowtrack.layers/07-pyramid.js","oldCode":"将被替换的现有代码片段(必须与文件内容逐字符一致且唯一)","newCode":"替换后的完整代码片段","desc":"为什么这样改、预期效果，≤120 字"}
 ]
}

【硬性规则】
1) 所有时间必须写成快照里的「YYYY-MM-DD HH:mm:ss (北京时间)」字符串。
   禁止输出 13 位毫秒数字，禁止 UTC / ISO 8601 / 时区偏移写法。
2) 禁止编造任何数字，所有数字必须能在快照里找到（trades/signals/backtest/realized/chartSource 等）。
   不要把 0 当成零风险或零收益；胜率 / 盈亏比 / 回撤在无样本时一律写 null 或「不可评估」。
3) verdict、highlights、steps、conclusions 里用 **双星号** 包住需要红色加粗的重点词，每个字段最多 2 处。
4) 文字精炼，但 profitAnalysis / lossAnalysis / rootCause 必须完整深入；steps/highlights/conclusions 保持简短。
   整体可放宽至 1800 字以内，优先保证归因完整，禁止客套话。
5) 金额 0.1 USD、只 15m、数据永久保留、加仓需买卖信号(零轴翻转)同向 是锁定项，禁止建议修改。
   params 只允许 tpPct / addLossPct / addIntervalMs 三个键，范围 1~200 / 0~200 / 900000~604800000。
6) 当前规则：止盈 **5%**；加仓 = 满 1 小时 + **浮亏 > 0（亏损即触发）** + 出现买卖信号(MACD 零轴翻转)且与持仓同向（有信号才加仓）；
   入场 = MACD 零轴翻转（前≥20根反向柱后翻出方向）。买卖/加仓严格按每根 15m K线边界后窗口执行（每 15 分钟最多一次），平仓后同合约冷却 1 根K线。
   分析「加仓行为」时必须如实反映：现在是「亏损 + 零轴翻转信号同向」才加仓，而非仅看当期柱方向。
7) 图表由脚本从快照生成，你不需要输出任何图表数据；但 trades/signals/backtest 字段是事实源，必须据此归因。
8) 本次为【每小时累计复盘】：快照已包含自 2026-11-01 起全部历史数据（trades 逐轮明细、signals 全部买卖信号、backtest 全量汇总）。
   请基于全量数据强制搜索原因，对比上一版结论的变化趋势（盈利/亏损/持仓结构是否改善），并给出下一小时的关注点。
9) 【强制归因，不可省略】profitAnalysis 必须覆盖快照 backtest.wins 的**全部盈利笔**：先按机制归类
   （如『零轴翻转入场 + 趋势延续止盈』『浮亏加仓摊薄后止盈』），每类再举 1-2 个具体 pid 为例；
   lossAnalysis 必须覆盖**全部亏损笔**（归类 + 每类举例，附 pid）。**绝对禁止**用「部分样本/多数」一笔带过——
   要么逐笔列出 pid，要么归类后每个类别都给出样本 pid。字数不够就精简 steps/highlights，但归因数组必须完整。
   **若区间内已平亏损为 0 笔，lossAnalysis 必须恰好返回一条** why='回测区间已平 N 笔（盈利 W / 亏损 0），暂无已平亏损可供归因；当前 M 笔持仓详见未平仓位监控' 的说明条目——**禁止留空**，也禁止用「暂无」二字敷衍。
10) signalReport 必须基于 signals/trades 给出：所有买卖/加仓信号的盈亏分布结论（可归类+举典型 pid），
   并明确哪些是盈利信号、哪些是亏损信号、整体信号质量如何。
11) 【每小时浮亏归因，不可省略】floatingLossAnalysis 必须基于快照 openPositions（当前持仓按实时浮亏排序）
   逐笔分析浮亏最大的前 10 笔：每笔给出真实 floatPct 与原因（反向趋势启动/加仓摊薄进行中/横盘未触发信号/
   入场时机偏差等），并结合「下一小时是否可能触发加仓(需零轴翻转信号同向)」给出观察判断。禁止空数组。
12) 【自动改码】codeChanges 中的改动会被系统**自动应用**到代码文件（先备份→精确替换→node --check 语法校验→
   失败自动回滚），因此必须严格遵守：
   - file 仅允许 modules/okx/engines/flowtrack.layers/*.js 或 scripts/*.js 中的已存在文件；
   - oldCode 必须逐字符复制自当前文件内容、且在该文件中**唯一**出现（建议 3~10 行，含足够上下文）；
   - newCode 是替换后的完整片段，保持代码风格与缩进一致；
   - 只做保守、可验证的修改（阈值/条件/日志/防御性检查），禁止改资金、下单主流程、删除安全检查；
   - 不确定就不要输出 codeChanges 条目，宁可留空数组也不输出模糊改法。

【数据说明】下面仅附精简快照（period/realized/backtest/trades 全量逐轮盈亏）；
完整 394 条原始买卖信号与逐笔明细由系统透传至前端报表，你据此强制归因，不得省略任何一笔。
PROMPT
# 精简快照：去掉 245KB 原始 signals/curves，避免超命令行长度上限 ARG_MAX 导致模型调用失败
node "$ROOT/scripts/slim_snap.js" "$TMP/snapshot.json" "$TMP/snap_slim.json" >>"$LOG" 2>&1
cat "$TMP/prompt_head.txt" "$TMP/snap_slim.json" > "$TMP/prompt.txt"

ok=0
for m in $MODELS; do
  log "尝试模型 $m"
  timeout 420 codebuddy -p --model "$m" --output-format json --max-turns 3 "$(cat "$TMP/prompt.txt")" > "$TMP/raw.txt" 2>>"$LOG"
  rc=$?
  if [ "$rc" -ne 0 ] || [ ! -s "$TMP/raw.txt" ]; then log "模型 $m 调用失败 rc=$rc，切换下一个"; continue; fi
  if node "$ROOT/scripts/ai_apply.js" "$TMP/raw.txt" "$DATA" "$m" "$TMP/snapshot.json" >>"$LOG" 2>&1; then
    log "模型 $m 分析成功并已落盘"; ok=1
    node "$ROOT/scripts/ai_autofix.js" >>"$LOG" 2>&1 || log '自动改码执行失败(不影响策略落盘)'
    break
  fi
  log "模型 $m 输出校验失败，切换下一个"
done

if [ "$ok" -ne 1 ]; then log '所有候选模型均失败，保留上一版 ai_strategy.json'; exit 1; fi
log '===== 每小时 AI 分析（累计复盘）结束 ====='
