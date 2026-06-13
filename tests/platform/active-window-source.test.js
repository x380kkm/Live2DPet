// 用注入的假 active-win 断言 active-window-source 的行为契约,不触真实第三方包。
const { test } = require('node:test');
const assert = require('node:assert');
const { createActiveWindowSource } = require('../../src/platform/electron/active-window-source');

// 造一个产出给定结果的假 active-win 模块,default 为查活动窗口、getOpenWindows 为列窗口
function makeModule({ active, windows, throwOn } = {}) {
  return {
    default: async () => { if (throwOn === 'active') throw new Error('boom'); return active; },
    getOpenWindows: async () => { if (throwOn === 'windows') throw new Error('boom'); return windows; }
  };
}

test('current 命中活动窗口时返回成功与数据', async () => {
  const src = createActiveWindowSource({ loadActiveWin: async () => makeModule({ active: { title: 'A' } }) });
  assert.deepStrictEqual(await src.current(), { success: true, data: { title: 'A' } });
});

test('current 无活动窗口时折成失败', async () => {
  const src = createActiveWindowSource({ loadActiveWin: async () => makeModule({ active: null }) });
  const result = await src.current();
  assert.strictEqual(result.success, false);
  assert.match(result.error, /no active window/);
});

test('current 底层抛错时折成失败', async () => {
  const src = createActiveWindowSource({ loadActiveWin: async () => makeModule({ throwOn: 'active' }) });
  const result = await src.current();
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'boom');
});

test('openWindows 返回成功与窗口列表', async () => {
  const src = createActiveWindowSource({ loadActiveWin: async () => makeModule({ windows: ['a', 'b'] }) });
  assert.deepStrictEqual(await src.openWindows(), { success: true, data: ['a', 'b'] });
});

test('openWindows 列表为空值时归一成空数组', async () => {
  const src = createActiveWindowSource({ loadActiveWin: async () => makeModule({ windows: null }) });
  assert.deepStrictEqual(await src.openWindows(), { success: true, data: [] });
});

test('openWindows 底层抛错时折成失败', async () => {
  const src = createActiveWindowSource({ loadActiveWin: async () => makeModule({ throwOn: 'windows' }) });
  const result = await src.openWindows();
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'boom');
});

test('模块仅以函数形式导出时也能调到活动窗口查询', async () => {
  const fn = async () => ({ title: 'flat' });
  fn.getOpenWindows = async () => ['w'];
  const src = createActiveWindowSource({ loadActiveWin: async () => fn });
  assert.deepStrictEqual(await src.current(), { success: true, data: { title: 'flat' } });
});
