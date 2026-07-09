<p align="center">
  <img src="public/pi.svg" width="80" height="80" alt="pi-switch logo" />
</p>

<h1 align="center">pi-web-switch</h1>

<p align="center">
  <strong>pi 编码代理的 Web 管理面板 — 实时配置管理、会话浏览与记忆查看</strong>
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
  灵感来源于 <a href="https://github.com/farion1231/cc-switch">cc-switch</a> —— 可视化管理你的 <a href="https://pi.dev">pi 编码代理</a>的提供商、模型、Token 用量、会话和设置。
</p>

<p align="center">
  <strong>直接从 <code>~/.pi/agent/</code> 读取真实数据</strong> —— 无需模拟数据、无需数据库、无需额外后端。
</p>

---

## ✨ 功能特性

### 📊 仪表盘
- **Token 用量趋势** — 从会话文件解析的每日 Token 消耗面积图
- **成本追踪** — 每日成本图 + 按提供商的成本分布（饼图）
- **请求量** — API 调用量的柱状图
- **提供商汇总** — 所有提供商的用量汇总表（Token、成本、请求数）
- **关键指标** — 总 Token、总成本、总请求数、活跃提供商数
- 所有数据来自 **真实的 pi 会话文件**（`~/.pi/agent/sessions/*.jsonl`）

### 📦 模型管理
- **模型网格** — 按提供商浏览所有内置和自定义模型，支持搜索和筛选
- **启用/禁用** — 切换模型开关，对应 `enabledModels` 配置
- **编辑模型** — 更新能力（推理、图片输入）、成本、上下文窗口、最大 Token
- **添加模型** — 创建新模型，绑定到任意提供商
- **删除模型** — 移除自定义模型

### 🔌 提供商管理
- **提供商列表** — 可展开卡片展示所有内置和自定义提供商
- **自定义提供商** — 添加 Ollama、vLLM、LM Studio 或任意 OpenAI 兼容提供商
- **API Key 管理** — 为每个提供商设置/删除 API Key（保存到 `auth.json`）
- **提供商配置** — baseUrl、API 类型、自定义请求头、认证方式

### 💬 会话浏览
- **项目分组** — 自动将会话目录名解码为项目路径
- **会话浏览器** — 查看所有 100+ 个会话
- **会话详情** — 名称、时间、消息数、持续时间、使用的提供商/模型
- **搜索筛选** — 按项目名称过滤会话
- **删除会话** — 删除旧的会话文件（近 3 天有更新的会话受保护不可删除）

### 🧠 记忆查看 (pi-hermes-memory)
- **项目记忆** — 查看 `MEMORY.md` 内容，支持 Markdown 渲染
- **用户画像** — 显示 `USER.md` 偏好和设置
- **故障记录** — 浏览 `failures.md` 已知问题
- **实时同步** — 记忆文件在磁盘变更时内容即时更新

### ⚙️ 设置
- **默认值** — 默认提供商、模型、思考级别、项目信任级别
- **主题** — 浅色 / 深色 / 跟随系统，即时切换（CSS 变量双主题）
- **已启用模型** — 查看和管理完整的启用模型列表
- **扩展与包** — 管理 pi 的 packages 列表
- **导入/导出** — 下载完整配置为 JSON，从备份恢复
- **重置** — 恢复空白默认配置

## 🌗 主题支持

完整的浅色和深色模式，支持跟随系统。主题通过 CSS 自定义属性即时切换——无需刷新页面。所有组件均适配，包括侧栏、弹窗、表单、图表和滚动条。

## 🧱 内置提供商

应用内置了 **11 个内置提供商** 和 **26 个模型** 的定义（从 pi 的 Rust 源码硬编码）：

| 提供商 | 模型 |
|--------|------|
| Anthropic | Claude Sonnet 4, Sonnet 4.5, Opus 4, Haiku 3.5 |
| OpenAI | GPT-4o, GPT-4o-mini, GPT-5.1, o3-mini |
| DeepSeek | DeepSeek V3, DeepSeek R1 |
| OpenCode | DeepSeek V4 Flash (免费), DeepSeek V4 Flash |
| OpenCode Go | DeepSeek V4 Flash, V4 Pro, GLM 5.1, Qwen 3.7 Max, MiMo V2.5 |
| SenseNova | GLM 5.2, DeepSeek V4 Flash |
| Google Gemini | Gemini 2.5 Flash, Gemini 2.5 Pro |
| OpenRouter | Claude Sonnet 4, DeepSeek R1 |
| Mistral | Mistral Large |
| GitHub Copilot | Copilot GPT-4o |
| Groq | Llama 3.3 70B |

## 🚀 快速开始

### 前置要求

- **pi 编码代理** 已安装并配置（确保 `~/.pi/agent/` 目录存在）
- Node.js 18+

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/Raingor/pi-web-switch.git
cd pi-web-switch

# 安装依赖
npm install

# 启动开发服务器（自动读取 ~/.pi/agent/）
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

开发服务器通过 Vite 中间件自动在 `/api/pi/*` 提供 pi 配置 API —— 无需单独启动后端进程。

## 🏗️ 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | [React 19](https://react.dev/) |
| 语言 | [TypeScript 5.8](https://www.typescriptlang.org/) |
| 构建 | [Vite 6](https://vitejs.dev/) |
| 样式 | [Tailwind CSS v4](https://tailwindcss.com/) |
| 状态管理 | [Zustand](https://github.com/pmndrs/zustand) |
| 图表 | [Recharts](https://recharts.org/) |
| 图标 | [Lucide React](https://lucide.dev/) |
| 路由 | [React Router v7](https://reactrouter.com/) |

## 🗂️ 项目结构

```
pi-web-switch/
├── index.html
├── package.json
├── vite.config.ts          # Vite 配置 + pi API 插件（中间件）
├── tsconfig.json
├── server/
│   └── pi-reader.ts        # 服务端模块：读取 ~/.pi/agent/ 文件 + 解析会话
├── public/
│   └── pi.svg
└── src/
    ├── main.tsx            # 入口 + 主题同步 + 初始化守卫
    ├── App.tsx             # 路由配置（6 条路由）
    ├── index.css           # Tailwind + CSS 主题变量（浅色/深色）
    ├── types/index.ts      # 所有 TypeScript 接口
    ├── data/
    │   └── builtin-providers.ts  # 硬编码的内置提供商定义
    ├── store/
    │   └── config-store.ts # Zustand 状态管理（从 /api/pi/* 获取数据）
    ├── lib/
    │   ├── utils.ts        # 格式化工具函数
    │   └── config.ts       # 配置导入/导出辅助
    └── components/
        ├── layout/          # AppShell, Sidebar（6 个导航项）
        ├── ui/              # StatCard, Badge, Modal, EmptyState
        ├── dashboard/       # DashboardPage + 图表
        ├── models/          # ModelsPage + 表单
        ├── providers/       # ProvidersPage + 表单
        ├── sessions/        # SessionsPage + MemoryPage
        └── settings/        # SettingsPage
```

## 💾 数据来源

所有数据直接从你的 `~/.pi/agent/` 目录读取，通过 Vite 中间件 API 插件提供服务——无需模拟数据、无需数据库、无需外部服务。

| 文件 | 用途 |
|------|------|
| `~/.pi/agent/settings.json` | 默认提供商、模型、主题、已启用模型、包列表 |
| `~/.pi/agent/auth.json` | 每个提供商的 API Key |
| `~/.pi/agent/models.json` | 自定义提供商定义（baseUrl、API 类型、模型） |
| `~/.pi/agent/sessions/*.jsonl` | 会话历史，含每条消息的 Token 用量、模型、提供商 |
| `~/.pi/agent/pi-hermes-memory/*.md` | Hermes 记忆（MEMORY.md、USER.md、failures.md） |

在 UI 中的修改会实时写回到这些文件——pi 代理下次加载时即可生效。

### 会话与用量

- 应用解析 `sessions/` 目录下的 **106+ 个 JSONL 会话文件**
- 提取每条助手消息的 API 用量数据（Token、成本）并进行聚合
- 仪表盘显示所有会话的真实 Token 消耗、成本和请求量
- 会话列表按项目分组（从目录名解码），共 24+ 个项目组

## 🧩 API 路由

Vite 开发服务器在 `/api/pi/*` 路径下提供以下端点：

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/pi/settings` | 读取 `settings.json` |
| POST | `/api/pi/settings` | 写入 `settings.json` |
| GET | `/api/pi/auth` | 读取 `auth.json` |
| POST | `/api/pi/auth` | 写入 `auth.json` |
| GET | `/api/pi/models` | 读取 `models.json` |
| POST | `/api/pi/models` | 写入 `models.json` |
| GET | `/api/pi/builtin-providers` | 列出硬编码的内置提供商 |
| GET | `/api/pi/usage` | 从会话聚合的 Token/成本/请求数据 |
| GET | `/api/pi/sessions` | 按项目分组的会话列表 |
| DELETE | `/api/pi/session?path=` | 删除会话文件（路径必须在 sessions/ 下） |
| GET | `/api/pi/memory` | 读取 MEMORY.md、USER.md、failures.md |

## 🔗 相关链接

- **个人主页：** [raingor.github.io/my-blog](https://raingor.github.io/my-blog/)

## 📄 许可证

MIT
