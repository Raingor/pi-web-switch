import { useMemo, useState } from "react";
import { Gauge, Loader2, Zap, Check, X, RotateCcw } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useConfigStore } from "@/store/config-store";
import { cn } from "@/lib/utils";
import type { Provider, Model } from "@/types";

// Per-model speed-test result. successCount / total drive the success rate;
// latencies collects each successful call's latency for avg/min/max.
interface ModelResult {
  status: "idle" | "testing" | "done";
  runs: number;
  success: number;
  latencies: number[];
  lastMessage?: string;
}

const RUNS_PER_MODEL = 3; // sequential calls per model to derive a rate

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function ModelSpeedTestPage() {
  const { t } = useTranslation();
  const { allProviders, auth } = useConfigStore();

  // Resolve a usable API key for a provider (models.json apiKey or auth.json).
  const keyOf = (p: Provider) => p.apiKey ?? auth?.[p.id]?.key ?? "";

  // Custom providers only (built-in providers are excluded from speed tests).
  const testableProviders = useMemo(
    () => allProviders.filter((p) => p.type === "custom" && (p.baseUrl ?? "").trim() !== "" && p.models.length > 0),
    [allProviders]
  );

  const [selectedId, setSelectedId] = useState<string | null>(
    testableProviders[0]?.id ?? null
  );
  const selected = testableProviders.find((p) => p.id === selectedId) ?? testableProviders[0] ?? null;

  const [results, setResults] = useState<Map<string, ModelResult>>(new Map());
  const [running, setRunning] = useState(false);

  const setResult = (modelId: string, patch: Partial<ModelResult>) => {
    setResults((prev) => {
      const next = new Map(prev);
      const cur = next.get(modelId) ?? { status: "idle", runs: 0, success: 0, latencies: [] };
      next.set(modelId, { ...cur, ...patch });
      return next;
    });
  };

  const testModelOnce = async (provider: Provider, model: Model) => {
    const res = await fetch("/api/pi/model-test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: (model.baseUrl ?? provider.baseUrl ?? "").trim(),
        modelId: model.id,
        apiKey: keyOf(provider),
        apiType: model.api ?? provider.api ?? undefined,
      }),
    });
    return res.json() as Promise<{ success: boolean; latencyMs?: number; message?: string }>;
  };

  const testOneModel = async (provider: Provider, model: Model) => {
    setResults((prev) => {
      const next = new Map(prev);
      next.set(model.id, { status: "testing", runs: 0, success: 0, latencies: [] });
      return next;
    });
    let success = 0;
    const latencies: number[] = [];
    let lastMessage: string | undefined;
    for (let i = 0; i < RUNS_PER_MODEL; i++) {
      try {
        const data = await testModelOnce(provider, model);
        if (data.success) {
          success++;
          if (typeof data.latencyMs === "number") latencies.push(data.latencyMs);
        } else {
          lastMessage = data.message;
        }
      } catch {
        lastMessage = "network error";
      }
      setResult(model.id, { status: "testing", runs: i + 1, success, latencies, lastMessage });
    }
    setResult(model.id, { status: "done", runs: RUNS_PER_MODEL, success, latencies, lastMessage });
  };

  const runAll = async () => {
    if (!selected || running) return;
    setRunning(true);
    setResults(new Map());
    try {
      for (const model of selected.models) {
        await testOneModel(selected, model);
      }
    } finally {
      setRunning(false);
    }
  };

  const resetResults = () => {
    if (running) return;
    setResults(new Map());
  };

  return (
    <div className="space-y-6 providers-page">
      <div className="providers-command-header">
        <div>
          <div className="page-kicker"><span /> MODEL BENCHMARK // LATENCY MATRIX</div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--page-text)" }}>
            {t("speed_test.title")}
          </h1>
          <p className="mt-1 text-sm" style={{ color: "var(--muted-text)" }}>
            {t("speed_test.subtitle")}
          </p>
        </div>
        <div className="providers-header-signal"><span /> {t("speed_test.runs_note", String(RUNS_PER_MODEL))}</div>
      </div>

      {testableProviders.length === 0 ? (
        <div className="tech-panel flex flex-col items-center gap-2 rounded-xl p-10 text-center">
          <Gauge className="h-8 w-8" style={{ color: "var(--muted-text)" }} />
          <h2 className="text-lg font-semibold" style={{ color: "var(--page-text)" }}>{t("speed_test.no_provider")}</h2>
          <p className="text-sm" style={{ color: "var(--muted-text)" }}>{t("speed_test.no_provider_desc")}</p>
        </div>
      ) : (
        <div className="providers-console flex overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50">
          {/* Left: provider picker */}
          <div className="provider-rail w-60 shrink-0 border-r border-gray-800 p-3">
            <p className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-gray-500">
              {t("speed_test.providers")} ({testableProviders.length})
            </p>
            <div className="space-y-0.5">
              {testableProviders.map((p) => (
                <button
                  key={p.id}
                  disabled={running}
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:opacity-50",
                    selected?.id === p.id
                      ? "border-blue-500 bg-blue-500/10 text-white"
                      : "border-transparent text-gray-300 hover:bg-gray-800 hover:text-white"
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="shrink-0 rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-[10px] font-mono text-gray-400">
                    {p.models.length}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Right: model speed results */}
          <div className="flex-1 space-y-4 p-4">
            {selected && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-white">{selected.name}</h2>
                    <p className="text-xs text-gray-500">{selected.models.length} {t("speed_test.models")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={resetResults}
                      disabled={running || results.size === 0}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RotateCcw className="h-4 w-4" />
                      {t("speed_test.reset")}
                    </button>
                    <button
                      onClick={runAll}
                      disabled={running}
                      className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ backgroundColor: "#3b82f6" }}
                    >
                      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                      {running ? t("speed_test.testing") : t("speed_test.run_all")}
                    </button>
                  </div>
                </div>

                <div className="overflow-hidden rounded-lg border border-gray-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-left text-xs uppercase tracking-wider text-gray-500">
                        <th className="px-3 py-2 font-medium">{t("speed_test.col_model")}</th>
                        <th className="px-3 py-2 font-medium text-right">{t("speed_test.col_success_rate")}</th>
                        <th className="px-3 py-2 font-medium text-right">{t("speed_test.col_avg_latency")}</th>
                        <th className="px-3 py-2 font-medium text-right">{t("speed_test.col_range")}</th>
                        <th className="px-3 py-2 font-medium">{t("speed_test.col_status")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.models.map((m) => {
                        const r = results.get(m.id);
                        const rate = r && r.runs > 0 ? Math.round((r.success / r.runs) * 100) : null;
                        const avgMs = r ? avg(r.latencies) : 0;
                        const minMs = r && r.latencies.length ? Math.min(...r.latencies) : 0;
                        const maxMs = r && r.latencies.length ? Math.max(...r.latencies) : 0;
                        return (
                          <tr key={m.id} className="border-b border-gray-800/60 last:border-0">
                            <td className="px-3 py-2">
                              <span className="font-mono text-gray-200">{m.id}</span>
                            </td>
                            <td className="px-3 py-2 text-right">
                              {rate === null ? (
                                <span className="text-gray-600">—</span>
                              ) : (
                                <span className={cn(
                                  "font-mono",
                                  rate >= 100 ? "text-emerald-400" : rate > 0 ? "text-amber-400" : "text-red-400"
                                )}>
                                  {rate}% ({r!.success}/{r!.runs})
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-gray-300">
                              {avgMs > 0 ? `${avgMs} ms` : <span className="text-gray-600">—</span>}
                            </td>
                            <td className="px-3 py-2 text-right font-mono text-xs text-gray-500">
                              {minMs > 0 ? `${minMs}–${maxMs}` : "—"}
                            </td>
                            <td className="px-3 py-2">
                              {!r || r.status === "idle" ? (
                                <span className="text-xs text-gray-600">{t("speed_test.pending")}</span>
                              ) : r.status === "testing" ? (
                                <span className="flex items-center gap-1 text-xs text-gray-400">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  {t("speed_test.testing")} {r.runs}/{RUNS_PER_MODEL}
                                </span>
                              ) : r.success === r.runs ? (
                                <span className="flex items-center gap-1 text-xs text-emerald-400">
                                  <Check className="h-3.5 w-3.5" />
                                  {t("speed_test.ok")}
                                </span>
                              ) : r.success > 0 ? (
                                <span className="flex items-center gap-1 text-xs text-amber-400">
                                  <Check className="h-3.5 w-3.5" />
                                  {t("speed_test.partial")}
                                </span>
                              ) : (
                                <span className="flex items-center gap-1 text-xs text-red-400" title={r.lastMessage}>
                                  <X className="h-3.5 w-3.5" />
                                  {r.lastMessage ? r.lastMessage.slice(0, 40) : t("speed_test.fail")}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
