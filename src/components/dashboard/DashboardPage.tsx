import { useState, useEffect, useCallback } from "react";
import { useConfigStore } from "@/store/config-store";
import { useTranslation } from "@/lib/i18n";
import { useCurrency } from "@/lib/currency";
import { formatTokens, formatCost, formatNumber, cn, USD_TO_CNY } from "@/lib/utils";
import {
  Activity, DollarSign, BarChart3, ArrowUp, ArrowDown, Database, DollarSignIcon,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from "recharts";

// ─── Types ──────────────────────────────────────────────

interface UsageRangeData {
  totalTokens: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalCost: number;
  totalRequests: number;
  cacheHitRate: number;
  dailyBreakdown: {
    date: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    requests: number;
  }[];
  hourlyBreakdown: {
    hour: string;
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
    requests: number;
  }[];
  requestLog: {
    timestamp: string;
    providerId: string;
    modelId: string;
    input: number;
    output: number;
    cost: number;
    requests: number;
  }[];
  providerStats: {
    providerId: string;
    totalTokens: number;
    totalInput: number;
    totalOutput: number;
    totalCost: number;
    totalRequests: number;
    modelCount: number;
  }[];
  modelStats: {
    modelId: string;
    providerId: string;
    totalTokens: number;
    totalInput: number;
    totalOutput: number;
    totalCost: number;
    totalRequests: number;
  }[];
}

type RangeKey = "today" | "7d" | "30d" | "custom";
type TabKey = "log" | "provider" | "model";

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 Days" },
  { key: "30d", label: "30 Days" },
  { key: "custom", label: "Custom" },
];

const COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444"];

const CHART_LINE_COLORS: Record<string, string> = {
  input: "#3b82f6",
  output: "#10b981",
  cacheRead: "#8b5cf6",
  cacheWrite: "#f59e0b",
  cost: "#ef4444",
};

const CHART_LABELS: Record<string, string> = {
  input: "Input",
  output: "Output",
  cacheRead: "Cache Hit",
  cacheWrite: "Cache Create",
  cost: "Cost",
};

// ─── Helpers ────────────────────────────────────────────

function formatTokensShort(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCostShort(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `¢${(n * 100).toFixed(1)}`;
  return `$${n.toFixed(4)}`;
}

function formatCostShortCNY(n: number): string {
  const cny = n * USD_TO_CNY;
  if (cny >= 1) return `¥${cny.toFixed(2)}`;
  return `¥${cny.toFixed(4)}`;
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── Stat Card ──────────────────────────────────────────

function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendLabel,
  progress,
  children,
  className,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: number;
  trendLabel?: string;
  progress?: number;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border p-5", className)} style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}>
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium uppercase tracking-wider" style={{ color: "var(--muted-text)" }}>{title}</p>
        <div className="rounded-lg p-2" style={{ backgroundColor: "var(--accent-bg)" }}>
          {icon}
        </div>
      </div>
      <p className="text-2xl font-bold tracking-tight" style={{ color: "var(--page-text)" }}>{value}</p>
      {subtitle && <p className="text-xs mt-1" style={{ color: "var(--subtle-text)" }}>{subtitle}</p>}
      {trend !== undefined && (
        <div className="flex items-center gap-1 mt-2">
          {trend >= 0 ? (
            <ArrowUp className="h-3 w-3 text-emerald-400" />
          ) : (
            <ArrowDown className="h-3 w-3 text-red-400" />
          )}
          <span className={cn("text-xs font-medium", trend >= 0 ? "text-emerald-400" : "text-red-400")}>
            {Math.abs(trend).toFixed(1)}%
          </span>
          {trendLabel && <span className="text-xs" style={{ color: "var(--subtle-text)" }}>{trendLabel}</span>}
        </div>
      )}
      {progress !== undefined && (
        <div className="mt-2 h-1.5 w-full rounded-full" style={{ backgroundColor: "var(--card-border)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(progress, 100)}%`, backgroundColor: progress > 90 ? "#10b981" : "#3b82f6" }}
          />
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Breakdown Row ──────────────────────────────────────

function BreakdownRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-xs" style={{ color: "var(--muted-text)" }}>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium" style={{ color: "var(--page-text)" }}>{formatTokensShort(value)}</span>
        <span className="text-xs" style={{ color: "var(--subtle-text)" }}>({pct.toFixed(1)}%)</span>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────

export function DashboardPage() {
  const { t } = useTranslation();
  const { currency, toggle: toggleCurrency } = useCurrency();
  const { initialized } = useConfigStore();
  const [range, setRange] = useState<RangeKey>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [tab, setTab] = useState<TabKey>("log");
  const [data, setData] = useState<UsageRangeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [showIntervalPicker, setShowIntervalPicker] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    if (!initialized) return;
    let url = "/api/pi/usage-range?range=" + range;
    if (range === "custom" && customFrom) {
      url += `&from=${customFrom}&to=${customTo || customFrom}`;
    }
    fetch(url)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); setLastUpdated(new Date().toLocaleTimeString()); })
      .catch(() => setLoading(false));
  }, [initialized, range, customFrom, customTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-refresh with configurable interval (seconds)
  useEffect(() => {
    if (!autoRefresh || refreshInterval <= 0) return;
    const id = setInterval(fetchData, refreshInterval * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, refreshInterval, fetchData]);

  const today = new Date().toISOString().split("T")[0];

  // Chart data: hourly for "today", daily for 7d/30d/custom
  const rawBreakdown = range === "today" ? data?.hourlyBreakdown : data?.dailyBreakdown;
  const chartData = (rawBreakdown ?? []).map((d: any) => ({
    date: range === "today" ? d.hour?.slice(-5) : formatDateShort(d.date || d.hour),
    rawDate: d.date || d.hour,
    input: Math.round(d.input / 1000),
    output: Math.round(d.output / 1000),
    cacheRead: Math.round(d.cacheRead / 1000),
    cacheWrite: Math.round(d.cacheWrite / 1000),
    cost: parseFloat(d.cost.toFixed(4)),
    requests: d.requests,
  }));

  return (
    <div className="space-y-5">
      {/* Title + Time Range Selector + Currency Toggle */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--page-text)" }}>{t("dashboard.title")}</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--muted-text)" }}>
            {data ? t("dashboard.requests_count", String(data.requestLog.length), formatCost(data.totalCost, currency)) : ""}
            {lastUpdated && <span className="ml-2">· Last updated {lastUpdated}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleCurrency}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            style={{ borderColor: "var(--card-border)", color: "var(--muted-text)", backgroundColor: "var(--card-bg)" }}
            title={currency === "USD" ? "Switch to CNY" : "Switch to USD"}
          >
            <DollarSignIcon className="h-3.5 w-3.5" />
            {currency}
          </button>
          <div className="relative">
            <button
              onClick={() => setShowIntervalPicker(!showIntervalPicker)}
              onBlur={() => setTimeout(() => setShowIntervalPicker(false), 200)}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                borderColor: "var(--card-border)",
                color: autoRefresh ? "#10b981" : "var(--muted-text)",
                backgroundColor: "var(--card-bg)",
              }}
            >
              <span className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: autoRefresh ? "#10b981" : "var(--subtle-text)" }} />
              {autoRefresh ? `${refreshInterval}s` : "Off"}
            </button>
            {showIntervalPicker && (
              <div
                className="absolute right-0 top-full mt-1 z-50 w-24 rounded-xl border shadow-2xl overflow-hidden"
                style={{
                  backgroundColor: "var(--card-bg)",
                  borderColor: "var(--card-border)",
                }}
              >
                <div className="px-4 py-2 text-xs font-medium border-b" style={{ color: "var(--muted-text)", borderColor: "var(--card-border)" }}>
                  {t("dashboard.range.today")}
                </div>
                {[5, 10, 30, 60].map((s) => (
                  <button
                    key={s}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setRefreshInterval(s);
                      setAutoRefresh(true);
                      setShowIntervalPicker(false);
                    }}
                    className="flex w-full items-center justify-between px-4 py-2 text-xs transition-colors"
                    style={{
                      backgroundColor: refreshInterval === s && autoRefresh ? "var(--hover-bg)" : "transparent",
                      color: "var(--page-text)",
                    }}
                  >
                    <span className={refreshInterval === s && autoRefresh ? "font-medium" : ""}>{s}s</span>
                    {refreshInterval === s && autoRefresh && (
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth={3}>
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-lg border p-0.5" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--page-bg)" }}>
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setRange(opt.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                range === opt.key
                  ? "text-white"
                  : "hover:bg-gray-800/30"
              )}
              style={range === opt.key ? { backgroundColor: "#3b82f6", color: "#fff" } : { color: "var(--muted-text)" }}
            >
              {t("dashboard.range." + opt.key)}
            </button>
          ))}
            </div>
          </div>
        </div>

      {/* Custom Date Picker */}
      {range === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customFrom || today}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--input-text)" }}
          />
          <span className="text-xs" style={{ color: "var(--muted-text)" }}>{t("dashboard.to")}</span>
          <input
            type="date"
            value={customTo || today}
            onChange={(e) => setCustomTo(e.target.value)}
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ backgroundColor: "var(--input-bg)", borderColor: "var(--input-border)", color: "var(--input-text)" }}
          />
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
        </div>
      )}

      {!loading && data && (
        <>
          {/* Overview Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title={t("dashboard.total_tokens")}
              value={data.totalTokens.toLocaleString("en-US")}
              icon={<Activity className="h-4 w-4" style={{ color: "#3b82f6" }} />}
              subtitle={`≈ ${formatTokensShort(data.totalTokens)}`}
            >
              <div className="mt-3 space-y-0.5 border-t pt-3" style={{ borderColor: "var(--card-border)" }}>
                <BreakdownRow label={t("dashboard.input")} value={data.totalInput} total={data.totalTokens} color="#3b82f6" />
                <BreakdownRow label={t("dashboard.output")} value={data.totalOutput} total={data.totalTokens} color="#10b981" />
                <BreakdownRow label={t("dashboard.cache_create")} value={data.totalCacheWrite} total={data.totalTokens} color="#f59e0b" />
                <BreakdownRow label={t("dashboard.cache_hit")} value={data.totalCacheRead} total={data.totalTokens} color="#8b5cf6" />
              </div>
            </StatCard>

            <StatCard
              title={t("dashboard.total_requests")}
              value={formatNumber(data.totalRequests)}
              icon={<BarChart3 className="h-4 w-4" style={{ color: "#10b981" }} />}
              subtitle={t("dashboard.api_calls")}
            />

            <StatCard
              title={t("dashboard.total_cost")}
              value={formatCost(data.totalCost)}
              icon={<DollarSign className="h-4 w-4" style={{ color: "#f59e0b" }} />}
              subtitle={`${currency === "CNY" ? `¥${(data.totalCost * USD_TO_CNY).toFixed(4)}` : `$${data.totalCost.toFixed(4)}`} ${currency}`}
            />

            <StatCard
              title={t("dashboard.cache_hit_rate")}
              value={`${data.cacheHitRate}%`}
              icon={<Database className="h-4 w-4" style={{ color: "#8b5cf6" }} />}
              progress={data.cacheHitRate}
            />
          </div>

          {/* Usage Trend Chart */}
          <div className="rounded-xl border p-5" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}>
            <h3 className="text-sm font-semibold mb-1" style={{ color: "var(--page-text)" }}>{t("dashboard.usage_trend")}</h3>
            <p className="text-xs mb-4" style={{ color: "var(--muted-text)" }}>
              {range === "today" ? t("dashboard.range.today") : `${formatDateShort(chartData[0]?.rawDate || "")} - ${formatDateShort(chartData[chartData.length - 1]?.rawDate || "")}`}
            </p>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-text)" }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="tokens" tick={{ fontSize: 11, fill: "var(--muted-text)" }} axisLine={false} tickLine={false} label={{ value: t("dashboard.tokens_k"), angle: -90, position: "insideLeft", style: { fill: "var(--muted-text)", fontSize: 11 } }} />
                <YAxis yAxisId="cost" orientation="right" tick={{ fontSize: 11, fill: "var(--muted-text)" }} axisLine={false} tickLine={false} label={{ value: t("dashboard.cost_label"), angle: 90, position: "insideRight", style: { fill: "var(--muted-text)", fontSize: 11 } }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--card-bg)",
                    border: "1px solid var(--card-border)",
                    borderRadius: "8px",
                    color: "var(--page-text)",
                    fontSize: "12px",
                  }}
                />
                <Area yAxisId="tokens" type="monotone" dataKey="input" stroke={CHART_LINE_COLORS.input} fill="none" strokeWidth={2} dot={false} name={t("dashboard.input")} />
                <Area yAxisId="tokens" type="monotone" dataKey="output" stroke={CHART_LINE_COLORS.output} fill="none" strokeWidth={2} dot={false} name={t("dashboard.output")} />
                <Area yAxisId="tokens" type="monotone" dataKey="cacheRead" stroke={CHART_LINE_COLORS.cacheRead} fill="none" strokeWidth={2} strokeDasharray="4 2" dot={false} name={t("dashboard.cache_hit")} />
                <Area yAxisId="tokens" type="monotone" dataKey="cacheWrite" stroke={CHART_LINE_COLORS.cacheWrite} fill="none" strokeWidth={2} strokeDasharray="2 2" dot={false} name={t("dashboard.cache_create")} />
                <Area yAxisId="cost" type="monotone" dataKey="cost" stroke={CHART_LINE_COLORS.cost} fill="none" strokeWidth={2} strokeDasharray="6 3" dot={false} name={t("dashboard.cost")} />
                <Legend
                  wrapperStyle={{ fontSize: "11px", color: "var(--muted-text)", paddingTop: "8px" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Tabs: Request Log / Provider / Model */}
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--card-border)", backgroundColor: "var(--card-bg)" }}>
            {/* Tab Header */}
            <div className="flex border-b" style={{ borderColor: "var(--card-border)" }}>
              {([
                { key: "log" as TabKey, label: "dashboard.request_log" },
                { key: "provider" as TabKey, label: "dashboard.provider_stats" },
                { key: "model" as TabKey, label: "dashboard.model_stats" },
              ]).map((tabItem) => (
                <button
                  key={tabItem.key}
                  onClick={() => setTab(tabItem.key)}
                  className={cn(
                    "px-5 py-3 text-xs font-medium border-b-2 transition-colors",
                    tab === tabItem.key ? "" : "border-transparent"
                  )}
                  style={{
                    color: tab === tabItem.key ? "#3b82f6" : "var(--muted-text)",
                    borderBottomColor: tab === tabItem.key ? "#3b82f6" : "transparent",
                  }}
                >
                  {t(tabItem.label)}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="overflow-x-auto">
              {tab === "log" && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--card-border)" }}>
                      <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.time")}</th>
                      <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.provider")}</th>
                      <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.model")}</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.input")}</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.output")}</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.cost")}</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.requests")}</th>
                      <th className="px-4 py-3 text-center font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.requestLog.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center" style={{ color: "var(--subtle-text)" }}>
                          {t("dashboard.no_data")}
                        </td>
                      </tr>
                    ) : (
                      data.requestLog.slice(0, 100).map((r, i) => (
                        <tr key={i} className="border-b" style={{ borderColor: "var(--card-border)" }}>
                          <td className="px-4 py-2.5 whitespace-nowrap" style={{ color: "var(--page-text)" }}>{r.timestamp}</td>
                          <td className="px-4 py-2.5" style={{ color: "var(--page-text)" }}>{r.providerId}</td>
                          <td className="px-4 py-2.5" style={{ color: "var(--page-text)" }}>{r.modelId}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(r.input)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(r.output)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{currency === "CNY" ? `¥${(r.cost * USD_TO_CNY).toFixed(4)}` : formatCostShort(r.cost)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{r.requests}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium text-emerald-400" style={{ backgroundColor: "rgba(16,185,129,0.1)" }}>
                              200
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {tab === "provider" && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--card-border)" }}>
                      <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.provider")}</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>Tokens</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.input")}</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.output")}</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.cost")}</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.requests")}</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>Models</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.providerStats.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: "var(--subtle-text)" }}>{t("dashboard.no_data")}</td></tr>
                    ) : (
                      data.providerStats.map((p, i) => (
                        <tr key={i} className="border-b" style={{ borderColor: "var(--card-border)" }}>
                          <td className="px-4 py-2.5 font-medium" style={{ color: "var(--page-text)" }}>{p.providerId}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(p.totalTokens)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(p.totalInput)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(p.totalOutput)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{currency === "CNY" ? `¥${(p.totalCost * USD_TO_CNY).toFixed(4)}` : formatCostShort(p.totalCost)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{p.totalRequests}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{p.modelCount}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}

              {tab === "model" && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--card-border)" }}>
                      <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.model")}</th>
                      <th className="px-4 py-3 text-left font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.provider")}</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>Tokens</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.input")}</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.output")}</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.cost")}</th>
                      <th className="px-4 py-3 text-right font-medium" style={{ color: "var(--muted-text)" }}>{t("dashboard.requests")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.modelStats.length === 0 ? (
                      <tr><td colSpan={7} className="px-4 py-8 text-center" style={{ color: "var(--subtle-text)" }}>{t("dashboard.no_data")}</td></tr>
                    ) : (
                      data.modelStats.map((m, i) => (
                        <tr key={i} className="border-b" style={{ borderColor: "var(--card-border)" }}>
                          <td className="px-4 py-2.5 font-medium" style={{ color: "var(--page-text)" }}>{m.modelId}</td>
                          <td className="px-4 py-2.5" style={{ color: "var(--page-text)" }}>{m.providerId}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(m.totalTokens)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(m.totalInput)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{formatTokensShort(m.totalOutput)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{currency === "CNY" ? `¥${(m.totalCost * USD_TO_CNY).toFixed(4)}` : formatCostShort(m.totalCost)}</td>
                          <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--page-text)" }}>{m.totalRequests}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TablePlaceholder({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <p className="text-sm" style={{ color: "var(--subtle-text)" }}>{message}</p>
    </div>
  );
}
