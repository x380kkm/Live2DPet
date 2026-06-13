// audience: internal
// # main
// 主进程组合根:按依赖序装配 platform 地基与 domain 角色层,经构造注入串起,挂 app 生命周期。
// 不变量:本文件只做装配与生命周期,不含业务逻辑;第三方类型只经 platform 工厂出现;
//         有状态子系统(记忆、语音后端)在退出前优雅关闭。

const electron = require('electron');
const { app } = electron;
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;

// platform 地基:存储、配置、总线
const { createPathUtils } = require('./src/platform/storage/path-utils');
const { FileRepository } = require('./src/platform/storage/file-repository');
const { ConfigStore } = require('./src/platform/config/config-store');
const { ScopeResolver, ResolvedScope } = require('./src/platform/config/layered-config');
const { MachineSettings } = require('./src/platform/config/machine-settings');
const { EventBus } = require('./src/platform/bus/event-bus');

// platform 地基:LLM、语音
const { LlmClient } = require('./src/platform/llm/llm-client');
const { cleanResponse } = require('./src/platform/llm/response-cleaner');
const { VoicevoxBackend } = require('./src/platform/speech/voicevox-backend');
const { CircuitBreaker } = require('./src/platform/speech/circuit-breaker');

// platform 地基:electron 工厂与 ipc
const windowFactory = require('./src/platform/electron/window-factory');
const trayFactory = require('./src/platform/electron/tray-factory');
const screenSource = require('./src/platform/electron/screen-source');
const channelRegistry = require('./src/platform/ipc/channel-registry');
const ipcRouter = require('./src/platform/ipc/ipc-router');
const capabilityGateway = require('./src/platform/ipc/capability-gateway');

// 配置字段加解密:平台外的纯函数,经构造注入进 config-store
const { encrypt, decrypt } = require('./src/main/crypto-utils');

// domain 角色层:意图、mod、感知、情绪、发言、tts、pet 编排
const { IntentRegistry } = require('./src/domain/intent/intent-registry');
const { builtinIntents } = require('./src/domain/intent/builtin-intents');
const { ModRegistry } = require('./src/domain/mod/mod-registry');
const { KeyframeBuffer } = require('./src/domain/perception/keyframe-buffer');
const { VlmExtractor } = require('./src/domain/perception/vlm-extractor');
const { MemoryStore } = require('./src/domain/perception/memory-store');
const { PerceptionSource } = require('./src/domain/perception/perception-source');
const { EmotionState } = require('./src/domain/emotion/emotion-state');
const { EmotionSelector } = require('./src/domain/emotion/emotion-selector');
const { TtsOrchestrator } = require('./src/domain/tts/tts-orchestrator');
const { UtteranceSession } = require('./src/domain/speech/utterance-session');
const { RequestPipeline } = require('./src/domain/pet/request-pipeline');
const { PetOrchestrator } = require('./src/domain/pet/pet');

//// 按依赖序装配 platform 地基,产出业务侧只见接口的能力集 [@busybee 2026-06-13] ////
// app 在 whenReady 后才能取路径与版本,故装配分两段:此段只建不依赖 app 的纯地基。
function assemblePlatform() {
  const eventBus = new EventBus();

  const pathUtils = createPathUtils(app, path);
  const repository = new FileRepository(pathUtils, fsPromises);
  const configStore = new ConfigStore(repository, { encrypt, decrypt });

  // 语音后端:熔断器包住连续失败降级,koffi 与第三方类型只在 voicevox-backend 出现
  const circuitBreaker = new CircuitBreaker({ maxFailures: 3, retryInterval: 60000, fallback: null });
  const speechBackend = new VoicevoxBackend({ koffi: require('koffi'), path, fs, circuitBreaker });

  return { eventBus, pathUtils, repository, configStore, circuitBreaker, speechBackend };
}
//// /按依赖序装配 platform 地基 ////

//// 用全局层配置造统一 LLM 客户端,供应商细节止于 llm-client [@busybee 2026-06-13] ////
// global 为已解密的全局层配置快照;fetch 与文本清理经 deps 注入,业务侧不见供应商 SDK。
function assembleLlmClient(global) {
  const config = {
    apiKey: global.apiKey,
    baseURL: global.baseURL || 'https://openrouter.ai/api/v1',
    model: global.modelName || 'x-ai/grok-4.1-fast',
    maxRetries: 1
  };
  return new LlmClient(config, { fetch: (...args) => fetch(...args), cleanResponse });
}
//// /用全局层配置造统一 LLM 客户端 ////

//// 按依赖序装配 domain 角色层,经构造注入串起感知到发言的编排 [@busybee 2026-06-13] ////
// platform 为已装配的地基;llmClient 为统一模型客户端。返回有状态子系统供生命周期优雅关闭。
function assembleDomain(platform, llmClient) {
  const { eventBus, repository, speechBackend } = platform;

  // 意图:出厂两条核心意图在加载期被发现注入
  const intentRegistry = new IntentRegistry();
  intentRegistry.discoverBuiltins(builtinIntents());

  // mod:仓储缺省给空列表,发现后两级启用合并
  const modRegistry = new ModRegistry({ source: { list: () => [] }, globalEnabled: [] });
  modRegistry.discover();

  // 感知:关键帧缓冲、态势抽取、记忆三件单一职责,折成一个命名上下文源
  const keyframeBuffer = new KeyframeBuffer();
  const vlmExtractor = new VlmExtractor({ llmClient, buffer: keyframeBuffer });
  const memoryStore = new MemoryStore({ repository });
  const perceptionSource = new PerceptionSource({ extractor: vlmExtractor, memoryStore });

  // 情绪:状态推进到阈值发事件,有界 LLM 选语义动作名,经事件总线对外
  const emotionState = new EmotionState(eventBus, {});
  const emotionSelector = new EmotionSelector(eventBus, llmClient, {});

  // 发言与 TTS:分句合成对齐,产物经事件总线发布,取消经显式令牌
  const ttsOrchestrator = new TtsOrchestrator({ speechBackend });
  const utteranceSession = new UtteranceSession({ eventBus, ttsOrchestrator });

  // 请求管线:上下文源注册表与提示词组装器经组合根注入,管线自身不抓全局
  const sourceRegistry = makeSourceRegistry([perceptionSource]);
  const pipeline = new RequestPipeline({
    sources: sourceRegistry,
    llmClient,
    promptComposer: makePromptComposer()
  });

  // pet 编排器:选意图、跑管线、把产物经事件总线发给表现层
  const pet = new PetOrchestrator({ pipeline, llmClient, eventBus });

  return {
    intentRegistry, modRegistry,
    keyframeBuffer, vlmExtractor, memoryStore, perceptionSource,
    emotionState, emotionSelector,
    ttsOrchestrator, utteranceSession,
    pipeline, pet
  };
}
//// /按依赖序装配 domain 角色层 ////

//// 按 id 取命名上下文源的注册表:管线据此把意图的源引用解析成实例 [@busybee 2026-06-13] ////
// sources 为已装配的上下文源数组;get 命中返回实例、未命中返回 null。
function makeSourceRegistry(sources) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return { get: (id) => byId.get(id) || null };
}
//// /按 id 取命名上下文源的注册表 ////

//// 把已组装上下文与意图拼成 LLM 请求的 messages,管线经它产出请求 [@busybee 2026-06-13] ////
// compose 收已组装上下文与意图,产出 { messages };只搭结构不内联成品措辞与人格文本。
function makePromptComposer() {
  return {
    compose(intent, context) {
      return {
        messages: [
          { role: 'system', content: '按给定上下文与意图产出一句角色发言。' },
          { role: 'user', content: context.text || '' }
        ]
      };
    }
  };
}
//// /把已组装上下文与意图拼成 LLM 请求 ////

//// 把屏幕、外发、文件等重能力的执行委托给 platform 工厂,经能力网关门控 [@busybee 2026-06-13] ////
// executor 按通道名分派到对应 platform 实现;网关在调用前过总闸与逐次确认,本函数不重复门控。
function makeCapabilityExecutor(deps) {
  return async function executor(capabilityId, payload) {
    switch (capabilityId) {
      case 'get-screen-capture':
        return screenSource.captureScreen({});
      case 'get-screen-capture-hq':
        return screenSource.captureScreen({ targetTitle: payload && payload.targetTitle, quality: 80 });
      case 'get-system-idle-time':
        return screenSource.idleTime();
      case 'open-external':
        return electron.shell.openExternal(payload && payload.url);
      default:
        return { success: false, error: `能力 ${capabilityId} 未提供执行器` };
    }
  };
}
//// /把重能力的执行委托给 platform 工厂 ////

//// 把契约目录里的每个通道经 ipc-router 注册,并桥接到 ipcMain.handle [@busybee 2026-06-13] ////
// 重能力域的通道经能力网关门控;其余无害控制通道直接走注入的处理器表。
function registerIpc(handlers, gatewayScope) {
  for (const channel of channelRegistry.channels()) {
    const domain = channelRegistry.capabilityDomainOf(channel);
    const gated = domain === channelRegistry.CapabilityDomain.screen
      || domain === channelRegistry.CapabilityDomain.outbound
      || domain === channelRegistry.CapabilityDomain.file;

    const handler = handlers[channel];
    if (gated) {
      // 重能力统一经网关 invoke,缺处理器时网关回执行器
      ipcRouter.register(channel, (payload) => capabilityGateway.invoke(channel, gatewayScope, payload));
    } else if (typeof handler === 'function') {
      ipcRouter.register(channel, handler);
    } else {
      // 无害控制通道暂无处理器时归一成可判定的未实现失败,而非裸抛
      ipcRouter.register(channel, () => ({ success: false, error: `通道 ${channel} 暂无处理器` }));
    }
  }

  // 经 electron 的 ipcMain 把每个通道桥到 ipc-router 的统一分发
  for (const channel of channelRegistry.channels()) {
    electron.ipcMain.handle(channel, (_event, ...args) => ipcRouter.dispatch(channel, args.length <= 1 ? args[0] : args));
  }
}
//// /把契约目录里的每个通道经 ipc-router 注册 ////

//// 装配主进程窗口与托盘的最小处理器表,均经 platform 工厂建第三方对象 [@busybee 2026-06-13] ////
// runtime 持有窗口句柄等可变状态;返回按通道名索引的无害控制处理器。
function makeWindowHandlers(runtime) {
  return {
    'create-pet-window': () => {
      if (windowFactory.isAlive(runtime.petWindow)) { runtime.petWindow.focus(); return { success: true }; }
      runtime.petWindow = windowFactory.createWindow({
        BrowserWindow: electron.BrowserWindow,
        width: 300, height: 300, frame: false, transparent: true, alwaysOnTop: true,
        resizable: true, skipTaskbar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
      });
      runtime.petWindow.setAlwaysOnTop(true, 'screen-saver');
      runtime.petWindow.loadFile(path.join(__dirname, 'desktop-pet.html'));
      runtime.petWindow.on('closed', () => { runtime.petWindow = null; });
      return { success: true };
    },
    'close-pet-window': () => { if (windowFactory.isAlive(runtime.petWindow)) runtime.petWindow.close(); return { success: true }; },
    'set-window-size': (args) => { if (windowFactory.isAlive(runtime.petWindow)) runtime.petWindow.setSize(args[0], args[1]); return { success: true }; },
    'set-window-position': (args) => {
      if (windowFactory.isAlive(runtime.petWindow)) {
        if (args[2] && args[3]) runtime.petWindow.setBounds({ x: args[0], y: args[1], width: args[2], height: args[3] });
        else runtime.petWindow.setPosition(args[0], args[1]);
      }
      return { success: true };
    },
    'get-window-bounds': () => windowFactory.isAlive(runtime.petWindow) ? runtime.petWindow.getBounds() : { x: 0, y: 0, width: 200, height: 200 },
    'get-window-position': () => windowFactory.isAlive(runtime.petWindow) ? runtime.petWindow.getPosition() : { x: 0, y: 0 },
    'show-settings': () => { if (windowFactory.isAlive(runtime.settingsWindow)) { runtime.settingsWindow.show(); runtime.settingsWindow.focus(); } return { success: true }; }
  };
}
//// /装配主进程窗口与托盘的最小处理器表 ////

// 主进程可变运行态:窗口句柄、托盘、退出标志,生命周期钩子据此协调
const runtime = {
  petWindow: null,
  settingsWindow: null,
  tray: null,
  isQuitting: false,
  platform: null,
  domain: null
};

//// 在 app 就绪后完成依赖 app 的装配,建窗与托盘,注册 IPC [@busybee 2026-06-13] ////
app.whenReady().then(async () => {
  const platform = assemblePlatform();
  runtime.platform = platform;

  // 读全局层配置,据此造 LLM 客户端并装配领域层
  const global = (await platform.configStore.read('global')) || {};
  const llmClient = assembleLlmClient(global);
  runtime.domain = assembleDomain(platform, llmClient);

  // 记忆生命周期由组合根显式驱动:启动时加载中期记忆
  await runtime.domain.memoryStore.load();

  // 能力网关装配协作者:执行器委托 platform 工厂,逐次确认默认放行
  capabilityGateway.configure({
    executor: makeCapabilityExecutor({ platform }),
    masterEnabled: () => true,
    confirm: () => true
  });

  // 注册 IPC:无害控制走窗口处理器表,重能力经网关
  const windowHandlers = makeWindowHandlers(runtime);
  registerIpc(windowHandlers, 'global');

  // 建设置窗口与托盘:第三方对象只经 platform 工厂创建
  runtime.settingsWindow = windowFactory.createWindow({
    BrowserWindow: electron.BrowserWindow,
    width: 480, height: 600, frame: true, resizable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
  });
  runtime.settingsWindow.loadFile(path.join(__dirname, 'index.html'));
  runtime.settingsWindow.on('close', (e) => {
    if (!runtime.isQuitting) { e.preventDefault(); runtime.settingsWindow.hide(); }
  });
  runtime.settingsWindow.on('closed', () => { runtime.settingsWindow = null; });

  runtime.tray = trayFactory.createTray({
    Tray: electron.Tray,
    Menu: electron.Menu,
    iconPath: path.join(__dirname, 'assets', 'app-icon.ico'),
    tooltip: 'Live2DPet',
    onClick: () => { if (windowFactory.isAlive(runtime.settingsWindow)) runtime.settingsWindow.show(); }
  });
  runtime.tray.setMenu([
    { label: 'Settings', click: () => { if (windowFactory.isAlive(runtime.settingsWindow)) runtime.settingsWindow.show(); } },
    { label: 'Quit', click: () => { runtime.isQuitting = true; app.quit(); } }
  ]);

  // TTS 后端初始化:有 voicevox_core 目录才启,缺失则保持禁用态
  initSpeechBackend(platform);
});
//// /在 app 就绪后完成依赖 app 的装配 ////

//// 在不阻塞就绪的前提下初始化语音后端,缺运行时文件则保持禁用 [@busybee 2026-06-13] ////
function initSpeechBackend(platform) {
  setImmediate(() => {
    const voicevoxDir = path.join(platform.pathUtils.userDataDir(), 'voicevox_core');
    const fallbackDir = path.join(__dirname, 'voicevox_core');
    const dir = fs.existsSync(voicevoxDir) ? voicevoxDir : (fs.existsSync(fallbackDir) ? fallbackDir : null);
    if (!dir) {
      console.log('[main] voicevox_core 未找到,语音禁用');
      return;
    }
    platform.speechBackend.init(dir, ['0.vvm', '8.vvm'], { gpuMode: false });
  });
}
//// /在不阻塞就绪的前提下初始化语音后端 ////

//// 全窗关闭时若无托盘常驻则退出,macOS 例外 [@busybee 2026-06-13] ////
app.on('window-all-closed', () => {
  if (runtime.tray) return;
  if (process.platform !== 'darwin') app.quit();
});

//// 退出前让有状态子系统优雅关闭:落盘记忆、释放语音后端句柄 [@busybee 2026-06-13] ////
app.on('before-quit', async (event) => {
  runtime.isQuitting = true;
  if (runtime._shutdownDone || !runtime.domain) return;

  event.preventDefault();
  try {
    await runtime.domain.memoryStore.flush();
  } catch (e) {
    console.error('[main] 记忆落盘失败:', e && e.message);
  }
  try {
    runtime.platform.speechBackend.dispose();
  } catch (e) {
    console.error('[main] 语音后端释放失败:', e && e.message);
  }
  runtime._shutdownDone = true;
  app.quit();
});
//// /退出前让有状态子系统优雅关闭 ////
