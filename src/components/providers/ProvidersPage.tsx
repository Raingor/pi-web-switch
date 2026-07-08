import { useState } from "react";
import { useConfigStore } from "@/store/config-store";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils";
import type { ApiType, CustomProviderConfig } from "@/types";
import {
  Plug,
  Plus,
  Trash2,
  Edit3,
  Globe,
  Key,
  ChevronDown,
  ChevronRight,
  Shield,
  Server,
} from "lucide-react";

const API_TYPES: { value: ApiType; label: string }[] = [
  { value: "openai-completions", label: "OpenAI Chat Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
  { value: "google-vertex", label: "Google Vertex AI" },
  { value: "bedrock-converse-stream", label: "AWS Bedrock" },
  { value: "mistral-conversations", label: "Mistral" },
];

export function ProvidersPage() {
  const { allProviders, config, updateCustomProvider, removeCustomProvider, setProviderAuth, removeProviderAuth } =
    useConfigStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editProvider, setEditProvider] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showAuth, setShowAuth] = useState<string | null>(null);
  const [authKey, setAuthKey] = useState("");

  const customProviders = allProviders.filter((p) => p.type === "custom");

  const handleAddProvider = (id: string, cfg: CustomProviderConfig) => {
    useConfigStore.getState().addCustomProvider(id, cfg);
    setShowAdd(false);
  };

  const handleEditProvider = (id: string, cfg: Partial<CustomProviderConfig>) => {
    updateCustomProvider(id, cfg);
    setEditProvider(null);
  };

  const handleSetAuth = (providerId: string) => {
    if (authKey) {
      setProviderAuth(providerId, authKey);
      setShowAuth(null);
      setAuthKey("");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Providers</h1>
          <p className="mt-1 text-sm text-gray-400">
            Manage {allProviders.length} providers ({customProviders.length} custom)
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" />
          Add Provider
        </button>
      </div>

      {allProviders.length === 0 ? (
        <EmptyState
          icon={<Plug className="h-12 w-12" />}
          title="No providers"
          description="Add your first provider to get started"
        />
      ) : (
        <div className="space-y-2">
          {allProviders.map((p) => (
            <div key={p.id} className="rounded-xl border border-gray-800 bg-gray-900/50">
              {/* Header */}
              <button
                onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                className="flex w-full items-center gap-3 px-5 py-4 text-left"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-800">
                  {p.type === "custom" ? (
                    <Server className="h-5 w-5 text-blue-400" />
                  ) : (
                    <Shield className="h-5 w-5 text-emerald-400" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">{p.name}</span>
                    <Badge variant={p.type === "builtin" ? "info" : "default"}>
                      {p.type === "builtin" ? "Built-in" : "Custom"}
                    </Badge>
                    {p.hasAuth && (
                      <Badge variant="success">Auth Configured</Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {p.models.length} models · {p.api ?? "No API type"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAuth(p.id);
                      setAuthKey(config.auth[p.id]?.key ?? "");
                    }}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                  >
                    <Key className="h-3 w-3" />
                    Auth
                  </span>
                  {p.type === "custom" && (
                    <>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditProvider(p.id);
                        }}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                      >
                        <Edit3 className="h-3 w-3" />
                        Edit
                      </span>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCustomProvider(p.id);
                        }}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-3 w-3" />
                        Delete
                      </span>
                    </>
                  )}
                  {expandedId === p.id ? (
                    <ChevronDown className="h-4 w-4 text-gray-500" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-gray-500" />
                  )}
                </div>
              </button>

              {/* Expanded Details */}
              {expandedId === p.id && (
                <div className="border-t border-gray-800 px-5 py-4">
                  {/* Provider Info */}
                  <div className="mb-4 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Provider ID:</span>
                      <span className="ml-2 text-gray-300">{p.id}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">API Type:</span>
                      <span className="ml-2 text-gray-300">{p.api ?? "—"}</span>
                    </div>
                    {p.baseUrl && (
                      <div className="col-span-2">
                        <span className="text-gray-500">Base URL:</span>
                        <code className="ml-2 rounded bg-gray-800 px-2 py-0.5 text-xs text-blue-400">
                          {p.baseUrl}
                        </code>
                      </div>
                    )}
                    {p.authMethod && (
                      <div>
                        <span className="text-gray-500">Auth Method:</span>
                        <span className="ml-2 text-gray-300">{p.authMethod}</span>
                      </div>
                    )}
                  </div>

                  {/* Models */}
                  <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
                    Models ({p.models.length})
                  </h4>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {p.models.map((m) => (
                      <div
                        key={m.id}
                        className={cn(
                          "rounded-lg border px-3 py-2",
                          m.enabled ? "border-gray-700 bg-gray-800/50" : "border-gray-800 bg-gray-800/20 opacity-50"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-200">{m.name || m.id}</span>
                          <Badge variant={m.enabled ? "success" : "default"}>{m.enabled ? "On" : "Off"}</Badge>
                        </div>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {m.cost ? `$${m.cost.input}/${m.cost.output} per M` : "Free"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Provider Modal */}
      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Custom Provider" size="lg">
        <ProviderForm
          onSubmit={handleAddProvider}
          onCancel={() => setShowAdd(false)}
        />
      </Modal>

      {/* Edit Provider Modal */}
      <Modal open={!!editProvider} onClose={() => setEditProvider(null)} title="Edit Provider" size="lg">
        {editProvider && (
          <ProviderForm
            initial={customProviders.find((p) => p.id === editProvider)}
            onSubmit={(_, cfg) => handleEditProvider(editProvider, cfg)}
            onCancel={() => setEditProvider(null)}
            isEdit
          />
        )}
      </Modal>

      {/* Auth Modal */}
      <Modal
        open={!!showAuth}
        onClose={() => { setShowAuth(null); setAuthKey(""); }}
        title={`API Key — ${allProviders.find((p) => p.id === showAuth)?.name}`}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400">API Key</label>
            <input
              type="password"
              value={authKey}
              onChange={(e) => setAuthKey(e.target.value)}
              placeholder="sk-..."
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            />
          </div>
          <div className="flex justify-between">
            {showAuth && config.auth[showAuth] && (
              <button
                onClick={() => {
                  removeProviderAuth(showAuth!);
                  setShowAuth(null);
                  setAuthKey("");
                }}
                className="text-sm text-red-400 hover:text-red-300"
              >
                Remove Key
              </button>
            )}
            <div className="flex gap-3 ml-auto">
              <button
                onClick={() => { setShowAuth(null); setAuthKey(""); }}
                className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSetAuth(showAuth!)}
                disabled={!authKey}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
              >
                Save Key
              </button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── Provider Form ────────────────────────────────────────

interface ProviderFormProps {
  initial?: { id: string; baseUrl?: string; api?: ApiType; apiKey?: string; headers?: Record<string, string> };
  onSubmit: (id: string, cfg: CustomProviderConfig) => void;
  onCancel: () => void;
  isEdit?: boolean;
}

function ProviderForm({ initial, onSubmit, onCancel, isEdit }: ProviderFormProps) {
  const [id, setId] = useState(initial?.id ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [api, setApi] = useState<ApiType>(initial?.api ?? "openai-completions");
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [headersStr, setHeadersStr] = useState(
    initial?.headers ? JSON.stringify(initial.headers, null, 2) : ""
  );

  const handleSubmit = () => {
    if (!id) return;
    let headers: Record<string, string> | undefined;
    try {
      headers = headersStr ? JSON.parse(headersStr) : undefined;
    } catch {
      // invalid JSON
    }
    const cfg: CustomProviderConfig = {
      baseUrl: baseUrl || undefined,
      api,
      apiKey: apiKey || undefined,
      headers,
      models: [],
    };
    onSubmit(id, cfg);
  };

  return (
    <div className="space-y-4">
      {!isEdit && (
        <div>
          <label className="block text-xs font-medium text-gray-400">Provider ID *</label>
          <input
            type="text"
            value={id}
            onChange={(e) => setId(e.target.value.replace(/[^a-z0-9-]/g, ""))}
            placeholder="my-ollama"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
          <p className="mt-1 text-xs text-gray-500">Lowercase letters, numbers, and hyphens only</p>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-400">API Type</label>
        <select
          value={api}
          onChange={(e) => setApi(e.target.value as ApiType)}
          className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
        >
          {API_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400">Base URL</label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="http://localhost:11434/v1"
          className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400">API Key (optional)</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="$MY_API_KEY or sk-..."
          className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
        />
        <p className="mt-1 text-xs text-gray-500">Use $ENV_VAR for env vars, or paste the key directly</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400">Custom Headers (JSON)</label>
        <textarea
          value={headersStr}
          onChange={(e) => setHeadersStr(e.target.value)}
          placeholder='{"X-Custom-Header": "value"}'
          rows={3}
          className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white font-mono"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800">
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!id || !baseUrl}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isEdit ? "Save Changes" : "Add Provider"}
        </button>
      </div>
    </div>
  );
}