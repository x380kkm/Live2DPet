// 验证 ipc-router 的注册与分发契约:通道校验、try/catch 收敛、存活判断。
const { test } = require('node:test');
const assert = require('node:assert');

const router = require('../../src/platform/ipc/ipc-router');

test('register 拒绝未在契约目录里声明的通道', () => {
  router.reset();
  assert.throws(() => router.register('not-a-channel', () => {}), /未声明的通道/);
});

test('register 拒绝非函数处理器', () => {
  router.reset();
  assert.throws(() => router.register('load-config', 123), /不是函数/);
});

test('register 拒绝重复注册同一通道', () => {
  router.reset();
  router.register('load-config', () => ({ success: true }));
  assert.throws(() => router.register('load-config', () => ({})), /已注册/);
});

test('dispatch 调用已注册处理器并返回其结果', async () => {
  router.reset();
  router.register('save-config', async (payload) => ({ success: true, echo: payload }));
  const result = await router.dispatch('save-config', { a: 1 });
  assert.deepStrictEqual(result, { success: true, echo: { a: 1 } });
});

test('dispatch 对未注册通道归一成失败对象而非抛出', async () => {
  router.reset();
  const result = await router.dispatch('save-config', {});
  assert.strictEqual(result.success, false);
  assert.match(result.error, /未注册/);
});

test('dispatch 把处理器抛出的错误收敛成失败对象', async () => {
  router.reset();
  router.register('save-config', async () => { throw new Error('boom'); });
  const result = await router.dispatch('save-config', {});
  assert.deepStrictEqual(result, { success: false, error: 'boom' });
});

test('isAlive 对存活窗口为真,对已销毁或缺失窗口为假', () => {
  assert.strictEqual(router.isAlive({ isDestroyed: () => false }), true);
  assert.strictEqual(router.isAlive({ isDestroyed: () => true }), false);
  assert.strictEqual(router.isAlive(null), false);
  assert.strictEqual(router.isAlive({}), false);
});

test('reset 清空已注册处理器', async () => {
  router.reset();
  router.register('load-config', async () => ({ success: true }));
  router.reset();
  const result = await router.dispatch('load-config', {});
  assert.strictEqual(result.success, false);
});
