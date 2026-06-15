// 运行方式:node --test tests/platform/handlers/tts-handlers.test.js
// 经真实 ipc-router 注册再 dispatch,用 mock 注入后端、编排器、译者、配置存储、安装器,断言:
// 合成走译者与编排器产出 base64、后端不可用安全失败、配置写入后端并持久化、安装下载委托给 installer。

const { test } = require('node:test');
const assert = require('node:assert');
const router = require('../../../src/platform/ipc/ipc-router');
const handlers = require('../../../src/platform/ipc/handlers/tts-handlers');
const { TtsOrchestrator } = require('../../../src/domain/tts/tts-orchestrator');

const WAV_HEADER_BYTES = 44;

//// 造一个含可算时长的最小 WAV:24kHz 单声道 16 位,PCM 字节用 0xab 填 [@x380kkm 2026-06-13] ////
function makeWav(pcmLen) {
  const buf = Buffer.alloc(WAV_HEADER_BYTES + pcmLen);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(24000, 24);
  buf.writeUInt32LE(48000, 28);
  buf.writeUInt16LE(16, 34);
  buf.fill(0xab, WAV_HEADER_BYTES);
  return buf;
}

//// 造一个可控可用性、记录合成调用的后端模拟 [@x380kkm 2026-06-13] ////
function makeBackend(overrides = {}) {
  return {
    initialized: true,
    isGpu: false,
    styleId: 0,
    speedScale: 1,
    pitchScale: 0,
    volumeScale: 1,
    available: overrides.available !== undefined ? overrides.available : true,
    isAvailable() { return this.available; },
    synthesize: overrides.synthesize || ((text) => makeWav(text.length * 2)),
    setConfig(c) { Object.assign(this, c); },
    getMetas: overrides.getMetas || (() => [{ name: 'meta' }]),
    getAvailableVvms: overrides.getAvailableVvms || (() => ['0.vvm']),
    dispose() { this.disposed = true; },
    init: overrides.init || (() => true),
  };
}

//// 造一个内存配置存储模拟,记录最后写入的值 [@x380kkm 2026-06-13] ////
function makeConfigStore(initial = {}) {
  const state = { global: initial };
  return {
    state,
    async read(layer) { return state[layer] || null; },
    async write(layer, scopeId, value) { state[layer] = value; },
  };
}

//// 装配一份 deps,绑定真实编排器,注册前先复位 router [@x380kkm 2026-06-13] ////
function setup(overrides = {}) {
  router.reset();
  const backend = overrides.backend || makeBackend();
  const orchestrator = new TtsOrchestrator({ speechBackend: backend });
  const installer = overrides.installer || {
    downloadVvm: async () => ({ success: true }),
    setup: async () => ({ success: true, path: '/vv' }),
  };
  const deps = {
    router,
    speechBackend: backend,
    orchestrator,
    translate: overrides.translate,
    configStore: overrides.configStore || makeConfigStore(),
    installer,
    resolveVoicevoxDir: overrides.resolveVoicevoxDir || (() => '/vv'),
    relaunch: overrides.relaunch || (() => {}),
    notifyProgress: overrides.notifyProgress || (() => {}),
    fs: overrides.fs || { existsSync: () => true },
  };
  handlers.registerTtsHandlers(deps);
  return { deps, backend, installer };
}

//// 合成经译者转日语、经编排器拼接,产出 base64 的 WAV 与日语文本 [@x380kkm 2026-06-13] ////
test('tts-synthesize translates and returns base64 wav', async () => {
  const calls = [];
  setup({ translate: async (t) => { calls.push(t); return `JA:${t}`; } });
  const result = await router.dispatch('tts-synthesize', '你好');

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.jaText, 'JA:你好');
  assert.ok(typeof result.wav === 'string' && result.wav.length > 0);
  assert.deepStrictEqual(calls, ['你好']);
});

//// 后端不可用时合成安全失败 [@x380kkm 2026-06-13] ////
test('tts-synthesize fails safely when backend unavailable', async () => {
  setup({ backend: makeBackend({ available: false }) });
  const result = await router.dispatch('tts-synthesize', '你好');
  assert.strictEqual(result.success, false);
  assert.match(result.error, /not available/);
});

//// 无译者时直接用原文合成 [@x380kkm 2026-06-13] ////
test('tts-synthesize uses raw text when no translator injected', async () => {
  setup();
  const result = await router.dispatch('tts-synthesize', 'こんにちは');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.jaText, 'こんにちは');
});

//// 状态汇报初始化、可用、风格与译者就绪 [@x380kkm 2026-06-13] ////
test('tts-get-status reports backend and translator readiness', async () => {
  setup({ translate: async (t) => t });
  const result = await router.dispatch('tts-get-status', null);
  assert.strictEqual(result.initialized, true);
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.translationConfigured, true);
});

//// 设置配置写入后端并持久化到全局配置的 tts 段 [@x380kkm 2026-06-13] ////
test('tts-set-config applies to backend and persists to config', async () => {
  const configStore = makeConfigStore({ apiKey: 'k' });
  const { backend } = setup({ configStore });
  await router.dispatch('tts-set-config', { styleId: 7, speedScale: 1.2 });

  assert.strictEqual(backend.styleId, 7);
  assert.strictEqual(configStore.state.global.tts.styleId, 7);
  assert.strictEqual(configStore.state.global.tts.speedScale, 1.2);
  // 既有非 tts 字段保留
  assert.strictEqual(configStore.state.global.apiKey, 'k');
});

//// 重启按持久化配置重新初始化后端 [@x380kkm 2026-06-13] ////
test('tts-restart disposes then re-inits from persisted config', async () => {
  const configStore = makeConfigStore({ tts: { gpuMode: true, vvmFiles: ['0.vvm'] } });
  let initArgs = null;
  const backend = makeBackend({ init: (dir, vvm, opts) => { initArgs = { dir, vvm, opts }; return true; } });
  setup({ backend, configStore });
  const result = await router.dispatch('tts-restart', null);

  assert.strictEqual(result.success, true);
  assert.strictEqual(backend.disposed, true);
  assert.deepStrictEqual(initArgs.vvm, ['0.vvm']);
  assert.strictEqual(initArgs.opts.gpuMode, true);
});

//// 资源目录缺失时重启报错 [@x380kkm 2026-06-13] ////
test('tts-restart errors when voicevox dir is missing', async () => {
  setup({ fs: { existsSync: () => false } });
  const result = await router.dispatch('tts-restart', null);
  assert.strictEqual(result.success, false);
  assert.match(result.error, /not found/);
});

//// 元数据与可用模型列举委托给后端 [@x380kkm 2026-06-13] ////
test('tts-get-metas and tts-get-available-vvms delegate to backend', async () => {
  setup();
  assert.deepStrictEqual(await router.dispatch('tts-get-metas', null), [{ name: 'meta' }]);
  assert.deepStrictEqual(await router.dispatch('tts-get-available-vvms', null), ['0.vvm']);
});

//// 下载模型委托给安装器并带上资源根 [@x380kkm 2026-06-13] ////
test('download-vvm delegates to installer with resolved dir', async () => {
  const calls = [];
  const installer = {
    downloadVvm: async (dir, filename) => { calls.push({ dir, filename }); return { success: true }; },
    setup: async () => ({ success: true }),
  };
  setup({ installer });
  const result = await router.dispatch('download-vvm', '8.vvm');
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(calls, [{ dir: '/vv', filename: '8.vvm' }]);
});

//// 安装委托给安装器并传入进度上报回调 [@x380kkm 2026-06-13] ////
test('setup-voicevox delegates to installer with progress notifier', async () => {
  let gotNotify = null;
  const installer = {
    downloadVvm: async () => ({ success: true }),
    setup: async (dir, notify) => { gotNotify = { dir, notify }; return { success: true, path: dir }; },
  };
  const notifyProgress = () => {};
  setup({ installer, notifyProgress });
  const result = await router.dispatch('setup-voicevox', null);
  assert.strictEqual(result.success, true);
  assert.strictEqual(gotNotify.dir, '/vv');
  assert.strictEqual(gotNotify.notify, notifyProgress);
});

//// 重启应用通道触发注入的 relaunch [@x380kkm 2026-06-13] ////
test('app-relaunch invokes the injected relaunch', async () => {
  let relaunched = false;
  setup({ relaunch: () => { relaunched = true; } });
  const result = await router.dispatch('app-relaunch', null);
  assert.strictEqual(result.success, true);
  assert.strictEqual(relaunched, true);
});
