import { useState } from "react";
import { useConfigStore } from "@/store/config-store";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatTokens, formatCost, cn } from "@/lib/utils";
import type { Model } from "@/types";
import {
  Search,
  Plus,
  Box,
  Trash2,
  Edit3,
  CheckCircle2,
  XCircle,
  Brain,
  Image,
  Text,
  Cpu,
} from "lucide-react";

function ModelIcon({ model }: { model: Model }) {
  const inputs = model.input ?? ["text"];
  return (
    <div className="flex gap-1">
      {inputs.includes("image") ? (
        <Image className="h-3.5 w-3.5 text-purple-400" />
      ) : (
        <Text className="h-3.5 w-3.5 text-blue-400" />
      )}
      {model.reasoning && <Brain className="h-3.5 w-3.5 text-amber-400" />}
    </div>
  );
}

export function ModelsPage() {
  const { allModels, allProviders, updateModel, removeModel, toggleModelEnabled, addModelToProvider, config } =
    useConfigStore();

  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [editModel, setEditModel] = useState<(Model & { providerId: string; providerName: string }) | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  const availableProviders = allProviders.filter(
    (p) => p.models.length > 0
  );

  const filtered = allModels.filter((m) => {
    if (search && !m.id.toLowerCase().includes(search.toLowerCase()) && !m.name?.toLowerCase().includes(search.toLowerCase()))
      return false;
    if (providerFilter !== "all" && m.providerId !== providerFilter) return false;
    return true;
  });

  const isEnabled = (providerId: string, modelId: string) => {
    return config.settings.enabledModels?.includes(`${providerId}/${modelId}`) ?? false;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Models</h1>
          <p className="mt-1 text-sm text-gray-400">
            Manage models across {availableProviders.length} providers
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          <Plus className="h-4 w-4" />
          Add Model
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search models..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-700 bg-gray-900 py-2 pl-10 pr-4 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 focus:border-blue-500 focus:outline-none"
        >
          <option value="all">All Providers</option>
          {availableProviders.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Model List */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Box className="h-12 w-12" />}
          title="No models found"
          description={search ? "Try a different search term" : "Add your first model to get started"}
          action={
            <button
              onClick={() => setShowAddForm(true)}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              Add Model
            </button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((m) => (
            <div
              key={`${m.providerId}/${m.id}`}
              className={cn(
                "rounded-xl border p-4 transition-all",
                isEnabled(m.providerId, m.id)
                  ? "border-gray-700 bg-gray-900/70"
                  : "border-gray-800/50 bg-gray-900/30 opacity-60"
              )}
            >
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-white">{m.name || m.id}</h3>
                    <ModelIcon model={m} />
                  </div>
                  <p className="mt-0.5 truncate text-xs text-gray-500">
                    {m.providerName} · {m.id}
                  </p>
                </div>
                <button
                  onClick={() => toggleModelEnabled(m.providerId, m.id)}
                  className={cn(
                    "rounded-lg p-1.5 transition-colors",
                    isEnabled(m.providerId, m.id)
                      ? "text-emerald-400 hover:bg-emerald-500/10"
                      : "text-gray-600 hover:bg-gray-800"
                  )}
                >
                  {isEnabled(m.providerId, m.id) ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                </button>
              </div>

              {/* Stats */}
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-400">
                <div>
                  <span className="text-gray-600">Context:</span>{" "}
                  {formatTokens(m.contextWindow ?? 128000)}
                </div>
                <div>
                  <span className="text-gray-600">Max tokens:</span>{" "}
                  {formatTokens(m.maxTokens ?? 16384)}
                </div>
                <div>
                  <span className="text-gray-600">Input:</span>{" "}
                  {formatCost(m.cost?.input ?? 0)}/M
                </div>
                <div>
                  <span className="text-gray-600">Output:</span>{" "}
                  {formatCost(m.cost?.output ?? 0)}/M
                </div>
              </div>

              {/* Actions */}
              <div className="mt-3 flex items-center gap-2 border-t border-gray-800 pt-3">
                <button
                  onClick={() => setEditModel(m)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                >
                  <Edit3 className="h-3 w-3" />
                  Edit
                </button>
                <button
                  onClick={() => removeModel(m.providerId, m.id)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-red-500/10 hover:text-red-400"
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit Model Modal */}
      <Modal
        open={!!editModel}
        onClose={() => setEditModel(null)}
        title={`Edit Model: ${editModel?.name || editModel?.id}`}
        size="lg"
      >
        {editModel && (
          <ModelForm
            initial={editModel}
            onSubmit={(updates) => {
              updateModel(editModel.providerId, editModel.id, updates);
              setEditModel(null);
            }}
            onCancel={() => setEditModel(null)}
          />
        )}
      </Modal>

      {/* Add Model Modal */}
      <Modal
        open={showAddForm}
        onClose={() => setShowAddForm(false)}
        title="Add New Model"
        size="lg"
      >
        <AddModelForm
          providers={availableProviders}
          onSubmit={(providerId, model) => {
            addModelToProvider(providerId, model);
            setShowAddForm(false);
          }}
          onCancel={() => setShowAddForm(false)}
        />
      </Modal>
    </div>
  );
}

// ─── Model Form ───────────────────────────────────────────

interface ModelFormProps {
  initial: Model;
  onSubmit: (updates: Partial<Model>) => void;
  onCancel: () => void;
}

function ModelForm({ initial, onSubmit, onCancel }: ModelFormProps) {
  const [form, setForm] = useState<Partial<Model>>({ ...initial });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-400">Model ID</label>
          <input
            type="text"
            value={form.id ?? ""}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400">Display Name</label>
          <input
            type="text"
            value={form.name ?? ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400">Context Window</label>
          <input
            type="number"
            value={form.contextWindow ?? 128000}
            onChange={(e) => setForm({ ...form, contextWindow: parseInt(e.target.value) || 128000 })}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400">Max Output Tokens</label>
          <input
            type="number"
            value={form.maxTokens ?? 16384}
            onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) || 16384 })}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
        </div>
      </div>

      {/* Capabilities */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-2">Capabilities</label>
        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.reasoning ?? false}
              onChange={(e) => setForm({ ...form, reasoning: e.target.checked })}
              className="rounded border-gray-600 bg-gray-800 text-blue-500"
            />
            Extended Thinking
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={form.input?.includes("image") ?? false}
              onChange={(e) =>
                setForm({
                  ...form,
                  input: e.target.checked ? ["text", "image"] : ["text"],
                })
              }
              className="rounded border-gray-600 bg-gray-800 text-blue-500"
            />
            Image Input
          </label>
        </div>
      </div>

      {/* Cost */}
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-2">Cost ($/M tokens)</label>
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-500">Input</label>
            <input
              type="number"
              step="0.01"
              value={form.cost?.input ?? 0}
              onChange={(e) =>
                setForm({
                  ...form,
                  cost: { ...form.cost!, input: parseFloat(e.target.value) || 0 },
                })
              }
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500">Output</label>
            <input
              type="number"
              step="0.01"
              value={form.cost?.output ?? 0}
              onChange={(e) =>
                setForm({
                  ...form,
                  cost: { ...form.cost!, output: parseFloat(e.target.value) || 0 },
                })
              }
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500">Cache Read</label>
            <input
              type="number"
              step="0.01"
              value={form.cost?.cacheRead ?? 0}
              onChange={(e) =>
                setForm({
                  ...form,
                  cost: { ...form.cost!, cacheRead: parseFloat(e.target.value) || 0 },
                })
              }
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500">Cache Write</label>
            <input
              type="number"
              step="0.01"
              value={form.cost?.cacheWrite ?? 0}
              onChange={(e) =>
                setForm({
                  ...form,
                  cost: { ...form.cost!, cacheWrite: parseFloat(e.target.value) || 0 },
                })
              }
              className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800">
          Cancel
        </button>
        <button
          onClick={() => onSubmit(form)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
        >
          Save Changes
        </button>
      </div>
    </div>
  );
}

// ─── Add Model Form ───────────────────────────────────────

interface AddModelFormProps {
  providers: { id: string; name: string }[];
  onSubmit: (providerId: string, model: Model) => void;
  onCancel: () => void;
}

function AddModelForm({ providers, onSubmit, onCancel }: AddModelFormProps) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [form, setForm] = useState<Partial<Model>>({
    id: "",
    name: "",
    reasoning: false,
    input: ["text"],
    contextWindow: 128000,
    maxTokens: 16384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  });

  const handleSubmit = () => {
    if (!form.id || !providerId) return;
    onSubmit(providerId, form as Model);
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-400">Provider</label>
        <select
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-400">Model ID *</label>
          <input
            type="text"
            value={form.id ?? ""}
            onChange={(e) => setForm({ ...form, id: e.target.value })}
            placeholder="e.g. my-custom-model"
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400">Display Name</label>
          <input
            type="text"
            value={form.name ?? ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="My Custom Model"
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
          Extended Thinking
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={form.input?.includes("image") ?? false}
            onChange={(e) =>
              setForm({
                ...form,
                input: e.target.checked ? ["text", "image"] : ["text"],
              })
            }
            className="rounded border-gray-600 bg-gray-800 text-blue-500"
          />
          Image Input
        </label>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="block text-xs text-gray-500">Input $/M</label>
          <input
            type="number"
            step="0.01"
            value={form.cost?.input ?? 0}
            onChange={(e) =>
              setForm({ ...form, cost: { ...form.cost!, input: parseFloat(e.target.value) || 0 } })
            }
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500">Output $/M</label>
          <input type="number" step="0.01" value={form.cost?.output ?? 0}
            onChange={(e) =>
              setForm({ ...form, cost: { ...form.cost!, output: parseFloat(e.target.value) || 0 } })
            }
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white" />
        </div>
        <div>
          <label className="block text-xs text-gray-500">Context Window</label>
          <input type="number" value={form.contextWindow ?? 128000}
            onChange={(e) => setForm({ ...form, contextWindow: parseInt(e.target.value) || 128000 })}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white" />
        </div>
        <div>
          <label className="block text-xs text-gray-500">Max Tokens</label>
          <input type="number" value={form.maxTokens ?? 16384}
            onChange={(e) => setForm({ ...form, maxTokens: parseInt(e.target.value) || 16384 })}
            className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white" />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onCancel} className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800">
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!form.id}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          Add Model
        </button>
      </div>
    </div>
  );
}