// audience: internal
// # interactionInfo-source.test
// 验证交互信息上下文源:按交互名取描述、未知名给兜底描述、无交互返回 null、优先级高。

const { test } = require('node:test');
const assert = require('node:assert');
const { InteractionInfoSource } = require('../../src/domain/pet/sources/interaction-info-source.js');

//// 按交互名取描述,未知名兜底,无交互返回 null [@x380kkm 2026-06-14] ////
test('InteractionInfoSource 据 scope.interaction.name 取描述', () => {
  const source = new InteractionInfoSource();
  assert.strictEqual(source.render({ interaction: { name: 'click' } }), '用户刚刚点了你一下。');
  assert.strictEqual(source.render({ interaction: { name: 'touch' } }), '用户刚刚轻轻摸了摸你。');
  // 未知交互名给兜底描述
  assert.ok(source.render({ interaction: { name: 'poke' } }).includes('poke'));
});

test('InteractionInfoSource 无交互时返回 null,优先级高于一般上下文', () => {
  const source = new InteractionInfoSource();
  assert.strictEqual(source.render({}), null);
  assert.strictEqual(source.render({ interaction: {} }), null);
  assert.ok(source.priority >= 90);
});

test('InteractionInfoSource 描述表可由配置覆盖', () => {
  const source = new InteractionInfoSource({}, { labels: { click: 'CLICKED' } });
  assert.strictEqual(source.render({ interaction: { name: 'click' } }), 'CLICKED');
});
//// /按交互名取描述 ////
