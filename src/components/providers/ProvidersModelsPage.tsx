import { useEffect, useState } from "react";
import { useConfigStore } from "@/store/config-store";
import { useTranslation } from "@/lib/i18n";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatTokens, cn } from "@/lib/utils";
import type { ApiType, CustomProviderConfig, Model, Provider } from "@/types";
import {
  Plus,
  Trash2,
  Edit3,
  Eye,
  EyeOff,
  Server,
  Shield,
  Box,
  Brain,
  Image as ImageIcon,
  Search,
  Check,
  X,
  Loader2,
  Zap,
  ClipboardPaste,
  Download,
  SquareCheck,
  Copy,
} from "lucide-react";

const API_TYPES: { value: ApiType; label: string }[] = [
  { value: "openai-completions", label: "Chat Completions (/chat/completions)" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
  { value: "google-vertex", label: "Google Vertex AI" },
  { value: "bedrock-converse-stream", label: "AWS Bedrock" },
  { value: "mistral-conversations", label: "Mistral" },
];

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Defaults for models without explicit limits: 256K context, 32K output
// (32K matches the common max-output ceiling of current mainstream models)
const DEFAULT_CONTEXT_WINDOW = 262144;
const DEFAULT_MAX_TOKENS = 32768;

// Sanitize to a config-safe id: lowercase letters, digits and hyphens only
function sanitizeProviderId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// Non-ASCII names (e.g. 中文) sanitize to "" — fall back to the endpoint hostname
// so the provider still gets a valid id while keeping the original display name.
function deriveProviderId(name: string, baseUrl: string): string {
  const fromName = sanitizeProviderId(name);
  if (fromName || !name.trim()) return fromName;
  try {
    const host = new URL(baseUrl.trim()).hostname;
    const skip = new Set(["api", "www", "app", "gateway", "open", "openapi", "platform"]);
    const part = host.split(".").find((p) => p && !skip.has(p.toLowerCase()));
    return sanitizeProviderId(part ?? "");
  } catch {
    return "";
  }
}

// ─── Freeform Import Parser ───────────────────────────────
// Recognizes pasted text like:
//   tokenrouter baseurl：https://api.example.com/v1 key：sk-xxxx
//   modelid：vendor/model-a, vendor/model-b
// Labels accept half/full-width colons; unlabeled tokens fall back to
// heuristics (URL → baseUrl, sk-… → apiKey, foo/bar → model id).

interface ParsedImport {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelIds: string[];
}

const IMPORT_LABEL_RE =
  /(?<![\w/.\-])(apikey|api_key|api-key|key|token|secret|密钥|金鑰|baseurl|base_url|base-url|url|endpoint|地址|接口|provider|name|名称|名稱|供应商|供應商|model_ids?|modelids?|models?|模型)\s*[:：](?!\/\/)/gi;

function importField(label: string): "name" | "baseUrl" | "apiKey" | "models" {
  const l = label.toLowerCase();
  if (/^(apikey|api_key|api-key|key|token|secret|密钥|金鑰)$/.test(l)) return "apiKey";
  if (/^(baseurl|base_url|base-url|url|endpoint|地址|接口)$/.test(l)) return "baseUrl";
  if (/^(provider|name|名称|名稱|供应商|供應商)$/.test(l)) return "name";
  return "models";
}

function parseProviderImport(raw: string): ParsedImport {
  const out: ParsedImport = { name: "", baseUrl: "", apiKey: "", modelIds: [] };
  const pushModels = (value: string) => {
    for (const part of value.split(/[\s,，;；]+/)) {
      const v = part.trim();
      if (v && !out.modelIds.includes(v)) out.modelIds.push(v);
    }
  };
  const assignFree = (text: string) => {
    for (const token of text.split(/\s+/)) {
      const v = token.replace(/[,，;；]+$/, "");
      if (!v) continue;
      if (/^https?:\/\//i.test(v)) {
        if (!out.baseUrl) out.baseUrl = v;
      } else if (/^sk-\S{8,}$/i.test(v) || /^[A-Za-z0-9_-]{32,}$/.test(v)) {
        if (!out.apiKey) out.apiKey = v;
      } else if (v.includes("/")) {
        pushModels(v);
      } else if (!out.name) {
        // A label line like "百灵：" keeps a trailing colon — strip it
        out.name = v.replace(/[:：]\s*$/, "").trim();
      }
    }
  };
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const matches = [...line.matchAll(IMPORT_LABEL_RE)];
    const head = (matches.length ? line.slice(0, matches[0]!.index) : line).trim();
    if (head) assignFree(head);
    matches.forEach((m, i) => {
      const start = m.index! + m[0].length;
      const end = i + 1 < matches.length ? matches[i + 1]!.index! : line.length;
      const value = line.slice(start, end).trim().replace(/[,，;；]+$/, "");
      if (!value) return;
      const field = importField(m[1] ?? "");
      if (field === "models") pushModels(value);
      else if (!out[field]) out[field] = value;
    });
  }
  return out;
}

export function ProvidersModelsPage() {
  const { t } = useTranslation();
  const { allProviders, auth, modelsJson, removeCustomProvider } = useConfigStore();

  const builtinProviders = allProviders.filter((p) => p.type === "builtin");
  const customProviders = allProviders.filter((p) => p.type === "custom");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importBump, setImportBump] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState(false);

  // Keep a valid selection (default: first custom, else first builtin)
  const selected = allProviders.find((p) => p.id === selectedId) ?? null;
  useEffect(() => {
    if (!selected && !adding && allProviders.length > 0) {
      setSelectedId(customProviders[0]?.id ?? allProviders[0]?.id ?? null);
    }
  }, [selected, adding, allProviders, customProviders]);

  const hasKey = (p: Provider) => p.hasAuth || !!p.apiKey || !!auth?.[p.id]?.key;

  const handleAddProvider = async (id: string, cfg: CustomProviderConfig): Promise<boolean> => {
    const ok = await useConfigStore.getState().addCustomProvider(id, cfg);
    if (ok) {
      setAdding(false);
      setSelectedId(id);
    }
    return ok;
  };

  const handleDeleteProvider = async () => {
    if (!deleteConfirm) return;
    setDeleteError(false);
    const ok = await removeCustomProvider(deleteConfirm);
    if (ok) {
      if (selectedId === deleteConfirm) setSelectedId(null);
      setDeleteConfirm(null);
    } else {
      setDeleteError(true);
    }
  };

  const handleDuplicateProvider = async (id: string) => {
    const existing = modelsJson?.providers[id];
    if (!existing) return;
    const suffix = "-copy";
    const newId = sanitizeProviderId(id + suffix);
    // Copy config but clear apiKey, authHeader, and models
    const cfg: CustomProviderConfig = {
      baseUrl: existing.baseUrl,
      api: existing.api,
      headers: existing.headers,
      modelOverrides: existing.modelOverrides,
    };
    const ok = await useConfigStore.getState().addCustomProvider(newId, cfg);
    if (ok) setSelectedId(newId);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--page-text)" }}>
          {t("nav.providers_models")}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--muted-text)" }}>
          {t("providers_models.subtitle")}
        </p>
      </div>

      <div className="flex overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50">
        {/* ─── Left: Provider List ─────────────────────── */}
        <div className="w-60 shrink-0 border-r border-gray-800 p-3">
          {builtinProviders.length > 0 && (
            <>
              <p className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-gray-500">
                {t("providers.builtin")}
              </p>
              <div className="space-y-0.5">
                {builtinProviders.map((p) => (
                  <ProviderListItem
                    key={p.id}
                    provider={p}
                    active={!adding && selectedId === p.id}
                    hasKey={hasKey(p)}
                    onClick={() => {
                      setAdding(false);
                      setSelectedId(p.id);
                    }}
                  />
                ))}
              </div>
            </>
          )}

          <p className="px-2 pb-2 pt-4 text-xs font-medium uppercase tracking-wider text-gray-500">
            {t("providers_models.custom_providers")}
          </p>
          <div className="space-y-0.5">
            {customProviders.map((p) => (
              <ProviderListItem
                key={p.id}
                provider={p}
                active={!adding && selectedId === p.id}
                hasKey={hasKey(p)}
                onClick={() => {
                  setAdding(false);
                  setSelectedId(p.id);
                }}
              />
            ))}
          </div>

          <button
            onClick={() => setAdding(true)}
            className={cn(
              "mt-2 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
              adding
                ? "border-gray-600 bg-gray-800 text-white"
                : "border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
            )}
          >
            <Plus className="h-4 w-4" />
            {t("providers.add_provider")}
          </button>

          <button
            onClick={() => setImporting(true)}
            className="mt-2 flex w-full items-center gap-2 rounded-lg border border-gray-700 px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <ClipboardPaste className="h-4 w-4" />
            {t("providers_models.import")}
          </button>
        </div>

        {/* ─── Right: Provider Detail / Add Form ───────── */}
        <div className="min-w-0 flex-1 p-6">
          {adding ? (
            <AddProviderForm onSubmit={handleAddProvider} onCancel={() => setAdding(false)} />
          ) : selected ? (
            <ProviderDetail
              key={`${selected.id}:${importBump}`}
              provider={selected}
              onDelete={() => setDeleteConfirm(selected.id)}
              onDuplicate={() => handleDuplicateProvider(selected.id)}
            />
          ) : (
            <div className="flex h-40 items-center justify-center text-sm text-gray-500">
              {t("providers_models.select_hint")}
            </div>
          )}
        </div>
      </div>

      {/* Import Provider Modal */}
      <ImportProviderModal
        open={importing}
        onClose={() => setImporting(false)}
        onImported={(id) => {
          setImporting(false);
          setAdding(false);
          setSelectedId(id);
          setImportBump((n) => n + 1);
        }}
      />

      {/* Delete Provider Confirmation Modal */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => { setDeleteConfirm(null); setDeleteError(false); }}
        title={t("providers.delete_provider")}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Trash2 className="h-5 w-5 shrink-0 mt-0.5 text-red-400" />
            <div>
              <p className="text-sm text-gray-200">
                <strong>{allProviders.find((p) => p.id === deleteConfirm)?.name}</strong>
                {" — "}
                {t("providers.delete_confirm")}
              </p>
              <p className="text-xs mt-2 text-gray-500">
                {t("providers_models.delete_provider_note")}
              </p>
              {deleteError && (
                <p className="text-xs mt-2 text-red-400">{t("providers_models.save_failed")}</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => { setDeleteConfirm(null); setDeleteError(false); }}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
            >
              {t("models.cancel")}
            </button>
            <button
              onClick={handleDeleteProvider}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "#dc2626" }}
            >
              <Trash2 className="h-4 w-4" />
              {t("providers.delete_provider")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Provider List Item ───────────────────────────────────

function ProviderListItem({
  provider,
  active,
  hasKey,
  onClick,
}: {
  provider: Provider;
  active: boolean;
  hasKey: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
        active
          ? "border-gray-600 bg-gray-800 text-white"
          : "border-transparent text-gray-300 hover:bg-gray-800/60"
      )}
    >
      {provider.type === "custom" ? (
        <Server className="h-4 w-4 shrink-0 text-blue-400" />
      ) : (
        <Shield className="h-4 w-4 shrink-0 text-emerald-400" />
      )}
      <span className="min-w-0 flex-1 truncate">{provider.name}</span>
      <span
        className={cn("h-2 w-2 shrink-0 rounded-full", hasKey ? "bg-emerald-400" : "bg-gray-600")}
      />
    </button>
  );
}

// ─── Connection Test Button ───────────────────────────────

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok"; latencyMs: number }
  | { status: "fail"; message: string };

function TestConnectionButton({ baseUrl, apiKey }: { baseUrl: string; apiKey?: string }) {
  const { t } = useTranslation();
  const [test, setTest] = useState<TestState>({ status: "idle" });

  const runTest = async () => {
    setTest({ status: "testing" });
    try {
      const res = await fetch("/api/pi/provider-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setTest({ status: "ok", latencyMs: data.latencyMs ?? 0 });
      } else {
        setTest({ status: "fail", message: data.message ?? "unknown" });
      }
    } catch {
      setTest({ status: "fail", message: "network error" });
    }
  };

  const disabled = !baseUrl.trim() || !isValidHttpUrl(baseUrl.trim()) || test.status === "testing";

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={runTest}
        disabled={disabled}
        className="flex items-center gap-2 rounded-lg border border-gray-700 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {test.status === "testing" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Zap className="h-4 w-4" />
        )}
        {test.status === "testing" ? t("providers_models.testing") : t("providers_models.test_connection")}
      </button>
      {test.status === "ok" && (
        <span className="flex items-center gap-1 text-sm text-emerald-400">
          <Check className="h-4 w-4" />
          {t("providers_models.test_ok", String(test.latencyMs))}
        </span>
      )}
      {test.status === "fail" && (
        <span className="flex items-center gap-1 text-sm text-red-400">
          <X className="h-4 w-4" />
          {t("providers_models.test_fail", test.message)}
        </span>
      )}
    </div>
  );
}

// ─── Provider Detail Panel ────────────────────────────────

function ProviderDetail({ provider, onDelete, onDuplicate }: { provider: Provider; onDelete: () => void; onDuplicate: () => void }) {
  const { t } = useTranslation();
  const {
    auth,
    settings,
    updateSettings,
    updateCustomProvider,
    setProviderAuth,
    removeProviderAuth,
    addModel,
    updateModel,
    removeModel,
    addEnabledModel,
    removeEnabledModel,
  } = useConfigStore();

  const isCustom = provider.type === "custom";
  const savedKey = provider.apiKey ?? auth?.[provider.id]?.key ?? "";

  const [providerName, setProviderName] = useState(provider.name ?? "");
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [api, setApi] = useState<ApiType>(provider.api ?? "openai-completions");
  const [apiKey, setApiKey] = useState(savedKey);
  const [showKey, setShowKey] = useState(false);
  const [editModel, setEditModel] = useState<Model | null>(null);
  const [showAddModel, setShowAddModel] = useState(false);
  const [deleteModel, setDeleteModel] = useState<Model | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // ─── Fetch Models State ───
  const [fetchOpen, setFetchOpen] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchedModels, setFetchedModels] = useState<{ id: string; contextWindow?: number; maxTokens?: number; vision?: boolean }[]>([]);
  const [fetchSelected, setFetchSelected] = useState<Set<string>>(new Set());
  const [fetchImported, setFetchImported] = useState<number | null>(null);

  // ─── Per-Model Test State ───
  const [modelTests, setModelTests] = useState<Map<string, TestState>>(new Map());
  const getModelTest = (modelId: string) => modelTests.get(modelId) ?? { status: "idle" };

  const existingModelIds = new Set(provider.models.map((m) => m.id));
  const availableModels = fetchedModels.filter((m) => !existingModelIds.has(m.id));
  const isSelected = (id: string) => fetchSelected.has(id);
  const allSelected = availableModels.length > 0 && availableModels.every((m) => isSelected(m.id));

  const toggleSelect = (id: string) => {
    setFetchSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setFetchSelected((prev) => {
      if (availableModels.every((m) => isSelected(m.id))) return new Set();
      return new Set(availableModels.map((m) => m.id));
    });
  };

  const fetchModels = async () => {
    if (!baseUrl.trim() || !isValidHttpUrl(baseUrl.trim())) return;
    setFetchOpen(true);
    setFetching(true);
    setFetchError(null);
    setFetchedModels([]);
    setFetchSelected(new Set());
    setFetchImported(null);
    try {
      const res = await fetch("/api/pi/provider-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey, providerId: provider.id }),
      });
      const data = await res.json();
      if (data.error) setFetchError(data.error);
      else setFetchedModels(data.models ?? []);
    } catch {
      setFetchError("network error");
    } finally {
      setFetching(false);
    }
  };

  const handleImportFetched = async () => {
    const selected = availableModels.filter((m) => isSelected(m.id));
    if (selected.length === 0) return;
    selected.forEach((m) => {
      addModel(provider.id, { id: m.id, contextWindow: m.contextWindow ?? DEFAULT_CONTEXT_WINDOW, maxTokens: m.maxTokens ?? DEFAULT_MAX_TOKENS, input: m.vision ? ["text", "image"] : ["text"] } as Model);
    });
    // Enable in a single batched write — per-model addEnabledModel calls race
    // on the same settings snapshot and overwrite each other.
    const list = settings?.enabledModels ?? [];
    const refs = selected.map((m) => `${provider.id}/${m.id}`);
    await updateSettings({ enabledModels: Array.from(new Set([...list, ...refs])) });
    setFetchImported(selected.length);
    setTimeout(() => {
      setFetchOpen(false); setFetchedModels([]); setFetchSelected(new Set());
      setFetchImported(null); setFetchError(null);
    }, 1500);
  };

  const handleTestModel = async (m: Model) => {
    const modelId = m.id;
    setModelTests((prev) => {
      const next = new Map(prev);
      next.set(modelId, { status: "testing" });
      return next;
    });
    try {
      const res = await fetch("/api/pi/model-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), modelId, apiKey, apiType: api ?? undefined }),
      });
      const data = await res.json();
      setModelTests((prev) => {
        const next = new Map(prev);
        next.set(modelId, data.success
          ? { status: "ok" as const, latencyMs: data.latencyMs ?? 0 }
          : { status: "fail" as const, message: data.message ?? "unknown" });
        return next;
      });
    } catch {
      setModelTests((prev) => {
        const next = new Map(prev);
        next.set(modelId, { status: "fail" as const, message: "network error" });
        return next;
      });
    }
  };

  const urlInvalid = isCustom && baseUrl.trim() !== "" && !isValidHttpUrl(baseUrl.trim());

  const dirty =
    (isCustom && (providerName !== (provider.name ?? "") || baseUrl !== (provider.baseUrl ?? "") || api !== (provider.api ?? "openai-completions"))) ||
    apiKey !== savedKey;

  const handleSave = async () => {
    setSaveState("saving");
    let ok = true;
    if (isCustom) {
      ok = await updateCustomProvider(provider.id, {
        name: providerName || undefined,
        baseUrl: baseUrl || undefined,
        api,
        apiKey: apiKey || undefined,
      });
    } else if (apiKey !== savedKey) {
      ok = apiKey
        ? await setProviderAuth(provider.id, apiKey)
        : await removeProviderAuth(provider.id);
    }
    setSaveState(ok ? "saved" : "error");
    if (ok) setTimeout(() => setSaveState("idle"), 2500);
  };

  // Enabled state lives in settings.enabledModels ("provider/model" refs) —
  // the same source pi reads, so toggling here matches the CLI behavior.
  const isEnabled = (modelId: string) =>
    settings?.enabledModels?.includes(`${provider.id}/${modelId}`) ?? false;

  const handleToggle = (modelId: string) => {
    const ref = `${provider.id}/${modelId}`;
    if (isEnabled(modelId)) removeEnabledModel(ref);
    else addEnabledModel(ref);
  };

  const setAllEnabled = (enable: boolean) => {
    const list = settings?.enabledModels ?? [];
    const refs = provider.models.map((m) => `${provider.id}/${m.id}`);
    const next = enable
      ? Array.from(new Set([...list, ...refs]))
      : list.filter((r) => !refs.includes(r));
    updateSettings({ enabledModels: next });
  };

  const q = modelQuery.trim().toLowerCase();
  const visibleModels = q
    ? provider.models.filter(
        (m) => m.id.toLowerCase().includes(q) || (m.name ?? "").toLowerCase().includes(q)
      )
    : provider.models;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-white">{provider.name}</h2>
        <Badge variant={isCustom ? "default" : "info"}>
          {isCustom ? t("providers.custom") : t("providers.builtin")}
        </Badge>
        {savedKey && <Badge variant="success">{t("providers.configured")}</Badge>}
        {isCustom && (
          <button
            onClick={onDuplicate}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-blue-500/10 hover:text-blue-400"
            title={t("providers.duplicate_provider")}
          >
            <Copy className="h-4 w-4" />
          </button>
        )}
        {isCustom && (
          <button
            onClick={onDelete}
            className="ml-auto rounded-lg p-2 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
            title={t("providers.delete_provider")}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>


      {/* Name (custom only) */}
      {isCustom && (
        <div>
          <label className="block text-sm text-gray-400">{t("providers_models.name")}</label>
          <input
            type="text"
            value={providerName}
            onChange={(e) => setProviderName(e.target.value)}
            placeholder="My Provider"
            className="mt-1.5 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white"
          />
        </div>
      )}
      {/* Base URL */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers.base_url")}</label>
        <input
          type="text"
          value={baseUrl}
          disabled={!isCustom}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
          className={cn(
            "mt-1.5 w-full rounded-lg border bg-gray-800 px-3 py-2.5 text-sm text-white disabled:opacity-50",
            urlInvalid ? "border-red-500" : "border-gray-700"
          )}
        />
        {urlInvalid && (
          <p className="mt-1 text-xs text-red-400">{t("providers_models.invalid_url")}</p>
        )}
      </div>

      {/* API Type */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers.api_type")}</label>
        <select
          value={api}
          disabled={!isCustom}
          onChange={(e) => setApi(e.target.value as ApiType)}
          className="mt-1.5 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white disabled:opacity-50"
        >
          {API_TYPES.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>
      </div>

      {/* API Key */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers.api_key")}</label>
        <div className="relative mt-1.5">
          <input
            type={showKey ? "text" : "password"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-... or $MY_API_KEY"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 pr-10 text-sm text-white"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-500 hover:text-gray-300"
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Save / Test / Feedback row */}
      <div className="flex flex-wrap items-center gap-3">
        {dirty && (
          <button
            onClick={handleSave}
            disabled={saveState === "saving" || urlInvalid}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#3b82f6", color: "#ffffff" }}
          >
            {saveState === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("models.save")}
          </button>
        )}
        {saveState === "saved" && (
          <span className="flex items-center gap-1 text-sm text-emerald-400">
            <Check className="h-4 w-4" />
            {t("providers_models.saved")}
          </span>
        )}
        {saveState === "error" && (
          <span className="flex items-center gap-1 text-sm text-red-400">
            <X className="h-4 w-4" />
            {t("providers_models.save_failed")}
          </span>
        )}
        {isCustom && baseUrl.trim() !== "" && (
          <TestConnectionButton baseUrl={baseUrl} apiKey={apiKey} />
        )}
      </div>

      {/* Model List */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <label className="block text-sm text-gray-400">{t("providers_models.model_list")}</label>
          {provider.models.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setAllEnabled(true)}
                className="rounded-md px-2 py-1 text-xs text-emerald-400 transition-colors hover:bg-emerald-500/10"
              >
                {t("providers_models.enable_all")}
              </button>
              <button
                onClick={() => setAllEnabled(false)}
                className="rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-800"
              >
                {t("providers_models.disable_all")}
              </button>
            </div>
          )}
        </div>

        {provider.models.length > 5 && (
          <div className="relative mt-1.5">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={modelQuery}
              onChange={(e) => setModelQuery(e.target.value)}
              placeholder={t("models.search_placeholder")}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2 pl-9 pr-3 text-sm text-white"
            />
          </div>
        )}

        <div className="mt-1.5 space-y-2 rounded-lg border border-gray-800 p-3">
          {provider.models.length === 0 && (
            <p className="px-1 py-2 text-sm text-gray-500">{t("models.no_models")}</p>
          )}
          {provider.models.length > 0 && visibleModels.length === 0 && (
            <p className="px-1 py-2 text-sm text-gray-500">{t("models.no_models")}</p>
          )}
          {visibleModels.map((m) => (
            <div
              key={m.id}
              className={cn(
                "flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2.5",
                !isEnabled(m.id) && "opacity-50"
              )}
            >
              <Box className="h-4 w-4 shrink-0 text-gray-500" />
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-gray-200">
                {m.id}
              </span>
              {m.reasoning && (
                <span title={t("models.reasoning")} className="flex shrink-0">
                  <Brain className="h-3.5 w-3.5 text-purple-400" />
                </span>
              )}
              {m.input?.includes("image") && (
                <span title={t("models.image_input")} className="flex shrink-0">
                  <ImageIcon className="h-3.5 w-3.5 text-blue-400" />
                </span>
              )}
              <span className="rounded-md border border-gray-600 bg-gray-800/50 px-2 py-0.5 text-xs text-gray-400">
                {m.cost && (m.cost.input || m.cost.output)
                  ? `$${m.cost.input}/${m.cost.output}`
                  : t("models.free")}
              </span>
              <span className="rounded-md border border-gray-600 bg-gray-800/50 px-2 py-0.5 text-xs text-gray-400">
                {m.contextWindow ? formatTokens(m.contextWindow) : "—"}
              </span>
              <button
                onClick={() => handleToggle(m.id)}
                className={cn(
                  "rounded-md px-2 py-1 text-xs transition-colors",
                  isEnabled(m.id)
                    ? "text-emerald-400 hover:bg-emerald-500/10"
                    : "text-gray-500 hover:bg-gray-700"
                )}
              >
                {isEnabled(m.id) ? t("models.enabled") : t("models.disabled")}
              </button>
              {/* Test model */}
              {(() => {
                const test = getModelTest(m.id);
                if (test.status === "testing") return null;
                return (
                  <button
                    onClick={() => handleTestModel(m)}
                    className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-200"
                    title={t("models.test_model")}
                  >
                    <Zap className="h-3.5 w-3.5" />
                  </button>
                );
              })()}
              {/* Model test result */}
              {(() => {
                const test = getModelTest(m.id);
                if (test.status === "ok") return (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <Check className="h-3.5 w-3.5" />
                    {t("providers_models.test_ok", String(test.latencyMs))}
                  </span>
                );
                if (test.status === "fail") return (
                  <span className="flex items-center gap-1 text-xs text-red-400">
                    <X className="h-3.5 w-3.5" />
                    {t("providers_models.test_fail", test.message)}
                  </span>
                );
                if (test.status === "testing") return (
                  <span className="flex items-center gap-1 text-xs text-gray-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t("providers_models.testing")}
                  </span>
                );
                return null;
              })()}
              <button
                onClick={() => setEditModel(m)}
                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-200"
                title={t("models.edit_model")}
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setDeleteModel(m)}
                className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                title={t("models.delete_model")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <button
            onClick={fetchModels}
            disabled={!baseUrl.trim() || !isValidHttpUrl(baseUrl.trim()) || fetching}
            title={
              !baseUrl.trim() || !isValidHttpUrl(baseUrl.trim())
                ? t("providers_models.fetch_no_endpoint")
                : t("providers_models.fetch_models")
            }
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {fetching ? t("providers_models.fetching") : t("providers_models.fetch_models")}
          </button>
          <button
            onClick={() => setShowAddModel(true)}
            className="flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
          >
            <Plus className="h-4 w-4" />
            {t("models.add_model")}
          </button>
        </div>
      </div>


      {/* Fetch Models Modal */}
      <Modal
        open={fetchOpen}
        onClose={() => { setFetchOpen(false); setFetchedModels([]); setFetchSelected(new Set()); setFetchError(null); setFetchImported(null); }}
        title={t("providers_models.fetch_title")}
        size="lg"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-400">{t("providers_models.fetch_desc", provider.name)}</p>
          {fetching && (
            <div className="flex items-center gap-2 py-6 text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>{t("providers_models.fetching")}</span>
            </div>
          )}
          {fetchError && !fetching && (
            <div className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4">
              <X className="h-5 w-5 shrink-0 text-red-400 mt-0.5" />
              <p className="text-sm text-red-300">{t("providers_models.fetch_error", fetchError)}</p>
            </div>
          )}
          {!fetching && !fetchError && availableModels.length === 0 && fetchedModels.length === 0 && (
            <p className="text-sm text-gray-500">{t("providers_models.fetch_empty")}</p>
          )}
          {!fetching && !fetchError && availableModels.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">
                  {t("providers_models.selected_count", String(fetchSelected.size), String(availableModels.length))}
                </span>
                <button onClick={toggleAll} className="rounded-md px-2 py-1 text-xs">
                  {allSelected
                    ? <span className="text-amber-400">{t("providers_models.deselect_all")}</span>
                    : <span className="text-emerald-400">{t("providers_models.select_all")}</span>
                  }
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1.5 rounded-lg border border-gray-800 p-3">
                {availableModels.map((m) => (
                  <label key={m.id} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-gray-800 cursor-pointer">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded border"
                      style={{ backgroundColor: isSelected(m.id) ? "#3b82f6" : "transparent", borderColor: isSelected(m.id) ? "#3b82f6" : "#4b5563" }}
                    >
                      {isSelected(m.id) && <SquareCheck className="h-4 w-4 text-white" />}
                    </div>
                    <input type="checkbox" checked={isSelected(m.id)} onChange={() => toggleSelect(m.id)} className="sr-only" />
                    <span className="min-w-0 flex-1 truncate font-mono text-sm text-gray-200">{m.id}</span>
                    <span className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${m.vision ? "border-blue-500/40 bg-blue-500/10 text-blue-400" : "border-gray-700 bg-gray-800 text-gray-500"}`}>
                      {m.vision && <ImageIcon className="h-3 w-3" />}
                      {m.vision ? t("providers_models.modality_vision") : t("providers_models.modality_text")}
                    </span>
                    {m.contextWindow && <span className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-500 font-mono">{formatTokens(m.contextWindow)}</span>}
                    {m.maxTokens && <span className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-xs text-gray-500 font-mono">{formatTokens(m.maxTokens)}</span>}
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="flex items-center justify-end gap-3 pt-1">
            {fetchImported !== null && (
              <span className="flex items-center gap-1 text-sm text-emerald-400">
                <Check className="h-4 w-4" />
                {t("providers_models.import_done", String(fetchImported))}
              </span>
            )}
            <button onClick={() => { setFetchOpen(false); setFetchedModels([]); setFetchSelected(new Set()); setFetchError(null); setFetchImported(null); }}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800">
              {t("models.cancel")}
            </button>
            <button onClick={handleImportFetched} disabled={fetching || fetchSelected.size === 0}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: "#3b82f6", color: "#ffffff" }}>
              {t("providers_models.confirm_import")}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Model Modal */}
      <Modal
        open={!!editModel}
        onClose={() => setEditModel(null)}
        title={`${t("models.edit_model")}: ${editModel?.name || editModel?.id}`}
        size="lg"
      >
        {editModel && (
          <ModelForm
            initial={editModel}
            onSubmit={(form) => {
              updateModel(provider.id, editModel.id, form);
              setEditModel(null);
            }}
            onCancel={() => setEditModel(null)}
          />
        )}
      </Modal>

      {/* Add Model Modal */}
      <Modal
        open={showAddModel}
        onClose={() => setShowAddModel(false)}
        title={`${t("models.add_model")} — ${provider.name}`}
        size="lg"
      >
        <ModelForm
          onSubmit={(form) => {
            if (!form.id) return;
            addModel(provider.id, form as Model);
            setShowAddModel(false);
          }}
          onCancel={() => setShowAddModel(false)}
        />
      </Modal>

      {/* Delete Model Confirmation Modal */}
      <Modal
        open={!!deleteModel}
        onClose={() => setDeleteModel(null)}
        title={t("models.delete_model")}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Trash2 className="h-5 w-5 shrink-0 mt-0.5 text-red-400" />
            <p className="text-sm text-gray-200">
              <strong className="font-mono">{deleteModel?.id}</strong>
              {" — "}
              {t("models.delete_confirm")}
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setDeleteModel(null)}
              className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
            >
              {t("models.cancel")}
            </button>
            <button
              onClick={() => {
                if (deleteModel) {
                  removeModel(provider.id, deleteModel.id);
                  setDeleteModel(null);
                }
              }}
              className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ backgroundColor: "#dc2626" }}
            >
              <Trash2 className="h-4 w-4" />
              {t("models.delete_model")}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Model Form (add & edit) ──────────────────────────────

function ModelForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: Model;
  onSubmit: (form: Partial<Model>) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<Partial<Model>>(
    initial
      ? { ...initial }
      : {
          id: "",
          name: "",
          reasoning: false,
          input: ["text"],
          contextWindow: DEFAULT_CONTEXT_WINDOW,
          maxTokens: DEFAULT_MAX_TOKENS,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }
  );
  const isEdit = !!initial;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-400">{t("models.model_id")} *</label>
          <input
            type="text"
            value={form.id ?? ""}
            disabled={isEdit}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            placeholder="my-model-id"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white disabled:opacity-50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400">{t("models.display_name")}</label>
          <input
            type="text"
            value={form.name ?? ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="My Custom Model"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400">{t("models.context_window")}</label>
          <input
            type="number"
            value={form.contextWindow ?? DEFAULT_CONTEXT_WINDOW}
            onChange={(e) => setForm({ ...form, contextWindow: parseInt(e.target.value) || DEFAULT_CONTEXT_WINDOW })}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400">{t("models.max_tokens")}</label>
          <input
            type="number"
            value={form.maxTokens ?? DEFAULT_MAX_TOKENS}
            onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) || DEFAULT_MAX_TOKENS })}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
        </div>
      </div>

      {/* Capabilities */}
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={form.reasoning ?? false}
            onChange={(e) => setForm({ ...form, reasoning: e.target.checked })}
            className="rounded border-gray-600 bg-gray-800 text-blue-500"
          />
          {t("models.reasoning")}
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={form.input?.includes("image") ?? false}
            onChange={(e) =>
              setForm({ ...form, input: e.target.checked ? ["text", "image"] : ["text"] })
            }
            className="rounded border-gray-600 bg-gray-800 text-blue-500"
          />
          {t("models.image_input")}
        </label>
      </div>

      {/* Cost */}
      <div className="grid grid-cols-4 gap-3">
        {(
          [
            ["input", "models.cost_input"],
            ["output", "models.cost_output"],
            ["cacheRead", "models.cost_cache_read"],
            ["cacheWrite", "models.cost_cache_write"],
          ] as const
        ).map(([field, labelKey]) => (
          <div key={field}>
            <label className="block text-xs text-gray-500">{t(labelKey)} $/M</label>
            <input
              type="number"
              step="0.01"
              value={form.cost?.[field] ?? 0}
              onChange={(e) =>
                setForm({
                  ...form,
                  cost: {
                    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
                    ...form.cost,
                    [field]: parseFloat(e.target.value) || 0,
                  },
                })
              }
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            />
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800">
          {t("models.cancel")}
        </button>
        <button
          onClick={() => onSubmit(form)}
          disabled={!form.id}
          className="rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          style={{ backgroundColor: "#3b82f6", color: "#ffffff" }}
        >
          {isEdit ? t("models.save") : t("models.add_model")}
        </button>
      </div>
    </div>
  );
}

// ─── Add Provider Form ────────────────────────────────────

function AddProviderForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (id: string, cfg: CustomProviderConfig) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { allProviders } = useConfigStore();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [api, setApi] = useState<ApiType>("openai-completions");
  const [models, setModels] = useState<Model[]>([]);
  const [showAddModel, setShowAddModel] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  const id = deriveProviderId(name, baseUrl);
  const idExists = !!id && allProviders.some((p) => p.id === id);
  const urlInvalid = baseUrl.trim() !== "" && !isValidHttpUrl(baseUrl.trim());

  const handleSubmit = async () => {
    if (!id || !baseUrl || idExists || urlInvalid) return;
    setSubmitting(true);
    setSubmitError(false);
    const ok = await onSubmit(id, {
      name: name.trim() || undefined,
      baseUrl,
      api,
      apiKey: apiKey || undefined,
      models,
    });
    setSubmitting(false);
    if (!ok) setSubmitError(true);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-white">
          {t("providers_models.add_provider_title")}
        </h2>
        <p className="mt-1 text-sm text-gray-500">{t("providers_models.add_provider_desc")}</p>
      </div>

      {/* Name */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers_models.name")}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("providers_models.name_placeholder")}
          className={cn(
            "mt-1.5 w-full rounded-lg border bg-gray-800 px-3 py-2.5 text-sm text-white",
            idExists ? "border-red-500" : "border-gray-700"
          )}
        />
        {idExists ? (
          <p className="mt-1 text-xs text-red-400">{t("providers_models.id_exists", id)}</p>
        ) : id ? (
          <p className="mt-1 text-xs text-gray-500">{t("providers_models.id_preview", id)}</p>
        ) : name.trim() ? (
          <p className="mt-1 text-xs text-red-400">{t("providers_models.id_invalid")}</p>
        ) : null}
      </div>

      {/* Base URL */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers.base_url")}</label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com/v1"
          className={cn(
            "mt-1.5 w-full rounded-lg border bg-gray-800 px-3 py-2.5 text-sm text-white",
            urlInvalid ? "border-red-500" : "border-gray-700"
          )}
        />
        {urlInvalid && (
          <p className="mt-1 text-xs text-red-400">{t("providers_models.invalid_url")}</p>
        )}
      </div>

      {/* API Key */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers.api_key")}</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-... or $MY_API_KEY"
          className="mt-1.5 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white"
        />
      </div>

      {/* API Type */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers.api_type")}</label>
        <select
          value={api}
          onChange={(e) => setApi(e.target.value as ApiType)}
          className="mt-1.5 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white"
        >
          {API_TYPES.map((a) => (
            <option key={a.value} value={a.value}>{a.label}</option>
          ))}
        </select>
      </div>

      {/* Connection test with the values entered above */}
      {baseUrl.trim() !== "" && !urlInvalid && (
        <TestConnectionButton baseUrl={baseUrl} apiKey={apiKey} />
      )}

      {/* Initial Model List */}
      <div>
        <label className="block text-sm text-gray-400">{t("providers_models.model_list")}</label>
        {models.length > 0 && (
          <div className="mt-1.5 space-y-2">
            {models.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900/70 px-3 py-2.5"
              >
                <Box className="h-4 w-4 shrink-0 text-gray-500" />
                <span className="min-w-0 flex-1 truncate font-mono text-sm text-gray-200">
                  {m.id}
                </span>
                <span className="rounded-md border border-gray-600 bg-gray-800/50 px-2 py-0.5 text-xs text-gray-400">
                  {m.contextWindow ? formatTokens(m.contextWindow) : "—"}
                </span>
                <button
                  onClick={() => setModels(models.filter((x) => x.id !== m.id))}
                  className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                  title={t("models.delete_model")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => setShowAddModel(true)}
          className="mt-2 flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800"
        >
          <Plus className="h-4 w-4" />
          {t("models.add_model")}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSubmit}
          disabled={!id || !baseUrl || idExists || urlInvalid || submitting}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
          style={{ backgroundColor: "#3b82f6", color: "#ffffff" }}
        >
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("providers.add_provider")}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
        >
          {t("models.cancel")}
        </button>
        {submitError && (
          <span className="flex items-center gap-1 text-sm text-red-400">
            <X className="h-4 w-4" />
            {t("providers_models.save_failed")}
          </span>
        )}
      </div>

      {/* Add Initial Model Modal */}
      <Modal
        open={showAddModel}
        onClose={() => setShowAddModel(false)}
        title={t("models.add_model")}
        size="lg"
      >
        <ModelForm
          onSubmit={(form) => {
            if (!form.id) return;
            setModels([...models.filter((x) => x.id !== form.id), form as Model]);
            setShowAddModel(false);
          }}
          onCancel={() => setShowAddModel(false)}
        />
      </Modal>
    </div>
  );
}

// ─── Import Provider Modal ─────────────────────────────────

function ImportProviderModal({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { allProviders } = useConfigStore();

  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [api, setApi] = useState<ApiType>("openai-completions");
  const [modelIds, setModelIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);

  // ─── Fetch models from the endpoint (one-shot import) ───
  const [fetching, setFetching] = useState(false);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [fetchDone, setFetchDone] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<{ id: string; contextWindow?: number; maxTokens?: number; vision?: boolean }[]>([]);
  const [fetchSel, setFetchSel] = useState<Set<string>>(new Set());

  // Re-parse on every paste/edit of the raw text; fields below stay editable
  const handleText = (value: string) => {
    setText(value);
    const parsed = parseProviderImport(value);
    setName(parsed.name);
    setBaseUrl(parsed.baseUrl);
    setApiKey(parsed.apiKey);
    setModelIds(parsed.modelIds);
  };

  const reset = () => {
    setText("");
    setName("");
    setBaseUrl("");
    setApiKey("");
    setApi("openai-completions");
    setModelIds([]);
    setSubmitting(false);
    setSubmitError(false);
    setFetching(false);
    setFetchErr(null);
    setFetchDone(false);
    setFetchedModels([]);
    setFetchSel(new Set());
  };

  const id = deriveProviderId(name, baseUrl);
  const existing = allProviders.find((p) => p.id === id);
  const builtinConflict = existing?.type === "builtin";
  const mergeTarget = existing?.type === "custom" ? existing : null;
  const urlInvalid = baseUrl.trim() !== "" && !isValidHttpUrl(baseUrl.trim());
  const parsedEmpty =
    text.trim() !== "" && !name && !baseUrl && !apiKey && modelIds.length === 0;
  const canSubmit =
    !!id && (!!baseUrl.trim() || !!mergeTarget) && !urlInvalid && !builtinConflict && !submitting;

  // Fetched models not already covered by the parsed model chips
  const availableFetched = fetchedModels.filter((m) => !modelIds.includes(m.id));
  const allFetchedSelected =
    availableFetched.length > 0 && availableFetched.every((m) => fetchSel.has(m.id));

  const handleFetchModels = async () => {
    if (!isValidHttpUrl(baseUrl.trim()) || fetching) return;
    setFetching(true);
    setFetchErr(null);
    setFetchDone(false);
    try {
      const res = await fetch("/api/pi/provider-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey, providerId: id || undefined }),
      });
      const data = await res.json();
      if (data.error) {
        setFetchErr(data.error);
      } else {
        const models = (data.models ?? []) as { id: string; contextWindow?: number; maxTokens?: number; vision?: boolean }[];
        setFetchedModels(models);
        // Select everything by default so import is a single click
        setFetchSel(new Set(models.map((m) => m.id)));
      }
    } catch {
      setFetchErr("network error");
    } finally {
      setFetching(false);
      setFetchDone(true);
    }
  };

  const toggleFetched = (mid: string) => {
    setFetchSel((prev) => {
      const next = new Set(prev);
      next.has(mid) ? next.delete(mid) : next.add(mid);
      return next;
    });
  };
  const toggleAllFetched = () => {
    setFetchSel(allFetchedSelected ? new Set() : new Set(availableFetched.map((m) => m.id)));
  };

  const handleImport = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(false);
    const store = useConfigStore.getState();
    const defaults = {
      input: ["text"] as Model["input"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    };
    const selectedFetched = availableFetched.filter((m) => fetchSel.has(m.id));
    const newModels: Model[] = [
      ...modelIds.map((mid) => ({
        id: mid,
        name: mid.split("/").pop() || mid,
        contextWindow: DEFAULT_CONTEXT_WINDOW,
        maxTokens: DEFAULT_MAX_TOKENS,
        ...defaults,
      })),
      // Fetched models carry real context/output limits when the endpoint provides them
      ...selectedFetched.map((m) => ({
        id: m.id,
        name: m.id.split("/").pop() || m.id,
        contextWindow: m.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
        maxTokens: m.maxTokens ?? DEFAULT_MAX_TOKENS,
        ...defaults,
        input: (m.vision ? ["text", "image"] : ["text"]) as Model["input"],
      })),
    ];
    const newIds = newModels.map((m) => m.id);

    let ok: boolean;
    if (mergeTarget) {
      // Merge into the existing custom provider (dedupe models by id)
      const existingCfg = store.modelsJson?.providers[id];
      const existingModels = existingCfg?.models ?? [];
      const merged = [
        ...existingModels,
        ...newModels.filter((m) => !existingModels.some((e) => e.id === m.id)),
      ];
      ok = await store.updateCustomProvider(id, {
        baseUrl: baseUrl.trim() || existingCfg?.baseUrl,
        apiKey: apiKey || existingCfg?.apiKey,
        models: merged,
      });
    } else {
      ok = await store.addCustomProvider(id, {
        name: name.trim() || undefined,
        baseUrl: baseUrl.trim(),
        api,
        apiKey: apiKey || undefined,
        models: newModels,
      });
    }

    // Imported models are enabled by default (settings.enabledModels refs)
    if (ok && newIds.length > 0) {
      const refs = newIds.map((m) => `${id}/${m}`);
      const list = store.settings?.enabledModels ?? [];
      await store.updateSettings({ enabledModels: Array.from(new Set([...list, ...refs])) });
    }

    setSubmitting(false);
    if (ok) {
      reset();
      onImported(id);
    } else {
      setSubmitError(true);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title={t("providers_models.import_title")}
      size="lg"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">{t("providers_models.import_desc")}</p>

        {/* Paste area */}
        <textarea
          value={text}
          onChange={(e) => handleText(e.target.value)}
          rows={4}
          placeholder={t("providers_models.import_placeholder")}
          className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 font-mono text-sm text-white placeholder:text-gray-600"
        />
        {parsedEmpty && (
          <p className="text-xs text-amber-400">{t("providers_models.import_empty")}</p>
        )}

        {/* Parsed preview (editable) */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-400">
              {t("providers_models.name")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("providers_models.name_placeholder")}
              className={cn(
                "mt-1 w-full rounded-lg border bg-gray-800 px-3 py-2 text-sm text-white",
                builtinConflict ? "border-red-500" : "border-gray-700"
              )}
            />
            {builtinConflict ? (
              <p className="mt-1 text-xs text-red-400">
                {t("providers_models.import_builtin_conflict", id)}
              </p>
            ) : mergeTarget ? (
              <p className="mt-1 text-xs text-amber-400">
                {t("providers_models.import_merge", id)}
              </p>
            ) : id ? (
              <p className="mt-1 text-xs text-gray-500">{t("providers_models.id_preview", id)}</p>
            ) : name.trim() ? (
              <p className="mt-1 text-xs text-red-400">{t("providers_models.id_invalid")}</p>
            ) : null}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400">
              {t("providers.api_type")}
            </label>
            <select
              value={api}
              onChange={(e) => setApi(e.target.value as ApiType)}
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            >
              {API_TYPES.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400">
              {t("providers.base_url")}
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className={cn(
                "mt-1 w-full rounded-lg border bg-gray-800 px-3 py-2 text-sm text-white",
                urlInvalid ? "border-red-500" : "border-gray-700"
              )}
            />
            {urlInvalid && (
              <p className="mt-1 text-xs text-red-400">{t("providers_models.invalid_url")}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-400">
              {t("providers.api_key")}
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-... or $MY_API_KEY"
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            />
          </div>
        </div>

        {/* Detected models */}
        {modelIds.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-400">
              {t("providers_models.model_list")}
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {modelIds.map((mid) => (
                <span
                  key={mid}
                  className="flex items-center gap-1.5 rounded-md border border-gray-700 bg-gray-800 px-2 py-1 font-mono text-xs text-gray-200"
                >
                  <Box className="h-3 w-3 text-gray-500" />
                  {mid}
                  <button
                    onClick={() => setModelIds(modelIds.filter((x) => x !== mid))}
                    className="text-gray-500 hover:text-red-400"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Fetch models from the endpoint — one-shot: fetch, tick, import */}
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleFetchModels}
              disabled={!isValidHttpUrl(baseUrl.trim()) || fetching}
              title={
                !isValidHttpUrl(baseUrl.trim())
                  ? t("providers_models.fetch_no_endpoint")
                  : t("providers_models.fetch_models")
              }
              className="flex items-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {fetching ? t("providers_models.fetching") : t("providers_models.fetch_models")}
            </button>
            {fetchErr && (
              <span className="text-xs text-red-400">{t("providers_models.fetch_error", fetchErr)}</span>
            )}
            {fetchDone && !fetchErr && fetchedModels.length === 0 && (
              <span className="text-xs text-amber-400">{t("providers_models.fetch_empty")}</span>
            )}
          </div>
          {availableFetched.length > 0 && (
            <div className="mt-2 rounded-lg border border-gray-700">
              <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2">
                <span className="text-xs text-gray-400">
                  {t("providers_models.selected_count", String(fetchSel.size), String(availableFetched.length))}
                </span>
                <button
                  onClick={toggleAllFetched}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  {allFetchedSelected ? t("providers_models.deselect_all") : t("providers_models.select_all")}
                </button>
              </div>
              <div className="max-h-44 overflow-y-auto p-1.5">
                {availableFetched.map((m) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-gray-800"
                  >
                    <input
                      type="checkbox"
                      checked={fetchSel.has(m.id)}
                      onChange={() => toggleFetched(m.id)}
                      className="h-3.5 w-3.5 accent-blue-500"
                    />
                    <span className="truncate font-mono text-xs text-gray-200">{m.id}</span>
                    <span className={`ml-auto flex shrink-0 items-center gap-1 rounded border px-1 py-px text-[10px] ${m.vision ? "border-blue-500/40 bg-blue-500/10 text-blue-400" : "border-gray-700 bg-gray-800 text-gray-500"}`}>
                      {m.vision && <ImageIcon className="h-2.5 w-2.5" />}
                      {m.vision ? t("providers_models.modality_vision") : t("providers_models.modality_text")}
                    </span>
                    {m.contextWindow && (
                      <span className="shrink-0 text-[10px] text-gray-500">
                        {formatTokens(m.contextWindow)}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 pt-1">
          {submitError && (
            <span className="flex items-center gap-1 text-sm text-red-400">
              <X className="h-4 w-4" />
              {t("providers_models.save_failed")}
            </span>
          )}
          <button
            onClick={() => { reset(); onClose(); }}
            className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
          >
            {t("models.cancel")}
          </button>
          <button
            onClick={handleImport}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            style={{ backgroundColor: "#3b82f6", color: "#ffffff" }}
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("providers_models.import")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
