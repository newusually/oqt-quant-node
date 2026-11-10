#!/usr/bin/env bash
# ai_daily.sh — 每天零点：交易快照 → CodeBuddy/Hy4 分析 → 校验 → 写 data/ai_strategy.json
# 图表数据由快照生成，AI 只产出精简文字结论；额度耗尽自动切下一个候选模型。
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
log '===== 每日 AI 分析开始 ====='

node "$ROOT/scripts/ai_snapshot.js" "$DB" > "$TMP/snapshot.json" 2>>"$LOG" || { log '快照生成失败，终止'; exit 1; }

cat > "$TMP/prompt.txt" <<'PROMPT'
你是量化策略复盘分析师。下面是 OKX 马丁格尔金字塔【模拟盘】的真实运行快照（JSON）。
只输出一个 JSON 对象，不要解释文字、不要 Markdown 代码块以外的内容。

【硬性格式】
{
 "verdict": "一句话总体结论，≤60 字，用 **...** 标出最关键的 1-2 个词",
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
 "mindmap": {"name":"策略评估","children":[{"name":"分支","children":[]}]},
 "metrics": [{"k":"指标名","v":"数值"}],
 "conclusions": ["可执行结论，≤50 字，最多 5 条"],
 "params": {"tpPct":10,"addLossPct":1,"addIntervalMs":3600000},
 "codeChanges": ["改进建议，≤50 字，最多 4 条，只建议不要写代码"]
}

【硬性规则】
1) 所有时间必须写成快照里的「YYYY-MM-DD HH:mm:ss (北京时间)」字符串。
   禁止输出 13 位毫秒数字，禁止 UTC / ISO 8601 / 时区偏移写法。
2) 禁止编造任何数字，所有数字必须能在快照里找到。没有平仓样本就写「样本不足」，
   不要把 0 当成零风险或零收益；胜率 / 盈亏比 / 回撤在无样本时一律写 null 或「不可评估」。
3) verdict、highlights、steps、conclusions 里用 **双星号** 包住需要红色加粗的重点词，
   每个字段最多 2 处，不要整句加粗。
4) 文字极度精简，整体不超过 700 字。禁止复述快照原文、禁止罗列长表格、禁止客套话。
5) 金额 0.1 USD、只 15m、数据永久保留、加仓需 MACD 柱方向同向是锁定项，禁止建议修改。
   params 只允许 tpPct / addLossPct / addIntervalMs 三个键，范围 1~200 / 1~200 / 900000~604800000。
6) 当前规则：止盈 10%；加仓 = 满 1 小时 + 浮亏 > 1% + 当前 15m MACD 柱方向与持仓同向（买多仓柱>0 / 卖空仓柱<0）。注意：只有「入场」用零轴翻转信号，加仓不看翻转。
   分析「加仓行为」时必须核对这三个条件能否同时满足，并区分「入场翻转信号」与「加仓柱方向」。
7) 图表由脚本从快照生成，你不需要输出任何图表数据。

快照：
PROMPT
cat "$TMP/snapshot.json" >> "$TMP/prompt.txt"

ok=0
for m in $MODELS; do
  log "尝试模型 $m"
  timeout 420 codebuddy -p --model "$m" --output-format json --max-turns 3 "$(cat "$TMP/prompt.txt")" > "$TMP/raw.txt" 2>>"$LOG"
  rc=$?
  if [ "$rc" -ne 0 ] || [ ! -s "$TMP/raw.txt" ]; then log "模型 $m 调用失败 rc=$rc，切换下一个"; continue; fi
  if node "$ROOT/scripts/ai_apply.js" "$TMP/raw.txt" "$DATA" "$m" "$TMP/snapshot.json" >>"$LOG" 2>&1; then
    log "模型 $m 分析成功并已落盘"; ok=1; break
  fi
  log "模型 $m 输出校验失败，切换下一个"
done

if [ "$ok" -ne 1 ]; then log '所有候选模型均失败，保留上一版 ai_strategy.json'; exit 1; fi
log '===== 每日 AI 分析结束 ====='
