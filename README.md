<p align="center">
  <img src="public/pi.svg" width="80" height="80" alt="pi-switch logo" />
</p>

<h1 align="center">pi-web-switch</h1>

<p align="center">
  <strong>Web UI for pi coding agent configuration management</strong>
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
  Inspired by <a href="https://github.com/farion1231/cc-switch">cc-switch</a> — a visual dashboard for managing your <a href="https://pi.dev">pi coding agent</a> providers, models, token usage, and settings.
</p>

---

## ✨ Features

### 📊 Dashboard
- **Token Usage Trend** — 30-day area chart of daily token consumption
- **Cost Tracking** — Daily cost chart + cost breakdown by provider (pie chart)
- **Request Volume** — Bar chart showing API call volume over time
- **Provider Summary** — Table of all providers with totals (tokens, cost, requests)
- **Key Stats** — Total tokens, total cost, total requests, active providers

### 📦 Models
- **Model Grid** — Browse all models across providers with search and filter
- **Enable/Disable** — Toggle models on/off to match your `enabledModels` config
- **Edit Model** — Update capabilities (reasoning, image input), cost, context window, max tokens
- **Add Model** — Wizard to create new models for any provider
- **Delete Model** — Remove custom models

### 🔌 Providers
- **Provider List** — Expandable cards showing all built-in and custom providers
- **Custom Providers** — Add Ollama, vLLM, LM Studio, or any OpenAI-compatible provider
- **API Key Management** — Set/remove API keys per provider
- **Provider Configuration** — baseUrl, API type, custom headers, auth method

### ⚙️ Settings
- **Defaults** — Default provider, model, thinking level, project trust
- **Theme** — Light / Dark / System with immediate toggle
- **Enabled Models** — View and manage the full enabled models list
- **Extensions & Packages** — Manage pi packages list
- **Import/Export** — Download full config as JSON, restore from backup
- **Reset** — Factory reset to default configuration

## 🧱 Built-in Providers

The app ships with mock data for **12 built-in providers** and **30+ models**:

| Provider | Models |
|----------|--------|
| Anthropic | Claude Sonnet 4, Opus 4, Haiku 3.5 |
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

```bash
# Clone
git clone https://github.com/Raingor/pi-web-switch.git
cd pi-web-switch

# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

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
├── vite.config.ts
├── tsconfig.json
├── public/
│   └── pi.svg
└── src/
    ├── main.tsx              # Entry point + init gate
    ├── App.tsx               # Router setup
    ├── index.css             # Tailwind + globals
    ├── types/index.ts        # All TypeScript interfaces
    ├── data/
    │   ├── mock-config.ts    # Built-in providers + mock config
    │   └── mock-usage.ts     # 30-day mock usage data generator
    ├── store/
    │   └── config-store.ts   # Zustand store (CRUD + usage slices)
    ├── lib/
    │   ├── utils.ts          # Formatting helpers
    │   └── config.ts         # localStorage + import/export
    └── components/
        ├── layout/           # AppShell, Sidebar
        ├── ui/               # StatCard, Badge, Modal, EmptyState
        ├── dashboard/        # DashboardPage + charts
        ├── models/           # ModelsPage + forms
        ├── providers/        # ProvidersPage + forms
        └── settings/         # SettingsPage
```

## 💾 Data Model

The app models pi's real configuration structure:

- **`settings.json`** — Default provider, model, enabled models, packages, theme, etc.
- **`auth.json`** — API keys stored per provider
- **`models.json`** — Custom provider definitions (baseUrl, API type, models array with cost/capabilities)
- **Usage data** — 30 days of mock token/cost/request data for 15 model-provider pairs

All data is persisted to `localStorage`. Use the Settings page to export/import configuration as JSON.

## 🔗 Links

- **Homepage:** [raingor.github.io/my-blog](https://raingor.github.io/my-blog/)

## 📄 License

MIT