// 运行: node --test tests/domain/memory-store.test.js
// 用 mock 注入 repository 与时钟,断言 load/append/recall/flush 的时间分层契约:
// append 只进内存、recall 按时间窗合并两段、flush 经仓储落盘并按保留期淘汰。

const { test } = require('node:test');
const assert = require('node:assert');
const { MemoryStore } = require('../../src/domain/perception/memory-store');

//// 假仓储:内存 map 记录 put,get 命中即返回 [@x380kkm 2026-06-13] ////
function fakeRepository(initial = {}) {
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

//// 可控时钟 [@x380kkm 2026-06-13] ////
function fakeClock(ref) {
  return () => ref.value;
}

test('load 把仓储里的中期记忆读进内存', async () => {
  const repo = fakeRepository({ 'perception-memory': [{ situation: 's', timestamp: 100 }] });
  const store = new MemoryStore({ repository: repo, now: () => 1000 });
  await store.load();
  assert.deepStrictEqual(store.midTerm, [{ situation: 's', timestamp: 100 }]);
});

test('load 仓储为空时中期记忆为空数组', async () => {
  const store = new MemoryStore({ repository: fakeRepository(), now: () => 1000 });
  await store.load();
  assert.deepStrictEqual(store.midTerm, []);
});

test('append 只写短期缓冲并补全时间戳', () => {
  const store = new MemoryStore({ repository: fakeRepository(), now: () => 500 });
  store.append({ situation: 's' });
  assert.strictEqual(store.shortTerm.length, 1);
  assert.strictEqual(store.shortTerm[0].timestamp, 500);
  // 短期未落盘:仓储未被写入。
  assert.deepStrictEqual(store.midTerm, []);
});

test('append 保留显式时间戳', () => {
  const store = new MemoryStore({ repository: fakeRepository(), now: () => 500 });
  store.append({ situation: 's', timestamp: 42 });
  assert.strictEqual(store.shortTerm[0].timestamp, 42);
});

test('recall 按时间窗合并中期与短期并最新在前', async () => {
  const repo = fakeRepository({ 'perception-memory': [{ situation: 'mid', timestamp: 100 }] });
  const store = new MemoryStore({ repository: repo, now: () => 1000 });
  await store.load();
  store.append({ situation: 'short', timestamp: 300 });
  const hits = store.recall({ from: 0, to: 1000 });
  assert.deepStrictEqual(hits.map((e) => e.situation), ['short', 'mid']);
});

test('recall 筛掉时间窗外的条目', async () => {
  const store = new MemoryStore({ repository: fakeRepository(), now: () => 1000 });
  store.append({ situation: 'a', timestamp: 50 });
  store.append({ situation: 'b', timestamp: 500 });
  const hits = store.recall({ from: 100, to: 1000 });
  assert.deepStrictEqual(hits.map((e) => e.situation), ['b']);
});

test('recall 支持 limit 截断', () => {
  const store = new MemoryStore({ repository: fakeRepository(), now: () => 1000 });
  store.append({ situation: 'a', timestamp: 10 });
  store.append({ situation: 'b', timestamp: 20 });
  store.append({ situation: 'c', timestamp: 30 });
  const hits = store.recall({ from: 0, to: 100, limit: 2 });
  assert.deepStrictEqual(hits.map((e) => e.situation), ['c', 'b']);
});

test('flush 把短期并入中期并经仓储落盘后清空短期', async () => {
  const repo = fakeRepository();
  const store = new MemoryStore({ repository: repo, now: () => 1000 });
  store.append({ situation: 's', timestamp: 900 });
  await store.flush();
  assert.deepStrictEqual(repo.store['perception-memory'], [{ situation: 's', timestamp: 900 }]);
  assert.strictEqual(store.shortTerm.length, 0);
  assert.strictEqual(store.midTerm.length, 1);
});

test('flush 淘汰超保留期的条目', async () => {
  const clock = { value: 1000000 };
  const repo = fakeRepository();
  const store = new MemoryStore(
    { repository: repo, now: fakeClock(clock) },
    { retentionMs: 1000 }
  );
  store.append({ situation: 'fresh', timestamp: 999500 }); // 距今 500ms,保留
  store.append({ situation: 'stale', timestamp: 100 }); // 远超保留期,淘汰
  await store.flush();
  assert.deepStrictEqual(repo.store['perception-memory'].map((e) => e.situation), ['fresh']);
});

test('flush 短期为空时不写仓储', async () => {
  const repo = fakeRepository();
  const store = new MemoryStore({ repository: repo, now: () => 1000 });
  await store.flush();
  assert.strictEqual('perception-memory' in repo.store, false);
});

test('flush 按 maxEntries 保留最近若干条', async () => {
  const repo = fakeRepository();
  const store = new MemoryStore(
    { repository: repo, now: () => 1000 },
    { maxEntries: 2, retentionMs: Infinity }
  );
  store.append({ situation: 'a', timestamp: 10 });
  store.append({ situation: 'b', timestamp: 20 });
  store.append({ situation: 'c', timestamp: 30 });
  await store.flush();
  assert.deepStrictEqual(repo.store['perception-memory'].map((e) => e.situation), ['c', 'b']);
});
