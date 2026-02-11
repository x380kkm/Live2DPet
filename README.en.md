# Live2DPet — AI Desktop Pet Companion

**English** | **[日本語](README.ja.md)** | **[中文](README.md)**

An Electron-based desktop pet. A Live2D character stays on your desktop, perceives your activity via screenshots, generates companionship dialogue through AI, and speaks with VOICEVOX text-to-speech. Built with AI-assisted development using [Claude Code](https://docs.anthropic.com/en/docs/claude-code).

> **Privacy Notice**: This app periodically captures screenshots and sends them to your configured AI API for analysis. Screenshots are never saved to disk. Make sure you trust your API provider and be mindful of sensitive information displayed on screen.

<p align="center">
  <img src="assets/app-icon.png" width="128" alt="Live2DPet Icon">
</p>

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

Static images (PNG/GIF) are also supported as character visuals — not fully tested yet.

### 3. Launch Pet

Click "Launch Pet". The character appears as a transparent window at the bottom-right of your desktop.
- Drag to reposition
- Eyes follow your mouse cursor
- AI periodically takes screenshots and chats via speech bubbles

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
- **AI Visual Awareness** — Periodic screenshots + active window detection, AI responds to screen content
- **VOICEVOX Voice** — Local Japanese TTS, auto Chinese→Japanese translation, one-click setup
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

## License

MIT — See [LICENSE](LICENSE).

Note: Due to copyright, this repository does not include a default Live2D model. Contributions of redistributable models are welcome. The app icon is a developer avatar placeholder for the same reason.
