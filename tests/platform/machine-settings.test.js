// audience: internal
// # machine-settings.test
// 验证 MachineSettings 的行为契约:只承载全局层键、经 config-store 读写、拒绝非全局键。

const { test } = require('node:test');
const assert = require('node:assert');
const { MachineSettings, GLOBAL_KEYS } = require('../../src/platform/config/machine-settings');

//// 构造记录读写调用的 config-store mock [@x380kkm 2026-06-13] ////
function mockStore(globalSnapshot = {}) {
  const writes = [];
  return {
    writes,
    async read(layer) {
      return layer === 'global' ? { ...globalSnapshot } : null;
    },
    async write(layer, scopeId, value) {
      writes.push({ layer, scopeId, value: JSON.parse(JSON.stringify(value)) });
    }
  };
}

test('load 经 config-store 读全局层装配实例', async () => {
  const store = mockStore({ baseURL: 'https://x' });
  const ms = await MachineSettings.load(store);
  assert.strictEqual(ms.get('baseURL'), 'https://x');
});

test('load 在全局层为空时给出空设置', async () => {
  const store = { async read() { return null; }, async write() {} };
  const ms = await MachineSettings.load(store);
  assert.strictEqual(ms.get('apiKey'), undefined);
});

test('set 经 config-store 写全局层', async () => {
  const store = mockStore();
  const ms = new MachineSettings(store, {});
  await ms.set('modelName', 'grok');
  assert.strictEqual(ms.get('modelName'), 'grok');
  assert.strictEqual(store.writes.length, 1);
  assert.strictEqual(store.writes[0].layer, 'global');
  assert.strictEqual(store.writes[0].value.modelName, 'grok');
});

test('get 拒绝非全局层键', () => {
  const ms = new MachineSettings(mockStore(), {});
  assert.throws(() => ms.get('emotionFrequency'), /不是全局层键/);
});

test('set 拒绝非全局层键且不落盘', async () => {
  const store = mockStore();
  const ms = new MachineSettings(store, {});
  await assert.rejects(() => ms.set('maxTokensMultiplier', 5), /不是全局层键/);
  assert.strictEqual(store.writes.length, 0);
});

test('全局层键集合只含 floor 为 global 的键', () => {
  assert.ok(GLOBAL_KEYS.has('apiKey'));
  assert.ok(GLOBAL_KEYS.has('uiLanguage'));
  assert.ok(!GLOBAL_KEYS.has('emotionFrequency'));
});
