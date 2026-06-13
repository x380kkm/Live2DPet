// 用 mock 钩子断言 expression-area 的排他仲裁:同一时刻至多一个占用者主导。
const { test } = require('node:test');
const assert = require('node:assert');

// 记录每个占用者激活与停用的次数,验证切换时的钩子调用
function makeHooks() {
  const log = { mod: { activate: 0, deactivate: 0 }, bubble: { activate: 0, deactivate: 0 } };
  return {
    log,
    hooks: (Occupant) => ({
      [Occupant.ModFrontend]: {
        activate: () => log.mod.activate++,
        deactivate: () => log.mod.deactivate++,
      },
      [Occupant.Bubble]: {
        activate: () => log.bubble.activate++,
        deactivate: () => log.bubble.deactivate++,
      },
    }),
  };
}

test('构造后无占用者主导', async () => {
  const { ExpressionArea } = await import('../../src/renderer/stage/expression-area.js');
  const area = new ExpressionArea();
  assert.strictEqual(area.dominant, null);
});

test('takeOver 让占用者主导并激活它', async () => {
  const { ExpressionArea, Occupant } = await import('../../src/renderer/stage/expression-area.js');
  const { log, hooks } = makeHooks();
  const area = new ExpressionArea(hooks(Occupant));
  const displaced = area.takeOver(Occupant.Bubble);
  assert.strictEqual(displaced, null);
  assert.ok(area.isDominant(Occupant.Bubble));
  assert.strictEqual(log.bubble.activate, 1);
});

test('takeOver 切换时停用原主导并返回被替下的占用者', async () => {
  const { ExpressionArea, Occupant } = await import('../../src/renderer/stage/expression-area.js');
  const { log, hooks } = makeHooks();
  const area = new ExpressionArea(hooks(Occupant));
  area.takeOver(Occupant.Bubble);
  const displaced = area.takeOver(Occupant.ModFrontend);
  assert.strictEqual(displaced, Occupant.Bubble);
  assert.ok(area.isDominant(Occupant.ModFrontend));
  assert.strictEqual(log.bubble.deactivate, 1);
  assert.strictEqual(log.mod.activate, 1);
});

test('takeOver 对已主导的占用者是空操作,不重复激活', async () => {
  const { ExpressionArea, Occupant } = await import('../../src/renderer/stage/expression-area.js');
  const { log, hooks } = makeHooks();
  const area = new ExpressionArea(hooks(Occupant));
  area.takeOver(Occupant.Bubble);
  const displaced = area.takeOver(Occupant.Bubble);
  assert.strictEqual(displaced, null);
  assert.strictEqual(log.bubble.activate, 1);
});

test('任意时刻至多一个占用者主导', async () => {
  const { ExpressionArea, Occupant } = await import('../../src/renderer/stage/expression-area.js');
  const { hooks } = makeHooks();
  const area = new ExpressionArea(hooks(Occupant));
  area.takeOver(Occupant.Bubble);
  area.takeOver(Occupant.ModFrontend);
  assert.strictEqual(area.isDominant(Occupant.Bubble), false);
  assert.strictEqual(area.isDominant(Occupant.ModFrontend), true);
});

test('release 停用当前主导并回到无人占用', async () => {
  const { ExpressionArea, Occupant } = await import('../../src/renderer/stage/expression-area.js');
  const { log, hooks } = makeHooks();
  const area = new ExpressionArea(hooks(Occupant));
  area.takeOver(Occupant.Bubble);
  area.release();
  assert.strictEqual(area.dominant, null);
  assert.strictEqual(log.bubble.deactivate, 1);
});

test('release 在无人占用时是空操作', async () => {
  const { ExpressionArea } = await import('../../src/renderer/stage/expression-area.js');
  const area = new ExpressionArea();
  assert.doesNotThrow(() => area.release());
  assert.strictEqual(area.dominant, null);
});
