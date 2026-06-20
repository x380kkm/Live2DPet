// audience: internal
// # melody-eval.test
// 验证旋律内部一致性评估:级进流畅的旋律得分高于满是大跳的;输出含特征与 0-100 分。
// 运行: node --test tests/domain/melody-eval.test.js

const { test } = require('node:test');
const assert = require('node:assert');
const { evaluateMelody } = require('../../src/domain/tts/melody-eval');

//// 级进流畅 vs 满是大跳:前者得分更高 [@x380kkm 2026-06-20] ////
test('stepwise melody scores higher than a leapy one', () => {
  const stepwise = [60, 62, 64, 62, 64, 65, 64, 62, 60, 62, 64, 62].map((k) => ({ key: k, beats: 1 }));
  const leapy = [60, 79, 55, 81, 53, 84, 50, 83, 52, 80, 57, 72].map((k) => ({ key: k, beats: 1 }));
  const a = evaluateMelody(stepwise);
  const b = evaluateMelody(leapy);
  assert.ok(a.score > b.score, `级进 ${a.score} 应高于大跳 ${b.score}`);
  assert.ok(a.score >= 0 && a.score <= 100);
});

//// 输出含特征、各项贴合度与分数 [@x380kkm 2026-06-20] ////
test('evaluateMelody returns features, parts and a numeric score', () => {
  const r = evaluateMelody([{ key: 60, beats: 1 }, { key: 62, beats: 1 }, { key: 64, beats: 1 }, { key: 62, beats: 1 }]);
  assert.strictEqual(typeof r.score, 'number');
  assert.ok(r.features && typeof r.features.stepRatio === 'number');
  assert.ok(r.parts && typeof r.parts.leapRate === 'number');
});

//// 音符太少时不崩、给出标记 [@x380kkm 2026-06-20] ////
test('evaluateMelody handles too-few notes gracefully', () => {
  const r = evaluateMelody([{ key: 60, beats: 1 }]);
  assert.strictEqual(r.score, 0);
  assert.ok(Array.isArray(r.flags));
});
