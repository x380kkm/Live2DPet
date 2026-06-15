// 运行方式:node --test tests/platform/handlers/audio-handlers.test.js
// 经真实 ipc-router 注册再 dispatch,用 mock 注入后端、配置存储、目录解析与 fs,断言:
// 生成清空旧片段后逐短语合成落盘并恢复风格、短语列表持久化、后端不可用安全失败、加载读回 base64。

const { test } = require('node:test');
const assert = require('node:assert');
const router = require('../../../src/platform/ipc/ipc-router');
const handlers = require('../../../src/platform/ipc/handlers/audio-handlers');

const fakePath = { join: (...parts) => parts.join('/') };

//// 假 fs:按名维护一组文件内容,记录建目录、删文件、写文件 [@x380kkm 2026-06-13] ////
function fakeFs(initial = {}) {
  const files = { ...initial };
  const calls = { mkdir: [], unlink: [], written: [] };
  return {
    files,
    calls,
    existsSync: (p) => p in files || Object.keys(files).some((f) => f.startsWith(`${p}/`)) || files[`__dir__${p}`] === true,
    mkdirSync: (dir) => { calls.mkdir.push(dir); files[`__dir__${dir}`] = true; },
    unlinkSync: (p) => { calls.unlink.push(p); delete files[p]; },
    writeFileSync: (p, data) => { calls.written.push({ p, data }); files[p] = data; },
    readFileSync: (p) => files[p],
    readdirSync: (dir) => Object.keys(files)
      .filter((f) => f.startsWith(`${dir}/`))
      .map((f) => f.slice(dir.length + 1)),
  };
}

//// 造一个记录合成调用、可控可用性的后端模拟 [@x380kkm 2026-06-13] ////
function makeBackend(overrides = {}) {
  return {
    styleId: 0,
    available: overrides.available !== undefined ? overrides.available : true,
    isAvailable() { return this.available; },
    synthesize: overrides.synthesize || ((text) => Buffer.from(`wav:${text}`)),
  };
}

//// 造一个内存配置存储模拟 [@x380kkm 2026-06-13] ////
function makeConfigStore(initial = {}) {
  const state = { global: initial };
  return {
    state,
    async read() { return state.global || null; },
    async write(layer, scopeId, value) { state.global = value; },
  };
}

//// 装配 deps,注册前先复位 router [@x380kkm 2026-06-13] ////
function setup(overrides = {}) {
  router.reset();
  const backend = overrides.backend || makeBackend();
  const fs = overrides.fs || fakeFs();
  const configStore = overrides.configStore || makeConfigStore();
  const deps = {
    router,
    speechBackend: backend,
    configStore,
    resolveDefaultAudioDir: () => '/audio',
    fs,
    path: fakePath,
  };
  handlers.registerAudioHandlers(deps);
  return { deps, backend, fs, configStore };
}

//// 生成逐短语合成并写成编号 WAV,持久化短语列表 [@x380kkm 2026-06-13] ////
test('generate-default-audio synthesizes each phrase and persists the list', async () => {
  const { fs, configStore } = setup();
  const result = await router.dispatch('generate-default-audio', [['あ', 'い'], 3]);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.results.length, 2);
  assert.ok(fs.calls.written.some((w) => w.p === '/audio/default_0.wav'));
  assert.ok(fs.calls.written.some((w) => w.p === '/audio/default_1.wav'));
  assert.deepStrictEqual(configStore.state.global.tts.defaultPhrases, ['あ', 'い']);
});

//// 生成用传入风格合成后恢复原风格 [@x380kkm 2026-06-13] ////
test('generate-default-audio applies the style then restores it', async () => {
  const backend = makeBackend();
  backend.styleId = 1;
  setup({ backend });
  await router.dispatch('generate-default-audio', [['あ'], 9]);
  assert.strictEqual(backend.styleId, 1);
});

//// 生成前清空目录里已有的旧 WAV 片段 [@x380kkm 2026-06-13] ////
test('generate-default-audio clears stale clips first', async () => {
  const fs = fakeFs({ '/audio/default_0.wav': 'old', '/audio/keep.txt': 'x' });
  setup({ fs });
  await router.dispatch('generate-default-audio', [['new'], 0]);
  assert.ok(fs.calls.unlink.includes('/audio/default_0.wav'));
  assert.ok(!fs.calls.unlink.includes('/audio/keep.txt'));
});

//// 单条短语合成失败时记为不成功而不中断其余 [@x380kkm 2026-06-13] ////
test('generate-default-audio marks a failed phrase without aborting', async () => {
  const backend = makeBackend({ synthesize: (t) => (t === 'bad' ? null : Buffer.from('ok')) });
  setup({ backend });
  const result = await router.dispatch('generate-default-audio', [['ok', 'bad'], 0]);
  assert.strictEqual(result.results[0].success, true);
  assert.strictEqual(result.results[1].success, false);
});

//// 后端不可用时生成安全失败 [@x380kkm 2026-06-13] ////
test('generate-default-audio fails safely when backend unavailable', async () => {
  setup({ backend: makeBackend({ available: false }) });
  const result = await router.dispatch('generate-default-audio', [['あ'], 0]);
  assert.strictEqual(result.success, false);
  assert.match(result.error, /not available/);
});

//// 加载读回目录里全部 WAV 并转 base64 [@x380kkm 2026-06-13] ////
test('load-default-audio reads clips back as base64', async () => {
  const fs = fakeFs({
    '/audio/default_0.wav': Buffer.from('one'),
    '/audio/default_1.wav': Buffer.from('two'),
    '/audio/notes.txt': 'skip',
  });
  setup({ fs });
  const result = await router.dispatch('load-default-audio', null);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.files.length, 2);
  const names = result.files.map((f) => f.name).sort();
  assert.deepStrictEqual(names, ['default_0.wav', 'default_1.wav']);
  assert.strictEqual(Buffer.from(result.files[0].base64, 'base64').toString(), 'one');
});

//// 目录不存在时加载返回空列表 [@x380kkm 2026-06-13] ////
test('load-default-audio returns an empty list when dir is absent', async () => {
  const fs = fakeFs();
  fs.existsSync = () => false;
  setup({ fs });
  const result = await router.dispatch('load-default-audio', null);
  assert.deepStrictEqual(result, { success: true, files: [] });
});
