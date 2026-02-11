# Live2D Desktop Pet - 开发进度

## 已完成

### Phase 1: Live2D 解耦

- Config Schema v1 + 自动迁移
- 模型导入: 文件夹选择 → model3.json 扫描 → 参数/表情/动作提取
- 参数模糊匹配: AngleX/Y/Z, BodyAngleX, EyeBallX/Y 自动建议
- ModelAdapter 策略模式: Live2DAdapter / ImageAdapter / NullAdapter
- 表情系统解耦: 动态配置, per-expression 时长, callback 输出
- Motion 作为第二种表情: expression(静态参数) + motion(SDK动画) 共存
- 模型扫描修复: .cdi3.json 参数提取, 子目录搜索, 自动表情/动作扫描
- 表情播放: 手动 fetch .exp3.json + setParam, revert 恢复默认值
- Settings UI: 4 tab (设置/模型/表情/Prompt), 参数映射下拉, 时长滑块

### Phase 2: TTS (VOICEVOX Core)

- koffi FFI 直调 voicevox_core.dll, 无 Python 依赖
- audio_query → 参数调整(语速/音高/音量) → synthesis → WAV
- 熔断机制: 3 次失败 → 降级 60s → 自动恢复
- 中→日翻译: LLM 翻译 + LRU 缓存(50条)
- 音频状态机: tts → default-audio → silent 三模式自动降级
- 默认音声: 语气词列表 → VOICEVOX 合成 → preload 到内存 → 随机播放
- MessageSession 协调: 两阶段流程
  - Phase 1: 并行 TTS 合成 + AI 情绪选择
  - Phase 2: 同步启动 气泡(duration=audioDur+buffer) + 播放 + 对齐表情
- 气泡时长 = max(音频时长 + 800ms, 3000ms), 字音同步
- 情绪值 >= 30 时触发对齐表情, 低于阈值保持独立计时
- 新 Session 自动 cancel 旧 Session (停音频 + forceRevert 表情)
- 气泡文字淡入动画 (0.4s ease-out, 0.15s delay)
- GPU 加速: DirectML 自动检测, acceleration_mode=2
- TTS 状态 UI: 重启按钮, 就绪/熔断(倒计时)/离线 状态显示
- Settings UI: 角色/Style 联动下拉, 语速/音高/音量滑块, VVM 勾选, GPU 复选框

### 测试

- 113 tests, 12 suites, all pass

## TODO

- [ ] 自定义图标: PNG→ICO 转换, BrowserWindow.setIcon()
- [ ] GIF/纯图片模式的表情切换
- [ ] 表情+动作叠加场景验证
- [ ] 表情重命名 (显示名 vs 内部名)
- [ ] TTS 设置持久化验证 (角色/style 切换 → 重启 → 还原)
- [ ] VVM 配置重启验证 (勾选额外 VVM → 重启 → 角色列表变化)
- [ ] 图标选择功能验证
- [ ] electron-builder 打包测试

## VOICEVOX 下载

```bash
# Core + ONNX Runtime (CPU)
gh release download 0.16.3 -R VOICEVOX/voicevox_core -p "voicevox_core-windows-x64-0.16.3.zip"
gh release download voicevox_onnxruntime-1.17.3 -R VOICEVOX/onnxruntime-builder -p "voicevox_onnxruntime-win-x64-1.17.3.tgz"

# GPU (DirectML) 版 ONNX Runtime
gh release download voicevox_onnxruntime-1.17.3 -R VOICEVOX/onnxruntime-builder -p "voicevox_onnxruntime-win-x64-dml-1.17.3.tgz"

# VVM 模型文件
for i in $(seq 0 23); do gh release download 0.16.3 -R VOICEVOX/voicevox_vvm -p "$i.vvm"; done

# Open JTalk 辞書
curl -L -o dict.tar.gz "https://sourceforge.net/projects/open-jtalk/files/Dictionary/open_jtalk_dic-1.11/open_jtalk_dic_utf_8-1.11.tar.gz/download"
```

## 运行

```bash
node launch.js          # 启动应用
node tests/test-core.js # 运行测试
# 注意: VSCode 终端不要用 npx electron . (ELECTRON_RUN_AS_NODE 冲突)
```
