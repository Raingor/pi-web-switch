# Native macOS 菜单栏应用生成提示词

> 用途：将下面的提示词交给代码生成 Agent，用于重新实现或继续维护 `pi-web-switch` 的 Native macOS 用量菜单栏应用。

## 可直接使用的提示词

```text
请在现有 pi-web-switch 项目中实现一个低内存、原生 macOS 菜单栏用量面板。

## 目标

创建一个独立的 macOS 菜单栏应用，用于快速查看 Pi 编码代理和 ChatGPT/Codex 的本地用量。应用必须轻量、稳定，不依赖 Electron、WebView、浏览器窗口或常驻 Web 服务。

## 技术约束

- 使用 Swift + AppKit，目标 macOS。
- 使用 NSStatusBar.statusItem 创建菜单栏图标。
- 不使用 Electron、WebView、SwiftUI Web 内容或 Node.js 运行时。
- 数据读取和网络请求放到独立的 utility/background 队列，不能阻塞菜单栏点击和主线程 UI。
- UI 更新必须回到主线程。
- 只读本地已有数据，不修改、不删除用户的会话、认证或配置文件。
- 不在日志、界面或错误信息中泄露 access token、API key、cookie 或完整认证内容。
- 认证失败、文件不存在、数据格式异常或网络失败时，显示可读的降级状态，不能让应用崩溃。

## Pi 用量数据

读取当前用户目录下：

1. `~/.pi/agent/sessions/`
   - 遍历以 `--` 开头的项目会话目录。
   - 读取其中的 `.jsonl` 会话文件。
   - 解析 `message` 类型、assistant 角色的 usage 数据。
   - 支持 `input`、`output`、`cacheRead`、`cacheWrite` 和 `cost.total`。
   - 根据消息 timestamp 统计今日和近 7 日数据。
   - 通过 `model_change` 或消息中的 provider 字段统计各供应商用量。

2. `~/.codex/sessions/` 和 `~/.codex/archived_sessions/`
   - 读取 ChatGPT/Codex 会话 JSONL 数据。
   - 单独统计 ChatGPT/Codex 今日和近 7 日用量。

读取大文件时使用流式或分块方式，避免一次性加载过大的会话文件。文件 mtime 可以作为预筛选，但最终仍需根据消息 timestamp 判断统计日期。

## Codex 官方额度

如果 `~/.pi/agent/auth.json` 中存在 `openai-codex` OAuth 配置，则：

- 读取必要的 access token 和 account ID。
- 请求 Codex 官方用量接口，查询 rate limit。
- 支持 primary window 和 secondary window。
- 显示已用百分比、剩余百分比、重置倒计时或重置时间。
- 未登录、认证过期、HTTP 错误或响应格式异常时，显示明确状态，不展示敏感信息。
- 对官方额度结果做短时缓存，例如 30 秒，避免频繁请求。

## 菜单栏显示开关

Web 设置页中的“显示 Native 原生菜单栏”开关控制 macOS 右上角的 Native 功能是否显示：

- 设置写入 `~/.pi/agent/settings.json` 的顶层 `showNative` 布尔值。
- Native 应用启动时读取该值；不存在时默认显示。
- Native 应用运行期间定期读取该值，取消勾选后隐藏 `NSStatusItem`，重新勾选后自动恢复。
- 该开关只控制 macOS 菜单栏功能，不控制网页侧栏或网页路由。
- 隐藏时应用进程可以继续运行，以便在 Web 设置中重新开启；不要因此持续发起不必要的用量或网络请求。

## 菜单栏交互

菜单栏按钮显示简短状态，例如：

- `π 12.4k`：今日 token 数量。
- `π ⚠`：读取或请求出现错误。
- `π …`：正在加载。

点击菜单栏图标后显示一个紧凑信息面板，至少包含：

- 今日 Pi 用量：tokens、成本、请求数、缓存命中率。
- 近 7 日 Pi 用量：tokens、成本、请求数、缓存命中率。
- 今日和近 7 日 ChatGPT/Codex 用量，使用与 Pi 用量相同的双列指标卡布局：tokens、成本、请求次数、缓存命中率进度条以及缓存读写明细。
- Codex 官方额度：套餐、5 小时窗口、7 天窗口、剩余额度和重置时间。
- 用量最多的前 5 个 provider。
- “刷新使用量”操作。
- “退出 Pi 用量”操作。

菜单打开时如果数据尚未加载，应先显示“正在读取”，然后异步更新内容。刷新操作必须重新读取本地文件，并强制刷新官方额度缓存。

## 数据格式化

- 大数字使用易读格式，例如 `1.2k`、`3.4万`、`1.1亿`。
- 成本显示为美元，零值显示 `$0.00`，极小金额保留更多小数位。
- 缓存命中率使用百分比显示。
- 时间显示使用用户可读的小时、分钟和日期时间。
- 统计数值缺失时使用 0 或“暂无信息”，不能显示 NaN 或崩溃。

## 结构建议

建议拆分为以下职责：

- `UsageTotals`：汇总 token、成本、请求和缓存数据。
- `ProviderTotals`：按 provider 汇总数据。
- `CodexUsageWindow` / `CodexUsageStatus`：表示官方额度窗口和登录状态。
- `UsageReader`：读取和解析 Pi/Codex 本地 JSONL 文件。
- `UsagePanel`：渲染菜单栏展开后的紧凑面板。
- `AppDelegate`：管理 NSStatusItem、菜单、刷新队列和应用生命周期。

## 稳定性要求

- 单个损坏 JSONL 行不能影响其他文件和其他行的统计。
- 文件被删除、权限不足或目录不存在时，应返回空统计或错误摘要。
- 网络请求设置合理超时，例如 15～20 秒。
- 所有 UI 状态修改都在主线程执行。
- 后台线程不得直接操作 AppKit UI。
- 退出应用时释放或取消正在进行的任务。
- 不要新增常驻轮询进程；如需自动刷新，使用低频定时器并支持手动刷新。

## 构建和交付

- 提供一个可执行的构建脚本，例如 `scripts/build-native-menubar.sh`。
- 构建产物为 `release/PiUsageMenuBar.app`。
- 提供 `npm run native:build` 和 `npm run native:open` 命令。
- 构建失败时输出明确原因。
- 不修改项目现有 Web Chat、供应商配置和 Pi CLI 故障切换逻辑。

## 验收标准

1. 在 macOS 上可以成功构建并启动菜单栏应用。
2. 点击菜单栏图标不会因读取文件或网络请求而卡顿。
3. 能正确显示今日和近 7 日 Pi 用量。
4. 能兼容空目录、损坏 JSONL、缺少认证和网络错误。
5. Codex 已登录时能显示官方额度窗口；未登录时显示明确提示。
6. 应用不使用 Electron、WebView 或浏览器页面。
7. 不泄露任何 token、API key、cookie 或完整认证内容。
8. 退出菜单项可以正常结束应用。
9. 构建脚本和运行命令在 README 或项目文档中说明。

实现完成后，请运行构建命令，并报告修改的文件、验证命令和仍未验证的项目。
```

## 当前项目对应关系

| 提示词概念 | 当前实现 |
| --- | --- |
| Native 源码 | `native/PiUsageMenuBar.swift` |
| 构建脚本 | `scripts/build-native-menubar.sh` |
| 构建命令 | `npm run native:build` |
| 启动命令 | `npm run native:open` |
| 构建产物 | `release/PiUsageMenuBar.app` |
| Pi 会话数据 | `~/.pi/agent/sessions/` |
| Codex 会话数据 | `~/.codex/sessions/`、`~/.codex/archived_sessions/` |
| Pi OAuth 配置 | `~/.pi/agent/auth.json` |

## 维护提示

如果继续扩展 Native 功能，优先保持以下原则：后台读取、主线程只负责 UI、认证信息只读不落盘、单文件损坏可忽略、Web 面板和原生菜单栏相互独立。
