import { useConfigStore } from "@/store/config-store";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { formatTokens, formatCost, formatNumber, formatDate } from "@/lib/utils";
import {
  BarChart3,
  DollarSign,
  Activity,
  Cpu,
  Zap,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

const COLORS = [
  "#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

export function DashboardPage() {
  const { totals, dailyAggregates, providerSummaries, modelSummaries, allProviders } = useConfigStore();

  const activeProviders = allProviders.filter((p) => p.models.some((m) => m.enabled));
  const activeModels = allProviders.flatMap((p) =>
    p.models.filter((m) => m.enabled).map((m) => ({ ...m, provider: p.name }))
  );

  const dailyChartData = dailyAggregates.map((d) => ({
    date: formatDate(d.date),
    tokens: Math.round(d.totalTokens / 1000),
    cost: parseFloat(d.totalCost.toFixed(2)),
    requests: d.totalRequests,
  }));

  const costByProvider = providerSummaries
    .map((p) => ({
      name: allProviders.find((ap) => ap.id === p.providerId)?.name ?? p.providerId,
      value: parseFloat(p.totalCost.toFixed(2)),
    }))
    .filter((p) => p.value > 0);

  const last7Days = dailyAggregates.slice(-7);
  const weekTrend = last7Days.length >= 2
    ? last7Days[last7Days.length - 1]!.totalCost - last7Days[0]!.totalCost
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-400">
          Token usage and cost overview for the last 30 days
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Tokens"
          value={formatTokens(totals.totalTokens)}
          subtitle="30-day cumulative"
          icon={<Activity className="h-5 w-5" />}
          trend={{ value: "+12.3% vs last period", positive: true }}
        />
        <StatCard
          title="Total Cost"
          value={formatCost(totals.totalCost)}
          subtitle={`$${totals.totalCost.toFixed(2)} USD`}
          icon={<DollarSign className="h-5 w-5" />}
          trend={{
            value: `${weekTrend >= 0 ? "+" : ""}$${Math.abs(weekTrend).toFixed(2)} this week`,
            positive: weekTrend <= 0,
          }}
        />
        <StatCard
          title="Total Requests"
          value={formatNumber(totals.totalRequests)}
          subtitle="API calls made"
          icon={<BarChart3 className="h-5 w-5" />}
          trend={{ value: "+8.7% vs last period", positive: true }}
        />
        <StatCard
          title="Active Providers"
          value={formatNumber(activeProviders.length)}
          subtitle={`${activeModels.length} models enabled`}
          icon={<Cpu className="h-5 w-5" />}
        />
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Token Usage Trend */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
          <h3 className="mb-4 text-sm font-semibold text-gray-300">Token Usage (K tokens/day)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={dailyChartData}>
              <defs>
                <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: "8px",
                  color: "#e5e7eb",
                }}
              />
              <Area
                type="monotone"
                dataKey="tokens"
                stroke="#3b82f6"
                fill="url(#tokenGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Daily Cost */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
          <h3 className="mb-4 text-sm font-semibold text-gray-300">Daily Cost ($)</h3>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={dailyChartData}>
              <defs>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: "8px",
                  color: "#e5e7eb",
                }}
              />
              <Area
                type="monotone"
                dataKey="cost"
                stroke="#10b981"
                fill="url(#costGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Request Volume */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
          <h3 className="mb-4 text-sm font-semibold text-gray-300">Request Volume</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={dailyChartData.slice(-14)}>
              <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: "8px",
                  color: "#e5e7eb",
                }}
              />
              <Bar dataKey="requests" fill="#6366f1" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Cost by Provider */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-6">
          <h3 className="mb-4 text-sm font-semibold text-gray-300">Cost by Provider</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={costByProvider}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
              >
                {costByProvider.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: "8px",
                  color: "#e5e7eb",
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: "11px", color: "#9ca3af" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Provider Usage Table */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/50">
        <div className="border-b border-gray-800 px-6 py-4">
          <h3 className="text-sm font-semibold text-gray-300">Provider Usage Summary</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                <th className="px-6 py-3 font-medium">Provider</th>
                <th className="px-6 py-3 font-medium">Total Tokens</th>
                <th className="px-6 py-3 font-medium">Total Cost</th>
                <th className="px-6 py-3 font-medium">Requests</th>
                <th className="px-6 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {providerSummaries.map((p) => {
                const provider = allProviders.find((ap) => ap.id === p.providerId);
                return (
                  <tr key={p.providerId} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30">
                    <td className="px-6 py-3">
                      <span className="font-medium text-white">{provider?.name ?? p.providerId}</span>
                    </td>
                    <td className="px-6 py-3 text-gray-400">{formatTokens(p.totalTokens)}</td>
                    <td className="px-6 py-3 text-gray-400">{formatCost(p.totalCost)}</td>
                    <td className="px-6 py-3 text-gray-400">{formatNumber(p.totalRequests)}</td>
                    <td className="px-6 py-3">
                      <Badge variant={provider?.hasAuth ? "success" : "warning"}>
                        {provider?.hasAuth ? "Configured" : "No Auth"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}