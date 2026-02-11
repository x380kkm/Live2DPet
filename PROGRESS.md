# Live2D Desktop Pet - 实现进度备份

## Phase 1: Live2D 解耦 — 已完成 ✓

### 已完成的步骤

1. **Phase 1.0: 准备工作** ✓
   - `assets/app-icon.png` — 从桌面复制
   - `npm install electron-log` — 已安装
   - `src/utils/path-utils.js` — 新建，集中路径工具（dev/production统一）
   - `assets/placeholder.svg` — 新建占位图

2. **Phase 1.1: Config Schema 扩展** ✓
   - `config.json` — 新schema：configVersion=1, model{type/paramMapping/expressions/canvasYRatio等}, bubble, appIcon
   - `main.js` — getDefaultConfig(), getDefaultModelConfig(), migrateConfig() 函数
   - 旧config（无configVersion）自动迁移到v1，清空硬编码表情列表

3. **Phase 1.2: 模型导入 & 参数扫描 IPC** ✓
   - `main.js` 新增8个IPC handler:
     - `select-model-folder` — 选择文件夹，扫描.model3.json
     - `scan-model-info` — 读取model3.json，提取参数/表情/motions
     - `select-static-image` — 选择静态图片/GIF
     - `select-bubble-image` — 选择气泡框图片
     - `select-app-icon` — 选择图标，复制到userData
     - `copy-model-to-userdata` — 复制模型到userData
     - `validate-model-paths` — 启动时校验路径
     - `delete-profile` — 删除profile文件夹
   - 参数模糊匹配字典 `PARAM_FUZZY_MAP` + `suggestParamMapping()`

4. **Phase 1.3: ModelAdapter 策略模式** ✓
   - `src/renderer/model-adapter.js` — 新建
   - `ModelAdapter` 基类 + `Live2DAdapter` + `ImageAdapter` + `NullAdapter`
   - `createModelAdapter(config)` 工厂函数
   - Live2D: canvasYRatio, paramMapping驱动eye tracking
   - Image: DOM `<img>` + bottomAlignOffset + GIF表情切换
   - Null: placeholder.svg

5. **Phase 1.4: emotion-system.js 解耦** ✓
   - 表情列表从config动态加载（不再硬编码5个表情）
   - `configureExpressions(expressions, durations, defaultDuration)`
   - per-expression独立时长
   - 无表情时emotion system不启动
   - 通过callback输出情绪名（`onEmotionTriggered`/`onEmotionReverted`），不直接发IPC

6. **Phase 1.6: preload.js 新增IPC通道** ✓
   - 新增: selectModelFolder, scanModelInfo, selectStaticImage, selectBubbleImage, selectAppIcon, copyModelToUserdata, validateModelPaths, deleteProfile
   - 新增事件: onModelConfigUpdate

7. **Phase 1.7: desktop-pet.html + pet-chat-bubble 解耦** ✓
   - `desktop-pet.html` — 完全通过ModelAdapter渲染，不再硬编码模型路径
   - 加载 `src/renderer/model-adapter.js`
   - `initModel()` 从config读取模型类型，创建对应adapter
   - 支持 `onModelConfigUpdate` 热重载
   - `pet-chat-bubble.js` — 支持自定义气泡框（从config.bubble.frameImagePath加载）

8. **Phase 1.5: Settings UI 重构** ✓
   - `index.html` — 4个tab: 设置/模型/表情/Prompt
   - `src/renderer/settings-ui.js` — 新建，所有UI逻辑
   - 模型tab: 模式选择(live2d/image/none), 导入按钮, 参数映射表(人类可读标签+下拉框), Canvas Y滑块, 底边对齐滑块, 气泡框选择, 图标选择
   - 表情tab: 动态列表UI, 添加/删除/编辑表情, per-expression时长, 默认时长

9. **Phase 1.8: 删除捆绑素材** ✓
   - `assets/L2D/pink-devil/` — 已删除
   - `desktop-pet-system.js` — 移除硬编码 `live2dModelPath`

10. **Phase 1.9: 测试** ✓
    - 67个测试全部通过，8个test suite:
      - AIChatClient (11 tests)
      - PetPromptBuilder (6 tests)
      - DesktopPetSystem (6 tests)
      - EmotionSystem (14 tests) — 含新的decoupled测试
      - PathUtils (9 tests)
      - ConfigSchema (5 tests)
      - ParamFuzzyMapping (5 tests)
      - ModelAdapter (9 tests)

### 启动时遇到的问题

- **已解决**: VSCode终端设置了 `ELECTRON_RUN_AS_NODE`，必须用 `node launch.js` 启动（不能直接 `npx electron .`）
- 用 `node launch.js` 启动成功，无报错

### 未测试/待验证

- ~~实际导入Live2D模型的完整流程~~ ✓ 已修复并验证
- 纯图片模式的GIF表情切换 — 不在本版本实现
- ~~气泡框自定义图片~~ ✓ 已验证可用
- 图标选择

### Phase 1 后续修复

1. **模型扫描修复** ✓
   - 参数提取：增加从 `.cdi3.json` (DisplayInfo) 读取完整参数列表，不再仅依赖 Groups.Ids
   - 表情扫描：model3.json 未声明表情时，自动扫描文件夹 `.exp3.json` 文件
   - 动作扫描：同理扫描 `.motion3.json`
   - 子目录支持：根目录找不到 model3.json 时自动搜索一层子目录（如 runtime/）
   - 参数自动映射：两个测试模型均能正确建议 AngleX/Y/Z、BodyAngleX、EyeBallX/Y

2. **表情播放链路修复** ✓
   - 接线：EmotionSystem 的 onEmotionTriggered/onEmotionReverted 回调连接到 IPC
   - 绕过 SDK：model3.json 未声明表情时 SDK 不创建 expression manager，改为自行 fetch .exp3.json 并手动操作参数
   - 重置：revert 时从 defaultValues 恢复受影响参数，避免表情残留

3. **Settings UI 改进** ✓
   - 参数映射下拉列表：建议项置顶并标 ★，其余按字母排序
   - 表情时长：UI 单位从毫秒改为秒（支持 0.5 步进），空值使用默认值
   - 默认时长输入框同步改为秒

### 当前状态

- Pink devil 模型：导入 ✓ | 参数映射 ✓ | 表情播放+恢复 ✓ | 气泡框 ✓
- Hiyori 模型：子目录扫描 ✓ | 参数映射 ✓ | 动作播放 ✓
- GIF/纯图片模式：不在本版本实现
- 待做：表情重命名功能（显示名用于 AI prompt，内部名用于 SDK）

### Phase 1.x: Motion 作为第二种表情 — 已完成 ✓

Hiyori 模型没有 .exp3.json 表情，但有 10 个 .motion3.json 动作。把 Motion 作为第二种"表情"接入情绪系统。

#### 验证状态

- Pink devil（只有表情，无动作）：表情播放 ✓
- Hiyori（只有动作，无表情）：动作播放 ✓
- 叠加场景（同时有表情+动作）：未验证，理论上互不冲突（表情操作静态参数，动作走 SDK 动画）

#### 实现细节

#### 设计要点

- 表情（Expression）：静态参数覆盖，手动 fetch .exp3.json，每帧 setParam，手动 revert
- 动作（Motion）：SDK 动画播放，model.motion(group, index)，自动结束
- 叠加：表情设静态参数 + 动作播 SDK 动画，操作不同参数互不冲突

#### Config 结构

```json
{
  "model": {
    "expressions": [...],           // 现有 - 静态表情
    "motionEmotions": [             // 新增 - 动作表情
      { "name": "开心弹动", "group": "Flick", "index": 0 },
      { "name": "点击反应", "group": "Tap", "index": 0 }
    ],
    "motionDurations": {},
    "defaultMotionDuration": 3000
  },
  "enabledEmotions": ["比心", "开心弹动"]  // 混合两种类型
}
```

#### 修改文件清单

| 文件 | 修改内容 |
|------|----------|
| `main.js` | scan-model-info 返回完整 motion 结构（group + files） |
| `index.html` | 表情 tab 增加动作列表区域 |
| `settings-ui.js` | renderMotionList + 保存逻辑 + 导入时自动填充 |
| `model-adapter.js` | playMotion(group, index) / stopMotion() |
| `emotion-system.js` | emotionItems 支持 type=expression/motion，新增 onMotionTriggered 回调 |
| `preload.js` | 新增 triggerMotion / onPlayMotion IPC |
| `desktop-pet.html` | 监听 play-motion 事件 |

#### IPC 链路

```
EmotionSystem._triggerEmotion()
  → type=expression: onEmotionTriggered(name)
  → type=motion: onMotionTriggered(group, index, name)
    ↓
settings-ui.js → IPC triggerMotion(group, index)
    ↓
main.js → petWindow.send('play-motion', group, index)
    ↓
desktop-pet.html → adapter.playMotion(group, index)
```

---

## Phase 2: TTS (VOICEVOX Core) — 核心已完成，增强待做

### 研究结果

#### 决策：Node.js FFI (koffi) 直调 voicevox_core.dll

- 无需 Python 依赖，体积最小 (~1.5GB with all VVM)
- 直接在 Electron main process 运行
- koffi 是纯 JS FFI 库，无需 node-gyp 编译

#### 已下载组件 (voicevox_core/ 目录，已 .gitignore)

```
voicevox_core/                          # ~1.5GB total, .gitignore'd
├── c_api/voicevox_core-windows-x64-0.16.3/
│   ├── include/voicevox_core.h         # C API 头文件
│   └── lib/voicevox_core.dll           # 6MB 核心库
├── voicevox_onnxruntime-win-x64-1.17.3/
│   └── lib/voicevox_onnxruntime.dll    # 12MB ONNX Runtime (CPU)
├── open_jtalk_dic_utf_8-1.11/          # 103MB 日语词典
└── models/                             # 25个 VVM 文件 (~1.4GB)
    ├── 0.vvm                           # 四国めたん, ずんだもん, 春日部つむぎ, 雨晴はう
    ├── 8.vvm                           # WhiteCUL
    ├── 1.vvm ~ 23.vvm                  # 其他角色
    └── n0.vvm                          # VOICEVOX Nemo
```

下载命令（重新获取时使用）：
```bash
gh release download 0.16.3 -R VOICEVOX/voicevox_core -p "voicevox_core-windows-x64-0.16.3.zip"
gh release download voicevox_onnxruntime-1.17.3 -R VOICEVOX/onnxruntime-builder -p "voicevox_onnxruntime-win-x64-1.17.3.tgz"
# VVM 文件 (按需下载)
for i in $(seq 0 23); do gh release download 0.16.3 -R VOICEVOX/voicevox_vvm -p "$i.vvm"; done
gh release download 0.16.3 -R VOICEVOX/voicevox_vvm -p "n0.vvm"
# Open JTalk 辞書
curl -L -o dict.tar.gz "https://sourceforge.net/projects/open-jtalk/files/Dictionary/open_jtalk_dic-1.11/open_jtalk_dic_utf_8-1.11.tar.gz/download"
```

### 已完成

1. **tts-service.js** — koffi FFI 封装 voicevox_core.dll ✓
   - init(voicevoxDir, vvmFiles): 加载 ONNX Runtime → Open JTalk → Synthesizer → 可配置 VVM
   - synthesize(text, styleId): audio_query + 参数调整 + synthesis → WAV Buffer
   - void** 指针管理: 避免 koffi 自动转换导致的双重释放
   - 熔断: 3次失败→降级，60s 后自动恢复
   - getMetas(): 从 synthesizer 动态获取角色/style 列表
   - getAvailableVvms(): 扫描 models 目录
   - 默认加载 0.vvm + 8.vvm，用户可配置

2. **translation-service.js** — 中→日翻译 ✓
   - 使用同一 OpenAI-compatible API
   - LRU 缓存 (50条)，失败时 fallback 到原文

3. **main.js** — TTS 初始化 + 5个 IPC handler ✓
   - tts-synthesize: 翻译 + 合成 → base64 WAV
   - tts-get-status / tts-set-config / tts-get-metas / tts-get-available-vvms
   - TTS 初始化用 setImmediate() 不阻塞窗口创建

4. **preload.js** — 5个 TTS IPC 通道 ✓

5. **Settings UI** ✓
   - 角色下拉框 + Style 下拉框（联动，从 VVM metas 动态填充）
   - 语速/音高/音量滑块 + 测试按钮
   - VVM 配置区：勾选框列表，每个 VVM 标注包含的角色名

6. **desktop-pet-system.js** — AI 回复后自动 TTS 播放 ✓

7. **path-utils.js** — getVoicevoxPath() 修复 ✓
   - dev: `<appPath>/voicevox_core`
   - prod: `<resourcesPath>/app.asar.unpacked/voicevox_core`

8. **测试**: 86 tests, 10 suites, all pass ✓

### 已验证

- DLL 加载: VOICEVOX Core v0.16.3 初始化成功 ✓
- 语音合成: 测试按钮播放正常 ✓
- 角色切换: 动态 metas 加载，style ID 正确 ✓
- VVM 配置: 可选加载，默认 2 个秒启动 ✓
- 放置模式自动语音: AI 回复后自动 TTS 播放 ✓
- 利用规约: 使用时需标注 "VOICEVOX:キャラ名"

### 待验证 (minor)

- 设置持久化: 切换角色/style → 保存 → 重启 → 还原
- VVM 配置重启: 勾选额外 VVM → 保存 → 重启 → 角色列表变化

### 已取消

- ✗ Expression→Style 映射（性能考虑，不做动态 style 切换）
- ✗ Python worker 方案（已用 koffi FFI 替代）
- ✗ Google Translate 后端（只用 LLM）
- ✗ electron-log（不需要）
- ✗ setup-voicevox.js 构建脚本（手动 gh CLI 下载）

### Phase 2 剩余计划 — 全部完成 ✓

#### 2.1 音频模式 & 状态机 ✓

三种模式优雅降级：TTS → 默认音声 → 静音

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/core/audio-state-machine.js` | 新建 | 状态: tts/default-audio/silent, 自动降级 |
| `desktop-pet-system.js` | 修改 | 用状态机决定播放方式, `_playAudio()` 分发 |
| `index.html` + `settings-ui.js` | 修改 | 音频模式选择 (radio), 保存到 config.tts.audioMode |

#### 2.2 默认音声系统 ✓

TTS 不可用时的 fallback 音效：
- 用户配置语气词列表（默认: えっと, うーん, へぇ, ふーん, あっ）
- 点击「生成」→ VOICEVOX 合成 → 保存 WAV 到 userData
- 启动时 preload 到内存，AI 回复时随机播放
- `main.js` 新增 IPC: generate-default-audio, load-default-audio
- `preload.js` 新增: generateDefaultAudio, loadDefaultAudio

#### 2.3 音频中断处理 ✓

新消息到达时停止当前音频：
- `desktop-pet-system.js`: `stopCurrentAudio()` 方法, 保存 Audio 引用 + ObjectURL, 新消息 → pause + revoke

#### 2.4 MessageSession 协调 ✓

统一协调 文字+表情+音频 的时序：
- `src/core/message-session.js` (~80行)
- LLM 回复 → 创建 Session → 并行翻译+情绪 → 就绪 → 统一触发
- 新 Session → cancel 旧 Session

#### 2.5 TTS 状态 UI 增强 ✓

- 「重启 TTS」按钮 + `tts-restart` IPC handler
- 状态显示: TTS就绪 (CPU/GPU) / 熔断中 (Ns 后自动重试) / 离线
- 熔断时显示重试倒计时

#### 2.6 GPU 加速 ✓

- DirectML 版: `voicevox_onnxruntime-win-x64-dml-1.17.3.tgz`
- 下载: `gh release download voicevox_onnxruntime-1.17.3 -R VOICEVOX/onnxruntime-builder -p "voicevox_onnxruntime-win-x64-dml-1.17.3.tgz"`
- C API: `VoicevoxInitializeOptions.acceleration_mode = 2` (GPU)
- `tts-service.js`: 自动检测 DirectML DLL, `init()` 接受 `{ gpuMode }` 选项
- 设置 UI: GPU 加速复选框, 保存到 config.tts.gpuMode, 需重启 TTS 生效
- VRAM 占用: 几百 MB 级别, 主要加速推理速度

#### 测试

107 tests, 12 suites, all pass


---

## Phase 3: 自定义图标 — 未开始

| 文件 | 类型 | 说明 |
|------|------|------|
| `scripts/convert-icon.js` | 新建 | PNG→ICO转换 |
| `main.js` | 修改 | BrowserWindow.setIcon() |
| `package.json` | 修改 | build.win.icon |

---

## 当前文件结构

```
live2dpet/
├── main.js                          # 主进程（已大改）
├── preload.js                       # IPC桥（已扩展）
├── index.html                       # 设置窗口（5 tabs）
├── desktop-pet.html                 # Pet窗口（ModelAdapter驱动）
├── pet-chat-bubble.html             # 气泡窗口
├── config.json                      # 新schema v1
├── launch.js                        # 启动脚本
├── package.json
├── assets/
│   ├── app-icon.png                 # 新增
│   ├── placeholder.svg              # 新增
│   ├── dialog-frame.png             # 保留
│   └── prompts/sister.json          # 保留
├── libs/                            # Live2D渲染引擎（保留）
├── src/
│   ├── core/
│   │   ├── ai-chat.js
│   │   ├── prompt-builder.js
│   │   ├── emotion-system.js        # 已解耦
│   │   ├── desktop-pet-system.js    # 已解耦 + 音频状态机 + MessageSession
│   │   ├── audio-state-machine.js   # 新建 - 三模式降级
│   │   ├── message-session.js       # 新建 - 文字+表情+音频协调
│   │   ├── tts-service.js           # VOICEVOX FFI + GPU 支持
│   │   └── translation-service.js   # 中→日翻译
│   ├── renderer/
│   │   ├── model-adapter.js         # 新建 - 策略模式
│   │   ├── settings-ui.js           # 新建 - 设置UI逻辑
│   │   └── pet-chat-bubble.js       # 已修改
│   └── utils/
│       └── path-utils.js            # 新建
├── voicevox_core/                       # .gitignore'd, ~177MB
└── tests/
    └── test-core.js                 # 107 tests, 12 suites, all pass
```

## Git 状态

Phase 2 剩余计划全部完成。待提交。

## 运行命令

```bash
# 启动应用
node launch.js

# 运行测试
node --test tests/test-core.js

# 注意：不要用 npx electron . （VSCode终端会因ELECTRON_RUN_AS_NODE报错）
```
