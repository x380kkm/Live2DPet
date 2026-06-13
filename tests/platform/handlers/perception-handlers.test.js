// 验证 perception-handlers 的注册与门控契约:重能力经网关、空闲秒数直放、执行器派发正确。
const { test } = require('node:test');
const assert = require('node:assert');

const router = require('../../../src/platform/ipc/ipc-router');
const gateway = require('../../../src/platform/ipc/capability-gateway');
const { registerPerceptionHandlers, makePerceptionExecutor } = require('../../../src/platform/ipc/handlers/perception-handlers');

// 造记录调用的假屏幕源:captureScreen 回显入参,idleTime 给定值 [@busybee 2026-06-13]
function makeScreenSource(idle) {
  const calls = [];
  return {
    calls,
    screenSource: {
      captureScreen: async (opts) => { calls.push(opts); return `cap:${opts.targetTitle || 'screen'}@${opts.quality}`; },
      idleTime: () => idle
    }
  };
}

// 造记录调用的假活动窗口查询器 [@busybee 2026-06-13]
function makeActiveWindow() {
  return {
    activeWindow: {
      current: async () => ({ success: true, data: { title: 'active' } }),
      openWindows: async () => ({ success: true, data: ['a', 'b'] })
    }
  };
}

// 把真实 router 与真实网关装好,网关用自动确认并以感知执行器作执行体 [@busybee 2026-06-13]
function setup({ idle = 7 } = {}) {
  router.reset();
  const { screenSource, calls } = makeScreenSource(idle);
  const { activeWindow } = makeActiveWindow();
  gateway.configure({
    executor: makePerceptionExecutor({ screenSource, activeWindow }),
    confirm: async () => true,
    masterEnabled: () => true
  });
  registerPerceptionHandlers({ router, gateway, screenSource, activeWindow, scope: 'perc-test' });
  return { screenSource, activeWindow, calls };
}

test('get-screen-capture 经网关委托执行器,用标清档截屏', async () => {
  const { calls } = setup();
  const result = await router.dispatch('get-screen-capture', 'Notepad');
  assert.strictEqual(result, 'cap:Notepad@30');
  assert.deepStrictEqual(calls[0].thumbnailSize, { width: 512, height: 512 });
  gateway.revoke('get-screen-capture', 'perc-test');
});

test('get-screen-capture-hq 用高清档截屏', async () => {
  const { calls } = setup();
  const result = await router.dispatch('get-screen-capture-hq', 'Editor');
  assert.strictEqual(result, 'cap:Editor@40');
  assert.deepStrictEqual(calls[0].thumbnailSize, { width: 768, height: 768 });
  gateway.revoke('get-screen-capture-hq', 'perc-test');
});

test('get-active-window 经网关委托活动窗口查询', async () => {
  setup();
  const result = await router.dispatch('get-active-window', null);
  assert.deepStrictEqual(result, { success: true, data: { title: 'active' } });
  gateway.revoke('get-active-window', 'perc-test');
});

test('get-open-windows 经网关委托开窗列表查询', async () => {
  setup();
  const result = await router.dispatch('get-open-windows', null);
  assert.deepStrictEqual(result, { success: true, data: ['a', 'b'] });
  gateway.revoke('get-open-windows', 'perc-test');
});

test('get-system-idle-time 为无害能力,直放不经网关', async () => {
  setup({ idle: 42 });
  const result = await router.dispatch('get-system-idle-time', null);
  assert.strictEqual(result, 42);
});

test('总闸关闭时截屏被网关拒绝,不触屏幕源', async () => {
  router.reset();
  const { screenSource, calls } = makeScreenSource(0);
  const { activeWindow } = makeActiveWindow();
  gateway.configure({
    executor: makePerceptionExecutor({ screenSource, activeWindow }),
    confirm: async () => true,
    masterEnabled: () => false
  });
  registerPerceptionHandlers({ router, gateway, screenSource, activeWindow, scope: 'perc-off' });
  const result = await router.dispatch('get-screen-capture', 'X');
  assert.strictEqual(result.success, false);
  assert.match(result.error, /master switch off/);
  assert.strictEqual(calls.length, 0);
});

test('用户拒绝确认时截屏不执行', async () => {
  router.reset();
  const { screenSource, calls } = makeScreenSource(0);
  const { activeWindow } = makeActiveWindow();
  gateway.configure({
    executor: makePerceptionExecutor({ screenSource, activeWindow }),
    confirm: async () => false,
    masterEnabled: () => true
  });
  registerPerceptionHandlers({ router, gateway, screenSource, activeWindow, scope: 'perc-deny' });
  const result = await router.dispatch('get-screen-capture', 'X');
  assert.strictEqual(result.success, false);
  assert.match(result.error, /denied/);
  assert.strictEqual(calls.length, 0);
});

test('执行器对未支持的感知能力返回失败', async () => {
  const execute = makePerceptionExecutor({ screenSource: {}, activeWindow: {} });
  const result = await execute('unknown-cap', null);
  assert.strictEqual(result.success, false);
  assert.match(result.error, /未支持的感知能力/);
});
