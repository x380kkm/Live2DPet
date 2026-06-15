// audience: internal
// # ipc-behavior.integration.test
// 行为仿真:用真实 ipc-router 注册真实处理器(util-handlers 的配置读写、emotion-handlers 的表情转发、
// ui-handlers 的气泡推送),只把窄接口依赖(配置仓储、窗口句柄、事件总线)换成 mock 与内存实现。
// 模拟 invoke 关键通道,断言返回值或经事件总线、窗口转发的负载。

const { test } = require('node:test');
const assert = require('node:assert');

const router = require('../../src/platform/ipc/ipc-router');
const { EventBus } = require('../../src/platform/bus/event-bus');
const { ConfigStore } = require('../../src/platform/config/config-store');
const { registerUtilHandlers } = require('../../src/platform/ipc/handlers/util-handlers');
const { registerEmotionHandlers } = require('../../src/platform/ipc/handlers/emotion-handlers');
const { registerUiHandlers } = require('../../src/platform/ipc/handlers/ui-handlers');

//// 内存仓储:实现 ConfigStore 期待的 get/put 键值接口 [@x380kkm 2026-06-13] ////
function memoryRepository(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    }
  };
}

//// 把真实 ConfigStore 适配成 util-handlers 期待的扁平 load/save 窄接口 [@x380kkm 2026-06-13] ////
// 与组合根 handler-assembly.makeFlatConfig 同形:全局层只有一份,scopeId 被忽略。
function flatConfig(configStore) {
  return {
    async load() {
      return (await configStore.read('global', 'global')) || {};
    },
    async save(data) {
      await configStore.write('global', 'global', data || {});
      return { success: true };
    }
  };
}

//// 记录每次 send 的假窗口句柄:webContents.send 与 send 两种调用形态都记下 [@x380kkm 2026-06-13] ////
function fakeWindow() {
  const sent = [];
  const record = (channel, args) => sent.push({ channel, args });
  return {
    sent,
    destroyed: false,
    isDestroyed() {
      return this.destroyed;
    },
    // emotion-handlers 转发经 webContents.send。
    webContents: { send: (channel, ...args) => record(channel, args) },
    // ui-handlers 经窗口句柄的 send。
    send: (channel, ...args) => record(channel, args)
  };
}

//// 配置读写:load-config 经真实 ConfigStore 回读种子配置 [@x380kkm 2026-06-13] ////
test('load-config 经真实 ConfigStore 回读已存的全局配置', async () => {
  router.reset();
  const bus = new EventBus();
  const repo = memoryRepository({ 'config/global': { model: { type: 'live2d' }, apiKey: 'k' } });
  const configStore = new ConfigStore(repo);
  registerUtilHandlers({
    router, bus, gateway: { invoke: async () => ({}) },
    configStore: flatConfig(configStore),
    appInfo: { appPath: () => '/app' },
    logSink: { write() {} }
  });

  const result = await router.dispatch('load-config', null);

  assert.deepStrictEqual(result, { model: { type: 'live2d' }, apiKey: 'k' });
});

//// save-config:落盘后经事件总线发布配置已保存事件供热重载 [@x380kkm 2026-06-13] ////
test('save-config 落盘后经事件总线发布 ConfigSaved', async () => {
  router.reset();
  const bus = new EventBus();
  const repo = memoryRepository();
  const configStore = new ConfigStore(repo);
  registerUtilHandlers({
    router, bus, gateway: { invoke: async () => ({}) },
    configStore: flatConfig(configStore),
    appInfo: { appPath: () => '/app' },
    logSink: { write() {} }
  });

  const saved = [];
  bus.subscribe('ConfigSaved', (e) => saved.push(e));

  const result = await router.dispatch('save-config', { model: { type: 'none' } });

  assert.deepStrictEqual(result, { success: true });
  assert.strictEqual(saved.length, 1);
  assert.deepStrictEqual(saved[0].config, { model: { type: 'none' } });
  // 真落盘:回读应拿到刚写的整份配置。
  const back = await router.dispatch('load-config', null);
  assert.deepStrictEqual(back, { model: { type: 'none' } });
});

//// trigger-expression:经事件总线把信号转发到宠物窗口的 play-expression 通道 [@x380kkm 2026-06-13] ////
test('trigger-expression 经事件总线转发到宠物窗口 play-expression', async () => {
  router.reset();
  const bus = new EventBus();
  const petWindow = fakeWindow();
  registerEmotionHandlers({
    router, bus,
    petWindow: () => petWindow,
    settingsWindow: () => null
  });

  const result = await router.dispatch('trigger-expression', 'happy');

  // 处理器只回执成功,转发由订阅者完成。
  assert.deepStrictEqual(result, { success: true });
  assert.deepStrictEqual(petWindow.sent, [{ channel: 'play-expression', args: ['happy'] }]);
});

//// show-pet-chat:经气泡控制器把发言文本显示到独立气泡窗口 [@x380kkm 2026-06-14] ////
test('show-pet-chat 经气泡控制器显示发言', async () => {
  router.reset();
  const bubble = { calls: [], show(m, t) { this.calls.push([m, t]); }, resize() {}, hide() {} };
  registerUiHandlers({
    router,
    getPetWindow: () => fakeWindow(),
    getSettingsWindow: () => null,
    isAlive: (w) => router.isAlive(w),
    bubble
  });

  // ipc-router 约定多参通道收到参数数组。
  const result = await router.dispatch('show-pet-chat', ['你好呀', 5000]);

  assert.deepStrictEqual(result, { success: true });
  assert.deepStrictEqual(bubble.calls, [['你好呀', 5000]]);
});

//// show-pet-chat 未注入气泡控制器时走无害空实现,不抛错仍回成功 [@x380kkm 2026-06-14] ////
test('show-pet-chat 缺气泡控制器时仍回成功', async () => {
  router.reset();
  registerUiHandlers({
    router,
    getPetWindow: () => null,
    getSettingsWindow: () => null,
    isAlive: (w) => router.isAlive(w)
  });

  const result = await router.dispatch('show-pet-chat', ['x']);

  assert.deepStrictEqual(result, { success: true });
});
