// audience: internal
// # visual-memory-source.test
// 运行: node --test tests/domain/sources/visual-memory-source.test.js
// 验证视觉记忆源契约:id 取引用名、按回看窗读记忆折成多行、无记忆返回 null、按字符数估 token。

const { test } = require('node:test');
const assert = require('node:assert');
const { ContextSource } = require('../../../src/domain/pet/context-source');
const { VisualMemorySource } = require('../../../src/domain/pet/sources/visual-memory-source');

//// 假记忆库:记录 recall 的时间窗,返回预置记忆 [@busybee 2026-06-13] ////
function fakeMemory(entries) {
  const calls = [];
  return {
    calls,
    recall(window) {
      calls.push(window);
      return entries;
    }
  };
}

test('id 默认取意图引用名 visualMemory 且为上下文源', () => {
  const source = new VisualMemorySource({ memoryStore: fakeMemory([]) });
  assert.strictEqual(source.id, 'visualMemory');
  assert.ok(source instanceof ContextSource);
});

test('render 把近期记忆的态势逐行折成片段', () => {
  const source = new VisualMemorySource({
    memoryStore: fakeMemory([{ situation: '刚看过文档' }, { situation: '之前在写代码' }]),
    now: () => 1000
  });
  assert.strictEqual(source.render({}), '刚看过文档\n之前在写代码');
});

test('render 带标签时另起一行前缀片段', () => {
  const source = new VisualMemorySource(
    { memoryStore: fakeMemory([{ situation: '刚看过文档' }]), now: () => 0 },
    { label: '视觉记忆:' }
  );
  assert.strictEqual(source.render({}), '视觉记忆:\n刚看过文档');
});

test('render 无记忆返回 null', () => {
  const source = new VisualMemorySource({ memoryStore: fakeMemory([]) });
  assert.strictEqual(source.render({}), null);
});

test('render 滤掉无态势文本的记忆条目', () => {
  const source = new VisualMemorySource({
    memoryStore: fakeMemory([{ situation: '有态势' }, { title: '只有标题' }, { situation: '   ' }]),
    now: () => 0
  });
  assert.strictEqual(source.render({}), '有态势');
});

test('render 缺记忆库返回 null', () => {
  const source = new VisualMemorySource({});
  assert.strictEqual(source.render({}), null);
});

test('render 按回看窗与上限读记忆', () => {
  const memory = fakeMemory([]);
  const source = new VisualMemorySource(
    { memoryStore: memory, now: () => 1000 },
    { recallWindowMs: 600, recallLimit: 5 }
  );
  source.render({});
  assert.deepStrictEqual(memory.calls[0], { from: 400, to: 1000, limit: 5 });
});

test('estimateTokens 据渲染片段字符数粗估', () => {
  const source = new VisualMemorySource({
    memoryStore: fakeMemory([{ situation: 'abcd' }]), // 4 字符 → 1 token
    now: () => 0
  });
  assert.strictEqual(source.estimateTokens({}), 1);
});

test('estimateTokens 无记忆为 0', () => {
  const source = new VisualMemorySource({ memoryStore: fakeMemory([]) });
  assert.strictEqual(source.estimateTokens({}), 0);
});
