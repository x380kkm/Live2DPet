// audience: internal
// # tone-hint-source.test
// 运行: node --test tests/domain/sources/tone-hint-source.test.js
// 验证语气提示源契约:id 取引用名、情绪代入模板、退用作用域字段、无情绪返回 null、按字符数估 token。

const { test } = require('node:test');
const assert = require('node:assert');
const { ContextSource } = require('../../../src/domain/pet/context-source');
const { ToneHintSource } = require('../../../src/domain/pet/sources/tone-hint-source');

test('id 默认取意图引用名 toneHint 且为上下文源', () => {
  const source = new ToneHintSource({ toneProvider: () => null });
  assert.strictEqual(source.id, 'toneHint');
  assert.ok(source instanceof ContextSource);
});

test('render 把情绪代入标签模板', () => {
  const source = new ToneHintSource(
    { toneProvider: () => '开心' },
    { labelTemplate: '让语气自然地反映这个情绪: {0}' }
  );
  assert.strictEqual(source.render({}), '让语气自然地反映这个情绪: 开心');
});

test('render 缺省模板直接给情绪标签', () => {
  const source = new ToneHintSource({ toneProvider: () => '好奇' });
  assert.strictEqual(source.render({}), '好奇');
});

test('render 缺取数函数时退用作用域字段', () => {
  const source = new ToneHintSource({});
  assert.strictEqual(source.render({ nextEmotion: '惊讶' }), '惊讶');
});

test('render 取数函数优先于作用域字段', () => {
  const source = new ToneHintSource({ toneProvider: () => '生气' });
  assert.strictEqual(source.render({ nextEmotion: '平静' }), '生气');
});

test('render 无预定情绪返回 null', () => {
  const source = new ToneHintSource({ toneProvider: () => null });
  assert.strictEqual(source.render({}), null);
});

test('render 空白情绪返回 null', () => {
  const source = new ToneHintSource({ toneProvider: () => '   ' });
  assert.strictEqual(source.render({}), null);
});

test('render 缺取数函数且作用域无字段返回 null', () => {
  const source = new ToneHintSource({});
  assert.strictEqual(source.render({}), null);
});

test('estimateTokens 据渲染片段字符数粗估', () => {
  const source = new ToneHintSource({ toneProvider: () => 'calm' }); // "calm" 4 字符 → 1 token
  assert.strictEqual(source.estimateTokens({}), 1);
});

test('estimateTokens 无情绪为 0', () => {
  const source = new ToneHintSource({ toneProvider: () => null });
  assert.strictEqual(source.estimateTokens({}), 0);
});
