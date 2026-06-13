// 断言 model-renderer 公共接口的行为契约:动作解析、口型钳制、未实现的基类抛错。
const { test } = require('node:test');
const assert = require('node:assert');

// model-renderer 是 ESM(渲染侧),用动态 import 载入。
const loadModule = () => import('../../src/platform/render/model-renderer.js');

test('resolveAction 把表情项解析成 expression 形态', async () => {
  const { resolveAction } = await loadModule();
  const table = { happy: { kind: 'expression', file: 'happy.exp3.json' } };
  assert.deepStrictEqual(resolveAction(table, 'happy'), { kind: 'expression', name: 'happy' });
});

test('resolveAction 把动作项解析成 motion 形态并带 group 与 index', async () => {
  const { resolveAction } = await loadModule();
  const table = { wave: { kind: 'motion', group: 'TapBody', index: 2 } };
  assert.deepStrictEqual(resolveAction(table, 'wave'), {
    kind: 'motion', name: 'wave', group: 'TapBody', index: 2
  });
});

test('resolveAction 对未知动作名返回空', async () => {
  const { resolveAction } = await loadModule();
  assert.strictEqual(resolveAction({}, 'unknown'), null);
});

test('clampOpenness 把超出 0 到 1 的值钳到边界', async () => {
  const { clampOpenness } = await loadModule();
  assert.strictEqual(clampOpenness(-0.5), 0);
  assert.strictEqual(clampOpenness(1.5), 1);
  assert.strictEqual(clampOpenness(0.3), 0.3);
});

test('clampOpenness 对非数字与 NaN 回退到 0', async () => {
  const { clampOpenness } = await loadModule();
  assert.strictEqual(clampOpenness(undefined), 0);
  assert.strictEqual(clampOpenness(NaN), 0);
  assert.strictEqual(clampOpenness('x'), 0);
});

test('RenderAdapter 基类四个语义方法都抛未实现', async () => {
  const { RenderAdapter } = await loadModule();
  const adapter = new RenderAdapter();
  assert.throws(() => adapter.playAction('happy'), /未实现/);
  assert.throws(() => adapter.setMouth(0.5), /未实现/);
  assert.throws(() => adapter.hitTest({ x: 0, y: 0 }), /未实现/);
  assert.throws(() => adapter.dispose(), /未实现/);
});
