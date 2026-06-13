// audience: internal
// # interaction-router.test
// 验证交互路由:交互事件触发声明消费它的意图、空闲意图被滤掉、无候选不跑、按名匹配。
// 用真实 IntentRegistry 与 EventBus,pet 用记录调用的假编排器。

const { test } = require('node:test');
const assert = require('node:assert');
const { InteractionRouter } = require('../../src/domain/pet/interaction-router.js');
const { IntentRegistry } = require('../../src/domain/intent/intent-registry.js');
const { intentFromDeclaration, TriggerWhen } = require('../../src/domain/intent/intent.js');
const { EventBus } = require('../../src/platform/bus/event-bus.js');
const { InteractionEvent } = require('../../src/domain/mod/interaction-event.js');

// 记录 selectIntent 与 run 调用的假编排器:selectIntent 返回首个候选。
function makeFakePet() {
  return {
    selected: [], ran: [],
    async selectIntent(candidates, scope) { this.selected.push({ candidates, scope }); return candidates[0] || null; },
    async run(intent, scope) { this.ran.push({ intent, scope }); return { text: '回应' }; }
  };
}

function makeRegistry() {
  const registry = new IntentRegistry();
  registry.discoverBuiltins([
    intentFromDeclaration({ id: 'idle-chat', trigger: { when: TriggerWhen.Idle } }, 'builtin'),
    intentFromDeclaration({ id: 'on-click', trigger: { when: TriggerWhen.ModEvent, event: 'click' } }, 'mod:demo'),
    intentFromDeclaration({ id: 'on-win', trigger: { when: TriggerWhen.ModEvent, event: 'win' } }, 'mod:demo')
  ]);
  return registry;
}

//// 交互事件触发声明消费它的意图,空闲意图不因一次交互被触发 [@busybee 2026-06-14] ////
test('InteractionRouter 把 click 交互路由到声明消费 click 的意图,空闲意图被滤掉', async () => {
  const bus = new EventBus();
  const pet = makeFakePet();
  const router = new InteractionRouter({ eventBus: bus, registry: makeRegistry(), pet });
  router.start();

  bus.publish(new InteractionEvent('click', { area: 'head' }));
  await new Promise((r) => setImmediate(r)); // 等异步路由跑完

  assert.strictEqual(pet.ran.length, 1);
  assert.strictEqual(pet.ran[0].intent.id, 'on-click');
  // 候选只含 mod 事件意图,且都匹配 click,不含 idle 与 on-win
  const ids = pet.selected[0].candidates.map((i) => i.id);
  assert.deepStrictEqual(ids, ['on-click']);
  // 交互语义带进 scope
  assert.deepStrictEqual(pet.ran[0].scope.interaction, { name: 'click', payload: { area: 'head' } });
});

test('InteractionRouter 无匹配意图时不选不跑', async () => {
  const bus = new EventBus();
  const pet = makeFakePet();
  const router = new InteractionRouter({ eventBus: bus, registry: makeRegistry(), pet });
  router.start();
  bus.publish(new InteractionEvent('no-such-event', null));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(pet.selected.length, 0);
  assert.strictEqual(pet.ran.length, 0);
});

test('InteractionRouter stop 后不再路由', async () => {
  const bus = new EventBus();
  const pet = makeFakePet();
  const router = new InteractionRouter({ eventBus: bus, registry: makeRegistry(), pet });
  router.start();
  router.stop();
  bus.publish(new InteractionEvent('click', null));
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(pet.ran.length, 0);
});

test('InteractionRouter 忽略无名交互事件', async () => {
  const bus = new EventBus();
  const pet = makeFakePet();
  const router = new InteractionRouter({ eventBus: bus, registry: makeRegistry(), pet });
  router.start();
  bus.publish({ type: 'InteractionEvent', name: '', payload: null });
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(pet.ran.length, 0);
});
//// /交互事件触发声明消费它的意图 ////
