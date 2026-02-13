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

## Phase 2: TTS (VOICEVOX Core) — 未开始

### 待实现文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/core/translation-service.js` | 新建 | 双后端翻译(LLM/Google) |
| `src/core/tts-service.js` | 新建 | TTS管理+熔断 |
| `src/core/audio-state-machine.js` | 新建 | TTS→默认音声→静音 状态机 |
| `src/core/audio-text-sync.js` | 新建 | 整句显示+语音播放 |
| `src/core/message-session.js` | 新建 | 纯数据容器，统一协调 |
| `resources/voicevox/voicevox_worker.py` | 新建 | Python worker |
| `scripts/setup-voicevox.js` | 新建 | 下载构建脚本 |
| `main.js` | 修改 | Worker进程管理+TTS IPC |
| `preload.js` | 修改 | TTS IPC通道 |
| `src/core/desktop-pet-system.js` | 修改 | MessageSession管线 |
| `src/renderer/pet-chat-bubble.js` | 修改 | 音频播放 |
| `index.html` / `settings-ui.js` | 修改 | TTS设置tab |

### 关键设计要点

- 音频状态机: TTS → 默认音声 → 静音（优先级降级）
- 熔断: 连续3次TTS失败→降级，1分钟间隔重试
- Worker通信: 行分隔JSON（\n结尾+readline()）
- MessageSession: 纯数据容器，通过set方法注入
- expressionStyleMap: 表情→style_id映射
- 默认音声: 预生成语气词WAV，启动时preload到AudioBuffer
- ASAR: resources/voicevox 必须 asarUnpack

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
├── index.html                       # 设置窗口（4 tabs）
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
│   │   └── desktop-pet-system.js    # 已解耦
│   ├── renderer/
│   │   ├── model-adapter.js         # 新建 - 策略模式
│   │   ├── settings-ui.js           # 新建 - 设置UI逻辑
│   │   └── pet-chat-bubble.js       # 已修改
│   └── utils/
│       └── path-utils.js            # 新建
└── tests/
    └── test-core.js                 # 67 tests, 8 suites, all pass
```

## Git 状态

未提交。所有修改在工作区。运行 `git status` 查看完���列表。

## 运行命令

```bash
# 启动应用
node launch.js

# 运行测试
node --test tests/test-core.js

# 注意：不要用 npx electron . （VSCode终端会因ELECTRON_RUN_AS_NODE报错）
```
