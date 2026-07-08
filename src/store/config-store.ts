import { create } from "zustand";
import type { PiConfig, Provider, Model, PiSettings, PiAuth, PiModelsJson, CustomProviderConfig } from "@/types";
import { loadConfig, saveConfig } from "@/lib/config";
import { getAllProviders, getAllModels } from "@/data/mock-config";
import { getModelSummaries, getProviderSummaries, getDailyAggregates, getTotals } from "@/data/mock-usage";

interface ConfigState {
  config: PiConfig;
  initialized: boolean;

  // Derived
  allProviders: Provider[];
  allModels: (Model & { providerId: string; providerName: string })[];

  // Usage
  dailyAggregates: ReturnType<typeof getDailyAggregates>;
  providerSummaries: ReturnType<typeof getProviderSummaries>;
  modelSummaries: ReturnType<typeof getModelSummaries>;
  totals: ReturnType<typeof getTotals>;

  // Actions
  init: () => void;
  updateSettings: (settings: Partial<PiSettings>) => void;
  updateAuth: (auth: PiAuth) => void;
  updateModelsJson: (modelsJson: PiModelsJson) => void;

  // Model CRUD
  toggleModel: (providerId: string, modelId: string) => void;
  updateModel: (providerId: string, modelId: string, updates: Partial<Model>) => void;
  addModel: (providerId: string, model: Model) => void;
  removeModel: (providerId: string, modelId: string) => void;

  // Provider CRUD (custom)
  addCustomProvider: (id: string, config: CustomProviderConfig) => void;
  updateCustomProvider: (id: string, config: Partial<CustomProviderConfig>) => void;
  removeCustomProvider: (id: string) => void;

  // Auth
  setProviderAuth: (providerId: string, key: string) => void;
  removeProviderAuth: (providerId: string) => void;

  // Actions
  toggleModelEnabled: (providerId: string, modelId: string) => void;
  addModelToProvider: (providerId: string, model: Model) => void;

  // Settings
  setDefaultProvider: (provider: string) => void;
  setDefaultModel: (model: string) => void;
  setTheme: (theme: PiSettings["theme"]) => void;
  addEnabledModel: (modelRef: string) => void;
  removeEnabledModel: (modelRef: string) => void;
  addPackage: (pkg: string) => void;
  removePackage: (pkg: string) => void;

  // Import/Export
  importConfig: (config: PiConfig) => void;
  resetToDefaults: () => void;

  // Recompute
  _recompute: () => void;
}

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: loadConfig(),
  initialized: false,

  allProviders: [],
  allModels: [],
  dailyAggregates: [],
  providerSummaries: [],
  modelSummaries: [],
  totals: { totalTokens: 0, totalCost: 0, totalRequests: 0 },

  init: () => {
    const { config, _recompute } = get();
    _recompute();
    set({ initialized: true });
  },

  // Internal: recompute derived data
  _recompute: () => {
    const { config } = get();
    set({
      allProviders: getAllProviders(config),
      allModels: getAllModels(config),
      dailyAggregates: getDailyAggregates(),
      providerSummaries: getProviderSummaries(),
      modelSummaries: getModelSummaries(),
      totals: getTotals(),
    });
  },

  updateSettings: (settings) => {
    const { config, _recompute } = get();
    const newConfig = {
      ...config,
      settings: { ...config.settings, ...settings },
    };
    saveConfig(newConfig);
    set({ config: newConfig });
    _recompute();
  },

  updateAuth: (auth) => {
    const { config, _recompute } = get();
    const newConfig = { ...config, auth };
    saveConfig(newConfig);
    set({ config: newConfig });
    _recompute();
  },

  updateModelsJson: (modelsJson) => {
    const { config, _recompute } = get();
    const newConfig = { ...config, modelsJson };
    saveConfig(newConfig);
    set({ config: newConfig });
    _recompute();
  },

  toggleModel: (providerId, modelId) => {
    const { config, _recompute } = get();
    const p = config.modelsJson?.providers[providerId];
    if (!p?.models) return;
    const newModels = p.models.map((m) =>
      m.id === modelId ? { ...m, enabled: !(m.enabled ?? true) } : m
    );
    const newProviders = {
      ...config.modelsJson!.providers,
      [providerId]: { ...p, models: newModels },
    };
    const newConfig = {
      ...config,
      modelsJson: { providers: newProviders },
    };
    saveConfig(newConfig);
    set({ config: newConfig });
    _recompute();
  },

  updateModel: (providerId, modelId, updates) => {
    const { config, _recompute } = get();
    const isBuiltin = !config.modelsJson?.providers[providerId];
    if (isBuiltin) {
      // For builtin providers, store model overrides in modelsJson
      const newProviders = { ...(config.modelsJson?.providers ?? {}) };
      if (!newProviders[providerId]) {
        newProviders[providerId] = { models: [] };
      }
      const existingModels = newProviders[providerId]!.models ?? [];
      const idx = existingModels.findIndex((m) => m.id === modelId);
      if (idx >= 0) {
        existingModels[idx] = { ...existingModels[idx], ...updates } as Model;
      } else {
        existingModels.push({ id: modelId, ...updates } as Model);
      }
      newProviders[providerId] = {
        ...newProviders[providerId],
        models: existingModels,
      };
      const newConfig = {
        ...config,
        modelsJson: { providers: newProviders },
      };
      saveConfig(newConfig);
      set({ config: newConfig });
    } else {
      // Custom provider
      const p = config.modelsJson!.providers[providerId]!;
      const newModels = (p.models ?? []).map((m) =>
        m.id === modelId ? { ...m, ...updates } : m
      );
      const newProviders = {
        ...config.modelsJson!.providers,
        [providerId]: { ...p, models: newModels },
      };
      const newConfig = {
        ...config,
        modelsJson: { providers: newProviders },
      };
      saveConfig(newConfig);
      set({ config: newConfig });
    }
    _recompute();
  },

  addModel: (providerId, model) => {
    const { config, _recompute } = get();
    const p = config.modelsJson?.providers[providerId] ?? { models: [] };
    const newModels = [...(p.models ?? []), { ...model, enabled: true }];
    const newProviders = {
      ...(config.modelsJson?.providers ?? {}),
      [providerId]: { ...p, models: newModels },
    };
    const newConfig = {
      ...config,
      modelsJson: { providers: newProviders },
    };
    saveConfig(newConfig);
    set({ config: newConfig });
    _recompute();
  },

  removeModel: (providerId, modelId) => {
    const { config, _recompute } = get();
    const p = config.modelsJson?.providers[providerId];
    if (!p?.models) return;
    const newModels = p.models.filter((m) => m.id !== modelId);
    const newProviders = {
      ...config.modelsJson!.providers,
      [providerId]: { ...p, models: newModels },
    };
    const newConfig = {
      ...config,
      modelsJson: { providers: newProviders },
    };
    saveConfig(newConfig);
    set({ config: newConfig });
    _recompute();
  },

  addCustomProvider: (id, providerConfig) => {
    const { config, _recompute } = get();
    const newProviders = {
      ...(config.modelsJson?.providers ?? {}),
      [id]: providerConfig,
    };
    const newConfig = {
      ...config,
      modelsJson: { providers: newProviders },
    };
    saveConfig(newConfig);
    set({ config: newConfig });
    _recompute();
  },

  updateCustomProvider: (id, providerConfig) => {
    const { config, _recompute } = get();
    const existing = config.modelsJson?.providers[id];
    if (!existing) return;
    const newProviders = {
      ...config.modelsJson!.providers,
      [id]: { ...existing, ...providerConfig },
    };
    const newConfig = {
      ...config,
      modelsJson: { providers: newProviders },
    };
    saveConfig(newConfig);
    set({ config: newConfig });
    _recompute();
  },

  removeCustomProvider: (id) => {
    const { config, _recompute } = get();
    if (!config.modelsJson?.providers[id]) return;
    const { [id]: _removed, ...newProviders } = config.modelsJson.providers;
    const newConfig = {
      ...config,
      modelsJson: { providers: newProviders },
    };
    saveConfig(newConfig);
    set({ config: newConfig });
    _recompute();
  },

  setProviderAuth: (providerId, key) => {
    const { config, _recompute } = get();
    const newAuth = {
      ...config.auth,
      [providerId]: { type: "api_key" as const, key },
    };
    const newConfig = { ...config, auth: newAuth };
    saveConfig(newConfig);
    set({ config: newConfig });
    _recompute();
  },

  removeProviderAuth: (providerId) => {
    const { config, _recompute } = get();
    const { [providerId]: _, ...newAuth } = config.auth;
    const newConfig = { ...config, auth: newAuth };
    saveConfig(newConfig);
    set({ config: newConfig });
    _recompute();
  },

  toggleModelEnabled: (providerId, modelId) => {
    const { config, _recompute } = get();
    const enabledModels = config.settings.enabledModels ?? [];
    const ref = `${providerId}/${modelId}`;
    const newEnabled = enabledModels.includes(ref)
      ? enabledModels.filter((m) => m !== ref)
      : [...enabledModels, ref];
    const newConfig = {
      ...config,
      settings: { ...config.settings, enabledModels: newEnabled },
    };
    saveConfig(newConfig);
    set({ config: newConfig });
    _recompute();
  },

  addModelToProvider: (providerId, model) => {
    const { config, _recompute } = get();
    const existingProvider = config.modelsJson?.providers[providerId] ?? { models: [] };
    const newModels = [...(existingProvider.models ?? []), model];
    const newProviders = {
      ...(config.modelsJson?.providers ?? {}),
      [providerId]: { ...existingProvider, models: newModels },
    };
    const newConfig = {
      ...config,
      modelsJson: { providers: newProviders },
    };
    saveConfig(newConfig);
    set({ config: newConfig });
    _recompute();
  },

  setDefaultProvider: (provider) => {
    get().updateSettings({ defaultProvider: provider });
  },

  setDefaultModel: (model) => {
    get().updateSettings({ defaultModel: model });
  },

  setTheme: (theme) => {
    get().updateSettings({ theme });
    if (theme === "dark" || theme === "light/dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  },

  addEnabledModel: (modelRef) => {
    const { config } = get();
    const enabled = [...(config.settings.enabledModels ?? []), modelRef];
    get().updateSettings({ enabledModels: enabled });
  },

  removeEnabledModel: (modelRef) => {
    const { config } = get();
    const enabled = (config.settings.enabledModels ?? []).filter((m) => m !== modelRef);
    get().updateSettings({ enabledModels: enabled });
  },

  addPackage: (pkg) => {
    const { config } = get();
    const packages = [...(config.settings.packages ?? []), pkg];
    get().updateSettings({ packages });
  },

  removePackage: (pkg) => {
    const { config } = get();
    const packages = (config.settings.packages ?? []).filter((p) => p !== pkg);
    get().updateSettings({ packages });
  },

  importConfig: (newConfig) => {
    saveConfig(newConfig);
    set({ config: newConfig });
    get()._recompute();
  },

  resetToDefaults: () => {
    const { init } = get();
    localStorage.removeItem("pi-web-switch-config");
    set({ config: loadConfig() });
    get()._recompute();
  },
}));