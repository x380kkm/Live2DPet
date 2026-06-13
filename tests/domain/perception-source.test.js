// 运行: node --test tests/domain/perception-source.test.js
// 用 mock 注入 extractor 与 memoryStore 与时钟,断言上下文源契约:
// render 折出命名片段、无内容返回 null、estimateTokens 据片段粗估、按回看窗读记忆。

const { test } = require('node:test');
const assert = require('node:assert');
const { PerceptionSource } = require('../../src/domain/perception/perception-source');

//// 假抽取器:keyframes 返回预置选集 [@busybee 2026-06-13] ////
function fakeExtractor(frames) {
  return { keyframes() { return frames; } };
}

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

test('暴露默认 id 与 priority', () => {
  const source = new PerceptionSource({ extractor: fakeExtractor([]), memoryStore: fakeMemory([]) });
  assert.strictEqual(source.id, 'perception');
  assert.strictEqual(source.priority, 0);
});

test('render 把最新态势与近期记忆折成命名片段', () => {
  const source = new PerceptionSource({
    extractor: fakeExtractor([{ situation: '在写代码' }]),
    memoryStore: fakeMemory([{ situation: '刚看过文档' }]),
    now: () => 1000
  });
  const fragment = source.render({});
  assert.strictEqual(fragment.sourceId, 'perception');
  assert.strictEqual(fragment.text, '在写代码\n刚看过文档');
});

test('render 两者皆空返回 null', () => {
  const source = new PerceptionSource({
    extractor: fakeExtractor([]),
    memoryStore: fakeMemory([])
  });
  assert.strictEqual(source.render({}), null);
});

test('render 只有态势没有记忆时仍出片段', () => {
  const source = new PerceptionSource({
    extractor: fakeExtractor([{ situation: '在写代码' }]),
    memoryStore: fakeMemory([]),
    now: () => 0
  });
  const fragment = source.render({});
  assert.strictEqual(fragment.text, '在写代码');
});

test('estimateTokens 据渲染片段字符数粗估', () => {
  const source = new PerceptionSource({
    extractor: fakeExtractor([{ situation: 'abcd' }]), // 4 字符 → 1 token
    memoryStore: fakeMemory([]),
    now: () => 0
  });
  assert.strictEqual(source.estimateTokens({}), 1);
});

test('estimateTokens 无内容为 0', () => {
  const source = new PerceptionSource({
    extractor: fakeExtractor([]),
    memoryStore: fakeMemory([])
  });
  assert.strictEqual(source.estimateTokens({}), 0);
});

test('render 按回看窗与上限读记忆', () => {
  const memory = fakeMemory([]);
  const source = new PerceptionSource(
    { extractor: fakeExtractor([]), memoryStore: memory, now: () => 1000 },
    { recallWindowMs: 600, recallLimit: 5 }
  );
  source.render({});
  assert.deepStrictEqual(memory.calls[0], { from: 400, to: 1000, limit: 5 });
});

test('构造配置可覆盖 id 与 priority', () => {
  const source = new PerceptionSource(
    { extractor: fakeExtractor([]), memoryStore: fakeMemory([]) },
    { id: 'situationDigest', priority: 5 }
  );
  assert.strictEqual(source.id, 'situationDigest');
  assert.strictEqual(source.priority, 5);
});
