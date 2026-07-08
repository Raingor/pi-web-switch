# task_plan.md — pi-web-switch

## Goal
Build a web app (Vite + React + TS) "pi-web-switch" that provides a visual management interface for the `pi` coding agent, inspired by cc-switch (github.com/farion1231/cc-switch).

## Data Model (based on real pi config)
- **Settings**: ~/.pi/agent/settings.json — defaultProvider, defaultModel, theme, enabledModels, packages, etc.
- **Auth**: ~/.pi/agent/auth.json — api_key entries per provider
- **Models**: ~/.pi/agent/models.json (optional) — custom providers with baseUrl, api type, models array
- **Usage**: Mock 30-day usage data (tokens, cost, requests per model/provider)

## Stack
Vite + React 19 + TypeScript + Tailwind CSS v4 + recharts + zustand + lucide-react + React Router

## Phases

### Phase 1: Project Scaffold ✅
- [x] package.json with all deps
- [x] vite.config.ts, tsconfig, tailwind config
- [x] index.html, entry point, global CSS

### Phase 2: Types + Mock Data ✅
- [x] Define TypeScript interfaces (Provider, Model, UsageRecord, PiConfig, etc.)
- [x] Default mock config matching pi's real structure (12 built-in providers, 30+ models)
- [x] 30-day mock usage data generator (15 model-provider pairs)

### Phase 3: State Management + Utils ✅
- [x] Zustand store (config state, CRUD actions, providers/models/usage slices)
- [x] Config lib (load/save to localStorage, import/export JSON)
- [x] Utility functions (token formatting, cost calc, date formatting)

### Phase 4: Layout + Shared UI ✅
- [x] App shell: sidebar navigation, top bar, main content area
- [x] Shared components: StatCard, DataTable, Modal/Sheet, Badge, EmptyState

### Phase 5: Dashboard Page ✅
- [x] Summary stats (total tokens, total cost, total requests, active providers)
- [x] Token usage trend chart (recharts area chart, 30d)
- [x] Cost breakdown by provider (pie chart)
- [x] Daily cost chart
- [x] Request volume bar chart
- [x] Provider usage summary table

### Phase 6: Models Page ✅
- [x] Model list/cards (search, filter by provider)
- [x] Model detail/edit (cost, capabilities, thinking, context window)
- [x] Model building wizard (name → provider → capabilities → cost)
- [x] Enable/disable toggles
- [x] Delete model with confirmation

### Phase 7: Providers Page ✅
- [x] Provider list with status (configured auth)
- [x] Add custom provider form (baseUrl, api type, apiKey, headers)
- [x] Edit provider (update endpoints, auth)
- [x] Delete provider
- [x] Auth key management per provider

### Phase 8: Settings Page ✅
- [x] Default provider/model selector
- [x] Theme toggle (light/dark/system)
- [x] JSON export/import (full config)
- [x] Auth keys management (view/set providers with keys)
- [x] Enabled models list management
- [x] Extensions & packages management
- [x] Danger zone (reset to defaults)

### Phase 9: Polish & Verify ✅
- [x] Install deps, ts compiles clean
- [x] Vite build succeeds (25KB JS + 25KB CSS gzipped)
- [x] Dev server starts and serves HTTP 200

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| TS strict type errors (Partial<Model> assignability) | Added `as Model` casts and non-null assertions | Fixed type narrowing |
| Vite build: `@/` alias not resolved | Added `resolve.alias` to vite.config.ts | Added `path` import and alias config |

## Project Structure
```
pi-web-switch/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── public/pi.svg
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── index.css
    ├── vite-env.d.ts
    ├── types/index.ts
    ├── data/
    │   ├── mock-config.ts
    │   └── mock-usage.ts
    ├── store/
    │   └── config-store.ts
    ├── lib/
    │   ├── utils.ts
    │   └── config.ts
    └── components/
        ├── layout/
        │   ├── AppShell.tsx
        │   └── Sidebar.tsx
        ├── ui/
        │   ├── Badge.tsx
        │   ├── StatCard.tsx
        │   ├── Modal.tsx
        │   └── EmptyState.tsx
        ├── dashboard/
        │   └── DashboardPage.tsx
        ├── models/
        │   └── ModelsPage.tsx
        ├── providers/
        │   └── ProvidersPage.tsx
        └── settings/
            └── SettingsPage.tsx
```