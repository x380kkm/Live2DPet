// audience: internal
// # segmentation-fix-service.test
// 验证分词纠错服务:用 mock llm 客户端只合并切错的相邻词,无客户端或失败时原样返回,结果缓存。
// 运行: node --test tests/platform/segmentation-fix-service.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { SegmentationFixService } = require('../../src/platform/llm/segmentation-fix-service');

const UNITS = [
  { word: '头戴', sylls: 2 }, { word: '巨大', sylls: 2 }, { word: '市', sylls: 1 }, { word: '女笠', sylls: 2 },
];

//// 无客户端时原样返回分词,不抛 [@x380kkm 2026-06-17] ////
test('SegmentationFixService 未配置则原样返回', async () => {
  const svc = new SegmentationFixService({});
  assert.strictEqual(svc.isConfigured(), false);
  const out = await svc.fix('头戴巨大市女笠', UNITS);
  assert.deepStrictEqual(out.map((u) => u.word), ['头戴', '巨大', '市', '女笠']);
});

//// 有客户端时按其返回的合并区间合并切错的相邻词 [@x380kkm 2026-06-17] ////
test('SegmentationFixService 按 LLM 合并区间纠错', async () => {
  let calls = 0;
  const llmClient = { complete: async () => { calls += 1; return { text: '{"merges":[[2,3]]}' }; } };
  const svc = new SegmentationFixService({ llmClient });
  const out = await svc.fix('头戴巨大市女笠', UNITS);
  assert.deepStrictEqual(out.map((u) => u.word), ['头戴', '巨大', '市女笠'], '市与女笠合并');
  // 同一句再调命中缓存,不再请求 LLM
  await svc.fix('头戴巨大市女笠', UNITS);
  assert.strictEqual(calls, 1, '命中缓存不重复请求');
});

//// LLM 调用失败时原样返回分词,不抛 [@x380kkm 2026-06-17] ////
test('SegmentationFixService 失败降级', async () => {
  const llmClient = { complete: async () => { throw new Error('网络错误'); } };
  const svc = new SegmentationFixService({ llmClient });
  const out = await svc.fix('头戴巨大市女笠', UNITS);
  assert.deepStrictEqual(out.map((u) => u.word), ['头戴', '巨大', '市', '女笠'], '失败原样返回');
});
