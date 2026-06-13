// audience: internal
// # handler-assembly
// IPC 处理器装配:把各处理器模块所需的窄接口在此就地适配,再经 ipc-router 注册。
// 不变量:本文件只做装配适配,不含业务逻辑;第三方类型(fs、dialog、shell)经参数注入,不在此 require。
//
// 各处理器模块对依赖的形态约定不一(有的要 configStore.load/save,有的要花名册 read/write,
// 有的要 picker/files 窄接口),真实 platform 类的方法名与之不完全一致;此处把真实类适配成各模块期待的窄接口。
// platform 入口(main.js)把已造好的 platform 与 domain 对象交进来,本文件不自行创建有状态子系统。

const channelRegistry = require('./channel-registry');
const { createCharacterHandlers } = require('./handlers/character-handlers');
const { createModelHandlers } = require('./handlers/model-handlers');
const { registerTtsHandlers } = require('./handlers/tts-handlers');
const { registerAudioHandlers } = require('./handlers/audio-handlers');
const { registerPerceptionHandlers, makePerceptionExecutor } = require('./handlers/perception-handlers');
const { registerEmotionHandlers } = require('./handlers/emotion-handlers');
const { registerUtilHandlers, makeUtilExecutor } = require('./handlers/util-handlers');

// 全局配置的存储层与作用域 id:全局层只有一份,scopeId 被 ConfigStore 忽略。
const GLOBAL_LAYER = 'global';
const GLOBAL_SCOPE = 'global';

//// 把真实 ConfigStore 适配成「读写整份全局配置」的扁平窄接口 [@busybee 2026-06-13] ////
// 渲染侧 load-config/save-config 与 character/model 处理器都读写同一份全局配置;
// load 读出整份(缺省给空对象),save 整份覆盖写回。
function makeFlatConfig(configStore) {
  return {
    async load() {
      return (await configStore.read(GLOBAL_LAYER, GLOBAL_SCOPE)) || {};
    },
    async save(data) {
      await configStore.write(GLOBAL_LAYER, GLOBAL_SCOPE, data || {});
      return { success: true };
    }
  };
}
//// /把真实 ConfigStore 适配成扁平窄接口 ////

//// 把扁平全局配置适配成角色花名册的 read/write:read 取快照,write 浅合并补丁后整份写回 [@busybee 2026-06-13] ////
// character-handlers 与 model-handlers 期待 config.read() 返回含 characters/activeCharacterId/model 的快照,
// config.write(patch) 把补丁浅合并进整份配置;此处把这两个动作落到同一份全局配置上。
function makeRosterConfig(flatConfig) {
  return {
    async read() {
      return await flatConfig.load();
    },
    async write(patch) {
      const current = await flatConfig.load();
      await flatConfig.save({ ...current, ...(patch || {}) });
      return { success: true };
    }
  };
}
//// /把扁平全局配置适配成角色花名册的 read/write ////

//// 装配并注册全部 IPC 处理器,返回被注册的通道名集合供入口补齐剩余通道 [@busybee 2026-06-13] ////
// deps 携带已造好的 platform 与 domain 对象,以及第三方门面(fs、path、dialog、shell、app 等)。
// 网关执行器在此组合:屏幕能力走感知执行器,外发与文件能力走工具执行器,一个能力 id 命中其一。
function registerAllHandlers(router, gateway, deps) {
  const flatConfig = makeFlatConfig(deps.configStore);
  const rosterConfig = makeRosterConfig(flatConfig);

  const characterHandlers = createCharacterHandlers({
    cardStore: deps.cardStore,
    config: rosterConfig,
    bundled: deps.bundledCards,
    newId: deps.newId,
    chooseFiles: deps.chooseCharacterFiles
  });

  const modelHandlers = createModelHandlers({
    picker: deps.picker,
    files: deps.files,
    config: rosterConfig,
    paths: deps.paths,
    mt: deps.mt
  });

  // 角色与模型处理器是按通道名索引的表,逐项经 router 注册;character-handlers 还带非通道的迁移钩子。
  registerHandlerTable(router, characterHandlers);
  registerHandlerTable(router, modelHandlers);

  registerTtsHandlers({
    router,
    speechBackend: deps.speechBackend,
    orchestrator: deps.ttsOrchestrator,
    translate: deps.translate,
    configStore: deps.configStore,
    installer: deps.voicevoxInstaller,
    resolveVoicevoxDir: deps.resolveVoicevoxDir,
    notifyProgress: deps.notifyVoicevoxProgress,
    relaunch: deps.relaunch,
    fs: deps.fs
  });

  registerAudioHandlers({
    router,
    speechBackend: deps.speechBackend,
    configStore: deps.configStore,
    resolveDefaultAudioDir: deps.resolveDefaultAudioDir,
    fs: deps.fs,
    path: deps.path
  });

  registerPerceptionHandlers({
    router,
    gateway,
    screenSource: deps.screenSource,
    scope: GLOBAL_SCOPE
  });

  registerEmotionHandlers({
    router,
    bus: deps.eventBus,
    petWindow: deps.petWindowRaw,
    settingsWindow: deps.settingsWindowRaw
  });

  registerUtilHandlers({
    router,
    gateway,
    bus: deps.eventBus,
    configStore: flatConfig,
    appInfo: deps.appInfo,
    enhanceStore: deps.enhanceStore,
    logSink: deps.logSink,
    scope: GLOBAL_SCOPE
  });

  return { migrateBundledCards: characterHandlers.migrateBundledCards };
}
//// /装配并注册全部 IPC 处理器 ////

//// 把按通道名索引的处理器表逐项注册,跳过非通道键(如迁移钩子) [@busybee 2026-06-13] ////
function registerHandlerTable(router, table) {
  for (const [channel, handler] of Object.entries(table)) {
    if (channelRegistry.isKnown(channel) && typeof handler === 'function') {
      router.register(channel, handler);
    }
  }
}
//// /把按通道名索引的处理器表逐项注册 ////

//// 组合屏幕、外发、文件三域重能力的统一执行器,交能力网关在门控通过后调用 [@busybee 2026-06-13] ////
// 感知执行器认屏幕能力,工具执行器认外发与文件能力;按能力 id 先问感知、未命中再问工具。
function makeCapabilityExecutor(deps) {
  const perceptionExecute = makePerceptionExecutor({
    screenSource: deps.screenSource,
    activeWindow: deps.activeWindow
  });
  const utilExecute = makeUtilExecutor({
    shell: deps.shell,
    searchSource: deps.searchSource,
    enhanceStore: deps.enhanceStore,
    isValidUrl: deps.isValidUrl
  });

  const screenDomain = channelRegistry.CapabilityDomain.screen;
  return async function execute(capabilityId, payload) {
    if (channelRegistry.capabilityDomainOf(capabilityId) === screenDomain) {
      return perceptionExecute(capabilityId, payload);
    }
    return utilExecute(capabilityId, payload);
  };
}
//// /组合三域重能力的统一执行器 ////

module.exports = { registerAllHandlers, makeCapabilityExecutor };
