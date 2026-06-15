// audience: internal
// # mod-registry.test
// 验证 ModRegistry:从注入仓储发现并按 id 索引、两级启用合并保序去重、
// 角色额外开启叠加在全局默认之上、未发现的启用 id 被跳过。

const { test } = require('node:test');
const assert = require('node:assert');
const { ModRegistry } = require('../../src/domain/mod/mod-registry');

//// 用规格数组构造一个最简注入仓储 [@x380kkm 2026-06-13] ////
function fakeSource(specs) {
  return { list() { return specs; } };
}

//// 发现把仓储规格物化成按 id 索引的 mod [@x380kkm 2026-06-13] ////
test('discover materializes specs indexed by id', () => {
  const registry = new ModRegistry({
    source: fakeSource([{ id: 'a' }, { id: 'b' }])
  });
  const discovered = registry.discover();
  assert.deepStrictEqual(discovered.map((m) => m.id), ['a', 'b']);
});

//// 全局默认在所有角色生效 [@x380kkm 2026-06-13] ////
test('global default enabled applies to every character', () => {
  const registry = new ModRegistry({
    source: fakeSource([{ id: 'a' }, { id: 'b' }]),
    globalEnabled: ['a']
  });
  registry.discover();
  assert.deepStrictEqual(registry.enabledFor('anyone').map((m) => m.id), ['a']);
});

//// 角色额外开启叠加在全局默认之后 [@x380kkm 2026-06-13] ////
test('character extra stacks after the global default', () => {
  const registry = new ModRegistry({
    source: fakeSource([{ id: 'a' }, { id: 'b' }, { id: 'c' }]),
    globalEnabled: ['a'],
    characterExtra: { lily: ['c'] }
  });
  registry.discover();
  assert.deepStrictEqual(registry.enabledFor('lily').map((m) => m.id), ['a', 'c']);
  // 没有额外开启的角色只拿到全局默认。
  assert.deepStrictEqual(registry.enabledFor('other').map((m) => m.id), ['a']);
});

//// 两级重复的 id 合并后只保留一份且保序 [@x380kkm 2026-06-13] ////
test('an id enabled at both levels is merged once in order', () => {
  const registry = new ModRegistry({
    source: fakeSource([{ id: 'a' }, { id: 'b' }]),
    globalEnabled: ['a', 'b'],
    characterExtra: { lily: ['a'] }
  });
  registry.discover();
  assert.deepStrictEqual(registry.enabledFor('lily').map((m) => m.id), ['a', 'b']);
});

//// 未发现的启用 id 被跳过 [@x380kkm 2026-06-13] ////
test('enabled ids without a discovered mod are skipped', () => {
  const registry = new ModRegistry({
    source: fakeSource([{ id: 'a' }]),
    globalEnabled: ['a', 'ghost']
  });
  registry.discover();
  assert.deepStrictEqual(registry.enabledFor('anyone').map((m) => m.id), ['a']);
});
