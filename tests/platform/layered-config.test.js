// audience: internal
// # layered-config.test
// 验证 ScopeResolver 的行为契约:就近覆盖、向上回退、各键 floor 裁剪。

const { test } = require('node:test');
const assert = require('node:assert');
const { ScopeResolver, ResolvedScope, KEY_FLOOR, DEFAULT_FLOOR } = require('../../src/platform/config/layered-config');

//// 装配一份三层快照交给解析器 [@x380kkm 2026-06-13] ////
function resolverFrom({ global = {}, character = {}, intent = {} }) {
  const scope = new ResolvedScope();
  scope.global = global;
  scope.character = character;
  scope.intent = intent;
  return new ScopeResolver(scope);
}

test('就近覆盖:意图层值盖过角色层与全局层', () => {
  const r = resolverFrom({
    global: { maxTokensMultiplier: 1 },
    character: { maxTokensMultiplier: 1.5 },
    intent: { maxTokensMultiplier: 2 }
  });
  assert.strictEqual(r.resolve('maxTokensMultiplier'), 2);
});

test('向上回退:意图层未给时落到角色层', () => {
  const r = resolverFrom({
    global: { emotionFrequency: 30 },
    character: { emotionFrequency: 50 },
    intent: {}
  });
  assert.strictEqual(r.resolve('emotionFrequency'), 50);
});

test('向上回退到全局层兜底', () => {
  const r = resolverFrom({ global: { emotionFrequency: 30 }, character: {}, intent: {} });
  assert.strictEqual(r.resolve('emotionFrequency'), 30);
});

test('三层都没有该键时返回 undefined', () => {
  const r = resolverFrom({});
  assert.strictEqual(r.resolve('emotionFrequency'), undefined);
});

test('floor=global 的键忽略角色层与意图层的值', () => {
  const r = resolverFrom({
    global: { apiKey: 'global-key' },
    character: { apiKey: 'character-key' },
    intent: { apiKey: 'intent-key' }
  });
  assert.strictEqual(r.resolve('apiKey'), 'global-key');
});

test('floor=character 的键忽略意图层但接受角色层', () => {
  const r = resolverFrom({
    global: { emotionFrequency: 30 },
    character: { emotionFrequency: 50 },
    intent: { emotionFrequency: 99 }
  });
  // 意图层低于 character floor,其值无效,回退到角色层。
  assert.strictEqual(r.resolve('emotionFrequency'), 50);
});

test('floor=global 的键只有全局层没给时才返回 undefined', () => {
  const r = resolverFrom({ global: {}, character: { apiKey: 'character-key' }, intent: {} });
  assert.strictEqual(r.resolve('apiKey'), undefined);
});

test('lockedLayer 返回键声明表里的 floor', () => {
  assert.strictEqual(r_lockedLayer('apiKey'), 'global');
  assert.strictEqual(r_lockedLayer('emotionFrequency'), 'character');
  assert.strictEqual(r_lockedLayer('maxTokensMultiplier'), 'intent');
});

test('未声明的键 floor 默认为 character', () => {
  assert.strictEqual(r_lockedLayer('someUnlistedKey'), DEFAULT_FLOOR);
  assert.strictEqual(DEFAULT_FLOOR, 'character');
});

test('键声明表把模型接入键锁在全局层', () => {
  for (const key of ['apiKey', 'baseURL', 'modelName']) {
    assert.strictEqual(KEY_FLOOR[key], 'global', `${key} 应锁全局`);
  }
});

//// 取一份空快照的解析器只为查 floor [@x380kkm 2026-06-13] ////
function r_lockedLayer(key) {
  return resolverFrom({}).lockedLayer(key);
}
