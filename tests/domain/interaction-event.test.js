// audience: internal
// # interaction-event.test
// 验证交互事件契约:固定 type 让意图层统一订阅,合法性校验只认非空 name,payload 原样承载。

const { test } = require('node:test');
const assert = require('node:assert');
const { InteractionEvent, isInteractionEvent, INTERACTION_EVENT_TYPE } = require('../../src/domain/mod/interaction-event');

//// 构造的事件 type 恒为交互事件类型 [@busybee 2026-06-13] ////
test('event carries the fixed interaction type', () => {
  const event = new InteractionEvent('click', { area: 'head' });
  assert.strictEqual(event.type, INTERACTION_EVENT_TYPE);
  assert.strictEqual(event.name, 'click');
  assert.deepStrictEqual(event.payload, { area: 'head' });
});

//// 缺省 name 与 payload 落到 null [@busybee 2026-06-13] ////
test('missing name and payload default to null', () => {
  const event = new InteractionEvent();
  assert.strictEqual(event.name, null);
  assert.strictEqual(event.payload, null);
});

//// 合法事件需 type 匹配且 name 非空 [@busybee 2026-06-13] ////
test('isInteractionEvent accepts a well-formed event', () => {
  assert.strictEqual(isInteractionEvent(new InteractionEvent('drag', {})), true);
});

//// 类型不符或 name 缺失的值被判非法 [@busybee 2026-06-13] ////
test('isInteractionEvent rejects wrong type or empty name', () => {
  assert.strictEqual(isInteractionEvent({ type: 'EmotionChanged', name: 'click' }), false);
  assert.strictEqual(isInteractionEvent(new InteractionEvent('')), false);
  assert.strictEqual(isInteractionEvent(null), false);
});
