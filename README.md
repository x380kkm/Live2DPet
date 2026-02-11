# Live2DPet — AI 桌面宠物伴侣

基于 Electron 的桌面宠物。Live2D 角色常驻桌面，通过截屏感知你的操作，AI 大模型生成陪伴式对话，VOICEVOX 语音合成实现字音同步。

## 功能

- **Live2D 角色** — 透明无边框窗口，始终置顶，眼睛跟随鼠标
- **AI 视觉感知** — 定时截屏 + 活动窗口检测，AI 根据屏幕内容回应
- **VOICEVOX 语音合成** — 本地 TTS，中→日自动翻译，字音同步气泡
- **情绪系统** — AI 驱动表情/动作选择，情绪累积触发，TTS 对齐模式
- **音频状态机** — TTS → 默认音声 → 静音，三模式自动降级
- **模型热导入** — 任意 Live2D 模型，参数自动映射，表情/动作自动扫描
- **可自定义** — 角色人设 JSON，气泡框图片，多 API 兼容

## 架构

```
Electron Main Process
├── main.js              窗口管理 / IPC / 截屏 / TTS / 翻译 / 配置
├── tts-service.js       VOICEVOX Core FFI (koffi)
└── translation-service.js  中→日 LLM 翻译 + LRU 缓存

Renderer (3 windows)
├── Settings Window      index.html + settings-ui.js
├── Pet Window           desktop-pet.html + model-adapter.js
└── Chat Bubble          pet-chat-bubble.html

Core Modules (renderer)
├── desktop-pet-system.js   调度: 截屏 / AI 请求 / 音频准备
├── message-session.js      协调: 文字 + 表情 + 音频同步
├── emotion-system.js       情绪累积 + AI 表情选择 + 对齐触发
├── audio-state-machine.js  三模式降级状态机
├── ai-chat.js              OpenAI 兼容 API 客户端
└── prompt-builder.js       System Prompt 构建
```

## 环境要求

- Node.js >= 18
- Windows 10/11
- OpenAI 兼容 API Key (推荐支持 Vision 的模型)
- VOICEVOX Core (可选，用于语音合成)

## 快速开始

```bash
git clone https://github.com/<your-username>/live2dpet.git
cd live2dpet
npm install
node launch.js
```

启动后在设置面板配置 API，点击「启动宠物」。

> VSCode 终端请用 `node launch.js`，不要用 `npx electron .`（ELECTRON_RUN_AS_NODE 冲突）

## VOICEVOX 语音合成 (可选)

TTS 需要下载 VOICEVOX Core 组件到 `voicevox_core/` 目录:

```bash
# Core + ONNX Runtime
gh release download 0.16.3 -R VOICEVOX/voicevox_core -p "voicevox_core-windows-x64-0.16.3.zip"
gh release download voicevox_onnxruntime-1.17.3 -R VOICEVOX/onnxruntime-builder -p "voicevox_onnxruntime-win-x64-1.17.3.tgz"

# VVM 模型 (按需)
for i in $(seq 0 23); do gh release download 0.16.3 -R VOICEVOX/voicevox_vvm -p "$i.vvm"; done

# Open JTalk 辞書
curl -L -o dict.tar.gz "https://sourceforge.net/projects/open-jtalk/files/Dictionary/open_jtalk_dic-1.11/open_jtalk_dic_utf_8-1.11.tar.gz/download"
```

GPU 加速 (DirectML):
```bash
gh release download voicevox_onnxruntime-1.17.3 -R VOICEVOX/onnxruntime-builder -p "voicevox_onnxruntime-win-x64-dml-1.17.3.tgz"
```

## API 配置

| 服务 | baseURL | 模型示例 |
|------|---------|---------|
| OpenRouter | `https://openrouter.ai/api/v1` | `x-ai/grok-4.1-fast` |
| Grok 直连 | `https://api.x.ai/v1` | `grok-4.1-fast` |
| Deepseek | `https://api.deepseek.com/v1` | `deepseek-chat` |

推荐支持 Vision 的模型以获得截屏感知能力。

## 自定义角色

编辑 `assets/prompts/sister.json`:

```json
{
  "data": {
    "name": "Yuki",
    "userIdentity": "妹妹",
    "description": "角色描述，支持 {{petName}} {{userIdentity}} 模板变量",
    "personality": "性格描述",
    "rules": "行为规则"
  }
}
```

## 测试

```bash
node tests/test-core.js   # 113 tests, 12 suites
```

## 注意事项

- **隐私**: 截屏数据仅发送给你配置的 API，不存储到磁盘
- **API 费用**: 视觉模型调用会产生费用，合理设置检测间隔
- **版权**: Live2D 模型素材受版权保护，仅供个人学习使用
- **VOICEVOX**: 使用时需标注 "VOICEVOX:キャラ名"

## 技术栈

- [Electron](https://www.electronjs.org/) — 桌面应用框架
- [Live2D Cubism SDK](https://www.live2d.com/en/sdk/about/) + [PixiJS](https://pixijs.com/) + [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)
- [VOICEVOX Core](https://github.com/VOICEVOX/voicevox_core) — 日语语音合成
- [koffi](https://koffi.dev/) — Node.js FFI (调用 voicevox_core.dll)

## License

本项目仅供个人学习和演示用途。Live2D 模型素材版权归原作者所有。
