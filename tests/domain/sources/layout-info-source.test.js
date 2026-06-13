// audience: internal
// # layout-info-source.test
// 运行: node --test tests/domain/sources/layout-info-source.test.js
// 验证桌面布局源契约:id 取引用名、滤略过应用与小窗、取前若干名、行数不足下限返回 null、按字符数估 token。

const { test } = require('node:test');
const assert = require('node:assert');
const { ContextSource } = require('../../../src/domain/pet/context-source');
const { LayoutInfoSource } = require('../../../src/domain/pet/sources/layout-info-source');

//// 造一个可见窗口条目:有归属名、有超下限尺寸 [@busybee 2026-06-13] ////
function win(title, width, height, ownerName) {
  return { title, owner: { name: ownerName || title }, bounds: { width, height } };
}
//// /造一个可见窗口条目 ////

test('id 默认取意图引用名 layoutInfo 且为上下文源', () => {
  const source = new LayoutInfoSource({ windowsProvider: () => [] });
  assert.strictEqual(source.id, 'layoutInfo');
  assert.ok(source instanceof ContextSource);
});

test('render 折成「标题 [宽x高]」逗号串', () => {
  const source = new LayoutInfoSource({
    windowsProvider: () => [win('编辑器', 800, 600), win('浏览器', 1200, 900), win('终端', 400, 300)]
  });
  assert.strictEqual(source.render({}), '编辑器 [800x600], 浏览器 [1200x900], 终端 [400x300]');
});

test('render 滤掉宽高不超下限的小窗', () => {
  const source = new LayoutInfoSource(
    {
      windowsProvider: () => [win('a', 800, 600), win('小窗', 100, 100), win('b', 800, 600), win('c', 800, 600)]
    },
    { minLines: 1 }
  );
  assert.strictEqual(source.render({}), 'a [800x600], b [800x600], c [800x600]');
});

test('render 经注入的略过判定滤掉自身窗口', () => {
  const source = new LayoutInfoSource(
    {
      windowsProvider: () => [win('a', 800, 600), win('宠物', 800, 600, 'desktop-pet'), win('b', 800, 600)],
      shouldSkipApp: (name) => name.includes('desktop-pet')
    },
    { minLines: 1 }
  );
  assert.strictEqual(source.render({}), 'a [800x600], b [800x600]');
});

test('render 只取前 topN 名', () => {
  const source = new LayoutInfoSource(
    { windowsProvider: () => [win('a', 800, 600), win('b', 800, 600), win('c', 800, 600)] },
    { topN: 2, minLines: 1 }
  );
  assert.strictEqual(source.render({}), 'a [800x600], b [800x600]');
});

test('render 经注入的压缩函数压短标题', () => {
  const source = new LayoutInfoSource(
    {
      windowsProvider: () => [win('很长的窗口标题', 800, 600)],
      shortenTitle: (t) => t.slice(0, 3)
    },
    { minLines: 1 }
  );
  assert.strictEqual(source.render({}), '很长的 [800x600]');
});

test('render 标题缺失时退用归属名', () => {
  const source = new LayoutInfoSource(
    { windowsProvider: () => [{ title: '', owner: { name: '应用' }, bounds: { width: 800, height: 600 } }] },
    { minLines: 1 }
  );
  assert.strictEqual(source.render({}), '应用 [800x600]');
});

test('render 带标签时前缀片段', () => {
  const source = new LayoutInfoSource(
    { windowsProvider: () => [win('a', 800, 600)] },
    { minLines: 1, label: '桌面布局:' }
  );
  assert.strictEqual(source.render({}), '桌面布局:a [800x600]');
});

test('render 入选窗口数不足下限返回 null', () => {
  const source = new LayoutInfoSource({
    windowsProvider: () => [win('a', 800, 600), win('b', 800, 600)]
  });
  assert.strictEqual(source.render({}), null);
});

test('render 无窗口返回 null', () => {
  const source = new LayoutInfoSource({ windowsProvider: () => [] });
  assert.strictEqual(source.render({}), null);
});

test('render 缺取数函数返回 null', () => {
  const source = new LayoutInfoSource({});
  assert.strictEqual(source.render({}), null);
});

test('estimateTokens 据渲染片段字符数粗估', () => {
  const source = new LayoutInfoSource(
    { windowsProvider: () => [win('a', 1, 1), win('b', 1, 1), win('c', 1, 1)] },
    { minSize: 0 }
  ); // "a [1x1], b [1x1], c [1x1]" 25 字符 → 7 token
  assert.strictEqual(source.estimateTokens({}), 7);
});

test('estimateTokens 无窗口为 0', () => {
  const source = new LayoutInfoSource({ windowsProvider: () => [] });
  assert.strictEqual(source.estimateTokens({}), 0);
});
