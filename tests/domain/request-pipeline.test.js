// audience: internal
// # request-pipeline.test
// 验证请求管线的行为契约:按意图引用收集启用的上下文源、组装、调模型、施加后处理过滤器。

const { test } = require('node:test');
const assert = require('node:assert');
const { RequestPipeline } = require('../../src/domain/pet/request-pipeline');
const { NamedContextSource } = require('../../src/domain/pet/context-source');

//// 造一个按 id 取源的注册表桩 [@x380kkm 2026-06-13] ////
function fakeRegistry(sources) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return { get: (id) => byId.get(id) || null };
}

//// 造一个记录请求并回定值的 LLM 客户端桩 [@x380kkm 2026-06-13] ////
function fakeLlmClient(text) {
  const calls = [];
  return {
    calls,
    complete: async (request) => {
      calls.push(request);
      return { text, toolCalls: [], raw: {} };
    }
  };
}

//// 管线只收集意图引用且注册表里存在的源 [@x380kkm 2026-06-13] ////
test('pipeline collects only referenced sources present in registry', async () => {
  const idle = new NamedContextSource({ id: 'idle', priority: 5, render: () => '空闲中' });
  const focus = new NamedContextSource({ id: 'focus', priority: 9, render: () => '看着编辑器' });
  let composedSources = null;
  const pipeline = new RequestPipeline({
    sources: fakeRegistry([idle, focus]),
    llmClient: fakeLlmClient('回应'),
    // 引用了一个注册表里没有的 missing,应被丢弃。
    promptComposer: {
      compose: (intent, context) => {
        composedSources = context.fragments.map((f) => f.id);
        return { messages: [{ role: 'user', content: context.text }] };
      }
    }
  });

  await pipeline.run({ id: 'observe', contextSourceRefs: ['focus', 'missing', 'idle'] }, {});

  // 按优先级排序:focus(9)在 idle(5)前,missing 被丢弃。
  assert.deepStrictEqual(composedSources, ['focus', 'idle']);
});

//// 管线把组装结果交给 promptComposer 再调模型 [@x380kkm 2026-06-13] ////
test('pipeline composes assembled context then calls the model', async () => {
  const idle = new NamedContextSource({ id: 'idle', priority: 5, render: () => '空闲中' });
  const llmClient = fakeLlmClient('你好呀');
  const pipeline = new RequestPipeline({
    sources: fakeRegistry([idle]),
    llmClient,
    promptComposer: {
      compose: (intent, context) => ({
        messages: [{ role: 'user', content: `[${intent.id}] ${context.text}` }]
      })
    }
  });

  const response = await pipeline.run({ id: 'idle-chat', contextSourceRefs: ['idle'] }, {});

  assert.strictEqual(llmClient.calls.length, 1);
  assert.strictEqual(llmClient.calls[0].messages[0].content, '[idle-chat] 空闲中');
  assert.strictEqual(response.text, '你好呀');
});

//// 后处理过滤器依次改写回应文本 [@x380kkm 2026-06-13] ////
test('post-process filters rewrite the response text in order', async () => {
  const pipeline = new RequestPipeline({
    sources: fakeRegistry([]),
    llmClient: fakeLlmClient('hello'),
    promptComposer: { compose: () => ({ messages: [] }) },
    filters: [
      (text) => text.toUpperCase(),
      (text) => `${text}!`
    ]
  });

  const response = await pipeline.run({ id: 'x', contextSourceRefs: [] }, {});

  assert.strictEqual(response.text, 'HELLO!');
});

//// 过滤器返回空时保留上一版文本 [@x380kkm 2026-06-13] ////
test('filter returning empty keeps the previous text', async () => {
  const pipeline = new RequestPipeline({
    sources: fakeRegistry([]),
    llmClient: fakeLlmClient('keep'),
    promptComposer: { compose: () => ({ messages: [] }) },
    filters: [() => '', () => null]
  });

  const response = await pipeline.run({ id: 'x', contextSourceRefs: [] }, {});

  assert.strictEqual(response.text, 'keep');
});

//// 缺省预算从作用域取情绪填进回应三元组 [@x380kkm 2026-06-13] ////
test('pipeline carries emotion from scope into the response triple', async () => {
  const pipeline = new RequestPipeline({
    sources: fakeRegistry([]),
    llmClient: fakeLlmClient('文本'),
    promptComposer: { compose: () => ({ messages: [] }) }
  });

  const response = await pipeline.run({ id: 'x', contextSourceRefs: [] }, { emotion: 'happy' });

  assert.strictEqual(response.emotion, 'happy');
  assert.deepStrictEqual(response.modEvents, []);
});

//// 意图缺少上下文源引用时不报错 [@x380kkm 2026-06-13] ////
test('intent without context source refs runs without error', async () => {
  const pipeline = new RequestPipeline({
    sources: fakeRegistry([]),
    llmClient: fakeLlmClient('文本'),
    promptComposer: { compose: (intent, context) => ({ messages: [], emptyText: context.text }) }
  });

  const response = await pipeline.run({ id: 'x' }, {});

  assert.strictEqual(response.text, '文本');
});
