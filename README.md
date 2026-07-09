<p align="center">
  <img src="public/pi.svg" width="80" height="80" alt="pi-switch logo" />
</p>

<h1 align="center">pi-web-switch</h1>

<p align="center">
  <strong>Web UI for pi coding agent — live configuration management, session browser, and memory viewer</strong>
</p>

<p align="center">
  <a href="README.md">🇬🇧 English</a> ·
  <a href="README.zh-CN.md">🇨🇳 中文</a> ·
  <a href="README.ja.md">🇯🇵 日本語</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss" alt="Tailwind v4" />
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite" alt="Vite 6" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
</p>

<p align="center">
  Inspired by <a href="https://github.com/farion1231/cc-switch">cc-switch</a> — a visual dashboard for managing your <a href="https://pi.dev">pi coding agent</a> providers, models, token usage, sessions, and settings.
</p>

<p align="center">
  <strong>Reads data directly from <code>~/.pi/agent/</code></strong> — no mock data, no database, no backend setup required.
</p>

---

## ✨ Features

### 📊 Dashboard
- **Usage Statistics** — Today / 7 days / 30 days / Custom date range selector with auto-refresh (5s/10s/30s/60s)
- **Token Breakdown** — Exact token count with approximate display (e.g. `1,631,022 ≈ 1.6M`) and Input/Output/Cache Hit/Cache Create breakdown
- **Cost Tracking** — Daily cost chart + Provider/Model stats tabs with aggregated data
- **Cache Hit Rate** — Visual progress bar showing cache efficiency
- **Request Log** — Detailed log table with time, provider, model, tokens, cost
- **Currency Switch** — Toggle between USD and CNY with real-time conversion (1 USD = 7.2 CNY)
- **Hourly/Daily Granularity** — Today view shows per-hour data; 7d/30d views show per-day data
- All data sourced from **real pi session files** (`~/.pi/agent/sessions/*.jsonl`)

### 📦 Models
- **Model Grid** — Browse all built-in and custom models with search and filter
- **Enable/Disable** — Toggle models on/off to match your `enabledModels` config
- **Edit Model** — Update capabilities, cost, context window, max tokens
- **Add Model** — Create new models for any provider
- **Delete Model** — Remove custom models

### 🔌 Providers
- **Provider List** — Expandable cards for all built-in and custom providers
- **Custom Providers** — Add Ollama, vLLM, LM Studio, or any OpenAI-compatible provider
- **API Key Management** — Set/remove API keys per provider (saved to `auth.json`)
- **Provider Configuration** — baseUrl, API type, custom headers, auth method

### 💬 Sessions
- **Project Grouping** — Auto-decodes session directory names into project paths
- **Session Browser** — View all 100+ sessions across projects
- **Session Details** — Name, timestamp, message count, duration, provider/model used
- **Search & Filter** — Filter sessions by project name
- **Delete Sessions** — Remove old session files (sessions updated within 3 days are protected)

### 🧠 Memory (pi-hermes-memory)
- **Project Memories** — View `MEMORY.md` content with Markdown rendering
- **User Profile** — Display `USER.md` preferences and settings
- **Failure Records** — Browse `failures.md` known issues
- **Live Sync** — Content updates immediately when memory files change on disk

### 🌐 Multi-language
- **English** 🇬🇧 — Default
- **Simplified Chinese** 🇨🇳 — 简体中文
- **Traditional Chinese** 🇭🇰 — 繁體中文
- **Japanese** 🇯🇵 — 日本語
- Language switcher in sidebar footer, persists across sessions

### ⚙️ Settings
- **Defaults** — Default provider, model, thinking level, project trust
- **Theme** — Light / Dark / System with immediate toggle (CSS variables for both modes)
- **Enabled Models** — View and manage the full enabled models list
- **Extensions & Packages** — Manage pi packages list
- **Import/Export** — Download full config as JSON, restore from backup
- **Reset** — Factory reset to blank configuration

## 🌗 Theme Support

Full light and dark mode with system-follow support. Theme toggles instantly via CSS custom properties — no page reload needed. All components adapt including sidebar, modals, forms, charts, and scrollbars.

## 🧱 Built-in Providers

The app ships with definitions for **11 built-in providers** and **26 models** (hardcoded from pi's Rust source):

| Provider | Models |
|----------|--------|
| Anthropic | Claude Sonnet 4, Sonnet 4.5, Opus 4, Haiku 3.5 |
| OpenAI | GPT-4o, GPT-4o-mini, GPT-5.1, o3-mini |
| DeepSeek | DeepSeek V3, DeepSeek R1 |
| OpenCode | DeepSeek V4 Flash (Free), DeepSeek V4 Flash |
| OpenCode Go | DeepSeek V4 Flash, V4 Pro, GLM 5.1, Qwen 3.7 Max, MiMo V2.5 |
| SenseNova | GLM 5.2, DeepSeek V4 Flash |
| Google Gemini | Gemini 2.5 Flash, Gemini 2.5 Pro |
| OpenRouter | Claude Sonnet 4, DeepSeek R1 |
| Mistral | Mistral Large |
| GitHub Copilot | Copilot GPT-4o |
| Groq | Llama 3.3 70B |

## 🚀 Getting Started

### Prerequisites

- **pi coding agent** installed and configured (so `~/.pi/agent/` exists)
- Node.js 18+

### Setup

```bash
# Clone
git clone https://github.com/Raingor/pi-web-switch.git
cd pi-web-switch

# Install dependencies
npm install

# Start dev server (reads ~/.pi/agent/ automatically)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

The dev server automatically serves pi configuration via Vite middleware at `/api/pi/*` — no separate backend process needed.

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | [React 19](https://react.dev/) |
| Language | [TypeScript 5.8](https://www.typescriptlang.org/) |
| Build | [Vite 6](https://vitejs.dev/) |
| Styling | [Tailwind CSS v4](https://tailwindcss.com/) |
| State | [Zustand](https://github.com/pmndrs/zustand) |
| Charts | [Recharts](https://recharts.org/) |
| Icons | [Lucide React](https://lucide.dev/) |
| Routing | [React Router v7](https://reactrouter.com/) |

## 🗂️ Project Structure

```
pi-web-switch/
├── index.html
├── package.json
├── vite.config.ts          # Vite config + pi API plugin (middleware)
├── tsconfig.json
├── server/
│   └── pi-reader.ts        # Server-side module: reads ~/.pi/agent/ files + parses sessions
├── public/
│   └── pi.svg
└── src/
    ├── main.tsx            # Entry point + theme sync + init gate + i18n provider
    ├── App.tsx             # Router setup (6 routes)
    ├── index.css           # Tailwind + CSS theme variables (light/dark)
    ├── types/index.ts      # All TypeScript interfaces
    ├── data/
    │   └── builtin-providers.ts  # Hardcoded built-in provider definitions
    ├── store/
    │   └── config-store.ts # Zustand store (fetches from /api/pi/*)
    ├── lib/
    │   ├── utils.ts        # Formatting helpers (tokens, cost with USD/CNY)
    │   ├── i18n.tsx        # Multi-language system (React Context + hook)
    │   ├── currency.ts     # Currency switching (USD/CNY toggle)
    │   ├── config.ts       # Config import/export helpers
    │   └── translations/   # Translation files (en, zh-CN, zh-TW, ja)
    └── components/
        ├── layout/          # AppShell, Sidebar (6 nav items + language switcher)
        ├── ui/              # StatCard, Badge, Modal, EmptyState
        ├── dashboard/       # DashboardPage + charts (hourly/daily granularity)
        ├── models/          # ModelsPage + forms
        ├── providers/       # ProvidersPage + forms
        ├── sessions/        # SessionsPage + MemoryPage
        └── settings/        # SettingsPage
```

## 💾 Data Source

All data is read directly from **`~/.pi/agent/`** on your machine via a Vite middleware API plugin — no mock data, no database, no external service.

| File | Purpose |
|------|---------|
| `~/.pi/agent/settings.json` | Default provider, model, theme, enabled models, packages |
| `~/.pi/agent/auth.json` | API keys per provider |
| `~/.pi/agent/models.json` | Custom provider definitions (baseUrl, API type, models) |
| `~/.pi/agent/sessions/*.jsonl` | Session history with token usage, model, provider per message |
| `~/.pi/agent/pi-hermes-memory/*.md` | Hermes memory (MEMORY.md, USER.md, failures.md) |

Changes made in the UI are written back to these files in real time — the pi agent picks them up on next reload.

### Sessions & Usage

- The app parses **106+ JSONL session files** from `sessions/` directory
- Each assistant message's API usage data (tokens, cost) is extracted and aggregated
- Dashboard shows real token consumption, costs, and request volumes across all sessions
- Sessions list groups by project (decoded from directory names) with 24+ project groups

## 🧩 API Routes

The Vite dev server exposes these endpoints at `/api/pi/*`:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pi/settings` | Read `settings.json` |
| POST | `/api/pi/settings` | Write `settings.json` |
| GET | `/api/pi/auth` | Read `auth.json` |
| POST | `/api/pi/auth` | Write `auth.json` |
| GET | `/api/pi/models` | Read `models.json` |
| POST | `/api/pi/models` | Write `models.json` |
| GET | `/api/pi/builtin-providers` | List hardcoded built-in providers |
| GET | `/api/pi/usage` | Aggregated token/cost/request data from sessions |
| GET | `/api/pi/usage-range` | Date-range filtered usage with hourly/daily breakdown |
| GET | `/api/pi/sessions` | Session list grouped by project |
| DELETE | `/api/pi/session?path=` | Delete a session file (path must be under sessions/) |
| GET | `/api/pi/memory` | Read MEMORY.md, USER.md, failures.md |

## 🔗 Links

- **Homepage:** [raingor.github.io/my-blog](https://raingor.github.io/my-blog/)

## 📄 License

MIT
