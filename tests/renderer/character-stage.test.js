// 断言 character-stage 的尺寸预算与排他仲裁:用假槽与假气泡,验证主导切换与预算钳制。
const { test } = require('node:test');
const assert = require('node:assert');

// 造假 mod 槽,记录 clear 调用
function makeModSlot() {
  const calls = { clear: 0 };
  return { calls, clear() { calls.clear++; } };
}

// 造假气泡,记录 show 与 hide
function makeBubble() {
  const calls = { show: [], hide: 0 };
  return { calls, show(text) { calls.show.push(text); }, hide() { calls.hide++; } };
}

const STAGE_SIZE = { width: 300, height: 300 };

test('computeExpressionBudget 宽随舞台,高给头部留出比例', async () => {
  const { computeExpressionBudget } = await import('../../src/renderer/stage/character-stage.js');
  const budget = computeExpressionBudget({ width: 300, height: 300 }, 0.4);
  assert.deepStrictEqual(budget, { width: 300, height: 180 });
});

test('computeExpressionBudget 把越界的预留比例钳进 0 到 1', async () => {
  const { computeExpressionBudget } = await import('../../src/renderer/stage/character-stage.js');
  assert.deepStrictEqual(computeExpressionBudget({ width: 200, height: 200 }, 2), { width: 200, height: 0 });
  assert.deepStrictEqual(computeExpressionBudget({ width: 200, height: 200 }, -1), { width: 200, height: 200 });
});

test('fitWithinBudget 把请求尺寸钳进预算,不放大', async () => {
  const { fitWithinBudget } = await import('../../src/renderer/stage/character-stage.js');
  assert.deepStrictEqual(fitWithinBudget({ width: 500, height: 500 }, { width: 300, height: 180 }), { width: 300, height: 180 });
  assert.deepStrictEqual(fitWithinBudget({ width: 100, height: 100 }, { width: 300, height: 180 }), { width: 100, height: 100 });
});

test('mountHead 记下渲染适配并返回它', async () => {
  const { CharacterStage } = await import('../../src/renderer/stage/character-stage.js');
  const stage = new CharacterStage({ stageSize: STAGE_SIZE, modSlot: makeModSlot(), chatBubble: makeBubble() });
  const adapter = { id: 'live2d' };
  assert.strictEqual(stage.mountHead(adapter), adapter);
  assert.strictEqual(stage.headAdapter, adapter);
});

test('allocateModSlot 让 mod 槽占主导,返回带尺寸上限的句柄', async () => {
  const { CharacterStage } = await import('../../src/renderer/stage/character-stage.js');
  const { Occupant } = await import('../../src/renderer/stage/expression-area.js');
  const stage = new CharacterStage({ stageSize: STAGE_SIZE, modSlot: makeModSlot(), chatBubble: makeBubble() });
  const handle = stage.allocateModSlot('game');
  assert.strictEqual(handle.modId, 'game');
  assert.deepStrictEqual(handle.sizeCap, { width: 300, height: 180 });
  assert.strictEqual(stage.arbitrate(), Occupant.ModFrontend);
});

test('showBubble 让气泡占主导并把文本交给气泡视图', async () => {
  const { CharacterStage } = await import('../../src/renderer/stage/character-stage.js');
  const { Occupant } = await import('../../src/renderer/stage/expression-area.js');
  const bubble = makeBubble();
  const stage = new CharacterStage({ stageSize: STAGE_SIZE, modSlot: makeModSlot(), chatBubble: bubble });
  stage.showBubble('你好');
  assert.deepStrictEqual(bubble.calls.show, ['你好']);
  assert.strictEqual(stage.arbitrate(), Occupant.Bubble);
});

test('从 mod 槽切到气泡时清空 mod 槽,守住至多一个主导', async () => {
  const { CharacterStage } = await import('../../src/renderer/stage/character-stage.js');
  const { Occupant } = await import('../../src/renderer/stage/expression-area.js');
  const modSlot = makeModSlot();
  const bubble = makeBubble();
  const stage = new CharacterStage({ stageSize: STAGE_SIZE, modSlot, chatBubble: bubble });
  stage.allocateModSlot('game');
  stage.showBubble('打断');
  assert.strictEqual(modSlot.calls.clear, 1);
  assert.strictEqual(stage.arbitrate(), Occupant.Bubble);
});

test('从气泡切到 mod 槽时隐藏气泡', async () => {
  const { CharacterStage } = await import('../../src/renderer/stage/character-stage.js');
  const { Occupant } = await import('../../src/renderer/stage/expression-area.js');
  const modSlot = makeModSlot();
  const bubble = makeBubble();
  const stage = new CharacterStage({ stageSize: STAGE_SIZE, modSlot, chatBubble: bubble });
  stage.showBubble('你好');
  stage.allocateModSlot('game');
  assert.strictEqual(bubble.calls.hide, 1);
  assert.strictEqual(stage.arbitrate(), Occupant.ModFrontend);
});
