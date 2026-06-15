// 运行: node --test tests/domain/vlm-extractor.test.js
// 用 mock 注入 llmClient 与 buffer 与时钟,断言选帧的退避与候选门槛、态势抽取的退避翻倍、失败不抛出。

const { test } = require('node:test');
const assert = require('node:assert');
const { VlmExtractor } = require('../../src/domain/perception/vlm-extractor');

//// 假 llmClient:按队列依次返回文本,记录每次的 messages [@x380kkm 2026-06-13] ////
function fakeLlm(texts) {
  const queue = texts.slice();
  const calls = [];
  return {
    calls,
    async complete(request) {
      calls.push(request);
      if (queue.length === 0) throw new Error('no more responses');
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return { text: next, toolCalls: [], raw: {} };
    }
  };
}

//// 假缓冲:sample 返回预置候选帧 [@x380kkm 2026-06-13] ////
function fakeBuffer(frames) {
  return { async sample() { return frames; } };
}

//// 可控时钟 [@x380kkm 2026-06-13] ////
function fakeClock(ref) {
  return () => ref.value;
}

const THREE_FRAMES = [
  { image: 'f0', title: 'a', timestamp: 1 },
  { image: 'f1', title: 'b', timestamp: 2 },
  { image: 'f2', title: 'c', timestamp: 3 }
];

test('selectKeyframes 候选不足门槛时不调模型', async () => {
  const llm = fakeLlm([]);
  const ex = new VlmExtractor(
    { llmClient: llm, buffer: fakeBuffer([THREE_FRAMES[0]]), now: () => 0 },
    { minCandidates: 3 }
  );
  await ex.selectKeyframes();
  assert.strictEqual(llm.calls.length, 0);
});

test('selectKeyframes 经模型选出的索引并入选集', async () => {
  const llm = fakeLlm(['[0, 2]']);
  const ex = new VlmExtractor(
    { llmClient: llm, buffer: fakeBuffer(THREE_FRAMES), now: () => 0 },
    { minCandidates: 3 }
  );
  const selected = await ex.selectKeyframes();
  assert.deepStrictEqual(selected.map((f) => f.image), ['f0', 'f2']);
  assert.strictEqual(llm.calls.length, 1);
});

test('selectKeyframes 退避区间内不重复调模型', async () => {
  const clock = { value: 0 };
  const llm = fakeLlm(['[0]', '[1]']);
  const ex = new VlmExtractor(
    { llmClient: llm, buffer: fakeBuffer(THREE_FRAMES), now: fakeClock(clock) },
    { minCandidates: 3, selectIntervalMs: 1000 }
  );
  await ex.selectKeyframes();
  clock.value = 500; // 未过退避区间
  await ex.selectKeyframes();
  assert.strictEqual(llm.calls.length, 1);
});

test('selectKeyframes 把选集裁剪到 selectedMax', async () => {
  const llm = fakeLlm(['[0, 1, 2]']);
  const ex = new VlmExtractor(
    { llmClient: llm, buffer: fakeBuffer(THREE_FRAMES), now: () => 0 },
    { minCandidates: 3, selectedMax: 2 }
  );
  const selected = await ex.selectKeyframes();
  assert.strictEqual(selected.length, 2);
  // 裁剪丢最旧,保留后两帧。
  assert.deepStrictEqual(selected.map((f) => f.image), ['f1', 'f2']);
});

test('selectKeyframes 模型失败不抛出且选集不变', async () => {
  const llm = fakeLlm([new Error('boom')]);
  const ex = new VlmExtractor(
    { llmClient: llm, buffer: fakeBuffer(THREE_FRAMES), now: () => 0 },
    { minCandidates: 3 }
  );
  const selected = await ex.selectKeyframes();
  assert.deepStrictEqual(selected, []);
});

test('extract 返回截断的态势文本', async () => {
  const llm = fakeLlm(['  在写代码  ']);
  const ex = new VlmExtractor({ llmClient: llm, buffer: fakeBuffer([]), now: () => 0 });
  const situation = await ex.extract({ image: 'img', title: 'editor' });
  assert.strictEqual(situation, '在写代码');
});

test('extract 退避区间内返回 null', async () => {
  const clock = { value: 0 };
  const llm = fakeLlm(['first']);
  const ex = new VlmExtractor(
    { llmClient: llm, buffer: fakeBuffer([]), now: fakeClock(clock) },
    { situationBaseIntervalMs: 1000 }
  );
  const first = await ex.extract({ image: 'img', title: 't' });
  assert.strictEqual(first, 'first');
  clock.value = 500; // 未过退避区间
  const second = await ex.extract({ image: 'img', title: 't' });
  assert.strictEqual(second, null);
  assert.strictEqual(llm.calls.length, 1);
});

test('extract 成功后退避区间翻倍到上限', async () => {
  const clock = { value: 0 };
  const llm = fakeLlm(['s1', 's2', 's3']);
  const ex = new VlmExtractor(
    { llmClient: llm, buffer: fakeBuffer([]), now: fakeClock(clock) },
    { situationBaseIntervalMs: 1000, situationMaxIntervalMs: 4000 }
  );
  await ex.extract({ image: 'img', title: 't' }); // 区间 1000 → 2000
  clock.value = 2000;
  await ex.extract({ image: 'img', title: 't' }); // 区间 2000 → 4000
  clock.value = 3000; // 未过 4000 区间
  const third = await ex.extract({ image: 'img', title: 't' });
  assert.strictEqual(third, null);
  assert.strictEqual(llm.calls.length, 2);
});

test('extract 空帧返回 null 且不调模型', async () => {
  const llm = fakeLlm([]);
  const ex = new VlmExtractor({ llmClient: llm, buffer: fakeBuffer([]), now: () => 0 });
  assert.strictEqual(await ex.extract(null), null);
  assert.strictEqual(llm.calls.length, 0);
});

test('keyframes 返回最新在前的选集', async () => {
  const llm = fakeLlm(['[0, 1, 2]']);
  const ex = new VlmExtractor(
    { llmClient: llm, buffer: fakeBuffer(THREE_FRAMES), now: () => 0 },
    { minCandidates: 3 }
  );
  await ex.selectKeyframes();
  const ordered = ex.keyframes();
  assert.deepStrictEqual(ordered.map((f) => f.image), ['f2', 'f1', 'f0']);
});
