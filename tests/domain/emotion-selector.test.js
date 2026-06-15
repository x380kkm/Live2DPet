// audience: internal
// # emotion-selector.test
// 验证 EmotionSelector 的行为契约:精确与模糊命中、空名回退、并发抑制、空可选名跳过、失败发空名。

const { test } = require('node:test');
const assert = require('node:assert');
const { EmotionSelector, EMOTION_SELECTED } = require('../../src/domain/emotion/emotion-selector');

// 记录所有发布事件的总线替身。
function makeBus() {
  const events = [];
  return { events, publish(event) { events.push(event); } };
}

// 按给定行为应答 complete 的 LLM 替身,记录收到的请求。
function makeLlm(behavior) {
  const requests = [];
  return {
    requests,
    async complete(request) {
      requests.push(request);
      return behavior(request);
    }
  };
}

const PROMPT = 'Pick one from [{0}].';

//// 模型精确命中可选名时发布该名 [@x380kkm 2026-06-13] ////
test('exact match publishes the picked name', async () => {
  const bus = makeBus();
  const llm = makeLlm(async () => ({ text: 'happy' }));
  const selector = new EmotionSelector(bus, llm, {
    enabledNames: ['happy', 'sad'], promptTemplate: PROMPT
  });

  const result = await selector.select({ spokenText: 'hi' });

  assert.strictEqual(result, 'happy');
  assert.deepStrictEqual(bus.events, [{ type: EMOTION_SELECTED, name: 'happy' }]);
});

//// 模型文本含可选名时按包含模糊命中 [@x380kkm 2026-06-13] ////
test('fuzzy match resolves a contained name', async () => {
  const bus = makeBus();
  const llm = makeLlm(async () => ({ text: 'The emotion is happy.' }));
  const selector = new EmotionSelector(bus, llm, {
    enabledNames: ['happy', 'sad'], promptTemplate: PROMPT
  });

  const result = await selector.select({ spokenText: 'hi' });

  assert.strictEqual(result, 'happy');
});

//// 选不出任何可选名时发布空名,交渲染层回退 [@x380kkm 2026-06-13] ////
test('no match publishes empty name', async () => {
  const bus = makeBus();
  const llm = makeLlm(async () => ({ text: 'something unrelated' }));
  const selector = new EmotionSelector(bus, llm, {
    enabledNames: ['happy', 'sad'], promptTemplate: PROMPT
  });

  const result = await selector.select({ spokenText: 'hi' });

  assert.strictEqual(result, '');
  assert.deepStrictEqual(bus.events, [{ type: EMOTION_SELECTED, name: '' }]);
});

//// 可选名为空时跳过调用、不发事件 [@x380kkm 2026-06-13] ////
test('empty enabled names skips the call', async () => {
  const bus = makeBus();
  const llm = makeLlm(async () => ({ text: 'happy' }));
  const selector = new EmotionSelector(bus, llm, { enabledNames: [], promptTemplate: PROMPT });

  const result = await selector.select({ spokenText: 'hi' });

  assert.strictEqual(result, null);
  assert.strictEqual(llm.requests.length, 0);
  assert.strictEqual(bus.events.length, 0);
});

//// 状态里的可选名覆盖构造时的可选名 [@x380kkm 2026-06-13] ////
test('state enabled names override constructor names', async () => {
  const bus = makeBus();
  const llm = makeLlm(async () => ({ text: 'calm' }));
  const selector = new EmotionSelector(bus, llm, {
    enabledNames: ['happy'], promptTemplate: PROMPT
  });

  const result = await selector.select({ spokenText: 'hi', enabledNames: ['calm', 'angry'] });

  assert.strictEqual(result, 'calm');
});

//// 提示模板填入可选名列表,用户消息含角色刚说的话 [@x380kkm 2026-06-13] ////
test('prompt fills names and carries spoken text', async () => {
  const bus = makeBus();
  const llm = makeLlm(async () => ({ text: 'happy' }));
  const selector = new EmotionSelector(bus, llm, {
    enabledNames: ['happy', 'sad'], promptTemplate: PROMPT
  });

  await selector.select({ spokenText: 'I won the game' });

  const messages = llm.requests[0].messages;
  assert.strictEqual(messages[0].content, 'Pick one from [happy, sad].');
  assert.ok(messages[1].content.includes('I won the game'));
});

//// 调用进行中时再次 select 被抑制,不发起第二次调用 [@x380kkm 2026-06-13] ////
test('concurrent select is suppressed while one is in flight', async () => {
  const bus = makeBus();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const llm = makeLlm(async () => { await gate; return { text: 'happy' }; });
  const selector = new EmotionSelector(bus, llm, {
    enabledNames: ['happy'], promptTemplate: PROMPT
  });

  const first = selector.select({ spokenText: 'a' });
  const second = await selector.select({ spokenText: 'b' });

  // 第二次在第一次未结束时被抑制,返回 null 且未发起调用。
  assert.strictEqual(second, null);
  assert.strictEqual(llm.requests.length, 1);

  release();
  await first;
  assert.strictEqual(bus.events.length, 1);
});

//// LLM 调用抛错时发布空名而非中断 [@x380kkm 2026-06-13] ////
test('llm failure publishes empty name', async () => {
  const bus = makeBus();
  const llm = makeLlm(async () => { throw new Error('boom'); });
  const selector = new EmotionSelector(bus, llm, {
    enabledNames: ['happy'], promptTemplate: PROMPT
  });

  const result = await selector.select({ spokenText: 'hi' });

  assert.strictEqual(result, '');
  assert.deepStrictEqual(bus.events, [{ type: EMOTION_SELECTED, name: '' }]);
  // 失败后清除进行中标志,允许后续重试。
  assert.strictEqual(selector.isSelecting, false);
});
