import { create } from "zustand";
import type {
  PiConfig,
  Provider,
  Model,
  PiSettings,
  PiAuth,
  PiModelsJson,
  CustomProviderConfig,
} from "@/types";
import { BUILTIN_PROVIDERS } from "@/data/builtin-providers";

// ─── API Helper ──────────────────────────────────────────

const API_BASE = "/api/pi";

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`);
  return res.json();
}

async function apiPost(path: string, data: unknown): Promise<boolean> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) return false;
  const result = await res.json();
  return result.success === true;
}

// ─── Built-in Provider Helpers (Client-side) ────────────

function getCustomProviders(modelsJson: PiModelsJson | null): Provider[] {
  if (!modelsJson) return [];
  return Object.entries(modelsJson.providers).map(([id, cfg]) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    type: "custom" as const,
    baseUrl: cfg.baseUrl,
    api: cfg.api,
    apiKey: cfg.apiKey,
    authHeader: cfg.authHeader,
    headers: cfg.headers,
    compat: cfg.compat,
    hasAuth: !!cfg.apiKey,
    authMethod: (cfg.apiKey ? "file" : "none") as "file" | "none",
    models: (cfg.models ?? []).map((m) => ({ ...m, enabled: true })),
  }));
}

function mergeProviders(auth: PiAuth, customModels: PiModelsJson | null): Provider[] {
  const builtins = BUILTIN_PROVIDERS.map((p) => ({
    ...p,
    hasAuth: p.hasAuth || !!auth[p.id],
    authMethod: auth[p.id] ? "file" : p.authMethod,
  }));
  const customs = getCustomProviders(customModels);
  return [...builtins, ...customs];
}

// ─── State Types ─────────────────────────────────────────

interface UsageData {
  dailyAggregates: {
    date: string;
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
    inputTokens: number;
    outputTokens: number;
  }[];
  providerSummaries: {
    providerId: string;
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
  }[];
  modelSummaries: {
    modelId: string;
    providerId: string;
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
    avgTokensPerRequest: number;
  }[];
  totals: {
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
  };
}

interface ConfigState {
  // Raw config from pi files
  settings: PiSettings | null;
  auth: PiAuth | null;
  modelsJson: PiModelsJson | null;

  // Derived
  allProviders: Provider[];
  allModels: (Model & { providerId: string; providerName: string })[];

  // Usage data from session files
  usage: UsageData | null;

  // Lifecycle
  initialized: boolean;
  loading: boolean;
  error: string | null;

  // Actions
  init: () => Promise<void>;
  refreshUsage: () => Promise<void>;

  // Settings
  updateSettings: (settings: Partial<PiSettings>) => Promise<void>;
  setDefaultProvider: (provider: string) => Promise<void>;
  setDefaultModel: (model: string) => Promise<void>;
  setTheme: (theme: PiSettings["theme"]) => Promise<void>;
  addEnabledModel: (modelRef: string) => Promise<void>;
  removeEnabledModel: (modelRef: string) => Promise<void>;
  addPackage: (pkg: string) => Promise<void>;
  removePackage: (pkg: string) => Promise<void>;

  // Auth
  setProviderAuth: (providerId: string, key: string) => Promise<void>;
  removeProviderAuth: (providerId: string) => Promise<void>;

  // Model CRUD (for custom providers)
  toggleModel: (providerId: string, modelId: string) => void;
  updateModel: (providerId: string, modelId: string, updates: Partial<Model>) => void;
  addModel: (providerId: string, model: Model) => void;
  removeModel: (providerId: string, modelId: string) => void;

  // Custom provider CRUD
  addCustomProvider: (id: string, cfg: CustomProviderConfig) => Promise<void>;
  updateCustomProvider: (id: string, cfg: Partial<CustomProviderConfig>) => Promise<void>;
  removeCustomProvider: (id: string) => Promise<void>;

  // Import/Export (to localStorage for backup, writes back to pi files)
  importConfig: (config: PiConfig) => Promise<void>;
  resetToDefaults: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  settings: null,
  auth: null,
  modelsJson: null,
  allProviders: [],
  allModels: [],
  usage: null,
  initialized: false,
  loading: true,
  error: null,

  // ─── Init ───────────────────────────────────────────────

  init: async () => {
    set({ loading: true, error: null });
    try {
      const [settings, auth, modelsJson, usage] = await Promise.all([
        apiGet<PiSettings>("/settings"),
        apiGet<PiAuth>("/auth"),
        apiGet<PiModelsJson>("/models"),
        apiGet<UsageData>("/usage"),
      ]);

      const allProviders = mergeProviders(auth ?? {}, modelsJson);
      const allModels = allProviders.flatMap((p) =>
        p.models.map((m) => ({
          ...m,
          providerId: p.id,
          providerName: p.name,
        }))
      );

      set({
        settings,
        auth,
        modelsJson,
        allProviders,
        allModels,
        usage,
        initialized: true,
        loading: false,
      });
    } catch (e: any) {
      set({
        error: e.message || "Failed to load pi configuration",
        loading: false,
        initialized: true,
      });
    }
  },

  // ─── Refresh Usage ──────────────────────────────────────

  refreshUsage: async () => {
    try {
      const usage = await apiGet<UsageData>("/usage");
      set({ usage });
    } catch {
      // ignore refresh errors
    }
  },

  // ─── Settings ───────────────────────────────────────────

  updateSettings: async (partial) => {
    const { settings } = get();
    if (!settings) return;
    const updated = { ...settings, ...partial };
    const ok = await apiPost("/settings", updated);
    if (ok) set({ settings: updated });
  },

  setDefaultProvider: async (provider) => {
    await get().updateSettings({ defaultProvider: provider });
  },

  setDefaultModel: async (model) => {
    await get().updateSettings({ defaultModel: model });
  },

  setTheme: async (theme) => {
    await get().updateSettings({ theme });
  },

  addEnabledModel: async (modelRef) => {
    const { settings } = get();
    if (!settings) return;
    const list = settings.enabledModels ?? [];
    if (!list.includes(modelRef)) {
      await get().updateSettings({ enabledModels: [...list, modelRef] });
    }
  },

  removeEnabledModel: async (modelRef) => {
    const { settings } = get();
    if (!settings) return;
    const list = (settings.enabledModels ?? []).filter((m) => m !== modelRef);
    await get().updateSettings({ enabledModels: list });
  },

  addPackage: async (pkg) => {
    const { settings } = get();
    if (!settings) return;
    const list = settings.packages ?? [];
    if (!list.includes(pkg)) {
      await get().updateSettings({ packages: [...list, pkg] });
    }
  },

  removePackage: async (pkg) => {
    const { settings } = get();
    if (!settings) return;
    const list = (settings.packages ?? []).filter((p) => p !== pkg);
    await get().updateSettings({ packages: list });
  },

  // ─── Auth ───────────────────────────────────────────────

  setProviderAuth: async (providerId, key) => {
    const { auth } = get();
    const updated = { ...(auth ?? {}), [providerId]: { type: "api_key" as const, key } };
    const ok = await apiPost("/auth", updated);
    if (ok) {
      set({ auth: updated });
      // Recompute providers with updated auth state
      const { modelsJson } = get();
      set({ allProviders: mergeProviders(updated, modelsJson) });
    }
  },

  removeProviderAuth: async (providerId) => {
    const { auth } = get();
    if (!auth) return;
    const { [providerId]: _, ...rest } = auth;
    const ok = await apiPost("/auth", rest);
    if (ok) {
      set({ auth: rest });
      const { modelsJson } = get();
      set({ allProviders: mergeProviders(rest, modelsJson) });
    }
  },

  // ─── Model CRUD (client-side only, stored in modelsJson) ─

  toggleModel: (providerId, modelId) => {
    const { modelsJson } = get();
    if (!modelsJson) return;
    const p = modelsJson.providers[providerId];
    if (!p?.models) return;
    const newModels = p.models.map((m) =>
      m.id === modelId ? { ...m, enabled: !(m.enabled ?? true) } : m
    );
    const newProviders = {
      ...modelsJson.providers,
      [providerId]: { ...p, models: newModels },
    };
    const updated = { providers: newProviders };
    set({ modelsJson: updated });
    // Persist
    apiPost("/models", updated);
    // Recompute providers
    const { auth } = get();
    set({ allProviders: mergeProviders(auth ?? {}, updated) });
  },

  updateModel: (providerId, modelId, updates) => {
    const { modelsJson } = get();
    if (!modelsJson) return;
    const isBuiltin = !modelsJson.providers[providerId];
    const newProviders = { ...(modelsJson.providers ?? {}) };

    if (!newProviders[providerId]) {
      newProviders[providerId] = { models: [] };
    }
    const existingModels = newProviders[providerId]!.models ?? [];
    const idx = existingModels.findIndex((m: any) => m.id === modelId);
    if (idx >= 0) {
      existingModels[idx] = { ...existingModels[idx], ...updates } as Model;
    } else if (isBuiltin) {
      // Store as override
      newProviders[providerId] = {
        ...newProviders[providerId],
        models: [...existingModels, updates as Model],
      };
    } else {
      existingModels.push(updates as Model);
    }
    newProviders[providerId] = { ...newProviders[providerId], models: existingModels };
    const updated = { providers: newProviders };
    set({ modelsJson: updated });
    apiPost("/models", updated);
    const { auth } = get();
    set({ allProviders: mergeProviders(auth ?? {}, updated) });
  },

  addModel: (providerId, model) => {
    const { modelsJson } = get();
    if (!modelsJson) return;
    const newProviders = { ...(modelsJson.providers ?? {}) };
    if (!newProviders[providerId]) {
      newProviders[providerId] = { models: [] };
    }
    newProviders[providerId] = {
      ...newProviders[providerId],
      models: [...(newProviders[providerId]!.models ?? []), { ...model, enabled: true }],
    };
    const updated = { providers: newProviders };
    set({ modelsJson: updated });
    apiPost("/models", updated);
    const { auth } = get();
    const newAllProviders = mergeProviders(auth ?? {}, updated);
    const newAllModels = newAllProviders.flatMap((p) =>
      p.models.map((m) => ({ ...m, providerId: p.id, providerName: p.name }))
    );
    set({ allProviders: newAllProviders, allModels: newAllModels });
  },

  removeModel: (providerId, modelId) => {
    const { modelsJson } = get();
    if (!modelsJson) return;
    const p = modelsJson.providers[providerId];
    if (!p?.models) return;
    const newModels = p.models.filter((m: any) => m.id !== modelId);
    const newProviders = {
      ...modelsJson.providers,
      [providerId]: { ...p, models: newModels },
    };
    const updated = { providers: newProviders };
    set({ modelsJson: updated });
    apiPost("/models", updated);
    const { auth } = get();
    set({ allProviders: mergeProviders(auth ?? {}, updated) });
  },

  // ─── Custom Provider CRUD ──────────────────────────────

  addCustomProvider: async (id, cfg) => {
    const { modelsJson } = get();
    if (!modelsJson) return;
    const newProviders = { ...modelsJson.providers, [id]: cfg };
    const updated = { providers: newProviders };
    const ok = await apiPost("/models", updated);
    if (ok) {
      set({ modelsJson: updated });
      const { auth } = get();
      set({ allProviders: mergeProviders(auth ?? {}, updated) });
    }
  },

  updateCustomProvider: async (id, cfg) => {
    const { modelsJson } = get();
    if (!modelsJson) return;
    const existing = modelsJson.providers[id];
    if (!existing) return;
    const newProviders = {
      ...modelsJson.providers,
      [id]: { ...existing, ...cfg },
    };
    const updated = { providers: newProviders };
    const ok = await apiPost("/models", updated);
    if (ok) {
      set({ modelsJson: updated });
      const { auth } = get();
      set({ allProviders: mergeProviders(auth ?? {}, updated) });
    }
  },

  removeCustomProvider: async (id) => {
    const { modelsJson } = get();
    if (!modelsJson) return;
    const { [id]: _, ...rest } = modelsJson.providers;
    const updated = { providers: rest };
    const ok = await apiPost("/models", updated);
    if (ok) {
      set({ modelsJson: updated });
      const { auth } = get();
      const newAllProviders = mergeProviders(auth ?? {}, updated);
      const newAllModels = newAllProviders.flatMap((p) =>
        p.models.map((m) => ({ ...m, providerId: p.id, providerName: p.name }))
      );
      set({ allProviders: newAllProviders, allModels: newAllModels });
    }
  },

  // ─── Import/Export ─────────────────────────────────────

  importConfig: async (config) => {
    // Write all three config files through the API
    await Promise.all([
      apiPost("/settings", config.settings),
      apiPost("/auth", config.auth),
      apiPost("/models", config.modelsJson ?? { providers: {} }),
    ]);
    // Reload
    await get().init();
  },

  resetToDefaults: async () => {
    // Write empty/default configs
    await Promise.all([
      apiPost("/settings", {
        lastChangelogVersion: "0.80.3",
        defaultProvider: "",
        defaultModel: "",
        theme: "dark",
        hideThinkingBlock: true,
        retry: { enabled: true },
        packages: [],
        enabledModels: [],
      }),
      apiPost("/auth", {}),
      apiPost("/models", { providers: {} }),
    ]);
    await get().init();
  },
}));
