// audience: internal
// # mod.test
// 验证 Mod 模板与 ModRuntime:挂载只放行声明的宿主方法、emit 经注入发布器送出交互事件、
// 未挂载或事件名非法时拒绝产出、dispose 后清空状态。

const { test } = require('node:test');
const assert = require('node:assert');
const { Mod, ModRuntime, TRUST } = require('../../src/domain/mod/mod');
const { INTERACTION_EVENT_TYPE } = require('../../src/domain/mod/interaction-event');

//// 规格物化成纯数据模板,缺省信任级别为用户自定义 [@busybee 2026-06-13] ////
test('mod materializes spec and defaults to user-custom trust', () => {
  const mod = new Mod({ id: 'pat', emits: ['click'], intents: [{ id: 'react' }], hostApi: ['playAction'] });
  assert.strictEqual(mod.id, 'pat');
  assert.strictEqual(mod.trust, TRUST.USER_CUSTOM);
  assert.strictEqual(mod.isOfficial(), false);
  assert.deepStrictEqual(mod.emits, ['click']);
  assert.deepStrictEqual(mod.intents, [{ id: 'react' }]);
});

//// 出厂信任级别被识别 [@busybee 2026-06-13] ////
test('official trust is recognized', () => {
  const mod = new Mod({ id: 'builtin', trust: TRUST.OFFICIAL });
  assert.strictEqual(mod.isOfficial(), true);
});

//// 挂载只放行 mod 声明的宿主方法 [@busybee 2026-06-13] ////
test('mount exposes only the host methods the mod declares', () => {
  const mod = new Mod({ id: 'pat', hostApi: ['playAction'] });
  const fullApi = {
    playAction() { return 'played'; },
    shutdownMachine() { return 'forbidden'; }
  };
  const runtime = new ModRuntime(mod, () => {});

  const mounted = runtime.mount({ root: true }, fullApi);

  assert.strictEqual(typeof mounted.api.playAction, 'function');
  assert.strictEqual(mounted.api.shutdownMachine, undefined);
  assert.strictEqual(mounted.api.playAction(), 'played');
});

//// emit 经注入发布器送出一个交互事件 [@busybee 2026-06-13] ////
test('emit publishes an interaction event through the injected publisher', () => {
  const published = [];
  const mod = new Mod({ id: 'pat', hostApi: [] });
  const runtime = new ModRuntime(mod, (event) => published.push(event));
  runtime.mount({}, {});

  const event = runtime.emit('touch', { durationMs: 400 });

  assert.strictEqual(published.length, 1);
  assert.strictEqual(published[0].type, INTERACTION_EVENT_TYPE);
  assert.strictEqual(published[0].name, 'touch');
  assert.deepStrictEqual(published[0].payload, { durationMs: 400 });
  assert.strictEqual(event, published[0]);
});

//// 未挂载时 emit 拒绝产出 [@busybee 2026-06-13] ////
test('emit before mount is rejected', () => {
  const runtime = new ModRuntime(new Mod({ id: 'pat' }), () => {});
  assert.throws(() => runtime.emit('click', {}), /未挂载/);
});

//// 事件名缺失时 emit 拒绝产出 [@busybee 2026-06-13] ////
test('emit with a missing event name is rejected', () => {
  const published = [];
  const runtime = new ModRuntime(new Mod({ id: 'pat' }), (e) => published.push(e));
  runtime.mount({}, {});
  assert.throws(() => runtime.emit('', {}), /非法/);
  assert.strictEqual(published.length, 0);
});

//// dispose 后清空状态并阻断 emit [@busybee 2026-06-13] ////
test('dispose clears state and blocks further emit', () => {
  const runtime = new ModRuntime(new Mod({ id: 'pat' }), () => {});
  runtime.mount({}, {});
  runtime.dispose();
  assert.throws(() => runtime.emit('click', {}), /未挂载/);
});
