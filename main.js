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
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const childProcess = require('child_process');

// platform 地基:存储、配置、总线
const { createPathUtils } = require('./src/platform/storage/path-utils');
const { FileRepository } = require('./src/platform/storage/file-repository');
const { ConfigStore } = require('./src/platform/config/config-store');
const { EventBus } = require('./src/platform/bus/event-bus');

// platform 地基:LLM、语音、翻译、语言
const { LlmClient } = require('./src/platform/llm/llm-client');
const { cleanResponse } = require('./src/platform/llm/response-cleaner');
const { TranslationService } = require('./src/platform/llm/translation-service');
const { VoicevoxBackend } = require('./src/platform/speech/voicevox-backend');
const { CircuitBreaker } = require('./src/platform/speech/circuit-breaker');
const { VoicevoxInstaller } = require('./src/platform/speech/voicevox-installer');
const { LanguageState } = require('./src/platform/config/language-state');

// platform 地基:electron 工厂、源与 ipc
const windowFactory = require('./src/platform/electron/window-factory');
const trayFactory = require('./src/platform/electron/tray-factory');
const screenSource = require('./src/platform/electron/screen-source');
const { createActiveWindowSource } = require('./src/platform/electron/active-window-source');
const { createSearchSource } = require('./src/platform/electron/search-source');
const channelRegistry = require('./src/platform/ipc/channel-registry');
const ipcRouter = require('./src/platform/ipc/ipc-router');
const capabilityGateway = require('./src/platform/ipc/capability-gateway');
const { registerAllHandlers, makeCapabilityExecutor } = require('./src/platform/ipc/handler-assembly');
const { registerUiHandlers } = require('./src/platform/ipc/handlers/ui-handlers');

// 配置字段加解密:平台外的纯函数,经构造注入进 config-store
const { encrypt, decrypt } = require('./src/main/crypto-utils');
const { isValidUUID } = require('./src/main/validators');
const I18N = require('./src/i18n/locales');

// domain 角色层:意图、mod、感知、情绪、发言、tts、提示词、上下文源、pet 编排
const { IntentRegistry } = require('./src/domain/intent/intent-registry');
const { builtinIntents } = require('./src/domain/intent/builtin-intents');
const { ModRegistry } = require('./src/domain/mod/mod-registry');
const { KeyframeBuffer } = require('./src/domain/perception/keyframe-buffer');
const { VlmExtractor } = require('./src/domain/perception/vlm-extractor');
const { MemoryStore } = require('./src/domain/perception/memory-store');
const { EmotionState } = require('./src/domain/emotion/emotion-state');
const { EmotionSelector } = require('./src/domain/emotion/emotion-selector');
const { TtsOrchestrator } = require('./src/domain/tts/tts-orchestrator');
const { UtteranceSession } = require('./src/domain/speech/utterance-session');
const { FewShotBank } = require('./src/domain/fewshot/fewshot-bank');
const { FewShotResolver } = require('./src/domain/fewshot/fewshot-resolver');
const { PromptComposer } = require('./src/domain/pet/prompt-composer');
const { RequestPipeline } = require('./src/domain/pet/request-pipeline');
const { PetOrchestrator } = require('./src/domain/pet/pet');
const { EmotionReaction } = require('./src/domain/pet/emotion-reaction');
const { PerceptionCollector } = require('./src/domain/pet/perception-collector');
const { PetScheduler } = require('./src/domain/pet/scheduler');
const { SituationDigestSource } = require('./src/domain/pet/sources/situation-digest-source');
const { VisualMemorySource } = require('./src/domain/pet/sources/visual-memory-source');
const { FocusInfoSource } = require('./src/domain/pet/sources/focus-info-source');
const { IdleInfoSource } = require('./src/domain/pet/sources/idle-info-source');
const { RecentRepliesSource } = require('./src/domain/pet/sources/recent-replies-source');
const { LayoutInfoSource } = require('./src/domain/pet/sources/layout-info-source');
const { PetPositionSource } = require('./src/domain/pet/sources/pet-position-source');
const { ToneHintSource } = require('./src/domain/pet/sources/tone-hint-source');

// 渲染侧向主进程推送进度的通道名:单向 send,不在 invoke 契约里,故直引字面量。
const VOICEVOX_PROGRESS_CHANNEL = 'voicevox-setup-progress';

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

  // 活动窗口与网络搜索源:第三方 active-win 与 http/https 类型止于各自源文件
  const activeWindow = createActiveWindowSource({});
  const searchSource = createSearchSource({ http, https });

  // 语音安装器:第三方进程调用(curl/tar/powershell)止于安装器,经注入的 runCommand 适配
  const voicevoxInstaller = new VoicevoxInstaller({ fs, path, runCommand });

  return {
    eventBus, pathUtils, repository, configStore, circuitBreaker, speechBackend,
    activeWindow, searchSource, voicevoxInstaller
  };
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
// platform 为已装配的地基;llmClient 为统一模型客户端;global 为全局层配置快照(取人格)。
// providers 携带六个上下文源的取数函数与标题压缩、略过判定;languageState 给上下文源的成品措辞。
// 返回有状态子系统与上下文源、连接件供生命周期与事件订阅使用。
function assembleDomain(platform, llmClient, global, providers, languageState) {
  const { eventBus, repository, speechBackend } = platform;

  // 意图:出厂两条核心意图在加载期被发现注入
  const intentRegistry = new IntentRegistry();
  intentRegistry.discoverBuiltins(builtinIntents());

  // mod:仓储缺省给空列表,发现后两级启用合并
  const modRegistry = new ModRegistry({ source: { list: () => [] }, globalEnabled: [] });
  modRegistry.discover();

  // 感知:关键帧缓冲、态势抽取、记忆三件单一职责
  const keyframeBuffer = new KeyframeBuffer();
  const vlmExtractor = new VlmExtractor({ llmClient, buffer: keyframeBuffer });
  const memoryStore = new MemoryStore({ repository });

  // 情绪:状态推进到阈值发事件,有界 LLM 选语义动作名,经事件总线对外
  const emotionState = new EmotionState(eventBus, {});
  const emotionSelector = new EmotionSelector(eventBus, llmClient, { enabledNames: global.enabledEmotions || [] });
  // 情绪连接件:订阅发言产物,把刚说出的话喂给情绪选择器
  const emotionReaction = new EmotionReaction({ eventBus, emotionSelector });

  // 发言与 TTS:分句合成对齐,产物经事件总线发布,取消经显式令牌
  const ttsOrchestrator = new TtsOrchestrator({ speechBackend });
  const utteranceSession = new UtteranceSession({ eventBus, ttsOrchestrator });

  // 感知采集连接件:每帧投帧、选关键帧、抽态势、落记忆
  const perceptionCollector = new PerceptionCollector({ buffer: keyframeBuffer, extractor: vlmExtractor, memoryStore });

  // 命名上下文源:各以意图引用名为 id,注册进管线据 ref 解析
  const contextSources = assembleContextSources({ vlmExtractor, memoryStore, providers, languageState });

  // 提示词组装器:接 few-shot 解析器与角色人格,按预算裁样例组装请求
  const promptComposer = assemblePromptComposer(global);

  // 请求管线:上下文源注册表与提示词组装器经组合根注入,管线自身不抓全局
  const sourceRegistry = makeSourceRegistry(contextSources);
  const pipeline = new RequestPipeline({ sources: sourceRegistry, llmClient, promptComposer });

  // pet 编排器:选意图、跑管线、把产物经事件总线发给表现层
  const pet = new PetOrchestrator({ pipeline, llmClient, eventBus });

  return {
    intentRegistry, modRegistry,
    keyframeBuffer, vlmExtractor, memoryStore, perceptionCollector,
    emotionState, emotionSelector, emotionReaction,
    ttsOrchestrator, utteranceSession,
    contextSources, promptComposer, pipeline, pet
  };
}
//// /按依赖序装配 domain 角色层 ////

//// 装配八个命名上下文源,各以意图引用名为 id,缺数据时 render 返回 null 由组装器跳过 [@busybee 2026-06-13] ////
// situationDigest 与 visualMemory 接感知抽取器与记忆;focusInfo/idleInfo/recentReplies/layoutInfo/
// petPosition 接 providers 里的取数函数;成品措辞由 languageState 在装配期按当前语言注入。
// toneHint 暂无下一句情绪的数据源,provider 留空时其 render 返回 null,先接好类型,数据源后续补。
function assembleContextSources(deps) {
  const { vlmExtractor, memoryStore, providers = {}, languageState } = deps;
  const mt = (key) => (languageState ? languageState.mt(key) : key);
  return [
    new SituationDigestSource({ extractor: vlmExtractor }),
    new VisualMemorySource({ memoryStore }),
    new FocusInfoSource(
      { focusProvider: providers.focusTracker, shortenTitle: providers.shortenTitle },
      { label: mt('sys.windowUsage'), secondsUnit: mt('sys.seconds') }
    ),
    new IdleInfoSource(
      { idleProvider: providers.idleSeconds },
      { labelTemplate: mt('sys.userIdle') }
    ),
    new RecentRepliesSource(
      { recentRepliesProvider: providers.recentReplies },
      { labels: antiRepetitionLabels(mt) }
    ),
    new LayoutInfoSource(
      { windowsProvider: providers.openWindows, shouldSkipApp: providers.shouldSkipApp, shortenTitle: providers.shortenTitle },
      { label: mt('sys.windowLayout') }
    ),
    new PetPositionSource(
      { boundsProvider: providers.petBounds },
      { labelTemplate: mt('sys.petPosition') }
    ),
    new ToneHintSource(
      { toneProvider: providers.nextEmotion },
      { labelTemplate: mt('sys.toneHint') }
    )
  ];
}
//// /装配八个命名上下文源 ////

//// 把反重复源的外壳与各模式名按当前语言取出,组成其标签集 [@busybee 2026-06-13] ////
// recentReplies 源的 render 用 shell 外壳套 {0},各模式名是命中重复时填入的措辞,分隔符固定顿号。
function antiRepetitionLabels(mt) {
  return {
    shell: mt('sys.antiRepetition'),
    separator: '、',
    question: mt('sys.patternQuestion'),
    opening: mt('sys.patternOpening'),
    ending: mt('sys.patternEnding'),
    length: mt('sys.patternLength'),
    exclamation: mt('sys.patternExclamation'),
    ellipsis: mt('sys.patternEllipsis')
  };
}
//// /把反重复源的外壳与各模式名按当前语言取出 ////

//// 装配提示词组装器:few-shot 银行与解析器加角色人格 [@busybee 2026-06-13] ////
// 银行暂无样例入库(磁盘 fewshot 目录为空),解析器对空引用返回空轮次;人格取自激活角色卡的 data。
function assemblePromptComposer(global) {
  const bank = new FewShotBank();
  const fewShotResolver = new FewShotResolver(bank);
  const persona = (global.activeCard && global.activeCard.data) || {};
  return new PromptComposer({ fewShotResolver, persona });
}
//// /装配提示词组装器 ////

//// 按 id 取命名上下文源的注册表:管线据此把意图的源引用解析成实例 [@busybee 2026-06-13] ////
// sources 为已装配的上下文源数组;get 命中返回实例、未命中返回 null。
function makeSourceRegistry(sources) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return { get: (id) => byId.get(id) || null };
}
//// /按 id 取命名上下文源的注册表 ////

// 略过自身窗口的应用名片段:这些名字命中即不计入焦点统计与布局摘要。
const SKIP_APP_FRAGMENTS = ['desktop-pet', 'electron', 'live2dpet'];
// 窗口标题压短的默认长度上限,超出截断并补省略号。
const TITLE_MAX_LEN = 30;

//// 装配感知运行态:给调度器一个 capture() 取帧,并维护六个上下文源的取数缓存 [@busybee 2026-06-13] ////
// 上下文源的 render 是同步的,而活动窗口、空闲秒数、开窗列表都需异步取;故在每拍异步的 capture()
// 里刷新这些缓存,provider 同步读缓存。capture 截主屏产 base64 JPEG 帧,并据当前活动窗口累计焦点秒数。
// 迁移自 desktop-pet-system 的 focusTick 焦点累计与 shouldSkipApp/_shortenTitle。
function makePerceptionRuntime(deps) {
  const { screenSource, activeWindow, getPetBounds } = deps;

  // 各 provider 的同步缓存:capture 每拍异步刷新,render 同步读取。
  const state = {
    idleSeconds: 0,
    openWindows: [],
    // 窗口键到累计停留秒数的映射,焦点统计用。
    focusTracker: {},
    // 最近若干条发言文本,反重复源用;由组合根订阅发言产物事件喂入。
    recentReplies: []
  };

  //// 截主屏产 base64 JPEG 帧,顺带刷新空闲、开窗与焦点缓存;失败回 null [@busybee 2026-06-13] ////
  async function capture() {
    await refreshCaches();
    const image = await screenSource.captureScreen({});
    if (!image) {
      return null;
    }
    return { image, title: activeTitle(), background: null };
  }

  //// 异步刷新三类缓存:空闲秒数、开窗列表、当前活动窗口的焦点累计 [@busybee 2026-06-13] ////
  // 任一查询失败只跳过该项,不抛进调度器单拍;焦点按拍累加,粒度即调度间隔秒数。
  async function refreshCaches() {
    try { state.idleSeconds = screenSource.idleTime(); } catch {}
    try {
      const result = await activeWindow.openWindows();
      if (result && result.success && Array.isArray(result.data)) {
        state.openWindows = result.data;
      }
    } catch {}
    await accumulateFocus();
  }

  //// 取当前活动窗口,非略过应用则把其停留秒数按调度间隔累加进焦点统计 [@busybee 2026-06-13] ////
  async function accumulateFocus() {
    try {
      const result = await activeWindow.current();
      const data = result && result.success ? result.data : null;
      const owner = data && data.owner && data.owner.name;
      if (!owner || shouldSkipApp(owner)) {
        return;
      }
      const key = data.title || owner;
      const seconds = Math.max(1, Math.round((SCHEDULER_INTERVAL_MS / 1000)));
      state.focusTracker[key] = (state.focusTracker[key] || 0) + seconds;
      _activeTitle = data.title || owner;
    } catch {}
  }

  // 最近一次累计到的活动窗口标题,作帧的窗口标题透传给抽取器。
  let _activeTitle = '';
  function activeTitle() {
    return _activeTitle;
  }

  // 六个上下文源的同步取数函数与两个文本助手,缺数据时各自回空由源跳过。
  const providers = {
    focusTracker: () => state.focusTracker,
    idleSeconds: () => state.idleSeconds,
    recentReplies: () => state.recentReplies,
    openWindows: () => state.openWindows,
    petBounds: () => (typeof getPetBounds === 'function' ? getPetBounds() : null),
    // toneHint 暂无下一句情绪的数据源,留空 provider 使其 render 返回 null。
    nextEmotion: null,
    shouldSkipApp,
    shortenTitle
  };

  //// 记一条刚说出的发言,只留最近若干条供反重复源检测 [@busybee 2026-06-13] ////
  function recordReply(text) {
    if (!text) {
      return;
    }
    state.recentReplies.push(text);
    while (state.recentReplies.length > RECENT_REPLIES_KEEP) {
      state.recentReplies.shift();
    }
  }

  return { perception: { capture }, providers, recordReply };
}
//// /装配感知运行态 ////

// 调度间隔:每拍采一次感知,焦点统计按此粒度累加秒数。
const SCHEDULER_INTERVAL_MS = 15000;
// 反重复源保留的最近发言条数上限。
const RECENT_REPLIES_KEEP = 8;

//// 判一个应用名是否略过:命中略过片段即不计入焦点与布局,迁移自 desktop-pet-system [@busybee 2026-06-13] ////
function shouldSkipApp(appName) {
  if (!appName) {
    return true;
  }
  const lower = appName.toLowerCase();
  return SKIP_APP_FRAGMENTS.some((fragment) => lower.includes(fragment));
}
//// /判一个应用名是否略过 ////

//// 把窗口标题压短:剥常见浏览器与编辑器后缀再截断,迁移自 desktop-pet-system [@busybee 2026-06-13] ////
function shortenTitle(title) {
  if (!title) {
    return '';
  }
  let short = title.replace(/\s*[-–—]\s*(?:Google Chrome|Microsoft\s*Edge|Firefox|Brave|Opera|Safari|Cursor|Visual Studio Code|VSCode|Code)$/i, '');
  if (short.length > TITLE_MAX_LEN) {
    short = short.slice(0, TITLE_MAX_LEN) + '…';
  }
  return short;
}
//// /把窗口标题压短 ////

//// 把领域事件经 IPC 转发到渲染窗口:发言进气泡与说话态、选定情绪进表情 [@busybee 2026-06-13] ////
// 情绪连接件订阅发言产物已在 domain 装配;此处补两条把领域事件桥到宠物窗口的转发,死窗口由总线过滤。
function subscribeRenderForwarders(eventBus, getPetWindow) {
  // 发言产物:文本进舞台气泡,并把说话态切到开,供图片帧与表情联动
  eventBus.subscribe('UtteranceProduced', (event) => {
    const win = getPetWindow();
    const text = spokenTextOf(event);
    if (!win || !text) return;
    win.webContents.send('show-chat-message', { message: text, autoCloseTime: event.bubbleDurationMs || 8000 });
    win.webContents.send('talking-state-changed', true);
  }, () => ipcRouter.isAlive(getPetWindow()));

  // 发言结束:把说话态切回关
  eventBus.subscribe('UtteranceEnded', () => {
    const win = getPetWindow();
    if (win) win.webContents.send('talking-state-changed', false);
  }, () => ipcRouter.isAlive(getPetWindow()));

  // 选定情绪:非空名转成播放表情,空名留给渲染层自行回退
  eventBus.subscribe('EmotionSelected', (event) => {
    const win = getPetWindow();
    if (!win || !event.name) return;
    win.webContents.send('play-expression', event.name);
  }, () => ipcRouter.isAlive(getPetWindow()));
}
//// /把领域事件经 IPC 转发到渲染窗口 ////

//// 从两种发言产物载荷里取出刚说出的话 [@busybee 2026-06-13] ////
// utterance-session 发 { utterance:{ text } };pet 编排器发 { text }。
function spokenTextOf(event) {
  if (!event) return '';
  if (event.utterance && event.utterance.text) return event.utterance.text;
  return event.text || '';
}
//// /从两种发言产物载荷里取出刚说出的话 ////

//// 把契约目录里仍未被处理器模块注册的通道补齐:窗口控制走窗口表,其余归一成可判定失败 [@busybee 2026-06-13] ////
// 处理器模块已注册角色、模型、TTS、音频、感知、情绪、工具诸通道;此处只补窗口控制与尚无处理器的通道,
// 再把每个通道桥到 electron 的 ipcMain.handle。register 重复会抛错,故先判定通道是否已注册。
function registerRemainingIpc(handlers) {
  for (const channel of channelRegistry.channels()) {
    if (ipcRouter.isRegistered(channel)) continue;
    const handler = handlers[channel];
    if (typeof handler === 'function') {
      ipcRouter.register(channel, handler);
    } else {
      // 尚无处理器的控制通道归一成可判定的未实现失败,而非裸抛
      ipcRouter.register(channel, () => ({ success: false, error: `通道 ${channel} 暂无处理器` }));
    }
  }

  // 经 electron 的 ipcMain 把每个通道桥到 ipc-router 的统一分发
  for (const channel of channelRegistry.channels()) {
    electron.ipcMain.handle(channel, (_event, ...args) => ipcRouter.dispatch(channel, args.length <= 1 ? args[0] : args));
  }
}
//// /把契约目录里仍未被处理器模块注册的通道补齐 ////

//// 装配主进程窗口控制的处理器表,均经 platform 工厂建第三方对象 [@busybee 2026-06-13] ////
// runtime 持有窗口句柄等可变状态;返回按通道名索引的无害 UI 控制处理器。
function makeWindowHandlers(runtime) {
  return {
    'create-pet-window': () => { ensurePetWindow(runtime); return { success: true }; },
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
    'get-cursor-position': () => electron.screen.getCursorScreenPoint(),
    'show-settings': () => { if (windowFactory.isAlive(runtime.settingsWindow)) { runtime.settingsWindow.show(); runtime.settingsWindow.focus(); } return { success: true }; }
  };
}
//// /装配主进程窗口控制的处理器表 ////

//// 装配展示与交互处理器所需的窄接口:取窗口句柄、菜单弹出器、存活判断与翻译 [@busybee 2026-06-13] ////
// ui-handlers 经窗口工厂句柄的 send/setSize/openDevTools/close/show/focus 转发,故这里给工厂句柄而非裸窗口;
// menuPopup 由 tray-factory 用 electron.Menu 造,Menu 第三方类型止于工厂;角色数据初值取激活卡的 data。
function makeUiHandlerDeps(runtime, global) {
  return {
    router: ipcRouter,
    getPetWindow: () => runtime.petWindow,
    getSettingsWindow: () => runtime.settingsWindow,
    createSettingsWindow: () => { if (windowFactory.isAlive(runtime.settingsWindow)) { runtime.settingsWindow.show(); runtime.settingsWindow.focus(); } },
    menuPopup: trayFactory.createMenuPopup({ Menu: electron.Menu }),
    isAlive: (window) => windowFactory.isAlive(window),
    mt,
    initialCharacterData: (global.activeCard && global.activeCard.data) || {}
  };
}
//// /装配展示与交互处理器所需的窄接口 ////

//// 建桌宠主窗口加载 desktop-pet.html,已在则聚焦 [@busybee 2026-06-13] ////
// 透明无边覆盖窗,置顶到屏保层,关闭时清空句柄;窗口经 platform 工厂创建,第三方类型不外泄。
function ensurePetWindow(runtime) {
  if (windowFactory.isAlive(runtime.petWindow)) { runtime.petWindow.focus(); return runtime.petWindow; }
  runtime.petWindow = windowFactory.createWindow({
    BrowserWindow: electron.BrowserWindow,
    width: 300, height: 300, frame: false, transparent: true, alwaysOnTop: true,
    resizable: true, skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') }
  });
  runtime.petWindow.setAlwaysOnTop(true, 'screen-saver');
  runtime.petWindow.loadFile(path.join(__dirname, 'desktop-pet.html'));
  runtime.petWindow.on('closed', () => { runtime.petWindow = null; });
  return runtime.petWindow;
}
//// /建桌宠主窗口加载 desktop-pet.html ////

//// 包 child_process.execFile 成安装器期待的 runCommand:成功 resolve、失败 reject [@busybee 2026-06-13] ////
// 第三方进程调用在此一处适配;安装器只见 (cmd, args, options) => Promise 这一窄接口。
function runCommand(cmd, args, options) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(cmd, args, { timeout: (options && options.timeout) || 120000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}
//// /包 child_process.execFile 成 runCommand ////

// 当前界面语言的显式载体:替代旧 i18n-helper 读全局缓存的隐式做法,语言据全局配置在就绪期设定。
const languageState = new LanguageState({ table: I18N });

//// 取一个翻译串:据当前语言查表,未命中逐级回退,迁移自 i18n-helper [@busybee 2026-06-13] ////
function mt(key) {
  return languageState.mt(key);
}
//// /取一个翻译串 ////

// 主进程可变运行态:窗口句柄、托盘、退出标志,生命周期钩子据此协调
const runtime = {
  petWindow: null,
  settingsWindow: null,
  tray: null,
  isQuitting: false,
  platform: null,
  domain: null,
  scheduler: null
};

//// 在 app 就绪后完成依赖 app 的装配,建窗与托盘,注册 IPC [@busybee 2026-06-13] ////
app.whenReady().then(async () => {
  const platform = assemblePlatform();
  runtime.platform = platform;

  // 读全局层配置,把激活角色卡的人格并进快照;界面语言据配置设定,据此造 LLM 客户端
  const global = (await platform.configStore.read('global')) || {};
  global.activeCard = await loadActiveCard(platform, global);
  languageState.set(global.language || global.lang);
  const llmClient = assembleLlmClient(global);

  // 翻译服务:复用统一 LLM 客户端中译日,供 TTS 合成前注入;无 koffi/客户端时原样返回
  runtime.translationService = new TranslationService({ llmClient });

  // 感知运行态:给调度器 capture() 取帧,并喂六个上下文源的取数缓存(petPosition 取宠物窗口边界)
  const perceptionRuntime = makePerceptionRuntime({
    screenSource, activeWindow: platform.activeWindow,
    getPetBounds: () => petBounds(runtime)
  });
  runtime.perceptionRuntime = perceptionRuntime;

  // 装配领域层:把感知运行态的取数函数与当前语言交给上下文源
  runtime.domain = assembleDomain(platform, llmClient, global, perceptionRuntime.providers, languageState);

  // 记忆生命周期由组合根显式驱动:启动时加载中期记忆
  await runtime.domain.memoryStore.load();

  // 情绪连接件订阅发言产物;领域事件经 IPC 转发到宠物窗口
  runtime.domain.emotionReaction.start();
  subscribeRenderForwarders(platform.eventBus, () => petWindowRaw(runtime));

  // 发言产物喂反重复源:每条刚说出的话记入近期回复缓存
  platform.eventBus.subscribe('UtteranceProduced', (event) => perceptionRuntime.recordReply(spokenTextOf(event)));

  // 能力网关装配协作者:执行器组合屏幕与外发文件两域,逐次确认默认放行
  capabilityGateway.configure({
    executor: makeCapabilityExecutor({
      screenSource, activeWindow: platform.activeWindow,
      shell: electron.shell, searchSource: platform.searchSource,
      enhanceStore: makeEnhanceStore(platform), isValidUrl: isValidHttpUrl
    }),
    masterEnabled: () => true,
    confirm: () => true
  });

  // 注册全部 IPC 处理器;展示与交互通道单列,经 ui-handlers 注册以替换占位失败
  const assembled = registerAllHandlers(ipcRouter, capabilityGateway, makeHandlerDeps(platform, global));
  registerUiHandlers(makeUiHandlerDeps(runtime, global));
  // 再补齐窗口控制与仍无处理器的通道;UI 通道已注册,registerRemainingIpc 据 isRegistered 跳过
  registerRemainingIpc(makeWindowHandlers(runtime));

  // 设置窗口与托盘:第三方对象只经 platform 工厂创建
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

  // 建桌宠主窗口加载 desktop-pet.html
  ensurePetWindow(runtime);

  // 主循环调度器:按间隔反复采感知、取候选、选意图、跑意图,并按需喂情绪;经感知运行态与领域层注入
  const domain = runtime.domain;
  runtime.scheduler = new PetScheduler(
    {
      perception: perceptionRuntime.perception,
      collector: domain.perceptionCollector,
      registry: domain.intentRegistry,
      pet: domain.pet,
      emotionState: domain.emotionState
    },
    { intervalMs: SCHEDULER_INTERVAL_MS, chatGapMs: SCHEDULER_INTERVAL_MS }
  );
  runtime.scheduler.start();

  // 内置卡迁移与语音后端初始化:不阻塞就绪
  setImmediate(() => { assembled.migrateBundledCards().catch((e) => console.error('[main] 内置卡迁移失败:', e && e.message)); });
  initSpeechBackend(platform);
});
//// /在 app 就绪后完成依赖 app 的装配 ////

//// 读激活角色卡:从 assets/prompts 下按激活 id 取卡,缺失返回空 [@busybee 2026-06-13] ////
// 人格只读卡的 data 段;卡文件先查用户数据目录,缺省回退到内置卡目录。
async function loadActiveCard(platform, global) {
  const id = global.activeCharacterId;
  if (!id || !isValidUUID(id)) return null;
  const userPath = path.join(platform.pathUtils.userDataDir(), 'characters', `${id}.json`);
  const bundledPath = path.join(__dirname, 'assets', 'prompts', `${id}.json`);
  const file = fs.existsSync(userPath) ? userPath : (fs.existsSync(bundledPath) ? bundledPath : null);
  if (!file) return null;
  try { return JSON.parse(await fsPromises.readFile(file, 'utf-8')); }
  catch { return null; }
}
//// /读激活角色卡 ////

//// 装配 IPC 处理器所需的全部窄接口与门面,交给处理器装配模块 [@busybee 2026-06-13] ////
// 第三方门面(fs、path、dialog、shell、app)在此就地注入;窗口取值返回裸 BrowserWindow 供转发判存活。
function makeHandlerDeps(platform, global) {
  return {
    configStore: platform.configStore,
    eventBus: platform.eventBus,
    speechBackend: platform.speechBackend,
    ttsOrchestrator: runtime.domain.ttsOrchestrator,
    voicevoxInstaller: platform.voicevoxInstaller,
    screenSource,
    paths: platform.pathUtils,
    fs, path, mt,
    // 角色卡存储与内置卡源
    cardStore: makeCardStore(platform),
    bundledCards: makeBundledCards(platform, global),
    newId: () => crypto.randomUUID(),
    chooseCharacterFiles: () => chooseFiles({ filters: [{ name: 'JSON', extensions: ['json'] }] }),
    // 模型文件选择与文件系统窄接口
    picker: makePicker(),
    files: makeFilesFacade(),
    // 工具与增强数据
    appInfo: { appPath: () => app.getAppPath() },
    enhanceStore: makeEnhanceStore(platform),
    logSink: { write: (level, args) => console[level === 'error' ? 'error' : 'log']('[renderer]', ...(args || [])) },
    // 语音安装与配置目录、重启、进度
    resolveVoicevoxDir: () => resolveVoicevoxDir(platform),
    resolveDefaultAudioDir: () => path.join(platform.pathUtils.userDataDir(), 'default-audio'),
    notifyVoicevoxProgress: (progress) => { const w = petWindowRaw(runtime); if (w) w.webContents.send(VOICEVOX_PROGRESS_CHANNEL, progress); },
    relaunch: () => { app.relaunch(); app.exit(0); },
    // 中译日翻译:TTS 处理器据此把回复译为日语再合成,服务未就绪时原样返回
    translate: (text) => runtime.translationService.translate(text),
    // 转发窗口取值:返回裸 BrowserWindow,死窗口转发判定据其 isDestroyed
    petWindowRaw: () => petWindowRaw(runtime),
    settingsWindowRaw: () => settingsWindowRaw(runtime)
  };
}
//// /装配 IPC 处理器所需的全部窄接口与门面 ////

//// 角色卡文件存储窄接口:卡文件落在用户数据目录的 characters 下,异步读写 [@busybee 2026-06-13] ////
function makeCardStore(platform) {
  const dir = () => path.join(platform.pathUtils.userDataDir(), 'characters');
  const file = (id) => path.join(dir(), `${id}.json`);
  return {
    async get(id) {
      try { return JSON.parse(await fsPromises.readFile(file(id), 'utf-8')); }
      catch { return null; }
    },
    async put(id, data) {
      await fsPromises.mkdir(dir(), { recursive: true });
      await fsPromises.writeFile(file(id), JSON.stringify(data, null, 2), 'utf-8');
    },
    async remove(id) { try { await fsPromises.unlink(file(id)); } catch {} },
    async exists(id) { try { await fsPromises.access(file(id)); return true; } catch { return false; } },
    async listIds() {
      try {
        const names = await fsPromises.readdir(dir());
        return names.filter((n) => n.endsWith('.json')).map((n) => n.replace('.json', ''));
      } catch { return []; }
    }
  };
}
//// /角色卡文件存储窄接口 ////

//// 内置卡源:从 assets/prompts 读出厂卡,版本经用户数据目录里的标记文件记 [@busybee 2026-06-13] ////
function makeBundledCards(platform, global) {
  const promptsDir = path.join(__dirname, 'assets', 'prompts');
  const versionFile = path.join(platform.pathUtils.userDataDir(), 'bundled-cards-version.txt');
  return {
    async isPackaged() { return platform.pathUtils.isPackaged; },
    async currentVersion() { return String(global.configVersion || app.getVersion()); },
    async readVersion() { try { return (await fsPromises.readFile(versionFile, 'utf-8')).trim(); } catch { return ''; } },
    async writeVersion(v) {
      await fsPromises.mkdir(path.dirname(versionFile), { recursive: true });
      await fsPromises.writeFile(versionFile, String(v), 'utf-8');
    },
    async listNames() {
      try { return (await fsPromises.readdir(promptsDir)).filter((n) => n.endsWith('.json')); }
      catch { return []; }
    },
    async read(name) { return JSON.parse(await fsPromises.readFile(path.join(promptsDir, name), 'utf-8')); }
  };
}
//// /内置卡源 ////

//// 文件选择框窄接口:包 electron.dialog 的目录与文件选择,产出平直 { canceled, paths } [@busybee 2026-06-13] ////
function makePicker() {
  return {
    async pickDirectory(opts) {
      return electron.dialog.showOpenDialog({ title: opts && opts.title, properties: ['openDirectory'] });
    },
    async pickFile(opts) {
      return electron.dialog.showOpenDialog({ title: opts && opts.title, filters: opts && opts.filters, properties: ['openFile'] });
    }
  };
}
//// /文件选择框窄接口 ////

//// 选若干文件并读出其文本内容:供角色卡导入,取消返回空数组 [@busybee 2026-06-13] ////
async function chooseFiles(opts) {
  const result = await electron.dialog.showOpenDialog({ filters: opts && opts.filters, properties: ['openFile', 'multiSelections'] });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) return [];
  const texts = [];
  for (const p of result.filePaths) {
    try { texts.push(await fsPromises.readFile(p, 'utf-8')); } catch {}
  }
  return texts;
}
//// /选若干文件并读出其文本内容 ////

//// 文件系统门面:模型处理器期待的异步文件接口加同步纯路径助手 [@busybee 2026-06-13] ////
function makeFilesFacade() {
  return {
    join: (...parts) => path.join(...parts),
    extname: (p) => path.extname(p),
    basename: (p) => path.basename(p),
    async listDir(dir) { try { return await fsPromises.readdir(dir); } catch { return []; } },
    async readJson(p) { return JSON.parse(await fsPromises.readFile(p, 'utf-8')); },
    async exists(p) { try { await fsPromises.access(p); return true; } catch { return false; } },
    async isDirectory(p) { try { return (await fsPromises.stat(p)).isDirectory(); } catch { return false; } },
    async copyFile(src, dest) {
      await fsPromises.mkdir(path.dirname(dest), { recursive: true });
      await fsPromises.copyFile(src, dest);
    },
    async copyDir(src, dest) { await fsPromises.cp(src, dest, { recursive: true }); },
    async removeDir(p) { await fsPromises.rm(p, { recursive: true, force: true }); }
  };
}
//// /文件系统门面 ////

//// 增强数据存储:经仓储读写一份 enhance 数据,网关执行体据此落盘 [@busybee 2026-06-13] ////
function makeEnhanceStore(platform) {
  return {
    async save(data) { await platform.repository.put('enhance-data', data); return { success: true }; },
    async load() { return { success: true, data: (await platform.repository.get('enhance-data')) || null }; }
  };
}
//// /增强数据存储 ////

//// 取裸宠物窗口供转发判存活,窗口未建或已毁返回 null [@busybee 2026-06-13] ////
function petWindowRaw(rt) {
  return windowFactory.isAlive(rt.petWindow) ? rt.petWindow._raw : null;
}
//// /取裸宠物窗口供转发判存活 ////

//// 取裸设置窗口供转发判存活,窗口未建或已毁返回 null [@busybee 2026-06-13] ////
function settingsWindowRaw(rt) {
  return windowFactory.isAlive(rt.settingsWindow) ? rt.settingsWindow._raw : null;
}
//// /取裸设置窗口供转发判存活 ////

//// 取宠物窗口在屏幕上的边界供 petPosition 源,窗口未建或已毁返回 null [@busybee 2026-06-13] ////
function petBounds(rt) {
  return windowFactory.isAlive(rt.petWindow) ? rt.petWindow.getBounds() : null;
}
//// /取宠物窗口边界供 petPosition 源 ////

//// 算 voicevox 资源根:优先用户数据目录,缺省回退安装目录,均无返回 null [@busybee 2026-06-13] ////
function resolveVoicevoxDir(platform) {
  const userDir = path.join(platform.pathUtils.userDataDir(), 'voicevox_core');
  const fallbackDir = path.join(__dirname, 'voicevox_core');
  if (fs.existsSync(userDir)) return userDir;
  if (fs.existsSync(fallbackDir)) return fallbackDir;
  return null;
}
//// /算 voicevox 资源根 ////

//// 判定一个外发地址是合法 http/https 链接,供工具执行器门控外链 [@busybee 2026-06-13] ////
function isValidHttpUrl(url) {
  try { const u = new URL(url); return u.protocol === 'http:' || u.protocol === 'https:'; }
  catch { return false; }
}
//// /判定一个外发地址是合法 http/https 链接 ////

//// 在不阻塞就绪的前提下初始化语音后端,缺运行时文件则保持禁用 [@busybee 2026-06-13] ////
function initSpeechBackend(platform) {
  setImmediate(() => {
    const dir = resolveVoicevoxDir(platform);
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
  // 先停主循环,避免落盘期间又跑出一拍
  try {
    if (runtime.scheduler) runtime.scheduler.stop();
  } catch (e) {
    console.error('[main] 调度器停止失败:', e && e.message);
  }
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
