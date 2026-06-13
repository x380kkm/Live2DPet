// audience: internal
// # config-store.test
// 验证 config-store 的行为契约:经仓储读写、加密字段只在落盘时加密、读时透明解密。

const { test } = require('node:test');
const assert = require('node:assert');
const { ConfigStore, ENCRYPTED_FIELDS } = require('../../src/platform/config/config-store');

//// 构造一个内存仓储 mock,记录所有 get/put [@busybee 2026-06-13] ////
function mockRepository(initial = {}) {
  const store = { ...initial };
  return {
    store,
    async get(key) {
      return key in store ? store[key] : null;
    },
    async put(key, value) {
      store[key] = value;
    }
  };
}

//// 简单可逆加解密 mock,用前缀标记加密态 [@busybee 2026-06-13] ////
const fakeCrypto = {
  encrypt: (v) => `ENC(${v})`,
  decrypt: (v) => (typeof v === 'string' && v.startsWith('ENC(') ? v.slice(4, -1) : v)
};

test('write 经仓储 put 落盘到分层键', async () => {
  const repo = mockRepository();
  const cs = new ConfigStore(repo);
  await cs.write('global', null, { baseURL: 'https://x' });
  assert.deepStrictEqual(repo.store['config/global'], { baseURL: 'https://x' });
});

test('角色层与意图层按 scopeId 分桶', async () => {
  const repo = mockRepository();
  const cs = new ConfigStore(repo);
  await cs.write('character', 'alice', { emotionFrequency: 20 });
  await cs.write('intent', 'idle-chat', { maxTokensMultiplier: 2 });
  assert.deepStrictEqual(repo.store['config/character/alice'], { emotionFrequency: 20 });
  assert.deepStrictEqual(repo.store['config/intent/idle-chat'], { maxTokensMultiplier: 2 });
});

test('read 返回仓储里没有的键时给 null', async () => {
  const cs = new ConfigStore(mockRepository());
  assert.strictEqual(await cs.read('global', null), null);
});

test('write 只加密声明过的字段,其余字段原样', async () => {
  const repo = mockRepository();
  const cs = new ConfigStore(repo, fakeCrypto);
  await cs.write('global', null, { apiKey: 'sk-secret', baseURL: 'https://x' });
  const onDisk = repo.store['config/global'];
  assert.strictEqual(onDisk.apiKey, 'ENC(sk-secret)');
  assert.strictEqual(onDisk.baseURL, 'https://x');
});

test('read 透明解密声明过的字段', async () => {
  const repo = mockRepository();
  const cs = new ConfigStore(repo, fakeCrypto);
  await cs.write('global', null, { apiKey: 'sk-roundtrip' });
  const loaded = await cs.read('global', null);
  assert.strictEqual(loaded.apiKey, 'sk-roundtrip');
});

test('write 加密嵌套路径字段', async () => {
  const repo = mockRepository();
  const cs = new ConfigStore(repo, fakeCrypto);
  await cs.write('character', 'bob', { enhance: { search: { customApiKey: 'web-key' } } });
  const onDisk = repo.store['config/character/bob'];
  assert.strictEqual(onDisk.enhance.search.customApiKey, 'ENC(web-key)');
});

test('write 不改动调用方传入的对象引用', async () => {
  const cs = new ConfigStore(mockRepository(), fakeCrypto);
  const input = { apiKey: 'sk-plain' };
  await cs.write('global', null, input);
  assert.strictEqual(input.apiKey, 'sk-plain');
});

test('未知层名抛清晰错误', async () => {
  const cs = new ConfigStore(mockRepository());
  await assert.rejects(() => cs.write('unknown', null, {}), /未知配置层/);
});

test('加密字段声明只此一处且覆盖三项', () => {
  assert.deepStrictEqual(
    ENCRYPTED_FIELDS,
    ['apiKey', 'translation.apiKey', 'enhance.search.customApiKey']
  );
});
