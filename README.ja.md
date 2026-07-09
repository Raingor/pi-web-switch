<p align="center">
  <img src="public/pi.svg" width="80" height="80" alt="pi-switch logo" />
</p>

<h1 align="center">pi-web-switch</h1>

<p align="center">
  <strong>pi コーディングエージェントの Web 管理パネル — リアルタイム設定管理、セッションブラウザ、メモリビューア</strong>
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
  <a href="https://github.com/farion1231/cc-switch">cc-switch</a> にインスパイアされた、<a href="https://pi.dev">pi コーディングエージェント</a>のプロバイダー、モデル、トークン使用量、セッション、設定を管理するビジュアルダッシュボードです。
</p>

<p align="center">
  <strong><code>~/.pi/agent/</code> から直接データを読み取ります</strong> — モックデータ、データベース、追加のバックエンドは不要です。
</p>

---

## ✨ 機能

### 📊 ダッシュボード
- **トークン使用量トレンド** — セッションファイルから解析した日次トークン消費エリアチャート
- **コスト追跡** — 日次コストチャート + プロバイダー別コスト内訳（円グラフ）
- **リクエスト数** — API コール数の棒グラフ
- **プロバイダーサマリー** — 全プロバイダーの使用量一覧表（トークン、コスト、リクエスト数）
- **主要指標** — 総トークン数、総コスト、総リクエスト数、アクティブプロバイダー数
- すべてのデータは **実際の pi セッションファイル**（`~/.pi/agent/sessions/*.jsonl`）から取得

### 📦 モデル管理
- **モデルグリッド** — 全プロバイダーのビルトイン・カスタムモデルを検索・フィルターで閲覧
- **有効/無効** — モデルのオン/オフ切り替え（`enabledModels` 設定に対応）
- **モデル編集** — 機能（推論、画像入力）、コスト、コンテキストウィンドウ、最大トークンを更新
- **モデル追加** — 任意のプロバイダーに新しいモデルを作成
- **モデル削除** — カスタムモデルを削除

### 🔌 プロバイダー管理
- **プロバイダー一覧** — 全ビルトイン・カスタムプロバイダーを表示する展開可能カード
- **カスタムプロバイダー** — Ollama、vLLM、LM Studio、または任意の OpenAI 互換プロバイダーを追加
- **API キー管理** — プロバイダーごとに API キーを設定/削除（`auth.json` に保存）
- **プロバイダー設定** — baseUrl、API タイプ、カスタムヘッダー、認証方式

### 💬 セッション
- **プロジェクトグループ化** — セッションディレクトリ名を自動的にプロジェクトパスにデコード
- **セッションブラウザ** — 100+ の全セッションを表示
- **セッション詳細** — 名前、タイムスタンプ、メッセージ数、所要時間、使用プロバイダー/モデル
- **検索とフィルター** — プロジェクト名でセッションを絞り込み
- **セッション削除** — 古いセッションファイルを削除（3日以内に更新されたセッションは保護）

### 🧠 メモリ (pi-hermes-memory)
- **プロジェクトメモリ** — `MEMORY.md` の内容を Markdown レンダリングで表示
- **ユーザープロファイル** — `USER.md` の設定と環境設定を表示
- **障害記録** — `failures.md` の既知の問題を閲覧
- **ライブ同期** — メモリファイルがディスク上で変更されると内容が即時更新

### ⚙️ 設定
- **デフォルト値** — デフォルトのプロバイダー、モデル、思考レベル、プロジェクト信頼レベル
- **テーマ** — ライト / ダーク / システム設定に連動、即時切り替え（CSS 変数によるデュアルテーマ）
- **有効なモデル** — 有効化されたモデル一覧の表示と管理
- **拡張機能とパッケージ** — pi のパッケージ一覧を管理
- **インポート/エクスポート** — 設定を JSON でダウンロード、バックアップから復元
- **リセット** — 空のデフォルト設定にリセット

## 🌗 テーマサポート

ライトモードとダークモードの両方を完全サポートし、システム設定に追従します。テーマは CSS カスタムプロパティにより即座に切り替わり — ページリロードは不要です。サイドバー、モーダル、フォーム、チャート、スクロールバーを含むすべてのコンポーネントが適応します。

## 🧱 ビルトインプロバイダー

**11 のビルトインプロバイダー** と **26 のモデル** の定義を同梱（pi の Rust ソースからハードコード）：

| プロバイダー | モデル |
|-------------|--------|
| Anthropic | Claude Sonnet 4, Sonnet 4.5, Opus 4, Haiku 3.5 |
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

### 前提条件

- **pi コーディングエージェント** がインストールされ設定済み（`~/.pi/agent/` が存在すること）
- Node.js 18+

### セットアップ

```bash
# クローン
git clone https://github.com/Raingor/pi-web-switch.git
cd pi-web-switch

# 依存関係をインストール
npm install

# 開発サーバーを起動（自動的に ~/.pi/agent/ を読み込み）
npm run dev

# プロダクションビルド
npm run build

# プロダクションビルドをプレビュー
npm run preview
```

開発サーバーは Vite ミドルウェアにより `/api/pi/*` で pi 設定 API を自動提供します — 別途バックエンドプロセスは不要です。

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
├── vite.config.ts          # Vite 設定 + pi API プラグイン（ミドルウェア）
├── tsconfig.json
├── server/
│   └── pi-reader.ts        # サーバーサイドモジュール：~/.pi/agent/ 読み取り + セッション解析
├── public/
│   └── pi.svg
└── src/
    ├── main.tsx            # エントリーポイント + テーマ同期 + 初期化ガード
    ├── App.tsx             # ルーター設定（6 ルート）
    ├── index.css           # Tailwind + CSS テーマ変数（ライト/ダーク）
    ├── types/index.ts      # 全 TypeScript インターフェース
    ├── data/
    │   └── builtin-providers.ts  # ハードコードされたビルトインプロバイダー定義
    ├── store/
    │   └── config-store.ts # Zustand ストア（/api/pi/* から取得）
    ├── lib/
    │   ├── utils.ts        # フォーマットヘルパー
    │   └── config.ts       # 設定インポート/エクスポート補助
    └── components/
        ├── layout/          # AppShell, Sidebar（6 ナビゲーション項目）
        ├── ui/              # StatCard, Badge, Modal, EmptyState
        ├── dashboard/       # DashboardPage + チャート
        ├── models/          # ModelsPage + フォーム
        ├── providers/       # ProvidersPage + フォーム
        ├── sessions/        # SessionsPage + MemoryPage
        └── settings/        # SettingsPage
```

## 💾 データソース

すべてのデータは `~/.pi/agent/` から Vite ミドルウェア API プラグインを介して直接読み取られます — モックデータ、データベース、外部サービスは不要です。

| ファイル | 目的 |
|---------|------|
| `~/.pi/agent/settings.json` | デフォルトプロバイダー、モデル、テーマ、有効なモデル、パッケージ |
| `~/.pi/agent/auth.json` | プロバイダーごとの API キー |
| `~/.pi/agent/models.json` | カスタムプロバイダー定義（baseUrl、API タイプ、モデル） |
| `~/.pi/agent/sessions/*.jsonl` | メッセージごとのトークン使用量、モデル、プロバイダーを含むセッション履歴 |
| `~/.pi/agent/pi-hermes-memory/*.md` | Hermes メモリ（MEMORY.md、USER.md、failures.md） |

UI での変更はリアルタイムでこれらのファイルに書き戻されます — pi エージェントは次回リロード時に反映されます。

### セッションと使用量

- アプリは `sessions/` ディレクトリから **106+ の JSONL セッションファイル** を解析
- 各アシスタントメッセージの API 使用量データ（トークン、コスト）を抽出・集計
- ダッシュボードには全セッションにわたる実際のトークン消費、コスト、リクエスト数が表示
- セッション一覧はプロジェクトごとにグループ化（ディレクトリ名からデコード）、24+ のプロジェクトグループ

## 🧩 API ルート

Vite 開発サーバーは `/api/pi/*` で以下のエンドポイントを公開：

| メソッド | パス | 説明 |
|---------|------|------|
| GET | `/api/pi/settings` | `settings.json` を読み取り |
| POST | `/api/pi/settings` | `settings.json` に書き込み |
| GET | `/api/pi/auth` | `auth.json` を読み取り |
| POST | `/api/pi/auth` | `auth.json` に書き込み |
| GET | `/api/pi/models` | `models.json` を読み取り |
| POST | `/api/pi/models` | `models.json` に書き込み |
| GET | `/api/pi/builtin-providers` | ハードコードされたビルトインプロバイダー一覧 |
| GET | `/api/pi/usage` | セッションから集計されたトークン/コスト/リクエストデータ |
| GET | `/api/pi/sessions` | プロジェクトごとにグループ化されたセッション一覧 |
| DELETE | `/api/pi/session?path=` | セッションファイルを削除（パスは sessions/ 下のみ） |
| GET | `/api/pi/memory` | MEMORY.md、USER.md、failures.md を読み取り |

## 🔗 リンク

- **ホームページ：** [raingor.github.io/my-blog](https://raingor.github.io/my-blog/)

## 📄 ライセンス

MIT
