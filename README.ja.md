# Live2DPet — AI デスクトップペット

**[English](README.en.md)** | **日本語** | **[中文](README.md)**

![GitHub stars](https://img.shields.io/github/stars/x380kkm/Live2DPet) ![License](https://img.shields.io/github/license/x380kkm/Live2DPet) ![Downloads](https://img.shields.io/github/downloads/x380kkm/Live2DPet/total) ![Last Commit](https://img.shields.io/github/last-commit/x380kkm/Live2DPet)

Electron ベースのデスクトップペット。Live2D キャラクターがデスクトップに常駐し、スクリーンショットでユーザーの操作を認識、AI がコンパニオン対話を生成、VOICEVOX で音声合成を行います。[Claude Code](https://docs.anthropic.com/en/docs/claude-code) による AI 支援開発で構築。

> **プライバシーに関する注意**: 本アプリは定期的にスクリーンショットを撮影し、設定された AI API に送信して分析します。スクリーンショットはディスクに保存されません。ご利用の API プロバイダーを信頼できることを確認し、画面上の機密情報にご注意ください。

<p align="center">
  <img src="assets/app-icon.png" width="128" alt="Live2DPet Icon">
</p>

## 使用例

<p align="center">
  <img src="assets/example-little-demon.png" width="60%" alt="Usage Example 1">
</p>
<p align="center">
  <img src="assets/example-kasukabe.jpg" width="60%" alt="Usage Example 2">
</p>
<p align="center">
  <img src="assets/example-kiritan.png" width="60%" alt="Usage Example 3">
</p>

**モデルクレジット**

【Model】Little Demon
Author：Cai Cat様

【Model】春日部つむぎ (公式)
イラスト：春日部つくし様
モデリング：米田らん様

【Model】東北きりたん ([水德式](https://www.bilibili.com/video/BV1B7dcY1EFU))
イラスト：白白什么雨様
配布：君临德雷克様

*この例で使用されているモデル素材は借用したものです。すべての権利は原作者に帰属します。*

## クイックスタート

### 方法1：ダウンロード（推奨）

[Releases](https://github.com/x380kkm/Live2DPet/releases) から `Live2DPet.exe` をダウンロードし、ダブルクリックで実行。インストール不要。

### 方法2：ソースから実行

```bash
git clone https://github.com/x380kkm/Live2DPet.git
cd Live2DPet
npm install
node launch.js
```

> VSCode ターミナルでは `npx electron .` ではなく `node launch.js` を使用してください（ELECTRON_RUN_AS_NODE 競合）。

## 使い方

### 1. API 設定

設定パネルの「API 設定」タブに以下を入力：

| フィールド | 説明 |
|-----------|------|
| API URL | OpenAI 互換エンドポイント |
| API Key | API キー |
| モデル名 | 例: `x-ai/grok-4.1-fast` |

対応サービス：

| サービス | baseURL | モデル例 |
|---------|---------|---------|
| OpenRouter | `https://openrouter.ai/api/v1` | `x-ai/grok-4.1-fast` |
| Grok 直接 | `https://api.x.ai/v1` | `grok-4.1-fast` |
| Deepseek | `https://api.deepseek.com/v1` | `deepseek-chat` |

スクリーンショット認識のため、Vision 対応モデルを推奨。

### 2. Live2D モデルのインポート

「モデル」タブで「モデルフォルダを選択」をクリックし、`.model.json` または `.model3.json` を含むディレクトリを選択。システムが自動的に：
- モデルパラメータをスキャンし、目・頭のトラッキングをマッピング
- 表情ファイルとモーショングループをスキャン
- モデルをユーザーデータディレクトリにコピー

画像フォルダ（PNG/JPG/WebP）もキャラクター画像として使用可能 — 下記「画像モデル」を参照。

### 3. ペットを起動

「ペットを起動」をクリック。キャラクターがデスクトップ右下に透明ウィンドウで表示されます。
- ドラッグで位置を移動
- 目がマウスカーソルを追従（Live2D モード）
- AI が定期的にスクリーンショットを撮り、吹き出しで会話

### 画像モデル

Live2D の他に、画像フォルダをキャラクター画像として使用できます：

1. 「モデル」タブでタイプを「画像フォルダ」に選択し、PNG/JPG/WebP 画像を含むフォルダを選択
2. 各画像の用途をタグ付け：待機、会話、表情（複数選択可）
3. 表情画像には表情名を入力 — AI 感情システムが自動的にマッチング
4. クロップスケールスライダーで表示比率を調整

AI が話すと自動的に「会話」画像に切り替わり、感情トリガー時は対応する表情画像に、それ以外は「待機」画像を表示します。

### 4. キャラクターのカスタマイズ

「キャラクター」タブで名前、性格、行動ルールを編集。テンプレート変数 `{{petName}}`、`{{userIdentity}}` に対応。

### 5. VOICEVOX 音声合成（オプション）

「TTS」タブでワンクリックで VOICEVOX コンポーネントをインストール：
- VOICEVOX Core + ONNX Runtime
- VVM 音声モデル（UI で選択可能）
- Open JTalk 辞書

GPU アクセラレーション（DirectML）対応。AI の応答は自動的に日本語に翻訳され、音声で再生されます。

## 機能

- **Live2D デスクトップキャラクター** — 透明フレームレスウィンドウ、常に最前面、目がカーソルを追従
- **画像モデル** — 画像フォルダをキャラクターとして使用、待機/会話/表情でタグ付け、AI 駆動で自動切替
- **AI 視覚認識** — 定期スクリーンショット + アクティブウィンドウ検出、画面内容に応じて AI が応答
- **VOICEVOX 音声** — ローカル日本語 TTS、自動翻訳、ワンクリックセットアップ
- **感情システム** — AI 駆動の表情・モーション選択、感情蓄積トリガー
- **オーディオステートマシン** — TTS → デフォルトフレーズ → 無音、3モード自動フォールバック
- **モデルホットインポート** — 任意の Live2D モデル、パラメータ自動マッピング、表情・モーション自動スキャン
- **キャラクターペルソナ** — JSON テンプレートで性格と行動ルールを定義、マルチキャラクター対応

## アーキテクチャ

```
Electron Main Process
├── main.js                 ウィンドウ管理 / IPC / スクリーンショット / 設定
├── tts-service.js          VOICEVOX Core FFI (koffi)
└── translation-service.js  中→日 LLM 翻訳 + LRU キャッシュ

Renderer (3 windows)
├── Settings Window         index.html + settings-ui.js
├── Pet Window              desktop-pet.html + model-adapter.js
└── Chat Bubble             pet-chat-bubble.html

Core Modules (renderer)
├── desktop-pet-system.js   オーケストレータ: スクリーンショット / AI / オーディオ
├── message-session.js      コーディネータ: テキスト + 表情 + オーディオ同期
├── emotion-system.js       感情蓄積 + AI 表情選択 + モーショントリガー
├── audio-state-machine.js  3モードフォールバックステートマシン
├── ai-chat.js              OpenAI 互換 API クライアント
└── prompt-builder.js       システムプロンプト構築 (テンプレート変数)
```

## 動作環境

- Windows 10/11
- Node.js >= 18（ソースから実行する場合）
- OpenAI 互換 API キー
- VOICEVOX Core（オプション、音声合成用）

## テスト

```bash
node tests/test-core.js
```

## 注意事項

- **プライバシー**: スクリーンショットは設定した API にのみ送信され、ディスクには保存されません
- **API 料金**: Vision モデルの呼び出しには料金が発生します。検出間隔を適切に設定してください
- **VOICEVOX**: 音声使用時は「VOICEVOX:キャラ名」のクレジット表記が必要です

## トラブルシューティング

問題が発生した場合、コマンドプロンプト（cmd）を開き、以下のコマンドでプログラムを起動してコンソールログを有効にしてください：

```bash
"フォルダパス\Live2DPet.exe" --enable-logging 2>&1
```

問題発生時のログ出力を記録し、Issue 提出時に添付してください。

### 既知の問題

- スクリーンショット関連の warning は無視して問題ありません。通常動作に影響しません
- VVM 音声モデルの読み取りエラー：`C:\Users\ユーザー名\AppData\Roaming\live2dpet\voicevox_core` でモデルフォルダを見つけ、破損したファイルを削除して再ダウンロードしてください

## 技術スタック

- [Electron](https://www.electronjs.org/) — デスクトップアプリケーションフレームワーク
- [Live2D Cubism SDK](https://www.live2d.com/en/sdk/about/) + [PixiJS](https://pixijs.com/) + [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)
- [VOICEVOX Core](https://github.com/VOICEVOX/voicevox_core) — 日本語音声合成エンジン
- [koffi](https://koffi.dev/) — Node.js FFI

## 更新履歴

### v1.2.0 — 画像モデル

- 画像フォルダモデルを追加：画像フォルダを選択し、各画像を待機/会話/表情にタグ付け
- AI 発話時に会話画像へ自動切替、感情トリガー時に表情画像へ切替
- クロップスケール制御で異なるアスペクト比のキャラクター画像に対応
- PNG / JPG / WebP 形式をサポート

### 過去のバージョン

- v1.1.0 — 高速応答モード、会話履歴バッファ、スクリーンショット重複排除、翻訳・感情システムの言語非依存化
- v1.0.0 — 初期リリース：Live2D デスクトップペット、AI 視覚認識対話、VOICEVOX 音声合成、感情・表情システム

## ライセンス

MIT — [LICENSE](LICENSE) を参照。

## 募集

- **Live2D モデル**: 著作権の関係上デフォルトモデルは同梱していません — 再配布可能なモデルの提供を歓迎します
- **アプリアイコン**: 現在は開発者のアバターで仮置き中 — デザインの投稿を歓迎します

## コントリビューター

すべてのコントリビューターに感謝します。重要度ではなく時系列順に掲載。完全なリストは [CONTRIBUTORS.md](CONTRIBUTORS.md) を参照。

| コントリビューター |
|-------------------|
| 380kkm |

## スポンサー

すべてのスポンサーに感謝します。重要度ではなく時系列順に掲載。完全なリストは [SPONSORS.md](SPONSORS.md) を参照。

| スポンサー |
|-----------|
| 柠檬 |

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=x380kkm/Live2DPet&type=Date)](https://star-history.com/#x380kkm/Live2DPet&Date)
