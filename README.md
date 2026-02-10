# Live2DPet — AI 桌面宠物伴侣

一个基于 Electron 的桌面宠物应用。Live2D 角色常驻桌面，通过截屏感知你的操作，借助 AI 大模型生成有温度的陪伴式对话。

## 功能概览

- **Live2D 角色渲染** — 透明无边框窗口，角色始终置顶显示，眼睛跟随鼠标
- **AI 视觉感知** — 定时截屏 + 活动窗口检测，AI 根据屏幕内容生成上下文相关的回应
- **情绪表情系统** — AI 驱动的表情选择（脸红、生气、流泪、晕、脸黑），带情绪累积机制
- **气泡对话** — 自适应大小的对话气泡，带淡入淡出动画
- **可自定义角色** — 通过 JSON 配置角色人设、性格、说话风格
- **多 API 兼容** — 支持 OpenRouter / Grok / Claude 代理 / Deepseek 等 OpenAI 兼容接口
- **设置面板** — 图形化配置 API、检测间隔、情绪频率、角色 prompt

## 技术架构

```
┌─────────────────────────────────────────────────┐
│                  Electron Main Process           │
│  main.js — 窗口管理 / IPC / 截屏 / 配置持久化     │
└──────┬──────────┬──────────────┬────────────────┘
       │          │              │
       ▼          ▼              ▼
┌──────────┐ ┌──────────┐ ┌──────────────┐
│ Settings │ │   Pet    │ │  Chat Bubble │
│  Window  │ │  Window  │ │   Window     │
│index.html│ │desktop-  │ │pet-chat-     │
│          │ │pet.html  │ │bubble.html   │
└──────────┘ └────┬─────┘ └──────────────┘
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
  ┌─────────┐┌────────┐┌──────────┐
  │AI Chat  ││Emotion ││  Prompt  │
  │Client   ││System  ││ Builder  │
  └─────────┘└────────┘└──────────┘
```

### 目录结构

```
live2dpet/
├── main.js                  # Electron 主进程
├── preload.js               # IPC 安全桥接（contextIsolation）
├── launch.js                # 启动脚本
├── index.html               # 设置窗口 UI
├── desktop-pet.html         # 宠物窗口（Live2D 画布）
├── pet-chat-bubble.html     # 对话气泡窗口
├── config.json              # 用户配置（API Key 等，不入版本控制）
├── package.json             # 项目配置 & electron-builder 构建配置
│
├── src/
│   ├── core/
│   │   ├── ai-chat.js              # OpenAI 兼容 API 客户端
│   │   ├── desktop-pet-system.js   # 核心调度：窗口检测 / 截屏 / AI 请求
│   │   ├── emotion-system.js       # 表情情绪系统
│   │   └── prompt-builder.js       # System Prompt 构建器
│   └── renderer/
│       └── pet-chat-bubble.js      # 气泡渲染逻辑
│
├── assets/
│   ├── dialog-frame.png            # 气泡边框素材
│   ├── L2D/pink-devil/             # Live2D 模型文件
│   │   ├── Pink devil.model3.json
│   │   ├── Pink devil.moc3
│   │   ├── *.exp3.json             # 表情文件
│   │   ├── *.motion3.json          # 动作文件
│   │   └── Pink devil.4096/        # 纹理
│   └── prompts/
│       ├── sister.json             # 当前角色 prompt
│       └── sister.default.json     # 默认角色 prompt 备份
│
├── libs/                           # 第三方库（本地引入）
│   ├── live2dcubismcore.min.js     # Live2D Cubism Core SDK
│   ├── pixi.min.js                 # PixiJS 渲染器
│   └── cubism4.min.js              # pixi-live2d-display
│
└── tests/
    └── test-core.js                # 单元测试
```

### 数据流

1. **焦点追踪器** — 每 1 秒采样当前活动窗口，记录各窗口使用时长
2. **截屏缓冲** — 每 5 秒截取屏幕，按窗口名分组存储（每窗口最多 3 张）
3. **主检测循环** — 按配置间隔（默认 30 秒）触发 AI 请求
4. **AI 分析** — 将截图 + 窗口上下文 + 角色 prompt 发送给大模型
5. **情绪系统** — 根据 AI 回复内容选择表情，触发 Live2D 表情动画
6. **气泡展示** — 对话内容通过浮动气泡窗口显示

## 环境要求

- **Node.js** >= 18
- **npm** >= 9
- **Windows** 10/11（当前仅支持 Windows，因 `active-win` 和截屏依赖）
- 一个支持 OpenAI Chat Completions 格式的 API Key（推荐支持 Vision 的模型）

## 快速开始

### 1. 克隆仓库

```bash
git clone https://github.com/<your-username>/live2dpet.git
cd live2dpet
```

### 2. 安装依赖

```bash
npm install
```

### 3. 配置 API

在项目根目录创建 `config.json`：

```json
{
  "apiKey": "你的API密钥",
  "baseURL": "https://openrouter.ai/api/v1",
  "modelName": "x-ai/grok-4.1-fast",
  "interval": 30,
  "emotionFrequency": 30,
  "enabledEmotions": ["脸红", "生气", "流泪", "晕", "脸黑"]
}
```

也可以启动后在设置面板中填写。

**支持的 API 服务示例：**

| 服务 | baseURL | 模型示例 |
|------|---------|---------|
| OpenRouter | `https://openrouter.ai/api/v1` | `x-ai/grok-4.1-fast` |
| Grok 直连 | `https://api.x.ai/v1` | `grok-4.1-fast` |
| Deepseek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 自建代理 | `http://localhost:8080/v1` | 按代理配置 |

> 推荐使用支持 Vision（图片输入）的模型，以获得截屏感知能力。

### 4. 启动

```bash
npm start
```

启动后会打开设置窗口，确认 API 配置无误后点击「启动宠物」。

### 5. 开发模式

```bash
npm run dev
```

### 6. 运行测试

```bash
npm test
```

## 构建打包

```bash
npm run build
```

输出 `dist/Live2DPet.exe`（Windows 便携版，无需安装）。

> 注意：构建产物未进行代码签名，Windows 可能弹出 SmartScreen 警告，选择「仍要运行」即可。

```bash
npm run build:dir    # 仅输出解压目录，不打包为单文件
```

## 自定义角色

编辑 `assets/prompts/sister.json` 可自定义角色人设：

```json
{
  "data": {
    "name": "Yuki",
    "userIdentity": "妹妹",
    "userTerm": "你",
    "description": "角色描述，支持 {{petName}} {{userIdentity}} {{userTerm}} 模板变量",
    "personality": "性格描述",
    "rules": "行为规则",
    "scenario": "场景设定"
  }
}
```

如需恢复默认，将 `sister.default.json` 复制为 `sister.json`。

## 配置说明

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `apiKey` | API 密钥 | （空） |
| `baseURL` | API 端点 | `https://openrouter.ai/api/v1` |
| `modelName` | 模型名称 | `x-ai/grok-4.1-fast` |
| `interval` | AI 检测间隔（秒） | `30`（最小 10） |
| `emotionFrequency` | 表情触发间隔（秒） | `30` |
| `enabledEmotions` | 启用的表情列表 | 全部 5 种 |

## 表情系统

内置 5 种表情，由 AI 根据对话内容自动选择：

| 表情 | 文件 | 触发场景 |
|------|------|---------|
| 脸红 | `blush.exp3.json` | 害羞、被夸 |
| 生气 | `angry.exp3.json` | 不满、吐槽 |
| 流泪 | `tears.exp3.json` | 感动、委屈 |
| 晕 | `dizzy.exp3.json` | 困惑、疲惫 |
| 脸黑 | `annoyed.exp3.json` | 无语、嫌弃 |

情绪值在 0-100 之间累积，达到阈值时触发表情动画。

## 注意事项

- **隐私**：截屏数据仅在本地处理并发送给你配置的 API 服务，不会存储到磁盘或发送到其他地方
- **API 费用**：视觉模型的 API 调用会产生费用，建议合理设置检测间隔
- **版权**：Live2D 模型素材受版权保护，仅供个人学习使用，请勿用于商业用途
- **签名**：构建产物未签名，首次运行可能触发系统安全提示

## 技术栈

- [Electron](https://www.electronjs.org/) 28.x — 桌面应用框架
- [Live2D Cubism SDK](https://www.live2d.com/en/sdk/about/) — Live2D 渲染引擎
- [PixiJS](https://pixijs.com/) — WebGL 渲染
- [pixi-live2d-display](https://github.com/guansss/pixi-live2d-display) — Live2D + PixiJS 集成
- [active-win](https://github.com/nicedoc/active-win) — 活动窗口检测

## License

本项目仅供个人学习和演示用途。Live2D 模型素材版权归原作者所有。

