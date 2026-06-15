// audience: internal
// # reaction-policy.test
// 验证 ReactionPolicy 的行为契约:事件触发一次有界 LLM 调用、产物发布、后发调用作废先前在途的、空文本与失败不发布。

const { test } = require('node:test');
const assert = require('node:assert');
const { ReactionPolicy } = require('../../src/domain/statemachine/reaction-policy');

// 收集所发布事件的总线桩。
function fakeBus() {
  const published = [];
  return {
    published,
    publish(event) { published.push(event); }
  };
}

// 一个 complete 返回固定文本的 LLM 客户端桩,并记录被调次数与参数。
function fakeClient(text) {
  const calls = [];
  return {
    calls,
    async complete(request) {
      calls.push(request);
      return { text, toolCalls: [], raw: {} };
    }
  };
}

// 一个 complete 在外部解析后才回应的可控 LLM 客户端桩,用于编排在途并发。
function deferredClient() {
  const pending = [];
  return {
    pending,
    async complete() {
      return new Promise((resolve) => pending.push(resolve));
    }
  };
}

const event = { type: 'StateReaction', state: 'active', from: 'idle', input: 'wake' };
const scope = { messages: [{ role: 'user', content: 'q' }] };

//// 事件触发一次 LLM 调用并透传 scope 的消息 [@x380kkm 2026-06-13] ////
test('reactTo makes one bounded LLM call with the scope messages', async () => {
  const client = fakeClient('hi');
  const policy = new ReactionPolicy({ llmClient: client, eventBus: fakeBus() });
  await policy.reactTo(event, scope);
  assert.strictEqual(client.calls.length, 1);
  // 透传 scope 的消息,并带上事件反应步标记交模型路由
  assert.deepStrictEqual(client.calls[0], { messages: scope.messages, step: 'reaction' });
});

//// 成功调用向总线发布带状态与文本的产物事件 [@x380kkm 2026-06-13] ////
test('reactTo publishes a ReactionProduced event on success', async () => {
  const bus = fakeBus();
  const policy = new ReactionPolicy({ llmClient: fakeClient('  你好  '), eventBus: bus });
  const outcome = await policy.reactTo(event, scope);
  assert.deepStrictEqual(outcome, { produced: true, text: '你好' });
  assert.deepStrictEqual(bus.published, [{ type: 'ReactionProduced', state: 'active', text: '你好' }]);
});

//// 空文本不发布产物 [@x380kkm 2026-06-13] ////
test('reactTo does not publish on empty text', async () => {
  const bus = fakeBus();
  const policy = new ReactionPolicy({ llmClient: fakeClient('   '), eventBus: bus });
  const outcome = await policy.reactTo(event, scope);
  assert.strictEqual(outcome.produced, false);
  assert.strictEqual(outcome.reason, 'empty');
  assert.strictEqual(bus.published.length, 0);
});

//// 调用失败不发布产物并透出失败标记 [@x380kkm 2026-06-13] ////
test('reactTo does not publish when the call fails', async () => {
  const bus = fakeBus();
  const failing = {
    async complete() { throw new Error('网络抖动'); }
  };
  const policy = new ReactionPolicy({ llmClient: failing, eventBus: bus });
  const outcome = await policy.reactTo(event, scope);
  assert.strictEqual(outcome.produced, false);
  assert.strictEqual(outcome.reason, 'failed');
  assert.match(outcome.error.message, /网络抖动/);
  assert.strictEqual(bus.published.length, 0);
});

//// 后发调用作废先前在途的,只有最新一次发布产物 [@x380kkm 2026-06-13] ////
test('a later call supersedes an in-flight earlier one', async () => {
  const bus = fakeBus();
  const client = deferredClient();
  const policy = new ReactionPolicy({ llmClient: client, eventBus: bus });

  // 先后发两次,两次都在途。
  const first = policy.reactTo(event, scope);
  const second = policy.reactTo(event, scope);

  // 让后发的先回应,再让先发的回应。
  client.pending[1]({ text: '新', toolCalls: [], raw: {} });
  client.pending[0]({ text: '旧', toolCalls: [], raw: {} });

  const secondOutcome = await second;
  const firstOutcome = await first;

  assert.deepStrictEqual(secondOutcome, { produced: true, text: '新' });
  assert.strictEqual(firstOutcome.produced, false);
  assert.strictEqual(firstOutcome.reason, 'superseded');
  // 只有最新一次的产物落到总线。
  assert.deepStrictEqual(bus.published, [{ type: 'ReactionProduced', state: 'active', text: '新' }]);
});
