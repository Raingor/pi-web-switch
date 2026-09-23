import { useEffect, useState } from "react";
import { Check, ExternalLink, Eye, EyeOff, FileJson, KeyRound, Loader2, Play, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface TypeSafeConfigView {
  baseUrl: string;
  model: string;
  hasKey: boolean;
  maskedKey: string;
}

interface EvaluationResult {
  success: boolean;
  status?: number;
  latencyMs?: number;
  data?: unknown;
  message?: string;
}

const DEFAULT_STATE = "Help! My payouts have been failing for 3 days.";
const DEFAULT_QUESTIONS = JSON.stringify({
  is_urgent: {
    type: "noul",
    instructions: "Does this message convey urgency or time-sensitivity?",
  },
  department: {
    type: "choice",
    instructions: "Which team should handle this request?",
    criteria: {
      billing: "Payments, invoicing, refunds",
      technical: "Bugs, outages, integrations",
      sales: "Pricing, upgrades, new accounts",
    },
  },
}, null, 2);

const inputClass = "w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-gray-100 outline-none placeholder:text-gray-600 focus:border-blue-500";
const labelClass = "mb-1.5 block text-xs font-medium text-gray-400";

function prettyJson(value: unknown): string {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function JevPage() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<TypeSafeConfigView | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState("jev-latest");
  const [state, setState] = useState(DEFAULT_STATE);
  const [questions, setQuestions] = useState(DEFAULT_QUESTIONS);
  const [stateIsJson, setStateIsJson] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<EvaluationResult | null>(null);

  const loadConfig = () => {
    fetch("/api/pi/typesafe-config")
      .then((res) => res.json())
      .then((data: TypeSafeConfigView) => {
        setConfig(data);
        setModel(data.model || "jev-latest");
      })
      .catch(() => setConfig({ baseUrl: "https://api.typesafe.ai/v1", model: "jev-latest", hasKey: false, maskedKey: "" }));
  };

  useEffect(loadConfig, []);

  const saveConfig = async () => {
    setSaving(true);
    setError("");
    try {
      const body: { model: string; apiKey?: string } = { model };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      const response = await fetch("/api/pi/typesafe-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { success?: boolean };
      if (!data.success) throw new Error(t("jev.save_failed"));
      setApiKey("");
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
      loadConfig();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("jev.save_failed"));
    } finally {
      setSaving(false);
    }
  };

  const resetExample = () => {
    setState(DEFAULT_STATE);
    setQuestions(DEFAULT_QUESTIONS);
    setStateIsJson(false);
    setError("");
    setResult(null);
  };

  const evaluate = async () => {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      let parsedQuestions: unknown;
      try { parsedQuestions = JSON.parse(questions); } catch { throw new Error(t("jev.invalid_questions")); }
      if (!parsedQuestions || typeof parsedQuestions !== "object" || Array.isArray(parsedQuestions)) {
        throw new Error(t("jev.invalid_questions"));
      }
      let parsedState: unknown = state;
      if (stateIsJson) {
        try { parsedState = JSON.parse(state); } catch { throw new Error(t("jev.invalid_state")); }
      }
      const response = await fetch("/api/pi/typesafe-evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: parsedState, questions: parsedQuestions, model }),
      });
      const data = (await response.json()) as EvaluationResult;
      setResult(data);
      if (!data.success) setError(`${data.status ? `HTTP ${data.status}: ` : ""}${data.message || t("jev.evaluate_failed")}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("jev.evaluate_failed"));
    } finally {
      setBusy(false);
    }
  };

  const ready = !!config?.hasKey;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
            <h1 className="text-xl font-semibold text-white">{t("jev.title")}</h1>
          </div>
          <p className="mt-1 text-sm text-gray-400">{t("jev.subtitle")}</p>
        </div>
        <a
          href="https://docs.typesafe.ai/"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-300 hover:bg-gray-800"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t("jev.docs")}
        </a>
      </div>

      <section className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white"><KeyRound className="h-4 w-4 text-blue-400" />{t("jev.provider")}</h2>
            <p className="mt-1 text-xs text-gray-500">{t("jev.provider_desc")}</p>
          </div>
          {ready && <span className="flex items-center gap-1 text-xs text-emerald-400"><Check className="h-3.5 w-3.5" />{t("jev.configured")}</span>}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_220px]">
          <div>
            <label className={labelClass}>{t("jev.api_key")}</label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={ready ? config?.maskedKey : "ts_..."}
                className={`${inputClass} pr-10`}
              />
              <button type="button" onClick={() => setShowKey((value) => !value)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-gray-200">
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className={labelClass}>{t("jev.model")}</label>
            <select value={model} onChange={(event) => setModel(event.target.value)} className={inputClass}>
              <option value="jev-latest">jev-latest</option>
              <option value="jev-preview">jev-preview</option>
              <option value="jev-1.13.0">jev-1.13.0</option>
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={saveConfig} disabled={saving || (!apiKey.trim() && !ready)} className="flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}{t("jev.save")}
          </button>
          <span className="text-xs text-gray-500">{config?.baseUrl || "https://api.typesafe.ai/v1"}</span>
          {saved && <span className="text-xs text-emerald-400">{t("jev.saved")}</span>}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">{t("jev.state")}</h2>
              <p className="mt-1 text-xs text-gray-500">{t("jev.state_hint")}</p>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-400">
              <input type="checkbox" checked={stateIsJson} onChange={(event) => setStateIsJson(event.target.checked)} className="rounded border-gray-600 bg-gray-800 text-blue-500" />
              <FileJson className="h-3.5 w-3.5" />{t("jev.parse_json")}
            </label>
          </div>
          <textarea value={state} onChange={(event) => setState(event.target.value)} rows={15} className={`${inputClass} mt-3 resize-y font-mono text-xs`} placeholder={t("jev.state_placeholder")} />
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">{t("jev.questions")}</h2>
              <p className="mt-1 text-xs text-gray-500">{t("jev.questions_hint")}</p>
            </div>
            <button type="button" onClick={resetExample} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-white"><RotateCcw className="h-3.5 w-3.5" />{t("jev.reset")}</button>
          </div>
          <textarea value={questions} onChange={(event) => setQuestions(event.target.value)} rows={15} className={`${inputClass} mt-3 resize-y font-mono text-xs`} spellCheck={false} />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={evaluate} disabled={!ready || busy || !state.trim()} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {busy ? t("jev.evaluating") : t("jev.evaluate")}
        </button>
        {!ready && <span className="text-xs text-amber-400">{t("jev.key_required")}</span>}
        {error && <span className="flex items-center gap-1 text-xs text-red-400"><X className="h-3.5 w-3.5" />{error}</span>}
      </div>

      {result && result.success && (
        <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-emerald-300">{t("jev.result")}</h2>
            {result.latencyMs !== undefined && <span className="text-xs text-gray-400">{result.latencyMs} ms</span>}
          </div>
          <pre className="mt-3 max-h-[32rem] overflow-auto rounded-lg border border-gray-800 bg-gray-950 p-4 text-xs leading-5 text-gray-300">{prettyJson(result.data)}</pre>
        </section>
      )}
    </div>
  );
}
