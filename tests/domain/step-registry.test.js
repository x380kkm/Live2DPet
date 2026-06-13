// 运行:node --test tests/domain/step-registry.test.js
// 验证步骤注册表的契约:发现注入、去重覆盖、非法拒绝、可枚举、从 mod 注入可追溯。
const { test } = require('node:test');
const assert = require('node:assert');
const { StepRegistry } = require('../../src/domain/model/step-registry');
const { builtinSteps } = require('../../src/shared/step-catalog');

test('出厂步骤逐条发现注入后可枚举', () => {
  const reg = new StepRegistry();
  reg.discoverBuiltins(builtinSteps());
  assert.strictEqual(reg.list().length, builtinSteps().length);
  assert.ok(reg.get('dialogue'));
});

test('缺 id 或非法大类的步骤被拒绝', () => {
  const reg = new StepRegistry();
  assert.throws(() => reg.register({ category: 'llm' }), /id/);
  assert.throws(() => reg.register({ id: 'x', category: 'nope' }), /大类/);
});

test('同 id 后注册者覆盖先注册者', () => {
  const reg = new StepRegistry();
  reg.register({ id: 'dialogue', category: 'llm', label: '旧' });
  reg.register({ id: 'dialogue', category: 'llm', label: '新' });
  assert.strictEqual(reg.list().length, 1);
  assert.strictEqual(reg.get('dialogue').label, '新');
});

test('从 mod 的 aiSteps 声明注入并记下来源', () => {
  const reg = new StepRegistry();
  reg.discoverFromMods([{ id: 'minigame', aiSteps: [{ id: 'minigameHint', category: 'llm', label: '小游戏提示' }] }]);
  const step = reg.get('minigameHint');
  assert.strictEqual(step.origin, 'mod:minigame');
});

test('未命中返回 null', () => {
  const reg = new StepRegistry();
  assert.strictEqual(reg.get('missing'), null);
});
