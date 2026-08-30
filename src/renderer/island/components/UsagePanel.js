import { R as React } from "../../vendor/react-runtime.js";
import { A as AGENT_TOOL_LABELS } from "../../shared/settings.js";

/**
 * PRD-015：Usage 看板（Island 工具箱「用量」模块）。
 * 数据全部来自主进程聚合 API（usage:get-summary / usage:get-session-insights），
 * 只消费聚合 token 记录，不读取 prompt / transcript / 目录 / 密钥。
 * 成本为缓存感知微美元；定价缺失显示「未知」，绝不显示假 0。
 */

const RANGE_OPTIONS = [
  { days: 7, label: "7 天" },
  { days: 30, label: "30 天" },
  { days: 90, label: "90 天" }
];
const CATEGORY_LABELS = {
  quick: "快速",
  standard: "标准",
  marathon: "马拉松",
  automation: "自动化"
};

function formatTokens(n) {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function formatCost(microUsd, unknownTokens) {
  // PRD 验收：定价缺失显示「未知」，绝不显示假 0
  if (!microUsd && unknownTokens > 0) return "未知";
  const usd = microUsd / 1e6;
  const text = usd >= 1 ? `$${usd.toFixed(2)}` : usd >= 0.01 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(4)}`;
  return unknownTokens > 0 ? `${text}+未知` : text;
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const min = Math.round(ms / 6e4);
  if (min < 1) return "<1 分钟";
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`;
}

function dayTokens(day) {
  return day.inputTokens + day.outputTokens + day.cacheReadTokens + day.cacheCreationTokens;
}

/** 每日 token 双色堆叠柱状趋势图（手写 SVG，仓库无图表库惯例）。 */
function UsageTrendChart({ byDay }) {
  if (!byDay.length) return null;
  const W = Math.max(byDay.length * 14, 120);
  const H = 72;
  const maxTotal = Math.max(...byDay.map(dayTokens), 1);
  const barWidth = Math.max(6, Math.min(16, Math.floor(W / byDay.length) - 4));
  const step = W / byDay.length;
  return React.createElement("svg", {
    className: "usage-trend-chart",
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": "每日 token 消耗趋势"
  },
  byDay.map((day, i) => {
    const total = dayTokens(day);
    const h = total > 0 ? Math.max(2, (total / maxTotal) * (H - 8)) : 0;
    const inH = total > 0 ? (day.inputTokens / total) * h : 0;
    const cacheH = total > 0 ? ((day.cacheReadTokens + day.cacheCreationTokens) / total) * h : 0;
    const x = i * step + (step - barWidth) / 2;
    const title = `${day.date}：输入 ${formatTokens(day.inputTokens)} / 输出 ${formatTokens(day.outputTokens)} / 缓存 ${formatTokens(day.cacheReadTokens + day.cacheCreationTokens)}${day.costMicroUsd || day.unknownCostTokens ? ` / 成本 ${formatCost(day.costMicroUsd, day.unknownCostTokens)}` : ""}`;
    return React.createElement("g", { key: day.date },
      React.createElement("title", null, title),
      React.createElement("rect", { className: "usage-trend-bar-input", x, y: H - inH, width: barWidth, height: inH }),
      React.createElement("rect", { className: "usage-trend-bar-output", x, y: H - inH - (h - inH - cacheH), width: barWidth, height: Math.max(0, h - inH - cacheH) }),
      React.createElement("rect", { className: "usage-trend-bar-cache", x, y: H - h, width: barWidth, height: cacheH })
    );
  }));
}

/** 按日活动热力图（时区感知的按日分桶已在主进程完成）。 */
function UsageHeatmap({ byDay }) {
  const max = Math.max(...byDay.map(dayTokens), 1);
  return React.createElement("div", { className: "usage-heatmap", role: "img", "aria-label": "活动热力图" },
    byDay.map((day) => {
      const total = dayTokens(day);
      const level = total === 0 ? 0 : Math.min(4, Math.ceil((total / max) * 4));
      return React.createElement("span", {
        key: day.date,
        className: `usage-heatmap-cell is-level-${level}`,
        title: `${day.date}：${total > 0 ? formatTokens(total) + " tokens" : "无活动"}`
      });
    })
  );
}

function StatCard({ label, value, hint }) {
  return React.createElement("div", { className: "usage-stat-card" },
    React.createElement("span", { className: "usage-stat-label" }, label),
    React.createElement("strong", { className: "usage-stat-value" }, value),
    hint ? React.createElement("small", { className: "usage-stat-hint" }, hint) : null
  );
}

function UsageTable({ headers, rows, emptyText }) {
  if (!rows.length) return React.createElement("div", { className: "toolbox-empty" },
    React.createElement("span", { className: "toolbox-empty-icon" }, "◌"),
    React.createElement("strong", null, emptyText)
  );
  return React.createElement("table", { className: "usage-table" },
    React.createElement("thead", null, React.createElement("tr", null, headers.map((h) => React.createElement("th", { key: h }, h)))),
    React.createElement("tbody", null, rows)
  );
}

export function UsagePanel() {
  const [days, setDays] = React.useState(7);
  const [tab, setTab] = React.useState("overview");
  const [summary, setSummary] = React.useState(null);
  const [insights, setInsights] = React.useState(null);
  const [status, setStatus] = React.useState("");

  const refresh = React.useCallback(() => {
    window.islandBridge?.getUsageSummary?.(days).then((data) => setSummary(data));
    if (tab === "sessions") {
      window.islandBridge?.getSessionInsights?.(days).then((data) => setInsights(data));
    }
  }, [days, tab]);

  React.useEffect(() => {
    setSummary(null);
    setInsights(null);
    refresh();
  }, [refresh]);
  React.useEffect(() => {
    // token 有新增时主进程会推送今日烧量，借此刷新看板
    const off = window.islandBridge?.onTodayBurnUpdate?.(() => refresh());
    return () => off?.();
  }, [refresh]);

  const exportData = React.useCallback(async () => {
    setStatus("正在导出…");
    const result = await window.islandBridge?.exportUsageData?.();
    if (!result) { setStatus("导出失败"); return; }
    setStatus(result.ok ? `已导出到 ${result.path}` : "已取消导出");
  }, []);
  const clearData = React.useCallback(async () => {
    if (!window.confirm("清除全部本地用量记录？该操作不可恢复（不影响会话与其他数据）。")) return;
    await window.islandBridge?.clearUsageData?.();
    setStatus("已清除全部用量记录");
    refresh();
  }, [refresh]);

  const totals = summary?.totals;
  const totalTokens = totals ? totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheCreationTokens : 0;
  const hasData = Boolean(summary && summary.byDay?.some((d) => dayTokens(d) > 0));

  return React.createElement("section", { className: "toolbox-panel usage-panel" },
    React.createElement("div", { className: "toolbox-panel-heading" },
      React.createElement("div", null,
        React.createElement("strong", null, "用量"),
        React.createElement("span", null, status || `本地聚合 · 最近 ${days} 天 · 成本为缓存感知微美元估算`)),
      React.createElement("div", { className: "toolbox-heading-actions" },
        React.createElement("div", { className: "usage-range-switch", role: "group", "aria-label": "时间范围" },
          RANGE_OPTIONS.map((opt) => React.createElement("button", {
            key: opt.days,
            type: "button",
            className: days === opt.days ? "is-active" : "",
            onClick: () => setDays(opt.days)
          }, opt.label))),
        React.createElement("button", { type: "button", onClick: exportData }, "导出"),
        hasData && React.createElement("button", { type: "button", onClick: clearData }, "清除")
      )
    ),
    React.createElement("div", { className: "usage-tabs", role: "tablist" },
      React.createElement("button", { type: "button", role: "tab", "aria-selected": tab === "overview", className: `usage-tab${tab === "overview" ? " is-active" : ""}`, onClick: () => setTab("overview") }, "总览"),
      React.createElement("button", { type: "button", role: "tab", "aria-selected": tab === "sessions", className: `usage-tab${tab === "sessions" ? " is-active" : ""}`, onClick: () => setTab("sessions") }, "会话")
    ),
    !summary
      ? React.createElement("div", { className: "toolbox-empty" }, React.createElement("strong", null, "正在加载用量数据…"))
      : tab === "overview"
        ? React.createElement("div", { className: "usage-overview" },
          React.createElement("div", { className: "usage-stat-grid" },
            React.createElement(StatCard, { label: "总 Token", value: formatTokens(totalTokens), hint: totals ? `输出 ${formatTokens(totals.outputTokens)} · 缓存读 ${formatTokens(totals.cacheReadTokens)}` : "" }),
            React.createElement(StatCard, { label: "成本（估）", value: totals ? formatCost(totals.costMicroUsd, totals.unknownCostTokens) : "未知", hint: totals?.unknownCostTokens > 0 ? `${formatTokens(totals.unknownCostTokens)} tokens 定价未知` : "LiteLLM 定价表" }),
            React.createElement(StatCard, { label: "会话数", value: String(totals?.sessionCount ?? 0) }),
            summary.remote?.records > 0
              ? React.createElement(StatCard, { label: "远程用量", value: formatTokens(summary.remote.tokens), hint: `${summary.remote.records} 条记录` })
              : null
          ),
          !hasData
            ? React.createElement("div", { className: "toolbox-empty" },
                React.createElement("span", { className: "toolbox-empty-icon" }, "◌"),
                React.createElement("strong", null, "暂无 token 记录"),
                React.createElement("span", null, "完成几次 Agent 会话后这里会出现统计"))
            : React.createElement(React.Fragment, null,
              React.createElement("div", { className: "usage-section" },
                React.createElement("h4", null, "趋势"),
                React.createElement(UsageTrendChart, { byDay: summary.byDay })
              ),
              React.createElement("div", { className: "usage-section" },
                React.createElement("h4", null, "活动热力图"),
                React.createElement(UsageHeatmap, { byDay: summary.byDay })
              ),
              React.createElement("div", { className: "usage-section" },
                React.createElement("h4", null, "按 Agent"),
                React.createElement(UsageTable, {
                  headers: ["Agent", "会话", "输入", "输出", "缓存", "成本"],
                  rows: summary.byAgent.map((a) => React.createElement("tr", { key: a.tool },
                    React.createElement("td", { className: "usage-cell-text" }, AGENT_TOOL_LABELS[a.tool] ?? a.tool),
                    React.createElement("td", { className: "usage-cell-text" }, String(a.sessionCount)),
                    React.createElement("td", { className: "usage-cell-text" }, formatTokens(a.inputTokens)),
                    React.createElement("td", { className: "usage-cell-text" }, formatTokens(a.outputTokens)),
                    React.createElement("td", { className: "usage-cell-text" }, formatTokens(a.cacheReadTokens + a.cacheCreationTokens)),
                    React.createElement("td", { className: "usage-cell-text" }, formatCost(a.costMicroUsd, a.unknownCostTokens))
                  )),
                  emptyText: "暂无 Agent 用量"
                })
              ),
              summary.byModel.length > 0 && React.createElement("div", { className: "usage-section" },
                React.createElement("h4", null, "按模型"),
                React.createElement(UsageTable, {
                  headers: ["模型", "输入", "输出", "缓存", "成本"],
                  rows: summary.byModel.map((m) => React.createElement("tr", { key: m.model },
                    React.createElement("td", { className: "usage-cell-text usage-model-name", title: m.model }, m.model),
                    React.createElement("td", { className: "usage-cell-text" }, formatTokens(m.inputTokens)),
                    React.createElement("td", { className: "usage-cell-text" }, formatTokens(m.outputTokens)),
                    React.createElement("td", { className: "usage-cell-text" }, formatTokens(m.cacheReadTokens + m.cacheCreationTokens)),
                    React.createElement("td", { className: "usage-cell-text" }, formatCost(m.costMicroUsd, m.unknownCostTokens))
                  )),
                  emptyText: "暂无模型用量"
                })
              )
            )
        )
        : React.createElement("div", { className: "usage-sessions" },
          !insights
            ? React.createElement("div", { className: "toolbox-empty" }, React.createElement("strong", null, "正在加载会话数据…"))
            : insights.sessions.length === 0
              ? React.createElement("div", { className: "toolbox-empty" },
                  React.createElement("span", { className: "toolbox-empty-icon" }, "◌"),
                  React.createElement("strong", null, "暂无会话记录"),
                  React.createElement("span", null, "会话完成并采集到 token 后出现在这里"))
              : React.createElement("div", { className: "usage-session-list" },
                  insights.sessions.map((s) => React.createElement("article", { key: s.sessionId, className: `usage-session is-${s.category}` },
                    React.createElement("div", { className: "usage-session-main" },
                      React.createElement("span", { className: "usage-session-tool" }, AGENT_TOOL_LABELS[s.tool] ?? s.tool),
                      React.createElement("span", { className: "usage-session-model", title: s.model }, s.model),
                      s.isRemote && React.createElement("span", { className: "usage-badge is-remote" }, "远程")
                    ),
                    React.createElement("div", { className: "usage-session-metrics" },
                      React.createElement("span", { title: "输出 tokens" }, `出 ${formatTokens(s.outputTokens)}`),
                      React.createElement("span", { title: "峰值上下文（估计）" }, `峰 ${formatTokens(s.peakContextTokens)}`),
                      React.createElement("span", { title: "活跃时长" }, formatDuration(s.durationMs))
                    ),
                    React.createElement("span", { className: `usage-badge is-${s.category}` }, CATEGORY_LABELS[s.category] ?? s.category)
                  ))
                )
        )
  );
}
