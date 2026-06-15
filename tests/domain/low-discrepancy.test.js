// audience: internal
// # low-discrepancy.test
// 验证低差异序列:值恒在 [0,1)、同种子确定可复现、相邻步差为黄金比共轭、分布比纯随机均匀;
// 以及按权重抽取的逆变换在各区间命中正确下标、全零权重回退。

const { test } = require('node:test');
const assert = require('node:assert');
const { LowDiscrepancySequence, pickByWeight, GOLDEN_RATIO_CONJUGATE } = require('../../src/domain/pet/low-discrepancy.js');

//// 序列值恒在 [0,1),相邻步进为黄金比共轭取小数 [@x380kkm 2026-06-14] ////
test('LowDiscrepancySequence 值落在 [0,1),相邻步差为黄金比共轭', () => {
  const seq = new LowDiscrepancySequence(0);
  let prev = 0;
  for (let i = 0; i < 50; i++) {
    const v = seq.next();
    assert.ok(v >= 0 && v < 1, `值应在 [0,1):${v}`);
    const step = ((v - prev) % 1 + 1) % 1;
    assert.ok(Math.abs(step - GOLDEN_RATIO_CONJUGATE) < 1e-9, '相邻步差应为黄金比共轭');
    prev = v;
  }
});

test('LowDiscrepancySequence 同种子确定可复现,不同种子序列不同', () => {
  const a = new LowDiscrepancySequence(0.3);
  const b = new LowDiscrepancySequence(0.3);
  const c = new LowDiscrepancySequence(0.7);
  const seqA = Array.from({ length: 10 }, () => a.next());
  const seqB = Array.from({ length: 10 }, () => b.next());
  const seqC = Array.from({ length: 10 }, () => c.next());
  assert.deepStrictEqual(seqA, seqB);
  assert.notDeepStrictEqual(seqA, seqC);
});

test('LowDiscrepancySequence 在每个十分位桶里分布均匀,优于纯随机', () => {
  const seq = new LowDiscrepancySequence(0);
  const buckets = new Array(10).fill(0);
  for (let i = 0; i < 1000; i++) {
    buckets[Math.floor(seq.next() * 10)]++;
  }
  // 低差异序列每桶应接近 100,偏差很小;放宽到 ±5 仍远紧于纯随机
  for (const count of buckets) {
    assert.ok(Math.abs(count - 100) <= 5, `每桶应接近 100:${count}`);
  }
});
//// /序列值恒在 [0,1) ////

//// pickByWeight:逆变换抽样按权重命中下标 [@x380kkm 2026-06-14] ////
test('pickByWeight 按累计权重把抽样值映射到正确下标', () => {
  const weights = [800, 100, 100]; // 对话 800、模组各 100,总 1000
  assert.strictEqual(pickByWeight(weights, 0), 0);       // 落在 [0,800)
  assert.strictEqual(pickByWeight(weights, 0.79), 0);    // 790 < 800
  assert.strictEqual(pickByWeight(weights, 0.8), 1);     // 800 落入第二段 [800,900)
  assert.strictEqual(pickByWeight(weights, 0.89), 1);
  assert.strictEqual(pickByWeight(weights, 0.9), 2);     // [900,1000)
  assert.strictEqual(pickByWeight(weights, 0.999), 2);
});

test('pickByWeight 负权重按零计,全零权重回退到 0', () => {
  assert.strictEqual(pickByWeight([0, 5, 0], 0.5), 1);
  assert.strictEqual(pickByWeight([-1, 0, 3], 0.99), 2);
  assert.strictEqual(pickByWeight([0, 0, 0], 0.5), 0);
});
//// /pickByWeight ////
