# 提供商和模型板块 · 改进计划

> 来源：代码审查 `src/components/providers/ProvidersModelsPage.tsx`、`src/store/config-store.ts`、`src/data/model-catalog.ts`、`src/data/builtin-providers.ts`、`server/pi-reader.ts`、`src/types/index.ts`
> 目标：补齐功能缺口、修正数据矛盾、提升使用体验。

## 现状
板块已较为完整：自定义提供商增删改、粘贴文本批量导入、连接测试、在线拉取模型列表（`/api/pi/provider-models`）、按目录/启发式识别元信息、单模型测试、复制参数 JSON、免费模型识别等。

---

## 建议清单（含优先级与状态）

### 🔴 高优先级 · 功能缺口
- [x] **#1 补全 API 类型下拉**
  - 现象：`ProvidersModelsPage.tsx:36` 的 `API_TYPES` 仅 7 项，但 `types/index.ts:56` 的 `ApiType` 有 9 种。
  - 已实现：在 `API_TYPES` 追加 `azure-openai-responses`、`openai-codex-responses`。
- [x] **#2 模型启停开关（Enable/Disable）**
  - 现象：README 声称支持启停，但模型行无开关；quick-add/导入固定 `enabled:true`。
  - 已实现：模型行增加启用开关 + 顶部"全部启用/禁用"，读写 `settings.enabledModels`（`provider.id/model.id` 引用）。
- [x] **#3 统一 maxTokens 数据矛盾**
  - 现象：`claude-sonnet-4` 在 `builtin-providers.ts` 为 `8192`，在 `model-catalog.ts` 为 `16384`。
  - 已实现：以 `model-catalog.ts` 为单一事实来源，修正 `builtin-providers.ts` 中 7 处。

### 🟡 中优先级 · 体验 / 数据
- [ ] **#4 模型目录价格易过期**
  - 现象：`model-catalog.ts` 为手写静态定价，新模型滞后；未知模型 cost 默认 `0/0` 误显 Free。
  - 状态：**本次暂不实现**（需 OpenRouter 定价刷新能力，工作量较大）。
- [x] **#5 代理/网关覆盖 + 复制携带模型**
  - 现象：内置提供商 `baseUrl` 被 disabled；`handleDuplicateProvider` 未携带模型列表。
  - 已实现：内置 baseUrl/api 可编辑并写入 models.json 覆盖；复制提供商时携带源模型并自动启用。
- [x] **#6 模型行价格补全 + 跟随币种**
  - 现象：模型行仅显 `$in/$out`，不含 cache 价，不跟随 USD/CNY 切换。
  - 已实现：复用 `src/lib/currency.ts` 与 `formatCost`，行内显示换算后价格，hover 显示完整 In/Out/CacheR/CacheW 价。
- [x] **#7 批量测试模型**
  - 现象：仅能逐个点 `Zap` 测试。
  - 已实现：新增"测试全部"按钮，顺序复用 `/api/pi/model-test`。

### 🟢 低优先级 · 增强
- [ ] **#8 全局 Model Grid（跨提供商）**
  - 现象：README 称有跨内置/自定义网格，实际按提供商分组。
  - 状态：**本次暂不实现**（利用 catalog `family` 做跨提供商视图，后续）。
- [x] **#9 API Key 的 `$ENV` 引用提示**
  - 现象：placeholder 暗示 `$MY_API_KEY`，但代码原样保存。
  - 已实现：输入以 `$` 开头时显示环境变量提示（含变量名）。
- [x] **#10 模型列表排序**
  - 现象：长列表无排序。
  - 已实现：新增排序下拉（默认 / 按厂商 / 价格升序 / 价格降序）。

---

## 本次实施范围
已实现：#1、#2、#3、#5、#6、#7、#9、#10（`npx tsc -b --noEmit` 通过）。
记录为后续（本次不做）：#4、#8。

## 涉及文件
- `src/components/providers/ProvidersModelsPage.tsx`（主改动：API_TYPES、启停开关、全部启用/禁用、内置 baseUrl 覆盖、价格跟随币种、测试全部、ENV 提示、排序）
- `src/data/builtin-providers.ts`（maxTokens 统一）
- `src/store/config-store.ts`（mergeProviders 应用 baseUrl/api/headers 覆盖）
- `src/lib/translations/{zh-CN,en,zh-TW,ja}.ts`（新增 baseurl_override / test_all / api_key_env / sort_* 文案）
- `server/pi-reader.ts`（TypeScript 类型修复）
- `vite.config.ts`（添加 Electron 插件配置）
- `package.json`（添加 Electron 脚本和构建配置）
- `electron/main.ts`（Electron 主进程）
- `electron/preload.ts`（Electron preload 脚本）
- `electron/vite-env.d.ts`（TypeScript 类型声明）

## Electron 打包
- 构建命令：`npm run electron:build`
- 输出目录：`release/mac-arm64/`
- 产物：`pi-web-switch-0.3.3-arm64.dmg`
