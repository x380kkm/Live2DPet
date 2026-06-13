// audience: internal
// # state-machine.test
// 验证 StateMachine 的行为契约:查表转移、转移发状态事件、边界态额外发反应事件、表外输入原地不动、进入处理器。

const { test } = require('node:test');
const assert = require('node:assert');
const { StateMachine } = require('../../src/domain/statemachine/state-machine');

// 收集所发布事件的总线桩,只记录不分发。
function fakeBus() {
  const published = [];
  return {
    published,
    publish(event) { published.push(event); }
  };
}

// 一个含边界态的最小定义:idle 经 wake 到 active,active 属边界态。
function definition() {
  return {
    initial: 'idle',
    transitions: {
      idle: { wake: 'active' },
      active: { sleep: 'idle' }
    },
    reactiveStates: ['active']
  };
}

//// 初始态取自定义 [@busybee 2026-06-13] ////
test('current starts at the defined initial state', () => {
  const sm = new StateMachine(definition(), { eventBus: fakeBus() });
  assert.strictEqual(sm.current, 'idle');
});

//// 合法输入按表转移并推进当前态 [@busybee 2026-06-13] ////
test('transition follows the table and advances current', () => {
  const sm = new StateMachine(definition(), { eventBus: fakeBus() });
  const moved = sm.transition('wake');
  assert.strictEqual(moved, true);
  assert.strictEqual(sm.current, 'active');
});

//// 转移成功向总线发布带 from/to/input 的状态事件 [@busybee 2026-06-13] ////
test('transition publishes a StateChanged event', () => {
  const bus = fakeBus();
  const sm = new StateMachine(definition(), { eventBus: bus });
  sm.transition('wake');
  const changed = bus.published.find((e) => e.type === 'StateChanged');
  assert.deepStrictEqual(changed, { type: 'StateChanged', from: 'idle', to: 'active', input: 'wake' });
});

//// 进入边界态额外发布反应事件 [@busybee 2026-06-13] ////
test('entering a reactive state publishes a StateReaction event', () => {
  const bus = fakeBus();
  const sm = new StateMachine(definition(), { eventBus: bus });
  sm.transition('wake');
  const reaction = bus.published.find((e) => e.type === 'StateReaction');
  assert.deepStrictEqual(reaction, { type: 'StateReaction', state: 'active', from: 'idle', input: 'wake' });
});

//// 进入非边界态不发反应事件 [@busybee 2026-06-13] ////
test('entering a non-reactive state publishes no StateReaction', () => {
  const bus = fakeBus();
  const sm = new StateMachine(definition(), { eventBus: bus });
  sm.transition('wake');
  sm.transition('sleep');
  const reactions = bus.published.filter((e) => e.type === 'StateReaction');
  assert.strictEqual(reactions.length, 1);
});

//// 表外输入原地不动且不发任何事件 [@busybee 2026-06-13] ////
test('undefined input keeps state and publishes nothing', () => {
  const bus = fakeBus();
  const sm = new StateMachine(definition(), { eventBus: bus });
  const moved = sm.transition('unknown');
  assert.strictEqual(moved, false);
  assert.strictEqual(sm.current, 'idle');
  assert.strictEqual(bus.published.length, 0);
});

//// 进入处理器在转移落地后收到 from 与 input [@busybee 2026-06-13] ////
test('onEnter handler fires after transition with context', () => {
  const sm = new StateMachine(definition(), { eventBus: fakeBus() });
  const seen = [];
  sm.onEnter('active', (ctx) => seen.push(ctx));
  sm.transition('wake');
  assert.deepStrictEqual(seen, [{ from: 'idle', input: 'wake' }]);
});

//// 注销后进入处理器不再被调用 [@busybee 2026-06-13] ////
test('unregistered onEnter handler stops firing', () => {
  const sm = new StateMachine(definition(), { eventBus: fakeBus() });
  let hits = 0;
  const off = sm.onEnter('active', () => { hits += 1; });
  sm.transition('wake');
  off();
  sm.transition('sleep');
  sm.transition('wake');
  assert.strictEqual(hits, 1);
});

//// 处理器内注销不打断本次回调 [@busybee 2026-06-13] ////
test('unregistering during enter does not skip remaining handlers', () => {
  const sm = new StateMachine(definition(), { eventBus: fakeBus() });
  const order = [];
  const off = sm.onEnter('active', () => { order.push('first'); off(); });
  sm.onEnter('active', () => { order.push('second'); });
  sm.transition('wake');
  assert.deepStrictEqual(order, ['first', 'second']);
});
