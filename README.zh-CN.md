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
- **使用统计** — 当天/7天/30天/自定义日期范围 + 自动刷新（5s/10s/30s/60s）
- **Token 明细** — 精确值 + 约等于显示（如 `1,631,022 ≈ 163.1万`），含输入/输出/缓存命中/缓存创建占比
- **成本追踪** — 逐日成本图 + Provider/Model 统计选项卡
- **缓存命中率** — 直观的进度条展示缓存效率
- **请求日志** — 详细日志表（时间、供应商、模型、Token、成本）
- **货币切换** — 美元/人民币实时换算（1 USD = 7.2 CNY）
- **小时/天粒度** — 当天视图按小时展示；7天/30天按天展示

### 📦 模型管理
- **模型网格** — 按提供商浏览所有模型，支持搜索和筛选
- **启用/禁用** — 切换模型开关，对应 `enabledModels` 配置
- **编辑模型** — 更新能力、成本、上下文窗口、最大 Token
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
- **删除会话** — 删除旧的会话文件（近 3 天有更新的会话受保护）

### 🧠 记忆查看 (pi-hermes-memory)
- **项目记忆** — 查看 `MEMORY.md` 内容，支持 Markdown 渲染
- **用户画像** — 显示 `USER.md` 偏好和设置
- **故障记录** — 浏览 `failures.md` 已知问题
- **实时同步** — 记忆文件在磁盘变更时内容即时更新

### 🌐 多语言
- **English** 🇬🇧 — 英文
- **简体中文** 🇨🇳 — 中文
- **繁體中文** 🇭🇰 — 繁体中文
- **日本語** 🇯🇵 — 日文
- 侧栏底部语言切换器，选择后跨会话保持

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
git clone https://github.com/Raingor/pi-web-switch.git
cd pi-web-switch
npm install
npm run dev    # 启动开发服务器（自动读取 ~/.pi/agent/）
npm run build  # 构建生产版本
npm run preview # 预览生产构建
```

## 🏗️ 技术栈

React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS v4 + Zustand + Recharts + Lucide React + React Router v7

## 🔗 相关链接

- **个人主页：** [raingor.github.io/my-blog](https://raingor.github.io/my-blog/)
- **GitHub：** [github.com/Raingor](https://github.com/Raingor)

## 📄 许可证

MIT
