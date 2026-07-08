<p align="center">
  <img src="public/pi.svg" width="80" height="80" alt="pi-switch logo" />
</p>

<h1 align="center">pi-web-switch</h1>

<p align="center">
  <strong>pi コーディングエージェント設定管理の Web UI</strong>
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
  <a href="https://github.com/farion1231/cc-switch">cc-switch</a> にインスパイアされた、<a href="https://pi.dev">pi コーディングエージェント</a>のプロバイダー、モデル、トークン使用量、設定を管理するビジュアルダッシュボードです。
</p>

---

## ✨ 機能

### 📊 ダッシュボード
- **トークン使用量トレンド** — 30日間の日次トークン消費エリアチャート
- **コスト追跡** — 日次コストチャート + プロバイダー別コスト内訳（円グラフ）
- **リクエスト数** — API コール数の棒グラフ
- **プロバイダーサマリー** — 全プロバイダーの使用量一覧表（トークン、コスト、リクエスト数）
- **主要指標** — 総トークン数、総コスト、総リクエスト数、アクティブプロバイダー数

### 📦 モデル管理
- **モデルグリッド** — 全プロバイダーのモデルを検索・フィルターで閲覧
- **有効/無効** — モデルのオン/オフ切り替え（`enabledModels` 設定に対応）
- **モデル編集** — 機能（推論、画像入力）、コスト、コンテキストウィンドウ、最大トークンを更新
- **モデル追加** — 任意のプロバイダーに新しいモデルを作成するウィザード
- **モデル削除** — カスタムモデルを削除

### 🔌 プロバイダー管理
- **プロバイダー一覧** — 全ビルトイン・カスタムプロバイダーを表示する展開可能カード
- **カスタムプロバイダー** — Ollama、vLLM、LM Studio、または任意の OpenAI 互換プロバイダーを追加
- **API キー管理** — プロバイダーごとに API キーを設定/削除
- **プロバイダー設定** — baseUrl、API タイプ、カスタムヘッダー、認証方式

### ⚙️ 設定
- **デフォルト値** — デフォルトのプロバイダー、モデル、思考レベル、プロジェクト信頼レベル
- **テーマ** — ライト / ダーク / システム設定に連動、即時切り替え
- **有効なモデル** — 有効化されたモデル一覧の表示と管理
- **拡張機能とパッケージ** — pi のパッケージ一覧を管理
- **インポート/エクスポート** — 設定を JSON でダウンロード、バックアップから復元
- **リセット** — 工場出荷時設定にリセット

## 🧱 ビルトインプロバイダー

**12 のビルトインプロバイダー** と **30+ のモデル** のモックデータを同梱：

| プロバイダー | モデル |
|-------------|--------|
| Anthropic | Claude Sonnet 4, Opus 4, Haiku 3.5 |
| OpenAI | GPT-4o, GPT-4o-mini, GPT-5.1, o3-mini |
| DeepSeek | DeepSeek V3, DeepSeek R1 |
| OpenCode | DeepSeek V4 Flash (無料), DeepSeek V4 Flash |
| OpenCode Go | DeepSeek V4 Flash, V4 Pro, GLM 5.1, Qwen 3.7 Max, MiMo V2.5 |
| SenseNova | GLM 5.2, DeepSeek V4 Flash |
| Google Gemini | Gemini 2.5 Flash, Gemini 2.5 Pro |
| OpenRouter | Claude Sonnet 4, DeepSeek R1 |
| Mistral | Mistral Large |
| GitHub Copilot | Copilot GPT-4o |
| Groq | Llama 3.3 70B |

## 🚀 始め方

```bash
# クローン
git clone https://github.com/Raingor/pi-web-switch.git
cd pi-web-switch

# 依存関係をインストール
npm install

# 開発サーバーを起動
npm run dev

# プロダクションビルド
npm run build

# プロダクションビルドをプレビュー
npm run preview
```

## 🏗️ 技術スタック

| レイヤー | 技術 |
|---------|------|
| フレームワーク | [React 19](https://react.dev/) |
| 言語 | [TypeScript 5.8](https://www.typescriptlang.org/) |
| ビルド | [Vite 6](https://vitejs.dev/) |
| スタイリング | [Tailwind CSS v4](https://tailwindcss.com/) |
| 状態管理 | [Zustand](https://github.com/pmndrs/zustand) |
| チャート | [Recharts](https://recharts.org/) |
| アイコン | [Lucide React](https://lucide.dev/) |
| ルーティング | [React Router v7](https://reactrouter.com/) |

## 🗂️ プロジェクト構造

```
pi-web-switch/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── public/
│   └── pi.svg
└── src/
    ├── main.tsx              # エントリーポイント + 初期化ガード
    ├── App.tsx               # ルーター設定
    ├── index.css             # Tailwind + グローバルスタイル
    ├── types/index.ts        # 全 TypeScript インターフェース
    ├── data/
    │   ├── mock-config.ts    # ビルトインプロバイダー + モック設定
    │   └── mock-usage.ts     # 30日間のモック使用量データ生成
    ├── store/
    │   └── config-store.ts   # Zustand ストア (CRUD + 使用量)
    ├── lib/
    │   ├── utils.ts          # フォーマットヘルパー
    │   └── config.ts         # localStorage + インポート/エクスポート
    └── components/
        ├── layout/           # AppShell, Sidebar
        ├── ui/               # StatCard, Badge, Modal, EmptyState
        ├── dashboard/        # DashboardPage + チャート
        ├── models/           # ModelsPage + フォーム
        ├── providers/        # ProvidersPage + フォーム
        └── settings/         # SettingsPage
```

## 💾 データモデル

pi の実際の設定構造をモデル化しています：

- **`settings.json`** — デフォルトプロバイダー、モデル、有効なモデル一覧、パッケージ、テーマなど
- **`auth.json`** — プロバイダーごとに保存された API キー
- **`models.json`** — カスタムプロバイダー定義（baseUrl、API タイプ、コスト/機能を含むモデル配列）
- **使用量データ** — 15 のモデル-プロバイダーペアの 30 日間のモックトークン/コスト/リクエストデータ

すべてのデータは `localStorage` に永続化されます。設定ページから JSON 形式で設定全体をエクスポート/インポートできます。

## 📄 ライセンス

MIT