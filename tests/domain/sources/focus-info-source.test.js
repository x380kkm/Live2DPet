// audience: internal
// # focus-info-source.test
// 运行: node --test tests/domain/sources/focus-info-source.test.js
// 验证窗口焦点源契约:id 取引用名、按秒数降序排前若干名、压短标题、无计数返回 null、按字符数估 token。

const { test } = require('node:test');
const assert = require('node:assert');
const { ContextSource } = require('../../../src/domain/pet/context-source');
const { FocusInfoSource } = require('../../../src/domain/pet/sources/focus-info-source');

test('id 默认取意图引用名 focusInfo 且为上下文源', () => {
  const source = new FocusInfoSource({ focusProvider: () => ({}) });
  assert.strictEqual(source.id, 'focusInfo');
  assert.ok(source instanceof ContextSource);
});

test('render 按累计秒数降序排列折成逗号串', () => {
  const source = new FocusInfoSource({
    focusProvider: () => ({ '编辑器': 30, '浏览器': 90, '终端': 10 })
  });
  assert.strictEqual(source.render({}), '浏览器: 90s, 编辑器: 30s, 终端: 10s');
});

test('render 只取前 topN 名', () => {
  const source = new FocusInfoSource(
    { focusProvider: () => ({ a: 5, b: 4, c: 3, d: 2 }) },
    { topN: 2 }
  );
  assert.strictEqual(source.render({}), 'a: 5s, b: 4s');
});

test('render 经注入的压缩函数压短标题', () => {
  const source = new FocusInfoSource({
    focusProvider: () => ({ '很长的窗口标题': 10 }),
    shortenTitle: (t) => t.slice(0, 3)
  });
  assert.strictEqual(source.render({}), '很长的: 10s');
});

test('render 带标签时前缀片段', () => {
  const source = new FocusInfoSource(
    { focusProvider: () => ({ '编辑器': 30 }) },
    { label: '窗口使用:' }
  );
  assert.strictEqual(source.render({}), '窗口使用:编辑器: 30s');
});

test('render 无焦点计数返回 null', () => {
  const source = new FocusInfoSource({ focusProvider: () => ({}) });
  assert.strictEqual(source.render({}), null);
});

test('render 滤掉零秒窗口', () => {
  const source = new FocusInfoSource({ focusProvider: () => ({ a: 0, b: 5 }) });
  assert.strictEqual(source.render({}), 'b: 5s');
});

test('render 缺取数函数返回 null', () => {
  const source = new FocusInfoSource({});
  assert.strictEqual(source.render({}), null);
});

test('estimateTokens 据渲染片段字符数粗估', () => {
  const source = new FocusInfoSource({ focusProvider: () => ({ ab: 1 }) }); // "ab: 1s" 6 字符 → 2 token
  assert.strictEqual(source.estimateTokens({}), 2);
});

test('estimateTokens 无焦点为 0', () => {
  const source = new FocusInfoSource({ focusProvider: () => ({}) });
  assert.strictEqual(source.estimateTokens({}), 0);
});
