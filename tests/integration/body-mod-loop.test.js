// audience: internal
// # body-mod-loop.test
// 验证身体交互 mod 的整条领域闭环:出厂 mod 经文件源被发现、其意图注入注册表,
// 一次 click 交互事件经交互路由触发 body-click 意图并跑出回应。pet 用记录调用的假编排器,不调真实模型。

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createModSource } = require('../../src/platform/mod/mod-source.js');
const { ModRegistry } = require('../../src/domain/mod/mod-registry.js');
const { IntentRegistry } = require('../../src/domain/intent/intent-registry.js');
const { InteractionRouter } = require('../../src/domain/pet/interaction-router.js');
const { EventBus } = require('../../src/platform/bus/event-bus.js');
const { InteractionEvent } = require('../../src/domain/mod/interaction-event.js');

const MODS_DIR = path.join(__dirname, '..', '..', 'assets', 'mods');

//// 出厂身体交互 mod 经文件源被发现并注入意图 [@x380kkm 2026-06-14] ////
test('出厂 body-interaction mod 被发现,其 click 与 touch 意图注入注册表', () => {
  const source = createModSource({ dirs: [{ dir: MODS_DIR, trust: 'Official' }], fs, path });
  const registry = new ModRegistry({ source, globalEnabled: [] });
  const mods = registry.discover();
  const body = mods.find((m) => m.id === 'body-interaction');
  assert.ok(body, '应发现出厂 body-interaction mod');
  assert.strictEqual(body.trust, 'Official');

  const intentRegistry = new IntentRegistry();
  intentRegistry.discoverFromMods(mods);
  const ids = intentRegistry.candidates({ signals: { hasVisualInput: false, modEvents: ['click'] } }).map((i) => i.id);
  assert.ok(ids.includes('body-click'), 'click 信号应能触发 body-click 意图');
});

//// 一次 click 交互经路由触发 body-click 意图并跑出回应 [@x380kkm 2026-06-14] ////
test('click 交互事件经交互路由触发 body-click 意图', async () => {
  const source = createModSource({ dirs: [{ dir: MODS_DIR, trust: 'Official' }], fs, path });
  const mods = new ModRegistry({ source, globalEnabled: [] }).discover();
  const intentRegistry = new IntentRegistry();
  intentRegistry.discoverFromMods(mods);

  const bus = new EventBus();
  const ran = [];
  const pet = {
    async selectIntent(candidates) { return candidates[0] || null; },
    async run(intent, scope) { ran.push({ intent, scope }); return { text: '诶?干嘛戳我' }; }
  };
  const router = new InteractionRouter({ eventBus: bus, registry: intentRegistry, pet });
  router.start();

  bus.publish(new InteractionEvent('click', { area: 'head' }));
  await new Promise((r) => setImmediate(r));

  assert.strictEqual(ran.length, 1);
  assert.strictEqual(ran[0].intent.id, 'body-click');
  // 交互语义带进作用域,供 interactionInfo 上下文源渲染
  assert.deepStrictEqual(ran[0].scope.interaction, { name: 'click', payload: { area: 'head' } });
});
//// /出厂身体交互 mod 经文件源被发现并注入意图 ////
