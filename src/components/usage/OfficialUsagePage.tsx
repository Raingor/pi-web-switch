import { useEffect, useMemo, useState } from "react";
import { Check, Gauge, KeyRound, Link2, Loader2, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type AuthMode = "auto" | "bearer" | "x-api-key" | "api-key";
interface UsageSummary { total: number; used: number; remaining: number; remainingPercent: number; unit: string; source: string; checkedAt: string; }
interface SavedConfig { endpoint: string; authMode: AuthMode; keyCount: number; maskedKeys: string[]; }

function formatQuota(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

export function OfficialUsagePage() {
  const { t } = useTranslation();
  const [endpoint, setEndpoint] = useState("");
  const [keysText, setKeysText] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("auto");
  const [saved, setSaved] = useState<SavedConfig | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    fetch("/api/pi/official-usage-config")
      .then((res) => res.json())
      .then(async (data: SavedConfig) => {
        setSaved(data);
        setEndpoint(data.endpoint || "");
        setAuthMode(data.authMode || "auto");
        if (data.endpoint && data.keyCount > 0) {
          const response = await fetch("/api/pi/official-usage-refresh", { method: "POST" });
          const result = await response.json();
          if (response.ok && result.success) setUsage(result.usage);
          else if (result.error) setError(result.error);
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const apiKeys = useMemo(() => keysText.split(/[\n,，;；]+/).map((key) => key.trim()).filter(Boolean), [keysText]);
  const canSubmit = endpoint.trim().length > 0 && apiKeys.length > 0 && !testing;

  const handleSaveAndTest = async () => {
    if (!canSubmit) return;
    setTesting(true); setError(""); setSavedMessage("");
    try {
      const response = await fetch("/api/pi/official-usage-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: endpoint.trim(), apiKeys, authMode }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || t("official_usage.query_failed"));
      setUsage(data.usage);
      setSaved({ endpoint: endpoint.trim(), authMode, keyCount: apiKeys.length, maskedKeys: apiKeys.map((key) => key.length > 8 ? `${key.slice(0, 4)}••••${key.slice(-4)}` : "••••••••") });
      setKeysText("");
      setSavedMessage(t("official_usage.saved_and_tested"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("official_usage.query_failed"));
    } finally { setTesting(false); }
  };

  const handleRefresh = async () => {
    if (!saved?.endpoint || !saved.keyCount) return;
    setError(""); setTesting(true);
    // Keys are intentionally never returned to the browser after save.
    // Refresh uses a server-side re-query endpoint with the stored config.
    try {
      const response = await fetch("/api/pi/official-usage-refresh", { method: "POST" });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || t("official_usage.query_failed"));
      setUsage(data.usage);
    } catch (e) { setError(e instanceof Error ? e.message : t("official_usage.query_failed")); }
    finally { setTesting(false); }
  };

  return (
    <div className="official-usage-page space-y-6">
      <header className="official-usage-header">
        <div>
          <div className="page-kicker"><span /> OFFICIAL USAGE // QUOTA MONITOR</div>
          <h1>{t("official_usage.title")}</h1>
          <p>{t("official_usage.subtitle")}</p>
        </div>
        <div className="official-usage-status"><span /> {t("official_usage.local_secure")}</div>
      </header>

      <section className="tech-panel official-usage-config">
        <div className="official-usage-section-head"><div><span>CONFIGURATION // 01</span><h2>{t("official_usage.endpoint_config")}</h2></div><ShieldCheck className="h-5 w-5" style={{ color: "var(--signal-cyan)" }} /></div>
        <div className="official-usage-form-grid">
          <label className="official-usage-field official-usage-field-wide"><span><Link2 />{t("official_usage.endpoint")}</span><input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.example.com/usage" /></label>
          <label className="official-usage-field"><span><KeyRound />{t("official_usage.auth_mode")}</span><select value={authMode} onChange={(e) => setAuthMode(e.target.value as AuthMode)}><option value="auto">{t("official_usage.auth_auto")}</option><option value="bearer">Bearer</option><option value="x-api-key">x-api-key</option><option value="api-key">api-key</option></select></label>
          <label className="official-usage-field official-usage-field-wide"><span><KeyRound />{t("official_usage.api_keys")}</span><textarea value={keysText} onChange={(e) => setKeysText(e.target.value)} placeholder={t("official_usage.api_keys_placeholder")} rows={3} /><small>{t("official_usage.api_keys_hint")}</small></label>
        </div>
        <div className="official-usage-actions"><button className="official-usage-primary" disabled={!canSubmit} onClick={handleSaveAndTest}>{testing ? <Loader2 className="animate-spin" /> : <Check />}{t("official_usage.save_and_test")}</button>{saved && <span className="official-usage-saved"><Check />{savedMessage || t("official_usage.configured_keys", String(saved.keyCount))}</span>}</div>
        {error && <div className="official-usage-error"><TriangleAlert />{error}</div>}
      </section>

      {loading ? <div className="official-usage-loading"><Loader2 className="animate-spin" />{t("official_usage.loading")}</div> : usage ? (
        <section className="official-usage-results">
          <div className="official-usage-result-header"><div><span>QUOTA TELEMETRY // 02</span><h2>{t("official_usage.current_quota")}</h2></div><button onClick={handleRefresh} disabled={testing} className="official-usage-refresh"><RefreshCw className={cn(testing && "animate-spin")} />{t("official_usage.refresh")}</button></div>
          <div className="official-usage-cards"><div className="tech-panel official-usage-card"><span>{t("official_usage.total_quota")}</span><strong>{formatQuota(usage.total)}</strong><small>{usage.unit}</small></div><div className="tech-panel official-usage-card"><span>{t("official_usage.used_quota")}</span><strong>{formatQuota(usage.used)}</strong><small>{usage.unit}</small></div><div className="tech-panel official-usage-card"><span>{t("official_usage.remaining_quota")}</span><strong>{formatQuota(usage.remaining)}</strong><small>{usage.unit}</small></div></div>
          <div className="tech-panel official-usage-progress"><div className="official-usage-progress-head"><span>{t("official_usage.remaining_percent")}</span><strong>{usage.remainingPercent.toFixed(1)}%</strong></div><div className="official-usage-progress-track"><span style={{ width: `${usage.remainingPercent}%` }} /></div><div className="official-usage-progress-foot"><span>{t("official_usage.used_percent", (100 - usage.remainingPercent).toFixed(1))}</span><span>{new Date(usage.checkedAt).toLocaleString()}</span></div></div>
        </section>
      ) : <div className="official-usage-empty tech-panel"><Gauge /><h2>{t("official_usage.no_result")}</h2><p>{t("official_usage.no_result_desc")}</p></div>}
    </div>
  );
}
