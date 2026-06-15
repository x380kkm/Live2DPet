// 验证 util-handlers 的契约:配置读写经总线发布、系统信息直放、外发与文件能力经网关门控。
const { test } = require('node:test');
const assert = require('node:assert');

const router = require('../../../src/platform/ipc/ipc-router');
const gateway = require('../../../src/platform/ipc/capability-gateway');
const { EventBus } = require('../../../src/platform/bus/event-bus');
const { registerUtilHandlers, makeUtilExecutor, CONFIG_SAVED } = require('../../../src/platform/ipc/handlers/util-handlers');

// 造一组可观察的协作者:记录落盘、外发、搜索、日志、增强数据读写 [@x380kkm 2026-06-13]
function makeDeps({ isValidUrl = () => true } = {}) {
  const calls = { saved: [], opened: [], searched: [], logged: [], enhanceSaved: [] };
  const configStore = {
    load: async () => ({ apiKey: 'k' }),
    save: async (data) => { calls.saved.push(data); return { success: true }; }
  };
  const appInfo = { appPath: () => '/app' };
  const logSink = { write: (level, args) => calls.logged.push({ level, args }) };
  const shell = { openExternal: async (url) => { calls.opened.push(url); } };
  const searchSource = { search: async (q, p, o) => { calls.searched.push({ q, p, o }); return { success: true, results: 'r' }; } };
  const enhanceStore = {
    load: async () => ({ success: true, data: { k: 1 } }),
    save: async (data) => { calls.enhanceSaved.push(data); return { success: true }; }
  };
  return { calls, configStore, appInfo, logSink, shell, searchSource, enhanceStore, isValidUrl };
}

// 把真实 router、真实总线、真实网关装好,网关用自动确认并以工具执行器作执行体 [@x380kkm 2026-06-13]
function setup(opts = {}) {
  router.reset();
  const bus = new EventBus();
  const d = makeDeps(opts);
  gateway.configure({
    executor: makeUtilExecutor({ shell: d.shell, searchSource: d.searchSource, enhanceStore: d.enhanceStore, isValidUrl: d.isValidUrl }),
    confirm: async () => true,
    masterEnabled: () => true
  });
  registerUtilHandlers({
    router, gateway, bus,
    configStore: d.configStore, appInfo: d.appInfo, enhanceStore: d.enhanceStore, logSink: d.logSink,
    scope: 'util-test'
  });
  return { bus, calls: d.calls };
}

test('load-config 直放,返回配置存储读出的配置', async () => {
  setup();
  const result = await router.dispatch('load-config', null);
  assert.deepStrictEqual(result, { apiKey: 'k' });
});

test('save-config 落盘后把保存事件发上总线', async () => {
  const { bus, calls } = setup();
  const seen = [];
  bus.subscribe(CONFIG_SAVED, (e) => seen.push(e.config));
  const result = await router.dispatch('save-config', { model: 'm' });
  assert.deepStrictEqual(result, { success: true });
  assert.deepStrictEqual(calls.saved, [{ model: 'm' }]);
  assert.deepStrictEqual(seen, [{ model: 'm' }]);
});

test('get-app-path 与 get-gender-term 为无害系统信息,直放', async () => {
  setup();
  assert.strictEqual(await router.dispatch('get-app-path', null), '/app');
  assert.deepStrictEqual(await router.dispatch('get-gender-term', null), { success: true, term: 'you' });
});

test('renderer-log 按级别把渲染侧日志落到日志槽', async () => {
  const { calls } = setup();
  await router.dispatch('renderer-log', { level: 'warn', args: ['a', 'b'] });
  assert.deepStrictEqual(calls.logged, [{ level: 'warn', args: ['a', 'b'] }]);
});

test('open-external 经网关委托打开外链', async () => {
  const { calls } = setup();
  const result = await router.dispatch('open-external', 'https://example.com');
  assert.deepStrictEqual(result, { success: true });
  assert.deepStrictEqual(calls.opened, ['https://example.com']);
  gateway.revoke('open-external', 'util-test');
});

test('open-external 对非法 URL 在执行器内被拒,不触 shell', async () => {
  const { calls } = setup({ isValidUrl: (u) => u.startsWith('https://') });
  const result = await router.dispatch('open-external', 'javascript:alert(1)');
  assert.strictEqual(result.success, false);
  assert.match(result.error, /invalid URL/);
  assert.strictEqual(calls.opened.length, 0);
  gateway.revoke('open-external', 'util-test');
});

test('web-search 经网关把查询委托搜索源', async () => {
  const { calls } = setup();
  const result = await router.dispatch('web-search', { query: 'cats', provider: 'duckduckgo', options: { x: 1 } });
  assert.deepStrictEqual(result, { success: true, results: 'r' });
  assert.deepStrictEqual(calls.searched, [{ q: 'cats', p: 'duckduckgo', o: { x: 1 } }]);
  gateway.revoke('web-search', 'util-test');
});

test('save-enhance-data 经网关委托增强数据落盘', async () => {
  const { calls } = setup();
  const result = await router.dispatch('save-enhance-data', { note: 1 });
  assert.deepStrictEqual(result, { success: true });
  assert.deepStrictEqual(calls.enhanceSaved, [{ note: 1 }]);
  gateway.revoke('save-enhance-data', 'util-test');
});

test('load-enhance-data 经网关委托增强数据读出', async () => {
  setup();
  const result = await router.dispatch('load-enhance-data', null);
  assert.deepStrictEqual(result, { success: true, data: { k: 1 } });
  gateway.revoke('load-enhance-data', 'util-test');
});

test('总闸关闭时外发被网关拒绝,不触 shell', async () => {
  router.reset();
  const bus = new EventBus();
  const d = makeDeps();
  gateway.configure({
    executor: makeUtilExecutor({ shell: d.shell, searchSource: d.searchSource, enhanceStore: d.enhanceStore, isValidUrl: d.isValidUrl }),
    confirm: async () => true,
    masterEnabled: () => false
  });
  registerUtilHandlers({ router, gateway, bus, configStore: d.configStore, appInfo: d.appInfo, enhanceStore: d.enhanceStore, logSink: d.logSink, scope: 'util-off' });
  const result = await router.dispatch('open-external', 'https://example.com');
  assert.strictEqual(result.success, false);
  assert.match(result.error, /master switch off/);
  assert.strictEqual(d.calls.opened.length, 0);
});

test('执行器对未支持的工具能力返回失败', async () => {
  const execute = makeUtilExecutor({ shell: {}, searchSource: {}, enhanceStore: {} });
  const result = await execute('unknown-cap', null);
  assert.strictEqual(result.success, false);
  assert.match(result.error, /未支持的工具能力/);
});
