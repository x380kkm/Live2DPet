// 运行:node --test tests/platform/translation-service.test.js
// 验证中译日翻译服务:经注入客户端发起翻译、清理译文、LRU 缓存、禁用与失败时安全退化。
const { test } = require('node:test');
const assert = require('node:assert');
const { TranslationService } = require('../../src/platform/llm/translation-service');

//// 造一个记录请求并返回固定译文的 llm 客户端模拟 [@x380kkm 2026-06-13] ////
function makeClient(textOrFn) {
  const calls = [];
  return {
    calls,
    async complete(request) {
      calls.push(request);
      const text = typeof textOrFn === 'function' ? textOrFn(request) : textOrFn;
      return { text };
    }
  };
}

test('translate 经客户端把原文译为日语并按少样本提示组装消息', async () => {
  const client = makeClient('わあ、テストだ！');
  const service = new TranslationService({ llmClient: client });

  const result = await service.translate('哇，测试！');
  assert.strictEqual(result, 'わあ、テストだ！');
  assert.strictEqual(client.calls.length, 1);

  const messages = client.calls[0].messages;
  assert.strictEqual(messages[0].role, 'system');
  // 末条消息是待译的原文
  assert.deepStrictEqual(messages[messages.length - 1], { role: 'user', content: '哇，测试！' });
});

test('translate 剥离译文中的标记字符并归并多余空白', async () => {
  const client = makeClient('  わあ  **テスト**  だ  ');
  const service = new TranslationService({ llmClient: client });

  const result = await service.translate('测试');
  assert.strictEqual(result, 'わあ テスト だ');
});

test('translate 命中缓存时不再调用客户端', async () => {
  const client = makeClient('キャッシュ');
  const service = new TranslationService({ llmClient: client });

  await service.translate('缓存');
  const second = await service.translate('缓存');
  assert.strictEqual(second, 'キャッシュ');
  assert.strictEqual(client.calls.length, 1);
});

test('缓存超出上限时淘汰最早写入的一条', async () => {
  // 每条原文返回不同译文,便于辨认淘汰
  const client = makeClient((req) => 'T' + req.messages[req.messages.length - 1].content);
  const service = new TranslationService({ llmClient: client, cacheMaxSize: 2 });

  await service.translate('a');
  await service.translate('b');
  await service.translate('c');
  // 此时缓存只剩最近写入的 b、c,a 已被淘汰
  assert.strictEqual(client.calls.length, 3);

  // 'c' 仍在缓存,不触发新调用
  await service.translate('c');
  assert.strictEqual(client.calls.length, 3);

  // 'a' 已被淘汰,再译触发新调用
  await service.translate('a');
  assert.strictEqual(client.calls.length, 4);
});

test('禁用时原样返回输入且不调用客户端', async () => {
  const client = makeClient('不应被调用');
  const service = new TranslationService({ llmClient: client });
  service.enabled = false;

  const result = await service.translate('原文');
  assert.strictEqual(result, '原文');
  assert.strictEqual(client.calls.length, 0);
});

test('无客户端时未就绪且原样返回输入', async () => {
  const service = new TranslationService();
  assert.strictEqual(service.isConfigured(), false);
  assert.strictEqual(await service.translate('原文'), '原文');
});

test('setClient 注入客户端后即就绪', () => {
  const service = new TranslationService();
  service.setClient(makeClient('x'));
  assert.strictEqual(service.isConfigured(), true);
});

test('空文本原样返回且不调用客户端', async () => {
  const client = makeClient('x');
  const service = new TranslationService({ llmClient: client });
  assert.strictEqual(await service.translate(''), '');
  assert.strictEqual(client.calls.length, 0);
});

test('客户端抛错时回退到原文', async () => {
  const service = new TranslationService({
    llmClient: { async complete() { throw new Error('网络失败'); } }
  });
  assert.strictEqual(await service.translate('原文'), '原文');
});

test('客户端返回空译文时回退到原文', async () => {
  const service = new TranslationService({ llmClient: makeClient('') });
  assert.strictEqual(await service.translate('原文'), '原文');
});

test('clearCache 清空缓存后重新调用客户端', async () => {
  const client = makeClient('再译');
  const service = new TranslationService({ llmClient: client });

  await service.translate('清缓存');
  service.clearCache();
  await service.translate('清缓存');
  assert.strictEqual(client.calls.length, 2);
});
