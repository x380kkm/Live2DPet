// audience: internal
// # reaction-driver.test
// 验证状态机反应驱动:边界态事件触发反应策略、停止后不再驱动、组装函数收到事件;
// 并验证状态机进入边界态时确实发出可被本驱动消费的事件,二者经事件总线对接。

const { test } = require('node:test');
const assert = require('node:assert');
const { ReactionDriver } = require('../../src/domain/statemachine/reaction-driver.js');
const { StateMachine } = require('../../src/domain/statemachine/state-machine.js');
const { EventBus } = require('../../src/platform/bus/event-bus.js');

// 记录 reactTo 调用的假反应策略。
function makeFakePolicy() {
  return { calls: [], async reactTo(event, scope) { this.calls.push({ event, scope }); return { produced: true }; } };
}

//// 边界态事件触发反应策略,组装函数据事件搭提示词 [@x380kkm 2026-06-14] ////
test('ReactionDriver 收到边界态事件时调反应策略,带组装出的 scope', async () => {
  const bus = new EventBus();
  const policy = makeFakePolicy();
  const driver = new ReactionDriver({
    eventBus: bus,
    reactionPolicy: policy,
    composeScope: (event) => ({ messages: [{ role: 'user', content: `react:${event.state}` }] })
  });
  driver.start();
  bus.publish({ type: 'StateReaction', state: 'won', from: 'playing', input: 'score' });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(policy.calls.length, 1);
  assert.strictEqual(policy.calls[0].event.state, 'won');
  assert.deepStrictEqual(policy.calls[0].scope.messages, [{ role: 'user', content: 'react:won' }]);
});

test('ReactionDriver stop 后不再驱动反应', async () => {
  const bus = new EventBus();
  const policy = makeFakePolicy();
  const driver = new ReactionDriver({ eventBus: bus, reactionPolicy: policy, composeScope: () => ({ messages: [] }) });
  driver.start();
  driver.stop();
  bus.publish({ type: 'StateReaction', state: 'won' });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(policy.calls.length, 0);
});

//// 状态机进入边界态时发出事件,反应驱动据此被触发,二者经总线对接 [@x380kkm 2026-06-14] ////
test('StateMachine 进入边界态发 StateReaction,ReactionDriver 据此驱动', async () => {
  const bus = new EventBus();
  const policy = makeFakePolicy();
  const driver = new ReactionDriver({ eventBus: bus, reactionPolicy: policy, composeScope: (e) => ({ messages: [], state: e.state }) });
  driver.start();
  const machine = new StateMachine(
    { initial: 'playing', transitions: { playing: { win: 'won', lose: 'lost' } }, reactiveStates: ['won', 'lost'] },
    { eventBus: bus }
  );
  machine.transition('win');
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(policy.calls.length, 1);
  assert.strictEqual(policy.calls[0].event.state, 'won');
  assert.strictEqual(policy.calls[0].event.from, 'playing');
});
//// /边界态事件触发反应策略 ////
