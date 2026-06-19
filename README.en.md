# Live2DPet — AI Desktop Pet Companion

**English** | **[日本語](README.ja.md)** | **[中文](README.md)**

![GitHub stars](https://img.shields.io/github/stars/x380kkm/Live2DPet) ![License](https://img.shields.io/github/license/x380kkm/Live2DPet) ![Downloads](https://img.shields.io/github/downloads/x380kkm/Live2DPet/total) ![Last Commit](https://img.shields.io/github/last-commit/x380kkm/Live2DPet)

> If you find this useful, please consider giving it a [Star](https://github.com/x380kkm/Live2DPet) :)

An Electron-based desktop pet. A Live2D character stays on your desktop, understands what you're doing through screenshots and window awareness, generates companionship dialogue through AI, supports click/drag/touch interactions, uses keyframe visual memory so the AI can review your recent activity, and speaks with VOICEVOX text-to-speech. Built with AI-assisted development using [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

> **Privacy Notice**: This app periodically captures screenshots and sends them to your configured AI API for analysis. Screenshots are never saved to disk. Make sure you trust your API provider and be mindful of sensitive information displayed on screen.

<p align="center">
  <img src="assets/app-icon.png" width="128" alt="Live2DPet Icon">
</p>

## Usage Example

<p align="center">
  <img src="assets/example-little-demon-en.png" width="60%" alt="Usage Example 1">
</p>
<p align="center">
  <img src="assets/example-kasukabe.jpg" width="60%" alt="Usage Example 2">
</p>
<p align="center">
  <img src="assets/example-kiritan.png" width="60%" alt="Usage Example 3">
</p>

<details>
<summary>Model Credits</summary>

【Model】Little Demon<br>
Author：Cai Cat様

【Model】春日部つむぎ (公式)<br>
イラスト：春日部つくし様<br>
モデリング：米田らん様

【Model】東北きりたん ([水德式](https://www.bilibili.com/video/BV1B7dcY1EFU))<br>
イラスト：白白什么雨様<br>
配布：君临德雷克様

*The models shown in this example are borrowed for demonstration purposes. All rights belong to the original creators.*

</details>

## Quick Start

### Option 1: Download (Recommended)

Download `Live2DPet.exe` from [Releases](https://github.com/x380kkm/Live2DPet/releases). Double-click to run — no installation needed.

### Option 2: Run from Source

```bash
git clone https://github.com/x380kkm/Live2DPet.git
cd Live2DPet
npm install
node launch.js
```

> In VSCode terminal, use `node launch.js` instead of `npx electron .` (ELECTRON_RUN_AS_NODE conflict).

## Usage Guide

### 1. Configure API

Open the settings panel and fill in the "API Settings" tab with your API URL, key, and model name. This app is compatible with any OpenAI-format API endpoint. You can use aggregation platforms such as OpenRouter.

Vision-capable models are recommended for screenshot awareness:
- Budget-friendly: Grok series
- Mid-range: GPT-o3 / GPT-5.1
- High quality: Gemini 3 Pro Preview

Translation API (for TTS Japanese translation):
- OpenRouter `x-ai/grok-4-fast`

### 2. Import Live2D Model

In the "Model" tab, click "Select Model Folder" and choose a directory containing `.model.json` or `.model3.json`. The system will automatically:
- Scan model parameters and map eye/head tracking
- Scan expression files and motion groups
- Copy the model to the user data directory

Image folders (PNG/JPG/WebP) are also supported as character visuals — see "Image Model" below.

> Don't have a Live2D model? Download free samples from the [Live2D official gallery](https://www.live2d.com/en/learn/sample/) to try it out.

### 3. Configure VOICEVOX Text-to-Speech (Optional)

> Visit the [VOICEVOX website](https://voicevox.hiroshiba.jp/) first to preview characters and styles, then download the model you like.

1. In the "TTS" tab, install VOICEVOX components (Core + ONNX Runtime + Open JTalk dictionary)
2. Select and download VVM voice models
3. Click "Save & Restart" to restart the app and load the models
4. Set the speaker, style, and fine-tune other voice parameters

Supports GPU acceleration (DirectML). AI responses are auto-translated to Japanese and spoken aloud.

<details>
<summary>Manual VOICEVOX Installation</summary>

If the in-app one-click install fails, you can download and place the files manually.

**Install location**: `C:\Users\YourUsername\AppData\Roaming\live2dpet\voicevox_core`

> Replace "YourUsername" with your Windows username.

**Download links**:

| Component | Required | Download |
|-----------|----------|----------|
| VOICEVOX Core | Yes | [voicevox_core-windows-x64-0.16.4.zip](https://github.com/VOICEVOX/voicevox_core/releases/download/0.16.4/voicevox_core-windows-x64-0.16.4.zip) |
| ONNX Runtime (CPU) | Yes | [voicevox_onnxruntime-win-x64-1.17.3.tgz](https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.17.3/voicevox_onnxruntime-win-x64-1.17.3.tgz) |
| ONNX Runtime (GPU) | No | [voicevox_onnxruntime-win-x64-dml-1.17.3.tgz](https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.17.3/voicevox_onnxruntime-win-x64-dml-1.17.3.tgz) |
| Open JTalk Dictionary | Yes | [open_jtalk_dic_utf_8-1.11.tar.gz](https://sourceforge.net/projects/open-jtalk/files/Dictionary/open_jtalk_dic-1.11/open_jtalk_dic_utf_8-1.11.tar.gz/download) |
| Default Voice Model | Yes | [0.vvm](https://github.com/VOICEVOX/voicevox_vvm/releases/download/0.16.4/0.vvm) |
| Singing Model (for Chinese song) | No | [s0.vvm](https://github.com/VOICEVOX/voicevox_vvm/releases/download/0.16.4/s0.vvm) |
| Other Voice Models | No | [vvm](https://github.com/VOICEVOX/voicevox_vvm/releases/) |

**Expected directory structure after extraction**:

```
voicevox_core/
├── c_api/
│   └── voicevox_core-windows-x64-0.16.4/
│       └── lib/
│           └── voicevox_core.dll
├── voicevox_onnxruntime-win-x64-1.17.3/
│   └── lib/
│       └── voicevox_onnxruntime.dll
├── open_jtalk_dic_utf_8-1.11/
│   ├── sys.dic
│   └── ...
└── models/
    ├── 0.vvm
    └── ...
```

Extract downloaded files to the corresponding paths above, place `.vvm` files in the `models/` folder, then restart the app.

</details>

### 4. Customize Character

In the "Character" tab, create a new character card and edit the character's name, personality, and behavior rules. Supports template variables `{{petName}}` and `{{userIdentity}}`.

### 5. Launch Pet

Click "Launch Pet" at the bottom of the settings panel. The character appears as a transparent window at the bottom-right of your desktop.
- Drag to reposition
- Eyes follow your mouse cursor (Live2D mode)
- AI periodically takes screenshots and chats via speech bubbles

### Image Model

Besides Live2D, you can use an image folder as the character visual:

1. In the "Model" tab, select type "Image Folder" and choose a folder containing PNG/JPG/WebP images
2. Tag each image's role: idle, talking, or emotion (multiple tags allowed)
3. Emotion images need an emotion name — the AI emotion system will match automatically
4. Use the crop scale slider to adjust display ratio

The character automatically switches to "talking" images when the AI speaks, emotion images on mood triggers, and "idle" images otherwise.

## Features

- **Live2D Desktop Character** — Transparent frameless window, always on top, eyes follow cursor
- **Image Model** — Use an image folder as character, tagged by idle/talking/emotion, AI-driven auto switching
- **AI Visual Awareness** — Periodic screenshots + active window detection, AI responds to screen content
- **Interaction System** — Click/touch/drag/swipe/resize, interaction events injected into AI context
- **Keyframe Visual Memory** — Auto-samples screenshots, VLM picks representative keyframes, AI can review recent activity
- **VOICEVOX Voice** — Local Japanese TTS, auto translation, one-click setup
- **Emotion System** — AI-driven expression/motion selection with emotion accumulation triggers
- **Audio State Machine** — TTS → default phrases → silent, three-mode auto fallback
- **Hot Model Import** — Any Live2D model, auto parameter mapping, auto expression/motion scan
- **Character Personas** — JSON templates define personality and behavior rules, multi-character support

> **Deprecated**: The smart enhancement text pipeline (auto search, knowledge organization, knowledge acquisition, activity memory, VLM situation extraction) has been suspended in v2.0. Code skeleton preserved.

<details>
<summary>Architecture</summary>

```
Electron Main Process
├── main.js                 App lifecycle orchestrator, module registration
├── src/main/               Main process modules (extracted from main.js)
│   ├── app-context.js      Shared mutable state
│   ├── config-manager.js   Config persistence / migration / encryption
│   ├── crypto-utils.js     AES-256-GCM API key encryption
│   ├── validators.js       Input validation (UUID / URL / path traversal)
│   ├── window-manager.js   Window creation / control / chat bubble
│   ├── character-manager.js Character card CRUD / import-export
│   ├── tts-ipc.js          TTS synthesis / VOICEVOX setup
│   ├── model-import.js     Model scanning / parameter mapping
│   └── ...                 emotion / enhance / screen / tray / i18n
├── src/core/
│   ├── tts-service.js      VOICEVOX Core FFI (koffi)
│   ├── translation-service.js  CN→JP LLM translation + LRU cache
│   └── enhance/            Enhancement subsystem
│       ├── enhancement-orchestrator.js  Orchestrator: keyframe visual memory
│       ├── vlm-extractor.js    Screenshot capture / Mipmap / Keyframe selection
│       ├── context-pool.js     Short-term pool + Long-term pool (Jaccard RAG) [deprecated]
│       ├── knowledge-store.js  LLM knowledge summarization [deprecated]
│       ├── knowledge-acquisition.js  Auto knowledge acquisition [deprecated]
│       ├── search-service.js   Web search IPC [deprecated]
│       └── memory-tracker.js   Activity memory tracking [deprecated]

Renderer (3 windows)
├── Settings Window         index.html + settings-ui.js
├── Pet Window              desktop-pet.html + model-adapter.js
└── Chat Bubble             pet-chat-bubble.html

Core Modules (renderer)
├── desktop-pet-system.js   Orchestrator: screenshots / AI requests / audio
├── message-session.js      Coordinator: text + expression + audio sync
├── emotion-system.js       Emotion accumulation + AI expression + motion trigger
├── audio-state-machine.js  Three-mode fallback state machine
├── ai-chat.js              OpenAI-compatible API client
└── prompt-builder.js       System prompt builder (template variables)
```

</details>

<details>
<summary>Requirements</summary>

- Windows 10/11
- Node.js >= 18 (when running from source)
- OpenAI-compatible API Key
- VOICEVOX Core (optional, for TTS)

</details>

<details>
<summary>Testing</summary>

```bash
npm test
```

</details>

## Notes

- **Privacy**: Screenshots are only sent to your configured API, never saved to disk
- **API Costs**: Vision model calls incur costs — set a reasonable detection interval
- **VOICEVOX**: When using voice, credit "VOICEVOX:[character name]"

## Troubleshooting

To enable console logging for debugging, open a command prompt (cmd) and run:

```bash
"path\to\Live2DPet.exe" --enable-logging 2>&1
```

Please record the log output when the issue occurs and include it when submitting an Issue.

### Known Issues

- Screenshot-related warnings can be safely ignored — they do not affect normal operation
- VVM voice model read errors: go to `C:\Users\YourUsername\AppData\Roaming\live2dpet\voicevox_core`, find the model folder, delete the corrupted files, and re-download

<details>
<summary>Tech Stack</summary>

- [Electron](https://www.electronjs.org/) — Desktop application framework
- [Live2D Cubism SDK](https://www.live2d.com/en/sdk/about/) + [PixiJS](https://pixijs.com/) + [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)
- [VOICEVOX Core](https://github.com/VOICEVOX/voicevox_core) — Japanese TTS engine
- [koffi](https://koffi.dev/) — Node.js FFI

</details>

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT — See [LICENSE](LICENSE).

## Wanted

- **Live2D Models**: No default model is included due to copyright — redistributable model contributions are welcome
- **App Icon**: Currently using a developer avatar as placeholder — design submissions welcome
- **Built-in Character Cards**: Fun character card submissions are welcome! Built-in cards must include zh/en/ja trilingual versions. To submit, modify `assets/prompts/<uuid>.json` (with `i18n` field) and `ensureDefaultCharacters()` in `src/main/character-manager.js`. See existing built-in cards for format reference

<details>
<summary>Built-in Character Cards</summary>

> English and Japanese versions are machine-translated. Proofreading contributions welcome.

| Character | 中文 | English | 日本語 | Note |
|-----------|------|---------|--------|------|
| 后辈 / Kouhai / 後輩 | ✅ Source | ✅ MT | ✅ MT | Default character, sharp-tongued kouhai desktop pet |

</details>

## Contributors

<a href="https://github.com/x380kkm/Live2DPet/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=x380kkm/Live2DPet" />
</a>

## Sponsors

See [SPONSORS.md](SPONSORS.md) for the full list.

| Sponsor |
|---------|
| 柠檬 |

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=x380kkm/Live2DPet&type=Date)](https://star-history.com/#x380kkm/Live2DPet&Date)
