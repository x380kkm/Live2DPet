// audience: internal
// # pet.test
// 验证 pet 编排器的行为契约:模型侧选意图、跑管线后经事件总线发产物、不直接持窗口句柄。

const { test } = require('node:test');
const assert = require('node:assert');
const { PetOrchestrator } = require('../../src/domain/pet/pet');

//// 造一个记录发布事件的事件总线桩 [@x380kkm 2026-06-13] ////
function fakeEventBus() {
  const published = [];
  return { published, publish: (event) => published.push(event) };
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

//// 造一个回定回应的管线桩 [@x380kkm 2026-06-13] ////
function fakePipeline(response) {
  const calls = [];
  return {
    calls,
    run: async (intent, scope) => {
      calls.push({ intent, scope });
      return response;
    }
  };
}

//// 无候选意图时选意图返回 null [@x380kkm 2026-06-13] ////
test('selectIntent returns null when no candidates', async () => {
  const pet = new PetOrchestrator({ llmClient: fakeLlmClient('') });
  assert.strictEqual(await pet.selectIntent([], {}), null);
});

//// 只一条候选时直选它且不耗模型调用 [@x380kkm 2026-06-13] ////
test('selectIntent picks the sole candidate without calling the model', async () => {
  const llmClient = fakeLlmClient('');
  const pet = new PetOrchestrator({ llmClient });
  const only = { id: 'idle-chat', trigger: '无新视觉输入' };

  const chosen = await pet.selectIntent([only], {});

  assert.strictEqual(chosen, only);
  assert.strictEqual(llmClient.calls.length, 0);
});

//// 多候选时经模型回应选出匹配 id 的意图 [@x380kkm 2026-06-13] ////
test('selectIntent chooses the candidate whose id the model returns', async () => {
  const llmClient = fakeLlmClient('我选 observe');
  const pet = new PetOrchestrator({ llmClient });
  const idle = { id: 'idle-chat', trigger: '无新视觉输入' };
  const observe = { id: 'observe', trigger: '有视觉输入' };

  const chosen = await pet.selectIntent([idle, observe], { situationDigest: '在看屏幕' });

  assert.strictEqual(chosen, observe);
  assert.strictEqual(llmClient.calls.length, 1);
});

//// 模型回应不含任何 id 时回退到首个候选 [@x380kkm 2026-06-13] ////
test('selectIntent falls back to first candidate on unparseable reply', async () => {
  const pet = new PetOrchestrator({ llmClient: fakeLlmClient('看不懂的回应') });
  const idle = { id: 'idle-chat' };
  const observe = { id: 'observe' };

  const chosen = await pet.selectIntent([idle, observe], {});

  assert.strictEqual(chosen, idle);
});

//// 注入的意图解析器覆盖缺省解析 [@x380kkm 2026-06-13] ////
test('selectIntent uses injected intent parser', async () => {
  const pet = new PetOrchestrator({
    llmClient: fakeLlmClient('whatever'),
    intentParser: () => 'observe'
  });
  const idle = { id: 'idle-chat' };
  const observe = { id: 'observe' };

  const chosen = await pet.selectIntent([idle, observe], {});

  assert.strictEqual(chosen, observe);
});

//// run 跑管线后把产物经事件总线发出 [@x380kkm 2026-06-13] ////
test('run drives the pipeline then publishes the product on the bus', async () => {
  const eventBus = fakeEventBus();
  const pipeline = fakePipeline({ text: '你好呀', emotion: 'happy', modEvents: [] });
  const pet = new PetOrchestrator({ pipeline, eventBus });
  const intent = { id: 'idle-chat', contextSourceRefs: [] };

  const response = await pet.run(intent, { situationDigest: '空闲' });

  assert.strictEqual(pipeline.calls.length, 1);
  assert.strictEqual(pipeline.calls[0].intent, intent);
  assert.deepStrictEqual(eventBus.published, [{
    type: 'UtteranceProduced',
    intentId: 'idle-chat',
    text: '你好呀',
    emotion: 'happy',
    modEvents: []
  }]);
  assert.strictEqual(response.text, '你好呀');
});

//// 管线产出空文本时不发布产物 [@x380kkm 2026-06-13] ////
test('run does not publish when the pipeline yields empty text', async () => {
  const eventBus = fakeEventBus();
  const pipeline = fakePipeline({ text: '', emotion: null, modEvents: [] });
  const pet = new PetOrchestrator({ pipeline, eventBus });

  const response = await pet.run({ id: 'idle-chat' }, {});

  assert.strictEqual(response, null);
  assert.deepStrictEqual(eventBus.published, []);
});

//// 未注入 mod 生成器时生成临时 mod 抛清晰错误 [@x380kkm 2026-06-13] ////
test('generateTempMod throws a clear error without a generator', async () => {
  const pet = new PetOrchestrator({});
  await assert.rejects(
    () => pet.generateTempMod({ product: { spec: {} } }),
    /未注入 mod 生成器/
  );
});

//// 生成临时 mod 把意图产物规格转交给注入的生成器 [@x380kkm 2026-06-13] ////
test('generateTempMod delegates the product spec to the generator', async () => {
  const received = [];
  const modGenerator = { generate: async (spec) => { received.push(spec); return { id: 'temp-mod' }; } };
  const pet = new PetOrchestrator({ modGenerator });
  const spec = { kind: 'mini-game' };

  const mod = await pet.generateTempMod({ product: { spec } });

  assert.deepStrictEqual(received, [spec]);
  assert.strictEqual(mod.id, 'temp-mod');
});

//// run 遇到「当场生成临时 mod」产物时,生成后请求挂载、再经富管线产引入台词 [@x380kkm 2026-06-14] ////
test('run 对 generate-temp-mod 产物生成临时 mod、请求挂载并产引入台词', async () => {
  const eventBus = fakeEventBus();
  const generated = { id: 'temp-mod', frontendSpec: { html: '<b>hi</b>' }, emits: ['win'] };
  const modGenerator = { generate: async () => generated };
  const pipeline = fakePipeline({ text: '我新弄了个小玩意,来玩玩看吧', emotion: null, modEvents: [] });
  const pet = new PetOrchestrator({ pipeline, eventBus, modGenerator });
  const intent = { id: 'make-game', contextSourceRefs: ['modIntroduction'], product: { kind: 'generate-temp-mod', spec: { kind: 'mini-game' } } };

  const result = await pet.run(intent, { situationDigest: '空闲' });

  // 先请求挂载,再经富管线据中性描述产一句引入台词
  assert.strictEqual(result.mod, generated);
  assert.strictEqual(pipeline.calls.length, 1);
  // 引入那次调用的作用域带中性描述,提到该 mod 会响应的交互,并保留原作用域字段
  const introScope = pipeline.calls[0].scope;
  assert.match(introScope.modIntroduction, /win/);
  assert.strictEqual(introScope.situationDigest, '空闲');
  assert.deepStrictEqual(eventBus.published, [
    { type: 'ModMountRequested', modId: 'temp-mod', frontendSpec: { html: '<b>hi</b>' }, emits: ['win'] },
    { type: 'UtteranceProduced', intentId: 'make-game', text: '我新弄了个小玩意,来玩玩看吧', emotion: null, modEvents: [] }
  ]);
});

//// 引入台词为空时只请求挂载,不发空发言产物 [@x380kkm 2026-06-14] ////
test('run 对 generate-temp-mod 在引入台词为空时只发 ModMountRequested', async () => {
  const eventBus = fakeEventBus();
  const generated = { id: 'temp-mod', frontendSpec: { html: '<b>hi</b>' }, emits: ['win'] };
  const modGenerator = { generate: async () => generated };
  const pipeline = fakePipeline({ text: '', emotion: null, modEvents: [] });
  const pet = new PetOrchestrator({ pipeline, eventBus, modGenerator });
  const intent = { id: 'make-game', product: { kind: 'generate-temp-mod', spec: {} } };

  await pet.run(intent, {});

  assert.deepStrictEqual(eventBus.published, [
    { type: 'ModMountRequested', modId: 'temp-mod', frontendSpec: { html: '<b>hi</b>' }, emits: ['win'] }
  ]);
});
