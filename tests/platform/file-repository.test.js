// 运行: node --test tests/platform/file-repository.test.js
// 用 mock 注入 pathUtils 与 fs(promises 形态),断言读写经 path-utils 算路径、
// JSON 序列化往返正确、时间分层查询按字段区间筛选。

const { test } = require('node:test');
const assert = require('node:assert');
const { FileRepository } = require('../../src/platform/storage/file-repository');

//// 用内存 map 假 fs:记录写入路径与内容,readFile 命中即返回 [@busybee 2026-06-13] ////
function fakeFs(initial = {}) {
  const files = { ...initial };
  const mkdirCalls = [];
  return {
    files,
    mkdirCalls,
    async readFile(p) {
      if (!(p in files)) {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      }
      return files[p];
    },
    async writeFile(p, data) { files[p] = data; },
    async mkdir(dir, opts) { mkdirCalls.push({ dir, opts }); }
  };
}

//// 假 pathUtils:把键拼到固定的 userData 前缀下 [@busybee 2026-06-13] ////
function fakePathUtils() {
  return { resolve: (key) => `/user/data/${key}` };
}

test('get 经 pathUtils 算路径并解析 JSON', async () => {
  const fs = fakeFs({ '/user/data/config.json': JSON.stringify({ a: 1 }) });
  const repo = new FileRepository(fakePathUtils(), fs);
  const value = await repo.get('config');
  assert.deepStrictEqual(value, { a: 1 });
});

test('get 文件不存在返回 null', async () => {
  const repo = new FileRepository(fakePathUtils(), fakeFs());
  assert.strictEqual(await repo.get('missing'), null);
});

test('get 内容损坏(非法 JSON)返回 null', async () => {
  const fs = fakeFs({ '/user/data/bad.json': '{not-json' });
  const repo = new FileRepository(fakePathUtils(), fs);
  assert.strictEqual(await repo.get('bad'), null);
});

test('put 序列化写入并先建父目录', async () => {
  const fs = fakeFs();
  const repo = new FileRepository(fakePathUtils(), fs);
  await repo.put('config', { a: 2 });
  assert.deepStrictEqual(JSON.parse(fs.files['/user/data/config.json']), { a: 2 });
  assert.strictEqual(fs.mkdirCalls.length, 1);
  assert.deepStrictEqual(fs.mkdirCalls[0].opts, { recursive: true });
});

test('put 后 get 往返一致', async () => {
  const repo = new FileRepository(fakePathUtils(), fakeFs());
  await repo.put('state', { nested: { n: 3 } });
  assert.deepStrictEqual(await repo.get('state'), { nested: { n: 3 } });
});

test('queryByTime 按字段区间筛对象集合的值', async () => {
  const collection = {
    a: { id: 'a', ts: 10 },
    b: { id: 'b', ts: 20 },
    c: { id: 'c', ts: 30 }
  };
  const fs = fakeFs({ '/user/data/log.json': JSON.stringify(collection) });
  const repo = new FileRepository(fakePathUtils(), fs);
  const hits = await repo.queryByTime({ key: 'log', field: 'ts', from: 15, to: 30 });
  assert.deepStrictEqual(hits.map(e => e.id), ['b', 'c']);
});

test('queryByTime 支持数组集合并跳过缺失时间字段的项', async () => {
  const collection = [
    { id: 'x', ts: 5 },
    { id: 'y' },
    { id: 'z', ts: 8 }
  ];
  const fs = fakeFs({ '/user/data/log.json': JSON.stringify(collection) });
  const repo = new FileRepository(fakePathUtils(), fs);
  const hits = await repo.queryByTime({ key: 'log', field: 'ts', from: 0, to: 10 });
  assert.deepStrictEqual(hits.map(e => e.id), ['x', 'z']);
});

test('queryByTime 集合不存在返回空数组', async () => {
  const repo = new FileRepository(fakePathUtils(), fakeFs());
  const hits = await repo.queryByTime({ key: 'missing', field: 'ts', from: 0, to: 10 });
  assert.deepStrictEqual(hits, []);
});
