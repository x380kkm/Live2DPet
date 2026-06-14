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
const { ModelRouter } = require('./src/platform/llm/model-router');
const { StepModelConfig } = require('./src/platform/llm/step-model-config');
const { buildStepModelConfig } = require('./src/platform/config/preset-loader');
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
const { TRUST } = require('./src/domain/mod/mod');
const { ModGenerator } = require('./src/domain/mod/mod-generator');
const { createModSource } = require('./src/platform/mod/mod-source');
const { createExpressionArbiter } = require('./src/platform/window/expression-arbiter');
const { StepRegistry } = require('./src/domain/model/step-registry');
const { builtinSteps, StepId } = require('./src/shared/step-catalog');
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
const { InteractionRouter } = require('./src/domain/pet/interaction-router');
const { InteractionEvent } = require('./src/domain/mod/interaction-event');
const { ReactionPolicy } = require('./src/domain/statemachine/reaction-policy');
const { ReactionDriver } = require('./src/domain/statemachine/reaction-driver');
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
const { InteractionInfoSource } = require('./src/domain/pet/sources/interaction-info-source');

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

//// 用全局层配置造步骤模型路由,按大类与步骤两层选模型,供应商细节止于 llm-client [@busybee 2026-06-13] ////
// 路由与 LlmClient 同接口,直接顶替原来的单客户端注入点;makeClient 按解析出的配置造对应预设的客户端。
// 有 modelConfig 用两层配置,否则退回单模型;fetch 与文本清理经 deps 注入,业务侧不见供应商 SDK。
function assembleModelRouter(global) {
  const stepModelConfig = new StepModelConfig(buildStepModelConfig(global));
  const makeClient = (cfg) => new LlmClient(
    {
      apiKey: cfg.apiKey, baseURL: cfg.baseURL, model: cfg.model, preset: cfg.preset,
      temperature: cfg.temperature, maxTokens: cfg.maxTokens,
      effort: cfg.effort, thinking: cfg.thinking, extraBody: cfg.extraBody,
      maxRetries: 1
    },
    { fetch: (...args) => fetch(...args), cleanResponse }
  );
  return new ModelRouter(stepModelConfig, { makeClient });
}
//// /用全局层配置造步骤模型路由 ////

//// 从环境变量直配 Live2D 模型:设了 LIVE2DPET_MODEL_* 就产出一份 model 配置,否则返回 null [@busybee 2026-06-14] ////
// 给「不想在界面里填」的用户一条直配通道:模型类型与路径经环境变量给定,渲染侧 load-config 取到后加载。
function envModelOverride(env) {
  const e = env || {};
  const folderPath = e.LIVE2DPET_MODEL_PATH;
  const type = e.LIVE2DPET_MODEL_TYPE;
  if (!folderPath && !type) return null;
  return {
    type: type || 'live2d',
    folderPath: folderPath || null,
    modelJsonFile: e.LIVE2DPET_MODEL_FILE || null,
    paramMapping: {}
  };
}
//// /从环境变量直配 Live2D 模型 ////

//// 按依赖序装配 domain 角色层,经构造注入串起感知到发言的编排 [@busybee 2026-06-13] ////
// platform 为已装配的地基;llmClient 为统一模型客户端;global 为全局层配置快照(取人格)。
// providers 携带六个上下文源的取数函数与标题压缩、略过判定;languageState 给上下文源的成品措辞。
// 返回有状态子系统与上下文源、连接件供生命周期与事件订阅使用。
function assembleDomain(platform, llmClient, global, providers, languageState) {
  const { eventBus, repository, speechBackend } = platform;

  // 意图:出厂两条核心意图在加载期被发现注入
  const intentRegistry = new IntentRegistry();
  intentRegistry.discoverBuiltins(builtinIntents());

  // mod:从出厂与用户两目录读规格,发现后两级启用合并;信任级别由来源目录强制
  const modSource = createModSource({
    dirs: [
      { dir: path.join(__dirname, 'assets', 'mods'), trust: TRUST.OFFICIAL },
      { dir: path.join(platform.pathUtils.userDataDir(), 'mods'), trust: TRUST.USER_CUSTOM }
    ],
    fs, path
  });
  const modRegistry = new ModRegistry({
    source: modSource,
    globalEnabled: Array.isArray(global.enabledMods) ? global.enabledMods : []
  });
  const discoveredMods = modRegistry.discover();
  // mod 声明的意图随发现注入意图注册表,可追溯到 mod id;无 mod 时为空操作
  intentRegistry.discoverFromMods(discoveredMods);

  // AI 步骤:出厂步骤在加载期被发现注入,供设置界面枚举与模型路由校验,可追溯
  const stepRegistry = new StepRegistry();
  stepRegistry.discoverBuiltins(builtinSteps());

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

  // 提示词组装器:接 few-shot 解析器与角色人格,按预算裁样例组装请求,并合并用户额外 system 注入
  const promptComposer = assemblePromptComposer(global, llmClient);

  // 请求管线:上下文源注册表与提示词组装器经组合根注入,管线自身不抓全局
  const sourceRegistry = makeSourceRegistry(contextSources);
  const pipeline = new RequestPipeline({ sources: sourceRegistry, llmClient, promptComposer });

  // mod 生成器:生成期一次性造前端与行为,禁写人格与成品措辞;注入编排器,供其当场生成临时 mod
  const modGenerator = new ModGenerator({ llm: llmClient });
  // pet 编排器:选意图、跑管线、把产物经事件总线发给表现层;带 mod 生成器,可当场生成临时 mod
  const pet = new PetOrchestrator({ pipeline, llmClient, eventBus, modGenerator });

  // 交互路由:mod 交互事件经总线进来,据事件名触发声明消费它的意图,不经截图循环
  const interactionRouter = new InteractionRouter({ eventBus, registry: intentRegistry, pet });

  // 状态机有界事件反应:边界态事件经反应策略产出有界 LLM 反应,反应提示词复用人格组装,不经截图循环
  const reactionPolicy = new ReactionPolicy({ llmClient, eventBus });
  const reactionDriver = new ReactionDriver({
    eventBus, reactionPolicy,
    composeScope: (event) => promptComposer.composeReaction(event)
  });

  return {
    intentRegistry, modRegistry, stepRegistry, interactionRouter,
    reactionPolicy, reactionDriver,
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
// toneHint 暂无下一句情绪的数据源,provider 留空时其 render 返回 null。
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
    ),
    // 交互信息源:把当下这次身体交互折成一行,供身体交互 mod 的意图据此回应
    new InteractionInfoSource()
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

//// 装配提示词组装器:few-shot 银行与解析器加角色人格,合并用户额外 system 注入 [@busybee 2026-06-13] ////
// 银行暂无样例入库(磁盘 fewshot 目录为空),解析器对空引用返回空轮次;人格取自激活角色卡的 data。
// system 注入取台词步解析出的(全局加 llm 大类),与人格规则合并;无路由时为空串。
function assemblePromptComposer(global, llmClient) {
  const bank = new FewShotBank();
  const fewShotResolver = new FewShotResolver(bank);
  const persona = (global.activeCard && global.activeCard.data) || {};
  const systemInjection = llmClient && llmClient.resolveStep
    ? llmClient.resolveStep(StepId.Dialogue).systemInjection
    : '';
  return new PromptComposer({ fewShotResolver, persona }, { systemInjection });
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
// 桌宠窗口边长:建窗与默认定位共用一处,避免两处数字漂移。
const PET_WINDOW_SIZE = 300;
// 反重复源保留的最近发言条数上限。
const RECENT_REPLIES_KEEP = 8;

//// 判一个应用名是否略过:命中略过片段即不计入焦点与布局 [@busybee 2026-06-13] ////
function shouldSkipApp(appName) {
  if (!appName) {
    return true;
  }
  const lower = appName.toLowerCase();
  return SKIP_APP_FRAGMENTS.some((fragment) => lower.includes(fragment));
}
//// /判一个应用名是否略过 ////

//// 把窗口标题压短:剥常见浏览器与编辑器后缀再截断 [@busybee 2026-06-13] ////
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
function subscribeRenderForwarders(eventBus, getPetWindow, bubble) {
  // 发言产物:文本进独立气泡窗口,并把说话态切到开,供图片帧与表情联动
  eventBus.subscribe('UtteranceProduced', (event) => {
    const text = spokenTextOf(event);
    if (!text) return;
    bubble.show(text, event.bubbleDurationMs || 8000);
    const win = getPetWindow();
    if (win) win.webContents.send('talking-state-changed', true);
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
    // 启动宠物:建窗、把设置窗口收起、开启感知调度循环
    'create-pet-window': () => {
      ensurePetWindow(runtime);
      if (runtime.bubbleController) runtime.bubbleController.ensure();
      if (runtime.modFrontendController) runtime.modFrontendController.ensure();
      if (windowFactory.isAlive(runtime.settingsWindow)) runtime.settingsWindow.hide();
      if (runtime.scheduler) runtime.scheduler.start();
      return { success: true };
    },
    // 关闭宠物:停感知调度、关桌宠与气泡与 mod 前端窗、把设置窗口重新显示出来供再配置与再启动
    'close-pet-window': () => {
      if (runtime.scheduler) runtime.scheduler.stop();
      if (windowFactory.isAlive(runtime.chatBubbleWindow)) runtime.chatBubbleWindow.close();
      if (windowFactory.isAlive(runtime.modFrontendWindow)) runtime.modFrontendWindow.close();
      if (windowFactory.isAlive(runtime.petWindow)) runtime.petWindow.close();
      if (windowFactory.isAlive(runtime.settingsWindow)) { runtime.settingsWindow.show(); runtime.settingsWindow.focus(); }
      return { success: true };
    },
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
    // mod 前端或身体交互上报:把交互折成交互事件发上总线,交互路由据事件名触发意图
    'report-mod-interaction': (args) => {
      const name = Array.isArray(args) ? args[0] : args;
      const payload = Array.isArray(args) ? args[1] : null;
      if (name && runtime.platform && runtime.platform.eventBus) {
        runtime.platform.eventBus.publish(new InteractionEvent(name, payload));
      }
      return { success: true };
    },
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
    // 气泡控制器:气泡相关 IPC 经它驱动独立气泡窗口
    bubble: runtime.bubbleController,
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
    width: PET_WINDOW_SIZE, height: PET_WINDOW_SIZE, frame: false, transparent: true, alwaysOnTop: true, resizable: false,
    resizable: true, skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'preload.js') }
  });
  runtime.petWindow.setAlwaysOnTop(true, 'screen-saver');
  runtime.petWindow.loadFile(path.join(__dirname, 'desktop-pet.html'));
  // 默认落到屏幕右下角:用工作区尺寸(已扣任务栏、DIP 口径,与 setPosition 一致),按窗口边长加 20 像素外边距贴右下不溢出。
  const { width, height } = electron.screen.getPrimaryDisplay().workAreaSize;
  runtime.petWindow.setPosition(width - PET_WINDOW_SIZE - 20, height - PET_WINDOW_SIZE - 20);
  runtime.petWindow.on('closed', () => { runtime.petWindow = null; });
  return runtime.petWindow;
}
//// /建桌宠主窗口加载 desktop-pet.html ////

// 对话气泡窗口与桌宠的竖直间距(像素)。
const BUBBLE_GAP = 8;
// 对话气泡窗口的初始尺寸:渲染侧量好文本后会经 resize-chat-bubble 重设。
const BUBBLE_INIT_WIDTH = 260;
const BUBBLE_INIT_HEIGHT = 90;

//// 建独立对话气泡窗口加载 pet-chat-bubble.html:透明无边、置顶、不抢焦点、初始隐藏 [@busybee 2026-06-14] ////
// 气泡是独立窗口,浮在桌宠上方;随桌宠启动而建、随关闭而销毁。
function ensureChatBubbleWindow(runtime) {
  if (windowFactory.isAlive(runtime.chatBubbleWindow)) { return runtime.chatBubbleWindow; }
  runtime.chatBubbleWindow = windowFactory.createWindow({
    BrowserWindow: electron.BrowserWindow,
    width: BUBBLE_INIT_WIDTH, height: BUBBLE_INIT_HEIGHT,
    frame: false, transparent: true, alwaysOnTop: true, resizable: false,
    show: false, skipTaskbar: true, focusable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'preload.js') }
  });
  runtime.chatBubbleWindow.setAlwaysOnTop(true, 'screen-saver');
  runtime.chatBubbleWindow.loadFile(path.join(__dirname, 'pet-chat-bubble.html'));
  runtime.chatBubbleWindow.on('closed', () => { runtime.chatBubbleWindow = null; });
  return runtime.chatBubbleWindow;
}
//// /建独立对话气泡窗口 ////

//// 造气泡控制器:把气泡窗口的「建窗、显示发言、改尺寸、隐藏」收成几个动作,定位与就绪排队逻辑只此一处 [@busybee 2026-06-14] ////
// 气泡始终浮在桌宠正上方、水平居中;显示发言时先按当前尺寸定位再推文本,渲染侧量好文本后经 resize 重定尺寸与位置。
// 渲染未就绪(窗口刚建、还没订阅消息通道)时,先把最新一条发言存住,等 ready-to-show 再补发,避免发言早于订阅而丢失。
function makeBubbleController(runtime) {
  let ready = false;
  let pending = null;

  function positionAbovePet(width, height) {
    if (!windowFactory.isAlive(runtime.petWindow) || !windowFactory.isAlive(runtime.chatBubbleWindow)) return;
    const pet = runtime.petWindow.getBounds();
    const x = Math.round(pet.x + (pet.width - width) / 2);
    const y = Math.round(pet.y - height - BUBBLE_GAP);
    runtime.chatBubbleWindow.setBounds({ x, y, width, height });
  }

  function sendNow(message, autoCloseTime) {
    if (!windowFactory.isAlive(runtime.chatBubbleWindow)) return;
    // 气泡占主导:先收起占着表达区的 mod 前端,二者不同时显示
    if (runtime.expressionArbiter) runtime.expressionArbiter.takeOver('bubble');
    const bounds = runtime.chatBubbleWindow.getBounds();
    positionAbovePet(bounds.width || BUBBLE_INIT_WIDTH, bounds.height || BUBBLE_INIT_HEIGHT);
    runtime.chatBubbleWindow.send('chat-bubble-message', { message, autoCloseTime });
    if (!runtime.chatBubbleWindow.isVisible()) runtime.chatBubbleWindow.showInactive();
  }

  return {
    // 建气泡窗口并挂就绪监听;窗口已在则不重复建,监听只随新建注册一次。
    ensure() {
      if (windowFactory.isAlive(runtime.chatBubbleWindow)) return;
      ready = false;
      pending = null;
      ensureChatBubbleWindow(runtime);
      runtime.chatBubbleWindow.on('ready-to-show', () => {
        ready = true;
        if (pending) { const p = pending; pending = null; sendNow(p.message, p.autoCloseTime); }
      });
    },
    show(message, autoCloseTime) {
      if (!message) return;
      this.ensure();
      const at = autoCloseTime || 8000;
      if (ready) sendNow(message, at);
      else pending = { message, autoCloseTime: at };
    },
    resize(width, height) {
      if (!windowFactory.isAlive(runtime.chatBubbleWindow)) return;
      positionAbovePet(width, height);
      if (!runtime.chatBubbleWindow.isVisible()) runtime.chatBubbleWindow.showInactive();
    },
    hide() {
      if (windowFactory.isAlive(runtime.chatBubbleWindow)) runtime.chatBubbleWindow.hide();
      if (runtime.expressionArbiter) runtime.expressionArbiter.release('bubble');
    }
  };
}
//// /造气泡控制器 ////

// mod 前端窗口与桌宠的竖直间距与初始尺寸:挂载内容时控制器据 mod 尺寸预算重设。
const MOD_FRONTEND_GAP = 8;
const MOD_FRONTEND_INIT_WIDTH = 280;
const MOD_FRONTEND_INIT_HEIGHT = 200;

//// 建独立 mod 前端窗口加载 mod-frontend.html:透明无边、置顶、可交互、初始隐藏 [@busybee 2026-06-14] ////
// 与气泡窗口并列的第二个表达区占用者,承载 mod 前端;它须能获焦点(气泡不可),供用户点击交互。
function ensureModFrontendWindow(runtime) {
  if (windowFactory.isAlive(runtime.modFrontendWindow)) { return runtime.modFrontendWindow; }
  runtime.modFrontendWindow = windowFactory.createWindow({
    BrowserWindow: electron.BrowserWindow,
    width: MOD_FRONTEND_INIT_WIDTH, height: MOD_FRONTEND_INIT_HEIGHT,
    frame: false, transparent: true, alwaysOnTop: true, resizable: false,
    show: false, skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'preload.js') }
  });
  runtime.modFrontendWindow.setAlwaysOnTop(true, 'screen-saver');
  runtime.modFrontendWindow.loadFile(path.join(__dirname, 'mod-frontend.html'));
  runtime.modFrontendWindow.on('closed', () => { runtime.modFrontendWindow = null; });
  return runtime.modFrontendWindow;
}
//// /建独立 mod 前端窗口 ////

//// 造 mod 前端控制器:把 mod 前端窗口的建窗、挂载、改尺寸、隐藏收成几个动作,定位与就绪排队只此一处 [@busybee 2026-06-14] ////
// mod 前端浮在桌宠正上方、水平居中(与气泡同位,同一时刻至多一个占主导由主进程仲裁保证);
// 渲染未就绪时把最新一次挂载存住,等 ready-to-show 再补发。挂载内容(纯数据模板或 iframe 沙箱前端)由 mod 承载器渲染。
function makeModFrontendController(runtime) {
  let ready = false;
  let pending = null;

  function positionAbovePet(width, height) {
    if (!windowFactory.isAlive(runtime.petWindow) || !windowFactory.isAlive(runtime.modFrontendWindow)) return;
    const pet = runtime.petWindow.getBounds();
    const x = Math.round(pet.x + (pet.width - width) / 2);
    const y = Math.round(pet.y - height - MOD_FRONTEND_GAP);
    runtime.modFrontendWindow.setBounds({ x, y, width, height });
  }

  function mountNow(payload) {
    if (!windowFactory.isAlive(runtime.modFrontendWindow)) return;
    // mod 前端占主导:先收起占着表达区的气泡,二者不同时显示
    if (runtime.expressionArbiter) runtime.expressionArbiter.takeOver('mod');
    const bounds = runtime.modFrontendWindow.getBounds();
    positionAbovePet(bounds.width || MOD_FRONTEND_INIT_WIDTH, bounds.height || MOD_FRONTEND_INIT_HEIGHT);
    runtime.modFrontendWindow.send('mod-frontend-mount', payload);
    // 用 showInactive 显示而不抢焦点;窗口可获焦点,用户点击 mod 前端时再激活
    if (!runtime.modFrontendWindow.isVisible()) runtime.modFrontendWindow.showInactive();
  }

  return {
    ensure() {
      if (windowFactory.isAlive(runtime.modFrontendWindow)) return;
      ready = false;
      pending = null;
      ensureModFrontendWindow(runtime);
      runtime.modFrontendWindow.on('ready-to-show', () => {
        ready = true;
        if (pending) { const p = pending; pending = null; mountNow(p); }
      });
    },
    mount(payload) {
      this.ensure();
      const data = payload || {};
      if (ready) mountNow(data);
      else pending = data;
    },
    resize(width, height) {
      if (!windowFactory.isAlive(runtime.modFrontendWindow)) return;
      positionAbovePet(width, height);
      if (!runtime.modFrontendWindow.isVisible()) runtime.modFrontendWindow.showInactive();
    },
    hide() {
      if (windowFactory.isAlive(runtime.modFrontendWindow)) runtime.modFrontendWindow.hide();
      if (runtime.expressionArbiter) runtime.expressionArbiter.release('mod');
    }
  };
}
//// /造 mod 前端控制器 ////

//// 把生成器产出的前端规格转成 mod 承载器认的沙箱形态:运行期生成即执行的前端一律沙箱化 [@busybee 2026-06-14] ////
// 生成器产出 { html, css, js };承载器认 { kind:'sandboxed', srcdoc }。已是沙箱形状则原样返回。
function generatedFrontendToSandbox(spec) {
  if (!spec) return { kind: 'sandboxed', srcdoc: '' };
  if (spec.kind === 'sandboxed' && typeof spec.srcdoc === 'string') return spec;
  const css = spec.css ? `<style>${spec.css}</style>` : '';
  const js = spec.js ? `<script>${spec.js}<\/script>` : '';
  return { kind: 'sandboxed', srcdoc: `${css}${spec.html || ''}${js}` };
}
//// /把生成器产出的前端规格转成沙箱形态 ////

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

// 当前界面语言的显式载体,语言据全局配置在就绪期设定。
const languageState = new LanguageState({ table: I18N });

//// 取一个翻译串:据当前语言查表,未命中逐级回退 [@busybee 2026-06-13] ////
function mt(key) {
  return languageState.mt(key);
}
//// /取一个翻译串 ////

// 主进程可变运行态:窗口句柄、托盘、退出标志,生命周期钩子据此协调
const runtime = {
  petWindow: null,
  chatBubbleWindow: null,
  modFrontendWindow: null,
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
  // 环境变量直配 Live2D 模型:设了就覆盖并写回,使渲染侧 load-config 取到该模型(在挂 activeCard 之前写,避免把人格快照落进配置)
  const envModel = envModelOverride(process.env);
  if (envModel) { global.model = envModel; await platform.configStore.write('global', null, global); }
  global.activeCard = await loadActiveCard(platform, global);
  languageState.set(global.language || global.lang);
  const llmClient = assembleModelRouter(global);

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
  // 交互路由订阅交互事件:mod 交互经总线触发声明消费它的意图,不经截图循环
  runtime.domain.interactionRouter.start();
  // 状态机反应驱动订阅边界态事件;产出的反应当作一次发言,复用气泡与情绪那条产物通路把它显示出来
  runtime.domain.reactionDriver.start();
  platform.eventBus.subscribe('ReactionProduced', (event) => {
    platform.eventBus.publish({ type: 'UtteranceProduced', intentId: 'state-reaction', text: event.text, emotion: null, modEvents: [] });
  });
  // 编排器当场生成临时 mod 后请求挂载;运行期生成即执行的前端一律走 iframe 沙箱,经 mod 前端窗口承载
  platform.eventBus.subscribe('ModMountRequested', (event) => {
    if (runtime.modFrontendController) {
      runtime.modFrontendController.mount({
        modId: event.modId,
        frontendSpec: generatedFrontendToSandbox(event.frontendSpec),
        emits: event.emits || []
      });
    }
  });
  // 气泡控制器:发言产物与气泡相关 IPC 都经它驱动独立气泡窗口,定位逻辑只此一处
  // 表达区仲裁:气泡窗口与 mod 前端窗口同一时刻至多一个占主导,显示一个即收起另一个,协调只此一处
  runtime.expressionArbiter = createExpressionArbiter({
    hide: {
      bubble: () => { if (windowFactory.isAlive(runtime.chatBubbleWindow)) runtime.chatBubbleWindow.hide(); },
      mod: () => { if (windowFactory.isAlive(runtime.modFrontendWindow)) runtime.modFrontendWindow.hide(); }
    }
  });
  runtime.bubbleController = makeBubbleController(runtime);
  subscribeRenderForwarders(platform.eventBus, () => petWindowRaw(runtime), runtime.bubbleController);
  // mod 前端控制器:mod 前端作为独立窗口,挂载与定位经它驱动;挂载内容由 mod 承载器渲染
  runtime.modFrontendController = makeModFrontendController(runtime);

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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload: path.join(__dirname, 'preload.js') }
  });
  runtime.settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
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

  // 桌宠窗口不在启动时显示:设置窗口先出现作为启动器,用户点「启动宠物」才经 create-pet-window 建窗。

  // 主循环调度器:按间隔反复采感知、取候选、选意图、跑意图,并按需喂情绪;经感知运行态与领域层注入。
  // 只装配不启动:截图感知循环随宠物启动而开、随宠物关闭而停,不在无宠物时空跑。
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

  // 自动启动桌宠:默认关闭;设 LIVE2DPET_AUTOLAUNCH=1 时启动即建桌宠与气泡窗并开调度。
  if (process.env.LIVE2DPET_AUTOLAUNCH === '1') {
    ensurePetWindow(runtime);
    runtime.bubbleController.ensure();
    runtime.modFrontendController.ensure();
    if (windowFactory.isAlive(runtime.settingsWindow)) runtime.settingsWindow.hide();
    runtime.scheduler.start();
  }

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
      catch {
        // 用户数据目录没有该卡时回退到出厂卡(assets/prompts),使内置卡在开发期与迁移前也可读,展示名与字段不退化成 id
        try {
          const bundledFile = path.join(__dirname, 'assets', 'prompts', `${id}.json`);
          return JSON.parse(await fsPromises.readFile(bundledFile, 'utf-8'));
        } catch { return null; }
      }
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
    const ok = platform.speechBackend.init(dir, ['0.vvm', '8.vvm'], { gpuMode: false });
    if (ok) platform.speechBackend.warmup();
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
