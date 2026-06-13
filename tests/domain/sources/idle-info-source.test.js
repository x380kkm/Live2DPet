// audience: internal
// # idle-info-source.test
// 运行: node --test tests/domain/sources/idle-info-source.test.js
// 验证空闲源契约:id 取引用名、达阈值代入标签模板、不足阈值返回 null、退而取作用域字段、按字符数估 token。

const { test } = require('node:test');
const assert = require('node:assert');
const { ContextSource } = require('../../../src/domain/pet/context-source');
const { IdleInfoSource } = require('../../../src/domain/pet/sources/idle-info-source');

test('id 默认取意图引用名 idleInfo 且为上下文源', () => {
  const source = new IdleInfoSource({ idleProvider: () => 0 });
  assert.strictEqual(source.id, 'idleInfo');
  assert.ok(source instanceof ContextSource);
});

test('render 达阈值时把秒数代入标签模板', () => {
  const source = new IdleInfoSource(
    { idleProvider: () => 120 },
    { labelTemplate: '用户已空闲 {0} 秒' }
  );
  assert.strictEqual(source.render({}), '用户已空闲 120 秒');
});

test('render 不足阈值返回 null', () => {
  const source = new IdleInfoSource({ idleProvider: () => 30 }, { thresholdSec: 60 });
  assert.strictEqual(source.render({}), null);
});

test('render 恰达阈值时给出片段', () => {
  const source = new IdleInfoSource({ idleProvider: () => 60 }, { thresholdSec: 60 });
  assert.strictEqual(source.render({}), '60');
});

test('render 缺取数函数时退而取作用域 idleSeconds', () => {
  const source = new IdleInfoSource({});
  assert.strictEqual(source.render({ idleSeconds: 90 }), '90');
});

test('render 无空闲秒数返回 null', () => {
  const source = new IdleInfoSource({});
  assert.strictEqual(source.render({}), null);
});

test('render 空闲秒数非数返回 null', () => {
  const source = new IdleInfoSource({ idleProvider: () => 'NaN' });
  assert.strictEqual(source.render({}), null);
});

test('estimateTokens 据渲染片段字符数粗估', () => {
  const source = new IdleInfoSource({ idleProvider: () => 1234 }, { thresholdSec: 0, labelTemplate: '{0}' });
  // "1234" 4 字符 → 1 token
  assert.strictEqual(source.estimateTokens({}), 1);
});

test('estimateTokens 不足阈值为 0', () => {
  const source = new IdleInfoSource({ idleProvider: () => 5 }, { thresholdSec: 60 });
  assert.strictEqual(source.estimateTokens({}), 0);
});
