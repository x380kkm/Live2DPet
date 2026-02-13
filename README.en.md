# Live2DPet — AI Desktop Pet Companion

**English** | **[日本語](README.ja.md)** | **[中文](README.md)**

An Electron-based desktop pet. A Live2D character stays on your desktop, perceives your activity via screenshots, generates companionship dialogue through AI, and speaks with VOICEVOX text-to-speech. Built with AI-assisted development using [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

> **Privacy Notice**: This app periodically captures screenshots and sends them to your configured AI API for analysis. Screenshots are never saved to disk. Make sure you trust your API provider and be mindful of sensitive information displayed on screen.

<p align="center">
  <img src="assets/app-icon.png" width="128" alt="Live2DPet Icon">
</p>

## Usage Example

<p align="center">
  <img src="assets/example-little-demon.png" width="60%" alt="Usage Example 1">
</p>
<p align="center">
  <img src="assets/example-kasukabe.jpg" width="60%" alt="Usage Example 2">
</p>
<p align="center">
  <img src="assets/example-kiritan.png" width="60%" alt="Usage Example 3">
</p>

**Model Credits**

【Model】Little Demon
Author：Cai Cat様

【Model】春日部つむぎ (公式)
イラスト：春日部つくし様
モデリング：米田らん様

【Model】東北きりたん ([水德式](https://www.bilibili.com/video/BV1B7dcY1EFU))
イラスト：白白什么雨様
配布：君临德雷克様

*The models shown in this example are borrowed for demonstration purposes. All rights belong to the original creators.*

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

Open the settings panel and fill in the "API Settings" tab:

| Field | Description |
|-------|-------------|
| API URL | OpenAI-compatible endpoint |
| API Key | Your API key |
| Model Name | e.g. `x-ai/grok-4.1-fast` |

Supported services:

| Service | baseURL | Model Example |
|---------|---------|---------------|
| OpenRouter | `https://openrouter.ai/api/v1` | `x-ai/grok-4.1-fast` |
| Grok Direct | `https://api.x.ai/v1` | `grok-4.1-fast` |
| Deepseek | `https://api.deepseek.com/v1` | `deepseek-chat` |

Vision-capable models are recommended for screenshot awareness.

### 2. Import Live2D Model

In the "Model" tab, click "Select Model Folder" and choose a directory containing `.model.json` or `.model3.json`. The system will automatically:
- Scan model parameters and map eye/head tracking
- Scan expression files and motion groups
- Copy the model to the user data directory

Image folders (PNG/JPG/WebP) are also supported as character visuals — see "Image Model" below.

### 3. Launch Pet

Click "Launch Pet". The character appears as a transparent window at the bottom-right of your desktop.
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

### 4. Customize Character

In the "Character" tab, edit the character's name, personality, and behavior rules. Supports template variables `{{petName}}` and `{{userIdentity}}`.

### 5. VOICEVOX Text-to-Speech (Optional)

In the "TTS" tab, one-click install VOICEVOX components:
- VOICEVOX Core + ONNX Runtime
- VVM voice models (selectable in UI)
- Open JTalk dictionary

Supports GPU acceleration (DirectML). AI responses are auto-translated to Japanese and spoken aloud.

## Features

- **Live2D Desktop Character** — Transparent frameless window, always on top, eyes follow cursor
- **Image Model** — Use an image folder as character, tagged by idle/talking/emotion, AI-driven auto switching
- **AI Visual Awareness** — Periodic screenshots + active window detection, AI responds to screen content
- **VOICEVOX Voice** — Local Japanese TTS, auto translation, one-click setup
- **Emotion System** — AI-driven expression/motion selection with emotion accumulation triggers
- **Audio State Machine** — TTS → default phrases → silent, three-mode auto fallback
- **Hot Model Import** — Any Live2D model, auto parameter mapping, auto expression/motion scan
- **Character Personas** — JSON templates define personality and behavior rules, multi-character support

## Architecture

```
Electron Main Process
├── main.js                 Window management / IPC / Screenshots / Config
├── tts-service.js          VOICEVOX Core FFI (koffi)
└── translation-service.js  CN→JP LLM translation + LRU cache

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

## Requirements

- Windows 10/11
- Node.js >= 18 (when running from source)
- OpenAI-compatible API Key
- VOICEVOX Core (optional, for TTS)

## Testing

```bash
node tests/test-core.js
```

## Notes

- **Privacy**: Screenshots are only sent to your configured API, never saved to disk
- **API Costs**: Vision model calls incur costs — set a reasonable detection interval
- **VOICEVOX**: When using voice, credit "VOICEVOX:[character name]"

## Tech Stack

- [Electron](https://www.electronjs.org/) — Desktop application framework
- [Live2D Cubism SDK](https://www.live2d.com/en/sdk/about/) + [PixiJS](https://pixijs.com/) + [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)
- [VOICEVOX Core](https://github.com/VOICEVOX/voicevox_core) — Japanese TTS engine
- [koffi](https://koffi.dev/) — Node.js FFI

## Changelog

### v1.2.0 — Image Model

- New image folder model: select an image folder, tag each image as idle/talking/emotion
- Auto-switch to talking images when AI speaks, emotion images on mood triggers
- Crop scale control for different aspect ratio character images
- Supports PNG / JPG / WebP

### Earlier Versions

- v1.1.0 — Fast response mode, conversation history buffer, screenshot dedup, language-agnostic translation & emotion
- v1.0.0 — Initial release: Live2D desktop pet, AI visual awareness, VOICEVOX TTS, emotion/expression system

## License

MIT — See [LICENSE](LICENSE).

## Wanted

- **Live2D Models**: No default model is included due to copyright — redistributable model contributions are welcome
- **App Icon**: Currently using a developer avatar as placeholder — design submissions welcome
