// audience: internal
// # builtin-intents.test
// 验证出厂意图的数据契约:只有观察回应、空闲闲聊两条;触发条件正确;情绪焦点反重复以上下文源出现而非独立意图;不含成品措辞。

const { test } = require('node:test');
const assert = require('node:assert');
const { Intent } = require('../../src/domain/intent/intent');
const { builtinIntents, BUILTIN_ORIGIN } = require('../../src/domain/intent/builtin-intents');

//// 恰好两条核心意图,且都是意图实例带出厂来源 [@x380kkm 2026-06-13] ////
test('builtinIntents yields exactly the two core intents tagged builtin', () => {
  const intents = builtinIntents();
  assert.strictEqual(intents.length, 2);
  for (const intent of intents) {
    assert.ok(intent instanceof Intent);
    assert.strictEqual(intent.origin, BUILTIN_ORIGIN);
  }
  const ids = intents.map((i) => i.id).sort();
  assert.deepStrictEqual(ids, ['idle-chat', 'observe-response']);
});

//// 观察回应由有视觉输入触发 [@x380kkm 2026-06-13] ////
test('observe-response triggers on visual input', () => {
  const observe = builtinIntents().find((i) => i.id === 'observe-response');
  assert.strictEqual(observe.trigger.when, 'visual-input');
});

//// 空闲闲聊由空闲触发 [@x380kkm 2026-06-13] ////
test('idle-chat triggers on idle', () => {
  const idle = builtinIntents().find((i) => i.id === 'idle-chat');
  assert.strictEqual(idle.trigger.when, 'idle');
});

//// 情绪焦点反重复以上下文源引用出现,不在任何意图 id 上 [@x380kkm 2026-06-13] ////
test('emotion, focus and anti-repetition appear as context source refs, never as intents', () => {
  const intents = builtinIntents();
  const ids = intents.map((i) => i.id);
  assert.ok(!ids.includes('toneHint'));
  assert.ok(!ids.includes('focusInfo'));
  assert.ok(!ids.includes('recentReplies'));

  const idle = intents.find((i) => i.id === 'idle-chat');
  assert.ok(idle.contextSourceRefs.includes('toneHint'));
  assert.ok(idle.contextSourceRefs.includes('focusInfo'));
  assert.ok(idle.contextSourceRefs.includes('recentReplies'));
});

//// few-shot 只引结构样例,不内联成品措辞 [@x380kkm 2026-06-13] ////
test('few-shot refs point at structure examples only, no inline finished wording', () => {
  for (const intent of builtinIntents()) {
    assert.ok(intent.fewShotRefs.length > 0);
    for (const ref of intent.fewShotRefs) {
      assert.ok(ref.startsWith('structure/'), `期望结构样例引用,得到 ${ref}`);
    }
  }
});

//// 默认产物为用某个模板,零额外大模型调用 [@x380kkm 2026-06-13] ////
test('default product uses a template', () => {
  for (const intent of builtinIntents()) {
    assert.strictEqual(intent.product.kind, 'use-template');
    assert.ok(typeof intent.product.templateId === 'string');
  }
});
