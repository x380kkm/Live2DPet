// audience: internal
// # intent-registry.test
// 验证 IntentRegistry 的行为契约:从出厂、mod、角色的数据声明发现注入(可追溯,非深反射);
// 同 id 后注册覆盖;candidates 按作用域信号过滤触发;情绪焦点反重复不参与触发。

const { test } = require('node:test');
const assert = require('node:assert');
const { Intent, TriggerWhen, intentFromDeclaration } = require('../../src/domain/intent/intent');
const { IntentRegistry } = require('../../src/domain/intent/intent-registry');
const { builtinIntents } = require('../../src/domain/intent/builtin-intents');

//// 构造一个已解析意图实例的小工厂,供注册用 [@x380kkm 2026-06-13] ////
function makeIntent(id, trigger, origin) {
  return intentFromDeclaration({ id, trigger }, origin);
}

//// 出厂意图被逐条发现注入并可枚举 [@x380kkm 2026-06-13] ////
test('discoverBuiltins injects each builtin intent', () => {
  const registry = new IntentRegistry();
  registry.discoverBuiltins(builtinIntents());

  const all = registry.candidates({ signals: { hasVisualInput: true, modEvents: [] } });
  assert.ok(all.some((i) => i.id === 'observe-response'));
});

//// 有视觉输入只取视觉触发的意图 [@x380kkm 2026-06-13] ////
test('candidates with visual input selects visual-input intents', () => {
  const registry = new IntentRegistry();
  registry.discoverBuiltins(builtinIntents());

  const candidates = registry.candidates({ signals: { hasVisualInput: true } });
  const ids = candidates.map((i) => i.id);
  assert.deepStrictEqual(ids, ['observe-response']);
});

//// 无视觉输入只取空闲触发的意图 [@x380kkm 2026-06-13] ////
test('candidates without visual input selects idle intents', () => {
  const registry = new IntentRegistry();
  registry.discoverBuiltins(builtinIntents());

  const candidates = registry.candidates({ signals: { hasVisualInput: false } });
  const ids = candidates.map((i) => i.id);
  assert.deepStrictEqual(ids, ['idle-chat']);
});

//// 从 mod 的数据声明发现注入,来源可追溯到 mod id [@x380kkm 2026-06-13] ////
test('discoverFromMods resolves each mod intent declaration and tags the mod id as origin', () => {
  const registry = new IntentRegistry();
  // mock 一个 mod:只用纯数据声明,意图作为数据出现在 intents 数组
  const gameMod = {
    id: 'tic-tac-toe',
    intents: [
      { id: 'game-start', trigger: { when: TriggerWhen.ModEvent, event: 'game:start' } },
      { id: 'game-win', trigger: { when: TriggerWhen.ModEvent, event: 'game:win' } },
    ],
  };
  registry.discoverFromMods([gameMod]);

  const candidates = registry.candidates({ signals: { modEvents: ['game:win'] } });
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].id, 'game-win');
  assert.strictEqual(candidates[0].origin, 'tic-tac-toe');
});

//// mod 已解析的意图实例直接注册不重复解析 [@x380kkm 2026-06-13] ////
test('discoverFromMods registers an already-resolved Intent instance as-is', () => {
  const registry = new IntentRegistry();
  const resolved = makeIntent('preset', { when: TriggerWhen.Idle }, 'preset-origin');
  registry.discoverFromMods([{ id: 'mod-a', intents: [resolved] }]);

  const candidates = registry.candidates({ signals: { hasVisualInput: false } });
  const preset = candidates.find((i) => i.id === 'preset');
  assert.ok(preset instanceof Intent);
  assert.strictEqual(preset.origin, 'preset-origin');
});

//// 从角色的数据声明发现注入,来源可追溯到角色 id [@x380kkm 2026-06-13] ////
test('discoverFromCharacter tags the character id as origin', () => {
  const registry = new IntentRegistry();
  const character = {
    id: 'yuki',
    intents: [{ id: 'greet', trigger: { when: TriggerWhen.Idle } }],
  };
  registry.discoverFromCharacter(character);

  const candidates = registry.candidates({ signals: { hasVisualInput: false } });
  const greet = candidates.find((i) => i.id === 'greet');
  assert.strictEqual(greet.origin, 'character:yuki');
});

//// 同 id 后注册者覆盖先注册者 [@x380kkm 2026-06-13] ////
test('registering the same id twice keeps the later one', () => {
  const registry = new IntentRegistry();
  registry.register(makeIntent('dup', { when: TriggerWhen.Idle }, 'first'));
  registry.register(makeIntent('dup', { when: TriggerWhen.Idle }, 'second'));

  const candidates = registry.candidates({ signals: { hasVisualInput: false } });
  const dups = candidates.filter((i) => i.id === 'dup');
  assert.strictEqual(dups.length, 1);
  assert.strictEqual(dups[0].origin, 'second');
});

//// 具名 mod 事件只在该事件到达时触发 [@x380kkm 2026-06-13] ////
test('a mod-event intent is a candidate only when its event is present', () => {
  const registry = new IntentRegistry();
  registry.register(makeIntent('on-win', { when: TriggerWhen.ModEvent, event: 'game:win' }, 'mod:game'));

  assert.strictEqual(registry.candidates({ signals: { modEvents: [] } }).length, 0);
  assert.strictEqual(registry.candidates({ signals: { modEvents: ['game:lose'] } }).length, 0);
  assert.strictEqual(registry.candidates({ signals: { modEvents: ['game:win'] } }).length, 1);
});

//// 缺 signals 的作用域不抛错,按无视觉输入处理 [@x380kkm 2026-06-13] ////
test('candidates tolerates a scope without signals', () => {
  const registry = new IntentRegistry();
  registry.discoverBuiltins(builtinIntents());

  assert.doesNotThrow(() => registry.candidates({}));
  const ids = registry.candidates({}).map((i) => i.id);
  assert.deepStrictEqual(ids, ['idle-chat']);
});

//// 注册缺 id 的意图报清晰错误 [@x380kkm 2026-06-13] ////
test('register rejects an intent without an id', () => {
  const registry = new IntentRegistry();
  assert.throws(() => registry.register({ trigger: { when: TriggerWhen.Idle } }), /缺少字符串 id/);
});
