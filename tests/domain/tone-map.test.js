// audience: internal
// # tone-map.test
// 验证情绪到语气字段的映射:已知情绪给出语调与停顿字段、大小写不敏感,未知或空情绪返回 null。

const { test } = require('node:test');
const assert = require('node:assert');
const { toneFor } = require('../../src/domain/tts/tone-map');

//// 已知情绪给出语气字段,愉快抬高语调、低落压低 [@x380kkm 2026-06-14] ////
test('已知情绪给出语气字段,愉快抬高起伏与音高、低落压平压低', () => {
  const happy = toneFor('happy');
  assert.ok(happy && typeof happy.contour === 'number');
  assert.ok(happy.contour > 1, '愉快应放大起伏');
  assert.ok(happy.pitchLift > 0, '愉快应抬高音高');
  const sad = toneFor('sad');
  assert.ok(sad.contour < 1, '低落应压平起伏');
  assert.ok(sad.pitchLift < 0, '低落应压低音高');
});

test('情绪名大小写不敏感', () => {
  assert.deepStrictEqual(toneFor('HAPPY'), toneFor('happy'));
});

test('未知或空情绪返回 null', () => {
  assert.strictEqual(toneFor('no-such-emotion'), null);
  assert.strictEqual(toneFor(''), null);
  assert.strictEqual(toneFor(null), null);
});
