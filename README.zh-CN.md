<p align="center">
  <img src="public/pi.svg" width="80" height="80" alt="pi-switch logo" />
</p>

<h1 align="center">pi-web-switch</h1>

<p align="center">
  <strong>pi 编码代理配置管理的 Web UI</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss" alt="Tailwind v4" />
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite" alt="Vite 6" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT License" />
</p>

<p align="center">
  <a href="README.md">🇬🇧 English</a> ·
  <a href="README.zh-CN.md">🇨🇳 中文</a> ·
  <a href="README.ja.md">🇯🇵 日本語</a>
</p>

<p align="center">
  灵感来源于 <a href="https://github.com/farion1231/cc-switch">cc-switch</a> —— 可视化管理你的 <a href="https://pi.dev">pi 编码代理</a>的提供商、模型、Token 用量和设置。
</p>

---

## ✨ 功能特性

### 📊 仪表盘
- **Token 用量趋势** — 30天每日 Token 消耗面积图
- **成本追踪** — 每日成本图 + 按提供商的成本分布（饼图）
- **请求量** — API 调用量的柱状图
- **提供商汇总** — 所有提供商的用量汇总表（Token、成本、请求数）
- **关键指标** — 总 Token、总成本、总请求数、活跃提供商数

### 📦 模型管理
- **模型网格** — 按提供商浏览所有模型，支持搜索和筛选
- **启用/禁用** — 切换模型开关，对应 `enabledModels` 配置
- **编辑模型** — 更新能力（推理、图片输入）、成本、上下文窗口、最大 Token
- **添加模型** — 向导式创建新模型，绑定到任意提供商
- **删除模型** — 移除自定义模型

### 🔌 提供商管理
- **提供商列表** — 可展开卡片展示所有内置和自定义提供商
- **自定义提供商** — 添加 Ollama、vLLM、LM Studio 或任意 OpenAI 兼容提供商
- **API Key 管理** — 为每个提供商设置/删除 API Key
- **提供商配置** — baseUrl、API 类型、自定义请求头、认证方式

### ⚙️ 设置
- **默认值** — 默认提供商、模型、思考级别、项目信任级别
- **主题** — 浅色 / 深色 / 跟随系统，即时切换
- **已启用模型** — 查看和管理完整的启用模型列表
- **扩展与包** — 管理 pi 的 packages 列表
- **导入/导出** — 下载完整配置为 JSON，从备份恢复
- **重置** — 恢复出厂默认配置

## 🧱 内置提供商

应用内置了 **12 个内置提供商** 和 **30+ 个模型** 的示例数据：

| 提供商 | 模型 |
|--------|------|
| Anthropic | Claude Sonnet 4, Opus 4, Haiku 3.5 |
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

```bash
# 克隆仓库
git clone https://github.com/Raingor/pi-web-switch.git
cd pi-web-switch

# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览生产构建
npm run preview
```

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
├── vite.config.ts
├── tsconfig.json
├── public/
│   └── pi.svg
└── src/
    ├── main.tsx              # 入口 + 初始化守卫
    ├── App.tsx               # 路由配置
    ├── index.css             # Tailwind + 全局样式
    ├── types/index.ts        # 所有 TypeScript 接口
    ├── data/
    │   ├── mock-config.ts    # 内置提供商 + 模拟配置
    │   └── mock-usage.ts     # 30天模拟用量数据生成器
    ├── store/
    │   └── config-store.ts   # Zustand 状态管理 (CRUD + 用量)
    ├── lib/
    │   ├── utils.ts          # 格式化工具函数
    │   └── config.ts         # localStorage + 导入/导出
    └── components/
        ├── layout/           # AppShell, Sidebar
        ├── ui/               # StatCard, Badge, Modal, EmptyState
        ├── dashboard/        # DashboardPage + 图表
        ├── models/           # ModelsPage + 表单
        ├── providers/        # ProvidersPage + 表单
        └── settings/         # SettingsPage
```

## 💾 数据模型

本应用模拟了 pi 的真实配置结构：

- **`settings.json`** — 默认提供商、模型、已启用模型列表、packages、主题等
- **`auth.json`** — 按提供商存储的 API Key
- **`models.json`** — 自定义提供商定义（baseUrl、API 类型、模型数组含成本/能力）
- **用量数据** — 15 个 model-provider 对的 30 天模拟 Token/成本/请求数据

所有数据持久化存储在 `localStorage`。通过设置页面可以导出/导入 JSON 格式的完整配置。

## 🔗 相关链接

- **个人主页：** [raingor.github.io/my-blog](https://raingor.github.io/my-blog/)

## 📄 许可证

MIT