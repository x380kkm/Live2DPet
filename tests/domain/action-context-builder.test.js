// audience: internal
// # action-context-builder.test
// 验证上下文构造:按意图的源引用取源、意图为空时取全部源、跳过渲染为空的源,交组装器拼成文本。
// 运行: node --test tests/domain/action-context-builder.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { makeContextBuilder, collectSources } = require('../../src/domain/pet/action-context-builder');

//// 造一个命名源替身:固定 id、优先级与渲染文本,缺文本时回 null [@x380kkm 2026-06-14] ////
function fakeSource(id, priority, text) {
  return {
    id,
    priority,
    render() { return text; },
    estimateTokens() { return text ? Math.ceil(text.length / 4) : 0; }
  };
}

const SOURCES = [
  fakeSource('situationDigest', 90, '态势:在写代码'),
  fakeSource('focusInfo', 70, '焦点:编辑器 30 秒'),
  fakeSource('idleInfo', 50, null)
];

//// 按意图的源引用取源:只取声明引用的,且经注册表存在的 [@x380kkm 2026-06-14] ////
test('collectSources picks only the sources an intent references', () => {
  const intent = { contextSourceRefs: ['focusInfo', 'missing'] };
  const picked = collectSources(SOURCES, intent);
  assert.deepStrictEqual(picked.map((s) => s.id), ['focusInfo']);
});

//// 意图为空时取全部源 [@x380kkm 2026-06-14] ////
test('collectSources returns all sources when the intent is null', () => {
  const picked = collectSources(SOURCES, null);
  assert.deepStrictEqual(picked.map((s) => s.id), ['situationDigest', 'focusInfo', 'idleInfo']);
});

//// 构造按引用取源、按优先级拼文本,跳过渲染为空的源 [@x380kkm 2026-06-14] ////
test('the builder assembles referenced sources by priority and skips empty renders', () => {
  const build = makeContextBuilder({ sources: SOURCES });
  const intent = { contextSourceRefs: ['focusInfo', 'situationDigest', 'idleInfo'] };
  const text = build(intent, {});
  // 优先级高的在前;idleInfo 渲染为 null 被跳过
  assert.strictEqual(text, '态势:在写代码\n焦点:编辑器 30 秒');
});

//// 意图为空时构造拼全部非空源 [@x380kkm 2026-06-14] ////
test('the builder assembles all non-empty sources for a null intent', () => {
  const build = makeContextBuilder({ sources: SOURCES });
  const text = build(null, {});
  assert.strictEqual(text, '态势:在写代码\n焦点:编辑器 30 秒');
});

//// 无源时构造回空串,不抛错 [@x380kkm 2026-06-14] ////
test('the builder returns an empty string when there are no sources', () => {
  const build = makeContextBuilder({});
  assert.strictEqual(build(null, {}), '');
});
