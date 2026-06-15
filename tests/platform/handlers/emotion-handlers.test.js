// 验证 emotion-handlers 的转发契约:通道发布领域事件、经总线转发到正确窗口、死窗口被过滤。
const { test } = require('node:test');
const assert = require('node:assert');

const router = require('../../../src/platform/ipc/ipc-router');
const { EventBus } = require('../../../src/platform/bus/event-bus');
const { registerEmotionHandlers } = require('../../../src/platform/ipc/handlers/emotion-handlers');

// 造一个记录 send 调用、可标记销毁的假窗口 [@x380kkm 2026-06-13]
function makeWindow() {
  const sent = [];
  let destroyed = false;
  return {
    sent,
    destroy() { destroyed = true; },
    window: {
      isDestroyed: () => destroyed,
      webContents: { send: (...args) => sent.push(args) }
    }
  };
}

// 把真实 router 与真实总线装好,注入取宠物窗口与设置窗口的取值函数 [@x380kkm 2026-06-13]
function setup() {
  router.reset();
  const bus = new EventBus();
  const pet = makeWindow();
  const settings = makeWindow();
  registerEmotionHandlers({
    router,
    bus,
    petWindow: () => pet.window,
    settingsWindow: () => settings.window
  });
  return { bus, pet, settings };
}

test('trigger-expression 经总线把表情转发到宠物窗口', async () => {
  const { pet, settings } = setup();
  const result = await router.dispatch('trigger-expression', 'smile');
  assert.deepStrictEqual(result, { success: true });
  assert.deepStrictEqual(pet.sent, [['play-expression', 'smile']]);
  assert.strictEqual(settings.sent.length, 0);
});

test('revert-expression 转发到宠物窗口且不带参数', async () => {
  const { pet } = setup();
  await router.dispatch('revert-expression', null);
  assert.deepStrictEqual(pet.sent, [['revert-expression']]);
});

test('trigger-motion 把组与序号转发到宠物窗口', async () => {
  const { pet } = setup();
  await router.dispatch('trigger-motion', { group: 'TapBody', index: 2 });
  assert.deepStrictEqual(pet.sent, [['play-motion', 'TapBody', 2]]);
});

test('set-talking-state 把说话态转发到宠物窗口', async () => {
  const { pet } = setup();
  await router.dispatch('set-talking-state', true);
  assert.deepStrictEqual(pet.sent, [['talking-state-changed', true]]);
});

test('report-hover-state 把悬停态转发到设置窗口而非宠物窗口', async () => {
  const { pet, settings } = setup();
  await router.dispatch('report-hover-state', true);
  assert.deepStrictEqual(settings.sent, [['pet-hover-state', true]]);
  assert.strictEqual(pet.sent.length, 0);
});

test('report-hit 把命中数据转发到设置窗口', async () => {
  const { settings } = setup();
  await router.dispatch('report-hit', { x: 1, y: 2 });
  assert.deepStrictEqual(settings.sent, [['pet-hit', { x: 1, y: 2 }]]);
});

test('目标窗口已销毁时不转发,且该订阅被总线剔除', async () => {
  const { bus, pet } = setup();
  pet.destroy();
  await router.dispatch('trigger-expression', 'cry');
  assert.strictEqual(pet.sent.length, 0);
  // 死订阅已被剔除:即便窗口复活,旧订阅也不再分发该事件
  bus.publish({ type: 'PlayExpression', args: ['again'] });
  assert.strictEqual(pet.sent.length, 0);
});

test('一类事件的转发不波及另一类的目标窗口', async () => {
  const { pet, settings } = setup();
  await router.dispatch('trigger-expression', 'smile');
  await router.dispatch('report-hit', { hit: true });
  assert.deepStrictEqual(pet.sent, [['play-expression', 'smile']]);
  assert.deepStrictEqual(settings.sent, [['pet-hit', { hit: true }]]);
});
