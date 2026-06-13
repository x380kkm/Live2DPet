// 运行:node --test tests/platform/model-router.test.js
// 验证路由按 step 解析配置、按身份缓存客户端、转发调用、无 step 兜底或报错。
const { test } = require('node:test');
const assert = require('node:assert');
const { ModelRouter } = require('../../src/platform/llm/model-router');
const { StepModelConfig } = require('../../src/platform/llm/step-model-config');

//// 造一个记录自己配置与收到请求的假客户端 [@busybee 2026-06-13] ////
function fakeClient(cfg) {
  return {
    cfg,
    calls: [],
    async complete(request) { this.calls.push(request); return { text: `${cfg.model}:${cfg.temperature}` }; },
    async *stream(request) { this.calls.push(request); yield { text: cfg.model, done: true }; }
  };
}

function config() {
  return new StepModelConfig({
    categories: {
      vlm: { preset: 'openai-chat', baseURL: 'https://vlm/v1', apiKey: 'vk', model: 'gemini-3.5-flash' },
      llm: { preset: 'openai-chat', baseURL: 'https://llm/v1', apiKey: 'lk', model: 'deepseek-v4-flash' },
      translate: { preset: 'openai-chat', baseURL: 'https://llm/v1', apiKey: 'lk', model: 'deepseek-v4-flash' }
    },
    steps: {}
  });
}

test('按 step 路由到对应大类的模型,温度取步骤默认', async () => {
  let made = 0;
  const router = new ModelRouter(config(), { makeClient: (cfg) => { made++; return fakeClient(cfg); } });
  assert.strictEqual((await router.complete({ messages: [], step: 'dialogue' })).text, 'deepseek-v4-flash:1.3');
  assert.strictEqual((await router.complete({ messages: [], step: 'situationExtract' })).text, 'gemini-3.5-flash:0.4');
  assert.strictEqual((await router.complete({ messages: [], step: 'intentRoute' })).text, 'deepseek-v4-flash:0');
  assert.strictEqual(made, 3);
});

test('同身份配置复用同一客户端,不重复构造', async () => {
  let made = 0;
  const router = new ModelRouter(config(), { makeClient: (cfg) => { made++; return fakeClient(cfg); } });
  // dialogue 与 reaction 同模型、同温度 1.3,身份相同,应共用一个客户端
  await router.complete({ messages: [], step: 'dialogue' });
  await router.complete({ messages: [], step: 'reaction' });
  assert.strictEqual(made, 1);
});

test('无 step 且无兜底则报错', async () => {
  const router = new ModelRouter(config(), { makeClient: fakeClient });
  await assert.rejects(router.complete({ messages: [] }), /缺少 step/);
});

test('无 step 时走兜底客户端', async () => {
  const fallback = { async complete() { return { text: '兜底' }; } };
  const router = new ModelRouter(config(), { makeClient: fakeClient, fallback });
  assert.strictEqual((await router.complete({ messages: [] })).text, '兜底');
});

test('流式按 step 路由并透传增量', async () => {
  const router = new ModelRouter(config(), { makeClient: fakeClient });
  const out = [];
  for await (const d of router.stream({ messages: [], step: 'dialogue' })) out.push(d);
  assert.strictEqual(out[0].text, 'deepseek-v4-flash');
});

test('resolveStep 透出该步解析配置', () => {
  const router = new ModelRouter(config(), { makeClient: fakeClient });
  assert.strictEqual(router.resolveStep('dialogue').model, 'deepseek-v4-flash');
});
