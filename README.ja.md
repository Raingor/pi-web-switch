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
  <a href="https://github.com/farion1231/cc-switch">cc-switch</a> にインスパイアされた、<a href="https://pi.dev">pi コーディングエージェント</a>のプロバイダー、モデル、トークン使用量、セッション、設定を管理するビジュアルダッシュボード。
</p>

<p align="center">
  <strong><code>~/.pi/agent/</code> から直接データを読み取り</strong> — モックデータ、データベース、追加バックエンド不要。
</p>

---

## ✨ 機能

### 📊 ダッシュボード
- **使用統計** — 今日/7日/30日/カスタム日付範囲 + 自動更新（5s/10s/30s/60s）
- **トークン明細** — 正確な値 + 概算表示（例 `1,631,022 ≈ 163.1万`）、入出力/キャッシュ内訳
- **コスト追跡** — 日次コストチャート + Provider/Model 統計タブ
- **キャッシュヒット率** — 進行状況バーで表示
- **リクエストログ** — 時間、プロバイダー、モデル、トークン、コストの詳細表
- **通貨切替** — USD/CNY リアルタイム換算（1 USD = 7.2 CNY）
- **時間粒度** — 今日は時間別、7日/30日は日別表示

### 📦 モデル管理
- **モデルグリッド** — 全プロバイダーのモデルを検索・フィルターで閲覧
- **有効/無効** — モデルのオン/オフ切り替え
- **モデル編集** — 機能、コスト、コンテキストウィンドウ、最大トークンを更新
- **モデル追加** — 任意のプロバイダーに新しいモデルを作成
- **モデル削除** — カスタムモデルを削除

### 🔌 プロバイダー管理
- **プロバイダー一覧** — 全ビルトイン・カスタムプロバイダーを表示
- **カスタムプロバイダー** — Ollama、vLLM、LM Studio 等を追加
- **API キー管理** — プロバイダーごとに API キーを設定/削除
- **プロバイダー設定** — baseUrl、API タイプ、カスタムヘッダー
- **有効モデルパネル** — 全プロバイダーの有効モデルを一覧表示し、ワンクリックで無効化/全無効化。各プロバイダーのモデルのオン/オフとリアルタイム同期
- **モデルをオンライン取得** — プロバイダーの `/models` エンドポイントからモデル一覧を取得し、ワンクリックでインポート

### 💬 セッション
- **プロジェクトグループ化** — ディレクトリ名を自動デコード
- **セッションブラウザ** — 100+ の全セッションを表示
- **セッション詳細** — 名前、時間、メッセージ数、所要時間、使用モデル
- **検索とフィルター** — プロジェクト名で絞り込み
- **セッション削除** — 3日以内に更新されたものは保護

### 🧠 メモリ (pi-hermes-memory)
- プロジェクトメモリ / ユーザープロファイル / 障害記録を Markdown 表示

### 🌐 多言語
- English 🇬🇧 / 简体中文 🇨🇳 / 繁體中文 🇭🇰 / 日本語 🇯🇵
- サイドバー下部の言語切替器、セッション間で保持

### ⚙️ 設定
- デフォルト値、テーマ（Light/Dark/System）、画面ズーム（50%–200%）とフォントサイズ、パッケージ管理
- インポート/エクスポート、リセット

## 🚀 始め方

```bash
git clone https://github.com/Raingor/pi-web-switch.git
cd pi-web-switch
npm install
npm run dev    # 開発サーバー起動（~/.pi/agent/ を自動読込）
npm run build  # プロダクションビルド
```

## 🖥️ 姉妹プロジェクト — pi-of-cindy

pi-web-switch はブラウザで動作します。より完全な **デスクトップ、モバイル、AI エージェントのワークベンチ** が必要な場合は、姉妹プロジェクトをご覧ください：

> **[pi-of-cindy](https://github.com/Raingor/pi-of-cindy)** — CINDY クライアントの pi-only 改造版です。Electron デスクトップ、Expo / React Native モバイルアプリ、共有 packages を含みます。
> ローカル [pi](https://github.com/earendil-works/pi) CLI を唯一のワークベンチとして、Pi プロバイダー、ダッシュボード、タスク、メモリ、Subagents、ローカルセッションのインポートを提供し、ローカル pi CLI と `~/.pi/agent/` を共有します。
>
> pi-of-cindy の主な特徴：
> - **マルチプラットフォームのエージェントワークベンチ** — デスクトップ、モバイル、共有機能を 1 つの pnpm monorepo に統合
> - **Harness × モデルの組み合わせ** — Claude Code や Codex などに対応し、計画、並列実行、独立 review が可能
> - **実環境での実行** — ローカルファイルとログイン済みアプリを使ってブラウザ、コンピューター、スマートフォンを操作
> - **Pi-only ローカルワークフロー** — pi CLI のセッションを直接継続でき、プロバイダーとモデルをターミナルと同期
> - **Apache-2.0 オープンソース** — 自分でビルドして拡張可能
>
> ダウンロードと詳細は **[pi-of-cindy README](https://github.com/Raingor/pi-of-cindy)** をご覧ください。

**両方ともローカルの `~/.pi/agent/` 設定を共有します**。どちらかで変更したプロバイダー、モデル、メモリは、もう一方とターミナルの `pi` でも利用できます。

| | pi-web-switch（本プロジェクト） | pi-of-cindy |
|---|---|---|
| 形態 | ブラウザパネル（Vite 開発サーバー） | Electron デスクトップ + Expo / React Native モバイルアプリ |
| 主眼 | 設定管理 — ダッシュボード / プロバイダ / セッション / メモリを並列表示 | マルチプラットフォーム AI エージェントワークベンチ — タスク実行、Harness 編成、ローカルセッション |
| Pi 連携 | Pi パッケージ / ローカル設定パネル | ローカル pi CLI を中心に `~/.pi/agent/` を共有 |
| ライセンス | MIT | Apache-2.0 |
| 開発方法 | `npm run dev` | `pnpm install` + `pnpm restart:desktop:remote` |

## 🏗️ 技術スタック

React 19 + TypeScript 5.8 + Vite 6 + Tailwind CSS v4 + Zustand + Recharts + Lucide React + React Router v7

## 📦 Pi パッケージ

pi-web-switch は **pi コーディングエージェント拡張** としてインストール可能で、pi セッションから直接ダッシュボードを起動・停止できます。

### インストール

`~/.pi/agent/settings.json` の packages に `npm:pi-web-switch` を追加：

```json
{
  "packages": ["npm:pi-web-switch"]
}
```

### コマンド

インストール後、pi セッションで以下のコマンドが使用可能：

| コマンド | 説明 |
|---------|------|
| `/pi-switch start` | ダッシュボード起動 http://localhost:5173 |
| `/pi-switch stop` | サーバー停止 |
| `/pi-switch status` | 実行状態を確認 |
| `/pi-usage` | 使用量サマリー（今日 + 7 日）を端末に印字 — tokens / コスト / リクエスト数 / デイリー sparkline、ダッシュボード起動不要 |

`/pi-usage` コマンドは `~/.pi/agent/sessions/*.jsonl` を直接読み込み、今日 + 直近 7 日の統計を集約します。どの pi セッションからでも一目で使用量を確認可能。

### パッケージ構造

```
pi-web-switch/
├── package.json           # npm パッケージ + pi.extensions + pi.skills
├── pi-package/
│   ├── index.ts           # 拡張エントリ：/pi-switch、/pi-usage コマンド登録
│   └── skills/
│       └── pi-web-switch/
│           └── SKILL.md   # 使用ドキュメント
├── server/
│   └── pi-reader.ts       # サーバーサイド：~/.pi/agent/ 読み取り
└── src/                   # React フロントエンド
```

## 💬 コミュニティ

ご質問・ご提案・バグ報告は **Telegram グループ** へどうぞ：

👉 **[pi-web-switch Telegram グループに参加](https://t.me/+ODpy7_7NlOE4NzA1)**

問題を報告する際は以下を添えてください：

1. OS（macOS / Windows / Linux）
2. バージョン —— `npm view @raingor/pi-web-switch version`
3. 具体的な問題の説明とエラーのスクリーンショットまたはログ

## 🔗 リンク

- **姉妹プロジェクト（CINDY pi-only クライアント）：** [github.com/Raingor/pi-of-cindy](https://github.com/Raingor/pi-of-cindy)
- **ホームページ：** [raingor.github.io/my-blog](https://raingor.github.io/my-blog/)
- **GitHub：** [github.com/Raingor](https://github.com/Raingor)

## 📄 ライセンス

MIT
