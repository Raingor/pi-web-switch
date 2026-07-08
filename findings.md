# findings.md - pi-web-switch

## cc-switch Reference
- Desktop app (Tauri) managing AI coding tools: Claude Code, Codex, Gemini CLI, OpenCode, etc.
- Features: Provider switching, MCP/Skills/Prompts management, session search, proxy takeover, usage tracking
- 50+ built-in providers, supports custom providers
- Token/usage tracking with cost estimation
- Open source (MIT), Rust + TypeScript

## pi Data Structure (real)
- **settings.json**: `defaultProvider`, `defaultModel`, `theme`, `enabledModels[]`, `packages[]`, `terminal`, `warnings`, etc.
- **auth.json**: `{ "providerName": { "type": "api_key", "key": "sk-..." } }`
- **models.json**: Custom providers with `baseUrl`, `api`, `apiKey`, `models[]`, `compat`, `headers`
- **Model fields**: `id`, `name`, `reasoning`, `input[]`, `contextWindow`, `maxTokens`, `cost{input,output,cacheRead,cacheWrite}`
- **Provider types**: Built-in (anthropic, openai, deepseek, opencode, sense nova, google, etc.) and custom

## Built-in Providers (from pi docs)
Anthropic, OpenAI, DeepSeek, Google Gemini, Mistral, Groq, Cerebras, NVIDIA NIM, xAI, OpenRouter,
Cloudflare (AI Gateway + Workers AI), Azure OpenAI, Amazon Bedrock, Google Vertex,
Vercel AI Gateway, Hugging Face, Fireworks, Together AI, Kimi For Coding, MiniMax,
Xiaomi MiMo, ZAI Coding Plan, GitHub Copilot, OpenCode, OpenCode Go, etc.

## Tech Decisions
- Vite + React 19 + TypeScript (latest stable)
- Tailwind CSS v4 (latest) with @tailwindcss/vite plugin
- recharts for token/cost charts
- zustand for state management (slices pattern)
- lucide-react for icon set
- React Router v7 for client-side routing
- All mock data - no backend needed
- localStorage persistence for edits
- JSON import/export for full config backup

## Design Decisions
- Dark theme as default (like cc-switch)
- Sidebar nav with icons
- Dashboard as landing with summary stats + charts
- Cards for model display, tables for providers
- Modals/sheets for CRUD operations
- Responsive layout (works on desktop + tablet)