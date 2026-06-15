// audience: internal
// # situation-digest-source.test
// 运行: node --test tests/domain/sources/situation-digest-source.test.js
// 验证态势摘要源契约:id 取引用名、取最新关键帧态势、无态势返回 null、按字符数估 token。

const { test } = require('node:test');
const assert = require('node:assert');
const { ContextSource } = require('../../../src/domain/pet/context-source');
const { SituationDigestSource } = require('../../../src/domain/pet/sources/situation-digest-source');

//// 假抽取器:keyframes 返回预置选集 [@x380kkm 2026-06-13] ////
function fakeExtractor(frames) {
  return { keyframes() { return frames; } };
}

test('id 默认取意图引用名 situationDigest 且为上下文源', () => {
  const source = new SituationDigestSource({ extractor: fakeExtractor([]) });
  assert.strictEqual(source.id, 'situationDigest');
  assert.ok(source instanceof ContextSource);
});

test('render 取最新关键帧的态势', () => {
  const source = new SituationDigestSource({
    extractor: fakeExtractor([{ situation: '在写代码' }, { situation: '更早的态势' }])
  });
  assert.strictEqual(source.render({}), '在写代码');
});

test('render 带标签时前缀态势', () => {
  const source = new SituationDigestSource(
    { extractor: fakeExtractor([{ situation: '在看文档' }]) },
    { label: '当前态势:' }
  );
  assert.strictEqual(source.render({}), '当前态势:在看文档');
});

test('render 无关键帧返回 null', () => {
  const source = new SituationDigestSource({ extractor: fakeExtractor([]) });
  assert.strictEqual(source.render({}), null);
});

test('render 缺抽取器返回 null', () => {
  const source = new SituationDigestSource({});
  assert.strictEqual(source.render({}), null);
});

test('render 超长态势按 maxLen 截断', () => {
  const long = 'x'.repeat(20);
  const source = new SituationDigestSource(
    { extractor: fakeExtractor([{ situation: long }]) },
    { maxLen: 5 }
  );
  assert.strictEqual(source.render({}), 'xxxxx');
});

test('estimateTokens 据渲染片段字符数粗估', () => {
  const source = new SituationDigestSource({
    extractor: fakeExtractor([{ situation: 'abcd' }]) // 4 字符 → 1 token
  });
  assert.strictEqual(source.estimateTokens({}), 1);
});

test('estimateTokens 无态势为 0', () => {
  const source = new SituationDigestSource({ extractor: fakeExtractor([]) });
  assert.strictEqual(source.estimateTokens({}), 0);
});

test('构造配置可覆盖 priority', () => {
  const source = new SituationDigestSource({ extractor: fakeExtractor([]) }, { priority: 7 });
  assert.strictEqual(source.priority, 7);
});
